import {
  BoundedTtlCache,
  TTL_MS,
  isolateCache,
  readEdgeCache,
  writeEdgeCache,
} from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import type { HoneypotIsResult } from "../types";

const HONEYPOT_IS_BASE_URL = "https://api.honeypot.is/v2/IsHoneypot";

interface RawHoneypotResponse {
  token?: {
    name?: unknown;
    symbol?: unknown;
    address?: unknown;
    totalHolders?: unknown;
  };
  simulationSuccess?: unknown;
  simulationError?: unknown;
  honeypotResult?: {
    isHoneypot?: unknown;
    honeypotReason?: unknown;
  };
  simulationResult?: {
    buyTax?: unknown;
    sellTax?: unknown;
    transferTax?: unknown;
  };
  contractCode?: {
    openSource?: unknown;
    isProxy?: unknown;
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function toOptionalBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Honeypot.is simulationResult taxes are already in percent (e.g. 5 = 5%).
 */
function parsePercentTax(value: unknown): number | null {
  const num = toFiniteNumber(value);
  if (num === null || num < 0) return null;
  return Math.min(100, roundTo(num, 2));
}

export function parseHoneypotIsResult(
  chainId: number,
  address: string,
  raw: unknown
): { status: "ok"; data: HoneypotIsResult } | { status: "not_found" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UpstreamError(
      "HONEYPOT_IS",
      "HONEYPOT_IS_BAD_PAYLOAD",
      "Honeypot.is returned unexpected payload"
    );
  }

  const obj = raw as RawHoneypotResponse & { error?: unknown };
  if (typeof obj.error === "string" && obj.error.trim().length > 0) {
    const errText = obj.error.trim();
    if (/not\s*found|no\s*pair/i.test(errText)) {
      return { status: "not_found" };
    }
    const errCode = /rate\s*limit|too\s*many/i.test(errText)
      ? "HONEYPOT_IS_429"
      : "HONEYPOT_IS_API_ERROR";
    throw new UpstreamError("HONEYPOT_IS", errCode, `Honeypot.is error: ${errText}`);
  }

  const hasSimulationField = typeof obj.simulationSuccess === "boolean";
  const hasHoneypotObj =
    obj.honeypotResult !== undefined &&
    obj.honeypotResult !== null &&
    typeof obj.honeypotResult === "object";

  if (!hasSimulationField && !hasHoneypotObj) {
    throw new UpstreamError(
      "HONEYPOT_IS",
      "HONEYPOT_IS_BAD_PAYLOAD",
      "Honeypot.is response missing simulationSuccess and honeypotResult"
    );
  }

  const simulationSuccess = obj.simulationSuccess === true;
  const holderCountRaw = toFiniteNumber(obj.token?.totalHolders);

  return {
    status: "ok",
    data: {
      address: address.toLowerCase(),
      chainId,
      tokenName: toNonEmptyString(obj.token?.name),
      tokenSymbol: toNonEmptyString(obj.token?.symbol),
      simulationSuccess,
      simulationError: toNonEmptyString(obj.simulationError),
      isHoneypot: toOptionalBool(obj.honeypotResult?.isHoneypot),
      honeypotReason: toNonEmptyString(obj.honeypotResult?.honeypotReason),
      buyTaxPct: parsePercentTax(obj.simulationResult?.buyTax),
      sellTaxPct: parsePercentTax(obj.simulationResult?.sellTax),
      transferTaxPct: parsePercentTax(obj.simulationResult?.transferTax),
      openSource: toOptionalBool(obj.contractCode?.openSource),
      isProxy: toOptionalBool(obj.contractCode?.isProxy),
      holderCount: holderCountRaw !== null && holderCountRaw >= 0 ? Math.round(holderCountRaw) : null,
    },
  };
}

export type HoneypotIsProviderResult =
  | { status: "ok"; data: HoneypotIsResult; cacheHit: boolean }
  | { status: "not_found"; cacheHit: boolean };

export async function fetchHoneypotIsResult(
  chainId: number,
  address: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch
): Promise<HoneypotIsProviderResult> {
  const normalizedAddr = address.toLowerCase();
  const cacheKey = `honeypotis:v2:${chainId}:${normalizedAddr}`;
  const useEdgeCache = cache === isolateCache;

  const cached = cache.get<HoneypotIsResult>(cacheKey);
  if (cached.hit) {
    return { status: "ok", data: cached.value, cacheHit: true };
  }

  if (useEdgeCache) {
    const edge = await readEdgeCache<HoneypotIsResult>(cacheKey);
    if (edge.hit) {
      cache.set(cacheKey, edge.value, TTL_MS.HONEYPOT_IS);
      return { status: "ok", data: edge.value, cacheHit: true };
    }
  }

  const url = `${HONEYPOT_IS_BASE_URL}?address=${encodeURIComponent(normalizedAddr)}&chainID=${encodeURIComponent(String(chainId))}`;
  const res = await fetchJsonWithTimeout<unknown>(url, {
    provider: "HONEYPOT_IS",
    method: "GET",
    allow404: true,
    fetchImpl,
  });

  if (res.status === "not_found") {
    return { status: "not_found", cacheHit: false };
  }

  const parsed = parseHoneypotIsResult(chainId, normalizedAddr, res.data);
  if (parsed.status === "not_found") {
    return { status: "not_found", cacheHit: false };
  }

  cache.set(cacheKey, parsed.data, TTL_MS.HONEYPOT_IS);
  if (useEdgeCache) {
    await writeEdgeCache(cacheKey, parsed.data, TTL_MS.HONEYPOT_IS);
  }
  return { status: "ok", data: parsed.data, cacheHit: false };
}
