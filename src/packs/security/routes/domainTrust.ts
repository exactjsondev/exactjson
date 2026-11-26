import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache, referenceCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import {
  fetchDomainDnsBundle,
  fetchDomainRdapInfo,
  fetchIanaRdapMap,
} from "../providers/dnsRdap";
import { computeDomainTrust } from "../services/domainTrust";
import { parseDomainInput } from "../validation";

export interface DomainTrustDeps {
  cache?: BoundedTtlCache;
  rdapBootstrapCache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createDomainTrustHandler(deps: DomainTrustDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const rdapBootstrapCache = deps.rdapBootstrapCache ?? deps.cache ?? referenceCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseDomainInput(c.req.query("domain"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_DOMAIN");
      return c.json({ error: "INVALID_DOMAIN", message: parsed.error }, 400);
    }

    const target = parsed.value;
    c.set("query_target", target.domain);
    const waitUntil = createWaitUntil(c);

    try {
      const dnsRes = await fetchDomainDnsBundle(
        target.domain,
        target.registrableDomain,
        cache,
        fetchImpl,
        waitUntil
      );

      if (dnsRes.status === "not_found") {
        c.set("cache_status", dnsRes.cacheHit ? "HIT" : "MISS");
        c.set("upstream_error", "DOMAIN_NOT_FOUND");
        return c.json(
          {
            error: "DOMAIN_NOT_FOUND",
            message: `Domain '${target.domain}' does not exist in global DNS (NXDOMAIN). Payment was not settled.`,
          },
          404
        );
      }

      const ianaRes = await fetchIanaRdapMap(rdapBootstrapCache, fetchImpl, waitUntil);
      const rdapRes = await fetchDomainRdapInfo(
        target.registrableDomain,
        target.tld,
        ianaRes.map,
        cache,
        fetchImpl,
        waitUntil
      );

      const hits = [dnsRes.cacheHit, ianaRes.cacheHit, rdapRes.cacheHit];
      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeDomainTrust(target, dnsRes.data, rdapRes.info, nowProvider());
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "DOMAIN_TRUST_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary DNS/RDAP security feed unavailable; refusing to report domain as trusted. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const domainTrustHandler = createDomainTrustHandler();
