import { BoundedTtlCache, TTL_MS, readEdgeCache, writeEdgeCache } from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import type {
  NyFedRateObservation,
  NyFedRrpObservation,
  TreasuryDebtObservation,
  TreasuryTgaObservation,
} from "../types";

const TREASURY_DEBT_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=35";
const TREASURY_TGA_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?sort=-record_date&page[size]=120";
const NYFED_SOFR_URL = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/10.json";
const NYFED_EFFR_URL = "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/10.json";
const NYFED_RRP_URL = "https://markets.newyorkfed.org/api/rp/reverserepo/all/results/last/25.json";

const KEYS = {
  DEBT: "macro:treasury:debt",
  TGA: "macro:treasury:tga",
  SOFR: "macro:nyfed:sofr",
  EFFR: "macro:nyfed:effr",
  RRP: "macro:nyfed:rrp",
} as const;

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/,/g, "");
    if (!cleaned || cleaned.toLowerCase() === "null") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseTreasuryDebt(raw: unknown): TreasuryDebtObservation[] {
  const obj = raw as { data?: Array<Record<string, unknown>> } | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.data)) {
    throw new UpstreamError("TREASURY", "TREASURY_BAD_SCHEMA", "Invalid Treasury debt payload");
  }

  const out: TreasuryDebtObservation[] = [];
  const seenDates = new Set<string>();

  for (const row of obj.data) {
    if (!row || typeof row !== "object") continue;
    const recordDate = typeof row.record_date === "string" ? row.record_date.trim() : "";
    const total = toFiniteNumber(row.tot_pub_debt_out_amt);
    if (!recordDate || total === null || total <= 0 || seenDates.has(recordDate)) continue;
    seenDates.add(recordDate);

    out.push({
      recordDate,
      totalPublicDebtUsd: total,
      debtHeldPublicUsd: toFiniteNumber(row.debt_held_public_amt),
      intragovHoldingsUsd: toFiniteNumber(row.intragov_hold_amt),
    });
  }

  out.sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  return out;
}

export function parseTreasuryTga(raw: unknown): TreasuryTgaObservation[] {
  const obj = raw as { data?: Array<Record<string, unknown>> } | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.data)) {
    throw new UpstreamError("TREASURY", "TREASURY_BAD_SCHEMA", "Invalid Treasury TGA payload");
  }

  // Group rows per record_date because post-April-2022 DTS splits opening/closing across rows.
  const byDate = new Map<string, Array<Record<string, unknown>>>();
  for (const row of obj.data) {
    if (!row || typeof row !== "object") continue;
    const recordDate = typeof row.record_date === "string" ? row.record_date.trim() : "";
    if (!recordDate) continue;
    const bucket = byDate.get(recordDate);
    if (bucket) {
      bucket.push(row);
    } else {
      byDate.set(recordDate, [row]);
    }
  }

  const out: TreasuryTgaObservation[] = [];

  for (const [recordDate, rows] of byDate.entries()) {
    let balanceMillions: number | null = null;

    // 1. Prefer post-2022 "Treasury General Account (TGA) Closing Balance" row
    for (const row of rows) {
      const acct = typeof row.account_type === "string" ? row.account_type.toLowerCase() : "";
      if (acct.includes("tga") && acct.includes("closing")) {
        // Post-2022 DTS stores the closing figure in open_today_bal when close_today_bal is null
        const val = toFiniteNumber(row.close_today_bal) ?? toFiniteNumber(row.open_today_bal);
        if (val !== null && val >= 0) {
          balanceMillions = val;
          break;
        }
      }
    }

    // 2. Fallback to legacy "Federal Reserve Account" or non-opening/non-flow TGA row
    if (balanceMillions === null) {
      for (const row of rows) {
        const acct = typeof row.account_type === "string" ? row.account_type.toLowerCase() : "";
        if (
          acct.includes("federal reserve account") ||
          (acct.includes("treasury general account") &&
            !acct.includes("opening") &&
            !acct.includes("deposit") &&
            !acct.includes("withdrawal"))
        ) {
          const val = toFiniteNumber(row.close_today_bal) ?? toFiniteNumber(row.open_today_bal);
          if (val !== null && val >= 0) {
            balanceMillions = val;
            break;
          }
        }
      }
    }

    if (balanceMillions !== null) {
      out.push({
        recordDate,
        // DTS Operating Cash Balance is reported in millions of USD
        closingBalanceUsd: balanceMillions * 1_000_000,
      });
    }
  }

  out.sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  return out;
}

export function parseNyFedRates(raw: unknown): NyFedRateObservation[] {
  const obj = raw as { refRates?: Array<Record<string, unknown>> } | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.refRates)) {
    throw new UpstreamError("NYFED", "NYFED_BAD_SCHEMA", "Invalid NY Fed reference rates payload");
  }

  const out: NyFedRateObservation[] = [];
  const seenDates = new Set<string>();

  for (const row of obj.refRates) {
    if (!row || typeof row !== "object") continue;
    const effectiveDate = typeof row.effectiveDate === "string" ? row.effectiveDate.trim() : "";
    const percentRate = toFiniteNumber(row.percentRate);
    if (!effectiveDate || percentRate === null || seenDates.has(effectiveDate)) continue;
    seenDates.add(effectiveDate);

    out.push({
      effectiveDate,
      percentRate,
      volumeInBillions: toFiniteNumber(row.volumeInBillions),
      targetRateFrom: toFiniteNumber(row.targetRateFrom),
      targetRateTo: toFiniteNumber(row.targetRateTo),
    });
  }

  out.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return out;
}

export function parseNyFedRrp(raw: unknown): NyFedRrpObservation[] {
  const obj = raw as { repo?: { operations?: Array<Record<string, unknown>> } } | null;
  const ops = obj?.repo?.operations;
  if (!Array.isArray(ops)) {
    throw new UpstreamError("NYFED", "NYFED_BAD_SCHEMA", "Invalid NY Fed reverse repo payload");
  }

  const byDate = new Map<string, NyFedRrpObservation>();

  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const term = typeof op.term === "string" ? op.term.trim().toLowerCase() : "";
    if (term && term !== "overnight") continue;

    const operationDate = typeof op.operationDate === "string" ? op.operationDate.trim() : "";
    const acceptedUsd = toFiniteNumber(op.totalAmtAccepted);
    if (!operationDate || acceptedUsd === null || acceptedUsd < 0) continue;

    // Extract award rate from operation or first detail entry
    let awardRatePct = toFiniteNumber(op.awardRate);
    if (awardRatePct === null && Array.isArray(op.details)) {
      for (const detail of op.details as Array<Record<string, unknown>>) {
        const rate = toFiniteNumber(detail?.percentAwardRate ?? detail?.awardRate);
        if (rate !== null) {
          awardRatePct = rate;
          break;
        }
      }
    }

    const counterpartiesAccepted =
      toFiniteNumber(op.acceptedCounterparties) ??
      toFiniteNumber(op.counterpartiesAccepted) ??
      toFiniteNumber(op.participatingCounterparties);

    const existing = byDate.get(operationDate);
    if (!existing || acceptedUsd > existing.acceptedUsd) {
      byDate.set(operationDate, {
        operationDate,
        acceptedUsd,
        awardRatePct,
        counterpartiesAccepted,
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    b.operationDate.localeCompare(a.operationDate)
  );
}

async function cachedFetch<T>(
  cacheKey: string,
  ttlMs: number,
  cache: BoundedTtlCache,
  fetcher: () => Promise<T>
): Promise<{ data: T; cacheHit: boolean }> {
  const cached = cache.get<T>(cacheKey);
  if (cached.hit) {
    return { data: cached.value, cacheHit: true };
  }
  const edgeCached = await readEdgeCache<T>(cacheKey);
  if (edgeCached.hit) {
    cache.set(cacheKey, edgeCached.value, ttlMs);
    return { data: edgeCached.value, cacheHit: true };
  }
  const data = await fetcher();
  cache.set(cacheKey, data, ttlMs);
  await writeEdgeCache(cacheKey, data, ttlMs);
  return { data, cacheHit: false };
}

export async function fetchTreasuryDebt(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ data: TreasuryDebtObservation[]; cacheHit: boolean }> {
  return cachedFetch(KEYS.DEBT, TTL_MS.MACRO_TREASURY, cache, async () => {
    const res = await fetchJsonWithTimeout<unknown>(TREASURY_DEBT_URL, {
      provider: "TREASURY",
      fetchImpl,
    });
    if (res.status !== "ok") {
      throw new UpstreamError("TREASURY", "TREASURY_UNAVAILABLE", "Treasury debt feed unavailable");
    }
    const parsed = parseTreasuryDebt(res.data);
    if (parsed.length === 0) {
      throw new UpstreamError("TREASURY", "TREASURY_EMPTY", "Treasury debt feed returned 0 rows");
    }
    return parsed;
  });
}

export async function fetchTreasuryTga(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ data: TreasuryTgaObservation[]; cacheHit: boolean }> {
  return cachedFetch(KEYS.TGA, TTL_MS.MACRO_TREASURY, cache, async () => {
    const res = await fetchJsonWithTimeout<unknown>(TREASURY_TGA_URL, {
      provider: "TREASURY",
      fetchImpl,
    });
    if (res.status !== "ok") {
      throw new UpstreamError("TREASURY", "TREASURY_UNAVAILABLE", "Treasury TGA feed unavailable");
    }
    const parsed = parseTreasuryTga(res.data);
    if (parsed.length === 0) {
      throw new UpstreamError("TREASURY", "TREASURY_EMPTY", "Treasury TGA feed returned 0 rows");
    }
    return parsed;
  });
}

export async function fetchNyFedSofr(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ data: NyFedRateObservation[]; cacheHit: boolean }> {
  return cachedFetch(KEYS.SOFR, TTL_MS.MACRO_NYFED, cache, async () => {
    const res = await fetchJsonWithTimeout<unknown>(NYFED_SOFR_URL, {
      provider: "NYFED",
      fetchImpl,
    });
    if (res.status !== "ok") {
      throw new UpstreamError("NYFED", "NYFED_UNAVAILABLE", "NY Fed SOFR feed unavailable");
    }
    const parsed = parseNyFedRates(res.data);
    if (parsed.length === 0) {
      throw new UpstreamError("NYFED", "NYFED_EMPTY", "NY Fed SOFR feed returned 0 rows");
    }
    return parsed;
  });
}

export async function fetchNyFedEffr(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ data: NyFedRateObservation[]; cacheHit: boolean }> {
  return cachedFetch(KEYS.EFFR, TTL_MS.MACRO_NYFED, cache, async () => {
    const res = await fetchJsonWithTimeout<unknown>(NYFED_EFFR_URL, {
      provider: "NYFED",
      fetchImpl,
    });
    if (res.status !== "ok") {
      throw new UpstreamError("NYFED", "NYFED_UNAVAILABLE", "NY Fed EFFR feed unavailable");
    }
    const parsed = parseNyFedRates(res.data);
    if (parsed.length === 0) {
      throw new UpstreamError("NYFED", "NYFED_EMPTY", "NY Fed EFFR feed returned 0 rows");
    }
    return parsed;
  });
}

export async function fetchNyFedRrp(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ data: NyFedRrpObservation[]; cacheHit: boolean }> {
  return cachedFetch(KEYS.RRP, TTL_MS.MACRO_NYFED, cache, async () => {
    const res = await fetchJsonWithTimeout<unknown>(NYFED_RRP_URL, {
      provider: "NYFED",
      fetchImpl,
    });
    if (res.status !== "ok") {
      throw new UpstreamError("NYFED", "NYFED_UNAVAILABLE", "NY Fed ON RRP feed unavailable");
    }
    const parsed = parseNyFedRrp(res.data);
    if (parsed.length === 0) {
      throw new UpstreamError("NYFED", "NYFED_EMPTY", "NY Fed ON RRP feed returned 0 rows");
    }
    return parsed;
  });
}
