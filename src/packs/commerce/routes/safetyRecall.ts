import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import {
  type NormalizedRecallItem,
  fetchCpscRecalls,
  fetchOpenFdaRecalls,
} from "../providers/recallFeeds";
import { computeSafetyRecall } from "../services/safetyRecall";
import { parseSafetyRecallInput } from "../validation";

export interface SafetyRecallDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createSafetyRecallHandler(deps: SafetyRecallDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseSafetyRecallInput({
      query: c.req.query("query"),
      brand: c.req.query("brand"),
      category: c.req.query("category"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_RECALL_QUERY");
      return c.json({ error: "INVALID_RECALL_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    c.set("query_target", `${input.category}:${input.query.slice(0, 32)}`);
    const waitUntil = createWaitUntil(c);

    const runConsumer = input.category === "all" || input.category === "consumer";
    const runFood = input.category === "all" || input.category === "food";
    const runDrug = input.category === "all" || input.category === "drug";
    const runDevice = input.category === "all" || input.category === "device";

    const emptyFeed = Promise.resolve<{ items: NormalizedRecallItem[]; cacheHit: boolean } | null>(
      null
    );

    try {
      const [cpscRes, foodRes, drugRes, deviceRes] = await Promise.all([
        runConsumer
          ? fetchCpscRecalls(input.query, input.brand, cache, fetchImpl, waitUntil)
          : emptyFeed,
        runFood
          ? fetchOpenFdaRecalls("food", input.query, input.brand, cache, fetchImpl, waitUntil)
          : emptyFeed,
        runDrug
          ? fetchOpenFdaRecalls("drug", input.query, input.brand, cache, fetchImpl, waitUntil)
          : emptyFeed,
        runDevice
          ? fetchOpenFdaRecalls("device", input.query, input.brand, cache, fetchImpl, waitUntil)
          : emptyFeed,
      ]);

      const hits: boolean[] = [];
      const sources: string[] = [];
      if (cpscRes) {
        hits.push(cpscRes.cacheHit);
        sources.push("us_cpsc_recalls");
      }
      if (foodRes) {
        hits.push(foodRes.cacheHit);
        sources.push("openfda_food_enforcement");
      }
      if (drugRes) {
        hits.push(drugRes.cacheHit);
        sources.push("openfda_drug_enforcement");
      }
      if (deviceRes) {
        hits.push(deviceRes.cacheHit);
        sources.push("openfda_device_enforcement");
      }

      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeSafetyRecall({
        query: input,
        cpscItems: cpscRes?.items ?? [],
        fdaFoodItems: foodRes?.items ?? [],
        fdaDrugItems: drugRes?.items ?? [],
        fdaDeviceItems: deviceRes?.items ?? [],
        sources,
        nowMs: nowProvider(),
      });

      c.set("upstream_source", sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "SAFETY_RECALL_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "US CPSC or openFDA recall enforcement feed unavailable; refusing to report product as recall-clear. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const safetyRecallHandler = createSafetyRecallHandler();
