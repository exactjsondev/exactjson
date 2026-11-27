import type { Context } from "hono";
import { type BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { createWaitUntil } from "../../../middleware/telemetry";
import type { AppBindings, CacheStatus } from "../../../types";
import {
  type BankHolidayYearData,
  fetchFrankfurterFxSeries,
  fetchNagerBankHolidaysForYear,
  fetchWorldBankCountryMeta,
  fetchWorldBankUsdFxFallback,
} from "../providers/settlementFeeds";
import { computeSettlementWindow } from "../services/settlementWindow";
import { parseSettlementWindowInput } from "../validation";

export interface SettlementWindowDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createSettlementWindowHandler(deps: SettlementWindowDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowProvider = deps.nowMs ?? (() => Date.now());

  return async (c: Context<AppBindings>) => {
    const nowMs = nowProvider();
    const parsed = parseSettlementWindowInput(
      {
        from: c.req.query("from"),
        to: c.req.query("to"),
        date: c.req.query("date"),
        tenor: c.req.query("tenor"),
        amount: c.req.query("amount"),
      },
      nowMs
    );

    if (!parsed.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_SETTLEMENT_QUERY");
      return c.json({ error: "INVALID_SETTLEMENT_QUERY", message: parsed.error }, 400);
    }

    const { from, to, date, tenor, amount } = parsed.value;
    c.set("query_target", `${from.alpha2}->${to.alpha2}`);
    const waitUntil = createWaitUntil(c);

    try {
      const startYear = Number(date.slice(0, 4));
      const startMonth = Number(date.slice(5, 7));
      const years = startMonth === 12 ? [startYear, startYear + 1] : [startYear];
      const uniqueCountries = from.alpha2 === to.alpha2 ? [from.alpha2] : [from.alpha2, to.alpha2];

      const holidayTasks: Array<Promise<{ key: string; data: BankHolidayYearData; hit: boolean }>> = [];
      for (const alpha2 of uniqueCountries) {
        for (const yr of years) {
          holidayTasks.push(
            fetchNagerBankHolidaysForYear(alpha2, yr, cache, fetchImpl, waitUntil).then((res) => ({
              key: `${alpha2}:${yr}`,
              data: res.data,
              hit: res.cacheHit,
            }))
          );
        }
      }

      const sameCurrency = from.currencyCode === to.currencyCode;
      const [holidayResults, fromWbRes, toWbRes, frankfurterRes] = await Promise.all([
        Promise.all(holidayTasks),
        fetchWorldBankCountryMeta(from.alpha2, cache, fetchImpl, waitUntil),
        from.alpha2 === to.alpha2
          ? Promise.resolve(null)
          : fetchWorldBankCountryMeta(to.alpha2, cache, fetchImpl, waitUntil),
        sameCurrency
          ? Promise.resolve(null)
          : fetchFrankfurterFxSeries(
              from.currencyCode,
              to.currencyCode,
              date,
              nowMs,
              cache,
              fetchImpl,
              waitUntil
            ),
      ]);

      const hits: boolean[] = [
        ...holidayResults.map((h) => h.hit),
        fromWbRes.cacheHit,
      ];
      if (toWbRes) hits.push(toWbRes.cacheHit);
      if (frankfurterRes) hits.push(frankfurterRes.cacheHit);

      let wbCrossRate: { spotRate: number | null; asOfYear: string | null } | null = null;
      if (!sameCurrency && !frankfurterRes?.data.supported) {
        const [fromUsd, toUsd] = await Promise.all([
          fetchWorldBankUsdFxFallback(from.alpha2, from.currencyCode, cache, fetchImpl, waitUntil),
          fetchWorldBankUsdFxFallback(to.alpha2, to.currencyCode, cache, fetchImpl, waitUntil),
        ]);
        hits.push(fromUsd.cacheHit, toUsd.cacheHit);
        if (fromUsd.lcuPerUsd && toUsd.lcuPerUsd && fromUsd.lcuPerUsd > 0) {
          wbCrossRate = {
            spotRate: toUsd.lcuPerUsd / fromUsd.lcuPerUsd,
            asOfYear: toUsd.year ?? fromUsd.year,
          };
        } else if (amount !== null) {
          throw new UpstreamError(
            "WORLDBANK",
            "FX_RATE_UNAVAILABLE",
            `FX conversion rate unavailable for ${from.currencyCode}/${to.currencyCode}`
          );
        }
      }

      const holidaysByCountryYear = new Map<string, BankHolidayYearData>(
        holidayResults.map((h) => [h.key, h.data])
      );

      const cacheStatus: CacheStatus = hits.every(Boolean)
        ? "HIT"
        : hits.some(Boolean)
          ? "PARTIAL"
          : "MISS";
      c.set("cache_status", cacheStatus);

      const body = computeSettlementWindow({
        from,
        to,
        initiationDate: date,
        tenor,
        amount,
        holidaysByCountryYear,
        fromWbMeta: fromWbRes.data,
        toWbMeta: toWbRes ? toWbRes.data : fromWbRes.data,
        frankfurterFx: frankfurterRes ? frankfurterRes.data : null,
        worldBankCrossRate: wbCrossRate,
        nowMs,
      });

      c.set("upstream_source", body.metadata.sources.join(","));
      return c.json(body, 200);
    } catch (err) {
      const code = err instanceof UpstreamError ? err.code : "SETTLEMENT_WINDOW_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "Primary holiday calendar or FX rate feed unavailable; refusing to compute cross-border settlement window. Payment was not settled.",
        },
        502
      );
    }
  };
}

export const settlementWindowHandler = createSettlementWindowHandler();
