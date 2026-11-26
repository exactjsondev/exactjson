import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import { roundTo, toFiniteNumber } from "../lib/numbers";
import type { TrendingSolanaPool } from "../types";

const GECKO_TRENDING_URL =
  "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1";
const CACHE_KEY = "geckoterminal:solana:trending";

// Skip wrapped SOL and top stablecoins when surfacing trending Solana tokens
const EXCLUDED_BASE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

interface RawTrendingPool {
  attributes?: {
    address?: unknown;
    name?: unknown;
    pool_created_at?: unknown;
    base_token_price_usd?: unknown;
    fdv_usd?: unknown;
    reserve_in_usd?: unknown;
    volume_usd?: { h24?: unknown };
    price_change_percentage?: { h24?: unknown };
    transactions?: {
      h24?: {
        buys?: unknown;
        sells?: unknown;
        unique_traders?: unknown;
      };
    };
  };
  relationships?: {
    base_token?: { data?: { id?: unknown } };
    dex?: { data?: { id?: unknown } };
  };
}

function roundPriceUsd(value: number, standardDecimals: number = 10): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  if (Math.abs(value) >= 1e-4) {
    return roundTo(value, standardDecimals);
  }
  return Number(value.toPrecision(6));
}

export function parseTrendingSolanaPools(raw: unknown): TrendingSolanaPool[] {
  if (!raw || typeof raw !== "object" || !("data" in raw)) {
    throw new UpstreamError("GECKOTERMINAL", "GECKOTERMINAL_BAD_PAYLOAD", "Missing data array");
  }
  const items = (raw as { data?: unknown }).data;
  if (!Array.isArray(items)) {
    throw new UpstreamError("GECKOTERMINAL", "GECKOTERMINAL_BAD_PAYLOAD", "Invalid data array");
  }

  const seenMints = new Set<string>();
  const pools: TrendingSolanaPool[] = [];

  for (const item of items as RawTrendingPool[]) {
    if (!item || typeof item !== "object") continue;
    const baseTokenId = item.relationships?.base_token?.data?.id;
    if (typeof baseTokenId !== "string" || !baseTokenId.startsWith("solana_")) continue;

    const mint = baseTokenId.slice("solana_".length).trim();
    if (!mint || EXCLUDED_BASE_MINTS.has(mint) || seenMints.has(mint)) continue;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) continue;

    seenMints.add(mint);

    const attrs = item.attributes ?? {};
    const poolName = typeof attrs.name === "string" ? attrs.name.trim() : mint;
    const slashIdx = poolName.indexOf("/");
    const symbol = slashIdx > 0 ? poolName.slice(0, slashIdx).trim() : null;

    const priceRaw = toFiniteNumber(attrs.base_token_price_usd);
    const liqRaw = toFiniteNumber(attrs.reserve_in_usd) ?? 0;
    const volRaw = toFiniteNumber(attrs.volume_usd?.h24) ?? 0;
    const fdvRaw = toFiniteNumber(attrs.fdv_usd);
    const tx24 = attrs.transactions?.h24;

    const buysRaw = toFiniteNumber(tx24?.buys);
    const sellsRaw = toFiniteNumber(tx24?.sells);
    const tradersRaw = toFiniteNumber(tx24?.unique_traders);

    pools.push({
      mint,
      symbol: symbol && symbol.length > 0 ? symbol : null,
      poolName,
      poolAddress: typeof attrs.address === "string" ? attrs.address : null,
      dex: typeof item.relationships?.dex?.data?.id === "string" ? item.relationships.dex.data.id : null,
      priceUsd: priceRaw !== null && priceRaw >= 0 ? roundPriceUsd(priceRaw, 10) : null,
      liquidityUsd: roundTo(Math.max(0, liqRaw), 2),
      volume24hUsd: roundTo(Math.max(0, volRaw), 2),
      fdvUsd: fdvRaw !== null && fdvRaw >= 0 ? roundTo(fdvRaw, 2) : null,
      priceChange24hPct: toFiniteNumber(attrs.price_change_percentage?.h24),
      buys24h: buysRaw !== null && buysRaw >= 0 ? buysRaw : null,
      sells24h: sellsRaw !== null && sellsRaw >= 0 ? sellsRaw : null,
      uniqueTraders24h: tradersRaw !== null && tradersRaw >= 0 ? tradersRaw : null,
      poolCreatedAt: typeof attrs.pool_created_at === "string" ? attrs.pool_created_at : null,
    });
  }

  return pools;
}

export async function fetchTrendingSolanaPools(
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ pools: TrendingSolanaPool[]; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<TrendingSolanaPool[]>({
    key: CACHE_KEY,
    ttlMs: TTL_MS.GECKO_TRENDING,
    cache,
    waitUntil,
    fetcher: async () => {
      const result = await fetchJsonWithTimeout<unknown>(GECKO_TRENDING_URL, {
        provider: "GECKOTERMINAL",
        method: "GET",
        fetchImpl,
      });

      if (result.status !== "ok") {
        throw new UpstreamError("GECKOTERMINAL", "GECKOTERMINAL_EMPTY", "Empty trending pools response");
      }

      return parseTrendingSolanaPools(result.data);
    },
  });

  return { pools: value, cacheHit };
}
