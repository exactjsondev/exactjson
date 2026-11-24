import { BoundedTtlCache, TTL_MS, readEdgeCache, writeEdgeCache } from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import type { DeribitOptionContract, OptionsCurrency } from "../types";

const DERIBIT_API_BASE = "https://www.deribit.com/api/v2/public/get_book_summary_by_currency";

const MONTHS: Readonly<Record<string, number>> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const INSTRUMENT_RE = /^(BTC|ETH)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-(C|P)$/;

interface RawDeribitSummary {
  instrument_name?: unknown;
  mark_iv?: unknown;
  open_interest?: unknown;
  volume?: unknown;
  volume_usd?: unknown;
  underlying_price?: unknown;
}

interface RawDeribitResponse {
  result?: RawDeribitSummary[];
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "string" && val.trim().length > 0) {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseDeribitExpiryMs(dayStr: string, monStr: string, yrStr: string): number | null {
  const monthIdx = MONTHS[monStr];
  if (monthIdx === undefined) return null;

  const day = Number(dayStr);
  const year = 2000 + Number(yrStr);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  // Deribit crypto options expire at 08:00:00 UTC
  const ms = Date.UTC(year, monthIdx, day, 8, 0, 0);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== monthIdx ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

export function parseDeribitOptions(
  raw: unknown,
  expectedCurrency: OptionsCurrency
): DeribitOptionContract[] {
  const obj = raw as RawDeribitResponse | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.result)) {
    throw new UpstreamError(
      "DERIBIT",
      "DERIBIT_BAD_SCHEMA",
      "Deribit returned unexpected book summary payload"
    );
  }

  const out: DeribitOptionContract[] = [];

  for (const row of obj.result) {
    if (!row || typeof row !== "object") continue;
    const name = typeof row.instrument_name === "string" ? row.instrument_name.trim() : "";
    const match = INSTRUMENT_RE.exec(name);
    if (!match) continue;

    const currency = match[1] as OptionsCurrency;
    if (currency !== expectedCurrency) continue;

    const dayStr = match[2]!;
    const monStr = match[3]!;
    const yrStr = match[4]!;
    const strike = Number(match[5]);
    const optionType = match[6] as "C" | "P";

    if (!Number.isFinite(strike) || strike <= 0) continue;

    const expiryMs = parseDeribitExpiryMs(dayStr, monStr, yrStr);
    if (expiryMs === null) continue;

    const rawIv = toFiniteNumber(row.mark_iv);
    const markIvPct = rawIv !== null && rawIv > 0 && rawIv <= 500 ? rawIv : null;

    const openInterest = Math.max(0, toFiniteNumber(row.open_interest) ?? 0);
    const volume24h = Math.max(0, toFiniteNumber(row.volume) ?? 0);
    const rawVolUsd = toFiniteNumber(row.volume_usd);
    const volume24hUsd = rawVolUsd !== null && rawVolUsd >= 0 ? rawVolUsd : null;

    const rawSpot = toFiniteNumber(row.underlying_price);
    const underlyingPrice = rawSpot !== null && rawSpot > 0 ? rawSpot : null;

    out.push({
      instrumentName: name,
      currency,
      expiryCode: `${dayStr}${monStr}${yrStr}`,
      expiryMs,
      expiryIso: new Date(expiryMs).toISOString(),
      strike,
      optionType,
      markIvPct,
      openInterest,
      volume24h,
      volume24hUsd,
      underlyingPrice,
    });
  }

  return out;
}

export async function fetchDeribitOptions(
  currency: OptionsCurrency,
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ contracts: DeribitOptionContract[]; cacheHit: boolean }> {
  const cacheKey = `deribit:options:${currency}`;
  const cached = cache.get<DeribitOptionContract[]>(cacheKey);
  if (cached.hit) {
    return { contracts: cached.value, cacheHit: true };
  }

  const edgeCached = await readEdgeCache<DeribitOptionContract[]>(cacheKey);
  if (edgeCached.hit) {
    cache.set(cacheKey, edgeCached.value, TTL_MS.DERIBIT_OPTIONS);
    return { contracts: edgeCached.value, cacheHit: true };
  }

  const url = `${DERIBIT_API_BASE}?currency=${encodeURIComponent(currency)}&kind=option`;
  const res = await fetchJsonWithTimeout<unknown>(url, {
    provider: "DERIBIT",
    fetchImpl,
  });

  if (res.status !== "ok") {
    throw new UpstreamError("DERIBIT", "DERIBIT_UNAVAILABLE", "Deribit options unavailable");
  }

  const contracts = parseDeribitOptions(res.data, currency);
  if (contracts.length === 0) {
    throw new UpstreamError("DERIBIT", "DERIBIT_EMPTY", `No Deribit ${currency} options returned`);
  }

  cache.set(cacheKey, contracts, TTL_MS.DERIBIT_OPTIONS);
  await writeEdgeCache(cacheKey, contracts, TTL_MS.DERIBIT_OPTIONS);
  return { contracts, cacheHit: false };
}
