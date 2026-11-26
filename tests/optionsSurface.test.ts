import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { parseDeribitExpiryMs, parseDeribitOptions } from "../src/packs/markets/providers/deribit";
import { createOptionsSurfaceHandler } from "../src/packs/markets/routes/optionsSurface";
import { computeOptionsSurface } from "../src/packs/markets/services/optionsSurface";
import type { AppBindings } from "../src/types";

const SAMPLE_DERIBIT = {
  result: [
    // Front expiry: 27NOV26 (5 DTE from 22NOV26 08:00Z), Spot = 100,000
    {
      instrument_name: "BTC-27NOV26-90000-P",
      mark_iv: 58,
      open_interest: 400,
      volume: 80,
      underlying_price: 100000,
    },
    {
      instrument_name: "BTC-27NOV26-100000-C",
      mark_iv: 50,
      open_interest: 500,
      volume: 100,
      underlying_price: 100000,
    },
    {
      instrument_name: "BTC-27NOV26-100000-P",
      mark_iv: 52,
      open_interest: 300,
      volume: 60,
      underlying_price: 100000,
    },
    {
      instrument_name: "BTC-27NOV26-110000-C",
      mark_iv: 54,
      open_interest: 900,
      volume: 150,
      underlying_price: 100000,
    },
    // 30d expiry: 25DEC26 (33 DTE)
    {
      instrument_name: "BTC-25DEC26-100000-C",
      mark_iv: 57,
      open_interest: 1200,
      volume: 200,
      underlying_price: 100000,
    },
    {
      instrument_name: "BTC-25DEC26-100000-P",
      mark_iv: 59,
      open_interest: 800,
      volume: 120,
      underlying_price: 100000,
    },
    // Non-option or wrong currency ignored
    {
      instrument_name: "BTC-PERPETUAL",
      open_interest: 99999,
      underlying_price: 100000,
    },
  ],
};

describe("Deribit options volatility surface", () => {
  it("parses Deribit expiry timestamps at 08:00 UTC and rejects invalid calendar dates", () => {
    expect(parseDeribitExpiryMs("27", "NOV", "26")).toBe(Date.UTC(2026, 10, 27, 8, 0, 0));
    expect(parseDeribitExpiryMs("31", "FEB", "26")).toBeNull();
  });

  it("computes deterministic ATM IV term structure, contango, OTM skew, max pain, and OI walls", () => {
    const nowMs = Date.UTC(2026, 10, 22, 8, 0, 0);
    const contracts = parseDeribitOptions(SAMPLE_DERIBIT, "BTC");
    expect(contracts.length).toBe(6);

    const surface = computeOptionsSurface("BTC", contracts, nowMs);
    expect(surface.spot_index_price).toBe(100000);
    expect(surface.summary.call_open_interest_contracts).toBe(2600);
    expect(surface.summary.put_open_interest_contracts).toBe(1500);
    expect(surface.summary.put_call_oi_ratio).toBeCloseTo(1500 / 2600, 4);

    // Front ATM IV = avg(50, 52) = 51; 30d ATM IV = avg(57, 59) = 58 -> slope = +7 -> CONTANGO
    expect(surface.vol_regime.front_atm_iv_pct).toBe(51);
    expect(surface.vol_regime.mid_30d_atm_iv_pct).toBe(58);
    expect(surface.vol_regime.term_slope_iv_pts).toBe(7);
    expect(surface.vol_regime.structure).toBe("CONTANGO");

    // Front OTM skew = 90k Put (58) - 110k Call (54) = +4 -> PUT_PREMIUM
    expect(surface.vol_regime.front_skew_iv_pts).toBe(4);
    expect(surface.vol_regime.skew_regime).toBe("PUT_PREMIUM");

    // Nearest major expiry (27NOV26):
    // Payout at 90k = 300*10k = 3M; at 100k = 0; at 110k = 500*10k = 5M -> Max pain = 100,000!
    expect(surface.nearest_major_expiry?.expiry_code).toBe("27NOV26");
    expect(surface.nearest_major_expiry?.max_pain_strike).toBe(100000);
    expect(surface.nearest_major_expiry?.max_pain_distance_pct).toBe(0);
    expect(surface.nearest_major_expiry?.top_call_walls[0]?.strike).toBe(110000);
    expect(surface.nearest_major_expiry?.top_put_walls[0]?.strike).toBe(90000);
  });

  it("never picks a <1 DTE expiry as mid_30d_atm_iv_pct when computing term slope", () => {
    const nowMs = Date.UTC(2026, 10, 22, 0, 0, 0); // 22NOV26 00:00Z -> 22NOV26 08:00Z is 0.33 DTE
    const contracts = parseDeribitOptions(
      {
        result: [
          {
            instrument_name: "BTC-22NOV26-100000-C",
            mark_iv: 90,
            open_interest: 100,
            volume: 10,
            underlying_price: 100000,
          },
          {
            instrument_name: "BTC-20DEC26-100000-C",
            mark_iv: 50,
            open_interest: 1000,
            volume: 100,
            underlying_price: 100000,
          },
          {
            instrument_name: "BTC-22JAN27-100000-C",
            mark_iv: 60,
            open_interest: 1000,
            volume: 100,
            underlying_price: 100000,
          },
        ],
      },
      "BTC"
    );

    const surface = computeOptionsSurface("BTC", contracts, nowMs);
    expect(surface.vol_regime.front_atm_iv_pct).toBe(50);
    expect(surface.vol_regime.mid_30d_atm_iv_pct).toBe(60);
    expect(surface.vol_regime.term_slope_iv_pts).toBe(10);
    expect(surface.vol_regime.structure).toBe("CONTANGO");
  });

  it("handles route validation (400), live 200, and upstream failure (502)", async () => {
    const mockFetch: typeof fetch = async (input) => {
      if (String(input).includes("currency=BTC")) {
        return new Response(JSON.stringify(SAMPLE_DERIBIT), { status: 200 });
      }
      return new Response("upstream error", { status: 503 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/options/surface",
      createOptionsSurfaceHandler({ cache: new BoundedTtlCache(), fetchImpl: mockFetch })
    );

    const bad = await app.request("http://localhost/v1/options/surface?currency=DOGE");
    expect(bad.status).toBe(400);

    const ok = await app.request("http://localhost/v1/options/surface?currency=btc");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { currency: string; spot_index_price: number };
    expect(body.currency).toBe("BTC");
    expect(body.spot_index_price).toBe(100000);

    const fail = await app.request("http://localhost/v1/options/surface?currency=ETH");
    expect(fail.status).toBe(502);
  });
});
