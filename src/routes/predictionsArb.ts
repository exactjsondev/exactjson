import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import { fetchKalshiMarkets } from "../providers/kalshi";
import { fetchPolymarketMarkets } from "../providers/polymarket";
import { createWaitUntil } from "../middleware/telemetry";
import { computePredictionsArb } from "../services/predictionsArb";
import type { AppBindings, CacheStatus } from "../types";

export interface PredictionsArbDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

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

export function createPredictionsArbHandler(deps: PredictionsArbDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsedMinSpread = parseOptionalNumber(c.req.query("min_spread_bps"), 150, 0, 5000);
    if (!parsedMinSpread.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MIN_SPREAD");
      return c.json({ error: "INVALID_MIN_SPREAD", message: parsedMinSpread.error }, 400);
    }

    const parsedMinLiq = parseOptionalNumber(c.req.query("min_liquidity_usd"), 5000, 0, 1e12);
    if (!parsedMinLiq.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MIN_LIQUIDITY");
      return c.json({ error: "INVALID_MIN_LIQUIDITY", message: parsedMinLiq.error }, 400);
    }

    const parsedLimit = parseOptionalNumber(c.req.query("limit"), 15, 1, 30);
    if (!parsedLimit.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_LIMIT");
      return c.json({ error: "INVALID_LIMIT", message: parsedLimit.error }, 400);
    }

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

    const minSpreadBps = parsedMinSpread.value;
    const minLiquidityUsd = parsedMinLiq.value;
    const limit = Math.floor(parsedLimit.value);

    c.set(
      "query_target",
      query
        ? `q=${query.slice(0, 32)},minSpread=${minSpreadBps}`
        : `minSpread=${minSpreadBps},minLiq=${minLiquidityUsd},limit=${limit}`
    );

    const waitUntil = createWaitUntil(c);
    const [polyRes, kalshiRes] = await Promise.allSettled([
      fetchPolymarketMarkets(cache, fetchImpl, waitUntil),
      fetchKalshiMarkets(cache, fetchImpl, waitUntil),
    ]);

    // Fail closed: cross-venue arb requires BOTH Polymarket and Kalshi
    if (polyRes.status === "rejected" || kalshiRes.status === "rejected") {
      const failed = polyRes.status === "rejected" ? polyRes : kalshiRes;
      const defaultCode =
        polyRes.status === "rejected" ? "POLYMARKET_UNAVAILABLE" : "KALSHI_UNAVAILABLE";
      const code =
        failed.status === "rejected" && failed.reason instanceof UpstreamError
          ? failed.reason.code
          : defaultCode;

      const missingVenues: string[] = [];
      if (polyRes.status === "rejected") missingVenues.push("polymarket");
      if (kalshiRes.status === "rejected") missingVenues.push("kalshi");

      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: `Cross-venue prediction arbitrage requires both Polymarket and Kalshi (${missingVenues.join(", ")} unavailable). Payment was not settled.`,
        },
        502
      );
    }

    const polyHit = polyRes.value.cacheHit;
    const kalshiHit = kalshiRes.value.cacheHit;
    const cacheStatus: CacheStatus =
      polyHit && kalshiHit ? "HIT" : polyHit || kalshiHit ? "PARTIAL" : "MISS";

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", "polymarket,kalshi");

    const nowMs = nowProvider();
    const payload = computePredictionsArb(polyRes.value.markets, kalshiRes.value.markets, {
      minSpreadBps,
      minLiquidityUsd,
      query,
      limit,
      nowMs,
      fetchedAt: new Date(nowMs).toISOString(),
    });

    if (query && payload.summary.matched_pairs_count === 0) {
      c.set("upstream_error", "NO_MATCHING_PAIRS");
      return c.json(
        {
          error: "NO_MATCHING_PAIRS",
          message: `No cross-venue Polymarket/Kalshi matched pairs found for '${query}'. Payment was not settled.`,
        },
        404
      );
    }

    return c.json(payload, 200);
  };
}

export const predictionsArbHandler = createPredictionsArbHandler();
