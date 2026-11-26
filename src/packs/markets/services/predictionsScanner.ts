import { DISCLAIMER } from "../../../config/catalog";
import { normalizeMarketTitle, resolveTokenAlias } from "./predictionsArb";
import type {
  PredictionMarketItem,
  PredictionVenueName,
  PredictionsScannerResponse,
  RawPredictionMarket,
} from "../../../types";

function round(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export interface PredictionsScannerOptions {
  venue: "all" | PredictionVenueName;
  query: string | null;
  minVolume24hUsd: number;
  limit: number;
  venuesActive: PredictionVenueName[];
  nowMs?: number;
  fetchedAt?: string;
}

function enrichMarket(raw: RawPredictionMarket, nowMs: number): PredictionMarketItem {
  let hoursToExpiry: number | null = null;
  if (raw.expiresAt) {
    const expMs = Date.parse(raw.expiresAt);
    if (Number.isFinite(expMs)) {
      const diffHours = (expMs - nowMs) / 3_600_000;
      hoursToExpiry = diffHours > 0 ? round(diffHours, 2) : 0;
    }
  }

  let dominantSide: "YES" | "NO" | null = null;
  let dominantProb: number | null = null;
  if (raw.yesProb !== null && raw.noProb !== null) {
    if (raw.yesProb >= raw.noProb) {
      dominantSide = "YES";
      dominantProb = round(raw.yesProb, 4);
    } else {
      dominantSide = "NO";
      dominantProb = round(raw.noProb, 4);
    }
  }

  // Deterministic simple annualized carry for high-conviction (80%-98.5%) contracts expiring in 12h..90d
  let impliedAnnualizedCarryPct: number | null = null;
  if (
    dominantSide !== null &&
    dominantProb !== null &&
    dominantProb >= 0.8 &&
    hoursToExpiry !== null &&
    hoursToExpiry >= 12 &&
    hoursToExpiry <= 2160
  ) {
    let entryPrice: number | null = dominantProb;
    if (dominantSide === "YES" && raw.yesAsk !== null) {
      // Never fall back to mid/prob when an explicit book ask is invalid (<= 0 or > 1)
      entryPrice = raw.yesAsk > 0 && raw.yesAsk <= 1 ? raw.yesAsk : null;
    } else if (dominantSide === "NO" && raw.yesBid !== null) {
      // Buying NO costs roughly (1 - yesBid); reject invalid yesBid (< 0 or >= 1) without mid fallback
      entryPrice = raw.yesBid >= 0 && raw.yesBid < 1 ? 1 - raw.yesBid : null;
    }
    if (entryPrice !== null && entryPrice >= 0.8 && entryPrice <= 0.985) {
      const simpleReturn = (1 - entryPrice) / entryPrice;
      const apr = simpleReturn * (8760 / hoursToExpiry) * 100;
      if (Number.isFinite(apr) && apr > 0) {
        impliedAnnualizedCarryPct = round(Math.min(apr, 5000), 2);
      }
    }
  }

  const volumeToLiquidity =
    raw.liquidityUsd !== null && raw.liquidityUsd > 0
      ? round(raw.volume24hUsd / raw.liquidityUsd, 4)
      : null;

  return {
    venue: raw.venue,
    id: raw.id,
    title: raw.title,
    category: raw.category,
    yes_prob: raw.yesProb !== null ? round(raw.yesProb, 4) : null,
    no_prob: raw.noProb !== null ? round(raw.noProb, 4) : null,
    bid_ask_spread_bps: raw.spreadBps !== null ? round(raw.spreadBps, 2) : null,
    volume_24h_usd: round(raw.volume24hUsd, 2),
    liquidity_usd: raw.liquidityUsd !== null ? round(raw.liquidityUsd, 2) : null,
    volume_to_liquidity_ratio: volumeToLiquidity,
    expires_at: raw.expiresAt,
    hours_to_expiry: hoursToExpiry,
    dominant_side: dominantSide,
    dominant_prob: dominantProb,
    implied_annualized_carry_pct: impliedAnnualizedCarryPct,
    url: raw.url,
  };
}

function matchesQuery(raw: RawPredictionMarket, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return true;
  const haystack = `${raw.title} ${raw.id} ${raw.category ?? ""}`.toLowerCase();
  if (queryTokens.every((tok) => haystack.includes(tok))) return true;
  const normalized = normalizeMarketTitle(raw.title);
  return queryTokens.every((tok) => {
    if (haystack.includes(tok)) return true;
    return normalized.tokens.has(resolveTokenAlias(tok));
  });
}

export function computePredictionsScanner(
  allRawMarkets: RawPredictionMarket[],
  options: PredictionsScannerOptions
): PredictionsScannerResponse {
  const nowMs = options.nowMs ?? Date.now();
  const fetchedAt = options.fetchedAt ?? new Date(nowMs).toISOString();

  const queryTokens = options.query
    ? options.query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0)
    : [];

  const filteredRaw = allRawMarkets.filter((m) => {
    if (options.venue !== "all" && m.venue !== options.venue) return false;
    if (m.volume24hUsd < options.minVolume24hUsd) return false;
    if (!matchesQuery(m, queryTokens)) return false;
    return true;
  });

  const enriched = filteredRaw.map((m) => enrichMarket(m, nowMs));

  let polymarketCount = 0;
  let kalshiCount = 0;
  let totalVolume24h = 0;
  for (const item of enriched) {
    if (item.venue === "polymarket") polymarketCount += 1;
    else kalshiCount += 1;
    totalVolume24h += item.volume_24h_usd;
  }

  const topByVolume = [...enriched]
    .sort((a, b) => {
      if (b.volume_24h_usd !== a.volume_24h_usd) return b.volume_24h_usd - a.volume_24h_usd;
      const liqDiff = (b.liquidity_usd ?? -1) - (a.liquidity_usd ?? -1);
      if (liqDiff !== 0) return liqDiff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, options.limit);

  const minCarryVol = Math.max(options.minVolume24hUsd, 500);
  const highConvictionCarry = enriched
    .filter((m) => m.implied_annualized_carry_pct !== null && m.volume_24h_usd >= minCarryVol)
    .sort((a, b) => {
      const diff = (b.implied_annualized_carry_pct ?? 0) - (a.implied_annualized_carry_pct ?? 0);
      if (diff !== 0) return diff;
      return b.volume_24h_usd - a.volume_24h_usd;
    })
    .slice(0, options.limit);

  const widestSpreads = enriched
    .filter(
      (m) =>
        m.bid_ask_spread_bps !== null &&
        m.bid_ask_spread_bps > 0 &&
        m.bid_ask_spread_bps < 10_000
    )
    .sort((a, b) => {
      const diff = (b.bid_ask_spread_bps ?? 0) - (a.bid_ask_spread_bps ?? 0);
      if (diff !== 0) return diff;
      return b.volume_24h_usd - a.volume_24h_usd;
    })
    .slice(0, options.limit);

  return {
    filters: {
      venue: options.venue,
      query: options.query,
      min_volume_24h_usd: options.minVolume24hUsd,
      limit: options.limit,
    },
    venues_active: [...options.venuesActive],
    market_summary: {
      scanned_count: allRawMarkets.length,
      matching_count: enriched.length,
      polymarket_count: polymarketCount,
      kalshi_count: kalshiCount,
      total_volume_24h_usd: round(totalVolume24h, 2),
    },
    top_by_volume: topByVolume,
    high_conviction_carry: highConvictionCarry,
    widest_spreads: widestSpreads,
    metadata: {
      fetched_at: fetchedAt,
      sources: [...options.venuesActive],
      disclaimer: DISCLAIMER,
    },
  };
}
