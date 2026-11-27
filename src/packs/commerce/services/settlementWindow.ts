import { COMMERCE_DISCLAIMER } from "../../../config/catalog/commerce";
import {
  CLS_CURRENCIES,
  FRI_SAT_WEEKEND_COUNTRIES,
  SEPA_COUNTRIES,
  getCurrencyMinorUnits,
  type StaticCountry,
} from "../../../lib/countries";
import { roundTo } from "../../../lib/numbers";
import type {
  BankHolidayYearData,
  FrankfurterSeriesData,
  WorldBankCountryMeta,
} from "../providers/settlementFeeds";
import type { SettlementTenor } from "../validation";

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

function isCountryWeekend(alpha2: string, utcDayOfWeek: number): boolean {
  if (FRI_SAT_WEEKEND_COUNTRIES.has(alpha2)) {
    return utcDayOfWeek === 5 || utcDayOfWeek === 6;
  }
  return utcDayOfWeek === 0 || utcDayOfWeek === 6;
}

function getCountryWeekendLabels(alpha2: string): readonly [string, string] {
  return FRI_SAT_WEEKEND_COUNTRIES.has(alpha2)
    ? ["FRIDAY", "SATURDAY"]
    : ["SATURDAY", "SUNDAY"];
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface SkippedSettlementDay {
  date: string;
  day_of_week: string;
  closed_in: string[];
  reasons: string[];
}

export interface ComputeSettlementInput {
  from: StaticCountry;
  to: StaticCountry;
  initiationDate: string;
  tenor: SettlementTenor;
  amount: number | null;
  holidaysByCountryYear: ReadonlyMap<string, BankHolidayYearData>;
  fromWbMeta: WorldBankCountryMeta;
  toWbMeta: WorldBankCountryMeta;
  frankfurterFx: FrankfurterSeriesData | null;
  worldBankCrossRate: { spotRate: number | null; asOfYear: string | null } | null;
  nowMs: number;
}

export function computeSettlementWindow(input: ComputeSettlementInput) {
  const {
    from,
    to,
    initiationDate,
    tenor,
    amount,
    holidaysByCountryYear,
    fromWbMeta,
    toWbMeta,
    frankfurterFx,
    worldBankCrossRate,
    nowMs,
  } = input;

  const initYear = Number(initiationDate.slice(0, 4));
  const fromYearData = holidaysByCountryYear.get(`${from.alpha2}:${initYear}`);
  const toYearData = holidaysByCountryYear.get(`${to.alpha2}:${initYear}`);
  const fromHolSupported = fromYearData?.supported ?? false;
  const toHolSupported = toYearData?.supported ?? false;

  const initMs = Date.parse(`${initiationDate}T00:00:00.000Z`);
  const openDates: string[] = [];
  const allSkipped: SkippedSettlementDay[] = [];

  for (let offset = 0; offset < 35 && openDates.length < 3; offset++) {
    const dayMs = initMs + offset * 86_400_000;
    const dt = new Date(dayMs);
    const dateStr = formatUtcDate(dayMs);
    const dow = dt.getUTCDay();
    const year = dt.getUTCFullYear();

    const closedIn: string[] = [];
    const reasons = new Set<string>();

    const checkJurisdiction = (alpha2: string) => {
      let closed = false;
      if (isCountryWeekend(alpha2, dow)) {
        closed = true;
        reasons.add("WEEKEND");
      }
      const holData = holidaysByCountryYear.get(`${alpha2}:${year}`);
      const holNames =
        holData && Object.hasOwn(holData.holidaysByDate, dateStr)
          ? holData.holidaysByDate[dateStr]!
          : [];
      if (holNames.length > 0) {
        closed = true;
        for (const h of holNames) {
          reasons.add(`HOLIDAY:${alpha2}:${h}`);
        }
      }
      if (closed && !closedIn.includes(alpha2)) {
        closedIn.push(alpha2);
      }
    };

    checkJurisdiction(from.alpha2);
    if (to.alpha2 !== from.alpha2) {
      checkJurisdiction(to.alpha2);
    }

    if (closedIn.length === 0) {
      openDates.push(dateStr);
    } else {
      allSkipped.push({
        date: dateStr,
        day_of_week: DAY_NAMES[dow]!,
        closed_in: closedIn,
        reasons: [...reasons],
      });
    }
  }

  const t0Date = openDates[0] ?? initiationDate;
  const t1Date = openDates[1] ?? t0Date;
  const t2Date = openDates[2] ?? t1Date;
  const selectedDate = tenor === "T+0" ? t0Date : tenor === "T+1" ? t1Date : t2Date;
  const calendarLagDays = Math.max(
    0,
    Math.round((Date.parse(`${selectedDate}T00:00:00.000Z`) - initMs) / 86_400_000)
  );
  const skippedBeforeSelected = allSkipped.filter((s) => s.date < selectedDate);

  const sameCurrency = from.currencyCode === to.currencyCode;
  const sepaCorridor =
    SEPA_COUNTRIES.has(from.alpha2) &&
    SEPA_COUNTRIES.has(to.alpha2) &&
    (from.currencyCode === "EUR" || to.currencyCode === "EUR");
  const clsPvpEligible =
    !sameCurrency && CLS_CURRENCIES.has(from.currencyCode) && CLS_CURRENCIES.has(to.currencyCode);

  const recommendedRail =
    from.alpha2 === to.alpha2
      ? "DOMESTIC_RTGS_OR_INSTANT"
      : sepaCorridor && sameCurrency
        ? "SEPA_SCT_OR_INSTANT"
        : clsPvpEligible
          ? "SWIFT_GPI_OR_CLS"
          : "SWIFT_CORRESPONDENT_WIRE";

  const fromMinorUnits = getCurrencyMinorUnits(from.currencyCode);
  const toMinorUnits = getCurrencyMinorUnits(to.currencyCode);

  // FX rate, 30d realized log-return volatility, and horizon-scaled p95 move
  let rateSource: "same_currency" | "frankfurter_ecb" | "worldbank_official" | "unavailable" =
    "unavailable";
  let asOfDate: string | null = null;
  let spotRate: number | null = null;
  let obsCount = 0;
  let vol30dAnnPct: number | null = null;
  let horizon1SigmaPct: number | null = null;
  let horizonP95Pct: number | null = null;

  if (sameCurrency) {
    rateSource = "same_currency";
    asOfDate = initiationDate;
    spotRate = 1;
    obsCount = 1;
    vol30dAnnPct = 0;
    horizon1SigmaPct = 0;
    horizonP95Pct = 0;
  } else if (frankfurterFx?.supported && frankfurterFx.series.length > 0) {
    rateSource = "frankfurter_ecb";
    asOfDate = frankfurterFx.asOfDate;
    const series = frankfurterFx.series;
    spotRate = roundTo(series[series.length - 1]!.rate, 6);
    obsCount = series.length;

    if (series.length >= 3) {
      const logRets: number[] = [];
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1]!.rate;
        const curr = series[i]!.rate;
        if (prev > 0 && curr > 0) {
          logRets.push(Math.log(curr / prev));
        }
      }
      if (logRets.length >= 2) {
        const mean = logRets.reduce((acc, v) => acc + v, 0) / logRets.length;
        const variance =
          logRets.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (logRets.length - 1);
        const dailyStd = Math.sqrt(variance);
        // Scale exposure over actual calendar transit lag (weekday equiv ~ max(1, calendarLagDays * 5/7))
        const effectiveTradingDays = Math.max(1, (Math.max(1, calendarLagDays) * 5) / 7);
        const h1 = dailyStd * Math.sqrt(effectiveTradingDays) * 100;
        vol30dAnnPct = roundTo(dailyStd * Math.sqrt(252) * 100, 2);
        horizon1SigmaPct = roundTo(h1, 2);
        horizonP95Pct = roundTo(h1 * 1.64485, 2);
      }
    }
  } else if (worldBankCrossRate && worldBankCrossRate.spotRate !== null) {
    rateSource = "worldbank_official";
    asOfDate = worldBankCrossRate.asOfYear;
    spotRate = roundTo(worldBankCrossRate.spotRate, 6);
  }

  let conversion: {
    input_amount: number;
    input_currency: string;
    converted_mid_amount: number | null;
    output_currency: string;
    p95_adverse_buffer_output: number | null;
  } | null = null;

  if (amount !== null) {
    const mid =
      spotRate !== null ? roundTo(amount * spotRate, toMinorUnits) : null;
    const buffer =
      mid !== null && horizonP95Pct !== null
        ? roundTo(mid * (horizonP95Pct / 100), toMinorUnits)
        : null;
    conversion = {
      input_amount: amount,
      input_currency: from.currencyCode,
      converted_mid_amount: mid,
      output_currency: to.currencyCode,
      p95_adverse_buffer_output: buffer,
    };
  }

  const flags: string[] = [];
  if (!fromHolSupported || !toHolSupported) {
    flags.push("PARTIAL_HOLIDAY_CALENDAR");
  }
  if (
    FRI_SAT_WEEKEND_COUNTRIES.has(from.alpha2) !== FRI_SAT_WEEKEND_COUNTRIES.has(to.alpha2)
  ) {
    flags.push("SPLIT_WEEKEND_REGIME_3DAY_OVERLAP");
  }
  if (calendarLagDays >= 4) {
    flags.push("EXTENDED_SETTLEMENT_LAG");
  }
  if (toMinorUnits === 0) {
    flags.push("ZERO_DECIMAL_TARGET_CURRENCY");
  } else if (toMinorUnits === 3) {
    flags.push("THREE_DECIMAL_TARGET_CURRENCY");
  }
  if (rateSource === "worldbank_official") {
    flags.push("NON_ECB_FX_OFFICIAL_ANNUAL_FALLBACK");
  } else if (rateSource === "unavailable") {
    flags.push("FX_RATE_UNAVAILABLE");
  }

  const sources = ["nager_date"];
  if (rateSource === "frankfurter_ecb") sources.push("frankfurter_ecb");
  sources.push("world_bank");

  return {
    corridor: {
      from: {
        alpha2: from.alpha2,
        alpha3: from.alpha3,
        name: from.name,
        currency: from.currencyCode,
        minor_units: fromMinorUnits,
        weekend_days: getCountryWeekendLabels(from.alpha2),
        holiday_calendar_supported: fromHolSupported,
        income_level: fromWbMeta.incomeLevel,
      },
      to: {
        alpha2: to.alpha2,
        alpha3: to.alpha3,
        name: to.name,
        currency: to.currencyCode,
        minor_units: toMinorUnits,
        weekend_days: getCountryWeekendLabels(to.alpha2),
        holiday_calendar_supported: toHolSupported,
        income_level: toWbMeta.incomeLevel,
      },
    },
    rails: {
      same_currency: sameCurrency,
      sepa_corridor: sepaCorridor,
      cls_pvp_eligible: clsPvpEligible,
      recommended_rail: recommendedRail,
    },
    schedule: {
      initiation_date: initiationDate,
      tenor,
      t0_first_mutual_open_date: t0Date,
      t1_settlement_date: t1Date,
      t2_settlement_date: t2Date,
      selected_settlement_date: selectedDate,
      calendar_lag_days: calendarLagDays,
      skipped_days: skippedBeforeSelected,
    },
    fx: {
      pair: `${from.currencyCode}/${to.currencyCode}`,
      rate_source: rateSource,
      as_of_date: asOfDate,
      spot_rate: spotRate,
      observations_30d: obsCount,
      volatility_30d_ann_pct: vol30dAnnPct,
      horizon_1sigma_move_pct: horizon1SigmaPct,
      horizon_p95_move_pct: horizonP95Pct,
      conversion,
    },
    flags,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: COMMERCE_DISCLAIMER,
    },
  };
}
