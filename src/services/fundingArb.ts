import { DISCLAIMER } from "../config/catalog";
import { roundToOrNull as roundTo } from "../lib/numbers";
import { normalizeBaseAsset } from "../providers/dydx";
import type {
  FundingArbOpportunity,
  FundingArbResponse,
  FundingArbVenueQuote,
  HyperliquidAssetEntry,
  PerpVenueName,
  VenuePerpMarket,
} from "../types";

const HOURS_PER_YEAR = 24 * 365;

export function hyperliquidToVenueMap(
  hlMap: Map<string, HyperliquidAssetEntry>
): Map<string, VenuePerpMarket> {
  const out = new Map<string, VenuePerpMarket>();

  for (const entry of hlMap.values()) {
    const { asset, scaledUnit } = normalizeBaseAsset(entry.canonicalName);
    const { ctx } = entry;
    const oiUsd =
      ctx.openInterest !== null && ctx.markPx !== null && ctx.markPx > 0
        ? roundTo(ctx.openInterest * ctx.markPx, 2)
        : null;

    const candidate: VenuePerpMarket = {
      venue: "hyperliquid",
      symbol: entry.canonicalName,
      baseAsset: asset,
      scaledUnit,
      markPrice: ctx.markPx,
      hourlyFundingRate: ctx.funding,
      openInterestUsd: oiUsd,
      volume24hUsd: ctx.dayNtlVlm !== null ? roundTo(ctx.dayNtlVlm, 2) : null,
    };

    const key = asset.toLowerCase();
    const existing = out.get(key);
    if (!existing || (candidate.openInterestUsd ?? 0) > (existing.openInterestUsd ?? 0)) {
      out.set(key, candidate);
    }
  }

  return out;
}

export interface FundingArbInputs {
  hyperliquid?: Map<string, VenuePerpMarket>;
  dydx?: Map<string, VenuePerpMarket>;
  kraken?: Map<string, VenuePerpMarket>;
}

export interface FundingArbOptions {
  minOiUsd: number;
  limit: number;
  coinLookupKey?: string | null;
}

export function computeFundingArb(
  inputs: FundingArbInputs,
  options: FundingArbOptions,
  fetchedAtIso: string = new Date().toISOString()
): FundingArbResponse {
  const minOiUsd = Math.max(0, options.minOiUsd);
  const limit = Math.min(25, Math.max(1, Math.floor(options.limit)));
  const coinFilter = options.coinLookupKey
    ? normalizeBaseAsset(options.coinLookupKey).asset.toLowerCase()
    : null;

  const activeVenues: PerpVenueName[] = [];
  const maps: Array<[PerpVenueName, Map<string, VenuePerpMarket>]> = [];
  if (inputs.hyperliquid) {
    activeVenues.push("hyperliquid");
    maps.push(["hyperliquid", inputs.hyperliquid]);
  }
  if (inputs.dydx) {
    activeVenues.push("dydx");
    maps.push(["dydx", inputs.dydx]);
  }
  if (inputs.kraken) {
    activeVenues.push("kraken");
    maps.push(["kraken", inputs.kraken]);
  }

  // Collect candidate asset keys across active venues
  const assetKeys = new Set<string>();
  for (const [, map] of maps) {
    for (const key of map.keys()) {
      if (!coinFilter || key === coinFilter) {
        assetKeys.add(key);
      }
    }
  }

  const allOpportunities: FundingArbOpportunity[] = [];

  for (const key of assetKeys) {
    const matched: VenuePerpMarket[] = [];
    for (const [, map] of maps) {
      const m = map.get(key);
      if (m && m.hourlyFundingRate !== null && Number.isFinite(m.hourlyFundingRate)) {
        // When scanning across assets (no explicit coin filter), require each participating
        // venue leg to meet minOiUsd so illiquid books cannot distort top funding spreads.
        if (!coinFilter && minOiUsd > 0 && (m.openInterestUsd ?? 0) < minOiUsd) {
          continue;
        }
        matched.push(m);
      }
    }

    if (matched.length < 2) continue;

    let minOi: number | null = null;
    let maxOi: number | null = null;
    for (const m of matched) {
      if (m.openInterestUsd !== null) {
        if (minOi === null || m.openInterestUsd < minOi) minOi = m.openInterestUsd;
        if (maxOi === null || m.openInterestUsd > maxOi) maxOi = m.openInterestUsd;
      }
    }

    const venuesRecord: Partial<Record<PerpVenueName, FundingArbVenueQuote>> = {};
    const venueRates: Array<{ venue: PerpVenueName; apr: number }> = [];

    // Compare mark prices ONLY across unscaled 1:1 contracts (never mix 1000PEPE vs PEPE)
    const unscaledMarks: number[] = [];

    for (const m of matched) {
      const hourly = m.hourlyFundingRate!;
      const apr = roundTo(hourly * HOURS_PER_YEAR * 100, 4);
      if (apr === null) continue;

      venuesRecord[m.venue] = {
        symbol: m.symbol,
        hourly_rate: hourly,
        annualized_pct: apr,
        mark_price: m.markPrice,
        open_interest_usd: m.openInterestUsd,
        volume_24h_usd: m.volume24hUsd,
      };

      venueRates.push({ venue: m.venue, apr });

      if (!m.scaledUnit && m.markPrice !== null && m.markPrice > 0) {
        unscaledMarks.push(m.markPrice);
      }
    }

    if (venueRates.length < 2) continue;

    let highest = venueRates[0]!;
    let lowest = venueRates[0]!;
    for (let i = 1; i < venueRates.length; i += 1) {
      const cur = venueRates[i]!;
      if (cur.apr > highest.apr) highest = cur;
      if (cur.apr < lowest.apr) lowest = cur;
    }
    if (highest.venue === lowest.venue) {
      const distinct = venueRates.find((v) => v.venue !== highest.venue);
      if (distinct) lowest = distinct;
    }

    const spreadApr = roundTo(Math.max(0, highest.apr - lowest.apr), 4) ?? 0;

    let markSpreadBps: number | null = null;
    if (unscaledMarks.length >= 2) {
      const minPx = Math.min(...unscaledMarks);
      const maxPx = Math.max(...unscaledMarks);
      if (minPx > 0) {
        markSpreadBps = roundTo(((maxPx - minPx) / minPx) * 10_000, 4);
      }
    }

    allOpportunities.push({
      asset: matched[0]!.baseAsset,
      venues_compared: Object.keys(venuesRecord).length,
      spread_annualized_pct: spreadApr,
      highest_funding_venue: highest.venue,
      lowest_funding_venue: lowest.venue,
      mark_price_spread_bps: markSpreadBps,
      min_open_interest_usd: minOi,
      max_open_interest_usd: maxOi,
      venues: venuesRecord,
    });
  }

  allOpportunities.sort((a, b) => {
    if (b.spread_annualized_pct !== a.spread_annualized_pct) {
      return b.spread_annualized_pct - a.spread_annualized_pct;
    }
    return (b.max_open_interest_usd ?? 0) - (a.max_open_interest_usd ?? 0);
  });

  return {
    filters: {
      min_oi_usd: minOiUsd,
      limit,
      coin: coinFilter ? coinFilter.toUpperCase() : null,
    },
    venues_active: activeVenues,
    matched_assets_count: allOpportunities.length,
    opportunities: allOpportunities.slice(0, limit),
    metadata: {
      fetched_at: fetchedAtIso,
      sources: activeVenues,
      disclaimer: DISCLAIMER,
    },
  };
}
