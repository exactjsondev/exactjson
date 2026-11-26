import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";
import type { VenuePerpMarket } from "../../../types";
import { normalizeBaseAsset } from "./dydx";

const KRAKEN_TICKERS_URL = "https://futures.kraken.com/derivatives/api/v3/tickers";
const CACHE_KEY = "kraken:perpetualTickers";

interface RawKrakenTicker {
  symbol?: unknown;
  tag?: unknown;
  pair?: unknown;
  markPrice?: unknown;
  volumeQuote?: unknown;
  openInterest?: unknown;
  relativeFundingRate?: unknown;
  suspended?: unknown;
}

export function parseKrakenPerpTickers(raw: unknown): Map<string, VenuePerpMarket> {
  if (!raw || typeof raw !== "object" || !("tickers" in raw)) {
    throw new UpstreamError("KRAKEN", "KRAKEN_BAD_PAYLOAD", "Missing tickers array");
  }
  const tickers = (raw as { tickers?: unknown }).tickers;
  if (!Array.isArray(tickers)) {
    throw new UpstreamError("KRAKEN", "KRAKEN_BAD_PAYLOAD", "Invalid tickers array");
  }

  const map = new Map<string, VenuePerpMarket>();

  for (const item of tickers as RawKrakenTicker[]) {
    if (!item || typeof item !== "object") continue;
    if (item.tag !== "perpetual" || item.suspended === true) continue;
    if (typeof item.symbol !== "string" || !item.symbol.startsWith("PF_")) continue;
    if (typeof item.pair !== "string" || !item.pair.toUpperCase().endsWith(":USD")) continue;

    const rawBase = item.pair.slice(0, -4);
    if (!rawBase || !/^[A-Za-z0-9]+$/.test(rawBase)) continue;

    const { asset, scaledUnit } = normalizeBaseAsset(rawBase);
    const markPx = toFiniteNumber(item.markPrice);
    const oiBase = toFiniteNumber(item.openInterest);
    const oiUsd =
      markPx !== null && oiBase !== null && markPx > 0 && oiBase >= 0
        ? Math.round(markPx * oiBase * 100) / 100
        : null;
    const volUsd = toFiniteNumber(item.volumeQuote);
    // Kraken Futures PF_ linear perps expose hourly fractional rate in `relativeFundingRate`
    const hourlyFunding = toFiniteNumber(item.relativeFundingRate);

    const candidate: VenuePerpMarket = {
      venue: "kraken",
      symbol: item.symbol,
      baseAsset: asset,
      scaledUnit,
      markPrice: markPx,
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

export async function fetchKrakenPerpsMap(
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ map: Map<string, VenuePerpMarket>; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    Map<string, VenuePerpMarket>,
    Array<[string, VenuePerpMarket]>
  >({
    key: CACHE_KEY,
    ttlMs: TTL_MS.KRAKEN_TICKERS,
    cache,
    waitUntil,
    serializeEdge: (map) => Array.from(map.entries()),
    deserializeEdge: (raw) => (Array.isArray(raw) ? new Map(raw) : null),
    fetcher: async () => {
      const result = await fetchJsonWithTimeout<unknown>(KRAKEN_TICKERS_URL, {
        provider: "KRAKEN",
        method: "GET",
        fetchImpl,
      });

      if (result.status !== "ok") {
        throw new UpstreamError("KRAKEN", "KRAKEN_EMPTY", "Empty Kraken Futures response");
      }

      return parseKrakenPerpTickers(result.data);
    },
  });

  return { map: value, cacheHit };
}
