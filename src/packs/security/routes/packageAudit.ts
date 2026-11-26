import type { Context } from "hono";
import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings } from "../../../types";
import { fetchPackageAuditBundle, type PackageRawBundle } from "../providers/ossSupplyChain";
import { computePackageAudit } from "../services/packageAudit";
import { parsePackageInput } from "../validation";

export interface PackageAuditDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createPackageAuditHandler(deps: PackageAuditDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parsePackageInput(
      c.req.query("package"),
      c.req.query("ecosystem"),
      c.req.query("version")
    );
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_PACKAGE_INPUT");
      return c.json({ error: "INVALID_PACKAGE_INPUT", message: parsed.error }, 400);
    }

    const input = parsed.value;
    const targetLabel = `${input.ecosystem}:${input.packageName}${input.version ? `@${input.version}` : ""}`;
    c.set("query_target", targetLabel);

    const cacheKey = `oss:pkg:${input.ecosystem}:${input.packageName}:${input.version ?? "@default"}`;

    try {
      const { value, cacheHit } = await withTwoTierCache<
        { status: "not_found" } | { status: "ok"; bundle: PackageRawBundle }
      >({
        key: cacheKey,
        ttlMs: TTL_MS.OSS_PACKAGE_AUDIT,
        cache,
        waitUntil: createWaitUntil(c),
        shouldCache: (res) => res.status === "ok",
        fetcher: () => fetchPackageAuditBundle(input, fetchImpl),
      });

      c.set("cache_status", cacheHit ? "HIT" : "MISS");

      if (value.status === "not_found") {
        c.set("upstream_error", "PACKAGE_NOT_FOUND");
        return c.json(
          {
            error: "PACKAGE_NOT_FOUND",
            message: `Package '${targetLabel}' was not found. Payment was not settled.`,
          },
          404
        );
      }

      c.set("upstream_source", value.bundle.sources.join(","));
      return c.json(
        computePackageAudit(input.packageName, input.ecosystem, value.bundle, nowProvider()),
        200
      );
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "OSS_AUDIT_UNAVAILABLE";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary supply-chain vulnerability feed unavailable; refusing to report package as safe. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const packageAuditHandler = createPackageAuditHandler();
