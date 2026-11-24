import { DISCLAIMER } from "../config/catalog";
import type {
  FundingRegime,
  HyperliquidAssetEntry,
  HyperliquidBookLevel,
  HyperliquidL2Book,
  PerpsSnapshotResponse,
} from "../types";

const TOP_LEVELS_COUNT = 5;
const HOURS_PER_YEAR = 24 * 365;
const NEUTRAL_FUNDING_THRESHOLD = 0.000005;

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

export function classifyFundingRegime(hourlyRate: number | null): FundingRegime {
  if (hourlyRate === null || !Number.isFinite(hourlyRate)) {
    return "NEUTRAL";
  }
  if (hourlyRate > NEUTRAL_FUNDING_THRESHOLD) return "POSITIVE";
  if (hourlyRate < -NEUTRAL_FUNDING_THRESHOLD) return "NEGATIVE";
  return "NEUTRAL";
}

function sumTopDepthUsd(levels: readonly HyperliquidBookLevel[], count: number): number | null {
  const slice = levels.slice(0, count);
  if (slice.length === 0) return null;
  let total = 0;
  for (const level of slice) {
    const notional = level.px * level.sz;
    if (Number.isFinite(notional) && notional >= 0) {
      total += notional;
    }
  }
  return roundTo(total, 2);
}

const SLIPPAGE_NOTIONAL_USD = 10_000;

/**
 * Estimates VWAP execution slippage in basis points vs. reference midPrice for
 * filling `notionalUsd` by walking the L2 book (`asks` for buy, `bids` for sell).
 * Returns null if midPrice <= 0 or available depth cannot fill the notional.
 */
export function estimateExecutionSlippageBps(
  levels: readonly HyperliquidBookLevel[],
  midPrice: number | null,
  notionalUsd: number,
  side: "buy" | "sell"
): number | null {
  if (
    midPrice === null ||
    !Number.isFinite(midPrice) ||
    midPrice <= 0 ||
    !Number.isFinite(notionalUsd) ||
    notionalUsd <= 0 ||
    levels.length === 0
  ) {
    return null;
  }

  let remainingUsd = notionalUsd;
  let totalBaseQty = 0;

  for (const level of levels) {
    if (!Number.isFinite(level.px) || !Number.isFinite(level.sz) || level.px <= 0 || level.sz <= 0) {
      continue;
    }
    const levelUsd = level.px * level.sz;
    if (levelUsd >= remainingUsd) {
      totalBaseQty += remainingUsd / level.px;
      remainingUsd = 0;
      break;
    }
    totalBaseQty += level.sz;
    remainingUsd -= levelUsd;
  }

  if (remainingUsd > 1e-6 || totalBaseQty <= 0) {
    return null;
  }

  const vwap = notionalUsd / totalBaseQty;
  const rawSlippage =
    side === "buy"
      ? ((vwap - midPrice) / midPrice) * 10_000
      : ((midPrice - vwap) / midPrice) * 10_000;

  return roundTo(Math.max(0, rawSlippage), 4);
}

export function computePerpsSnapshot(
  entry: HyperliquidAssetEntry,
  book: HyperliquidL2Book,
  fetchedAtIso: string = new Date().toISOString()
): PerpsSnapshotResponse {
  const { ctx } = entry;

  const bestBid = book.bids[0]?.px ?? null;
  const bestAsk = book.asks[0]?.px ?? null;

  const computedMid =
    bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk > 0
      ? roundTo((bestBid + bestAsk) / 2, 6)
      : null;

  const midPrice = ctx.midPx ?? computedMid;

  const markOracleRatio =
    ctx.markPx !== null && ctx.oraclePx !== null && ctx.oraclePx > 0
      ? safeDivide(ctx.markPx - ctx.oraclePx, ctx.oraclePx)
      : null;
  const markOracleBasisBps =
    markOracleRatio !== null ? roundTo(markOracleRatio * 10_000, 4) : null;

  const priceChangeRatio =
    ctx.markPx !== null && ctx.prevDayPx !== null && ctx.prevDayPx > 0
      ? safeDivide(ctx.markPx - ctx.prevDayPx, ctx.prevDayPx)
      : null;
  const priceChange24hPct =
    priceChangeRatio !== null ? roundTo(priceChangeRatio * 100, 4) : null;

  const openInterestUsd =
    ctx.openInterest !== null && ctx.markPx !== null && ctx.markPx > 0
      ? roundTo(ctx.openInterest * ctx.markPx, 2)
      : null;

  const volume24hUsd = ctx.dayNtlVlm !== null ? roundTo(ctx.dayNtlVlm, 2) : null;
  const volumeToOiRaw =
    volume24hUsd !== null && openInterestUsd !== null && openInterestUsd > 0
      ? safeDivide(volume24hUsd, openInterestUsd)
      : null;
  const volumeToOiRatio = volumeToOiRaw !== null ? roundTo(volumeToOiRaw, 4) : null;

  const fundingAnnualizedPct =
    ctx.funding !== null ? roundTo(ctx.funding * HOURS_PER_YEAR * 100, 4) : null;

  const spreadRefMid =
    bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk >= bestBid
      ? (bestBid + bestAsk) / 2
      : null;
  const spreadRatio =
    bestBid !== null && bestAsk !== null && spreadRefMid !== null && spreadRefMid > 0
      ? safeDivide(bestAsk - bestBid, spreadRefMid)
      : null;
  const spreadBps = spreadRatio !== null ? roundTo(spreadRatio * 10_000, 4) : null;

  const slippageRefMid = spreadRefMid ?? midPrice;
  const slippage10kBuyBps = estimateExecutionSlippageBps(
    book.asks,
    slippageRefMid,
    SLIPPAGE_NOTIONAL_USD,
    "buy"
  );
  const slippage10kSellBps = estimateExecutionSlippageBps(
    book.bids,
    slippageRefMid,
    SLIPPAGE_NOTIONAL_USD,
    "sell"
  );

  const bidDepth5Usd = sumTopDepthUsd(book.bids, TOP_LEVELS_COUNT);
  const askDepth5Usd = sumTopDepthUsd(book.asks, TOP_LEVELS_COUNT);

  const totalDepth5 =
    bidDepth5Usd !== null && askDepth5Usd !== null ? bidDepth5Usd + askDepth5Usd : null;
  const imbalanceRaw =
    bidDepth5Usd !== null &&
    askDepth5Usd !== null &&
    totalDepth5 !== null &&
    totalDepth5 > 0
      ? safeDivide(bidDepth5Usd - askDepth5Usd, totalDepth5)
      : null;
  const imbalance5 = imbalanceRaw !== null ? roundTo(imbalanceRaw, 4) : null;

  const levelsSampled = Math.min(
    TOP_LEVELS_COUNT,
    Math.max(book.bids.length, book.asks.length)
  );

  return {
    coin: entry.canonicalName,
    market: {
      mark_price: ctx.markPx,
      oracle_price: ctx.oraclePx,
      mid_price: midPrice,
      mark_oracle_basis_bps: markOracleBasisBps,
      prev_day_price: ctx.prevDayPx,
      price_change_24h_pct: priceChange24hPct,
      volume_24h_usd: volume24hUsd,
      open_interest_base: ctx.openInterest,
      open_interest_usd: openInterestUsd,
      volume_to_oi_ratio: volumeToOiRatio,
      max_leverage: entry.maxLeverage !== null ? Math.round(entry.maxLeverage) : null,
    },
    funding: {
      hourly_rate: ctx.funding,
      annualized_pct: fundingAnnualizedPct,
      premium: ctx.premium,
      regime: classifyFundingRegime(ctx.funding),
    },
    orderbook: {
      best_bid: bestBid,
      best_ask: bestAsk,
      spread_bps: spreadBps,
      bid_depth_5_usd: bidDepth5Usd,
      ask_depth_5_usd: askDepth5Usd,
      imbalance_5: imbalance5,
      slippage_10k_buy_bps: slippage10kBuyBps,
      slippage_10k_sell_bps: slippage10kSellBps,
      levels_sampled: levelsSampled,
    },
    metadata: {
      fetched_at: fetchedAtIso,
      sources: ["hyperliquid"],
      disclaimer: DISCLAIMER,
    },
  };
}
