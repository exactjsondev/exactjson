import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import {
  type SlimSecEdgarProfile,
  type UsaSpendingBrief,
  type WikidataCorporateMeta,
  fetchSecEdgarSubmissions,
  fetchUsaSpendingAwards,
  fetchWikidataCorporateMeta,
} from "../providers/companyFeeds";
import {
  type SlimGleifEntity,
  fetchGleifByFilter,
  fetchGleifByLei,
  fetchGleifParent,
} from "../providers/viesAndGleif";
import { computeCompanyVerify } from "../services/companyVerify";
import { parseCompanyVerifyInput } from "../validation";

export interface CompanyVerifyDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createCompanyVerifyHandler(deps: CompanyVerifyDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseCompanyVerifyInput({
      query: c.req.query("query"),
      lei: c.req.query("lei"),
      cik: c.req.query("cik"),
      bic: c.req.query("bic"),
      isin: c.req.query("isin"),
      country: c.req.query("country"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_COMPANY_QUERY");
      return c.json({ error: "INVALID_COMPANY_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    const targetLabel =
      input.lei ?? input.cik ?? input.bic ?? input.isin ?? input.query?.slice(0, 40) ?? "entity";
    c.set("query_target", targetLabel);
    const waitUntil = createWaitUntil(c);

    try {
      const hits: boolean[] = [];
      let partialEnrichment = false;
      let wikidataError: unknown = null;

      // Stage 1: Primary GLEIF resolution + explicit CIK SEC lookup + Wikidata cross-link
      const gleifPrimaryPromise: Promise<{ entity: SlimGleifEntity | null; cacheHit: boolean }> =
        input.lei
          ? fetchGleifByLei(input.lei, cache, fetchImpl, waitUntil)
          : input.bic
            ? fetchGleifByFilter("bic", input.bic, input.country, cache, fetchImpl, waitUntil)
            : input.isin
              ? fetchGleifByFilter("isin", input.isin, input.country, cache, fetchImpl, waitUntil)
              : input.query
                ? fetchGleifByFilter(
                    "legalName",
                    input.query,
                    input.country,
                    cache,
                    fetchImpl,
                    waitUntil
                  )
                : Promise.resolve({ entity: null, cacheHit: true });

      const secDirectPromise: Promise<{ data: SlimSecEdgarProfile | null; cacheHit: boolean } | null> =
        input.cik
          ? fetchSecEdgarSubmissions(input.cik, cache, fetchImpl, waitUntil)
          : Promise.resolve(null);

      const wikidataSearchTerm = input.query;
      const wikidataPromise: Promise<{ data: WikidataCorporateMeta | null; cacheHit: boolean } | null> =
        wikidataSearchTerm
          ? fetchWikidataCorporateMeta(wikidataSearchTerm, cache, fetchImpl, waitUntil).catch(
              (err) => {
                wikidataError = err;
                partialEnrichment = true;
                return null;
              }
            )
          : Promise.resolve(null);

      const [gleifRes, secDirectRes, wikidataInitialRes] = await Promise.all([
        gleifPrimaryPromise,
        secDirectPromise,
        wikidataPromise,
      ]);

      hits.push(gleifRes.cacheHit);
      if (secDirectRes) hits.push(secDirectRes.cacheHit);
      if (wikidataInitialRes) hits.push(wikidataInitialRes.cacheHit);

      let gleifEntity = gleifRes.entity;
      let secProfile = secDirectRes?.data ?? null;
      let wikidataMeta = wikidataInitialRes?.data ?? null;

      // Cross-link: if GLEIF missed on name/CIK, check Wikidata's P1278 LEI or SEC entity name
      if (!gleifEntity && wikidataMeta?.lei) {
        const byWdLei = await fetchGleifByLei(wikidataMeta.lei, cache, fetchImpl, waitUntil);
        hits.push(byWdLei.cacheHit);
        gleifEntity = byWdLei.entity;
      } else if (!gleifEntity && secProfile?.name) {
        const bySecName = await fetchGleifByFilter(
          "legalName",
          secProfile.name,
          input.country,
          cache,
          fetchImpl,
          waitUntil
        );
        hits.push(bySecName.cacheHit);
        gleifEntity = bySecName.entity;
      }

      // If caller passed LEI/BIC/ISIN/CIK without query, enrich domain/ticker from Wikidata using resolved legal name
      if (!wikidataMeta && !wikidataSearchTerm && (gleifEntity?.legalName || secProfile?.name)) {
        const fallbackName = gleifEntity?.legalName ?? secProfile?.name ?? "";
        const wdByName = await fetchWikidataCorporateMeta(
          fallbackName,
          cache,
          fetchImpl,
          waitUntil
        ).catch(() => {
          partialEnrichment = true;
          return null;
        });
        if (wdByName) {
          hits.push(wdByName.cacheHit);
          wikidataMeta = wdByName.data;
        }
      }

      // If neither GLEIF nor SEC matched and Wikidata threw an upstream error, fail closed 502 instead of false 404
      if (!gleifEntity && !secProfile && !wikidataMeta) {
        if (wikidataError) {
          throw wikidataError;
        }
        c.set("cache_status", "MISS");
        c.set("upstream_error", "ENTITY_NOT_FOUND");
        return c.json(
          {
            error: "ENTITY_NOT_FOUND",
            message: `No registered corporate entity matched '${targetLabel}' across GLEIF LEI, SEC EDGAR, or Wikidata. Payment was not settled.`,
          },
          404
        );
      }

      // Stage 2: Ownership parents (GLEIF), opportunistic SEC EDGAR (from Wikidata P5531 CIK), and USAspending awards
      const resolvedLei = gleifEntity?.lei ?? null;
      const opportunisticCik = !secProfile && wikidataMeta?.cik ? wikidataMeta.cik : null;
      const canonicalName =
        gleifEntity?.legalName ?? secProfile?.name ?? wikidataMeta?.label ?? targetLabel;

      let usaSpendingSucceeded = true;
      const [directParentRes, ultimateParentRes, secExtraRes, usaSpendingRes] = await Promise.all([
        resolvedLei && gleifEntity?.hasDirectParentLink !== false
          ? fetchGleifParent(resolvedLei, "direct-parent", cache, fetchImpl, waitUntil)
          : Promise.resolve(null),
        resolvedLei && gleifEntity?.hasUltimateParentLink !== false
          ? fetchGleifParent(resolvedLei, "ultimate-parent", cache, fetchImpl, waitUntil)
          : Promise.resolve(null),
        opportunisticCik
          ? fetchSecEdgarSubmissions(opportunisticCik, cache, fetchImpl, waitUntil).catch(() => {
              partialEnrichment = true;
              return null;
            })
          : Promise.resolve(null),
        fetchUsaSpendingAwards(canonicalName, cache, fetchImpl, waitUntil).catch(
          (): { data: UsaSpendingBrief; cacheHit: boolean } => {
            partialEnrichment = true;
            usaSpendingSucceeded = false;
            return {
              data: { matched_awards_returned: 0, top_awards_total_usd: 0, top_awards: [] },
              cacheHit: false,
            };
          }
        ),
      ]);

      if (directParentRes) hits.push(directParentRes.cacheHit);
      if (ultimateParentRes) hits.push(ultimateParentRes.cacheHit);
      if (secExtraRes) {
        hits.push(secExtraRes.cacheHit);
        secProfile = secExtraRes.data;
      }
      hits.push(usaSpendingRes.cacheHit);

      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeCompanyVerify({
        gleifEntity,
        directParent: directParentRes?.parent ?? null,
        ultimateParent: ultimateParentRes?.parent ?? null,
        wikidataMeta,
        secProfile,
        usaSpending: usaSpendingRes.data,
        usaSpendingSucceeded,
        partialEnrichment,
        nowMs: nowProvider(),
      });

      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "COMPANY_VERIFY_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary corporate registry (GLEIF LEI or SEC EDGAR) unavailable; refusing to guess entity legal status. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const companyVerifyHandler = createCompanyVerifyHandler();
