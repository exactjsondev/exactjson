import type { Context } from "hono";
import { type BoundedTtlCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus, NyFedRateObservation } from "../../../types";
import {
  fetchBisPolicyRates,
  fetchBocRates,
  fetchEcbRates,
} from "../providers/globalRatesFeeds";
import { fetchNyFedEffr, fetchNyFedSofr } from "../providers/macroFeeds";
import { computeGlobalRates, parseGlobalRatesInput } from "../services/globalRates";

export interface GlobalRatesDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createGlobalRatesHandler(deps: GlobalRatesDeps = {}) {
  const cache = deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseGlobalRatesInput({
      base: c.req.query("base"),
      group: c.req.query("group"),
      countries: c.req.query("countries"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_GLOBAL_RATES_QUERY");
      return c.json({ error: "INVALID_GLOBAL_RATES_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    c.set("query_target", `base=${input.baseCurrency};group=${input.group}`.slice(0, 64));

    const waitUntil = createWaitUntil(c);
    const [bisRes, ecbRes, bocRes, effrRes, sofrRes] = await Promise.allSettled([
      fetchBisPolicyRates(cache, fetchImpl, waitUntil),
      fetchEcbRates(cache, fetchImpl, waitUntil),
      fetchBocRates(cache, fetchImpl, waitUntil),
      fetchNyFedEffr(cache, fetchImpl, waitUntil),
      fetchNyFedSofr(cache, fetchImpl, waitUntil),
    ]);

    // Fail closed if primary 38-country BIS policy-rate feed fails
    if (bisRes.status === "rejected") {
      const code =
        bisRes.reason instanceof UpstreamError ? bisRes.reason.code : "BIS_UNAVAILABLE";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "BIS global central bank policy-rate feed unavailable; refusing to synthesize partial global rate matrix. Payment was not settled.",
        },
        502
      );
    }

    const hits: boolean[] = [bisRes.value.cacheHit];
    const sources: string[] = ["bis_cbpol"];
    const missingSources: string[] = [];

    let ecb = null;
    if (ecbRes.status === "fulfilled") {
      hits.push(ecbRes.value.cacheHit);
      sources.push("ecb_sdmx");
      ecb = ecbRes.value.data;
    } else {
      missingSources.push("ecb_sdmx");
    }

    let boc = null;
    if (bocRes.status === "fulfilled") {
      hits.push(bocRes.value.cacheHit);
      sources.push("boc_valet");
      boc = bocRes.value.data;
    } else {
      missingSources.push("boc_valet");
    }

    let effr: NyFedRateObservation[] | undefined;
    if (effrRes.status === "fulfilled") {
      hits.push(effrRes.value.cacheHit);
      sources.push("nyfed_effr");
      effr = effrRes.value.data;
    } else {
      missingSources.push("nyfed_effr");
    }

    let sofr: NyFedRateObservation[] | undefined;
    if (sofrRes.status === "fulfilled") {
      hits.push(sofrRes.value.cacheHit);
      sources.push("nyfed_sofr");
      sofr = sofrRes.value.data;
    } else {
      missingSources.push("nyfed_sofr");
    }

    // Require at least 2 of the 3 direct G3 central bank feeds (ECB, BoC, NY Fed) alongside BIS
    const g3UpCount = Number(ecb !== null) + Number(boc !== null) + Number(effr !== undefined || sofr !== undefined);
    if (g3UpCount < 2) {
      const firstRejected = [ecbRes, bocRes, effrRes, sofrRes].find(
        (r) => r.status === "rejected"
      );
      const code =
        firstRejected &&
        firstRejected.status === "rejected" &&
        firstRejected.reason instanceof UpstreamError
          ? firstRejected.reason.code
          : "GLOBAL_RATES_FEEDS_UNAVAILABLE";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Fewer than 2 direct G3 central bank feeds (ECB SDMX, Bank of Canada Valet, NY Fed) responded alongside BIS. Payment was not settled.",
        },
        502
      );
    }

    const cacheStatus: CacheStatus = hits.every(Boolean)
      ? "HIT"
      : hits.some(Boolean)
        ? "PARTIAL"
        : "MISS";
    c.set("cache_status", cacheStatus);
    c.set("upstream_source", sources.join(","));

    const payload = computeGlobalRates({
      input,
      bisSeries: bisRes.value.data,
      ecb,
      boc,
      effr,
      sofr,
      sources,
      missingSources,
      nowMs: nowProvider(),
    });

    if (payload === null) {
      c.set("upstream_error", "BASE_RATE_UNAVAILABLE");
      return c.json(
        {
          error: "BASE_RATE_UNAVAILABLE",
          message: `No active BIS or central bank policy rate is currently reported for base '${input.baseCurrency}' (${input.baseArea}). Payment was not settled.`,
        },
        404
      );
    }

    return c.json(payload, 200);
  };
}

export const globalRatesHandler = createGlobalRatesHandler();
