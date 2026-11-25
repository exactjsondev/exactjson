export const CACHE_MAX_ENTRIES = 500;

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
