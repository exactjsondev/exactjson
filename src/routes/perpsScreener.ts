import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import { fetchHyperliquidMetaMap } from "../providers/hyperliquid";
import { computePerpsScreener } from "../services/perpScreener";
import type { AppBindings } from "../types";

export interface PerpsScreenerDeps {
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

export function createPerpsScreenerHandler(deps: PerpsScreenerDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedMinOi = parseOptionalNumber(c.req.query("min_oi_usd"), 1_000_000, 0, 1e12);
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

    const minOiUsd = parsedMinOi.value;
    const limit = Math.floor(parsedLimit.value);
    c.set("query_target", `minOi=${minOiUsd},limit=${limit}`);
    c.set("upstream_source", "hyperliquid");

    try {
      const { map, cacheHit } = await fetchHyperliquidMetaMap(cache, fetchImpl);
      c.set("cache_status", cacheHit ? "HIT" : "MISS");
      const payload = computePerpsScreener(map, { minOiUsd, limit });
      return c.json(payload, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "HYPERLIQUID_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "Hyperliquid market data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const perpsScreenerHandler = createPerpsScreenerHandler();
