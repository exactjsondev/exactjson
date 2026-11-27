import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings } from "../../../types";
import { fetchPubChemHazardBundle } from "../providers/pubchemFeeds";
import { computeChemHazardProfile } from "../services/chemHazardProfile";
import { parseChemHazardInput } from "../validation";

export interface ChemHazardDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createChemHazardProfileHandler(deps: ChemHazardDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseChemHazardInput(c.req.query("query"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_CHEM_QUERY");
      return c.json({ error: "INVALID_CHEM_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    c.set("query_target", `${input.kind}:${input.normalizedValue}`.slice(0, 64));

    const waitUntil = createWaitUntil(c);
    try {
      const res = await fetchPubChemHazardBundle(input, cache, fetchImpl, waitUntil);
      c.set("cache_status", res.cacheHit ? "HIT" : "MISS");

      if (!res.data.found || !res.data.props) {
        c.set("upstream_error", "CHEMICAL_NOT_FOUND");
        return c.json(
          {
            error: "CHEMICAL_NOT_FOUND",
            message: `No NIH PubChem compound matched '${input.rawQuery}'. Payment was not settled.`,
          },
          404
        );
      }

      const body = computeChemHazardProfile({
        bundle: res.data,
        nowMs: nowProvider(),
      });
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "CHEM_HAZARD_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "NIH PubChem PUG-REST or GHS hazard feed unavailable; refusing to synthesize chemical safety profile. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const chemHazardProfileHandler = createChemHazardProfileHandler();
