import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchMetNorwayForecast } from "../providers/metNorway";
import { fetchNasaPowerClimatology } from "../providers/nasaPower";
import { computeSiteWindow } from "../services/siteWindow";
import { parseSolarSiteInput } from "../validation";

export interface SiteWindowDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createSiteWindowHandler(deps: SiteWindowDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const nowMs = nowProvider();
    const parsed = parseSolarSiteInput(
      {
        lat: c.req.query("lat"),
        lon: c.req.query("lon"),
        iata: c.req.query("iata"),
        date: c.req.query("date"),
        max_wind_ms: c.req.query("max_wind_ms"),
      },
      nowMs
    );

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_SITE_INPUT");
      return c.json({ error: "INVALID_SITE_INPUT", message: parsed.error }, 400);
    }

    if (parsed.value.mode === "unknown_iata") {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "AIRPORT_NOT_FOUND");
      return c.json(
        {
          error: "AIRPORT_NOT_FOUND",
          message: `Unrecognized 3-letter IATA airport '${parsed.value.iata}'. Pass 'lat' and 'lon' coordinates directly instead. Payment was not settled.`,
        },
        404
      );
    }

    const site = parsed.value;
    c.set("query_target", site.iata ?? `${site.lat},${site.lon}`);
    const waitUntil = createWaitUntil(c);

    try {
      const [powerRes, metRes] = await Promise.all([
        fetchNasaPowerClimatology(site.lat, site.lon, cache, fetchImpl, waitUntil),
        fetchMetNorwayForecast(site.lat, site.lon, cache, fetchImpl, waitUntil),
      ]);

      const cacheStatus: CacheStatus =
        powerRes.cacheHit && metRes.cacheHit
          ? "HIT"
          : powerRes.cacheHit || metRes.cacheHit
            ? "PARTIAL"
            : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeSiteWindow(site, powerRes.data, metRes.steps, nowMs);
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "SOLAR_SITE_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary NASA POWER or MET Norway site feed unavailable; refusing to report incomplete solar/wind operating window. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const siteWindowHandler = createSiteWindowHandler();
