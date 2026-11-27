import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { parseBisPolicyRatesCsv, parseEcbSdmxLatestSeries } from "../src/packs/markets/providers/globalRatesFeeds";
import { createGlobalRatesHandler } from "../src/packs/markets/routes/globalRates";
import { parseGlobalRatesInput } from "../src/packs/markets/services/globalRates";
import type { AppBindings } from "../src/types";

const FIXED_NOW = Date.parse("2026-11-27T20:00:00.000Z");

const SAMPLE_BIS_MONTHLY_CSV = [
  "FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE",
  // Active US
  "M,US,2025-10,4.375",
  "M,US,2026-07,4.375",
  "M,US,2026-10,4.375",
  // Active Euro Area
  "M,XM,2025-10,3.25",
  "M,XM,2026-07,2.75",
  "M,XM,2026-10,2.50",
  // Active Japan (hiking)
  "M,JP,2025-10,0.50",
  "M,JP,2026-07,0.75",
  "M,JP,2026-10,1.25",
  // Active Switzerland (funding currency 0%)
  "M,CH,2025-10,0.50",
  "M,CH,2026-07,0.25",
  "M,CH,2026-10,0.00",
  // Active Canada
  "M,CA,2025-10,3.25",
  "M,CA,2026-07,2.75",
  "M,CA,2026-10,2.50",
  // Active Brazil (high EM carry)
  "M,BR,2025-10,11.25",
  "M,BR,2026-07,13.25",
  "M,BR,2026-10,13.75",
  // Legacy Eurozone member Greece (ending year 2000 — MUST BE DROPPED!)
  "M,GR,1999-12,10.25",
  "M,GR,2000-12,3.75",
  // Legacy Croatia with NaN (MUST BE DROPPED!)
  "M,HR,2022-12,NaN",
  // Discontinued Argentina >9m behind frontier (2025-06 vs 2026-10 — MUST BE DROPPED!)
  "M,AR,2025-06,29.00",
].join("\n");

const SAMPLE_BIS_DAILY_CSV = [
  "FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE",
  "D,JP,2026-11-24,1.25",
  "D,BR,2026-11-24,13.75",
  "D,BR,2026-11-25,NaN", // Weekend/holiday NaN must be skipped cleanly
].join("\n");

const SAMPLE_ECB_SDMX = {
  dataSets: [
    {
      series: {
        "0:0:0:0:0:0:0": { observations: { "0": [2.75], "1": [2.5] } },
        "0:0:0:0:0:1:0": { observations: { "0": [3.15], "1": [2.9] } },
        "0:0:0:0:0:2:0": { observations: { "0": [2.9], "1": [2.65] } },
      },
    },
  ],
  structure: {
    dimensions: {
      series: [
        { id: "FREQ", values: [{ id: "B" }] },
        { id: "REF_AREA", values: [{ id: "U2" }] },
        { id: "CURRENCY", values: [{ id: "EUR" }] },
        { id: "PROVIDER_FM", values: [{ id: "4F" }] },
        { id: "INSTRUMENT_FM", values: [{ id: "KR" }] },
        {
          id: "PROVIDER_FM_ID",
          values: [{ id: "DFR" }, { id: "MLFR" }, { id: "MRR_FR" }],
        },
        { id: "DATA_TYPE_FM", values: [{ id: "LEV" }] },
      ],
      observation: [
        {
          id: "TIME_PERIOD",
          values: [{ id: "2026-06-17" }, { id: "2026-09-16" }],
        },
      ],
    },
  },
};

describe("macro/global-rates BIS/ECB/BoC/NY Fed synthesis & Eurozone legacy guards", () => {
  it("strips pre-Eurozone legacy series and NaN rows from BIS CSV and maps ECB SDMX dimensions dynamically", () => {
    const { series: parsedBis } = parseBisPolicyRatesCsv(
      SAMPLE_BIS_MONTHLY_CSV,
      SAMPLE_BIS_DAILY_CSV
    );
    expect(parsedBis.map((r) => r.area)).toEqual(["BR", "CA", "CH", "JP", "US", "XM"]);
    expect(parsedBis.find((r) => r.area === "GR")).toBeUndefined();
    expect(parsedBis.find((r) => r.area === "HR")).toBeUndefined();
    expect(parsedBis.find((r) => r.area === "AR")).toBeUndefined();
    expect(parsedBis.find((r) => r.area === "BR")?.latestRatePct).toBe(13.75);
    expect(parsedBis.find((r) => r.area === "BR")?.latestPeriod).toBe("2026-11-24");

    const ecbMap = parseEcbSdmxLatestSeries(SAMPLE_ECB_SDMX);
    expect(ecbMap.get("DFR")).toEqual({ value: 2.5, period: "2026-09-16" });
    expect(ecbMap.get("MLFR")).toEqual({ value: 2.9, period: "2026-09-16" });
    expect(ecbMap.get("MRR_FR")).toEqual({ value: 2.65, period: "2026-09-16" });

    expect(parseGlobalRatesInput({ base: "DE", countries: "FR,UK,JP" })).toEqual({
      ok: true,
      value: {
        baseArea: "XM",
        baseCurrency: "EUR",
        group: "all",
        countriesFilter: ["XM", "GB", "JP"],
        mappedEurozoneInputs: ["DE", "FR"],
      },
    });
    expect(parseGlobalRatesInput({ base: "INVALID" }).ok).toBe(false);
    expect(parseGlobalRatesInput({ group: "bogus" }).ok).toBe(false);
  });

  it("computes global hike/cut cycles, G4 overnight spreads, carry matrix, and fails closed on BIS or >=2 G3 outages", async () => {
    const makeMockFetch = (opts: { failBis?: boolean; failEcbAndBoc?: boolean } = {}): typeof fetch =>
      async (input) => {
        const url = String(input);

        if (url.includes("stats.bis.org/api/v1/data/WS_CBPOL/M..")) {
          if (opts.failBis) return new Response("Upstream Error", { status: 503 });
          return new Response(SAMPLE_BIS_MONTHLY_CSV, {
            status: 200,
            headers: { "Content-Type": "text/csv" },
          });
        }
        if (url.includes("stats.bis.org/api/v1/data/WS_CBPOL/D..")) {
          return new Response(SAMPLE_BIS_DAILY_CSV, {
            status: 200,
            headers: { "Content-Type": "text/csv" },
          });
        }
        if (url.includes("data-api.ecb.europa.eu/service/data/FM/")) {
          if (opts.failEcbAndBoc) return new Response("ECB Down", { status: 502 });
          return new Response(JSON.stringify(SAMPLE_ECB_SDMX), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("data-api.ecb.europa.eu/service/data/EST/")) {
          return new Response(
            JSON.stringify({
              dataSets: [{ series: { "0:0:0": { observations: { "0": [2.445] } } } }],
              structure: {
                dimensions: {
                  series: [{ id: "FREQ", values: [{ id: "B" }] }],
                  observation: [{ id: "TIME_PERIOD", values: [{ id: "2026-11-26" }] }],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("bankofcanada.ca/valet/observations/")) {
          if (opts.failEcbAndBoc) return new Response("BoC Down", { status: 503 });
          return new Response(
            JSON.stringify({
              observations: [
                {
                  d: "2026-11-26",
                  V39079: { v: "2.50" },
                  "AVG.INTWO": { v: "2.51" },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("newyorkfed.org/api/rates/unsecured/effr/")) {
          return new Response(
            JSON.stringify({
              refRates: [
                {
                  effectiveDate: "2026-11-25",
                  percentRate: 4.33,
                  targetRateFrom: 4.25,
                  targetRateTo: 4.5,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("newyorkfed.org/api/rates/secured/sofr/")) {
          return new Response(
            JSON.stringify({
              refRates: [{ effectiveDate: "2026-11-25", percentRate: 4.35, volumeInBillions: 2150 }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not Found", { status: 404 });
      };

    const okApp = new Hono<AppBindings>();
    okApp.get(
      "/v1/macro/global-rates",
      createGlobalRatesHandler({
        cache: new BoundedTtlCache(32),
        fetchImpl: makeMockFetch(),
        nowMs: () => FIXED_NOW,
      })
    );

    const res = await okApp.request("http://localhost/v1/macro/global-rates?base=USD");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      filters: { base_currency: string; base_rate_pct: number };
      global_summary: {
        active_central_banks: number;
        hiking_12m_count: number;
        cutting_12m_count: number;
        highest_rate: { area: string; rate_pct: number };
        lowest_rate: { area: string; rate_pct: number };
      };
      g4_money_markets: {
        usd_fed: { midpoint_pct: number; sofr_pct: number };
        eur_ecb: { deposit_facility_pct: number; estr_pct: number; estr_df_spread_bps: number };
        cad_boc: { target_overnight_pct: number; corra_pct: number };
      };
      top_positive_carry_vs_base: Array<{ area: string; carry_spread_vs_base_bps: number }>;
    };

    expect(body.filters.base_currency).toBe("USD");
    expect(body.filters.base_rate_pct).toBe(4.375);
    expect(body.global_summary.active_central_banks).toBe(6);
    expect(body.global_summary.hiking_12m_count).toBe(2); // JP + BR
    expect(body.global_summary.cutting_12m_count).toBe(3); // XM, CH, CA
    expect(body.global_summary.highest_rate).toEqual({ area: "BR", currency: "BRL", rate_pct: 13.75 });
    expect(body.global_summary.lowest_rate).toEqual({ area: "CH", currency: "CHF", rate_pct: 0 });
    expect(body.g4_money_markets.eur_ecb.deposit_facility_pct).toBe(2.5);
    expect(body.g4_money_markets.eur_ecb.estr_df_spread_bps).toBe(-5.5);
    expect(body.g4_money_markets.cad_boc.corra_pct).toBe(2.51);
    expect(body.top_positive_carry_vs_base[0]?.area).toBe("BR");

    // Eurozone country mapping flag
    const deRes = await okApp.request("http://localhost/v1/macro/global-rates?base=DE&group=hiking");
    expect(deRes.status).toBe(200);
    const deBody = (await deRes.json()) as {
      filters: { base_area: string };
      central_banks: Array<{ area: string }>;
      flags: string[];
    };
    expect(deBody.filters.base_area).toBe("XM");
    expect(deBody.central_banks.map((b) => b.area)).toEqual(["JP", "BR"]);
    expect(deBody.flags).toContain("EUROZONE_MEMBER_MAPPED_TO_ECB_XM");

    // 404 when valid currency has no active BIS/central-bank rate (never fabricates 0.0% base rate)
    const missingBaseRes = await okApp.request(
      "http://localhost/v1/macro/global-rates?base=ARS"
    );
    expect(missingBaseRes.status).toBe(404);

    // 400 validation
    const badRes = await okApp.request("http://localhost/v1/macro/global-rates?base=BOGUS");
    expect(badRes.status).toBe(400);

    // 502 fail-closed when BIS fails
    const failBisApp = new Hono<AppBindings>();
    failBisApp.get(
      "/v1/macro/global-rates",
      createGlobalRatesHandler({
        cache: new BoundedTtlCache(32),
        fetchImpl: makeMockFetch({ failBis: true }),
      })
    );
    expect((await failBisApp.request("http://localhost/v1/macro/global-rates")).status).toBe(502);

    // 502 fail-closed when 2 of 3 G3 feeds fail
    const failG3App = new Hono<AppBindings>();
    failG3App.get(
      "/v1/macro/global-rates",
      createGlobalRatesHandler({
        cache: new BoundedTtlCache(32),
        fetchImpl: makeMockFetch({ failEcbAndBoc: true }),
      })
    );
    expect((await failG3App.request("http://localhost/v1/macro/global-rates")).status).toBe(502);
  });
});
