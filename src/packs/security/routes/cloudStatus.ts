import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchCloudStatusFeeds } from "../providers/cloudStatus";
import { computeCloudStatus } from "../services/cloudStatus";
import { parseCloudProviders } from "../validation";

export interface CloudStatusDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createCloudStatusHandler(deps: CloudStatusDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseCloudProviders(c.req.query("providers"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_PROVIDERS");
      return c.json({ error: "INVALID_PROVIDERS", message: parsed.error }, 400);
    }

    const providers = parsed.value;
    c.set("query_target", providers.length === 6 ? "all" : providers.join(","));

    try {
      const { items, missingProviders, cacheHits } = await fetchCloudStatusFeeds(
        providers,
        cache,
        fetchImpl,
        createWaitUntil(c)
      );

      const cacheStatus: CacheStatus =
        cacheHits.length > 0 && cacheHits.every(Boolean)
          ? "HIT"
          : cacheHits.some(Boolean)
            ? "PARTIAL"
            : "MISS";
      c.set("cache_status", cacheStatus);
      c.set("upstream_source", items.map((i) => i.provider).join(","));

      return c.json(computeCloudStatus(items, missingProviders, nowProvider()), 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "CLOUD_STATUS_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary cloud status feeds unavailable; refusing to report deploy status as safe. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const cloudStatusHandler = createCloudStatusHandler();
