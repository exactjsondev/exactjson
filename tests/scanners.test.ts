import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../src/config/catalog";
import { BoundedTtlCache } from "../src/lib/cache";
import { normalizeBaseAsset, parseDydxMarkets } from "../src/packs/markets/providers/dydx";
import { parseTrendingSolanaPools } from "../src/packs/markets/providers/geckoTrending";
import { parseKrakenPerpTickers } from "../src/packs/markets/providers/krakenFutures";
import { createFundingArbHandler } from "../src/packs/markets/routes/fundingArb";
import { createPerpsScreenerHandler } from "../src/packs/markets/routes/perpsScreener";
import { createSolanaTrendingHandler } from "../src/packs/markets/routes/solanaTrending";
import { computeFundingArb, hyperliquidToVenueMap } from "../src/packs/markets/services/fundingArb";
import { computePerpsScreener } from "../src/packs/markets/services/perpScreener";
import { computeSolanaTrending } from "../src/packs/markets/services/solanaTrending";
import type { AppBindings, HyperliquidAssetEntry, RugCheckSummary } from "../src/types";

describe("perpsScreener", () => {
  it("ranks funding extremes, basis dislocations, turnover, and computes market breadth", () => {
    const map = new Map<string, HyperliquidAssetEntry>([
      [
        "btc",
        {
          canonicalName: "BTC",
          maxLeverage: 40,
          szDecimals: 5,
          ctx: {
            funding: 0.0000125, // 10.95% APR
            openInterest: 1000,
            prevDayPx: 59000,
            dayNtlVlm: 200_000_000,
            premium: 0.0001,
            oraclePx: 60000,
            markPx: 60060, // +10 bps
            midPx: 60050,
          },
        },
      ],
      [
        "sol",
        {
          canonicalName: "SOL",
          maxLeverage: 20,
          szDecimals: 2,
          ctx: {
            funding: -0.00003, // -26.28% APR
            openInterest: 500_000, // $35M OI
            prevDayPx: 68,
            dayNtlVlm: 350_000_000, // 10x turnover
            premium: -0.0005,
            oraclePx: 70,
            markPx: 69.65, // -50 bps
            midPx: 69.66,
          },
        },
      ],
      [
        "tiny",
        {
          canonicalName: "TINY",
          maxLeverage: 5,
          szDecimals: 0,
          ctx: {
            funding: 0.0005,
            openInterest: 1000, // $1,000 OI -> filtered out by minOiUsd=1M
            prevDayPx: 1,
            dayNtlVlm: 5000,
            premium: 0,
            oraclePx: 1,
            markPx: 1,
            midPx: 1,
          },
        },
      ],
    ]);

    const res = computePerpsScreener(map, { minOiUsd: 1_000_000, limit: 5 }, "2026-11-22T00:00:00Z");
    expect(res.market_summary.total_markets).toBe(3);
    expect(res.market_summary.qualifying_markets).toBe(2);
    expect(res.highest_funding[0]?.coin).toBe("BTC");
    expect(res.lowest_funding[0]?.coin).toBe("SOL");
    expect(res.widest_basis[0]?.coin).toBe("SOL");
    expect(res.highest_turnover[0]?.coin).toBe("SOL");
    expect(res.metadata.disclaimer).toBe(DISCLAIMER);
  });

  it("validates query bounds and returns 400 on bad limit", async () => {
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/perps/screener",
      createPerpsScreenerHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async () => new Response("[]", { status: 200 }),
      })
    );
    const bad = await app.request("/v1/perps/screener?limit=999");
    expect(bad.status).toBe(400);
  });
});

describe("fundingArb (Hyperliquid vs dYdX v4 vs Kraken Futures)", () => {
  it("normalizes XBT->BTC and kPEPE/1000PEPE->PEPE while guarding scaled mark price comparisons", () => {
    expect(normalizeBaseAsset("XBT")).toEqual({ asset: "BTC", scaledUnit: false });
    expect(normalizeBaseAsset("kPEPE")).toEqual({ asset: "PEPE", scaledUnit: true });
    expect(normalizeBaseAsset("1000PEPE")).toEqual({ asset: "PEPE", scaledUnit: true });

    const dydxMap = parseDydxMarkets({
      markets: {
        "BTC-USD": {
          ticker: "BTC-USD",
          status: "ACTIVE",
          oraclePrice: "60000",
          openInterest: "100",
          volume24H: "10000000",
          nextFundingRate: "-0.00001", // -8.76% APR
        },
        "PEPE-USD": {
          ticker: "PEPE-USD",
          status: "ACTIVE",
          oraclePrice: "0.00001",
          openInterest: "100000000000",
          volume24H: "2000000",
          nextFundingRate: "0.00005", // 43.8% APR
        },
      },
    });

    const krakenMap = parseKrakenPerpTickers({
      tickers: [
        {
          symbol: "PF_XBTUSD",
          tag: "perpetual",
          pair: "XBT:USD",
          markPrice: 60030,
          openInterest: 200,
          volumeQuote: 50_000_000,
          fundingRate: 0.9, // USD rate - MUST NOT be used!
          relativeFundingRate: 0.00002, // +17.52% APR
          suspended: false,
        },
      ],
    });

    const hlVenue = hyperliquidToVenueMap(
      new Map<string, HyperliquidAssetEntry>([
        [
          "btc",
          {
            canonicalName: "BTC",
            maxLeverage: 40,
            szDecimals: 5,
            ctx: {
              funding: 0.00001, // +8.76% APR
              openInterest: 500,
              prevDayPx: 59000,
              dayNtlVlm: 100_000_000,
              premium: 0,
              oraclePx: 60000,
              markPx: 60000,
              midPx: 60000,
            },
          },
        ],
        [
          "kpepe",
          {
            canonicalName: "kPEPE",
            maxLeverage: 10,
            szDecimals: 0,
            ctx: {
              funding: -0.00001, // -8.76% APR
              openInterest: 100_000_000,
              prevDayPx: 0.01,
              dayNtlVlm: 5_000_000,
              premium: 0,
              oraclePx: 0.01,
              markPx: 0.01,
              midPx: 0.01,
            },
          },
        ],
      ])
    );

    const res = computeFundingArb(
      { hyperliquid: hlVenue, dydx: dydxMap, kraken: krakenMap },
      { minOiUsd: 100_000, limit: 10 }
    );

    expect(res.venues_active).toEqual(["hyperliquid", "dydx", "kraken"]);
    expect(res.matched_assets_count).toBe(2);

    // PEPE spread = 43.8 - (-8.76) = 52.56% APR (ranked #1); mark_price_spread_bps is null due to scaled kPEPE
    expect(res.opportunities[0]?.asset).toBe("PEPE");
    expect(res.opportunities[0]?.spread_annualized_pct).toBe(52.56);
    expect(res.opportunities[0]?.mark_price_spread_bps).toBeNull();

    // BTC spread = 17.52 (kraken) - (-8.76) (dydx) = 26.28% APR across 3 venues
    const btc = res.opportunities.find((o) => o.asset === "BTC");
    expect(btc?.venues_compared).toBe(3);
    expect(btc?.highest_funding_venue).toBe("kraken");
    expect(btc?.lowest_funding_venue).toBe("dydx");
    expect(btc?.spread_annualized_pct).toBe(26.28);
    expect(btc?.mark_price_spread_bps).toBe(5);
    expect(btc?.min_open_interest_usd).toBe(6_000_000);
    expect(btc?.max_open_interest_usd).toBe(30_000_000);

    // Per-leg minOiUsd excludes illiquid legs (dYdX BTC OI is $6M; setting minOiUsd=10M drops dYdX)
    const liquidOnly = computeFundingArb(
      { hyperliquid: hlVenue, dydx: dydxMap, kraken: krakenMap },
      { minOiUsd: 10_000_000, limit: 10 }
    );
    const btcLiquid = liquidOnly.opportunities.find((o) => o.asset === "BTC");
    expect(btcLiquid?.venues_compared).toBe(2);
    expect(btcLiquid?.venues.dydx).toBeUndefined();
    expect(btcLiquid?.spread_annualized_pct).toBe(8.76);
    expect(btcLiquid?.min_open_interest_usd).toBe(12_006_000);

    // Tied funding rate across 2 venues must still pick distinct highest and lowest venues
    const tiedRes = computeFundingArb(
      {
        hyperliquid: new Map([
          ["btc", { venue: "hyperliquid", symbol: "BTC", baseAsset: "BTC", scaledUnit: false, markPrice: 60000, hourlyFundingRate: 0.00001, openInterestUsd: 5_000_000, volume24hUsd: 10_000_000 }],
        ]),
        dydx: new Map([
          ["btc", { venue: "dydx", symbol: "BTC-USD", baseAsset: "BTC", scaledUnit: false, markPrice: 60000, hourlyFundingRate: 0.00001, openInterestUsd: 5_000_000, volume24hUsd: 10_000_000 }],
        ]),
      },
      { minOiUsd: 100_000, limit: 10 }
    );
    expect(tiedRes.opportunities[0]?.spread_annualized_pct).toBe(0);
    expect(tiedRes.opportunities[0]?.highest_funding_venue).not.toBe(
      tiedRes.opportunities[0]?.lowest_funding_venue
    );
  });

  it("resolves lowercase ?coin=kpepe via Hyperliquid canonical name without breaking K* tickers", async () => {
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/perps/funding-arb",
      createFundingArbHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("hyperliquid")) {
            return new Response(
              JSON.stringify([
                { universe: [{ name: "kPEPE" }, { name: "KAS" }] },
                [
                  { markPx: "0.01", funding: "-0.00001", openInterest: "100000000" },
                  { markPx: "0.15", funding: "0.00001", openInterest: "10000000" },
                ],
              ]),
              { status: 200 }
            );
          }
          if (url.includes("dydx")) {
            return new Response(
              JSON.stringify({
                markets: {
                  "PEPE-USD": { ticker: "PEPE-USD", status: "ACTIVE", oraclePrice: "0.00001", openInterest: "100000000000", nextFundingRate: "0.00005" },
                  "KAS-USD": { ticker: "KAS-USD", status: "ACTIVE", oraclePrice: "0.15", openInterest: "10000000", nextFundingRate: "0.00002" },
                },
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ tickers: [] }), { status: 200 });
        },
      })
    );

    const kpepeRes = await app.request("/v1/perps/funding-arb?coin=kpepe");
    expect(kpepeRes.status).toBe(200);
    const kpepeBody = (await kpepeRes.json()) as { opportunities: Array<{ asset: string }> };
    expect(kpepeBody.opportunities[0]?.asset).toBe("PEPE");

    const kasRes = await app.request("/v1/perps/funding-arb?coin=kas");
    expect(kasRes.status).toBe(200);
    const kasBody = (await kasRes.json()) as { opportunities: Array<{ asset: string }> };
    expect(kasBody.opportunities[0]?.asset).toBe("KAS");
  });

  it("returns 502 unsettled when fewer than 2 venues respond", async () => {
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/perps/funding-arb",
      createFundingArbHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("hyperliquid")) {
            return new Response(
              JSON.stringify([{ universe: [{ name: "BTC" }] }, [{ markPx: "60000", funding: "0.00001", openInterest: "100" }]]),
              { status: 200 }
            );
          }
          return new Response("down", { status: 503 });
        },
      })
    );

    const res = await app.request("/v1/perps/funding-arb");
    expect(res.status).toBe(502);
  });
});

describe("solanaTrending", () => {
  const MINT_A = "2j5SaS7xy776qCBpyPQbZjyQSAtKiFgrwjfErthnW2ZM";
  const MINT_B = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

  it("parses GeckoTerminal trending pools, excludes SOL/USDC, and never treats missing RugCheck as safe", () => {
    const pools = parseTrendingSolanaPools({
      data: [
        {
          attributes: {
            name: "SOL / USDC",
            reserve_in_usd: "50000000",
            volume_usd: { h24: "100000000" },
          },
          relationships: {
            base_token: { data: { id: "solana_So11111111111111111111111111111111111111112" } },
            dex: { data: { id: "orca" } },
          },
        },
        {
          attributes: {
            address: "poolA",
            name: "TOKENA / SOL",
            base_token_price_usd: "0.01",
            reserve_in_usd: "500000",
            volume_usd: { h24: "2000000" },
            fdv_usd: "5000000",
            price_change_percentage: { h24: "25.5" },
            transactions: { h24: { buys: 400, sells: 200, unique_traders: 300 } },
          },
          relationships: {
            base_token: { data: { id: `solana_${MINT_A}` } },
            dex: { data: { id: "pumpswap" } },
          },
        },
        {
          attributes: {
            address: "poolB",
            name: "TOKENB / SOL",
            base_token_price_usd: "0.002",
            reserve_in_usd: "100000",
            volume_usd: { h24: "300000" },
          },
          relationships: {
            base_token: { data: { id: `solana_${MINT_B}` } },
            dex: { data: { id: "raydium" } },
          },
        },
      ],
    });

    expect(pools.length).toBe(2);
    expect(pools[0]?.mint).toBe(MINT_A);

    const rugMap = new Map<string, RugCheckSummary | null>([
      [
        MINT_A,
        {
          mint: MINT_A,
          rawScore: 50,
          scoreNormalised: 4,
          lpLockedPct: 95,
          tokenProgram: null,
          tokenType: null,
          risks: [],
        },
      ],
      [MINT_B, null],
    ]);

    const unfiltered = computeSolanaTrending(pools, rugMap, { limit: 5, maxRiskScore: null });
    expect(unfiltered.returned_count).toBe(2);
    expect(unfiltered.tokens[0]?.safety.verified).toBe(true);
    expect(unfiltered.tokens[0]?.safety.risk_tier).toBe("LOW");
    expect(unfiltered.tokens[0]?.market.buy_sell_ratio_24h).toBe(2);
    // Missing RugCheck MUST be marked UNVERIFIED, never LOW!
    expect(unfiltered.tokens[1]?.safety.verified).toBe(false);
    expect(unfiltered.tokens[1]?.safety.risk_score).toBeNull();
    expect(unfiltered.tokens[1]?.safety.risk_tier).toBe("UNVERIFIED");

    // When max_risk_score is specified, UNVERIFIED tokens are excluded
    const safeOnly = computeSolanaTrending(pools, rugMap, { limit: 5, maxRiskScore: 30 });
    expect(safeOnly.returned_count).toBe(1);
    expect(safeOnly.tokens[0]?.mint).toBe(MINT_A);
  });

  it("returns 502 unsettled if RugCheck fails for every trending candidate", async () => {
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/solana/trending",
      createSolanaTrendingHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("geckoterminal")) {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    attributes: { name: "TOKENA / SOL", reserve_in_usd: "100000", volume_usd: { h24: "500000" } },
                    relationships: { base_token: { data: { id: `solana_${MINT_A}` } }, dex: { data: { id: "orca" } } },
                  },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response("rate limit", { status: 429 });
        },
      })
    );

    const res = await app.request("/v1/solana/trending?limit=3");
    expect(res.status).toBe(502);

    // Also fails closed with 502 if RugCheck rejects with an unexpected non-UpstreamError
    const errApp = new Hono<AppBindings>();
    errApp.get(
      "/v1/solana/trending",
      createSolanaTrendingHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("geckoterminal")) {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    attributes: { name: "TOKENA / SOL", reserve_in_usd: "100000", volume_usd: { h24: "500000" } },
                    relationships: { base_token: { data: { id: `solana_${MINT_A}` } }, dex: { data: { id: "orca" } } },
                  },
                ],
              }),
              { status: 200 }
            );
          }
          throw new TypeError("socket hang up");
        },
      })
    );
    const res2 = await errApp.request("/v1/solana/trending?limit=3");
    expect(res2.status).toBe(502);
  });
});
