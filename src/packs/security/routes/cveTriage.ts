import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchCisaKevMap, fetchFirstEpssScore, fetchOsvCveDetail } from "../providers/cveFeeds";
import { computeCveTriage } from "../services/cveTriage";
import { parseCveId } from "../validation";

export interface CveTriageDeps {
  cache?: BoundedTtlCache;
  kevCache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createCveTriageHandler(deps: CveTriageDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const kevCache = deps.kevCache ?? deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseCveId(c.req.query("cve"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_CVE");
      return c.json({ error: "INVALID_CVE", message: parsed.error }, 400);
    }

    const cveId = parsed.value;
    c.set("query_target", cveId);
    c.set("upstream_source", "osv_dev,first_epss,cisa_kev");

    const waitUntil = createWaitUntil(c);

    try {
      const osvRes = await fetchOsvCveDetail(cveId, cache, fetchImpl, waitUntil);
      if (osvRes.status === "not_found") {
        c.set("cache_status", osvRes.cacheHit ? "HIT" : "MISS");
        c.set("upstream_error", "CVE_NOT_FOUND");
        return c.json(
          {
            error: "CVE_NOT_FOUND",
            message: `CVE '${cveId}' was not found. Payment was not settled.`,
          },
          404
        );
      }

      const [epssRes, kevRes] = await Promise.all([
        fetchFirstEpssScore(cveId, cache, fetchImpl, waitUntil),
        fetchCisaKevMap(kevCache, fetchImpl, waitUntil),
      ]);

      const hits = [osvRes.cacheHit, epssRes.cacheHit, kevRes.cacheHit];
      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);
      const body = computeCveTriage(
        cveId,
        osvRes.data,
        epssRes.score,
        kevRes.map.get(cveId),
        nowProvider()
      );
      c.set("upstream_source", body.metadata.sources.join(","));

      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "CVE_FEEDS_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary CVE exploitation feed unavailable; refusing to downgrade urgency. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const cveTriageHandler = createCveTriageHandler();
