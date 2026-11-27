import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchGdacsActiveEvents } from "../providers/gdacs";
import { fetchFcdoTravelAdvice, fetchNagerUpcomingHolidays } from "../providers/travelFeeds";
import { computeDestinationBrief } from "../services/destinationBrief";
import { parseDestinationCountry } from "../validation";

export interface DestinationBriefDeps {
  cache?: BoundedTtlCache;
  referenceCache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createDestinationBriefHandler(deps: DestinationBriefDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const refCache = deps.referenceCache ?? deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseDestinationCountry(c.req.query("country"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_COUNTRY");
      return c.json({ error: "INVALID_COUNTRY", message: parsed.error }, 400);
    }

    const country = parsed.value;
    c.set("query_target", country.alpha2);

    if (!country.fcdoSlug) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "ADVISORY_NOT_AVAILABLE");
      return c.json(
        {
          error: "ADVISORY_NOT_AVAILABLE",
          message: `GOV.UK FCDO publishes foreign travel advice and does not cover domestic UK (${country.alpha2}). Payment was not settled.`,
        },
        404
      );
    }

    const waitUntil = createWaitUntil(c);

    try {
      const [fcdoRes, gdacsRes, holidaysRes] = await Promise.all([
        fetchFcdoTravelAdvice(country.fcdoSlug, cache, fetchImpl, waitUntil),
        fetchGdacsActiveEvents(refCache, fetchImpl, waitUntil),
        fetchNagerUpcomingHolidays(country.alpha2, cache, fetchImpl, waitUntil),
      ]);

      if (fcdoRes.status === "not_found") {
        c.set("cache_status", "MISS");
        c.set("upstream_error", "ADVISORY_NOT_AVAILABLE");
        return c.json(
          {
            error: "ADVISORY_NOT_AVAILABLE",
            message: `No GOV.UK FCDO foreign travel advisory page found for '${country.name}'. Payment was not settled.`,
          },
          404
        );
      }

      const hits = [fcdoRes.cacheHit, gdacsRes.cacheHit, holidaysRes.cacheHit];
      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeDestinationBrief(
        country,
        fcdoRes.data,
        gdacsRes.events,
        holidaysRes.data,
        nowProvider()
      );
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "DESTINATION_BRIEF_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary travel advisory or disaster feed unavailable; refusing to report destination safety status. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const destinationBriefHandler = createDestinationBriefHandler();
