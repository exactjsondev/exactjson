import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import { parsePerpCoin } from "../lib/validation";
import { fetchDydxMarketsMap } from "../providers/dydx";
import { fetchHyperliquidMetaMap } from "../providers/hyperliquid";
import { fetchKrakenPerpsMap } from "../providers/krakenFutures";
import { computeFundingArb, hyperliquidToVenueMap } from "../services/fundingArb";
import type { AppBindings, CacheStatus } from "../types";

export interface FundingArbDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
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

export function createFundingArbHandler(deps: FundingArbDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedMinOi = parseOptionalNumber(c.req.query("min_oi_usd"), 100_000, 0, 1e12);
    if (!parsedMinOi.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MIN_OI");
      return c.json({ error: "INVALID_MIN_OI", message: parsedMinOi.error }, 400);
    }

    const parsedLimit = parseOptionalNumber(c.req.query("limit"), 10, 1, 25);
    if (!parsedLimit.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_LIMIT");
      return c.json({ error: "INVALID_LIMIT", message: parsedLimit.error }, 400);
    }

    const rawCoin = c.req.query("coin");
    let coinLookupKey: string | null = null;
    if (rawCoin !== undefined && rawCoin.trim().length > 0) {
      const parsedCoin = parsePerpCoin(rawCoin);
      if (!parsedCoin.ok) {
        c.set("cache_status", "NONE");
        c.set("upstream_error", "INVALID_COIN");
        return c.json({ error: "INVALID_COIN", message: parsedCoin.error }, 400);
      }
      coinLookupKey = parsedCoin.value.stripped;
    }

    const minOiUsd = parsedMinOi.value;
    const limit = Math.floor(parsedLimit.value);
    c.set("query_target", coinLookupKey ? `coin=${coinLookupKey}` : `minOi=${minOiUsd},limit=${limit}`);

    const [hlRes, dydxRes, krakenRes] = await Promise.allSettled([
      fetchHyperliquidMetaMap(cache, fetchImpl),
      fetchDydxMarketsMap(cache, fetchImpl),
      fetchKrakenPerpsMap(cache, fetchImpl),
    ]);

    const hits: boolean[] = [];
    const activeSources: string[] = [];

    const hlVenue =
      hlRes.status === "fulfilled"
        ? (hits.push(hlRes.value.cacheHit), activeSources.push("hyperliquid"), hyperliquidToVenueMap(hlRes.value.map))
        : undefined;
    const dydxVenue =
      dydxRes.status === "fulfilled"
        ? (hits.push(dydxRes.value.cacheHit), activeSources.push("dydx"), dydxRes.value.map)
        : undefined;
    const krakenVenue =
      krakenRes.status === "fulfilled"
        ? (hits.push(krakenRes.value.cacheHit), activeSources.push("kraken"), krakenRes.value.map)
        : undefined;

    // Require at least 2 live venues to compute real cross-venue spreads
    if (activeSources.length < 2) {
      const firstErr = [hlRes, dydxRes, krakenRes].find((r) => r.status === "rejected");
      const code =
        firstErr && firstErr.status === "rejected" && firstErr.reason instanceof UpstreamError
          ? firstErr.reason.code
          : "VENUES_UNAVAILABLE";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Fewer than 2 perpetual venues responded; refusing to return empty cross-venue spreads. Payment was not settled.",
        },
        502
      );
    }

    const allHit = hits.every(Boolean);
    const anyHit = hits.some(Boolean);
    const cacheStatus: CacheStatus = allHit ? "HIT" : anyHit ? "PARTIAL" : "MISS";

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", activeSources.join(","));

    // Resolve lowercase/uppercase Hyperliquid scaled tickers (e.g. kpepe -> kPEPE) without breaking real K* assets (KAS/KSM)
    const resolvedCoinKey =
      coinLookupKey && hlRes.status === "fulfilled"
        ? (hlRes.value.map.get(coinLookupKey.toLowerCase())?.canonicalName ?? coinLookupKey)
        : coinLookupKey;

    const payload = computeFundingArb(
      { hyperliquid: hlVenue, dydx: dydxVenue, kraken: krakenVenue },
      { minOiUsd, limit, coinLookupKey: resolvedCoinKey }
    );

    if (coinLookupKey && payload.opportunities.length === 0) {
      c.set("upstream_error", "COIN_NOT_MULTI_VENUE");
      return c.json(
        {
          error: "COIN_NOT_FOUND",
          message: `Asset '${coinLookupKey}' was not found across at least 2 active venues (${activeSources.join(", ")}). Payment was not settled.`,
        },
        404
      );
    }

    return c.json(payload, 200);
  };
}

export const fundingArbHandler = createFundingArbHandler();
