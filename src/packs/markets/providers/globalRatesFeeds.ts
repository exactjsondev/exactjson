import { type BoundedTtlCache, TTL_MS, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout, fetchTextWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

const BIS_MONTHLY_CSV_URL =
  "https://stats.bis.org/api/v1/data/WS_CBPOL/M..?lastNObservations=13&detail=dataonly&format=csv";
const BIS_DAILY_CSV_URL =
  "https://stats.bis.org/api/v1/data/WS_CBPOL/D..?lastNObservations=10&detail=dataonly&format=csv";
const ECB_KEY_RATES_URL =
  "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR+MRR_FR+MLFR.LEV?lastNObservations=6&format=jsondata";
const ECB_ESTR_URL =
  "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=5&format=jsondata";
const BOC_VALET_URL =
  "https://www.bankofcanada.ca/valet/observations/V39079,AVG.INTWO/json?recent=10";

// National central bank series in BIS WS_CBPOL superseded by Eurozone (XM / ECB)
export const EUROZONE_MEMBER_CODES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
]);

export interface BisAreaRateSeries {
  area: string;
  latestRatePct: number;
  latestPeriod: string;
  rate3mAgoPct: number | null;
  rate12mAgoPct: number | null;
}

export interface EcbRatesSnapshot {
  depositFacilityPct: number | null;
  mainRefinancingPct: number | null;
  marginalLendingPct: number | null;
  keyRateDate: string | null;
  estrPct: number | null;
  estrDate: string | null;
  degraded?: boolean;
}

export interface BocRatesSnapshot {
  targetOvernightPct: number | null;
  targetDate: string | null;
  corraPct: number | null;
  corraDate: string | null;
}

interface RawCsvObs {
  period: string;
  value: number;
}

function parseYearMonthMonths(period: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return year * 12 + (month - 1);
}

function unquoteCsvCell(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

function parseBisCsvByArea(csvText: string): Map<string, RawCsvObs[]> {
  const cleanText = csvText.replace(/^\uFEFF/, "").trim();
  const lines = cleanText.split(/\r?\n/);
  if (lines.length < 2) {
    throw new UpstreamError("BIS", "BIS_BAD_CSV", "BIS WS_CBPOL CSV returned empty payload");
  }

  const headerCols = (lines[0] ?? "").split(",").map((c) => unquoteCsvCell(c).toUpperCase());
  const areaIdx = headerCols.indexOf("REF_AREA");
  const periodIdx = headerCols.indexOf("TIME_PERIOD");
  const valIdx = headerCols.indexOf("OBS_VALUE");

  if (areaIdx < 0 || periodIdx < 0 || valIdx < 0) {
    throw new UpstreamError("BIS", "BIS_BAD_CSV_HEADER", "Unexpected BIS WS_CBPOL CSV header");
  }

  const byArea = new Map<string, RawCsvObs[]>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const cols = line.split(",");
    const area = unquoteCsvCell(cols[areaIdx]).toUpperCase();
    const period = unquoteCsvCell(cols[periodIdx]);
    const rawVal = unquoteCsvCell(cols[valIdx]);
    if (!area || !period || !rawVal || rawVal.toLowerCase() === "nan") continue;
    const num = Number(rawVal);
    if (!Number.isFinite(num)) continue;

    const bucket = byArea.get(area);
    if (bucket) {
      bucket.push({ period, value: num });
    } else {
      byArea.set(area, [{ period, value: num }]);
    }
  }

  for (const rows of byArea.values()) {
    rows.sort((a, b) => a.period.localeCompare(b.period));
  }

  return byArea;
}

export function parseBisPolicyRatesCsv(
  monthlyCsv: string,
  dailyCsv: string | null
): { series: BisAreaRateSeries[]; dailyParseFailed: boolean } {
  const monthlyByArea = parseBisCsvByArea(monthlyCsv);
  let dailyByArea = new Map<string, RawCsvObs[]>();
  let dailyParseFailed = false;
  if (dailyCsv !== null) {
    try {
      dailyByArea = parseBisCsvByArea(dailyCsv);
    } catch {
      dailyParseFailed = true;
    }
  }

  let maxDatasetMonths = 0;
  for (const [area, rows] of monthlyByArea.entries()) {
    if (EUROZONE_MEMBER_CODES.has(area)) continue;
    const last = rows[rows.length - 1];
    const ym = last ? parseYearMonthMonths(last.period) : null;
    if (ym !== null && ym > maxDatasetMonths) {
      maxDatasetMonths = ym;
    }
  }

  const results: BisAreaRateSeries[] = [];

  for (const [area, mRows] of monthlyByArea.entries()) {
    // Drop legacy national pre-Eurozone series (DE 1998, GR 2000, HR 2022, etc.)
    if (EUROZONE_MEMBER_CODES.has(area)) continue;
    const latestM = mRows[mRows.length - 1];
    if (!latestM) continue;

    const latestMonths = parseYearMonthMonths(latestM.period);
    // Drop discontinued series older than 9 months behind dataset frontier (e.g., AR discontinued 2025-06)
    if (latestMonths !== null && maxDatasetMonths - latestMonths > 9) {
      continue;
    }

    let latestRatePct = latestM.value;
    let latestPeriod = latestM.period;

    const dRows = dailyByArea.get(area);
    const latestD = dRows?.[dRows.length - 1];
    if (latestD && latestD.period.slice(0, 7) >= latestM.period.slice(0, 7)) {
      latestRatePct = latestD.value;
      latestPeriod = latestD.period;
    }

    // Select observations closest to exact 3 months (window 2..4) and 12 months (window 11..13) prior to latestPeriod
    const anchorMonths = parseYearMonthMonths(latestPeriod) ?? latestMonths;
    let rate3mAgoPct: number | null = null;
    let best3mDist = Number.POSITIVE_INFINITY;
    let rate12mAgoPct: number | null = null;
    let best12mDist = Number.POSITIVE_INFINITY;

    if (anchorMonths !== null) {
      for (const obs of mRows) {
        const obsMonths = parseYearMonthMonths(obs.period);
        if (obsMonths === null) continue;
        const diff = anchorMonths - obsMonths;
        if (diff >= 2 && diff <= 4) {
          const dist = Math.abs(diff - 3);
          if (dist < best3mDist) {
            best3mDist = dist;
            rate3mAgoPct = obs.value;
          }
        }
        if (diff >= 11 && diff <= 13) {
          const dist = Math.abs(diff - 12);
          if (dist < best12mDist) {
            best12mDist = dist;
            rate12mAgoPct = obs.value;
          }
        }
      }
    }

    results.push({
      area,
      latestRatePct,
      latestPeriod,
      rate3mAgoPct,
      rate12mAgoPct,
    });
  }

  if (results.length === 0) {
    throw new UpstreamError("BIS", "BIS_EMPTY", "BIS WS_CBPOL returned 0 active central banks");
  }

  results.sort((a, b) => a.area.localeCompare(b.area));
  return { series: results, dailyParseFailed };
}

export function parseEcbSdmxLatestSeries(
  raw: unknown
): Map<string, { value: number; period: string }> {
  const obj = raw as {
    dataSets?: Array<{
      series?: Record<string, { observations?: Record<string, unknown[]> }>;
    }>;
    structure?: {
      dimensions?: {
        series?: Array<{ id?: string; values?: Array<{ id?: string }> }>;
        observation?: Array<{ id?: string; values?: Array<{ id?: string }> }>;
      };
    };
  } | null;

  const seriesMap = obj?.dataSets?.[0]?.series;
  const seriesDims = obj?.structure?.dimensions?.series ?? [];
  const obsValues = obj?.structure?.dimensions?.observation?.[0]?.values ?? [];

  if (!seriesMap || typeof seriesMap !== "object") {
    throw new UpstreamError("ECB", "ECB_BAD_SDMX", "Invalid ECB SDMX-JSON payload");
  }

  const providerIdDimIndex = seriesDims.findIndex((d) => d.id === "PROVIDER_FM_ID");
  const out = new Map<string, { value: number; period: string }>();

  for (const [seriesKey, seriesData] of Object.entries(seriesMap)) {
    const keyParts = seriesKey.split(":").map((n) => Number(n));
    let seriesCode = "SINGLE";
    if (providerIdDimIndex >= 0) {
      const valIdx = keyParts[providerIdDimIndex];
      const dimVal =
        valIdx !== undefined ? seriesDims[providerIdDimIndex]?.values?.[valIdx]?.id : undefined;
      if (dimVal) seriesCode = dimVal;
    }

    const observations = seriesData?.observations ?? {};
    let bestIdx = -1;
    let bestVal: number | null = null;
    for (const [obsKey, obsArr] of Object.entries(observations)) {
      const idx = Number(obsKey);
      const val = Array.isArray(obsArr) ? toFiniteNumber(obsArr[0]) : null;
      if (Number.isInteger(idx) && val !== null && idx > bestIdx) {
        bestIdx = idx;
        bestVal = val;
      }
    }

    if (bestIdx >= 0 && bestVal !== null) {
      const period = obsValues[bestIdx]?.id ?? "";
      out.set(seriesCode, { value: bestVal, period });
    }
  }

  return out;
}

export function parseBocValetSnapshot(raw: unknown): BocRatesSnapshot {
  const obs = (raw as { observations?: Array<Record<string, unknown>> } | null)?.observations;
  if (!Array.isArray(obs)) {
    throw new UpstreamError("BOC", "BOC_BAD_SCHEMA", "Invalid Bank of Canada Valet payload");
  }

  let targetOvernightPct: number | null = null;
  let targetDate: string | null = null;
  let corraPct: number | null = null;
  let corraDate: string | null = null;

  const sorted = [...obs].sort((a, b) => {
    const da = typeof a?.d === "string" ? a.d : "";
    const db = typeof b?.d === "string" ? b.d : "";
    return db.localeCompare(da);
  });

  for (const row of sorted) {
    if (!row || typeof row !== "object") continue;
    const date = typeof row.d === "string" ? row.d.trim() : "";
    if (!date) continue;

    if (targetOvernightPct === null) {
      const vObj = row.V39079 as { v?: unknown } | undefined;
      const val = toFiniteNumber(vObj?.v);
      if (val !== null) {
        targetOvernightPct = val;
        targetDate = date;
      }
    }
    if (corraPct === null) {
      const cObj = row["AVG.INTWO"] as { v?: unknown } | undefined;
      const val = toFiniteNumber(cObj?.v);
      if (val !== null) {
        corraPct = val;
        corraDate = date;
      }
    }
    if (targetOvernightPct !== null && corraPct !== null) break;
  }

  return { targetOvernightPct, targetDate, corraPct, corraDate };
}

interface CachedBisRatesPayload {
  series: BisAreaRateSeries[];
  degraded: boolean;
}

export async function fetchBisPolicyRates(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: BisAreaRateSeries[]; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<CachedBisRatesPayload>({
    key: "macro:global:bis:cbpol",
    ttlMs: TTL_MS.MACRO_GLOBAL_RATES,
    cache,
    waitUntil,
    shouldCache: (v) => !v.degraded,
    fetcher: async () => {
      let dailyFailed = false;
      const [monthlyRes, dailySettled] = await Promise.all([
        fetchTextWithTimeout(BIS_MONTHLY_CSV_URL, {
          provider: "BIS",
          headers: { Accept: "text/csv" },
          timeoutMs: 6000,
          fetchImpl,
        }),
        fetchTextWithTimeout(BIS_DAILY_CSV_URL, {
          provider: "BIS",
          headers: { Accept: "text/csv" },
          timeoutMs: 6000,
          fetchImpl,
        }).catch(() => {
          dailyFailed = true;
          return { status: "not_found" as const };
        }),
      ]);

      if (monthlyRes.status !== "ok") {
        throw new UpstreamError("BIS", "BIS_UNAVAILABLE", "BIS WS_CBPOL monthly feed unavailable");
      }

      const dailyCsv = dailySettled.status === "ok" ? dailySettled.data : null;
      const parsed = parseBisPolicyRatesCsv(monthlyRes.data, dailyCsv);
      return {
        series: parsed.series,
        degraded: dailyFailed || parsed.dailyParseFailed,
      };
    },
  });
  return { data: value.series, cacheHit };
}

export async function fetchEcbRates(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: EcbRatesSnapshot; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<EcbRatesSnapshot>({
    key: "macro:global:ecb:rates",
    ttlMs: TTL_MS.MACRO_GLOBAL_RATES,
    cache,
    waitUntil,
    shouldCache: (v) => !v.degraded,
    fetcher: async () => {
      let estrDegraded = false;
      const [krRes, estrSettled] = await Promise.all([
        fetchJsonWithTimeout<unknown>(ECB_KEY_RATES_URL, {
          provider: "ECB",
          timeoutMs: 6000,
          fetchImpl,
        }),
        fetchJsonWithTimeout<unknown>(ECB_ESTR_URL, {
          provider: "ECB",
          timeoutMs: 5000,
          fetchImpl,
        }).catch(() => {
          estrDegraded = true;
          return { status: "not_found" as const };
        }),
      ]);

      if (krRes.status !== "ok") {
        throw new UpstreamError("ECB", "ECB_UNAVAILABLE", "ECB key interest rates feed unavailable");
      }

      const krMap = parseEcbSdmxLatestSeries(krRes.data);
      const dfr = krMap.get("DFR") ?? null;
      const mrr = krMap.get("MRR_FR") ?? null;
      const mlfr = krMap.get("MLFR") ?? null;

      if (!dfr && !mrr) {
        throw new UpstreamError("ECB", "ECB_EMPTY", "ECB SDMX feed returned 0 key rates");
      }

      let estrPct: number | null = null;
      let estrDate: string | null = null;
      if (estrSettled.status === "ok") {
        try {
          const estrMap = parseEcbSdmxLatestSeries(estrSettled.data);
          const estrEntry = estrMap.get("SINGLE") ?? [...estrMap.values()][0];
          if (estrEntry) {
            estrPct = estrEntry.value;
            estrDate = estrEntry.period || null;
          }
        } catch {
          estrDegraded = true;
        }
      }

      return {
        depositFacilityPct: dfr?.value ?? null,
        mainRefinancingPct: mrr?.value ?? null,
        marginalLendingPct: mlfr?.value ?? null,
        keyRateDate: dfr?.period || mrr?.period || null,
        estrPct,
        estrDate,
        degraded: estrDegraded,
      };
    },
  });
  return { data: value, cacheHit };
}

export async function fetchBocRates(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: BocRatesSnapshot; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<BocRatesSnapshot>({
    key: "macro:global:boc:rates",
    ttlMs: TTL_MS.MACRO_GLOBAL_RATES,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown>(BOC_VALET_URL, {
        provider: "BOC",
        timeoutMs: 5500,
        fetchImpl,
      });
      if (res.status !== "ok") {
        throw new UpstreamError("BOC", "BOC_UNAVAILABLE", "Bank of Canada Valet feed unavailable");
      }
      const snapshot = parseBocValetSnapshot(res.data);
      if (snapshot.targetOvernightPct === null && snapshot.corraPct === null) {
        throw new UpstreamError("BOC", "BOC_EMPTY", "Bank of Canada Valet returned 0 observations");
      }
      return snapshot;
    },
  });
  return { data: value, cacheHit };
}
