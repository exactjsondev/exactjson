import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import { fetchClinicalTrials, fetchRxNormDrugSummary } from "../providers/trialFeeds";
import { computeDrugTrialBrief } from "../services/drugTrialBrief";
import { parseDrugTrialInput } from "../validation";

export interface DrugTrialBriefDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createDrugTrialBriefHandler(deps: DrugTrialBriefDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseDrugTrialInput({
      drug: c.req.query("drug"),
      nct: c.req.query("nct"),
      condition: c.req.query("condition"),
      phase: c.req.query("phase"),
      limit: c.req.query("limit"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_TRIAL_QUERY");
      return c.json({ error: "INVALID_TRIAL_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    c.set("query_target", (input.nct ?? input.drug ?? input.condition ?? "trials").slice(0, 64));

    const waitUntil = createWaitUntil(c);
    const currentNowMs = nowProvider();
    try {
      const [trialsRes, initialRxRes] = await Promise.all([
        fetchClinicalTrials(input, cache, fetchImpl, waitUntil, currentNowMs),
        input.drug
          ? fetchRxNormDrugSummary(input.drug, cache, fetchImpl, waitUntil)
          : Promise.resolve(null),
      ]);

      if (trialsRes.data.notFound) {
        c.set("cache_status", trialsRes.cacheHit ? "HIT" : "MISS");
        c.set("upstream_error", "TRIAL_NOT_FOUND");
        return c.json(
          {
            error: "TRIAL_NOT_FOUND",
            message: `ClinicalTrials.gov study '${input.nct ?? ""}' was not found. Payment was not settled.`,
          },
          404,
        );
      }

      // If single NCT lookup had no explicit drug param, enrich RxNorm from first non-placebo DRUG/BIOLOGICAL intervention
      let rxRes = initialRxRes;
      if (!rxRes && input.nct && trialsRes.data.studies[0]) {
        const studyIntrs = trialsRes.data.studies[0].interventions.filter(
          (i) => i.type === "DRUG" || i.type === "BIOLOGICAL",
        );
        const candidateIntr = studyIntrs.find((i) => !/\bplacebo\b/i.test(i.name)) ?? studyIntrs[0];
        if (candidateIntr) {
          rxRes = await fetchRxNormDrugSummary(
            candidateIntr.name,
            cache,
            fetchImpl,
            waitUntil,
          ).catch(() => null);
        }
      }

      if (trialsRes.data.totalCount === 0 && !rxRes?.data.normalized) {
        c.set("cache_status", trialsRes.cacheHit ? "HIT" : "MISS");
        c.set("upstream_error", "DRUG_OR_TRIALS_NOT_FOUND");
        return c.json(
          {
            error: "DRUG_OR_TRIALS_NOT_FOUND",
            message:
              "No active ClinicalTrials.gov studies or normalized NIH RxNorm drug matched the query. Payment was not settled.",
          },
          404,
        );
      }

      const hits = [trialsRes.cacheHit, ...(rxRes ? [rxRes.cacheHit] : [])];
      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const sources = ["clinicaltrials_gov_v2"];
      if (rxRes) sources.push("nih_rxnav");

      const body = computeDrugTrialBrief({
        input,
        trials: trialsRes.data,
        rxnorm: rxRes ? rxRes.data : null,
        sources,
        nowMs: currentNowMs,
      });
      c.set("upstream_source", sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "DRUG_TRIAL_BRIEF_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "ClinicalTrials.gov v2 or NIH RxNav upstream unavailable; refusing to return incomplete trial brief. Payment was not settled.",
        },
        502,
      );
    }
  };
}

export const drugTrialBriefHandler = createDrugTrialBriefHandler();
