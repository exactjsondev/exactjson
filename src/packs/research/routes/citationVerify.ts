import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings } from "../../../types";
import {
  fetchCitationByBibliographicQuery,
  fetchCitationByDoi,
} from "../providers/citationFeeds";
import { computeCitationVerify } from "../services/citationVerify";
import { parseCitationVerifyInput } from "../validation";

export interface CitationVerifyDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createCitationVerifyHandler(deps: CitationVerifyDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const parsed = parseCitationVerifyInput({
      doi: c.req.query("doi"),
      query: c.req.query("query"),
      expected_title: c.req.query("expected_title"),
      expected_author: c.req.query("expected_author"),
      expected_year: c.req.query("expected_year"),
    });

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_CITATION_QUERY");
      return c.json({ error: "INVALID_CITATION_QUERY", message: parsed.error }, 400);
    }

    const input = parsed.value;
    c.set("query_target", (input.doi ?? input.query ?? "citation").slice(0, 64));

    const waitUntil = createWaitUntil(c);
    try {
      const lookup =
        input.mode === "doi" && input.doi !== null
          ? await fetchCitationByDoi(input.doi, cache, fetchImpl, waitUntil)
          : await fetchCitationByBibliographicQuery(
              input.query ?? "",
              cache,
              fetchImpl,
              waitUntil
            );

      c.set("cache_status", lookup.cacheHit ? "HIT" : "MISS");
      const body = computeCitationVerify({
        input,
        bundle: lookup.data,
        nowMs: nowProvider(),
      });
      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "CITATION_VERIFY_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Crossref Polite Pool or DataCite DOI registry unavailable; refusing to guess citation existence or retraction status. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const citationVerifyHandler = createCitationVerifyHandler();
