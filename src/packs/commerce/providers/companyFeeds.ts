import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { fetchJsonWithTimeout } from "../../../lib/http";
import { validateLeiChecksum } from "../validation";

export interface WikidataCorporateMeta {
  wikidataId: string;
  label: string;
  description: string | null;
  lei: string | null;
  cik: string | null;
  officialWebsite: string | null;
  officialDomain: string | null;
  tickers: string[];
}

function extractHostname(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.trim().toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export async function fetchWikidataCorporateMeta(
  searchTerm: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: WikidataCorporateMeta | null; cacheHit: boolean }> {
  const normKey = searchTerm.trim().toLowerCase();
  const { value, cacheHit } = await withTwoTierCache<WikidataCorporateMeta | null>({
    key: `commerce:wikidata:${normKey}`,
    ttlMs: TTL_MS.COMMERCE_WIKIDATA,
    cache,
    waitUntil,
    fetcher: async () => {
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=en&format=json&limit=4`;
      const searchRes = await fetchJsonWithTimeout<{
        search?: Array<{ id?: unknown; label?: unknown; description?: unknown }>;
      }>(searchUrl, {
        provider: "WIKIDATA",
        timeoutMs: 4500,
        allow404: true,
        fetchImpl,
      });

      if (searchRes.status === "not_found" || !Array.isArray(searchRes.data?.search)) {
        return null;
      }

      const candidate = searchRes.data.search.find((item) => {
        if (typeof item?.id !== "string" || !/^Q\d+$/.test(item.id)) return false;
        const desc = typeof item.description === "string" ? item.description.toLowerCase() : "";
        if (
          desc.includes("disambiguation") ||
          desc.includes("given name") ||
          desc.includes("family name") ||
          desc.includes("wikimedia")
        ) {
          return false;
        }
        return true;
      });

      if (!candidate || typeof candidate.id !== "string") {
        return null;
      }

      const qid = candidate.id;
      const label =
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim()
          : searchTerm;
      const description =
        typeof candidate.description === "string" && candidate.description.trim()
          ? candidate.description.trim()
          : null;

      // Compact ~0.4 KB direct-subject SPARQL lookup (avoids 650+ KB full-entity claims dump on mega-caps like Q312)
      const sparql = `SELECT ?lei ?cik ?website ?ticker WHERE { VALUES ?item { wd:${qid} } OPTIONAL { ?item wdt:P1278 ?lei } OPTIONAL { ?item wdt:P5531 ?cik } OPTIONAL { ?item wdt:P856 ?website } OPTIONAL { ?item p:P414/pq:P249 ?ticker } } LIMIT 6`;
      const sparqlUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
      const sparqlRes = await fetchJsonWithTimeout<{
        results?: { bindings?: Array<Record<string, { value?: unknown }>> };
      }>(sparqlUrl, {
        provider: "WIKIDATA",
        headers: { Accept: "application/sparql-results+json" },
        timeoutMs: 4500,
        allow404: true,
        fetchImpl,
      });

      let lei: string | null = null;
      let cik: string | null = null;
      let officialWebsite: string | null = null;
      const tickersSet = new Set<string>();

      const bindings =
        sparqlRes.status === "ok" && Array.isArray(sparqlRes.data?.results?.bindings)
          ? sparqlRes.data.results.bindings
          : [];

      for (const b of bindings) {
        if (!lei && typeof b.lei?.value === "string") {
          const check = validateLeiChecksum(b.lei.value);
          if (check.valid) lei = check.normalized;
        }
        if (!cik && typeof b.cik?.value === "string") {
          const digits = b.cik.value.trim().replace(/^CIK/i, "");
          if (/^\d{1,10}$/.test(digits) && Number(digits) > 0) {
            cik = digits.padStart(10, "0");
          }
        }
        if (!officialWebsite && typeof b.website?.value === "string") {
          const w = b.website.value.trim();
          if (w.startsWith("http://") || w.startsWith("https://")) {
            officialWebsite = w;
          }
        }
        if (typeof b.ticker?.value === "string" && b.ticker.value.trim()) {
          tickersSet.add(b.ticker.value.trim().toUpperCase());
        }
      }

      // Require at least one corporate signal (LEI, CIK, ticker, website, or business/org description) so random nouns don't false-match
      const descLower = (description ?? "").toLowerCase();
      const looksCorporate =
        Boolean(lei || cik || tickersSet.size > 0) ||
        /\b(company|corporation|inc|ltd|gmbh|plc|bank|enterprise|firm|conglomerate|manufacturer|subsidiary|organization|institution|holding|airline|retailer|software|technology|pharmaceutical)\b/.test(
          descLower
        );
      if (!looksCorporate) {
        return null;
      }

      return {
        wikidataId: qid,
        label,
        description,
        lei,
        cik,
        officialWebsite,
        officialDomain: officialWebsite ? extractHostname(officialWebsite) : null,
        tickers: [...tickersSet].slice(0, 5),
      };
    },
  });

  return { data: value, cacheHit };
}

export interface SecFilingItem {
  form: string;
  filing_date: string;
  accession_number: string;
}

export interface SlimSecEdgarProfile {
  cik: string;
  name: string | null;
  sic: string | null;
  sic_description: string | null;
  state_of_incorporation: string | null;
  ein: string | null;
  tickers: string[];
  exchanges: string[];
  recent_filings: SecFilingItem[];
}

const MATERIAL_SEC_FORMS: ReadonlySet<string> = new Set([
  "10-K",
  "10-K/A",
  "10-Q",
  "10-Q/A",
  "8-K",
  "8-K/A",
  "20-F",
  "40-F",
  "6-K",
  "S-1",
  "DEF 14A",
]);

export async function fetchSecEdgarSubmissions(
  cik10: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: SlimSecEdgarProfile | null; cacheHit: boolean }> {
  const padded = cik10.replace(/^CIK/i, "").padStart(10, "0");
  const { value, cacheHit } = await withTwoTierCache<SlimSecEdgarProfile | null>({
    key: `commerce:sec:${padded}`,
    ttlMs: TTL_MS.COMMERCE_SEC_SUBMISSIONS,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<Record<string, unknown>>(
        `https://data.sec.gov/submissions/CIK${padded}.json`,
        {
          provider: "SEC_EDGAR",
          timeoutMs: 5000,
          allow404: true,
          fetchImpl,
        }
      );

      if (res.status === "not_found" || !res.data || typeof res.data !== "object") {
        return null;
      }

      const d = res.data;
      const filingsObj =
        d.filings && typeof d.filings === "object"
          ? ((d.filings as Record<string, unknown>).recent as Record<string, unknown> | undefined)
          : undefined;

      const forms = Array.isArray(filingsObj?.form) ? filingsObj.form : [];
      const dates = Array.isArray(filingsObj?.filingDate) ? filingsObj.filingDate : [];
      const accessions = Array.isArray(filingsObj?.accessionNumber)
        ? filingsObj.accessionNumber
        : [];

      const recentFilings: SecFilingItem[] = [];
      const maxScan = Math.min(forms.length, 120);
      for (let i = 0; i < maxScan && recentFilings.length < 5; i++) {
        const form = typeof forms[i] === "string" ? forms[i]!.trim().toUpperCase() : "";
        if (!MATERIAL_SEC_FORMS.has(form)) continue;
        const filingDate = typeof dates[i] === "string" ? dates[i]! : "";
        const accession = typeof accessions[i] === "string" ? accessions[i]! : "";
        if (!filingDate || !accession) continue;
        recentFilings.push({
          form,
          filing_date: filingDate,
          accession_number: accession,
        });
      }

      const tickers = Array.isArray(d.tickers)
        ? d.tickers.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 5)
        : [];
      const exchanges = Array.isArray(d.exchanges)
        ? [...new Set(d.exchanges.filter((e): e is string => typeof e === "string" && e.trim().length > 0))].slice(0, 5)
        : [];

      return {
        cik: padded,
        name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : null,
        sic: typeof d.sic === "string" && d.sic.trim() ? d.sic.trim() : null,
        sic_description:
          typeof d.sicDescription === "string" && d.sicDescription.trim()
            ? d.sicDescription.trim()
            : null,
        state_of_incorporation:
          typeof d.stateOfIncorporation === "string" && d.stateOfIncorporation.trim()
            ? d.stateOfIncorporation.trim()
            : null,
        ein: typeof d.ein === "string" && d.ein.trim() ? d.ein.trim() : null,
        tickers,
        exchanges,
        recent_filings: recentFilings,
      };
    },
  });

  return { data: value, cacheHit };
}

export interface FederalAwardSummaryItem {
  award_id: string;
  recipient_name: string;
  amount_usd: number;
  awarding_agency: string | null;
  start_date: string | null;
}

export interface UsaSpendingBrief {
  matched_awards_returned: number;
  top_awards_total_usd: number;
  top_awards: FederalAwardSummaryItem[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function fetchUsaSpendingAwards(
  recipientName: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: UsaSpendingBrief; cacheHit: boolean }> {
  const normalizedDots = recipientName
    .replace(/\bp\.l\.c\.?/gi, "plc")
    .replace(/\bs\.a\.?/gi, "sa")
    .replace(/\bn\.v\.?/gi, "nv")
    .replace(/\bb\.v\.?/gi, "bv")
    .replace(/\ba\.g\.?/gi, "ag");
  const cleanName = normalizedDots
    .replace(/\b(inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|llc|plc|gmbh|ag|sa|nv|bv)\b/gi, "")
    .replace(/[.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const searchName = cleanName.length >= 2 ? cleanName : recipientName.trim();
  const prefixGuardRe = new RegExp(`^${escapeRegex(searchName)}\\b`, "i");

  const { value, cacheHit } = await withTwoTierCache<UsaSpendingBrief>({
    key: `commerce:usaspending:${searchName.toLowerCase()}`,
    ttlMs: TTL_MS.COMMERCE_USASPENDING,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<{ results?: Array<Record<string, unknown>> }>(
        "https://api.usaspending.gov/api/v2/search/spending_by_award/",
        {
          provider: "USASPENDING",
          method: "POST",
          body: {
            filters: {
              award_type_codes: ["A", "B", "C", "D"],
              recipient_search_text: [searchName],
            },
            fields: [
              "Award ID",
              "Recipient Name",
              "Award Amount",
              "Awarding Agency",
              "Start Date",
            ],
            sort: "Award Amount",
            order: "desc",
            limit: 10,
            page: 1,
          },
          timeoutMs: 5000,
          allow404: true,
          fetchImpl,
        }
      );

      if (res.status === "not_found" || !Array.isArray(res.data?.results)) {
        return { matched_awards_returned: 0, top_awards_total_usd: 0, top_awards: [] };
      }

      const items: FederalAwardSummaryItem[] = [];
      let total = 0;
      for (const row of res.data.results) {
        if (!row || typeof row !== "object") continue;
        const awardId = typeof row["Award ID"] === "string" ? row["Award ID"] : null;
        const recName = typeof row["Recipient Name"] === "string" ? row["Recipient Name"].trim() : null;
        const amt = Number(row["Award Amount"]);
        if (!awardId || !recName || !Number.isFinite(amt)) continue;
        // Guard against substring collisions (e.g. "Apple" matching "APPLETON", or "Next" matching "NEXTGEN")
        if (!prefixGuardRe.test(recName)) continue;
        const roundedAmt = Math.round(amt * 100) / 100;
        total += roundedAmt;
        items.push({
          award_id: awardId,
          recipient_name: recName,
          amount_usd: roundedAmt,
          awarding_agency:
            typeof row["Awarding Agency"] === "string" ? row["Awarding Agency"] : null,
          start_date: typeof row["Start Date"] === "string" ? row["Start Date"] : null,
        });
        if (items.length >= 5) break;
      }

      return {
        matched_awards_returned: items.length,
        top_awards_total_usd: Math.round(total * 100) / 100,
        top_awards: items,
      };
    },
  });

  return { data: value, cacheHit };
}
