import { type BoundedTtlCache, TTL_MS, referenceCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";
import type { VenuePerpMarket } from "../../../types";

const DYDX_MARKETS_URL = "https://indexer.dydx.trade/v4/perpetualMarkets";
const CACHE_KEY = "dydx:perpetualMarkets";

interface RawDydxMarket {
  ticker?: unknown;
  status?: unknown;
  oraclePrice?: unknown;
  volume24H?: unknown;
  nextFundingRate?: unknown;
  openInterest?: unknown;
}

export function normalizeBaseAsset(rawBase: string): { asset: string; scaledUnit: boolean } {
  const trimmed = rawBase.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "XBT") return { asset: "BTC", scaledUnit: false };

  // Handle Hyperliquid k-prefixed (kPEPE, kSHIB, kBONK) and 1000-prefixed (1000PEPE) contracts
  if (/^1000[A-Z0-9]+$/.test(upper)) {
    return { asset: upper.slice(4), scaledUnit: true };
  }
  if (/^k[A-Z0-9]{2,}$/.test(trimmed)) {
    return { asset: trimmed.slice(1).toUpperCase(), scaledUnit: true };
  }
  return { asset: upper, scaledUnit: false };
}

export function parseDydxMarkets(raw: unknown): Map<string, VenuePerpMarket> {
  if (!raw || typeof raw !== "object" || !("markets" in raw)) {
    throw new UpstreamError("DYDX", "DYDX_BAD_PAYLOAD", "Missing markets object");
  }
  const marketsObj = (raw as { markets?: unknown }).markets;
  if (!marketsObj || typeof marketsObj !== "object") {
    throw new UpstreamError("DYDX", "DYDX_BAD_PAYLOAD", "Invalid markets map");
  }

  const map = new Map<string, VenuePerpMarket>();

  for (const [tickerKey, entry] of Object.entries(marketsObj as Record<string, RawDydxMarket>)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.status !== "ACTIVE") continue;

    const ticker = typeof entry.ticker === "string" ? entry.ticker : tickerKey;
    if (!ticker.toUpperCase().endsWith("-USD")) continue;

    const rawBase = ticker.slice(0, -4);
    if (!rawBase || !/^[A-Za-z0-9]+$/.test(rawBase)) continue;

    const { asset, scaledUnit } = normalizeBaseAsset(rawBase);
    const oraclePx = toFiniteNumber(entry.oraclePrice);
    const oiBase = toFiniteNumber(entry.openInterest);
    const oiUsd =
      oraclePx !== null && oiBase !== null && oraclePx > 0 && oiBase >= 0
        ? Math.round(oraclePx * oiBase * 100) / 100
        : null;
    const volUsd = toFiniteNumber(entry.volume24H);
    const hourlyFunding = toFiniteNumber(entry.nextFundingRate);

    const candidate: VenuePerpMarket = {
      venue: "dydx",
      symbol: ticker,
      baseAsset: asset,
      scaledUnit,
      markPrice: oraclePx,
      hourlyFundingRate: hourlyFunding,
      openInterestUsd: oiUsd,
      volume24hUsd: volUsd !== null ? Math.round(volUsd * 100) / 100 : null,
    };

    const key = asset.toLowerCase();
    const existing = map.get(key);
    if (!existing || (candidate.openInterestUsd ?? 0) > (existing.openInterestUsd ?? 0)) {
      map.set(key, candidate);
    }
  }

  return map;
}

export async function fetchDydxMarketsMap(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ map: Map<string, VenuePerpMarket>; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    Map<string, VenuePerpMarket>,
    Array<[string, VenuePerpMarket]>
  >({
    key: CACHE_KEY,
    ttlMs: TTL_MS.DYDX_MARKETS,
    cache,
    waitUntil,
    serializeEdge: (map) => Array.from(map.entries()),
    deserializeEdge: (raw) => (Array.isArray(raw) ? new Map(raw) : null),
    fetcher: async () => {
      const result = await fetchJsonWithTimeout<unknown>(DYDX_MARKETS_URL, {
        provider: "DYDX",
        method: "GET",
        fetchImpl,
      });

      if (result.status !== "ok") {
        throw new UpstreamError("DYDX", "DYDX_EMPTY", "Empty dYdX markets response");
      }

      return parseDydxMarkets(result.data);
    },
  });

  return { map: value, cacheHit };
}
