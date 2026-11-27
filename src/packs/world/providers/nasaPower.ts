import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export const MONTH_KEYS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;
export type MonthKey = (typeof MONTH_KEYS)[number];

export interface NasaPowerClimatology {
  annualGhiKwhM2Day: number | null;
  monthlyGhi: Record<MonthKey, number | null>;
  monthlyClearSkyGhi: Record<MonthKey, number | null>;
}

function sanitizePowerValue(raw: unknown): number | null {
  const num = toFiniteNumber(raw);
  // NASA POWER uses -999 (or -99) as missing/polar-night sentinel; never leak negative irradiance
  if (num === null || num < 0 || num <= -900) return null;
  return Math.round(num * 100) / 100;
}

export async function fetchNasaPowerClimatology(
  lat: number,
  lon: number,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: NasaPowerClimatology; cacheHit: boolean }> {
  // NASA POWER MERRA-2/CERES grid is 0.5° x 0.625°, so 0.1° rounding maximizes cache hits safely
  const latKey = lat.toFixed(1);
  const lonKey = lon.toFixed(1);

  const { value, cacheHit } = await withTwoTierCache<NasaPowerClimatology>({
    key: `world:nasapower:${latKey}:${lonKey}`,
    ttlMs: TTL_MS.SOLAR_NASA_POWER,
    cache,
    waitUntil,
    fetcher: async () => {
      const url =
        `https://power.larc.nasa.gov/api/temporal/climatology/point` +
        `?parameters=ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN&community=RE` +
        `&longitude=${lonKey}&latitude=${latKey}&format=JSON`;

      const res = await fetchJsonWithTimeout<{
        properties?: {
          parameter?: {
            ALLSKY_SFC_SW_DWN?: Record<string, unknown>;
            CLRSKY_SFC_SW_DWN?: Record<string, unknown>;
          };
        };
      }>(url, {
        provider: "NASA_POWER",
        timeoutMs: 6000,
        fetchImpl,
      });

      if (res.status !== "ok") {
        throw new UpstreamError("NASA_POWER", "NASA_POWER_UNAVAILABLE", "NASA POWER climatology unavailable");
      }
      const allSky = res.data?.properties?.parameter?.ALLSKY_SFC_SW_DWN;
      if (!allSky || typeof allSky !== "object") {
        throw new UpstreamError("NASA_POWER", "NASA_POWER_BAD_SCHEMA", "Invalid NASA POWER climatology payload");
      }
      const clrSky = res.data?.properties?.parameter?.CLRSKY_SFC_SW_DWN ?? {};

      const monthlyGhi = {} as Record<MonthKey, number | null>;
      const monthlyClearSkyGhi = {} as Record<MonthKey, number | null>;
      for (const m of MONTH_KEYS) {
        monthlyGhi[m] = sanitizePowerValue(allSky[m]);
        monthlyClearSkyGhi[m] = sanitizePowerValue((clrSky as Record<string, unknown>)[m]);
      }

      if (MONTH_KEYS.every((m) => monthlyGhi[m] === null)) {
        throw new UpstreamError(
          "NASA_POWER",
          "NASA_POWER_NO_DATA",
          "NASA POWER returned missing (-999) irradiance across all months"
        );
      }

      return {
        annualGhiKwhM2Day: sanitizePowerValue(allSky.ANN),
        monthlyGhi,
        monthlyClearSkyGhi,
      };
    },
  });

  return { data: value, cacheHit };
}
