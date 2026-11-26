import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  withTwoTierCache,
} from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import { toFiniteNumber } from "../lib/numbers";
import type {
  HyperliquidAssetEntry,
  HyperliquidBookLevel,
  HyperliquidL2Book,
} from "../types";

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const META_CACHE_KEY = "hyperliquid:metaAndAssetCtxs";
const RETRY_429_DELAYS_MS = [250, 500] as const;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHyperliquidInfo(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  sleepImpl: (ms: number) => Promise<void> = sleepMs
): Promise<unknown> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_429_DELAYS_MS.length; attempt += 1) {
    try {
      const result = await fetchJsonWithTimeout<unknown>(HYPERLIQUID_INFO_URL, {
        provider: "HYPERLIQUID",
        method: "POST",
        body,
        fetchImpl,
      });

      if (result.status !== "ok") {
        throw new UpstreamError("HYPERLIQUID", "HYPERLIQUID_EMPTY", "Empty Hyperliquid response");
      }

      return result.data;
    } catch (err) {
      lastErr = err;
      const isRateLimited = err instanceof UpstreamError && err.httpStatus === 429;
      if (!isRateLimited || attempt >= RETRY_429_DELAYS_MS.length) {
        throw err;
      }
      const baseDelay = RETRY_429_DELAYS_MS[attempt] ?? 250;
      const jitter = Math.floor(Math.random() * 100);
      await sleepImpl(baseDelay + jitter);
    }
  }

  throw lastErr;
}

interface RawUniverseItem {
  name?: unknown;
  szDecimals?: unknown;
  maxLeverage?: unknown;
  isDelisted?: unknown;
}

interface RawAssetCtx {
  funding?: unknown;
  openInterest?: unknown;
  prevDayPx?: unknown;
  dayNtlVlm?: unknown;
  premium?: unknown;
  oraclePx?: unknown;
  markPx?: unknown;
  midPx?: unknown;
}

interface RawL2Level {
  px?: unknown;
  sz?: unknown;
  n?: unknown;
}

interface RawL2BookResponse {
  coin?: unknown;
  time?: unknown;
  levels?: unknown;
}

export function indexMetaAndAssetCtxs(raw: unknown): Map<string, HyperliquidAssetEntry> {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new UpstreamError(
      "HYPERLIQUID",
      "HYPERLIQUID_BAD_PAYLOAD",
      "Unexpected metaAndAssetCtxs payload shape"
    );
  }

  const metaObj = raw[0] as { universe?: unknown } | null;
  const ctxList = raw[1];
  if (!metaObj || !Array.isArray(metaObj.universe) || !Array.isArray(ctxList)) {
    throw new UpstreamError(
      "HYPERLIQUID",
      "HYPERLIQUID_BAD_PAYLOAD",
      "Missing universe or assetCtxs array"
    );
  }

  const map = new Map<string, HyperliquidAssetEntry>();
  const universe = metaObj.universe as RawUniverseItem[];
  const contexts = ctxList as RawAssetCtx[];
  const len = Math.min(universe.length, contexts.length);

  for (let i = 0; i < len; i++) {
    const item = universe[i];
    const ctx = contexts[i];
    if (!item || typeof item.name !== "string" || item.name.length === 0 || item.isDelisted === true || !ctx) {
      continue;
    }

    const entry: HyperliquidAssetEntry = {
      canonicalName: item.name,
      maxLeverage: toFiniteNumber(item.maxLeverage),
      szDecimals: toFiniteNumber(item.szDecimals),
      ctx: {
        funding: toFiniteNumber(ctx.funding),
        openInterest: toFiniteNumber(ctx.openInterest),
        prevDayPx: toFiniteNumber(ctx.prevDayPx),
        dayNtlVlm: toFiniteNumber(ctx.dayNtlVlm),
        premium: toFiniteNumber(ctx.premium),
        oraclePx: toFiniteNumber(ctx.oraclePx),
        markPx: toFiniteNumber(ctx.markPx),
        midPx: toFiniteNumber(ctx.midPx),
      },
    };

    map.set(item.name.toLowerCase(), entry);
  }

  return map;
}

function parseBookSide(rawLevels: unknown): HyperliquidBookLevel[] {
  if (!Array.isArray(rawLevels)) return [];
  const levels: HyperliquidBookLevel[] = [];
  for (const item of rawLevels as RawL2Level[]) {
    if (!item || typeof item !== "object") continue;
    const px = toFiniteNumber(item.px);
    const sz = toFiniteNumber(item.sz);
    const n = toFiniteNumber(item.n) ?? 0;
    if (px !== null && sz !== null && px > 0 && sz > 0) {
      levels.push({ px, sz, n });
    }
  }
  return levels;
}

export function parseL2Book(canonicalCoin: string, raw: unknown): HyperliquidL2Book {
  const obj = (raw !== null && typeof raw === "object" ? raw : {}) as RawL2BookResponse;
  const levels = Array.isArray(obj.levels) ? obj.levels : [];
  return {
    coin: typeof obj.coin === "string" ? obj.coin : canonicalCoin,
    time: toFiniteNumber(obj.time),
    bids: parseBookSide(levels[0]),
    asks: parseBookSide(levels[1]),
  };
}

export async function fetchHyperliquidMetaMap(
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
  sleepImpl: (ms: number) => Promise<void> = sleepMs
): Promise<{ map: Map<string, HyperliquidAssetEntry>; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    Map<string, HyperliquidAssetEntry>,
    Array<[string, HyperliquidAssetEntry]>
  >({
    key: META_CACHE_KEY,
    ttlMs: TTL_MS.HYPERLIQUID_META,
    cache,
    waitUntil,
    serializeEdge: (map) => Array.from(map.entries()),
    deserializeEdge: (raw) => (Array.isArray(raw) ? new Map(raw) : null),
    fetcher: async () => {
      const data = await fetchHyperliquidInfo({ type: "metaAndAssetCtxs" }, fetchImpl, sleepImpl);
      return indexMetaAndAssetCtxs(data);
    },
  });

  return { map: value, cacheHit };
}

export async function fetchHyperliquidL2Book(
  canonicalCoin: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
  sleepImpl: (ms: number) => Promise<void> = sleepMs
): Promise<{ book: HyperliquidL2Book; cacheHit: boolean }> {
  const cacheKey = `hyperliquid:l2book:${canonicalCoin}`;
  const { value, cacheHit } = await withTwoTierCache<HyperliquidL2Book>({
    key: cacheKey,
    ttlMs: TTL_MS.HYPERLIQUID_SNAPSHOT,
    cache,
    waitUntil,
    fetcher: async () => {
      const data = await fetchHyperliquidInfo(
        { type: "l2Book", coin: canonicalCoin },
        fetchImpl,
        sleepImpl
      );
      return parseL2Book(canonicalCoin, data);
    },
  });

  return { book: value, cacheHit };
}
