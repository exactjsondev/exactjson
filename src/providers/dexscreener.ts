import {
  BoundedTtlCache,
  TTL_MS,
  isolateCache,
  readEdgeCache,
  writeEdgeCache,
} from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import type { DexScreenerAggregated, EvmChainConfig } from "../types";

const DEXSCREENER_V1_BASE = "https://api.dexscreener.com/token-pairs/v1";
const DEXSCREENER_LATEST_URL = "https://api.dexscreener.com/latest/dex/tokens";
const GECKOTERMINAL_NETWORKS_BASE = "https://api.geckoterminal.com/api/v2/networks";

const MIN_VALID_EPOCH_MS = 1_000_000_000_000; // 2001-09-09
const MAX_VALID_EPOCH_MS = 4_102_444_800_000; // 2100-01-01

interface RawDexPair {
  chainId?: unknown;
  dexId?: unknown;
  pairAddress?: unknown;
  pairCreatedAt?: unknown;
  baseToken?: {
    address?: unknown;
    name?: unknown;
    symbol?: unknown;
  };
  quoteToken?: {
    address?: unknown;
    name?: unknown;
    symbol?: unknown;
  };
  priceUsd?: unknown;
  volume?: {
    h24?: unknown;
  };
  priceChange?: {
    h24?: unknown;
  };
  liquidity?: {
    usd?: unknown;
  };
  fdv?: unknown;
}

interface RawGeckoPool {
  type?: unknown;
  attributes?: {
    address?: unknown;
    pool_created_at?: unknown;
    reserve_in_usd?: unknown;
    volume_usd?: { h24?: unknown };
    price_change_percentage?: { h24?: unknown };
  };
  relationships?: {
    dex?: { data?: { id?: unknown } };
  };
}

interface RawGeckoTokenResponse {
  data?: {
    attributes?: {
      name?: unknown;
      symbol?: unknown;
      price_usd?: unknown;
      fdv_usd?: unknown;
      volume_usd?: { h24?: unknown };
    };
  };
  included?: unknown;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundPriceUsd(value: number, standardDecimals: number = 8): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  if (Math.abs(value) >= 1e-4) {
    return roundTo(value, standardDecimals);
  }
  return Number(value.toPrecision(6));
}

function toValidEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= MIN_VALID_EPOCH_MS && value <= MAX_VALID_EPOCH_MS ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric >= MIN_VALID_EPOCH_MS && numeric <= MAX_VALID_EPOCH_MS ? numeric : null;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= MIN_VALID_EPOCH_MS && parsed <= MAX_VALID_EPOCH_MS) {
      return parsed;
    }
  }
  return null;
}

function addressMatches(
  candidate: unknown,
  target: string,
  caseInsensitive: boolean
): boolean {
  if (typeof candidate !== "string") return false;
  return caseInsensitive
    ? candidate.toLowerCase() === target.toLowerCase()
    : candidate === target;
}

export function extractRawPairs(raw: unknown): RawDexPair[] {
  if (Array.isArray(raw)) {
    return raw as RawDexPair[];
  }
  if (raw !== null && typeof raw === "object" && "pairs" in raw) {
    const pairs = (raw as { pairs?: unknown }).pairs;
    if (Array.isArray(pairs)) {
      return pairs as RawDexPair[];
    }
  }
  return [];
}

function aggregateDexScreenerPairsForChain(
  tokenAddress: string,
  raw: unknown,
  targetChainId: string,
  caseInsensitive: boolean
): DexScreenerAggregated {
  const allPairs = extractRawPairs(raw);
  const expectedChain = targetChainId.toLowerCase();
  const chainPairs = allPairs.filter((pair) => {
    if (!pair || typeof pair !== "object") return false;
    if (typeof pair.chainId === "string" && pair.chainId.toLowerCase() !== expectedChain) {
      return false;
    }
    return true;
  });

  if (chainPairs.length === 0) {
    return {
      pairCount: 0,
      totalLiquidityUsd: 0,
      volume24hUsd: 0,
      priceUsd: null,
      priceChange24hPct: null,
      fdvUsd: null,
      primaryDex: null,
      primaryPairAddress: null,
      symbol: null,
      name: null,
      earliestPairCreatedAt: null,
    };
  }

  let totalLiquidityUsd = 0;
  let volume24hUsd = 0;
  let bestBasePair: RawDexPair | null = null;
  let bestBaseLiq = -1;
  let bestBaseVol = -1;
  let bestAnyPair: RawDexPair = chainPairs[0]!;
  let bestAnyLiq = -1;
  let bestAnyVol = -1;
  let earliestCreatedMs: number | null = null;

  for (const pair of chainPairs) {
    const liq = toFiniteNumber(pair.liquidity?.usd) ?? 0;
    const vol = toFiniteNumber(pair.volume?.h24) ?? 0;
    if (liq > 0) totalLiquidityUsd += liq;
    if (vol > 0) volume24hUsd += vol;

    const createdMs = toValidEpochMs(pair.pairCreatedAt);
    if (createdMs !== null && (earliestCreatedMs === null || createdMs < earliestCreatedMs)) {
      earliestCreatedMs = createdMs;
    }

    if (liq > bestAnyLiq || (liq === bestAnyLiq && vol > bestAnyVol)) {
      bestAnyLiq = liq;
      bestAnyVol = vol;
      bestAnyPair = pair;
    }

    // Prefer pairs where requested token is baseToken so priceUsd/priceChange/fdv belong to it
    if (addressMatches(pair.baseToken?.address, tokenAddress, caseInsensitive)) {
      if (liq > bestBaseLiq || (liq === bestBaseLiq && vol > bestBaseVol)) {
        bestBaseLiq = liq;
        bestBaseVol = vol;
        bestBasePair = pair;
      }
    }
  }

  const primaryPair = bestBasePair ?? bestAnyPair;
  const tokenIsBase = addressMatches(primaryPair.baseToken?.address, tokenAddress, caseInsensitive);
  const tokenIsQuote = addressMatches(primaryPair.quoteToken?.address, tokenAddress, caseInsensitive);
  const tokenMeta = tokenIsBase
    ? primaryPair.baseToken
    : tokenIsQuote
      ? primaryPair.quoteToken
      : primaryPair.baseToken;

  // DEX Screener priceUsd/priceChange/fdv always reflect baseToken; avoid attributing another token's price
  const safePriceAttrs = tokenIsBase || !tokenIsQuote;
  const rawPriceUsd = safePriceAttrs ? toFiniteNumber(primaryPair.priceUsd) : null;
  const rawFdvUsd = safePriceAttrs ? toFiniteNumber(primaryPair.fdv) : null;

  return {
    pairCount: chainPairs.length,
    totalLiquidityUsd: roundTo(totalLiquidityUsd, 2),
    volume24hUsd: roundTo(volume24hUsd, 2),
    priceUsd: rawPriceUsd !== null && rawPriceUsd >= 0 ? rawPriceUsd : null,
    priceChange24hPct: safePriceAttrs ? toFiniteNumber(primaryPair.priceChange?.h24) : null,
    fdvUsd: rawFdvUsd !== null && rawFdvUsd >= 0 ? rawFdvUsd : null,
    primaryDex: typeof primaryPair.dexId === "string" ? primaryPair.dexId : null,
    primaryPairAddress:
      typeof primaryPair.pairAddress === "string" ? primaryPair.pairAddress : null,
    symbol: typeof tokenMeta?.symbol === "string" ? tokenMeta.symbol : null,
    name: typeof tokenMeta?.name === "string" ? tokenMeta.name : null,
    earliestPairCreatedAt:
      earliestCreatedMs !== null ? new Date(earliestCreatedMs).toISOString() : null,
  };
}

export function aggregateDexScreenerPairs(
  mint: string,
  raw: unknown
): DexScreenerAggregated {
  return aggregateDexScreenerPairsForChain(mint, raw, "solana", false);
}

export function aggregateDexScreenerEvmPairs(
  address: string,
  dexScreenerChainId: string,
  raw: unknown
): DexScreenerAggregated {
  return aggregateDexScreenerPairsForChain(address, raw, dexScreenerChainId, true);
}

export function parseGeckoTerminalToken(raw: unknown): DexScreenerAggregated {
  const payload = (raw !== null && typeof raw === "object" ? raw : {}) as RawGeckoTokenResponse;
  const attrs = payload.data?.attributes;
  const included = Array.isArray(payload.included) ? (payload.included as RawGeckoPool[]) : [];
  const pools = included.filter((item) => item && item.type === "pool");

  let totalLiquidityUsd = 0;
  let poolVolumeSum = 0;
  let primaryPool: RawGeckoPool | null = null;
  let maxReserve = -1;
  let earliestCreatedMs: number | null = null;

  for (const pool of pools) {
    const reserve = toFiniteNumber(pool.attributes?.reserve_in_usd) ?? 0;
    const vol = toFiniteNumber(pool.attributes?.volume_usd?.h24) ?? 0;
    if (reserve > 0) totalLiquidityUsd += reserve;
    if (vol > 0) poolVolumeSum += vol;
    if (reserve > maxReserve) {
      maxReserve = reserve;
      primaryPool = pool;
    }

    const createdMs = toValidEpochMs(pool.attributes?.pool_created_at);
    if (createdMs !== null && (earliestCreatedMs === null || createdMs < earliestCreatedMs)) {
      earliestCreatedMs = createdMs;
    }
  }

  const tokenVol24h = toFiniteNumber(attrs?.volume_usd?.h24);
  const effectiveVol =
    poolVolumeSum > 0
      ? poolVolumeSum
      : tokenVol24h !== null && tokenVol24h >= 0
        ? tokenVol24h
        : 0;
  const priceUsd = toFiniteNumber(attrs?.price_usd);

  return {
    pairCount: pools.length,
    totalLiquidityUsd: roundTo(totalLiquidityUsd, 2),
    volume24hUsd: roundTo(effectiveVol, 2),
    priceUsd: priceUsd !== null && priceUsd >= 0 ? roundPriceUsd(priceUsd, 8) : null,
    priceChange24hPct: toFiniteNumber(primaryPool?.attributes?.price_change_percentage?.h24),
    fdvUsd: (() => {
      const fdv = toFiniteNumber(attrs?.fdv_usd);
      return fdv !== null && fdv >= 0 ? roundTo(fdv, 2) : null;
    })(),
    primaryDex:
      typeof primaryPool?.relationships?.dex?.data?.id === "string"
        ? primaryPool.relationships.dex.data.id
        : null,
    primaryPairAddress:
      typeof primaryPool?.attributes?.address === "string"
        ? primaryPool.attributes.address
        : null,
    symbol: typeof attrs?.symbol === "string" ? attrs.symbol : null,
    name: typeof attrs?.name === "string" ? attrs.name : null,
    earliestPairCreatedAt:
      earliestCreatedMs !== null ? new Date(earliestCreatedMs).toISOString() : null,
  };
}

export interface DexScreenerProviderResult {
  data: DexScreenerAggregated;
  source: "dexscreener" | "geckoterminal";
  cacheHit: boolean;
}

interface CachedMarketEntry {
  data: DexScreenerAggregated;
  source: "dexscreener" | "geckoterminal";
}

function isRateLimitOrBlocked(err: unknown): boolean {
  return (
    err instanceof UpstreamError &&
    (err.httpStatus === 429 || err.httpStatus === 403)
  );
}

function isTransientServerOrTimeout(err: unknown): boolean {
  if (!(err instanceof UpstreamError)) return false;
  return (
    (err.httpStatus !== null && err.httpStatus >= 500) ||
    err.code.endsWith("_TIMEOUT") ||
    err.code.endsWith("_NETWORK_ERROR")
  );
}

async function fetchDexScreenerWithFallback(params: {
  cacheKey: string;
  tokenAddress: string;
  dexScreenerChainId: string;
  geckoTerminalNetwork: string;
  caseInsensitive: boolean;
  cache: BoundedTtlCache;
  fetchImpl: typeof fetch;
  useEdgeCache: boolean;
}): Promise<DexScreenerProviderResult> {
  const {
    cacheKey,
    tokenAddress,
    dexScreenerChainId,
    geckoTerminalNetwork,
    caseInsensitive,
    cache,
    fetchImpl,
    useEdgeCache,
  } = params;

  const cached = cache.get<CachedMarketEntry>(cacheKey);
  if (cached.hit) {
    return {
      data: cached.value.data,
      source: cached.value.source,
      cacheHit: true,
    };
  }

  if (useEdgeCache) {
    const edge = await readEdgeCache<CachedMarketEntry>(cacheKey);
    if (edge.hit) {
      cache.set(cacheKey, edge.value, TTL_MS.DEXSCREENER_PAIRS);
      return {
        data: edge.value.data,
        source: edge.value.source,
        cacheHit: true,
      };
    }
  }

  const encodedAddr = encodeURIComponent(tokenAddress);
  const storeResult = async (entry: CachedMarketEntry): Promise<DexScreenerProviderResult> => {
    cache.set(cacheKey, entry, TTL_MS.DEXSCREENER_PAIRS);
    if (useEdgeCache) {
      await writeEdgeCache(cacheKey, entry, TTL_MS.DEXSCREENER_PAIRS);
    }
    return { data: entry.data, source: entry.source, cacheHit: false };
  };

  const fetchGeckoFallback = async (primaryErr: unknown): Promise<DexScreenerProviderResult> => {
    try {
      const gecko = await fetchJsonWithTimeout<unknown>(
        `${GECKOTERMINAL_NETWORKS_BASE}/${encodeURIComponent(geckoTerminalNetwork)}/tokens/${encodedAddr}?include=top_pools`,
        {
          provider: "GECKOTERMINAL",
          method: "GET",
          allow404: true,
          fetchImpl,
        }
      );
      const aggregated =
        gecko.status === "not_found"
          ? aggregateDexScreenerPairsForChain(
              tokenAddress,
              [],
              dexScreenerChainId,
              caseInsensitive
            )
          : parseGeckoTerminalToken(gecko.data);

      return storeResult({ data: aggregated, source: "geckoterminal" });
    } catch {
      throw primaryErr;
    }
  };

  try {
    const primary = await fetchJsonWithTimeout<unknown>(
      `${DEXSCREENER_V1_BASE}/${encodeURIComponent(dexScreenerChainId)}/${encodedAddr}`,
      {
        provider: "DEXSCREENER",
        method: "GET",
        allow404: true,
        fetchImpl,
      }
    );
    const aggregated =
      primary.status === "not_found"
        ? aggregateDexScreenerPairsForChain(tokenAddress, [], dexScreenerChainId, caseInsensitive)
        : aggregateDexScreenerPairsForChain(
            tokenAddress,
            primary.data,
            dexScreenerChainId,
            caseInsensitive
          );

    return storeResult({ data: aggregated, source: "dexscreener" });
  } catch (primaryErr) {
    if (isRateLimitOrBlocked(primaryErr)) {
      // Fallback 1: DEX Screener /latest/dex/tokens/{addr} (separate rate-limit bucket)
      try {
        const secondary = await fetchJsonWithTimeout<unknown>(
          `${DEXSCREENER_LATEST_URL}/${encodedAddr}`,
          {
            provider: "DEXSCREENER",
            method: "GET",
            allow404: true,
            fetchImpl,
          }
        );
        const aggregated =
          secondary.status === "not_found"
            ? aggregateDexScreenerPairsForChain(tokenAddress, [], dexScreenerChainId, caseInsensitive)
            : aggregateDexScreenerPairsForChain(
                tokenAddress,
                secondary.data,
                dexScreenerChainId,
                caseInsensitive
              );

        return storeResult({ data: aggregated, source: "dexscreener" });
      } catch {
        // Fallback 2: GeckoTerminal keyless token+pools API (resilient on shared CF Workers IPs)
        return fetchGeckoFallback(primaryErr);
      }
    }

    if (isTransientServerOrTimeout(primaryErr)) {
      // DEX Screener 5xx/timeout: skip second DEX Screener host call and fall back directly to GeckoTerminal
      return fetchGeckoFallback(primaryErr);
    }

    throw primaryErr;
  }
}

export async function fetchDexScreenerSolanaPairs(
  mint: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch
): Promise<DexScreenerProviderResult> {
  return fetchDexScreenerWithFallback({
    cacheKey: `dexscreener:solana:${mint}`,
    tokenAddress: mint,
    dexScreenerChainId: "solana",
    geckoTerminalNetwork: "solana",
    caseInsensitive: false,
    cache,
    fetchImpl,
    useEdgeCache: cache === isolateCache,
  });
}

export async function fetchDexScreenerEvmPairs(
  chain: EvmChainConfig,
  address: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch
): Promise<DexScreenerProviderResult> {
  const normalizedAddr = address.toLowerCase();
  return fetchDexScreenerWithFallback({
    cacheKey: `dexscreener:${chain.key}:${normalizedAddr}`,
    tokenAddress: normalizedAddr,
    dexScreenerChainId: chain.dexScreenerId,
    geckoTerminalNetwork: chain.geckoTerminalId,
    caseInsensitive: true,
    cache,
    fetchImpl,
    useEdgeCache: cache === isolateCache,
  });
}
