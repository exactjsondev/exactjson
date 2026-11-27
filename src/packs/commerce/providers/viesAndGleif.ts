import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";

// Definitive EU Commission VIES userError codes where the national tax node answered authoritatively.
// Any other userError (MS_UNAVAILABLE, MS_MAX_CONCURRENT_REQ, GLOBAL_MAX_CONCURRENT_REQ, SERVICE_UNAVAILABLE,
// TIMEOUT, SERVER_BUSY, ERROR_DB_NA) MUST fail closed with HTTP 502 so an outage never mimics an unregistered VAT.
const DEFINITIVE_VIES_STATUSES: ReadonlySet<string> = new Set([
  "VALID",
  "INVALID",
  "INVALID_INPUT",
]);

export interface ViesLookupResult {
  valid: boolean;
  viesStatus: "VALID" | "INVALID" | "INVALID_INPUT";
  registeredName: string | null;
  registeredAddress: string | null;
  checkedAt: string | null;
}

function cleanViesText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed === "---") return null;
  return trimmed.slice(0, 240);
}

export async function fetchEuViesVat(
  viesCountry: string,
  vatNumber: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: ViesLookupResult; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<ViesLookupResult>({
    key: `commerce:vies:${viesCountry}:${vatNumber}`,
    ttlMs: TTL_MS.COMMERCE_EU_VIES,
    cache,
    waitUntil,
    fetcher: async () => {
      const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${encodeURIComponent(viesCountry)}/vat/${encodeURIComponent(vatNumber)}`;
      const res = await fetchJsonWithTimeout<Record<string, unknown>>(url, {
        provider: "EU_VIES",
        timeoutMs: 5500,
        fetchImpl,
      });

      if (res.status === "not_found" || !res.data || typeof res.data !== "object") {
        throw new UpstreamError("EU_VIES", "VIES_BAD_SCHEMA", "Invalid EU Commission VIES response");
      }

      const rawStatus =
        typeof res.data.userError === "string" ? res.data.userError.trim().toUpperCase() : "";
      const rawValid =
        typeof res.data.isValid === "boolean"
          ? res.data.isValid
          : typeof res.data.valid === "boolean"
            ? res.data.valid
            : null;

      if (rawValid === null || !DEFINITIVE_VIES_STATUSES.has(rawStatus)) {
        const errCode = rawStatus ? `VIES_${rawStatus}` : "VIES_INDETERMINATE";
        throw new UpstreamError(
          "EU_VIES",
          errCode,
          `EU VIES member-state node unavailable or throttled (${rawStatus || "UNKNOWN"})`
        );
      }

      return {
        valid: rawValid && rawStatus === "VALID",
        viesStatus: rawStatus as "VALID" | "INVALID" | "INVALID_INPUT",
        registeredName: cleanViesText(res.data.name),
        registeredAddress: cleanViesText(res.data.address),
        checkedAt: typeof res.data.requestDate === "string" ? res.data.requestDate : null,
      };
    },
  });

  return { data: value, cacheHit };
}

export interface SlimGleifAddress {
  city: string | null;
  region: string | null;
  country: string | null;
  postal_code: string | null;
}

export interface SlimGleifEntity {
  lei: string;
  legalName: string;
  entityStatus: string;
  registrationStatus: string;
  jurisdiction: string | null;
  country: string | null;
  registeredAs: string | null;
  legalAddress: SlimGleifAddress;
  headquartersAddress: SlimGleifAddress;
  bics: string[];
  hasDirectParentLink: boolean;
  hasUltimateParentLink: boolean;
  hasParentException: boolean;
}

function parseGleifAddress(raw: unknown): SlimGleifAddress {
  if (!raw || typeof raw !== "object") {
    return { city: null, region: null, country: null, postal_code: null };
  }
  const obj = raw as Record<string, unknown>;
  return {
    city: typeof obj.city === "string" && obj.city.trim() ? obj.city.trim() : null,
    region: typeof obj.region === "string" && obj.region.trim() ? obj.region.trim() : null,
    country: typeof obj.country === "string" && obj.country.trim() ? obj.country.trim().toUpperCase() : null,
    postal_code: typeof obj.postalCode === "string" && obj.postalCode.trim() ? obj.postalCode.trim() : null,
  };
}

export function parseGleifNode(node: unknown): SlimGleifEntity | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const attrs =
    record.attributes && typeof record.attributes === "object"
      ? (record.attributes as Record<string, unknown>)
      : null;
  if (!attrs) return null;

  const lei =
    typeof record.id === "string" && record.id.length === 20
      ? record.id.toUpperCase()
      : typeof attrs.lei === "string" && attrs.lei.length === 20
        ? attrs.lei.toUpperCase()
        : null;
  if (!lei) return null;

  const entity =
    attrs.entity && typeof attrs.entity === "object"
      ? (attrs.entity as Record<string, unknown>)
      : {};
  const registration =
    attrs.registration && typeof attrs.registration === "object"
      ? (attrs.registration as Record<string, unknown>)
      : {};
  const legalNameObj =
    entity.legalName && typeof entity.legalName === "object"
      ? (entity.legalName as Record<string, unknown>)
      : null;

  const legalName =
    typeof legalNameObj?.name === "string" && legalNameObj.name.trim()
      ? legalNameObj.name.trim()
      : null;
  if (!legalName) return null;

  const legalAddress = parseGleifAddress(entity.legalAddress);
  const headquartersAddress = parseGleifAddress(entity.headquartersAddress);
  const jurisdiction =
    typeof entity.jurisdiction === "string" && entity.jurisdiction.trim()
      ? entity.jurisdiction.trim()
      : null;
  const country = legalAddress.country ?? headquartersAddress.country;
  const bics = Array.isArray(attrs.bic)
    ? attrs.bic.filter((b): b is string => typeof b === "string").slice(0, 8)
    : [];

  const rels =
    record.relationships && typeof record.relationships === "object"
      ? (record.relationships as Record<string, Record<string, Record<string, unknown>>>)
      : null;

  // When `relationships` is present on GLEIF JSON:API records, check whether a parent LEI link vs reporting-exception exists.
  // When `relationships` is omitted (e.g. minimal fixtures), default links to true so `/direct-parent` & `/ultimate-parent` are probed.
  const directLinks = rels?.["direct-parent"]?.links;
  const ultimateLinks = rels?.["ultimate-parent"]?.links;
  const hasDirectParentLink = rels
    ? Boolean(directLinks?.["lei-record"] || directLinks?.related)
    : true;
  const hasUltimateParentLink = rels
    ? Boolean(ultimateLinks?.["lei-record"] || ultimateLinks?.related)
    : true;
  const hasParentException = Boolean(
    directLinks?.["reporting-exception"] && !directLinks?.["lei-record"] && !directLinks?.related
  );

  return {
    lei,
    legalName,
    entityStatus:
      typeof entity.status === "string" && entity.status.trim()
        ? entity.status.trim().toUpperCase()
        : "UNKNOWN",
    registrationStatus:
      typeof registration.status === "string" && registration.status.trim()
        ? registration.status.trim().toUpperCase()
        : "UNKNOWN",
    jurisdiction,
    country,
    registeredAs:
      typeof entity.registeredAs === "string" && entity.registeredAs.trim()
        ? entity.registeredAs.trim()
        : null,
    legalAddress,
    headquartersAddress,
    bics,
    hasDirectParentLink,
    hasUltimateParentLink,
    hasParentException,
  };
}

const GLEIF_HEADERS = { Accept: "application/vnd.api+json" };

export async function fetchGleifByLei(
  lei: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ entity: SlimGleifEntity | null; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SlimGleifEntity | null>({
    key: `commerce:gleif:lei:${lei}`,
    ttlMs: TTL_MS.COMMERCE_GLEIF,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<{ data?: unknown }>(
        `https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(lei)}`,
        {
          provider: "GLEIF",
          headers: GLEIF_HEADERS,
          timeoutMs: 5000,
          allow404: true,
          fetchImpl,
        }
      );
      if (res.status === "not_found") return null;
      const parsed = parseGleifNode(res.data?.data);
      if (!parsed) {
        throw new UpstreamError("GLEIF", "GLEIF_BAD_SCHEMA", "Invalid GLEIF LEI record payload");
      }
      return parsed;
    },
  });

  return { entity: value, cacheHit };
}

export async function fetchGleifByFilter(
  filterField: "bic" | "isin" | "legalName",
  filterValue: string,
  countryFilter: string | null = null,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ entity: SlimGleifEntity | null; cacheHit: boolean }> {
  const normKey = `${filterField}:${filterValue.toLowerCase()}:${countryFilter ?? "any"}`;
  const { value, cacheHit } = await withTwoTierCache<SlimGleifEntity | null>({
    key: `commerce:gleif:search:${normKey}`,
    ttlMs: TTL_MS.COMMERCE_GLEIF,
    cache,
    waitUntil,
    fetcher: async () => {
      const runQuery = async (paramName: string, val: string) => {
        const params = new URLSearchParams({
          [paramName]: val,
          "page[size]": "5",
        });
        if (countryFilter) {
          params.set("filter[entity.legalAddress.country]", countryFilter);
        }
        const res = await fetchJsonWithTimeout<{ data?: unknown[] }>(
          `https://api.gleif.org/api/v1/lei-records?${params.toString()}`,
          {
            provider: "GLEIF",
            headers: GLEIF_HEADERS,
            timeoutMs: 5000,
            allow404: true,
            fetchImpl,
          }
        );
        if (res.status === "not_found" || !Array.isArray(res.data?.data)) {
          return [];
        }
        return res.data.data
          .map((item) => parseGleifNode(item))
          .filter((item): item is SlimGleifEntity => item !== null);
      };

      const pickBest = (candidates: SlimGleifEntity[]): SlimGleifEntity | null => {
        if (candidates.length === 0) return null;
        // Prefer ACTIVE + ISSUED records over LAPSED/INACTIVE duplicates
        const sorted = [...candidates].sort((a, b) => {
          const scoreA = (a.entityStatus === "ACTIVE" ? 2 : 0) + (a.registrationStatus === "ISSUED" ? 1 : 0);
          const scoreB = (b.entityStatus === "ACTIVE" ? 2 : 0) + (b.registrationStatus === "ISSUED" ? 1 : 0);
          return scoreB - scoreA;
        });
        return sorted[0] ?? null;
      };

      if (filterField === "bic") {
        const direct = await runQuery("filter[bic]", filterValue);
        const bestDirect = pickBest(direct);
        if (bestDirect) return bestDirect;
        // If an 11-char branch BIC is unmapped in GLEIF, fall back to the 8-char head-office XXX BIC
        if (filterValue.length === 11 && !filterValue.endsWith("XXX")) {
          const headOffice = await runQuery("filter[bic]", `${filterValue.slice(0, 8)}XXX`);
          return pickBest(headOffice);
        }
        return null;
      }

      if (filterField === "isin") {
        const direct = await runQuery("filter[isin]", filterValue);
        return pickBest(direct);
      }

      const byLegalName = await runQuery("filter[entity.legalName]", filterValue);
      const bestLegal = pickBest(byLegalName);
      if (bestLegal) return bestLegal;

      const byFulltext = await runQuery("filter[fulltext]", filterValue);
      return pickBest(byFulltext);
    },
  });

  return { entity: value, cacheHit };
}

export async function fetchGleifParent(
  lei: string,
  relation: "direct-parent" | "ultimate-parent",
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ parent: SlimGleifEntity | null; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SlimGleifEntity | null>({
    key: `commerce:gleif:${relation}:${lei}`,
    ttlMs: TTL_MS.COMMERCE_GLEIF,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<{ data?: unknown }>(
        `https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(lei)}/${relation}`,
        {
          provider: "GLEIF",
          headers: GLEIF_HEADERS,
          timeoutMs: 4500,
          allow404: true,
          fetchImpl,
        }
      );
      if (res.status === "not_found" || !res.data?.data) return null;
      return parseGleifNode(res.data.data);
    },
  });

  return { parent: value, cacheHit };
}
