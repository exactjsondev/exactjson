import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { FRANKFURTER_ECB_CURRENCIES } from "../../../lib/countries";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";

export interface BankHolidayYearData {
  supported: boolean;
  holidaysByDate: Record<string, string[]>;
}

export async function fetchNagerBankHolidaysForYear(
  alpha2: string,
  year: number,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: BankHolidayYearData; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<BankHolidayYearData>({
    key: `commerce:nager:${alpha2}:${year}`,
    ttlMs: TTL_MS.COMMERCE_HOLIDAYS_YEAR,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[] | null>(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(alpha2)}`,
        {
          provider: "NAGER_DATE",
          timeoutMs: 4500,
          allow404: true,
          empty204Value: null,
          fetchImpl,
        }
      );

      if (res.status === "not_found" || res.data === null) {
        return { supported: false, holidaysByDate: {} };
      }
      if (!Array.isArray(res.data)) {
        throw new UpstreamError("NAGER_DATE", "NAGER_BAD_SCHEMA", "Invalid Nager.Date year payload");
      }

      const holidaysByDate: Record<string, string[]> = {};
      for (const raw of res.data) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        if (
          typeof row.date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
          typeof row.name !== "string"
        ) {
          continue;
        }

        // Include nationwide holidays and explicit banking holidays; ignore purely regional/optional observances
        const types = Array.isArray(row.types)
          ? row.types.filter((t): t is string => typeof t === "string")
          : [];
        const isBankClosing =
          row.global === true ||
          types.includes("Bank") ||
          (row.counties === null && types.includes("Public"));
        if (!isBankClosing) continue;

        const existing = Object.hasOwn(holidaysByDate, row.date) ? holidaysByDate[row.date]! : [];
        if (!existing.includes(row.name)) {
          existing.push(row.name);
        }
        holidaysByDate[row.date] = existing;
      }

      return { supported: true, holidaysByDate };
    },
  });

  return { data: value, cacheHit };
}

export interface FrankfurterSeriesData {
  supported: boolean;
  asOfDate: string | null;
  series: Array<{ date: string; rate: number }>;
}

export async function fetchFrankfurterFxSeries(
  fromCurrency: string,
  toCurrency: string,
  anchorDate: string,
  nowMs: number = Date.now(),
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: FrankfurterSeriesData; cacheHit: boolean }> {
  // Frankfurter /v1/ returns HTTP 422 on non-ECB currencies; skip cleanly via static ECB currency allowlist
  if (
    !FRANKFURTER_ECB_CURRENCIES.has(fromCurrency) ||
    !FRANKFURTER_ECB_CURRENCIES.has(toCurrency)
  ) {
    return {
      data: { supported: false, asOfDate: null, series: [] },
      cacheHit: true,
    };
  }

  const anchorMs = Date.parse(`${anchorDate}T00:00:00.000Z`);
  const cappedEndMs = Math.min(anchorMs, nowMs);
  const endDate = new Date(cappedEndMs).toISOString().slice(0, 10);
  const startDate = new Date(cappedEndMs - 45 * 86_400_000).toISOString().slice(0, 10);

  const { value, cacheHit } = await withTwoTierCache<FrankfurterSeriesData>({
    key: `commerce:frankfurter:${fromCurrency}:${toCurrency}:${endDate}`,
    ttlMs: TTL_MS.COMMERCE_FRANKFURTER_FX,
    cache,
    waitUntil,
    fetcher: async () => {
      const url = `https://api.frankfurter.dev/v1/${startDate}..${endDate}?base=${encodeURIComponent(fromCurrency)}&symbols=${encodeURIComponent(toCurrency)}`;
      const res = await fetchJsonWithTimeout<Record<string, unknown>>(url, {
        provider: "FRANKFURTER",
        timeoutMs: 4500,
        fetchImpl,
      });

      const rawRates = res.status === "ok" ? res.data?.rates : null;
      if (!rawRates || typeof rawRates !== "object") {
        throw new UpstreamError(
          "FRANKFURTER",
          "FRANKFURTER_BAD_SCHEMA",
          "Invalid Frankfurter FX rates payload"
        );
      }

      const entries = Object.entries(rawRates as Record<string, Record<string, unknown>>)
        .map(([dt, dayRates]) => {
          const val =
            dayRates && typeof dayRates === "object" ? Number(dayRates[toCurrency]) : Number.NaN;
          return { date: dt, rate: val };
        })
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.rate) && r.rate > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (entries.length === 0) {
        throw new UpstreamError(
          "FRANKFURTER",
          "FRANKFURTER_EMPTY_SERIES",
          "Frankfurter returned empty FX series for supported ECB pair"
        );
      }

      return {
        supported: true,
        asOfDate: entries[entries.length - 1]!.date,
        series: entries,
      };
    },
  });

  return { data: value, cacheHit };
}

function checkWorldBankErrorEnvelope(data: unknown): "ok" | "unsupported_economy" {
  if (!Array.isArray(data) || data.length === 0) {
    throw new UpstreamError("WORLDBANK", "WORLDBANK_BAD_SCHEMA", "Invalid World Bank JSON payload");
  }
  const header = data[0] as { message?: Array<{ id?: unknown; value?: unknown }> } | undefined;
  if (Array.isArray(header?.message) && header.message.length > 0) {
    const errId = String(header.message[0]?.id ?? "");
    // Code 120 = economy/territory outside World Bank catalog (e.g., TW, GG, JE, IM, VA)
    if (errId === "120") {
      return "unsupported_economy";
    }
    throw new UpstreamError(
      "WORLDBANK",
      `WORLDBANK_ERR_${errId || "UNKNOWN"}`,
      "World Bank API returned an error envelope"
    );
  }
  return "ok";
}

export interface WorldBankCountryMeta {
  incomeLevel: string | null;
}

export async function fetchWorldBankCountryMeta(
  alpha2: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: WorldBankCountryMeta; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<WorldBankCountryMeta>({
    key: `commerce:wb:country:${alpha2}`,
    ttlMs: TTL_MS.COMMERCE_WORLDBANK,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[]>(
        `https://api.worldbank.org/v2/country/${encodeURIComponent(alpha2)}?format=json`,
        {
          provider: "WORLDBANK",
          timeoutMs: 4500,
          allow404: true,
          fetchImpl,
        }
      );

      if (res.status === "not_found") {
        return { incomeLevel: null };
      }
      if (checkWorldBankErrorEnvelope(res.data) === "unsupported_economy") {
        return { incomeLevel: null };
      }
      if (!Array.isArray(res.data[1])) {
        return { incomeLevel: null };
      }

      const first = res.data[1][0] as { incomeLevel?: { value?: unknown } } | undefined;
      const income =
        typeof first?.incomeLevel?.value === "string" &&
        first.incomeLevel.value.trim() &&
        first.incomeLevel.value !== "Not classified"
          ? first.incomeLevel.value.trim()
          : null;
      return { incomeLevel: income };
    },
  });

  return { data: value, cacheHit };
}

export async function fetchWorldBankUsdFxFallback(
  alpha2: string,
  currencyCode: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ lcuPerUsd: number | null; year: string | null; cacheHit: boolean }> {
  if (currencyCode === "USD") {
    return { lcuPerUsd: 1, year: "peg", cacheHit: true };
  }

  const { value, cacheHit } = await withTwoTierCache<{
    lcuPerUsd: number | null;
    year: string | null;
  }>({
    key: `commerce:wb:fx:${alpha2}:${currencyCode}`,
    ttlMs: TTL_MS.COMMERCE_WORLDBANK,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[]>(
        `https://api.worldbank.org/v2/country/${encodeURIComponent(alpha2)}/indicator/PA.NUS.FCRF?mrv=3&format=json`,
        {
          provider: "WORLDBANK",
          timeoutMs: 4500,
          allow404: true,
          fetchImpl,
        }
      );

      if (res.status === "not_found") {
        return { lcuPerUsd: null, year: null };
      }
      if (checkWorldBankErrorEnvelope(res.data) === "unsupported_economy") {
        return { lcuPerUsd: null, year: null };
      }
      if (!Array.isArray(res.data[1])) {
        return { lcuPerUsd: null, year: null };
      }

      for (const item of res.data[1] as Array<{ value?: unknown; date?: unknown }>) {
        const num = Number(item?.value);
        if (Number.isFinite(num) && num > 0) {
          return {
            lcuPerUsd: num,
            year: typeof item?.date === "string" ? item.date : null,
          };
        }
      }
      return { lcuPerUsd: null, year: null };
    },
  });

  return { ...value, cacheHit };
}
