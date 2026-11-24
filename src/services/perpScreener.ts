import { DISCLAIMER } from "../config/catalog";
import type {
  HyperliquidAssetEntry,
  PerpsScreenerResponse,
  ScreenerMarketItem,
} from "../types";
import { classifyFundingRegime } from "./perpMetrics";

const HOURS_PER_YEAR = 24 * 365;

function roundTo(value: number, decimals: number): number | null {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Number.isFinite(rounded) ? rounded : null;
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return roundTo(sorted[mid]!, 4);
  }
  return roundTo((sorted[mid - 1]! + sorted[mid]!) / 2, 4);
}

export interface PerpsScreenerOptions {
  minOiUsd: number;
  limit: number;
}

export function computePerpsScreener(
  metaMap: Map<string, HyperliquidAssetEntry>,
  options: PerpsScreenerOptions,
  fetchedAtIso: string = new Date().toISOString()
): PerpsScreenerResponse {
  const minOiUsd = Math.max(0, options.minOiUsd);
  const limit = Math.min(25, Math.max(1, Math.floor(options.limit)));

  let totalOiUsd = 0;
  let totalVolUsd = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  const allAnnualizedFunding: number[] = [];
  const qualifying: ScreenerMarketItem[] = [];

  for (const entry of metaMap.values()) {
    const { ctx } = entry;
    const oiUsd =
      ctx.openInterest !== null && ctx.markPx !== null && ctx.markPx > 0
        ? roundTo(ctx.openInterest * ctx.markPx, 2)
        : null;
    const volUsd = ctx.dayNtlVlm !== null ? roundTo(ctx.dayNtlVlm, 2) : null;

    if (oiUsd !== null && oiUsd > 0) totalOiUsd += oiUsd;
    if (volUsd !== null && volUsd > 0) totalVolUsd += volUsd;

    const fundingAnnualized =
      ctx.funding !== null ? roundTo(ctx.funding * HOURS_PER_YEAR * 100, 4) : null;
    const regime = classifyFundingRegime(ctx.funding);
    if (regime === "POSITIVE") positiveCount += 1;
    else if (regime === "NEGATIVE") negativeCount += 1;
    else neutralCount += 1;

    if (fundingAnnualized !== null) {
      allAnnualizedFunding.push(fundingAnnualized);
    }

    if ((oiUsd ?? 0) < minOiUsd) continue;

    const basisRaw =
      ctx.markPx !== null && ctx.oraclePx !== null && ctx.oraclePx > 0
        ? safeDivide(ctx.markPx - ctx.oraclePx, ctx.oraclePx)
        : null;
    const basisBps = basisRaw !== null ? roundTo(basisRaw * 10_000, 4) : null;

    const priceChangeRaw =
      ctx.markPx !== null && ctx.prevDayPx !== null && ctx.prevDayPx > 0
        ? safeDivide(ctx.markPx - ctx.prevDayPx, ctx.prevDayPx)
        : null;
    const priceChange24h = priceChangeRaw !== null ? roundTo(priceChangeRaw * 100, 4) : null;

    const turnoverRaw =
      volUsd !== null && oiUsd !== null && oiUsd > 0 ? safeDivide(volUsd, oiUsd) : null;
    const turnover = turnoverRaw !== null ? roundTo(turnoverRaw, 4) : null;

    qualifying.push({
      coin: entry.canonicalName,
      mark_price: ctx.markPx,
      oracle_price: ctx.oraclePx,
      mark_oracle_basis_bps: basisBps,
      funding_hourly_rate: ctx.funding,
      funding_annualized_pct: fundingAnnualized,
      funding_regime: regime,
      open_interest_usd: oiUsd,
      volume_24h_usd: volUsd,
      volume_to_oi_ratio: turnover,
      price_change_24h_pct: priceChange24h,
      max_leverage: entry.maxLeverage !== null ? Math.round(entry.maxLeverage) : null,
    });
  }

  const withFunding = qualifying.filter((m) => m.funding_annualized_pct !== null);
  const highestFunding = [...withFunding]
    .sort((a, b) => (b.funding_annualized_pct ?? 0) - (a.funding_annualized_pct ?? 0))
    .slice(0, limit);

  const lowestFunding = [...withFunding]
    .sort((a, b) => (a.funding_annualized_pct ?? 0) - (b.funding_annualized_pct ?? 0))
    .slice(0, limit);

  const widestBasis = qualifying
    .filter((m) => m.mark_oracle_basis_bps !== null)
    .sort(
      (a, b) =>
        Math.abs(b.mark_oracle_basis_bps ?? 0) - Math.abs(a.mark_oracle_basis_bps ?? 0)
    )
    .slice(0, limit);

  const highestTurnover = qualifying
    .filter((m) => m.volume_to_oi_ratio !== null)
    .sort((a, b) => (b.volume_to_oi_ratio ?? 0) - (a.volume_to_oi_ratio ?? 0))
    .slice(0, limit);

  return {
    venue: "hyperliquid",
    filters: {
      min_oi_usd: minOiUsd,
      limit,
    },
    market_summary: {
      total_markets: metaMap.size,
      qualifying_markets: qualifying.length,
      total_open_interest_usd: roundTo(totalOiUsd, 2) ?? 0,
      total_volume_24h_usd: roundTo(totalVolUsd, 2) ?? 0,
      median_funding_annualized_pct: computeMedian(allAnnualizedFunding),
      positive_funding_count: positiveCount,
      negative_funding_count: negativeCount,
      neutral_funding_count: neutralCount,
    },
    highest_funding: highestFunding,
    lowest_funding: lowestFunding,
    widest_basis: widestBasis,
    highest_turnover: highestTurnover,
    metadata: {
      fetched_at: fetchedAtIso,
      sources: ["hyperliquid"],
      disclaimer: DISCLAIMER,
    },
  };
}
