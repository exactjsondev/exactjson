import { DISCLAIMER } from "../../../config/catalog";
import { roundTo } from "../../../lib/numbers";
import type { ValidationResult } from "../../../lib/validation";
import type { NyFedRateObservation } from "../../../types";
import {
  type BisAreaRateSeries,
  type BocRatesSnapshot,
  EUROZONE_MEMBER_CODES,
  type EcbRatesSnapshot,
} from "../providers/globalRatesFeeds";

interface CentralBankMeta {
  readonly area: string;
  readonly countryName: string;
  readonly currency: string;
  readonly isG10: boolean;
}

const CENTRAL_BANK_META: Readonly<Record<string, CentralBankMeta>> = {
  US: { area: "US", countryName: "United States", currency: "USD", isG10: true },
  XM: { area: "XM", countryName: "Euro Area (ECB)", currency: "EUR", isG10: true },
  JP: { area: "JP", countryName: "Japan", currency: "JPY", isG10: true },
  GB: { area: "GB", countryName: "United Kingdom", currency: "GBP", isG10: true },
  CA: { area: "CA", countryName: "Canada", currency: "CAD", isG10: true },
  AU: { area: "AU", countryName: "Australia", currency: "AUD", isG10: true },
  NZ: { area: "NZ", countryName: "New Zealand", currency: "NZD", isG10: true },
  CH: { area: "CH", countryName: "Switzerland", currency: "CHF", isG10: true },
  SE: { area: "SE", countryName: "Sweden", currency: "SEK", isG10: true },
  NO: { area: "NO", countryName: "Norway", currency: "NOK", isG10: true },
  DK: { area: "DK", countryName: "Denmark", currency: "DKK", isG10: false },
  IS: { area: "IS", countryName: "Iceland", currency: "ISK", isG10: false },
  CN: { area: "CN", countryName: "China", currency: "CNY", isG10: false },
  HK: { area: "HK", countryName: "Hong Kong SAR", currency: "HKD", isG10: false },
  IN: { area: "IN", countryName: "India", currency: "INR", isG10: false },
  ID: { area: "ID", countryName: "Indonesia", currency: "IDR", isG10: false },
  KR: { area: "KR", countryName: "South Korea", currency: "KRW", isG10: false },
  MY: { area: "MY", countryName: "Malaysia", currency: "MYR", isG10: false },
  PH: { area: "PH", countryName: "Philippines", currency: "PHP", isG10: false },
  TH: { area: "TH", countryName: "Thailand", currency: "THB", isG10: false },
  BR: { area: "BR", countryName: "Brazil", currency: "BRL", isG10: false },
  MX: { area: "MX", countryName: "Mexico", currency: "MXN", isG10: false },
  CL: { area: "CL", countryName: "Chile", currency: "CLP", isG10: false },
  CO: { area: "CO", countryName: "Colombia", currency: "COP", isG10: false },
  PE: { area: "PE", countryName: "Peru", currency: "PEN", isG10: false },
  AR: { area: "AR", countryName: "Argentina", currency: "ARS", isG10: false },
  PL: { area: "PL", countryName: "Poland", currency: "PLN", isG10: false },
  CZ: { area: "CZ", countryName: "Czechia", currency: "CZK", isG10: false },
  HU: { area: "HU", countryName: "Hungary", currency: "HUF", isG10: false },
  RO: { area: "RO", countryName: "Romania", currency: "RON", isG10: false },
  RS: { area: "RS", countryName: "Serbia", currency: "RSD", isG10: false },
  MK: { area: "MK", countryName: "North Macedonia", currency: "MKD", isG10: false },
  RU: { area: "RU", countryName: "Russia", currency: "RUB", isG10: false },
  TR: { area: "TR", countryName: "Turkey", currency: "TRY", isG10: false },
  IL: { area: "IL", countryName: "Israel", currency: "ILS", isG10: false },
  SA: { area: "SA", countryName: "Saudi Arabia", currency: "SAR", isG10: false },
  KW: { area: "KW", countryName: "Kuwait", currency: "KWD", isG10: false },
  ZA: { area: "ZA", countryName: "South Africa", currency: "ZAR", isG10: false },
  MA: { area: "MA", countryName: "Morocco", currency: "MAD", isG10: false },
};

const CURRENCY_TO_AREA: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(CENTRAL_BANK_META).map((m) => [m.currency, m.area])
);

export type GlobalRatesGroup = "all" | "g10" | "em" | "hiking" | "cutting";

const VALID_GROUPS: ReadonlySet<GlobalRatesGroup> = new Set([
  "all",
  "g10",
  "em",
  "hiking",
  "cutting",
]);

export interface GlobalRatesInput {
  baseArea: string;
  baseCurrency: string;
  group: GlobalRatesGroup;
  countriesFilter: string[] | null;
  mappedEurozoneInputs: string[];
}

export function resolveJurisdictionCode(
  rawCode: string
): { area: string; mappedFromEurozone: boolean } | null {
  const token = rawCode.trim().toUpperCase();
  if (!token) return null;
  if (token === "EU" || token === "EZ" || token === "EA" || token === "U2" || token === "EUR") {
    return { area: "XM", mappedFromEurozone: false };
  }
  if (token === "UK") {
    return { area: "GB", mappedFromEurozone: false };
  }
  if (token === "CNH" || token === "RMB") {
    return { area: "CN", mappedFromEurozone: false };
  }
  if (EUROZONE_MEMBER_CODES.has(token)) {
    return { area: "XM", mappedFromEurozone: true };
  }
  if (Object.hasOwn(CENTRAL_BANK_META, token)) {
    return { area: token, mappedFromEurozone: false };
  }
  if (Object.hasOwn(CURRENCY_TO_AREA, token)) {
    const area = CURRENCY_TO_AREA[token];
    if (area) return { area, mappedFromEurozone: false };
  }
  return null;
}

export function parseGlobalRatesInput(raw: {
  base?: string;
  group?: string;
  countries?: string;
}): ValidationResult<GlobalRatesInput> {
  const mappedEurozoneInputs: string[] = [];

  let baseArea = "US";
  if (raw.base !== undefined && raw.base.trim().length > 0) {
    if (raw.base.length > 16) {
      return { ok: false, error: "Parameter 'base' is too long." };
    }
    const resolved = resolveJurisdictionCode(raw.base);
    if (!resolved) {
      return {
        ok: false,
        error: `Unsupported 'base' currency or jurisdiction '${raw.base.trim()}'. Supported examples: USD, EUR, JPY, GBP, CHF, CAD, AUD, XM, US.`,
      };
    }
    baseArea = resolved.area;
    if (resolved.mappedFromEurozone) {
      mappedEurozoneInputs.push(raw.base.trim().toUpperCase());
    }
  }

  let group: GlobalRatesGroup = "all";
  if (raw.group !== undefined && raw.group.trim().length > 0) {
    const g = raw.group.trim().toLowerCase() as GlobalRatesGroup;
    if (!VALID_GROUPS.has(g)) {
      return {
        ok: false,
        error: "Invalid 'group' filter. Supported values: all, g10, em, hiking, cutting.",
      };
    }
    group = g;
  }

  let countriesFilter: string[] | null = null;
  if (raw.countries !== undefined && raw.countries.trim().length > 0) {
    if (raw.countries.length > 160) {
      return { ok: false, error: "Parameter 'countries' is too long (max 160 chars)." };
    }
    const parts = raw.countries.split(",");
    if (parts.length > 25) {
      return { ok: false, error: "Parameter 'countries' supports at most 25 comma-separated codes." };
    }
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        return { ok: false, error: "Parameter 'countries' contains an empty entry." };
      }
      const resolved = resolveJurisdictionCode(trimmed);
      if (!resolved) {
        return {
          ok: false,
          error: `Unsupported country/currency code '${trimmed}' in 'countries' parameter.`,
        };
      }
      if (resolved.mappedFromEurozone) {
        mappedEurozoneInputs.push(trimmed.toUpperCase());
      }
      if (!seen.has(resolved.area)) {
        seen.add(resolved.area);
        deduped.push(resolved.area);
      }
    }
    countriesFilter = deduped;
  }

  const baseCurrency = CENTRAL_BANK_META[baseArea]?.currency ?? "USD";
  return {
    ok: true,
    value: {
      baseArea,
      baseCurrency,
      group,
      countriesFilter,
      mappedEurozoneInputs: [...new Set(mappedEurozoneInputs)],
    },
  };
}

export function computeGlobalRates(params: {
  input: GlobalRatesInput;
  bisSeries: BisAreaRateSeries[];
  ecb: EcbRatesSnapshot | null;
  boc: BocRatesSnapshot | null;
  effr: NyFedRateObservation[] | undefined;
  sofr: NyFedRateObservation[] | undefined;
  sources: string[];
  missingSources: string[];
  nowMs?: number;
}) {
  const {
    input,
    bisSeries,
    ecb,
    boc,
    effr,
    sofr,
    sources,
    missingSources,
    nowMs = Date.now(),
  } = params;

  const latestEffr = effr?.[0];
  const latestSofr = sofr?.[0];
  const fedTargetLow = latestEffr?.targetRateFrom ?? null;
  const fedTargetHigh = latestEffr?.targetRateTo ?? null;
  const fedMidpoint =
    fedTargetLow !== null && fedTargetHigh !== null
      ? roundTo((fedTargetLow + fedTargetHigh) / 2, 4)
      : null;

  interface EnrichedBankRow {
    area: string;
    country_name: string;
    currency: string;
    is_g10: boolean;
    policy_rate_pct: number;
    as_of_date: string;
    rate_3m_ago_pct: number | null;
    rate_12m_ago_pct: number | null;
    change_3m_bps: number | null;
    change_12m_bps: number | null;
    cycle_regime: "HIKING" | "CUTTING" | "ON_HOLD";
    overnight_benchmark_pct: number | null;
  }

  const allBanks: EnrichedBankRow[] = bisSeries.map((row) => {
    const knownMeta = Object.hasOwn(CENTRAL_BANK_META, row.area)
      ? CENTRAL_BANK_META[row.area]
      : undefined;
    const meta = knownMeta ?? {
      area: row.area,
      countryName: row.area,
      currency: row.area,
      isG10: false,
    };

    let policyRate = row.latestRatePct;
    let asOfDate = row.latestPeriod;
    let overnightBenchmark: number | null = null;

    if (row.area === "US") {
      if (fedMidpoint !== null && latestEffr?.effectiveDate && latestEffr.effectiveDate >= asOfDate) {
        policyRate = fedMidpoint;
        asOfDate = latestEffr.effectiveDate;
      }
      overnightBenchmark = latestSofr?.percentRate ?? latestEffr?.percentRate ?? null;
    } else if (row.area === "XM" && ecb) {
      if (
        ecb.depositFacilityPct !== null &&
        ecb.keyRateDate &&
        ecb.keyRateDate >= asOfDate.slice(0, 10)
      ) {
        policyRate = ecb.depositFacilityPct;
        asOfDate = ecb.keyRateDate;
      }
      overnightBenchmark = ecb.estrPct;
    } else if (row.area === "CA" && boc) {
      if (
        boc.targetOvernightPct !== null &&
        boc.targetDate &&
        boc.targetDate >= asOfDate.slice(0, 10)
      ) {
        policyRate = boc.targetOvernightPct;
        asOfDate = boc.targetDate;
      }
      overnightBenchmark = boc.corraPct;
    }

    const change3mBps =
      row.rate3mAgoPct !== null ? roundTo((policyRate - row.rate3mAgoPct) * 100, 1) : null;
    const change12mBps =
      row.rate12mAgoPct !== null ? roundTo((policyRate - row.rate12mAgoPct) * 100, 1) : null;

    const cycleDiff = change12mBps ?? change3mBps ?? 0;
    const cycleRegime: "HIKING" | "CUTTING" | "ON_HOLD" =
      cycleDiff >= 10 ? "HIKING" : cycleDiff <= -10 ? "CUTTING" : "ON_HOLD";

    return {
      area: row.area,
      country_name: meta.countryName,
      currency: meta.currency,
      is_g10: meta.isG10,
      policy_rate_pct: roundTo(policyRate, 4),
      as_of_date: asOfDate,
      rate_3m_ago_pct: row.rate3mAgoPct !== null ? roundTo(row.rate3mAgoPct, 4) : null,
      rate_12m_ago_pct: row.rate12mAgoPct !== null ? roundTo(row.rate12mAgoPct, 4) : null,
      change_3m_bps: change3mBps,
      change_12m_bps: change12mBps,
      cycle_regime: cycleRegime,
      overnight_benchmark_pct:
        overnightBenchmark !== null ? roundTo(overnightBenchmark, 4) : null,
    };
  });

  const baseBank = allBanks.find((b) => b.area === input.baseArea);
  const resolvedBaseRatePct: number | null =
    baseBank?.policy_rate_pct ??
    (input.baseArea === "US" && fedMidpoint !== null
      ? fedMidpoint
      : input.baseArea === "XM" &&
          ecb?.depositFacilityPct !== null &&
          ecb?.depositFacilityPct !== undefined
        ? ecb.depositFacilityPct
        : input.baseArea === "CA" &&
            boc?.targetOvernightPct !== null &&
            boc?.targetOvernightPct !== undefined
          ? boc.targetOvernightPct
          : null);

  if (resolvedBaseRatePct === null) {
    return null;
  }
  const baseRatePct = resolvedBaseRatePct;

  const withSpread = allBanks.map((b) => ({
    ...b,
    carry_spread_vs_base_bps: roundTo((b.policy_rate_pct - baseRatePct) * 100, 1),
  }));

  // Global summary across all active central banks before user slice filter
  const sortedByRateAsc = [...withSpread].sort((a, b) => a.policy_rate_pct - b.policy_rate_pct);
  const midIdx = Math.floor(sortedByRateAsc.length / 2);
  const medianRate =
    sortedByRateAsc.length === 0
      ? 0
      : sortedByRateAsc.length % 2 === 1
        ? (sortedByRateAsc[midIdx]?.policy_rate_pct ?? 0)
        : roundTo(
            ((sortedByRateAsc[midIdx - 1]?.policy_rate_pct ?? 0) +
              (sortedByRateAsc[midIdx]?.policy_rate_pct ?? 0)) /
              2,
            3
          );

  const highestRow = sortedByRateAsc[sortedByRateAsc.length - 1] ?? null;
  const lowestRow = sortedByRateAsc[0] ?? null;

  const hikingCount = withSpread.filter((b) => b.cycle_regime === "HIKING").length;
  const cuttingCount = withSpread.filter((b) => b.cycle_regime === "CUTTING").length;
  const onHoldCount = withSpread.filter((b) => b.cycle_regime === "ON_HOLD").length;

  const globalCycleBias: "NET_EASING" | "NET_TIGHTENING" | "BALANCED" =
    cuttingCount - hikingCount >= 3
      ? "NET_EASING"
      : hikingCount - cuttingCount >= 3
        ? "NET_TIGHTENING"
        : "BALANCED";

  const countryAllowSet = input.countriesFilter ? new Set(input.countriesFilter) : null;
  const filtered = withSpread
    .filter((b) => {
      if (countryAllowSet && !countryAllowSet.has(b.area)) return false;
      if (input.group === "g10") return b.is_g10;
      if (input.group === "em") return !b.is_g10;
      if (input.group === "hiking") return b.cycle_regime === "HIKING";
      if (input.group === "cutting") return b.cycle_regime === "CUTTING";
      return true;
    })
    .sort((a, b) => {
      if (a.is_g10 !== b.is_g10) return a.is_g10 ? -1 : 1;
      return b.policy_rate_pct - a.policy_rate_pct;
    });

  const topPositiveCarry = [...withSpread]
    .filter((b) => b.area !== input.baseArea && b.carry_spread_vs_base_bps > 0)
    .sort((a, b) => b.carry_spread_vs_base_bps - a.carry_spread_vs_base_bps)
    .slice(0, 5)
    .map((b) => ({
      area: b.area,
      currency: b.currency,
      policy_rate_pct: b.policy_rate_pct,
      carry_spread_vs_base_bps: b.carry_spread_vs_base_bps,
    }));

  const topFunding = [...sortedByRateAsc]
    .slice(0, 5)
    .map((b) => ({
      area: b.area,
      currency: b.currency,
      policy_rate_pct: b.policy_rate_pct,
      carry_spread_vs_base_bps: b.carry_spread_vs_base_bps,
    }));

  const jpyRow = withSpread.find((b) => b.area === "JP") ?? null;

  const estrDfSpreadBps =
    ecb?.estrPct !== null &&
    ecb?.estrPct !== undefined &&
    ecb.depositFacilityPct !== null
      ? roundTo((ecb.estrPct - ecb.depositFacilityPct) * 100, 1)
      : null;

  const corraTargetSpreadBps =
    boc?.corraPct !== null &&
    boc?.corraPct !== undefined &&
    boc.targetOvernightPct !== null
      ? roundTo((boc.corraPct - boc.targetOvernightPct) * 100, 1)
      : null;

  const flags: string[] = [];
  if (input.mappedEurozoneInputs.length > 0) {
    flags.push("EUROZONE_MEMBER_MAPPED_TO_ECB_XM");
  }
  if (globalCycleBias === "NET_EASING") {
    flags.push("GLOBAL_EASING_CYCLE_DOMINANT");
  } else if (globalCycleBias === "NET_TIGHTENING") {
    flags.push("GLOBAL_TIGHTENING_CYCLE_DOMINANT");
  }
  if (missingSources.length > 0) {
    flags.push("PARTIAL_G4_OVERNIGHT_FEED");
  }

  return {
    filters: {
      base_currency: input.baseCurrency,
      base_area: input.baseArea,
      base_rate_pct: roundTo(baseRatePct, 4),
      group: input.group,
      countries_filter: input.countriesFilter,
    },
    global_summary: {
      active_central_banks: withSpread.length,
      returned_count: filtered.length,
      hiking_12m_count: hikingCount,
      cutting_12m_count: cuttingCount,
      on_hold_12m_count: onHoldCount,
      median_policy_rate_pct: medianRate,
      highest_rate: highestRow
        ? {
            area: highestRow.area,
            currency: highestRow.currency,
            rate_pct: highestRow.policy_rate_pct,
          }
        : null,
      lowest_rate: lowestRow
        ? {
            area: lowestRow.area,
            currency: lowestRow.currency,
            rate_pct: lowestRow.policy_rate_pct,
          }
        : null,
      global_cycle_bias: globalCycleBias,
    },
    g4_money_markets: {
      usd_fed: {
        target_low_pct: fedTargetLow,
        target_high_pct: fedTargetHigh,
        midpoint_pct: fedMidpoint,
        effr_pct: latestEffr?.percentRate ?? null,
        sofr_pct: latestSofr?.percentRate ?? null,
        as_of_date: latestEffr?.effectiveDate ?? latestSofr?.effectiveDate ?? null,
      },
      eur_ecb: ecb
        ? {
            deposit_facility_pct: ecb.depositFacilityPct,
            main_refinancing_pct: ecb.mainRefinancingPct,
            marginal_lending_pct: ecb.marginalLendingPct,
            estr_pct: ecb.estrPct,
            estr_df_spread_bps: estrDfSpreadBps,
            as_of_date: ecb.estrDate ?? ecb.keyRateDate,
          }
        : null,
      cad_boc: boc
        ? {
            target_overnight_pct: boc.targetOvernightPct,
            corra_pct: boc.corraPct,
            corra_target_spread_bps: corraTargetSpreadBps,
            as_of_date: boc.corraDate ?? boc.targetDate,
          }
        : null,
      jpy_boj: jpyRow
        ? {
            policy_rate_pct: jpyRow.policy_rate_pct,
            as_of_date: jpyRow.as_of_date,
          }
        : null,
    },
    central_banks: filtered,
    top_positive_carry_vs_base: topPositiveCarry,
    top_funding_currencies: topFunding,
    flags,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      missing_sources: missingSources,
      disclaimer: DISCLAIMER,
    },
  };
}
