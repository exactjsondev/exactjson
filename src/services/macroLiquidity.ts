import { DISCLAIMER } from "../config/catalog";
import type {
  FundingStressRegime,
  LiquidityImpulseRegime,
  MacroLiquidityResponse,
  NyFedRateObservation,
  NyFedRrpObservation,
  TreasuryDebtObservation,
  TreasuryTgaObservation,
} from "../types";

function round(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export interface MacroLiquidityInput {
  debt?: TreasuryDebtObservation[];
  tga?: TreasuryTgaObservation[];
  rrp?: NyFedRrpObservation[];
  sofr?: NyFedRateObservation[];
  effr?: NyFedRateObservation[];
  lookbackObs: number;
  sources: string[];
  missingSources: string[];
  fetchedAt?: string;
}

function computeDeltas(
  series: number[],
  lookbackObs: number
): { dailyChange: number | null; periodChange: number | null } {
  if (series.length < 2) {
    return { dailyChange: null, periodChange: null };
  }
  const latest = series[0]!;
  const prev = series[1]!;
  const lookbackIdx = Math.min(Math.max(1, lookbackObs), series.length - 1);
  const base = series[lookbackIdx]!;
  return {
    dailyChange: round(latest - prev, 2),
    periodChange: round(latest - base, 2),
  };
}

export function computeMacroLiquidity(input: MacroLiquidityInput): MacroLiquidityResponse {
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const { lookbackObs } = input;

  // 1. US Federal Debt
  let usDebt: MacroLiquidityResponse["us_debt"] = null;
  if (input.debt && input.debt.length > 0) {
    const latest = input.debt[0]!;
    const deltas = computeDeltas(
      input.debt.map((d) => d.totalPublicDebtUsd),
      lookbackObs
    );
    usDebt = {
      record_date: latest.recordDate,
      total_public_debt_usd: round(latest.totalPublicDebtUsd, 2),
      debt_held_public_usd:
        latest.debtHeldPublicUsd !== null ? round(latest.debtHeldPublicUsd, 2) : null,
      intragov_holdings_usd:
        latest.intragovHoldingsUsd !== null ? round(latest.intragovHoldingsUsd, 2) : null,
      daily_change_usd: deltas.dailyChange,
      period_change_usd: deltas.periodChange,
    };
  }

  // 2. Treasury General Account (TGA)
  let tga: MacroLiquidityResponse["tga"] = null;
  let tgaLiquidityEffect: number | null = null;
  if (input.tga && input.tga.length > 0) {
    const latest = input.tga[0]!;
    const deltas = computeDeltas(
      input.tga.map((d) => d.closingBalanceUsd),
      lookbackObs
    );
    tga = {
      record_date: latest.recordDate,
      closing_balance_usd: round(latest.closingBalanceUsd, 2),
      daily_change_usd: deltas.dailyChange,
      period_change_usd: deltas.periodChange,
    };
    // Rising TGA drains market liquidity (-ΔTGA); falling TGA injects liquidity
    if (deltas.periodChange !== null) {
      tgaLiquidityEffect = round(-deltas.periodChange, 2);
    }
  }

  // 3. NY Fed Overnight Reverse Repo (ON RRP)
  let onRrp: MacroLiquidityResponse["on_rrp"] = null;
  let rrpLiquidityEffect: number | null = null;
  if (input.rrp && input.rrp.length > 0) {
    const latest = input.rrp[0]!;
    const deltas = computeDeltas(
      input.rrp.map((d) => d.acceptedUsd),
      lookbackObs
    );
    onRrp = {
      operation_date: latest.operationDate,
      accepted_usd: round(latest.acceptedUsd, 2),
      award_rate_pct: latest.awardRatePct !== null ? round(latest.awardRatePct, 4) : null,
      counterparties_accepted: latest.counterpartiesAccepted,
      daily_change_usd: deltas.dailyChange,
      period_change_usd: deltas.periodChange,
    };
    // Rising ON RRP drains cash from private markets (-ΔRRP); falling ON RRP injects liquidity
    if (deltas.periodChange !== null) {
      rrpLiquidityEffect = round(-deltas.periodChange, 2);
    }
  }

  // 4. Overnight Funding Rates (EFFR & SOFR)
  const latestEffr = input.effr?.[0] ?? null;
  const latestSofr = input.sofr?.[0] ?? null;

  let sofrEffrSpreadBps: number | null = null;
  let fundingStressRegime: FundingStressRegime | null = null;
  if (latestSofr !== null && latestEffr !== null) {
    sofrEffrSpreadBps = round((latestSofr.percentRate - latestEffr.percentRate) * 100, 2);
    if (sofrEffrSpreadBps >= 5) {
      fundingStressRegime = "TIGHT";
    } else if (sofrEffrSpreadBps <= -5) {
      fundingStressRegime = "LOOSE";
    } else {
      fundingStressRegime = "NORMAL";
    }
  }

  // 5. Net Short-Term Liquidity Impulse (-ΔTGA - ΔRRP)
  let combinedNetImpulse: number | null = null;
  if (tgaLiquidityEffect !== null || rrpLiquidityEffect !== null) {
    combinedNetImpulse = round((tgaLiquidityEffect ?? 0) + (rrpLiquidityEffect ?? 0), 2);
  }

  let impulseRegime: LiquidityImpulseRegime = "NEUTRAL";
  if (combinedNetImpulse !== null) {
    if (combinedNetImpulse >= 10_000_000_000) {
      impulseRegime = "EXPANDING";
    } else if (combinedNetImpulse <= -10_000_000_000) {
      impulseRegime = "CONTRACTING";
    }
  }

  return {
    lookback_obs: lookbackObs,
    us_debt: usDebt,
    tga,
    on_rrp: onRrp,
    rates: {
      effr_date: latestEffr?.effectiveDate ?? null,
      effr_pct: latestEffr ? round(latestEffr.percentRate, 4) : null,
      fomc_target_low_pct:
        latestEffr?.targetRateFrom != null ? round(latestEffr.targetRateFrom, 4) : null,
      fomc_target_high_pct:
        latestEffr?.targetRateTo != null ? round(latestEffr.targetRateTo, 4) : null,
      sofr_date: latestSofr?.effectiveDate ?? null,
      sofr_pct: latestSofr ? round(latestSofr.percentRate, 4) : null,
      sofr_volume_billions:
        latestSofr?.volumeInBillions != null ? round(latestSofr.volumeInBillions, 2) : null,
      sofr_effr_spread_bps: sofrEffrSpreadBps,
      funding_stress_regime: fundingStressRegime,
    },
    liquidity_impulse: {
      lookback_obs: lookbackObs,
      tga_liquidity_effect_usd: tgaLiquidityEffect,
      rrp_liquidity_effect_usd: rrpLiquidityEffect,
      combined_net_impulse_usd: combinedNetImpulse,
      regime: impulseRegime,
    },
    metadata: {
      fetched_at: fetchedAt,
      sources: [...input.sources],
      missing_sources: [...input.missingSources],
      disclaimer: DISCLAIMER,
    },
  };
}
