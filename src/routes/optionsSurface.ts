import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../lib/cache";
import { UpstreamError } from "../lib/http";
import { fetchDeribitOptions } from "../providers/deribit";
import { createWaitUntil } from "../middleware/telemetry";
import { computeOptionsSurface } from "../services/optionsSurface";
import type { AppBindings, OptionsCurrency } from "../types";

export interface OptionsSurfaceDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

const SUPPORTED_CURRENCIES = new Set<string>(["BTC", "ETH"]);

export function createOptionsSurfaceHandler(deps: OptionsSurfaceDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const rawCurrency = c.req.query("currency")?.trim().toUpperCase() || "BTC";
    if (!SUPPORTED_CURRENCIES.has(rawCurrency)) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_CURRENCY");
      return c.json(
        {
          error: "INVALID_CURRENCY",
          message: "Parameter 'currency' must be 'BTC' or 'ETH'. Payment was not settled.",
        },
        400
      );
    }

    const currency = rawCurrency as OptionsCurrency;
    c.set("query_target", `currency=${currency}`);

    try {
      const { contracts, cacheHit } = await fetchDeribitOptions(
        currency,
        cache,
        fetchImpl,
        createWaitUntil(c)
      );
      c.set("cache_status", cacheHit ? "HIT" : "MISS");
      c.set("upstream_source", "deribit");

      const payload = computeOptionsSurface(currency, contracts);
      return c.json(payload, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "DERIBIT_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: `Deribit options surface unavailable for ${currency}. Payment was not settled.`,
        },
        502
      );
    }
  };
}

export const optionsSurfaceHandler = createOptionsSurfaceHandler();
