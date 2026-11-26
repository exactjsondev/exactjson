import { DISCLAIMER } from "../config/catalog";
import { roundTo } from "../lib/numbers";
import type {
  DexScreenerAggregated,
  EvmChainConfig,
  EvmQuoteTierResult,
  ExecutionQuoteCheckEvmResponse,
  ExecutionQuoteCheckPerpsResponse,
  HyperliquidAssetEntry,
  HyperliquidBookLevel,
  HyperliquidL2Book,
  KyberSwapRouteQuote,
  LiquidityGrade,
  PerpQuoteSideSummary,
  PerpQuoteTierResult,
  QuoteCheckPerpSide,
} from "../types";

const MAX_SLIPPAGE_THRESHOLD_BPS = 100;
const WIDE_SPREAD_THRESHOLD_BPS = 25;
const HIGH_GAS_OVERHEAD_BPS = 50;

function roundPriceUsd(value: number, standardDecimals: number = 8): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  if (Math.abs(value) >= 1e-4) {
    return roundTo(value, standardDecimals);
  }
  return Number(value.toPrecision(6));
}

export function classifyLiquidityGrade(
  maxSizeUnder100BpsUsd: number,
  anyExecutable: boolean
): LiquidityGrade {
  if (!anyExecutable || !Number.isFinite(maxSizeUnder100BpsUsd) || maxSizeUnder100BpsUsd < 1_000) {
    return "ILLIQUID";
  }
  if (maxSizeUnder100BpsUsd < 10_000) return "THIN";
  if (maxSizeUnder100BpsUsd < 50_000) return "ADEQUATE";
  return "DEEP";
}

// --- Perps L2 Orderbook Execution Simulation ---

function sumBookDepthUsd(levels: readonly HyperliquidBookLevel[]): number {
  let total = 0;
  for (const level of levels) {
    if (!Number.isFinite(level.px) || !Number.isFinite(level.sz) || level.px <= 0 || level.sz <= 0) {
      continue;
    }
    total += level.px * level.sz;
  }
  return roundTo(total, 2);
}

export function simulateL2TierFill(
  levels: readonly HyperliquidBookLevel[],
  midPrice: number | null,
  sizeUsd: number,
  side: "buy" | "sell"
): PerpQuoteTierResult {
  if (
    midPrice === null ||
    !Number.isFinite(midPrice) ||
    midPrice <= 0 ||
    !Number.isFinite(sizeUsd) ||
    sizeUsd <= 0 ||
    levels.length === 0
  ) {
    return {
      size_usd: sizeUsd,
      executable: false,
      fill_pct: 0,
      effective_price: null,
      worst_fill_price: null,
      vwap_slippage_bps: null,
      price_impact_bps: null,
    };
  }

  let remainingUsd = sizeUsd;
  let filledUsd = 0;
  let totalBaseQty = 0;
  let worstPx: number | null = null;

  for (const level of levels) {
    if (!Number.isFinite(level.px) || !Number.isFinite(level.sz) || level.px <= 0 || level.sz <= 0) {
      continue;
    }
    const levelUsd = level.px * level.sz;
    if (levelUsd >= remainingUsd) {
      totalBaseQty += remainingUsd / level.px;
      filledUsd += remainingUsd;
      worstPx = level.px;
      remainingUsd = 0;
      break;
    }
    totalBaseQty += level.sz;
    filledUsd += levelUsd;
    worstPx = level.px;
    remainingUsd -= levelUsd;
  }

  if (remainingUsd > 1e-6 || totalBaseQty <= 0 || worstPx === null) {
    const fillPct = roundTo(Math.min(100, Math.max(0, (filledUsd / sizeUsd) * 100)), 2);
    return {
      size_usd: sizeUsd,
      executable: false,
      fill_pct: fillPct,
      effective_price: null,
      worst_fill_price: null,
      vwap_slippage_bps: null,
      price_impact_bps: null,
    };
  }

  const vwap = sizeUsd / totalBaseQty;
  const rawVwapSlippage =
    side === "buy"
      ? ((vwap - midPrice) / midPrice) * 10_000
      : ((midPrice - vwap) / midPrice) * 10_000;
  const rawMarginalImpact =
    side === "buy"
      ? ((worstPx - midPrice) / midPrice) * 10_000
      : ((midPrice - worstPx) / midPrice) * 10_000;

  return {
    size_usd: sizeUsd,
    executable: true,
    fill_pct: 100,
    effective_price: roundPriceUsd(vwap, 6),
    worst_fill_price: roundPriceUsd(worstPx, 6),
    vwap_slippage_bps: roundTo(Math.max(0, rawVwapSlippage), 2),
    price_impact_bps: roundTo(Math.max(0, rawMarginalImpact), 2),
  };
}

/**
 * Exact closed-form maximum USD notional fillable on the visible L2 book
 * while keeping VWAP slippage <= maxSlippageBps (default 100 bps = 1%).
 */
export function computeMaxSizeUnderSlippageL2(
  levels: readonly HyperliquidBookLevel[],
  midPrice: number | null,
  side: "buy" | "sell",
  maxSlippageBps: number = MAX_SLIPPAGE_THRESHOLD_BPS
): { maxSizeUsd: number; cappedByVisibleBook: boolean } {
  if (
    midPrice === null ||
    !Number.isFinite(midPrice) ||
    midPrice <= 0 ||
    levels.length === 0
  ) {
    return { maxSizeUsd: 0, cappedByVisibleBook: false };
  }

  const limitFactor = maxSlippageBps / 10_000;
  const targetPx =
    side === "buy" ? midPrice * (1 + limitFactor) : midPrice * (1 - limitFactor);

  if (targetPx <= 0) {
    return { maxSizeUsd: 0, cappedByVisibleBook: false };
  }

  let totalUsd = 0;
  let totalQty = 0;
  let validLevels = 0;

  for (const level of levels) {
    if (!Number.isFinite(level.px) || !Number.isFinite(level.sz) || level.px <= 0 || level.sz <= 0) {
      continue;
    }
    validLevels += 1;

    const px = level.px;
    const sz = level.sz;
    const nextUsd = totalUsd + px * sz;
    const nextQty = totalQty + sz;

    const withinLimit =
      side === "buy" ? nextUsd <= targetPx * nextQty + 1e-9 : nextUsd >= targetPx * nextQty - 1e-9;

    if (withinLimit) {
      totalUsd = nextUsd;
      totalQty = nextQty;
      continue;
    }

    // Solve exact partial fill at this level where VWAP equals targetPx
    const denom = side === "buy" ? px - targetPx : targetPx - px;
    if (denom > 0) {
      const numerator =
        side === "buy" ? targetPx * totalQty - totalUsd : totalUsd - targetPx * totalQty;
      const partialQty = Math.min(sz, Math.max(0, numerator / denom));
      if (partialQty > 0) {
        totalUsd += px * partialQty;
        totalQty += partialQty;
      }
    }

    return {
      maxSizeUsd: roundTo(Math.max(0, totalUsd), 2),
      cappedByVisibleBook: false,
    };
  }

  return {
    maxSizeUsd: roundTo(Math.max(0, totalUsd), 2),
    cappedByVisibleBook: validLevels > 0 && totalUsd > 0,
  };
}

function buildPerpSideSummary(
  levels: readonly HyperliquidBookLevel[],
  midPrice: number | null,
  sizesUsd: readonly number[],
  side: "buy" | "sell"
): PerpQuoteSideSummary {
  const tiers = sizesUsd.map((sizeUsd) => simulateL2TierFill(levels, midPrice, sizeUsd, side));
  const { maxSizeUsd, cappedByVisibleBook } = computeMaxSizeUnderSlippageL2(
    levels,
    midPrice,
    side,
    MAX_SLIPPAGE_THRESHOLD_BPS
  );

  return {
    side,
    executable_all_tiers: tiers.length > 0 && tiers.every((t) => t.executable),
    visible_depth_usd: sumBookDepthUsd(levels),
    max_size_under_100bps_usd: maxSizeUsd,
    capped_by_visible_book: cappedByVisibleBook,
    tiers,
  };
}

export function computePerpsQuoteCheck(
  entry: HyperliquidAssetEntry,
  book: HyperliquidL2Book,
  options: {
    side: QuoteCheckPerpSide;
    sizesUsd: readonly number[];
    fetchedAtIso?: string;
  }
): ExecutionQuoteCheckPerpsResponse {
  const fetchedAt = options.fetchedAtIso ?? new Date().toISOString();
  const { ctx } = entry;

  const bestBid = book.bids[0]?.px ?? null;
  const bestAsk = book.asks[0]?.px ?? null;
  const bookMid =
    bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk >= bestBid
      ? (bestBid + bestAsk) / 2
      : null;
  const midPrice = bookMid ?? ctx.midPx ?? ctx.markPx;

  const spreadBps =
    bestBid !== null && bestAsk !== null && bookMid !== null && bookMid > 0
      ? roundTo(((bestAsk - bestBid) / bookMid) * 10_000, 2)
      : null;

  const openInterestUsd =
    ctx.openInterest !== null && ctx.markPx !== null && ctx.markPx > 0
      ? roundTo(ctx.openInterest * ctx.markPx, 2)
      : null;
  const volume24hUsd = ctx.dayNtlVlm !== null ? roundTo(ctx.dayNtlVlm, 2) : null;

  const buySummary =
    options.side === "buy" || options.side === "both"
      ? buildPerpSideSummary(book.asks, midPrice, options.sizesUsd, "buy")
      : null;
  const sellSummary =
    options.side === "sell" || options.side === "both"
      ? buildPerpSideSummary(book.bids, midPrice, options.sizesUsd, "sell")
      : null;

  const activeSides = [buySummary, sellSummary].filter(
    (s): s is PerpQuoteSideSummary => s !== null
  );
  const allTiers = activeSides.flatMap((s) => s.tiers);
  const anyExecutable = allTiers.some((t) => t.executable);
  const allExecutable = allTiers.length > 0 && allTiers.every((t) => t.executable);

  const maxSizeUnder100BpsUsd =
    activeSides.length > 0
      ? roundTo(Math.min(...activeSides.map((s) => s.max_size_under_100bps_usd)), 2)
      : 0;
  const bottleneckSides = activeSides.filter(
    (s) => Math.abs(s.max_size_under_100bps_usd - maxSizeUnder100BpsUsd) <= 0.01
  );
  const cappedByVisibleBook =
    bottleneckSides.length > 0 && bottleneckSides.some((s) => s.capped_by_visible_book);

  const liquidityGrade = classifyLiquidityGrade(maxSizeUnder100BpsUsd, anyExecutable);

  const flags: string[] = [];
  if (!anyExecutable) {
    flags.push("NO_EXECUTABLE_ROUTE");
  } else if (!allExecutable) {
    flags.push("PARTIAL_TIERS_UNEXECUTABLE");
  }
  if (liquidityGrade === "ILLIQUID") flags.push("ILLIQUID_MARKET");
  else if (liquidityGrade === "THIN") flags.push("THIN_LIQUIDITY");

  if (spreadBps !== null && spreadBps > WIDE_SPREAD_THRESHOLD_BPS) {
    flags.push("WIDE_SPREAD");
  }
  if (
    allTiers.some(
      (t) =>
        t.executable &&
        t.size_usd <= 10_000 &&
        t.vwap_slippage_bps !== null &&
        t.vwap_slippage_bps > MAX_SLIPPAGE_THRESHOLD_BPS
    )
  ) {
    flags.push("HIGH_SLIPPAGE_10K");
  }
  if (cappedByVisibleBook) {
    flags.push("VISIBLE_BOOK_DEPTH_CAP");
  }

  return {
    mode: "perps",
    venue: "hyperliquid",
    coin: entry.canonicalName,
    side: options.side,
    market: {
      mid_price: midPrice !== null ? roundPriceUsd(midPrice, 6) : null,
      mark_price: ctx.markPx,
      oracle_price: ctx.oraclePx,
      best_bid: bestBid,
      best_ask: bestAsk,
      spread_bps: spreadBps,
      open_interest_usd: openInterestUsd,
      volume_24h_usd: volume24hUsd,
      levels_sampled: {
        bids: book.bids.length,
        asks: book.asks.length,
      },
    },
    summary: {
      executable: anyExecutable,
      liquidity_grade: liquidityGrade,
      max_size_under_100bps_usd: maxSizeUnder100BpsUsd,
      capped_by_visible_book: cappedByVisibleBook,
      flags,
    },
    buy: buySummary,
    sell: sellSummary,
    metadata: {
      fetched_at: fetchedAt,
      sources: ["hyperliquid"],
      disclaimer: DISCLAIMER,
    },
  };
}

// --- EVM DEX Aggregator Execution Quote Check ---

export interface EvmTierInput {
  sizeUsd: number;
  amountInRaw: string | null;
  quote: KyberSwapRouteQuote | null;
  failureReason: string | null;
}

export interface EvmQuoteCheckContext {
  chain: EvmChainConfig;
  tokenIn: {
    address: string;
    symbol: string | null;
    decimals: number;
    priceUsd: number;
  };
  tokenOutAddress: string;
  dexOut: DexScreenerAggregated | null;
  sources: string[];
  fetchedAtIso?: string;
}

function estimateMaxSizeUnder100BpsEvm(
  tiers: readonly EvmQuoteTierResult[],
  dexLiquidityUsd: number | null
): { maxSizeUsd: number; isExtrapolated: boolean } {
  const withImpact = tiers.filter(
    (t) => t.executable && t.price_impact_bps !== null
  );
  if (withImpact.length === 0) {
    return { maxSizeUsd: 0, isExtrapolated: false };
  }

  const first = withImpact[0]!;
  if (first.price_impact_bps! > MAX_SLIPPAGE_THRESHOLD_BPS) {
    const scaled = first.size_usd * (MAX_SLIPPAGE_THRESHOLD_BPS / first.price_impact_bps!);
    return { maxSizeUsd: roundTo(Math.max(0, scaled), 2), isExtrapolated: true };
  }

  // Walk all tiers in ascending order to detect either a 100 bps crossing or an unexecutable wall
  let lastPassing: EvmQuoteTierResult = first;
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i]!;
    if (tier.size_usd <= lastPassing.size_usd) continue;

    if (!tier.executable || tier.price_impact_bps === null) {
      // Do not extrapolate across an unexecutable tier
      return { maxSizeUsd: roundTo(lastPassing.size_usd, 2), isExtrapolated: false };
    }

    if (tier.price_impact_bps > MAX_SLIPPAGE_THRESHOLD_BPS) {
      const impactLow = lastPassing.price_impact_bps!;
      const impactHigh = tier.price_impact_bps;
      const denom = impactHigh - impactLow;
      const interpolated =
        denom > 0
          ? lastPassing.size_usd +
            (tier.size_usd - lastPassing.size_usd) *
              ((MAX_SLIPPAGE_THRESHOLD_BPS - impactLow) / denom)
          : lastPassing.size_usd;
      return { maxSizeUsd: roundTo(Math.max(0, interpolated), 2), isExtrapolated: false };
    }

    lastPassing = tier;
  }

  // Even the largest requested tier is <= 100 bps: bound conservative upward extrapolation
  const topSize = lastPassing.size_usd;
  const topImpact = lastPassing.price_impact_bps!;
  const linearEstimate =
    topImpact > 0 ? topSize * (MAX_SLIPPAGE_THRESHOLD_BPS / Math.max(topImpact, 5)) : topSize * 5;

  const liqCap =
    dexLiquidityUsd !== null && dexLiquidityUsd > 0 ? dexLiquidityUsd * 0.15 : topSize * 5;
  const bounded = Math.max(topSize, Math.min(linearEstimate, topSize * 10, Math.max(topSize, liqCap)));

  return {
    maxSizeUsd: roundTo(bounded, 2),
    isExtrapolated: bounded > topSize,
  };
}

export function computeEvmQuoteCheck(
  tierInputs: readonly EvmTierInput[],
  ctx: EvmQuoteCheckContext
): ExecutionQuoteCheckEvmResponse {
  const fetchedAt = ctx.fetchedAtIso ?? new Date().toISOString();
  const sortedInputs = [...tierInputs].sort((a, b) => a.sizeUsd - b.sizeUsd);

  const spotPriceUsd = ctx.dexOut?.priceUsd ?? null;
  const dexLiquidityUsd = ctx.dexOut ? ctx.dexOut.totalLiquidityUsd : null;

  // Baseline output-per-input ratio from the smallest executable quote
  let baselineRate: number | null = null;
  let baselineImpactBps: number | null = null;

  const tiers: EvmQuoteTierResult[] = sortedInputs.map((item) => {
    if (!item.quote) {
      return {
        size_usd: item.sizeUsd,
        executable: false,
        amount_in_raw: item.amountInRaw,
        amount_out_raw: null,
        amount_in_usd: null,
        amount_out_usd: null,
        effective_price_usd: null,
        price_impact_bps: null,
        estimated_gas_usd: null,
        all_in_cost_bps: null,
        dexes_used: [],
        route_hops: 0,
        failure_reason: item.failureReason ?? "NO_ROUTE",
      };
    }

    const q = item.quote;
    const inNum = Number(q.amountInRaw);
    const outNum = Number(q.amountOutRaw);
    const tierRate =
      Number.isFinite(inNum) && Number.isFinite(outNum) && inNum > 0 && outNum > 0
        ? outNum / inNum
        : null;

    const rawUsdImpactBps =
      q.amountInUsd !== null &&
      q.amountOutUsd !== null &&
      q.amountInUsd > 0 &&
      q.amountOutUsd > 0
        ? ((q.amountInUsd - q.amountOutUsd) / q.amountInUsd) * 10_000
        : null;

    let priceImpactBps: number;
    if (baselineRate === null) {
      if (rawUsdImpactBps !== null) {
        priceImpactBps = Math.max(0, rawUsdImpactBps);
      } else if (dexLiquidityUsd !== null && dexLiquidityUsd > 0) {
        // Fallback AMM constant-product impact estimate when KyberSwap omits USD valuation
        priceImpactBps = Math.min(5_000, (item.sizeUsd / (2 * dexLiquidityUsd)) * 10_000);
      } else {
        priceImpactBps = 0;
      }
      baselineRate = tierRate;
      baselineImpactBps = priceImpactBps;
    } else {
      const relativeDegradationBps =
        tierRate !== null && baselineRate > 0
          ? Math.max(0, ((baselineRate - tierRate) / baselineRate) * 10_000)
          : 0;
      const monotonicFloor = (baselineImpactBps ?? 0) + relativeDegradationBps;
      priceImpactBps =
        rawUsdImpactBps !== null
          ? Math.max(0, rawUsdImpactBps, monotonicFloor)
          : monotonicFloor;
    }

    priceImpactBps = roundTo(priceImpactBps, 2);

    const effectivePriceUsd =
      spotPriceUsd !== null && spotPriceUsd > 0
        ? roundPriceUsd(spotPriceUsd * (1 + priceImpactBps / 10_000), 8)
        : null;

    const gasUsd = q.gasUsd !== null ? roundTo(q.gasUsd, 4) : null;
    const gasBps = gasUsd !== null && item.sizeUsd > 0 ? (gasUsd / item.sizeUsd) * 10_000 : 0;
    const allInCostBps = roundTo(priceImpactBps + gasBps, 2);

    return {
      size_usd: item.sizeUsd,
      executable: true,
      amount_in_raw: q.amountInRaw,
      amount_out_raw: q.amountOutRaw,
      amount_in_usd: q.amountInUsd !== null ? roundTo(q.amountInUsd, 2) : null,
      amount_out_usd: q.amountOutUsd !== null ? roundTo(q.amountOutUsd, 2) : null,
      effective_price_usd: effectivePriceUsd,
      price_impact_bps: priceImpactBps,
      estimated_gas_usd: gasUsd,
      all_in_cost_bps: allInCostBps,
      dexes_used: q.dexesUsed,
      route_hops: q.routeHops,
      failure_reason: null,
    };
  });

  const executableTiers = tiers.filter((t) => t.executable);
  const anyExecutable = executableTiers.length > 0;
  const allExecutable = tiers.length > 0 && executableTiers.length === tiers.length;

  const { maxSizeUsd, isExtrapolated } = estimateMaxSizeUnder100BpsEvm(tiers, dexLiquidityUsd);
  const liquidityGrade = classifyLiquidityGrade(maxSizeUsd, anyExecutable);

  const worstExecutableImpactBps =
    executableTiers.length > 0
      ? Math.max(
          ...executableTiers
            .map((t) => t.price_impact_bps)
            .filter((v): v is number => v !== null)
        )
      : null;

  const flags: string[] = [];
  if (!anyExecutable) {
    flags.push("NO_EXECUTABLE_ROUTE");
  } else if (!allExecutable) {
    flags.push("PARTIAL_TIERS_UNEXECUTABLE");
  }
  if (liquidityGrade === "ILLIQUID") flags.push("ILLIQUID_MARKET");
  else if (liquidityGrade === "THIN") flags.push("THIN_LIQUIDITY");

  if (
    executableTiers.some(
      (t) =>
        t.size_usd <= 10_000 &&
        t.price_impact_bps !== null &&
        t.price_impact_bps > MAX_SLIPPAGE_THRESHOLD_BPS
    )
  ) {
    flags.push("HIGH_SLIPPAGE_10K");
  }

  const smallestExec = executableTiers[0];
  if (
    smallestExec &&
    smallestExec.estimated_gas_usd !== null &&
    smallestExec.size_usd > 0 &&
    (smallestExec.estimated_gas_usd / smallestExec.size_usd) * 10_000 > HIGH_GAS_OVERHEAD_BPS
  ) {
    flags.push("HIGH_GAS_OVERHEAD");
  }

  if (spotPriceUsd === null) {
    flags.push("SPOT_PRICE_UNAVAILABLE");
  }

  return {
    mode: "evm",
    chain: ctx.chain.key,
    chain_id: ctx.chain.chainId,
    token_in: {
      address: ctx.tokenIn.address,
      symbol: ctx.tokenIn.symbol,
      decimals: ctx.tokenIn.decimals,
      price_usd: roundPriceUsd(ctx.tokenIn.priceUsd, 6),
    },
    token_out: {
      address: ctx.tokenOutAddress.toLowerCase(),
      symbol: ctx.dexOut?.symbol ?? null,
      name: ctx.dexOut?.name ?? null,
      spot_price_usd: spotPriceUsd,
      dex_liquidity_usd: dexLiquidityUsd,
      dex_volume_24h_usd: ctx.dexOut ? ctx.dexOut.volume24hUsd : null,
      primary_dex: ctx.dexOut?.primaryDex ?? null,
    },
    summary: {
      executable: anyExecutable,
      liquidity_grade: liquidityGrade,
      max_size_under_100bps_usd: maxSizeUsd,
      max_size_is_extrapolated: isExtrapolated,
      worst_executable_impact_bps:
        worstExecutableImpactBps !== null && Number.isFinite(worstExecutableImpactBps)
          ? roundTo(worstExecutableImpactBps, 2)
          : null,
      flags,
    },
    tiers,
    metadata: {
      fetched_at: fetchedAt,
      sources: ctx.sources,
      disclaimer: DISCLAIMER,
    },
  };
}
