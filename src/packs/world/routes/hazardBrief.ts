import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchGdacsActiveEvents } from "../providers/gdacs";
import {
  fetchCensusGeocode,
  fetchEpaTriByZip,
  fetchNasaEonetOpenEvents,
  fetchUsgsQuakes,
} from "../providers/geoHazards";
import { fetchMetNorwayForecast } from "../providers/metNorway";
import { computeHazardBrief, type ResolvedHazardLocation } from "../services/hazardBrief";
import { parseGeoHazardInput } from "../validation";

export interface HazardBriefDeps {
  cache?: BoundedTtlCache;
  referenceCache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createHazardBriefHandler(deps: HazardBriefDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const refCache = deps.referenceCache ?? deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseGeoHazardInput({
      lat: c.req.query("lat"),
      lon: c.req.query("lon"),
      iata: c.req.query("iata"),
      address: c.req.query("address"),
      radius_km: c.req.query("radius_km"),
      zip: c.req.query("zip"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_LOCATION");
      return c.json({ error: "INVALID_LOCATION", message: parsed.error }, 400);
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

    const nowMs = nowProvider();
    const waitUntil = createWaitUntil(c);

    try {
      const hits: boolean[] = [];
      let resolved: ResolvedHazardLocation;

      if (parsed.value.mode === "address") {
        c.set("query_target", `addr:${parsed.value.address.slice(0, 48)}`);
        const geoRes = await fetchCensusGeocode(parsed.value.address, cache, fetchImpl, waitUntil);
        hits.push(geoRes.cacheHit);
        if (geoRes.status === "not_found") {
          c.set("cache_status", geoRes.cacheHit ? "HIT" : "MISS");
          c.set("upstream_error", "ADDRESS_NOT_FOUND");
          return c.json(
            {
              error: "ADDRESS_NOT_FOUND",
              message:
                "US Census Geocoder found no street match for 'address'. Pass 'lat' and 'lon' coordinates for non-US or unmatched locations. Payment was not settled.",
            },
            404
          );
        }
        resolved = {
          inputMode: "address",
          label: geoRes.data.matchedAddress,
          lat: geoRes.data.lat,
          lon: geoRes.data.lon,
          radiusKm: parsed.value.radiusKm,
          zip: geoRes.data.zip,
        };
      } else if (parsed.value.mode === "iata") {
        c.set("query_target", `iata:${parsed.value.iata}`);
        resolved = {
          inputMode: "iata",
          label: `${parsed.value.iata} (${parsed.value.name})`,
          lat: parsed.value.lat,
          lon: parsed.value.lon,
          radiusKm: parsed.value.radiusKm,
          zip: parsed.value.zip,
        };
      } else {
        c.set("query_target", parsed.value.label);
        resolved = {
          inputMode: "coords",
          label: parsed.value.label,
          lat: parsed.value.lat,
          lon: parsed.value.lon,
          radiusKm: parsed.value.radiusKm,
          zip: parsed.value.zip,
        };
      }

      const [gdacsRes, usgsRes, eonetRes, metRes, triRes] = await Promise.all([
        fetchGdacsActiveEvents(refCache, fetchImpl, waitUntil),
        fetchUsgsQuakes(resolved.lat, resolved.lon, resolved.radiusKm, nowMs, cache, fetchImpl, waitUntil),
        fetchNasaEonetOpenEvents(refCache, fetchImpl, waitUntil),
        fetchMetNorwayForecast(resolved.lat, resolved.lon, cache, fetchImpl, waitUntil),
        resolved.zip ? fetchEpaTriByZip(resolved.zip, cache, fetchImpl, waitUntil) : Promise.resolve(null),
      ]);

      hits.push(gdacsRes.cacheHit, usgsRes.cacheHit, eonetRes.cacheHit, metRes.cacheHit);
      if (triRes) hits.push(triRes.cacheHit);

      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeHazardBrief(
        resolved,
        gdacsRes.events,
        usgsRes.data,
        eonetRes.events,
        metRes.steps,
        triRes?.data ?? null,
        nowMs
      );
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "GEO_HAZARD_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary physical hazard feed unavailable; refusing to report site hazard brief as clear. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const hazardBriefHandler = createHazardBriefHandler();
