import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  withTwoTierCache,
} from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import { toFiniteNumber } from "../lib/numbers";
import type { RugCheckRiskItem, RugCheckSummary } from "../types";

const RUGCHECK_BASE_URL = "https://api.rugcheck.xyz/v1/tokens";

interface RawRugCheckRisk {
  name?: unknown;
  description?: unknown;
  level?: unknown;
  score?: unknown;
  value?: unknown;
}

interface RawRugCheckMarket {
  lp?: {
    lpLockedPct?: unknown;
  };
}

interface RawRugCheckSummary {
  score?: unknown;
  score_normalised?: unknown;
  lpLockedPct?: unknown;
  tokenProgram?: unknown;
  tokenType?: unknown;
  risks?: unknown;
  markets?: unknown;
}

function extractLpLockedPct(raw: RawRugCheckSummary): number | null {
  const topLevel = toFiniteNumber(raw.lpLockedPct);
  if (topLevel !== null) {
    return Math.min(100, Math.max(0, Number(topLevel.toFixed(4))));
  }

  if (Array.isArray(raw.markets)) {
    let maxLocked: number | null = null;
    for (const item of raw.markets as RawRugCheckMarket[]) {
      const candidate = toFiniteNumber(item?.lp?.lpLockedPct);
      if (candidate !== null && (maxLocked === null || candidate > maxLocked)) {
        maxLocked = candidate;
      }
    }
    if (maxLocked !== null) {
      return Math.min(100, Math.max(0, Number(maxLocked.toFixed(4))));
    }
  }

  return null;
}

export function parseRugCheckSummary(mint: string, raw: unknown): RugCheckSummary {
  const obj = (raw !== null && typeof raw === "object" ? raw : {}) as RawRugCheckSummary;

  const risks: RugCheckRiskItem[] = [];
  if (Array.isArray(obj.risks)) {
    for (const item of obj.risks as RawRugCheckRisk[]) {
      if (!item || typeof item !== "object") continue;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) continue;
      const riskItem: RugCheckRiskItem = {
        name,
        description: typeof item.description === "string" ? item.description.trim() : "",
        level: typeof item.level === "string" ? item.level.trim().toLowerCase() : "info",
        score: toFiniteNumber(item.score) ?? 0,
      };
      if (typeof item.value === "string" && item.value.trim().length > 0) {
        riskItem.value = item.value.trim();
      }
      risks.push(riskItem);
    }
  }

  return {
    mint,
    rawScore: toFiniteNumber(obj.score),
    scoreNormalised: toFiniteNumber(obj.score_normalised),
    lpLockedPct: extractLpLockedPct(obj),
    tokenProgram: typeof obj.tokenProgram === "string" ? obj.tokenProgram : null,
    tokenType: typeof obj.tokenType === "string" ? obj.tokenType : null,
    risks,
  };
}

export type RugCheckProviderResult =
  | { status: "ok"; data: RugCheckSummary; cacheHit: boolean }
  | { status: "not_found"; cacheHit: boolean };

export async function fetchRugCheckSummary(
  mint: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<RugCheckProviderResult> {
  const cacheKey = `rugcheck:summary:${mint}`;
  type CachedVal = { status: "ok"; data: RugCheckSummary } | { status: "not_found" };

  const { value, cacheHit } = await withTwoTierCache<CachedVal, RugCheckSummary>({
    key: cacheKey,
    ttlMs: TTL_MS.RUGCHECK_SUMMARY,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    serializeEdge: (v) => (v as { status: "ok"; data: RugCheckSummary }).data,
    deserializeEdge: (data) => ({ status: "ok", data }),
    fetcher: async () => {
      const url = `${RUGCHECK_BASE_URL}/${encodeURIComponent(mint)}/report/summary`;
      const result = await fetchJsonWithTimeout<unknown>(url, {
        provider: "RUGCHECK",
        method: "GET",
        allow404: true,
        fetchImpl,
      });

      if (result.status === "not_found") {
        return { status: "not_found" };
      }

      if (result.data === null || typeof result.data !== "object" || Array.isArray(result.data)) {
        throw new UpstreamError(
          "RUGCHECK",
          "RUGCHECK_BAD_PAYLOAD",
          "RugCheck returned unexpected payload"
        );
      }

      const rawObj = result.data as Record<string, unknown>;
      if (typeof rawObj.error === "string" && rawObj.error.trim().length > 0) {
        const errText = rawObj.error.trim();
        if (/not\s*found/i.test(errText)) {
          return { status: "not_found" };
        }
        const errCode = /rate\s*limit|too\s*many/i.test(errText)
          ? "RUGCHECK_429"
          : "RUGCHECK_API_ERROR";
        throw new UpstreamError("RUGCHECK", errCode, `RugCheck error: ${errText}`);
      }

      const parsed = parseRugCheckSummary(mint, rawObj);
      if (parsed.rawScore === null && parsed.scoreNormalised === null && !Array.isArray(rawObj.risks)) {
        throw new UpstreamError(
          "RUGCHECK",
          "RUGCHECK_BAD_PAYLOAD",
          "RugCheck response missing score and risks"
        );
      }

      return { status: "ok", data: parsed };
    },
  });

  return value.status === "ok"
    ? { status: "ok", data: value.data, cacheHit }
    : { status: "not_found", cacheHit };
}
