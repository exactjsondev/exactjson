import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import { parseSolanaMint } from "../lib/validation";
import { fetchDexScreenerSolanaPairs } from "../providers/dexscreener";
import { fetchRugCheckSummary } from "../providers/rugcheck";
import { createWaitUntil } from "../middleware/telemetry";
import { computeSolanaSafety } from "../services/safetyScoring";
import type { AppBindings, CacheStatus } from "../types";

export interface SolanaSafetyDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

export function createSolanaSafetyHandler(deps: SolanaSafetyDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedMint = parseSolanaMint(c.req.query("mint"));
    if (!parsedMint.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MINT");
      return c.json(
        {
          error: "INVALID_MINT",
          message: parsedMint.error,
        },
        400
      );
    }

    const mint = parsedMint.value;
    c.set("query_target", mint);
    c.set("upstream_source", "rugcheck,dexscreener");

    const waitUntil = createWaitUntil(c);
    const [rugResult, dexResult] = await Promise.allSettled([
      fetchRugCheckSummary(mint, cache, fetchImpl, waitUntil),
      fetchDexScreenerSolanaPairs(mint, cache, fetchImpl, waitUntil),
    ]);

    if (rugResult.status === "rejected") {
      const code =
        rugResult.reason instanceof UpstreamError
          ? rugResult.reason.code
          : "RUGCHECK_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "RugCheck security data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    if (dexResult.status === "rejected") {
      const code =
        dexResult.reason instanceof UpstreamError
          ? dexResult.reason.code
          : "DEXSCREENER_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "DEX Screener market data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    const rug = rugResult.value;
    const dex = dexResult.value;

    // Never treat missing RugCheck risk data as safe
    if (rug.status === "not_found") {
      c.set("cache_status", dex.cacheHit ? "PARTIAL" : "MISS");
      if (dex.data.pairCount === 0) {
        c.set("upstream_error", "TOKEN_NOT_FOUND");
        return c.json(
          {
            error: "TOKEN_NOT_FOUND",
            message: `No RugCheck or Solana DEX pairs found for mint ${mint}. Payment was not settled.`,
          },
          404
        );
      }

      c.set("upstream_error", "RUGCHECK_NOT_FOUND");
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: "RUGCHECK_NOT_FOUND",
          message:
            "RugCheck security report is unavailable for this mint; refusing to score without risk data. Payment was not settled.",
        },
        502
      );
    }

    const cacheStatus: CacheStatus =
      rug.cacheHit && dex.cacheHit
        ? "HIT"
        : rug.cacheHit || dex.cacheHit
          ? "PARTIAL"
          : "MISS";

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", `rugcheck,${dex.source}`);

    const payload = computeSolanaSafety(mint, rug.data, dex.data, new Date().toISOString(), dex.source);
    return c.json(payload, 200);
  };
}

export const solanaSafetyHandler = createSolanaSafetyHandler();
