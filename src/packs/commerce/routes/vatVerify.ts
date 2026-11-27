import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import {
  type SlimGleifEntity,
  type ViesLookupResult,
  fetchEuViesVat,
  fetchGleifByFilter,
} from "../providers/viesAndGleif";
import { computeVatVerify } from "../services/vatVerify";
import { parseVatVerifyInput, validateBicCode } from "../validation";

export interface VatVerifyDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createVatVerifyHandler(deps: VatVerifyDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseVatVerifyInput({
      vat: c.req.query("vat"),
      iban: c.req.query("iban"),
      bic: c.req.query("bic"),
      lei: c.req.query("lei"),
      country: c.req.query("country"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_VAT_VERIFY_QUERY");
      return c.json({ error: "INVALID_VAT_VERIFY_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    const targetLabel =
      input.vat?.raw ?? input.ibanRaw?.slice(0, 8) ?? input.bicRaw ?? input.leiRaw ?? "check";
    c.set("query_target", targetLabel);

    const waitUntil = createWaitUntil(c);
    const bicCheck = input.bicRaw ? validateBicCode(input.bicRaw) : null;
    const shouldQueryGleifBic = Boolean(bicCheck?.valid);

    try {
      const [viesRes, bicGleifRes] = await Promise.all([
        input.vat
          ? fetchEuViesVat(
              input.vat.viesCountry,
              input.vat.vatNumber,
              cache,
              fetchImpl,
              waitUntil
            )
          : Promise.resolve<{ data: ViesLookupResult; cacheHit: boolean } | null>(null),
        shouldQueryGleifBic && bicCheck
          ? fetchGleifByFilter("bic", bicCheck.normalized11, null, cache, fetchImpl, waitUntil)
          : Promise.resolve<{ entity: SlimGleifEntity | null; cacheHit: boolean } | null>(null),
      ]);

      const hits: boolean[] = [];
      if (viesRes) hits.push(viesRes.cacheHit);
      if (bicGleifRes) hits.push(bicGleifRes.cacheHit);

      const cacheStatus: CacheStatus =
        hits.length === 0
          ? "NONE"
          : hits.every(Boolean)
            ? "HIT"
            : hits.some(Boolean)
              ? "PARTIAL"
              : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeVatVerify({
        parsed: input,
        viesResult: viesRes ? viesRes.data : null,
        bicGleifEntity: bicGleifRes ? bicGleifRes.entity : null,
        bicGleifQueried: shouldQueryGleifBic,
        nowMs: nowProvider(),
      });

      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "VAT_VERIFY_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "EU Commission VIES member-state tax database or GLEIF BIC registry unavailable; refusing to guess VAT or bank registration status. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const vatVerifyHandler = createVatVerifyHandler();
