import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import { fetchTrendingSolanaPools } from "../providers/geckoTrending";
import { fetchRugCheckSummary } from "../providers/rugcheck";
import { computeSolanaTrending } from "../services/solanaTrending";
import type { AppBindings, CacheStatus, RugCheckSummary } from "../types";

export interface SolanaTrendingDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

function parseOptionalInt(
  raw: string | undefined,
  defaultVal: number | null,
  min: number,
  max: number
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: defaultVal };
  }
  if (raw.length > 16) {
    return { ok: false, error: "Numeric query parameter too long." };
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < min || num > max) {
    return { ok: false, error: `Expected an integer between ${min} and ${max}.` };
  }
  return { ok: true, value: num };
}

export function createSolanaTrendingHandler(deps: SolanaTrendingDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedLimit = parseOptionalInt(c.req.query("limit"), 5, 1, 8);
    if (!parsedLimit.ok || parsedLimit.value === null) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_LIMIT");
      return c.json({ error: "INVALID_LIMIT", message: parsedLimit.ok ? "Invalid limit" : parsedLimit.error }, 400);
    }

    const parsedMaxRisk = parseOptionalInt(c.req.query("max_risk_score"), null, 0, 100);
    if (!parsedMaxRisk.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MAX_RISK");
      return c.json({ error: "INVALID_MAX_RISK", message: parsedMaxRisk.error }, 400);
    }

    const limit = parsedLimit.value;
    const maxRiskScore = parsedMaxRisk.value;
    c.set(
      "query_target",
      maxRiskScore !== null ? `limit=${limit},maxRisk=${maxRiskScore}` : `limit=${limit}`
    );
    c.set("upstream_source", "geckoterminal,rugcheck");

    let poolsResult: Awaited<ReturnType<typeof fetchTrendingSolanaPools>>;
    try {
      poolsResult = await fetchTrendingSolanaPools(cache, fetchImpl);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "GECKOTERMINAL_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "Trending Solana pools feed is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    // Fetch RugCheck reports in parallel for top candidate tokens (capped at 8 to stay fast & polite)
    const scanCount = Math.min(poolsResult.pools.length, maxRiskScore !== null ? 8 : limit);
    const candidates = poolsResult.pools.slice(0, scanCount);

    const rugResults = await Promise.allSettled(
      candidates.map((pool) => fetchRugCheckSummary(pool.mint, cache, fetchImpl))
    );

    const rugByMint = new Map<string, RugCheckSummary | null>();
    let rugVerifiedCount = 0;
    let rugHitCount = 0;
    let firstRugErrorCode: string | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const mint = candidates[i]!.mint;
      const settled = rugResults[i]!;
      if (settled.status === "fulfilled") {
        if (settled.value.cacheHit) rugHitCount += 1;
        if (settled.value.status === "ok") {
          rugByMint.set(mint, settled.value.data);
          rugVerifiedCount += 1;
        } else {
          rugByMint.set(mint, null);
        }
      } else {
        rugByMint.set(mint, null);
        if (!firstRugErrorCode && settled.reason instanceof UpstreamError) {
          firstRugErrorCode = settled.reason.code;
        }
      }
    }

    // If RugCheck failed on EVERY candidate (e.g. outage / 429), refuse to charge
    if (candidates.length > 0 && rugVerifiedCount === 0 && firstRugErrorCode) {
      c.set("cache_status", poolsResult.cacheHit ? "PARTIAL" : "MISS");
      c.set("upstream_error", firstRugErrorCode);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: firstRugErrorCode,
          message: "RugCheck security scoring is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    const cacheStatus: CacheStatus =
      poolsResult.cacheHit && rugHitCount === candidates.length
        ? "HIT"
        : poolsResult.cacheHit || rugHitCount > 0
          ? "PARTIAL"
          : "MISS";
    c.set("cache_status", cacheStatus);

    const payload = computeSolanaTrending(candidates, rugByMint, { limit, maxRiskScore });
    return c.json(payload, 200);
  };
}

export const solanaTrendingHandler = createSolanaTrendingHandler();
