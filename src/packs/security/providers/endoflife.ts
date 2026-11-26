import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";

export interface EolReleaseCycle {
  name: string;
  label: string | null;
  releaseDate: string | null;
  isLts: boolean;
  ltsFrom: string | null;
  isEoas: boolean | null;
  eoasFrom: string | null;
  isEol: boolean;
  eolFrom: string | null;
  isMaintained: boolean;
  latestName: string | null;
  latestDate: string | null;
}

export interface EolProductData {
  name: string;
  label: string | null;
  category: string | null;
  releases: EolReleaseCycle[];
}

interface RawEolResponse {
  result?: {
    name?: unknown;
    label?: unknown;
    category?: unknown;
    releases?: Array<Record<string, unknown>>;
  };
}

export function parseEolProduct(raw: unknown, fallbackName: string): EolProductData {
  const obj = raw as RawEolResponse | null;
  const res = obj?.result;
  if (!res || typeof res !== "object" || !Array.isArray(res.releases)) {
    throw new UpstreamError(
      "ENDOFLIFE",
      "ENDOFLIFE_BAD_SCHEMA",
      "endoflife.date returned unexpected product payload"
    );
  }

  const releases: EolReleaseCycle[] = [];
  for (const r of res.releases) {
    if (!r || typeof r !== "object" || typeof r.name !== "string") continue;
    const latest = r.latest && typeof r.latest === "object" ? (r.latest as Record<string, unknown>) : null;
    releases.push({
      name: r.name,
      label: typeof r.label === "string" ? r.label : null,
      releaseDate: typeof r.releaseDate === "string" ? r.releaseDate : null,
      isLts: r.isLts === true,
      ltsFrom: typeof r.ltsFrom === "string" ? r.ltsFrom : null,
      isEoas: typeof r.isEoas === "boolean" ? r.isEoas : null,
      eoasFrom: typeof r.eoasFrom === "string" ? r.eoasFrom : null,
      isEol: r.isEol === true,
      eolFrom: typeof r.eolFrom === "string" ? r.eolFrom : null,
      isMaintained: r.isMaintained === true,
      latestName: typeof latest?.name === "string" ? latest.name : null,
      latestDate: typeof latest?.date === "string" ? latest.date : null,
    });
  }

  return {
    name: typeof res.name === "string" ? res.name : fallbackName,
    label: typeof res.label === "string" ? res.label : null,
    category: typeof res.category === "string" ? res.category : null,
    releases,
  };
}

export async function fetchEolProduct(
  product: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ status: "not_found"; cacheHit: boolean } | { status: "ok"; data: EolProductData; cacheHit: boolean }> {
  const cacheKey = `eol:product:${product}`;
  const { value, cacheHit } = await withTwoTierCache<
    { status: "not_found" } | { status: "ok"; data: EolProductData }
  >({
    key: cacheKey,
    ttlMs: TTL_MS.OSS_RUNTIME_EOL,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    fetcher: async () => {
      const url = `https://endoflife.date/api/v1/products/${encodeURIComponent(product)}/`;
      const res = await fetchJsonWithTimeout<unknown>(url, {
        provider: "ENDOFLIFE",
        allow404: true,
        fetchImpl,
      });
      if (res.status === "not_found") {
        return { status: "not_found" };
      }
      return { status: "ok", data: parseEolProduct(res.data, product) };
    },
  });

  if (value.status === "not_found") {
    return { status: "not_found", cacheHit };
  }
  return { status: "ok", data: value.data, cacheHit };
}
