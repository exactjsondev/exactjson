import { DISCLAIMER } from "../config/catalog";
import type {
  DexScreenerAggregated,
  RugCheckSummary,
  SolanaTrendingItem,
  SolanaTrendingResponse,
  TrendingSolanaPool,
} from "../types";
import { computeSolanaSafety } from "./safetyScoring";

function safeRatio(num: number | null, den: number | null, decimals = 4): number | null {
  if (
    num === null ||
    den === null ||
    !Number.isFinite(num) ||
    !Number.isFinite(den) ||
    den <= 0 ||
    num < 0
  ) {
    return null;
  }
  const factor = 10 ** decimals;
  const rounded = Math.round((num / den) * factor) / factor;
  return Number.isFinite(rounded) ? rounded : null;
}

export interface SolanaTrendingOptions {
  limit: number;
  maxRiskScore: number | null;
}

export function computeSolanaTrending(
  pools: readonly TrendingSolanaPool[],
  rugByMint: ReadonlyMap<string, RugCheckSummary | null>,
  options: SolanaTrendingOptions,
  fetchedAtIso: string = new Date().toISOString()
): SolanaTrendingResponse {
  const limit = Math.min(8, Math.max(1, Math.floor(options.limit)));
  const maxRisk =
    options.maxRiskScore !== null && Number.isFinite(options.maxRiskScore)
      ? Math.min(100, Math.max(0, Math.round(options.maxRiskScore)))
      : null;

  const scored: SolanaTrendingItem[] = [];

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i]!;
    const rug = rugByMint.get(pool.mint) ?? null;

    const volToLiq = safeRatio(pool.volume24hUsd, pool.liquidityUsd, 4);
    const buySellRatio = safeRatio(pool.buys24h, pool.sells24h, 4);

    if (rug) {
      const dexEquivalent: DexScreenerAggregated = {
        pairCount: 1,
        totalLiquidityUsd: pool.liquidityUsd,
        volume24hUsd: pool.volume24hUsd,
        priceUsd: pool.priceUsd,
        priceChange24hPct: pool.priceChange24hPct,
        fdvUsd: pool.fdvUsd,
        primaryDex: pool.dex,
        primaryPairAddress: pool.poolAddress,
        symbol: pool.symbol,
        name: pool.poolName,
      };
      const safetyResult = computeSolanaSafety(
        pool.mint,
        rug,
        dexEquivalent,
        fetchedAtIso,
        "geckoterminal"
      );

      if (maxRisk !== null && safetyResult.risk_score > maxRisk) {
        continue;
      }

      scored.push({
        rank: i + 1,
        mint: pool.mint,
        symbol: pool.symbol,
        pool_name: pool.poolName,
        dex: pool.dex,
        pool_address: pool.poolAddress,
        pool_created_at: pool.poolCreatedAt,
        safety: {
          verified: true,
          risk_score: safetyResult.risk_score,
          risk_tier: safetyResult.risk_tier,
          flags: safetyResult.flags,
          lp_locked_pct: safetyResult.security.lp_locked_pct,
          mint_authority_flagged: safetyResult.security.mint_authority_flagged,
          freeze_authority_flagged: safetyResult.security.freeze_authority_flagged,
          mutable_metadata_flagged: safetyResult.security.mutable_metadata_flagged,
          danger_count: safetyResult.security.danger_count,
          warn_count: safetyResult.security.warn_count,
        },
        market: {
          price_usd: pool.priceUsd,
          liquidity_usd: pool.liquidityUsd,
          volume_24h_usd: pool.volume24hUsd,
          volume_to_liquidity_ratio: volToLiq,
          fdv_usd: pool.fdvUsd,
          price_change_24h_pct: pool.priceChange24hPct,
          buys_24h: pool.buys24h,
          sells_24h: pool.sells24h,
          buy_sell_ratio_24h: buySellRatio,
          unique_traders_24h: pool.uniqueTraders24h,
        },
      });
    } else {
      // NEVER treat missing RugCheck data as safe! Exclude when max_risk_score filter is active.
      if (maxRisk !== null) {
        continue;
      }
      scored.push({
        rank: i + 1,
        mint: pool.mint,
        symbol: pool.symbol,
        pool_name: pool.poolName,
        dex: pool.dex,
        pool_address: pool.poolAddress,
        pool_created_at: pool.poolCreatedAt,
        safety: {
          verified: false,
          risk_score: null,
          risk_tier: "UNVERIFIED",
          flags: ["RUGCHECK_UNAVAILABLE"],
          lp_locked_pct: null,
          mint_authority_flagged: null,
          freeze_authority_flagged: null,
          mutable_metadata_flagged: null,
          danger_count: null,
          warn_count: null,
        },
        market: {
          price_usd: pool.priceUsd,
          liquidity_usd: pool.liquidityUsd,
          volume_24h_usd: pool.volume24hUsd,
          volume_to_liquidity_ratio: volToLiq,
          fdv_usd: pool.fdvUsd,
          price_change_24h_pct: pool.priceChange24hPct,
          buys_24h: pool.buys24h,
          sells_24h: pool.sells24h,
          buy_sell_ratio_24h: buySellRatio,
          unique_traders_24h: pool.uniqueTraders24h,
        },
      });
    }

    if (scored.length >= limit) break;
  }

  return {
    filters: {
      limit,
      max_risk_score: maxRisk,
    },
    scanned_count: pools.length,
    returned_count: scored.length,
    tokens: scored,
    metadata: {
      fetched_at: fetchedAtIso,
      sources: ["geckoterminal", "rugcheck"],
      disclaimer: DISCLAIMER,
    },
  };
}
