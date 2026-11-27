import type { Context } from "hono";
import { type BoundedTtlCache, TTL_MS, isolateCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { parsePerpCoin } from "../../../lib/validation";
import {
  fetchHyperliquidL2Book,
  fetchHyperliquidMetaMap,
} from "../providers/hyperliquid";
import { createWaitUntil } from "../../../middleware/telemetry";
import { computePerpsSnapshot } from "../services/perpMetrics";
import type { AppBindings, CacheStatus, PerpsSnapshotResponse } from "../../../types";

export interface PerpsSnapshotDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export function createPerpsSnapshotHandler(deps: PerpsSnapshotDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const metaCache = deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleepImpl = deps.sleepImpl;

  return async (c: Context<AppBindings>) => {
    const parsedCoin = parsePerpCoin(c.req.query("coin"));
    if (!parsedCoin.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_COIN");
      return c.json(
        {
          error: "INVALID_COIN",
          message: parsedCoin.error,
        },
        400
      );
    }

    const { lookupKey, stripped } = parsedCoin.value;
    c.set("query_target", stripped);
    c.set("upstream_source", "hyperliquid");

    const snapshotCacheKey = `hyperliquid:snapshot:${lookupKey}`;
    const cachedSnapshot = cache.get<PerpsSnapshotResponse>(snapshotCacheKey);
    if (cachedSnapshot.hit) {
      c.set("query_target", cachedSnapshot.value.coin);
      c.set("cache_status", "HIT");
      return c.json(cachedSnapshot.value, 200);
    }

    const waitUntil = createWaitUntil(c);
    try {
      const { map, cacheHit: metaHit } = await fetchHyperliquidMetaMap(
        metaCache,
        fetchImpl,
        waitUntil,
        sleepImpl
      );
      const entry = map.get(lookupKey);

      if (!entry) {
        c.set("cache_status", metaHit ? "HIT" : "MISS");
        c.set("upstream_error", "COIN_NOT_FOUND");
        return c.json(
          {
            error: "COIN_NOT_FOUND",
            message: `Perpetual market '${stripped}' was not found on Hyperliquid. Payment was not settled.`,
          },
          404
        );
      }

      c.set("query_target", entry.canonicalName);

      const { book, cacheHit: bookHit } = await fetchHyperliquidL2Book(
        entry.canonicalName,
        cache,
        fetchImpl,
        waitUntil,
        sleepImpl
      );

      const cacheStatus: CacheStatus =
        metaHit && bookHit ? "HIT" : metaHit || bookHit ? "PARTIAL" : "MISS";
      c.set("cache_status", cacheStatus);

      const snapshot = computePerpsSnapshot(entry, book);
      cache.set(snapshotCacheKey, snapshot, TTL_MS.HYPERLIQUID_SNAPSHOT);

      return c.json(snapshot, 200);
    } catch (err) {
      const code =
        err instanceof UpstreamError ? err.code : "HYPERLIQUID_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "Hyperliquid market data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const perpsSnapshotHandler = createPerpsSnapshotHandler();
