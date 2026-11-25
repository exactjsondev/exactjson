import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import {
  parseNyFedRates,
  parseNyFedRrp,
  parseTreasuryDebt,
  parseTreasuryTga,
} from "../src/providers/macroFeeds";
import { createMacroLiquidityHandler } from "../src/routes/macroLiquidity";
import { computeMacroLiquidity } from "../src/services/macroLiquidity";
import type { AppBindings } from "../src/types";

const SAMPLE_DEBT = {
  data: [
    {
      record_date: "2026-11-20",
      tot_pub_debt_out_amt: "36550000000000.00",
      debt_held_public_amt: "29100000000000.00",
      intragov_hold_amt: "7450000000000.00",
    },
    {
      record_date: "2026-11-19",
      tot_pub_debt_out_amt: "36540000000000.00",
      debt_held_public_amt: "29090000000000.00",
      intragov_hold_amt: "7450000000000.00",
    },
    {
      record_date: "2026-11-14",
      tot_pub_debt_out_amt: "36500000000000.00",
      debt_held_public_amt: "29050000000000.00",
      intragov_hold_amt: "7450000000000.00",
    },
  ],
};

// Post-2022 DTS format (closing row puts balance in open_today_bal with close_today_bal null)
const SAMPLE_TGA = {
  data: [
    {
      record_date: "2026-11-20",
      account_type: "Treasury General Account (TGA) Closing Balance",
      open_today_bal: "750000",
      close_today_bal: "null",
    },
    {
      record_date: "2026-11-19",
      account_type: "Treasury General Account (TGA) Closing Balance",
      open_today_bal: "770000",
      close_today_bal: null,
    },
    {
      record_date: "2026-11-14",
      account_type: "Federal Reserve Account",
      open_today_bal: "790000",
      close_today_bal: "800000",
    },
  ],
};

const SAMPLE_RRP = {
  repo: {
    operations: [
      {
        operationDate: "2026-11-20",
        term: "Overnight",
        totalAmtAccepted: 120000000000,
        awardRate: 4.25,
        acceptedCounterparties: 42,
      },
      {
        operationDate: "2026-11-19",
        term: "Overnight",
        totalAmtAccepted: 130000000000,
        awardRate: 4.25,
        acceptedCounterparties: 45,
      },
      {
        operationDate: "2026-11-14",
        term: "Overnight",
        totalAmtAccepted: 150000000000,
        awardRate: 4.25,
        acceptedCounterparties: 50,
      },
    ],
  },
};

const SAMPLE_SOFR = {
  refRates: [{ effectiveDate: "2026-11-20", percentRate: 4.39, volumeInBillions: 2200 }],
};

const SAMPLE_EFFR = {
  refRates: [
    {
      effectiveDate: "2026-11-20",
      percentRate: 4.33,
      volumeInBillions: 95,
      targetRateFrom: 4.25,
      targetRateTo: 4.5,
    },
  ],
};

describe("US macro liquidity & Treasury pulse", () => {
  it("parses post-2022 TGA closing rows and legacy Federal Reserve Account rows into USD", () => {
    const tga = parseTreasuryTga(SAMPLE_TGA);
    expect(tga.length).toBe(3);
    expect(tga[0]).toEqual({ recordDate: "2026-11-20", closingBalanceUsd: 750_000_000_000 });
    expect(tga[2]).toEqual({ recordDate: "2026-11-14", closingBalanceUsd: 800_000_000_000 });
  });

  it("ignores truncated TGA Opening Balance / Deposit / Withdrawal rows when Closing Balance is absent", () => {
    const tga = parseTreasuryTga({
      data: [
        {
          record_date: "2026-11-10",
          account_type: "Treasury General Account (TGA) Opening Balance",
          open_today_bal: "795000",
          close_today_bal: null,
        },
        {
          record_date: "2026-11-10",
          account_type: "Treasury General Account (TGA) Deposits",
          open_today_bal: "15000",
          close_today_bal: null,
        },
      ],
    });
    expect(tga).toEqual([]);
  });

  it("computes exact liquidity impulse (-ΔTGA - ΔRRP) and SOFR-EFFR funding stress bps", () => {
    const res = computeMacroLiquidity({
      debt: parseTreasuryDebt(SAMPLE_DEBT),
      tga: parseTreasuryTga(SAMPLE_TGA),
      rrp: parseNyFedRrp(SAMPLE_RRP),
      sofr: parseNyFedRates(SAMPLE_SOFR),
      effr: parseNyFedRates(SAMPLE_EFFR),
      lookbackObs: 5,
      sources: ["treasury_debt", "treasury_tga", "nyfed_rrp", "nyfed_sofr", "nyfed_effr"],
      missingSources: [],
    });

    // Debt daily change: +$10B, period change (vs 11-14): +$50B
    expect(res.us_debt?.daily_change_usd).toBe(10_000_000_000);
    expect(res.us_debt?.period_change_usd).toBe(50_000_000_000);

    // TGA fell $50B (800B -> 750B) -> liquidity injection +$50B
    expect(res.tga?.period_change_usd).toBe(-50_000_000_000);
    expect(res.liquidity_impulse.tga_liquidity_effect_usd).toBe(50_000_000_000);

    // ON RRP fell $30B (150B -> 120B) -> liquidity injection +$30B
    expect(res.on_rrp?.period_change_usd).toBe(-30_000_000_000);
    expect(res.liquidity_impulse.rrp_liquidity_effect_usd).toBe(30_000_000_000);

    // Combined impulse: +$80B -> EXPANDING
    expect(res.liquidity_impulse.combined_net_impulse_usd).toBe(80_000_000_000);
    expect(res.liquidity_impulse.regime).toBe("EXPANDING");

    // SOFR 4.39 - EFFR 4.33 = +6 bps -> TIGHT
    expect(res.rates.sofr_effr_spread_bps).toBe(6);
    expect(res.rates.funding_stress_regime).toBe("TIGHT");
    // Effective lookback aligned to available observations (3 rows = 2 steps)
    expect(res.lookback_obs).toBe(5);
    expect(res.liquidity_impulse.lookback_obs).toBe(2);
  });

  it("aligns TGA and ON RRP impulse lookback when series lengths differ", () => {
    const shortTga = [
      { recordDate: "2026-11-20", closingBalanceUsd: 750_000_000_000 },
      { recordDate: "2026-11-19", closingBalanceUsd: 770_000_000_000 },
      { recordDate: "2026-11-18", closingBalanceUsd: 780_000_000_000 },
    ];
    const longerRrp = [
      { operationDate: "2026-11-20", acceptedUsd: 100_000_000_000, awardRatePct: 4.25, counterpartiesAccepted: 40 },
      { operationDate: "2026-11-19", acceptedUsd: 110_000_000_000, awardRatePct: 4.25, counterpartiesAccepted: 41 },
      { operationDate: "2026-11-18", acceptedUsd: 120_000_000_000, awardRatePct: 4.25, counterpartiesAccepted: 42 },
      { operationDate: "2026-11-17", acceptedUsd: 140_000_000_000, awardRatePct: 4.25, counterpartiesAccepted: 43 },
      { operationDate: "2026-11-14", acceptedUsd: 160_000_000_000, awardRatePct: 4.25, counterpartiesAccepted: 44 },
      { operationDate: "2026-11-13", acceptedUsd: 200_000_000_000, awardRatePct: 4.25, counterpartiesAccepted: 45 },
    ];
    const res = computeMacroLiquidity({
      tga: shortTga,
      rrp: longerRrp,
      sofr: parseNyFedRates(SAMPLE_SOFR),
      lookbackObs: 5,
      sources: ["treasury_tga", "nyfed_rrp", "nyfed_sofr"],
      missingSources: ["treasury_debt", "nyfed_effr"],
    });
    // Both TGA and RRP aligned to 2 steps (2026-11-18): TGA -30B (+30B liq), RRP -20B (+20B liq) => +50B
    expect(res.liquidity_impulse.lookback_obs).toBe(2);
    expect(res.tga?.period_change_usd).toBe(-30_000_000_000);
    expect(res.on_rrp?.period_change_usd).toBe(-20_000_000_000);
    expect(res.liquidity_impulse.combined_net_impulse_usd).toBe(50_000_000_000);
  });

  it("handles route 200, partial-feed resilience, 400 validation, and 502 when <3 feeds succeed", async () => {
    const partialFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("debt_to_penny")) return new Response(JSON.stringify(SAMPLE_DEBT), { status: 200 });
      if (url.includes("operating_cash_balance")) return new Response(JSON.stringify(SAMPLE_TGA), { status: 200 });
      if (url.includes("sofr")) return new Response(JSON.stringify(SAMPLE_SOFR), { status: 200 });
      if (url.includes("effr")) return new Response(JSON.stringify(SAMPLE_EFFR), { status: 200 });
      return new Response("maintenance", { status: 503 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/macro/liquidity",
      createMacroLiquidityHandler({ cache: new BoundedTtlCache(), fetchImpl: partialFetch })
    );

    const bad = await app.request("http://localhost/v1/macro/liquidity?lookback_obs=99");
    expect(bad.status).toBe(400);

    const ok = await app.request("http://localhost/v1/macro/liquidity?lookback_obs=5");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      metadata: { sources: string[]; missing_sources: string[] };
      on_rrp: unknown;
    };
    expect(body.metadata.sources.length).toBe(4);
    expect(body.metadata.missing_sources).toEqual(["nyfed_rrp"]);
    expect(body.on_rrp).toBeNull();

    // Only 2 feeds succeed -> 502 unsettled
    const failingApp = new Hono<AppBindings>();
    failingApp.get(
      "/v1/macro/liquidity",
      createMacroLiquidityHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("sofr")) return new Response(JSON.stringify(SAMPLE_SOFR), { status: 200 });
          if (url.includes("effr")) return new Response(JSON.stringify(SAMPLE_EFFR), { status: 200 });
          return new Response("down", { status: 503 });
        },
      })
    );

    const failRes = await failingApp.request("http://localhost/v1/macro/liquidity");
    expect(failRes.status).toBe(502);
  });
});
