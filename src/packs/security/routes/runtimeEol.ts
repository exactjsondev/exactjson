import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings } from "../../../types";
import { fetchEolProduct } from "../providers/endoflife";
import { computeRuntimeEol, matchReleaseCycle } from "../services/runtimeEol";
import { parseRuntimeInput } from "../validation";

export interface RuntimeEolDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createRuntimeEolHandler(deps: RuntimeEolDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseRuntimeInput(c.req.query("product"), c.req.query("cycle"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_RUNTIME_INPUT");
      return c.json({ error: "INVALID_RUNTIME_INPUT", message: parsed.error }, 400);
    }

    const { product, cycle } = parsed.value;
    c.set("query_target", cycle ? `${product}:${cycle}` : product);
    c.set("upstream_source", "endoflife_date");

    try {
      const res = await fetchEolProduct(product, cache, fetchImpl, createWaitUntil(c));
      c.set("cache_status", res.cacheHit ? "HIT" : "MISS");

      if (res.status === "not_found") {
        c.set("upstream_error", "PRODUCT_NOT_FOUND");
        return c.json(
          {
            error: "PRODUCT_NOT_FOUND",
            message: `Runtime/product '${product}' was not found on endoflife.date. Payment was not settled.`,
          },
          404
        );
      }

      let matched = null;
      if (cycle !== null) {
        matched = matchReleaseCycle(res.data.releases, cycle);
        if (!matched) {
          c.set("upstream_error", "CYCLE_NOT_FOUND");
          return c.json(
            {
              error: "CYCLE_NOT_FOUND",
              message: `Release cycle '${cycle}' was not found for '${res.data.name}'. Payment was not settled.`,
            },
            404
          );
        }
      }

      return c.json(computeRuntimeEol(res.data, cycle, matched, nowProvider()), 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "ENDOFLIFE_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "endoflife.date lifecycle data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const runtimeEolHandler = createRuntimeEolHandler();
