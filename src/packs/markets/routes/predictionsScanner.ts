import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { fetchKalshiMarkets } from "../providers/kalshi";
import { fetchPolymarketMarkets } from "../providers/polymarket";
import { createWaitUntil } from "../../../middleware/telemetry";
import { computePredictionsScanner } from "../services/predictionsScanner";
import type {
  AppBindings,
  CacheStatus,
  PredictionVenueName,
  RawPredictionMarket,
} from "../../../types";

export interface PredictionsScannerDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

const VALID_VENUES = new Set(["all", "polymarket", "kalshi"]);

function parseOptionalNumber(
  raw: string | undefined,
  defaultVal: number,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: defaultVal };
  }
  if (raw.length > 32) {
    return { ok: false, error: "Numeric query parameter too long." };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || Number.isNaN(num) || num < min || num > max) {
    return { ok: false, error: `Expected a finite number between ${min} and ${max}.` };
  }
  return { ok: true, value: num };
}

export function createPredictionsScannerHandler(deps: PredictionsScannerDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const rawVenue = c.req.query("venue")?.trim().toLowerCase() || "all";
    if (!VALID_VENUES.has(rawVenue)) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_VENUE");
      return c.json(
        { error: "INVALID_VENUE", message: "Parameter 'venue' must be 'all', 'polymarket', or 'kalshi'." },
        400
      );
    }
    const venue = rawVenue as "all" | PredictionVenueName;

    const rawQuery = c.req.query("query");
    let query: string | null = null;
    if (rawQuery !== undefined && rawQuery.trim().length > 0) {
      const trimmed = rawQuery.trim();
      if (trimmed.length > 64 || /[\x00-\x1f\x7f]/.test(trimmed)) {
        c.set("cache_status", "NONE");
        c.set("upstream_error", "INVALID_QUERY");
        return c.json(
          { error: "INVALID_QUERY", message: "Parameter 'query' must be 1-64 printable characters." },
          400
        );
      }
      query = trimmed;
    }

    const defaultMinVol = query ? 0 : 1000;
    const parsedMinVol = parseOptionalNumber(
      c.req.query("min_volume_24h_usd"),
      defaultMinVol,
      0,
      1e12
    );
    if (!parsedMinVol.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MIN_VOLUME");
      return c.json({ error: "INVALID_MIN_VOLUME", message: parsedMinVol.error }, 400);
    }

    const parsedLimit = parseOptionalNumber(c.req.query("limit"), 10, 1, 25);
    if (!parsedLimit.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_LIMIT");
      return c.json({ error: "INVALID_LIMIT", message: parsedLimit.error }, 400);
    }

    const minVolume24hUsd = parsedMinVol.value;
    const limit = Math.floor(parsedLimit.value);
    c.set(
      "query_target",
      query ? `venue=${venue},q=${query.slice(0, 32)}` : `venue=${venue},limit=${limit}`
    );

    const waitUntil = createWaitUntil(c);
    const tasks: Array<
      Promise<{ venue: PredictionVenueName; markets: RawPredictionMarket[]; cacheHit: boolean }>
    > = [];

    if (venue === "all" || venue === "polymarket") {
      tasks.push(
        fetchPolymarketMarkets(cache, fetchImpl, waitUntil).then((r) => ({
          venue: "polymarket" as const,
          ...r,
        }))
      );
    }
    if (venue === "all" || venue === "kalshi") {
      tasks.push(
        fetchKalshiMarkets(cache, fetchImpl, waitUntil).then((r) => ({
          venue: "kalshi" as const,
          ...r,
        }))
      );
    }

    const results = await Promise.allSettled(tasks);
    const hits: boolean[] = [];
    const activeVenues: PredictionVenueName[] = [];
    const allMarkets: RawPredictionMarket[] = [];

    for (const res of results) {
      if (res.status === "fulfilled") {
        hits.push(res.value.cacheHit);
        activeVenues.push(res.value.venue);
        allMarkets.push(...res.value.markets);
      }
    }

    if (activeVenues.length === 0) {
      const firstRejected = results.find((r) => r.status === "rejected");
      const code =
        firstRejected &&
        firstRejected.status === "rejected" &&
        firstRejected.reason instanceof UpstreamError
          ? firstRejected.reason.code
          : "PREDICTIONS_UNAVAILABLE";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "Prediction market venues did not respond. Payment was not settled.",
        },
        502
      );
    }

    const allHit = hits.every(Boolean);
    const anyHit = hits.some(Boolean);
    const cacheStatus: CacheStatus = allHit ? "HIT" : anyHit ? "PARTIAL" : "MISS";

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", activeVenues.join(","));

    const payload = computePredictionsScanner(allMarkets, {
      venue,
      query,
      minVolume24hUsd,
      limit,
      venuesActive: activeVenues,
    });

    if (query && payload.market_summary.matching_count === 0) {
      c.set("upstream_error", "NO_MATCHING_MARKETS");
      return c.json(
        {
          error: "NO_MATCHING_MARKETS",
          message: `No active prediction markets matched '${query}' across ${activeVenues.join(", ")}. Payment was not settled.`,
        },
        404
      );
    }

    return c.json(payload, 200);
  };
}

export const predictionsScannerHandler = createPredictionsScannerHandler();
