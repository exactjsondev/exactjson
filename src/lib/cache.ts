export const CACHE_MAX_ENTRIES = 1000;
export const REFERENCE_CACHE_MAX_ENTRIES = 64;

export const TTL_MS = {
  RUGCHECK_SUMMARY: 60_000,
  GOPLUS_SECURITY: 60_000,
  HONEYPOT_IS: 60_000,
  DEXSCREENER_PAIRS: 20_000,
  KYBERSWAP_QUOTE: 15_000,
  GECKO_TRENDING: 30_000,
  HYPERLIQUID_META: 10_000,
  HYPERLIQUID_SNAPSHOT: 10_000,
  DYDX_MARKETS: 30_000,
  KRAKEN_TICKERS: 30_000,
  POLYMARKET_MARKETS: 30_000,
  KALSHI_MARKETS: 30_000,
  DERIBIT_OPTIONS: 30_000,
  MACRO_TREASURY: 1_800_000, // 30 min (daily official US Treasury release)
  MACRO_NYFED: 1_800_000, // 30 min (daily official NY Fed release)
  PAUSE_STATE: 60_000, // 60s (immediately invalidated on Start/Stop toggle)
  DASHBOARD_OVERVIEW: 60_000, // 60s overview aggregate cache to protect D1 free-tier read quota
  DASHBOARD_REQUESTS: 60_000, // 60s recent requests cache to protect D1 free-tier read quota
  OSS_PACKAGE_AUDIT: 600_000, // 10 min
  OSS_RUNTIME_EOL: 43_200_000, // 12 hr
  SEC_CVE_DETAIL: 1_800_000, // 30 min
  SEC_CISA_KEV: 43_200_000, // 12 hr
  NET_DOMAIN_DOH: 300_000, // 5 min
  NET_RDAP_BOOTSTRAP: 86_400_000, // 24 hr
  NET_RDAP_DOMAIN: 3_600_000, // 1 hr
  OPS_CLOUD_STATUS: 60_000, // 60s
  AI_MODEL_AUDIT: 3_600_000, // 1 hr
  NET_CENSORSHIP_OONI: 1_800_000, // 30 min
  AVIATION_METAR: 120_000, // 2 min
  AVIATION_TAF: 600_000, // 10 min
  AVIATION_SIGMET: 300_000, // 5 min
  AVIATION_FAA_NAS: 120_000, // 2 min
  SPACE_SWPC: 300_000, // 5 min
  SPACE_CELESTRAK: 21_600_000, // 6 hr
  WORLD_GDACS: 900_000, // 15 min
  GEO_USGS_QUAKE: 600_000, // 10 min
  GEO_NASA_EONET: 900_000, // 15 min
  WORLD_MET_NORWAY: 1_800_000, // 30 min
  GEO_CENSUS_GEOCODE: 86_400_000, // 24 hr
  GEO_EPA_TRI: 86_400_000, // 24 hr
  TRAVEL_FCDO: 3_600_000, // 1 hr
  TRAVEL_HOLIDAYS: 43_200_000, // 12 hr
  SOLAR_NASA_POWER: 86_400_000, // 24 hr
  COMMERCE_HOLIDAYS_YEAR: 86_400_000, // 24 hr
  COMMERCE_FRANKFURTER_FX: 1_800_000, // 30 min
  COMMERCE_WORLDBANK: 86_400_000, // 24 hr
  COMMERCE_EU_VIES: 3_600_000, // 1 hr
  COMMERCE_GLEIF: 21_600_000, // 6 hr
  COMMERCE_WIKIDATA: 43_200_000, // 12 hr
  COMMERCE_SEC_SUBMISSIONS: 21_600_000, // 6 hr
  COMMERCE_USASPENDING: 21_600_000, // 6 hr
  COMMERCE_CPSC_RECALLS: 21_600_000, // 6 hr
  COMMERCE_OPENFDA_RECALLS: 21_600_000, // 6 hr (protects keyless 1,000 req/day IP cap)
  SCIENCE_CITATION_DOI: 86_400_000, // 24 hr
  SCIENCE_CITATION_QUERY: 21_600_000, // 6 hr
  CHEM_PUBCHEM: 86_400_000, // 24 hr (protects PubChem 5 req/s cap)
  BIO_CLINICAL_TRIALS: 21_600_000, // 6 hr
  BIO_RXNAV: 86_400_000, // 24 hr
  MACRO_GLOBAL_RATES: 21_600_000, // 6 hr (BIS WS_CBPOL, ECB SDMX, BoC Valet)
} as const;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedTtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = CACHE_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get<T>(key: string, now: number = Date.now()): { hit: true; value: T } | { hit: false } {
    const entry = this.store.get(key);
    if (!entry) {
      return { hit: false };
    }
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value as T };
  }

  set<T>(key: string, value: T, ttlMs: number, now: number = Date.now()): void {
    if (ttlMs <= 0) {
      this.store.delete(key);
      return;
    }

    // Refresh insertion order if updating an existing key
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      this.prune(now);
    }

    this.store.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private prune(now: number): void {
    // 1. Remove all expired entries first
    for (const [k, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(k);
      }
    }

    // 2. If still at or above capacity, evict oldest entries (Map insertion order)
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }
}

export const isolateCache = new BoundedTtlCache(CACHE_MAX_ENTRIES);
export const referenceCache = new BoundedTtlCache(REFERENCE_CACHE_MAX_ENTRIES);

// Must use an active Cloudflare zone hostname so caches.default persists entries in production PoPs
const EDGE_CACHE_ORIGIN = "https://exactjson.com/__edge_cache";

function getDefaultEdgeCache(): Cache | null {
  try {
    const cacheStorage = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return cacheStorage?.default ?? null;
  } catch {
    return null;
  }
}

function buildEdgeCacheKey(key: string): Request {
  return new Request(`${EDGE_CACHE_ORIGIN}/${encodeURIComponent(key)}`, { method: "GET" });
}

/**
 * Best-effort Cloudflare Edge Cache (caches.default) read.
 * Automatically activates across requests in the same PoP when a custom domain is attached,
 * and safely returns miss on *.workers.dev, local dev, and Node test runtimes.
 */
export async function readEdgeCache<T>(key: string): Promise<{ hit: true; value: T } | { hit: false }> {
  const edgeCache = getDefaultEdgeCache();
  if (!edgeCache) return { hit: false };
  try {
    const res = await edgeCache.match(buildEdgeCacheKey(key));
    if (!res) return { hit: false };
    const parsed = (await res.json()) as T;
    return { hit: true, value: parsed };
  } catch {
    return { hit: false };
  }
}

/**
 * Best-effort Cloudflare Edge Cache write (never throws).
 */
export async function writeEdgeCache<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const edgeCache = getDefaultEdgeCache();
  const ttlSec = Math.floor(ttlMs / 1000);
  if (!edgeCache || ttlSec <= 0) return;
  try {
    const response = new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttlSec}`,
      },
    });
    await edgeCache.put(buildEdgeCacheKey(key), response);
  } catch {
    // Non-fatal: in-isolate cache still protects the Worker
  }
}

export interface TwoTierCacheResult<T> {
  value: T;
  cacheHit: boolean;
}

export interface WithTwoTierCacheOptions<T, E = T> {
  key: string;
  ttlMs: number;
  cache?: BoundedTtlCache;
  useEdgeCache?: boolean;
  waitUntil?: (promise: Promise<unknown>) => void;
  shouldCache?: (value: T) => boolean;
  serializeEdge?: (value: T) => E;
  deserializeEdge?: (raw: E) => T | null;
  readEdge?: (key: string) => Promise<{ hit: true; value: E } | { hit: false }>;
  writeEdge?: (key: string, value: E, ttlMs: number) => Promise<void>;
  fetcher: () => Promise<T>;
}

const inFlightByCache = new WeakMap<BoundedTtlCache, Map<string, Promise<TwoTierCacheResult<unknown>>>>();

function getInFlightMap(cache: BoundedTtlCache): Map<string, Promise<TwoTierCacheResult<unknown>>> {
  let map = inFlightByCache.get(cache);
  if (!map) {
    map = new Map();
    inFlightByCache.set(cache, map);
  }
  return map;
}

/**
 * Unified 2-tier cache (in-isolate BoundedTtlCache + Cloudflare Edge caches.default)
 * with per-isolate singleflight coalescing and optional non-blocking waitUntil edge writes.
 */
export async function withTwoTierCache<T, E = T>(
  options: WithTwoTierCacheOptions<T, E>
): Promise<TwoTierCacheResult<T>> {
  const {
    key,
    ttlMs,
    cache = isolateCache,
    useEdgeCache = cache === isolateCache || cache === referenceCache,
    waitUntil,
    shouldCache,
    serializeEdge,
    deserializeEdge,
    readEdge = readEdgeCache,
    writeEdge = writeEdgeCache,
    fetcher,
  } = options;

  const cached = cache.get<T>(key);
  if (cached.hit) {
    return { value: cached.value, cacheHit: true };
  }

  const inFlightMap = getInFlightMap(cache);
  const existingFlight = inFlightMap.get(key);
  if (existingFlight) {
    return existingFlight as Promise<TwoTierCacheResult<T>>;
  }

  const flight = (async (): Promise<TwoTierCacheResult<T>> => {
    if (useEdgeCache) {
      const edge = await readEdge(key);
      if (edge.hit) {
        const value = deserializeEdge
          ? deserializeEdge(edge.value)
          : (edge.value as unknown as T);
        if (value !== null) {
          cache.set(key, value, ttlMs);
          return { value, cacheHit: true };
        }
      }
    }

    const value = await fetcher();
    const cacheable = shouldCache ? shouldCache(value) : true;
    if (cacheable) {
      cache.set(key, value, ttlMs);
      if (useEdgeCache) {
        const edgePayload = serializeEdge ? serializeEdge(value) : (value as unknown as E);
        const writePromise = writeEdge(key, edgePayload, ttlMs);
        if (waitUntil) {
          waitUntil(writePromise);
        } else {
          await writePromise;
        }
      }
    }

    return { value, cacheHit: false };
  })();

  inFlightMap.set(key, flight as Promise<TwoTierCacheResult<unknown>>);
  try {
    return await flight;
  } finally {
    if (inFlightMap.get(key) === flight) {
      inFlightMap.delete(key);
    }
  }
}
