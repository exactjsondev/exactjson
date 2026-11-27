import type { Context } from "hono";
import { type BoundedTtlCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchSwpcSpaceWeather, fetchThermosphereDrag } from "../providers/spaceWeather";
import { computeWeatherGnss } from "../services/weatherGnss";
import { parseSpaceWeatherInput } from "../validation";

export interface WeatherGnssDeps {
  referenceCache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createWeatherGnssHandler(deps: WeatherGnssDeps = {}) {
  const refCache = deps.referenceCache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseSpaceWeatherInput(c.req.query("lat"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_COORDINATES");
      return c.json({ error: "INVALID_COORDINATES", message: parsed.error }, 400);
    }

    const lat = parsed.value.lat;
    c.set("query_target", lat !== null ? `lat:${lat}` : "global");
    const nowMs = nowProvider();
    const waitUntil = createWaitUntil(c);

    try {
      const [swpcRes, dragRes] = await Promise.all([
        fetchSwpcSpaceWeather(nowMs, refCache, fetchImpl, waitUntil),
        fetchThermosphereDrag(refCache, fetchImpl, waitUntil),
      ]);

      const cacheStatus: CacheStatus =
        swpcRes.cacheHit && dragRes.cacheHit
          ? "HIT"
          : swpcRes.cacheHit || dragRes.cacheHit
            ? "PARTIAL"
            : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeWeatherGnss(lat, swpcRes.data, dragRes.data, nowMs);
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "SPACE_WEATHER_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary NOAA SWPC space weather feed unavailable; refusing to report GNSS/compass conditions as safe. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const weatherGnssHandler = createWeatherGnssHandler();
