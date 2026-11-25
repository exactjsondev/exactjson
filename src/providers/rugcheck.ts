import {
  BoundedTtlCache,
  TTL_MS,
  isolateCache,
  readEdgeCache,
  writeEdgeCache,
} from "../lib/cache";
import { fetchJsonWithTimeout } from "../lib/http";
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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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
  fetchImpl: typeof fetch = fetch
): Promise<RugCheckProviderResult> {
  const cacheKey = `rugcheck:summary:${mint}`;
  const useEdgeCache = cache === isolateCache;

  const cached = cache.get<RugCheckSummary>(cacheKey);
  if (cached.hit) {
    return { status: "ok", data: cached.value, cacheHit: true };
  }

  if (useEdgeCache) {
    const edge = await readEdgeCache<RugCheckSummary>(cacheKey);
    if (edge.hit) {
      cache.set(cacheKey, edge.value, TTL_MS.RUGCHECK_SUMMARY);
      return { status: "ok", data: edge.value, cacheHit: true };
    }
  }

  const url = `${RUGCHECK_BASE_URL}/${encodeURIComponent(mint)}/report/summary`;
  const result = await fetchJsonWithTimeout<unknown>(url, {
    provider: "RUGCHECK",
    method: "GET",
    allow404: true,
    fetchImpl,
  });

  if (result.status === "not_found") {
    return { status: "not_found", cacheHit: false };
  }

  const parsed = parseRugCheckSummary(mint, result.data);
  cache.set(cacheKey, parsed, TTL_MS.RUGCHECK_SUMMARY);
  if (useEdgeCache) {
    await writeEdgeCache(cacheKey, parsed, TTL_MS.RUGCHECK_SUMMARY);
  }
  return { status: "ok", data: parsed, cacheHit: false };
}
