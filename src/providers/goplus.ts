import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  withTwoTierCache,
} from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import { roundTo, toFiniteNumber } from "../lib/numbers";
import type { GoPlusTokenSecurity } from "../types";

const GOPLUS_BASE_URL = "https://api.gopluslabs.io/api/v1/token_security";

const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000001",
]);

interface RawGoPlusHolder {
  address?: unknown;
  percent?: unknown;
  is_locked?: unknown;
  is_contract?: unknown;
  tag?: unknown;
}

interface RawGoPlusTokenEntry {
  token_name?: unknown;
  token_symbol?: unknown;
  is_honeypot?: unknown;
  is_open_source?: unknown;
  is_proxy?: unknown;
  is_mintable?: unknown;
  owner_change_balance?: unknown;
  hidden_owner?: unknown;
  can_take_back_ownership?: unknown;
  selfdestruct?: unknown;
  cannot_buy?: unknown;
  cannot_sell_all?: unknown;
  transfer_pausable?: unknown;
  is_blacklisted?: unknown;
  slippage_modifiable?: unknown;
  owner_address?: unknown;
  buy_tax?: unknown;
  sell_tax?: unknown;
  holder_count?: unknown;
  holders?: unknown;
  lp_holders?: unknown;
}

interface RawGoPlusResponse {
  code?: unknown;
  message?: unknown;
  result?: unknown;
}

function toGoPlusBool(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function isBurnAddress(address: unknown): boolean {
  return typeof address === "string" && BURN_ADDRESSES.has(address.trim().toLowerCase());
}

/**
 * GoPlus returns buy_tax / sell_tax as 0..1 decimal strings (e.g. "0.05" = 5%).
 */
function parseGoPlusTaxPct(value: unknown): number | null {
  const num = toFiniteNumber(value);
  if (num === null || num < 0) return null;
  return Math.min(100, roundTo(num * 100, 2));
}

function parseTop10HolderPct(holders: unknown): number | null {
  if (!Array.isArray(holders) || holders.length === 0) return null;

  let sumFraction = 0;
  let validCount = 0;
  for (const item of (holders as RawGoPlusHolder[]).slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const pct = toFiniteNumber(item.percent);
    if (pct === null || pct < 0) continue;
    validCount += 1;

    // Exclude burn, locked, and contract pools (DEX pairs/bridges) to avoid blue-chip false positives
    const isLocked = toGoPlusBool(item.is_locked) === true;
    const isContract = toGoPlusBool(item.is_contract) === true;
    if (isBurnAddress(item.address) || isLocked || isContract) {
      continue;
    }
    sumFraction += pct;
  }

  if (validCount === 0) return null;
  return Math.min(100, roundTo(sumFraction * 100, 2));
}

function parseLpLockedPct(lpHolders: unknown): number | null {
  if (!Array.isArray(lpHolders) || lpHolders.length === 0) return null;

  let lockedFraction = 0;
  let validCount = 0;
  for (const item of lpHolders as RawGoPlusHolder[]) {
    if (!item || typeof item !== "object") continue;
    const pct = toFiniteNumber(item.percent);
    if (pct === null || pct < 0) continue;
    validCount += 1;

    const isLocked = toGoPlusBool(item.is_locked) === true;
    if (isLocked || isBurnAddress(item.address)) {
      lockedFraction += pct;
    }
  }

  if (validCount === 0) return null;
  return Math.min(100, Math.max(0, roundTo(lockedFraction * 100, 2)));
}

function parseOwnerRenounced(ownerAddress: unknown): boolean | null {
  if (typeof ownerAddress !== "string") return null;
  const trimmed = ownerAddress.trim().toLowerCase();
  // Empty string in GoPlus means no standard owner() detected (e.g. AccessControl/unverified), not renounced
  if (trimmed.length === 0) return null;
  if (BURN_ADDRESSES.has(trimmed)) return true;
  if (/^0x[0-9a-f]{40}$/.test(trimmed)) return false;
  return null;
}

export function parseGoPlusTokenSecurity(
  chainId: number,
  address: string,
  raw: unknown
): { status: "ok"; data: GoPlusTokenSecurity } | { status: "not_found" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UpstreamError("GOPLUS", "GOPLUS_BAD_PAYLOAD", "GoPlus returned unexpected payload");
  }
  const payload = raw as RawGoPlusResponse;
  const code = toFiniteNumber(payload.code);

  if (code === null) {
    throw new UpstreamError("GOPLUS", "GOPLUS_BAD_PAYLOAD", "GoPlus response missing status code");
  }

  if (code !== 1) {
    const msg = typeof payload.message === "string" ? payload.message : `code ${code}`;
    const errCode =
      code === 4029 || /rate\s*limit|too\s*many/i.test(msg)
        ? "GOPLUS_429"
        : "GOPLUS_API_ERROR";
    throw new UpstreamError("GOPLUS", errCode, `GoPlus returned code ${code}: ${msg}`, null);
  }

  if (!payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    return { status: "not_found" };
  }

  const normalizedAddr = address.toLowerCase();
  const resultMap = payload.result as Record<string, unknown>;
  let entry = resultMap[normalizedAddr] as RawGoPlusTokenEntry | undefined;

  if (!entry) {
    for (const [key, val] of Object.entries(resultMap)) {
      if (key.toLowerCase() === normalizedAddr) {
        entry = val as RawGoPlusTokenEntry;
        break;
      }
    }
  }

  if (!entry || typeof entry !== "object" || Object.keys(entry).length === 0) {
    return { status: "not_found" };
  }

  const holderCountRaw = toFiniteNumber(entry.holder_count);

  return {
    status: "ok",
    data: {
      address: normalizedAddr,
      chainId,
      tokenName: toNonEmptyString(entry.token_name),
      tokenSymbol: toNonEmptyString(entry.token_symbol),
      isHoneypot: toGoPlusBool(entry.is_honeypot),
      isOpenSource: toGoPlusBool(entry.is_open_source),
      isProxy: toGoPlusBool(entry.is_proxy),
      isMintable: toGoPlusBool(entry.is_mintable),
      ownerChangeBalance: toGoPlusBool(entry.owner_change_balance),
      hiddenOwner: toGoPlusBool(entry.hidden_owner),
      canTakeBackOwnership: toGoPlusBool(entry.can_take_back_ownership),
      selfdestruct: toGoPlusBool(entry.selfdestruct),
      cannotBuy: toGoPlusBool(entry.cannot_buy),
      cannotSellAll: toGoPlusBool(entry.cannot_sell_all),
      transferPausable: toGoPlusBool(entry.transfer_pausable),
      isBlacklisted: toGoPlusBool(entry.is_blacklisted),
      slippageModifiable: toGoPlusBool(entry.slippage_modifiable),
      ownerRenounced: parseOwnerRenounced(entry.owner_address),
      buyTaxPct: parseGoPlusTaxPct(entry.buy_tax),
      sellTaxPct: parseGoPlusTaxPct(entry.sell_tax),
      holderCount: holderCountRaw !== null && holderCountRaw >= 0 ? Math.round(holderCountRaw) : null,
      top10HolderPct: parseTop10HolderPct(entry.holders),
      lpLockedPct: parseLpLockedPct(entry.lp_holders),
    },
  };
}

export type GoPlusProviderResult =
  | { status: "ok"; data: GoPlusTokenSecurity; cacheHit: boolean }
  | { status: "not_found"; cacheHit: boolean };

export async function fetchGoPlusTokenSecurity(
  chainId: number,
  address: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<GoPlusProviderResult> {
  const normalizedAddr = address.toLowerCase();
  const cacheKey = `goplus:security:${chainId}:${normalizedAddr}`;
  type CachedVal = { status: "ok"; data: GoPlusTokenSecurity } | { status: "not_found" };

  const { value, cacheHit } = await withTwoTierCache<CachedVal, GoPlusTokenSecurity>({
    key: cacheKey,
    ttlMs: TTL_MS.GOPLUS_SECURITY,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    serializeEdge: (v) => (v as { status: "ok"; data: GoPlusTokenSecurity }).data,
    deserializeEdge: (data) => ({ status: "ok", data }),
    fetcher: async () => {
      const url = `${GOPLUS_BASE_URL}/${encodeURIComponent(String(chainId))}?contract_addresses=${encodeURIComponent(normalizedAddr)}`;
      const res = await fetchJsonWithTimeout<unknown>(url, {
        provider: "GOPLUS",
        method: "GET",
        allow404: true,
        fetchImpl,
      });

      if (res.status === "not_found") {
        return { status: "not_found" };
      }

      return parseGoPlusTokenSecurity(chainId, normalizedAddr, res.data);
    },
  });

  return value.status === "ok"
    ? { status: "ok", data: value.data, cacheHit }
    : { status: "not_found", cacheHit };
}
