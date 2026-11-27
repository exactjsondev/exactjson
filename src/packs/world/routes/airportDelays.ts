import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import {
  type FaaAirportDisruption,
  fetchActiveSigmets,
  fetchAirportMetar,
  fetchAirportTaf,
  fetchFaaNasMap,
} from "../providers/aviation";
import { computeAirportDelays, type FaaSourceStatus } from "../services/airportDelays";
import { parseAirportInput } from "../validation";

export interface AirportDelaysDeps {
  cache?: BoundedTtlCache;
  referenceCache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createAirportDelaysHandler(deps: AirportDelaysDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const refCache = deps.referenceCache ?? deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseAirportInput(c.req.query("airport"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_AIRPORT");
      return c.json({ error: "INVALID_AIRPORT", message: parsed.error }, 400);
    }

    if (!parsed.value.found) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "AIRPORT_NOT_FOUND");
      return c.json(
        {
          error: "AIRPORT_NOT_FOUND",
          message: `Unrecognized 3-letter IATA airport '${parsed.value.rawCode}'. Pass a supported major IATA code or a 4-letter ICAO station code (e.g., KJFK, EGLL, KTEB). Payment was not settled.`,
        },
        404
      );
    }

    const target = parsed.value;
    c.set("query_target", target.iata ?? target.icao);
    const waitUntil = createWaitUntil(c);

    try {
      const shouldQueryFaa = target.isUsFaa && Boolean(target.faaCode);
      const [metarRes, tafRes, sigmetRes, faaRes] = await Promise.all([
        fetchAirportMetar(target.icao, cache, fetchImpl, waitUntil),
        fetchAirportTaf(target.icao, cache, fetchImpl, waitUntil),
        fetchActiveSigmets(refCache, fetchImpl, waitUntil),
        shouldQueryFaa
          ? fetchFaaNasMap(refCache, fetchImpl, waitUntil).catch(() => null)
          : Promise.resolve(undefined),
      ]);

      if (metarRes.metar === null && tafRes.rawTaf === null) {
        c.set("cache_status", "MISS");
        c.set("upstream_error", "AIRPORT_NOT_FOUND");
        return c.json(
          {
            error: "AIRPORT_NOT_FOUND",
            message: `No active METAR or TAF observations found for station '${target.icao}'. Payment was not settled.`,
          },
          404
        );
      }

      const hits = [metarRes.cacheHit, tafRes.cacheHit, sigmetRes.cacheHit];
      let faaStatus: FaaSourceStatus = target.isUsFaa ? "fallback_metar_only" : "not_applicable_non_us";
      let faaDisruptions: FaaAirportDisruption[] = [];

      if (shouldQueryFaa && target.faaCode) {
        if (faaRes) {
          hits.push(faaRes.cacheHit);
          faaStatus = "live";
          faaDisruptions = Object.hasOwn(faaRes.map, target.faaCode)
            ? (faaRes.map[target.faaCode] ?? [])
            : [];
        } else {
          // US FAA NAS cold XML timeouts degrade gracefully to live NOAA METAR/TAF
          faaStatus = "fallback_metar_only";
          faaDisruptions = [];
        }
      }

      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeAirportDelays(
        target,
        metarRes.metar,
        tafRes.rawTaf,
        sigmetRes.sigmets,
        faaStatus,
        faaDisruptions,
        nowProvider()
      );
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "AVIATION_UPSTREAM_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary NOAA AviationWeather feed unavailable; refusing to guess flight safety or airport delay status. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const airportDelaysHandler = createAirportDelaysHandler();
