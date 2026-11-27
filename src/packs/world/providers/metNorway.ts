import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export interface MetNorwayStep {
  timeUtc: string;
  timeMs: number;
  stepHours: 1 | 6;
  tempC: number | null;
  windSpeedMs: number;
  windGustMs: number | null;
  cloudPct: number | null;
  precipMm: number;
}

export async function fetchMetNorwayForecast(
  lat: number,
  lon: number,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ steps: MetNorwayStep[]; cacheHit: boolean }> {
  // MET Norway Locationforecast 2.0 ToS recommends <= 4 decimal places for cache friendliness
  const latKey = lat.toFixed(4);
  const lonKey = lon.toFixed(4);

  const { value, cacheHit } = await withTwoTierCache<MetNorwayStep[]>({
    key: `world:metno:${latKey}:${lonKey}`,
    ttlMs: TTL_MS.WORLD_MET_NORWAY,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<{
        properties?: { timeseries?: Array<Record<string, unknown>> };
      }>(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latKey}&lon=${lonKey}`,
        {
          provider: "MET_NORWAY",
          timeoutMs: 5000,
          fetchImpl,
        }
      );

      const timeseries = res.status === "ok" ? res.data?.properties?.timeseries : undefined;
      if (!Array.isArray(timeseries) || timeseries.length === 0) {
        throw new UpstreamError("MET_NORWAY", "MET_NORWAY_BAD_SCHEMA", "Invalid MET Norway forecast payload");
      }

      const steps: MetNorwayStep[] = [];
      for (const item of timeseries) {
        const timeUtc = typeof item?.time === "string" ? item.time : "";
        const timeMs = Date.parse(timeUtc);
        if (!Number.isFinite(timeMs)) continue;

        const dataObj =
          item.data && typeof item.data === "object"
            ? (item.data as Record<string, unknown>)
            : null;
        const instantDetails =
          dataObj?.instant &&
          typeof dataObj.instant === "object" &&
          (dataObj.instant as { details?: unknown }).details &&
          typeof (dataObj.instant as { details?: unknown }).details === "object"
            ? ((dataObj.instant as { details: Record<string, unknown> }).details)
            : null;
        if (!instantDetails) continue;

        const windSpeed = toFiniteNumber(instantDetails.wind_speed);
        if (windSpeed === null || windSpeed < 0) continue;

        const next1 =
          dataObj?.next_1_hours && typeof dataObj.next_1_hours === "object"
            ? (dataObj.next_1_hours as { details?: Record<string, unknown> })
            : null;
        const next6 =
          dataObj?.next_6_hours && typeof dataObj.next_6_hours === "object"
            ? (dataObj.next_6_hours as { details?: Record<string, unknown> })
            : null;

        let stepHours: 1 | 6 = 1;
        let precipMm = 0;
        const p1 = toFiniteNumber(next1?.details?.precipitation_amount);
        const p6 = toFiniteNumber(next6?.details?.precipitation_amount);
        if (p1 !== null && p1 >= 0) {
          stepHours = 1;
          precipMm = p1;
        } else if (p6 !== null && p6 >= 0) {
          stepHours = 6;
          precipMm = p6;
        }

        steps.push({
          timeUtc,
          timeMs,
          stepHours,
          tempC: toFiniteNumber(instantDetails.air_temperature),
          windSpeedMs: windSpeed,
          windGustMs: toFiniteNumber(instantDetails.wind_speed_of_gust),
          cloudPct: toFiniteNumber(instantDetails.cloud_area_fraction),
          precipMm,
        });
        if (steps.length >= 100) break;
      }

      if (steps.length === 0) {
        throw new UpstreamError("MET_NORWAY", "MET_NORWAY_EMPTY", "No valid forecast steps in MET Norway payload");
      }
      return steps;
    },
  });

  return { steps: value, cacheHit };
}
