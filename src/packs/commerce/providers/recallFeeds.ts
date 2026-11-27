import { type BoundedTtlCache, isolateCache, TTL_MS, withTwoTierCache } from "../../../lib/cache";
import { fetchJsonWithTimeout, UpstreamError } from "../../../lib/http";

export type RecallSeverity = "LOW" | "MODERATE" | "HIGH" | "CRITICAL_CLASS_I";

export interface NormalizedRecallItem {
  agency: "US_CPSC" | "US_FDA";
  category: "consumer" | "food" | "drug" | "device";
  recall_number: string;
  recall_date: string | null;
  status: "ACTIVE" | "TERMINATED";
  severity: RecallSeverity;
  classification: string | null;
  firm: string | null;
  title: string;
  hazard_or_reason: string | null;
  remedy: string | null;
  url: string | null;
}

function extractCpscNamedList(raw: unknown): string[] {
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const val =
        typeof obj.Name === "string"
          ? obj.Name
          : typeof obj.ProductName === "string"
            ? obj.ProductName
            : typeof obj.Description === "string"
              ? obj.Description
              : null;
      if (val?.trim()) out.push(val.trim());
    }
  }
  return out;
}

function truncateClean(text: string | null | undefined, maxLen = 220): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen - 1).trimEnd()}…`;
}

function classifyCpscSeverity(
  title: string,
  hazard: string | null,
  injuries: string | null,
): RecallSeverity {
  const combined = `${title} ${hazard ?? ""} ${injuries ?? ""}`.toLowerCase();
  if (
    /\b(death|deaths|fatal|fatality|suffocation|strangulation|drowning|electrocution|ingestion|lead poisoning|anaphylaxis)\b/.test(
      combined,
    )
  ) {
    return "HIGH";
  }
  if (
    /\b(serious injury|choking|fire|burn|laceration|fall hazard|tip-over|entrapment|amputation|explosion|lithium)\b/.test(
      combined,
    )
  ) {
    return "HIGH";
  }
  return "MODERATE";
}

function mapCpscRowsNewestFirst(
  rawRows: unknown[],
  brandLower: string | null,
): NormalizedRecallItem[] {
  // CPSC returns rows in ascending RecallID (oldest 1970s-2000s first).
  // Sort newest-first by RecallDate DESC then RecallID DESC BEFORE slicing to 25 so active 2024-2026 recalls are never truncated!
  const sortedRows = [...rawRows].sort((a, b) => {
    const objA = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
    const objB = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    const dateA = typeof objA.RecallDate === "string" ? objA.RecallDate.slice(0, 10) : "";
    const dateB = typeof objB.RecallDate === "string" ? objB.RecallDate.slice(0, 10) : "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    const idA = typeof objA.RecallID === "number" ? objA.RecallID : 0;
    const idB = typeof objB.RecallID === "number" ? objB.RecallID : 0;
    return idB - idA;
  });

  const items: NormalizedRecallItem[] = [];
  const seenNumbers = new Set<string>();

  for (const raw of sortedRows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const recallNumber =
      typeof row.RecallNumber === "string" && row.RecallNumber.trim()
        ? row.RecallNumber.trim()
        : typeof row.RecallID === "number"
          ? String(row.RecallID)
          : null;
    if (!recallNumber || seenNumbers.has(recallNumber)) continue;

    const title =
      typeof row.Title === "string" && row.Title.trim()
        ? row.Title.trim()
        : typeof row.RecallTitle === "string" && row.RecallTitle.trim()
          ? row.RecallTitle.trim()
          : null;
    const description =
      typeof row.Description === "string"
        ? row.Description
        : typeof row.RecallDescription === "string"
          ? row.RecallDescription
          : null;
    if (!title && !description) continue;

    const manufacturers = extractCpscNamedList(row.Manufacturers);
    const products = extractCpscNamedList(row.Products);
    const hazards = extractCpscNamedList(row.Hazards);
    const remedies = extractCpscNamedList(row.Remedies);
    const injuries = extractCpscNamedList(row.Injuries);

    if (brandLower) {
      const haystack =
        `${title ?? ""} ${description ?? ""} ${manufacturers.join(" ")} ${products.join(" ")}`.toLowerCase();
      if (!haystack.includes(brandLower)) continue;
    }

    seenNumbers.add(recallNumber);
    const rawDate = typeof row.RecallDate === "string" ? row.RecallDate.slice(0, 10) : null;
    const recallDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    const hazardStr = truncateClean(hazards.join("; ") || description, 200);
    const injuryStr = injuries.join("; ");
    const url =
      typeof row.URL === "string" && row.URL.startsWith("http")
        ? row.URL
        : typeof row.RecallURL === "string" && row.RecallURL.startsWith("http")
          ? row.RecallURL
          : null;

    let firm: string | null = manufacturers[0] ?? null;
    if (!firm && title) {
      const m = /^(.+?)\s+Recalls\s+/i.exec(title);
      if (m?.[1] && m[1].length <= 80) firm = m[1].trim();
    }

    items.push({
      agency: "US_CPSC",
      category: "consumer",
      recall_number: recallNumber,
      recall_date: recallDate,
      status: "ACTIVE",
      severity: classifyCpscSeverity(title ?? "", hazardStr, injuryStr),
      classification: null,
      firm: truncateClean(firm, 100),
      title: truncateClean(title ?? products[0] ?? "CPSC Consumer Product Recall", 180)!,
      hazard_or_reason: hazardStr,
      remedy: truncateClean(remedies.join("; "), 140),
      url,
    });

    if (items.length >= 25) break;
  }

  return items;
}

export async function fetchCpscRecalls(
  query: string,
  brand: string | null,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<{ items: NormalizedRecallItem[]; cacheHit: boolean }> {
  const normKey = JSON.stringify([
    query.trim().replace(/\s+/g, " ").toLowerCase(),
    (brand ?? "").trim().replace(/\s+/g, " ").toLowerCase(),
  ]);
  const { value, cacheHit } = await withTwoTierCache<NormalizedRecallItem[]>({
    key: `commerce:cpsc:${normKey}`,
    ttlMs: TTL_MS.COMMERCE_CPSC_RECALLS,
    cache,
    waitUntil,
    fetcher: async () => {
      const runCpscQuery = async (extraParams: Record<string, string>) => {
        const params = new URLSearchParams({
          format: "json",
          ...extraParams,
        });
        const res = await fetchJsonWithTimeout<unknown[]>(
          `https://www.saferproducts.gov/RestWebServices/Recall?${params.toString()}`,
          {
            provider: "US_CPSC",
            timeoutMs: 6000,
            allow404: true,
            fetchImpl,
          },
        );
        if (res.status === "not_found" || res.data === null) return [];
        if (!Array.isArray(res.data)) {
          throw new UpstreamError(
            "US_CPSC",
            "CPSC_BAD_SCHEMA",
            "Invalid US CPSC Recall JSON array",
          );
        }
        return res.data;
      };

      const brandLower = brand ? brand.trim().toLowerCase() : null;
      const productRows = await runCpscQuery({ ProductName: query });
      let items = mapCpscRowsNewestFirst(productRows, brandLower);

      // Fallback to RecallTitle if ProductName yielded 0 matches (including when brand filter narrowed ProductName to 0)
      if (items.length === 0) {
        const titleRows = await runCpscQuery({ RecallTitle: query });
        items = mapCpscRowsNewestFirst(titleRows, brandLower);
      }

      return items;
    },
  });

  return { items: value, cacheHit };
}

function normalizeFdaDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  return null;
}

function mapFdaSeverity(classification: string | null): RecallSeverity {
  if (!classification) return "MODERATE";
  const upper = classification.toUpperCase();
  if (upper.includes("CLASS I") && !upper.includes("CLASS II") && !upper.includes("CLASS III")) {
    return "CRITICAL_CLASS_I";
  }
  if (upper.includes("CLASS II") && !upper.includes("CLASS III")) {
    return "HIGH";
  }
  if (upper.includes("CLASS III")) {
    return "LOW";
  }
  return "MODERATE";
}

export async function fetchOpenFdaRecalls(
  vertical: "food" | "drug" | "device",
  query: string,
  brand: string | null,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<{ items: NormalizedRecallItem[]; cacheHit: boolean }> {
  const cleanQuery = query
    .replace(/["\\()+:^~*?[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleanBrand = brand
    ? brand
        .replace(/["\\()+:^~*?[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : null;

  const normKey = `${vertical}|${cleanQuery.toLowerCase()}|${(cleanBrand ?? "").toLowerCase()}`;
  const { value, cacheHit } = await withTwoTierCache<NormalizedRecallItem[]>({
    key: `commerce:openfda:${normKey}`,
    ttlMs: TTL_MS.COMMERCE_OPENFDA_RECALLS,
    cache,
    waitUntil,
    fetcher: async () => {
      if (!cleanQuery) return [];
      const clauses = [`product_description:"${cleanQuery}"`];
      if (cleanBrand) {
        clauses.push(`recalling_firm:"${cleanBrand}"`);
      }
      const url = `https://api.fda.gov/${vertical}/enforcement.json?search=${encodeURIComponent(clauses[0]!)}${cleanBrand ? `+AND+${encodeURIComponent(clauses[1]!)}` : ""}&sort=recall_initiation_date:desc&limit=8`;

      const res = await fetchJsonWithTimeout<{ results?: unknown }>(url, {
        provider: "OPENFDA",
        timeoutMs: 5000,
        allow404: true, // openFDA returns HTTP 404 NOT_FOUND when zero enforcement records match
        fetchImpl,
      });

      if (res.status === "not_found") {
        return [];
      }
      if (!Array.isArray(res.data?.results)) {
        throw new UpstreamError(
          "OPENFDA",
          "OPENFDA_BAD_SCHEMA",
          "Invalid openFDA enforcement results payload",
        );
      }

      const items: NormalizedRecallItem[] = [];
      for (const rawRow of res.data.results) {
        if (!rawRow || typeof rawRow !== "object") continue;
        const row = rawRow as Record<string, unknown>;
        const recallNumber =
          typeof row.recall_number === "string" && row.recall_number.trim()
            ? row.recall_number.trim()
            : typeof row.event_id === "string"
              ? row.event_id.trim()
              : null;
        const prodDesc =
          typeof row.product_description === "string" ? row.product_description : null;
        if (!recallNumber || !prodDesc) continue;

        const classification =
          typeof row.classification === "string" && row.classification.trim()
            ? row.classification.trim()
            : null;
        const rawStatus = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
        const status: "ACTIVE" | "TERMINATED" = rawStatus.includes("ongoing")
          ? "ACTIVE"
          : "TERMINATED";

        items.push({
          agency: "US_FDA",
          category: vertical,
          recall_number: recallNumber,
          recall_date: normalizeFdaDate(row.recall_initiation_date ?? row.report_date),
          status,
          severity: mapFdaSeverity(classification),
          classification,
          firm: truncateClean(
            typeof row.recalling_firm === "string" ? row.recalling_firm : null,
            100,
          ),
          title: truncateClean(prodDesc, 180)!,
          hazard_or_reason: truncateClean(
            typeof row.reason_for_recall === "string" ? row.reason_for_recall : null,
            200,
          ),
          remedy: null,
          url: null,
        });
      }

      return items;
    },
  });

  return { items: value, cacheHit };
}
