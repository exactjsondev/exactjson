import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import {
  fetchNyFedEffr,
  fetchNyFedRrp,
  fetchNyFedSofr,
  fetchTreasuryDebt,
  fetchTreasuryTga,
} from "../providers/macroFeeds";
import { createWaitUntil } from "../middleware/telemetry";
import { computeMacroLiquidity } from "../services/macroLiquidity";
import type { AppBindings, CacheStatus } from "../types";

export interface MacroLiquidityDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

function parseLookbackObs(raw: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: 5 };
  }
  if (raw.length > 16) {
    return { ok: false, error: "Parameter 'lookback_obs' is too long." };
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 2 || num > 20) {
    return { ok: false, error: "Parameter 'lookback_obs' must be an integer between 2 and 20." };
  }
  return { ok: true, value: num };
}

export function createMacroLiquidityHandler(deps: MacroLiquidityDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedLookback = parseLookbackObs(c.req.query("lookback_obs"));
    if (!parsedLookback.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_LOOKBACK");
      return c.json({ error: "INVALID_LOOKBACK", message: parsedLookback.error }, 400);
    }

    const lookbackObs = parsedLookback.value;
    c.set("query_target", `lookback=${lookbackObs}`);

    const waitUntil = createWaitUntil(c);
    const [debtRes, tgaRes, rrpRes, sofrRes, effrRes] = await Promise.allSettled([
      fetchTreasuryDebt(cache, fetchImpl, waitUntil),
      fetchTreasuryTga(cache, fetchImpl, waitUntil),
      fetchNyFedRrp(cache, fetchImpl, waitUntil),
      fetchNyFedSofr(cache, fetchImpl, waitUntil),
      fetchNyFedEffr(cache, fetchImpl, waitUntil),
    ]);

    const hits: boolean[] = [];
    const sources: string[] = [];
    const missingSources: string[] = [];

    const debt =
      debtRes.status === "fulfilled"
        ? (hits.push(debtRes.value.cacheHit), sources.push("treasury_debt"), debtRes.value.data)
        : (missingSources.push("treasury_debt"), undefined);
    const tga =
      tgaRes.status === "fulfilled"
        ? (hits.push(tgaRes.value.cacheHit), sources.push("treasury_tga"), tgaRes.value.data)
        : (missingSources.push("treasury_tga"), undefined);
    const rrp =
      rrpRes.status === "fulfilled"
        ? (hits.push(rrpRes.value.cacheHit), sources.push("nyfed_rrp"), rrpRes.value.data)
        : (missingSources.push("nyfed_rrp"), undefined);
    const sofr =
      sofrRes.status === "fulfilled"
        ? (hits.push(sofrRes.value.cacheHit), sources.push("nyfed_sofr"), sofrRes.value.data)
        : (missingSources.push("nyfed_sofr"), undefined);
    const effr =
      effrRes.status === "fulfilled"
        ? (hits.push(effrRes.value.cacheHit), sources.push("nyfed_effr"), effrRes.value.data)
        : (missingSources.push("nyfed_effr"), undefined);

    // Require at least 3 of 5 official primary feeds to settle
    if (sources.length < 3) {
      const firstErr = [debtRes, tgaRes, rrpRes, sofrRes, effrRes].find(
        (r) => r.status === "rejected"
      );
      const code =
        firstErr && firstErr.status === "rejected" && firstErr.reason instanceof UpstreamError
          ? firstErr.reason.code
          : "MACRO_FEEDS_UNAVAILABLE";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Fewer than 3 official US Treasury / NY Fed macro feeds responded. Payment was not settled.",
        },
        502
      );
    }

    const allHit = hits.every(Boolean);
    const anyHit = hits.some(Boolean);
    const cacheStatus: CacheStatus = allHit ? "HIT" : anyHit ? "PARTIAL" : "MISS";

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", sources.join(","));

    const payload = computeMacroLiquidity({
      debt,
      tga,
      rrp,
      sofr,
      effr,
      lookbackObs,
      sources,
      missingSources,
    });

    return c.json(payload, 200);
  };
}

export const macroLiquidityHandler = createMacroLiquidityHandler();
