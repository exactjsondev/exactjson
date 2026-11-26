import { DISCLAIMER } from "../../../config/catalog";
import type {
  DeribitOptionContract,
  OptionsCurrency,
  OptionsExpirySlice,
  OptionsStrikeWall,
  OptionsSurfaceResponse,
  SkewRegime,
  VolTermStructure,
} from "../../../types";

function round(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function computeMaxPainStrike(contracts: DeribitOptionContract[], spot: number): number | null {
  const withOi = contracts.filter((c) => c.openInterest > 0);
  if (withOi.length === 0) return null;

  const strikes = Array.from(new Set(withOi.map((c) => c.strike))).sort((a, b) => a - b);
  let bestStrike: number | null = null;
  let bestPayout = Number.POSITIVE_INFINITY;

  for (const candidate of strikes) {
    let payout = 0;
    for (const c of withOi) {
      if (c.optionType === "C" && candidate > c.strike) {
        payout += (candidate - c.strike) * c.openInterest;
      } else if (c.optionType === "P" && c.strike > candidate) {
        payout += (c.strike - candidate) * c.openInterest;
      }
    }
    if (
      payout < bestPayout ||
      (payout === bestPayout &&
        bestStrike !== null &&
        Math.abs(candidate - spot) < Math.abs(bestStrike - spot))
    ) {
      bestPayout = payout;
      bestStrike = candidate;
    }
  }

  return bestStrike;
}

function computeTopWalls(
  contracts: DeribitOptionContract[],
  optionType: "C" | "P",
  spot: number,
  topN = 3
): OptionsStrikeWall[] {
  const byStrike = new Map<number, number>();
  for (const c of contracts) {
    if (c.optionType !== optionType || c.openInterest <= 0) continue;
    byStrike.set(c.strike, (byStrike.get(c.strike) ?? 0) + c.openInterest);
  }

  return Array.from(byStrike.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, topN)
    .map(([strike, oi]) => ({
      strike,
      open_interest: round(oi, 2),
      open_interest_usd: round(oi * spot, 2),
      distance_from_spot_pct: spot > 0 ? round(((strike - spot) / spot) * 100, 2) : null,
    }));
}

function computeExpirySlice(
  expiryCode: string,
  expiryMs: number,
  expiryIso: string,
  contracts: DeribitOptionContract[],
  spot: number,
  nowMs: number
): OptionsExpirySlice {
  const dteDays = round(Math.max(0, (expiryMs - nowMs) / 86_400_000), 2);

  let callOi = 0;
  let putOi = 0;
  for (const c of contracts) {
    if (c.optionType === "C") callOi += c.openInterest;
    else putOi += c.openInterest;
  }

  // ATM strike & IV (closest strike to spot that has valid markIvPct)
  const ivContracts = contracts.filter((c) => c.markIvPct !== null);
  let atmStrike: number | null = null;
  let atmIvPct: number | null = null;

  if (ivContracts.length > 0) {
    let minDist = Number.POSITIVE_INFINITY;
    for (const c of ivContracts) {
      const dist = Math.abs(c.strike - spot);
      if (dist < minDist) {
        minDist = dist;
        atmStrike = c.strike;
      }
    }
    if (atmStrike !== null) {
      const atStrike = ivContracts.filter((c) => c.strike === atmStrike);
      const sumIv = atStrike.reduce((acc, c) => acc + (c.markIvPct ?? 0), 0);
      atmIvPct = round(sumIv / atStrike.length, 2);
    }
  }

  // ~10% OTM Put minus ~10% OTM Call skew (classic 25-delta proxy)
  const targetPutStrike = spot * 0.9;
  const targetCallStrike = spot * 1.1;

  let bestPut: DeribitOptionContract | null = null;
  let bestPutDist = Number.POSITIVE_INFINITY;
  let bestCall: DeribitOptionContract | null = null;
  let bestCallDist = Number.POSITIVE_INFINITY;

  for (const c of ivContracts) {
    if (c.optionType === "P" && c.strike >= spot * 0.8 && c.strike <= spot * 0.97) {
      const dist = Math.abs(c.strike - targetPutStrike);
      if (dist < bestPutDist) {
        bestPutDist = dist;
        bestPut = c;
      }
    } else if (c.optionType === "C" && c.strike >= spot * 1.03 && c.strike <= spot * 1.2) {
      const dist = Math.abs(c.strike - targetCallStrike);
      if (dist < bestCallDist) {
        bestCallDist = dist;
        bestCall = c;
      }
    }
  }

  const otmSkewIvPts =
    bestPut?.markIvPct != null && bestCall?.markIvPct != null
      ? round(bestPut.markIvPct - bestCall.markIvPct, 2)
      : null;

  return {
    expiry_code: expiryCode,
    expiry_iso: expiryIso,
    dte_days: dteDays,
    contract_count: contracts.length,
    atm_strike: atmStrike,
    atm_iv_pct: atmIvPct,
    call_oi: round(callOi, 2),
    put_oi: round(putOi, 2),
    put_call_oi_ratio: callOi > 0 ? round(putOi / callOi, 4) : null,
    otm_skew_iv_pts: otmSkewIvPts,
  };
}

export function computeOptionsSurface(
  currency: OptionsCurrency,
  rawContracts: DeribitOptionContract[],
  nowMs: number = Date.now(),
  fetchedAt?: string
): OptionsSurfaceResponse {
  const ts = fetchedAt ?? new Date(nowMs).toISOString();
  const activeContracts = rawContracts.filter((c) => c.expiryMs > nowMs);
  if (activeContracts.length === 0) {
    throw new Error(`No unexpired ${currency} options available`);
  }

  // Group contracts by expiryCode
  const byExpiry = new Map<
    string,
    { expiryMs: number; expiryIso: string; contracts: DeribitOptionContract[] }
  >();
  for (const c of activeContracts) {
    const existing = byExpiry.get(c.expiryCode);
    if (existing) {
      existing.contracts.push(c);
    } else {
      byExpiry.set(c.expiryCode, {
        expiryMs: c.expiryMs,
        expiryIso: c.expiryIso,
        contracts: [c],
      });
    }
  }

  const sortedExpiries = Array.from(byExpiry.entries()).sort(
    (a, b) => a[1].expiryMs - b[1].expiryMs
  );

  // Spot price: prefer median underlyingPrice from nearest expiry, fallback to all contracts
  const nearestSpots = sortedExpiries[0]![1].contracts
    .map((c) => c.underlyingPrice)
    .filter((v): v is number => v !== null && v > 0);
  const allSpots = activeContracts
    .map((c) => c.underlyingPrice)
    .filter((v): v is number => v !== null && v > 0);
  const spotPrice = median(nearestSpots) ?? median(allSpots);
  if (spotPrice === null || spotPrice <= 0) {
    throw new Error(`Unable to determine ${currency} underlying index price`);
  }

  let callOi = 0;
  let putOi = 0;
  let callVol = 0;
  let putVol = 0;

  for (const c of activeContracts) {
    if (c.optionType === "C") {
      callOi += c.openInterest;
      callVol += c.volume24h;
    } else {
      putOi += c.openInterest;
      putVol += c.volume24h;
    }
  }

  const totalOi = callOi + putOi;
  const totalVol = callVol + putVol;

  const allSlices: Array<{ slice: OptionsExpirySlice; contracts: DeribitOptionContract[] }> =
    sortedExpiries.map(([expiryCode, group]) => ({
      slice: computeExpirySlice(
        expiryCode,
        group.expiryMs,
        group.expiryIso,
        group.contracts,
        spotPrice,
        nowMs
      ),
      contracts: group.contracts,
    }));

  // Determine volatility term structure (front vs ~30d expiry)
  const ivSlices = allSlices.map((s) => s.slice).filter((s) => s.atm_iv_pct !== null);
  const frontSlice = ivSlices.find((s) => s.dte_days >= 1) ?? ivSlices[0] ?? null;

  let mid30dSlice: OptionsExpirySlice | null = null;
  if (frontSlice) {
    let bestDist = Number.POSITIVE_INFINITY;
    for (const s of ivSlices) {
      if (s.dte_days <= frontSlice.dte_days) continue;
      const dist = Math.abs(s.dte_days - 30);
      if (dist < bestDist) {
        bestDist = dist;
        mid30dSlice = s;
      }
    }
  }

  const frontIv = frontSlice?.atm_iv_pct ?? null;
  const mid30dIv = mid30dSlice?.atm_iv_pct ?? null;
  const termSlope =
    frontIv !== null && mid30dIv !== null ? round(mid30dIv - frontIv, 2) : null;

  let structure: VolTermStructure = "FLAT";
  if (termSlope !== null) {
    if (termSlope > 1.5) structure = "CONTANGO";
    else if (termSlope < -1.5) structure = "BACKWARDATION";
  }

  const frontSkew = frontSlice?.otm_skew_iv_pts ?? null;
  let skewRegime: SkewRegime = "BALANCED";
  if (frontSkew !== null) {
    if (frontSkew > 1.5) skewRegime = "PUT_PREMIUM";
    else if (frontSkew < -1.5) skewRegime = "CALL_PREMIUM";
  }

  // Nearest major expiry: first expiry >= 0.5 DTE holding >= 5% of total OI (fallback: nearest >= 0.5 DTE with OI > 0)
  const majorThreshold = totalOi * 0.05;
  const majorCandidate =
    allSlices.find(
      (s) => s.slice.dte_days >= 0.5 && s.slice.call_oi + s.slice.put_oi >= majorThreshold && totalOi > 0
    ) ??
    allSlices.find((s) => s.slice.dte_days >= 0.5 && s.slice.call_oi + s.slice.put_oi > 0) ??
    allSlices.find((s) => s.slice.call_oi + s.slice.put_oi > 0) ??
    null;

  let nearestMajorExpiry: OptionsSurfaceResponse["nearest_major_expiry"] = null;
  if (majorCandidate) {
    const maxPainStrike = computeMaxPainStrike(majorCandidate.contracts, spotPrice);
    nearestMajorExpiry = {
      expiry_code: majorCandidate.slice.expiry_code,
      expiry_iso: majorCandidate.slice.expiry_iso,
      dte_days: majorCandidate.slice.dte_days,
      max_pain_strike: maxPainStrike,
      max_pain_distance_pct:
        maxPainStrike !== null
          ? round(((maxPainStrike - spotPrice) / spotPrice) * 100, 2)
          : null,
      top_call_walls: computeTopWalls(majorCandidate.contracts, "C", spotPrice, 3),
      top_put_walls: computeTopWalls(majorCandidate.contracts, "P", spotPrice, 3),
    };
  }

  return {
    venue: "deribit",
    currency,
    spot_index_price: round(spotPrice, 2),
    summary: {
      total_contracts: activeContracts.length,
      total_open_interest_contracts: round(totalOi, 2),
      total_open_interest_usd: round(totalOi * spotPrice, 2),
      call_open_interest_contracts: round(callOi, 2),
      put_open_interest_contracts: round(putOi, 2),
      put_call_oi_ratio: callOi > 0 ? round(putOi / callOi, 4) : null,
      volume_24h_contracts: round(totalVol, 2),
      volume_24h_usd: round(totalVol * spotPrice, 2),
      put_call_volume_ratio: callVol > 0 ? round(putVol / callVol, 4) : null,
    },
    vol_regime: {
      front_atm_iv_pct: frontIv,
      mid_30d_atm_iv_pct: mid30dIv,
      term_slope_iv_pts: termSlope,
      structure,
      front_skew_iv_pts: frontSkew,
      skew_regime: skewRegime,
    },
    nearest_major_expiry: nearestMajorExpiry,
    term_structure: allSlices.slice(0, 8).map((s) => s.slice),
    metadata: {
      fetched_at: ts,
      sources: ["deribit"],
      disclaimer: DISCLAIMER,
    },
  };
}
