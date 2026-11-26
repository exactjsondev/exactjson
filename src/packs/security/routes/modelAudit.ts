import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings } from "../../../types";
import { fetchHfModelMetadata } from "../providers/huggingface";
import { computeModelAudit } from "../services/modelAudit";
import { parseHfModelId } from "../validation";

export interface ModelAuditDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createModelAuditHandler(deps: ModelAuditDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseHfModelId(c.req.query("model"));
    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MODEL_ID");
      return c.json({ error: "INVALID_MODEL_ID", message: parsed.error }, 400);
    }

    const modelId = parsed.value;
    c.set("query_target", modelId);

    try {
      const res = await fetchHfModelMetadata(modelId, cache, fetchImpl, createWaitUntil(c));
      c.set("cache_status", res.cacheHit ? "HIT" : "MISS");

      if (res.status === "not_found") {
        c.set("upstream_error", "MODEL_NOT_FOUND");
        return c.json(
          {
            error: "MODEL_NOT_FOUND",
            message: `Hugging Face model '${modelId}' was not found or is private. Payment was not settled.`,
          },
          404
        );
      }

      c.set("upstream_source", "huggingface_hub");
      return c.json(computeModelAudit(res.data, nowProvider()), 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "HF_AUDIT_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Hugging Face Hub metadata API unavailable; refusing to report model as safe. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const modelAuditHandler = createModelAuditHandler();
