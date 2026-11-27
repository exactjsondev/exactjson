import { WORLD_DISCLAIMER } from "../../../config/catalog/world";
import { computeSolarTwilight } from "../geoMath";
import type { MetNorwayStep } from "../providers/metNorway";
import { MONTH_KEYS, type MonthKey, type NasaPowerClimatology } from "../providers/nasaPower";

export interface OperatingWindowBlock {
  start_utc: string;
  end_utc: string;
  duration_hours: number;
  max_wind_ms: number;
}

export function computeSiteWindow(
  site: { lat: number; lon: number; iata: string | null; date: string; maxWindMs: number },
  climatology: NasaPowerClimatology,
  metSteps: readonly MetNorwayStep[],
  nowMs: number
) {
  const twilight = computeSolarTwilight(site.lat, site.lon, site.date);

  const monthIdx = Number.parseInt(site.date.slice(5, 7), 10) - 1;
  const targetMonth: MonthKey = MONTH_KEYS[Math.max(0, Math.min(11, monthIdx))]!;
  const targetMonthGhi = climatology.monthlyGhi[targetMonth];
  const targetMonthClr = climatology.monthlyClearSkyGhi[targetMonth];
  const clearnessRatio =
    targetMonthGhi !== null && targetMonthClr !== null && targetMonthClr > 0
      ? Math.round(Math.min(1, targetMonthGhi / targetMonthClr) * 100) / 100
      : null;

  let peakMonth: { month: MonthKey; ghi_kwh_m2_day: number } | null = null;
  let lowestMonth: { month: MonthKey; ghi_kwh_m2_day: number } | null = null;

  for (const m of MONTH_KEYS) {
    const val = climatology.monthlyGhi[m];
    if (val === null) continue;
    if (!peakMonth || val > peakMonth.ghi_kwh_m2_day) {
      peakMonth = { month: m, ghi_kwh_m2_day: val };
    }
    if (!lowestMonth || val < lowestMonth.ghi_kwh_m2_day) {
      lowestMonth = { month: m, ghi_kwh_m2_day: val };
    }
  }

  // Standard 0.80 system performance ratio (derates inverter, wiring, and thermal losses)
  const annualYieldPerKwp =
    climatology.annualGhiKwhM2Day !== null
      ? Math.round(climatology.annualGhiKwhM2Day * 365 * 0.8 * 10) / 10
      : null;

  const horizon72hMs = nowMs + 72 * 3_600_000;
  const horizon7dMs = nowMs + 7 * 86_400_000;
  const maxGustMs = site.maxWindMs * 1.4;

  let dispatchable72h = 0;
  let dispatchable7d = 0;
  const windows: OperatingWindowBlock[] = [];
  let activeWin: { startMs: number; endMs: number; hours: number; maxWind: number } | null = null;

  for (const st of metSteps) {
    const rawStepEndMs = st.timeMs + st.stepHours * 3_600_000;
    if (rawStepEndMs <= nowMs) continue;
    const stepStartMs = Math.max(st.timeMs, nowMs);
    if (stepStartMs >= horizon7dMs) break;
    const stepEndMs = Math.min(rawStepEndMs, horizon7dMs);
    const clampedHours = Math.round(((stepEndMs - stepStartMs) / 3_600_000) * 100) / 100;
    if (clampedHours <= 0) continue;

    const precipPerHour = st.precipMm / st.stepHours;
    const gustOk = st.windGustMs === null || st.windGustMs <= maxGustMs;
    const stepSafe = st.windSpeedMs <= site.maxWindMs && gustOk && precipPerHour <= 0.2;

    if (stepSafe) {
      dispatchable7d += clampedHours;
      if (stepStartMs < horizon72hMs) {
        const end72h = Math.min(stepEndMs, horizon72hMs);
        dispatchable72h += Math.max(0, (end72h - stepStartMs) / 3_600_000);
      }

      if (activeWin && activeWin.endMs === stepStartMs) {
        activeWin.endMs = stepEndMs;
        activeWin.hours = Math.round((activeWin.hours + clampedHours) * 100) / 100;
        if (st.windSpeedMs > activeWin.maxWind) activeWin.maxWind = st.windSpeedMs;
      } else {
        if (activeWin) {
          windows.push({
            start_utc: new Date(activeWin.startMs).toISOString().replace(".000Z", "Z"),
            end_utc: new Date(activeWin.endMs).toISOString().replace(".000Z", "Z"),
            duration_hours: activeWin.hours,
            max_wind_ms: Math.round(activeWin.maxWind * 10) / 10,
          });
        }
        activeWin = {
          startMs: stepStartMs,
          endMs: stepEndMs,
          hours: clampedHours,
          maxWind: st.windSpeedMs,
        };
      }
    } else if (activeWin) {
      windows.push({
        start_utc: new Date(activeWin.startMs).toISOString().replace(".000Z", "Z"),
        end_utc: new Date(activeWin.endMs).toISOString().replace(".000Z", "Z"),
        duration_hours: activeWin.hours,
        max_wind_ms: Math.round(activeWin.maxWind * 10) / 10,
      });
      activeWin = null;
    }
  }

  dispatchable72h = Math.round(dispatchable72h * 100) / 100;
  dispatchable7d = Math.round(dispatchable7d * 100) / 100;

  if (activeWin) {
    windows.push({
      start_utc: new Date(activeWin.startMs).toISOString().replace(".000Z", "Z"),
      end_utc: new Date(activeWin.endMs).toISOString().replace(".000Z", "Z"),
      duration_hours: activeWin.hours,
      max_wind_ms: Math.round(activeWin.maxWind * 10) / 10,
    });
  }

  const bestWindows = [...windows]
    .sort((a, b) => b.duration_hours - a.duration_hours || a.start_utc.localeCompare(b.start_utc))
    .slice(0, 5);

  return {
    site: {
      latitude: site.lat,
      longitude: site.lon,
      iata: site.iata,
      target_date: site.date,
    },
    twilight_and_daylight: twilight,
    solar_pv_climatology: {
      annual_ghi_kwh_m2_day: climatology.annualGhiKwhM2Day,
      target_month: targetMonth,
      target_month_ghi_kwh_m2_day: targetMonthGhi,
      target_month_clearness_ratio: clearnessRatio,
      peak_month: peakMonth,
      lowest_month: lowestMonth,
      estimated_annual_yield_kwh_per_kwp: annualYieldPerKwp,
    },
    operating_window_7d: {
      max_wind_threshold_ms: site.maxWindMs,
      dispatchable_hours_next_72h: dispatchable72h,
      dispatchable_hours_next_7d: dispatchable7d,
      best_windows: bestWindows,
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: ["nasa_power", "met_norway"],
      disclaimer: WORLD_DISCLAIMER,
    },
  };
}
