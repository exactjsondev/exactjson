import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchGlobalDnsBaseline, fetchOoniWebConnectivity } from "../providers/ooni";
import { computeCensorshipCheck } from "../services/censorshipCheck";
import { parseCountryCode, parseDomainInput } from "../validation";

export interface CensorshipCheckDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

function parseDaysWindow(raw: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: 7 };
  }
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) {
    return { ok: false, error: "Query parameter 'days' must be an integer between 1 and 14." };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 1 || parsed > 14) {
    return { ok: false, error: "Query parameter 'days' must be between 1 and 14." };
  }
  return { ok: true, value: parsed };
}

export function createCensorshipCheckHandler(deps: CensorshipCheckDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const domainParsed = parseDomainInput(c.req.query("domain"));
    if (!domainParsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_DOMAIN");
      return c.json({ error: "INVALID_DOMAIN", message: domainParsed.error }, 400);
    }

    const countryParsed = parseCountryCode(c.req.query("country"));
    if (!countryParsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_COUNTRY");
      return c.json({ error: "INVALID_COUNTRY", message: countryParsed.error }, 400);
    }

    const daysParsed = parseDaysWindow(c.req.query("days"));
    if (!daysParsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_DAYS");
      return c.json({ error: "INVALID_DAYS", message: daysParsed.error }, 400);
    }

    const domain = domainParsed.value.domain;
    const countryCode = countryParsed.value;
    const days = daysParsed.value;
    const nowMs = nowProvider();

    c.set("query_target", `${countryCode}:${domain}`);
    const waitUntil = createWaitUntil(c);

    try {
      const [ooniRes, dnsRes] = await Promise.all([
        fetchOoniWebConnectivity(domain, countryCode, days, nowMs, cache, fetchImpl, waitUntil),
        fetchGlobalDnsBaseline(domain, cache, fetchImpl, waitUntil),
      ]);

      const cacheStatus: CacheStatus =
        ooniRes.cacheHit && dnsRes.cacheHit
          ? "HIT"
          : ooniRes.cacheHit || dnsRes.cacheHit
            ? "PARTIAL"
            : "MISS";
      c.set("cache_status", cacheStatus);
      c.set("upstream_source", "ooni_aggregation,cloudflare_doh");

      return c.json(
        computeCensorshipCheck(domain, countryCode, days, ooniRes.data, dnsRes.data, nowMs),
        200
      );
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "CENSORSHIP_CHECK_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary OONI or global DNS feed unavailable; refusing to guess censorship status. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const censorshipCheckHandler = createCensorshipCheckHandler();
