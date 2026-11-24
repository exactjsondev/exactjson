import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import {
  DEFAULT_USDC_BY_CHAIN,
  KYBERSWAP_CLIENT_ID,
  usdToRawTokenUnits,
} from "../src/providers/kyberswap";
import { createExecutionQuoteCheckHandler } from "../src/routes/executionQuoteCheck";
import {
  classifyLiquidityGrade,
  computeEvmQuoteCheck,
  computeMaxSizeUnderSlippageL2,
  computePerpsQuoteCheck,
  simulateL2TierFill,
} from "../src/services/executionQuoteCheck";
import { EVM_CHAINS } from "../src/lib/validation";
import type {
  AppBindings,
  ExecutionQuoteCheckEvmResponse,
  ExecutionQuoteCheckPerpsResponse,
  HyperliquidAssetEntry,
  HyperliquidL2Book,
} from "../src/types";

const BASE_WETH = "0x4200000000000000000000000000000000000006";
const SAMPLE_TOKEN = "0x1111111111111111111111111111111111111111";

function makeHlEntry(overrides: Partial<HyperliquidAssetEntry> = {}): HyperliquidAssetEntry {
  return {
    canonicalName: "BTC",
    maxLeverage: 40,
    szDecimals: 5,
    ctx: {
      funding: 0.0000125,
      openInterest: 5000,
      prevDayPx: 98000,
      dayNtlVlm: 1_200_000_000,
      premium: 0.0001,
      oraclePx: 100000,
      markPx: 100000,
      midPx: 100000,
    },
    ...overrides,
  };
}

describe("execution quote-check engine & route", () => {
  it("converts USD amounts to exact integer raw token units across 6 and 18 decimals without float drift", () => {
    expect(usdToRawTokenUnits(1_000, 1, 6)).toBe("1000000000");
    expect(usdToRawTokenUnits(50_000, 1, 18)).toBe("50000000000000000000000");
    expect(usdToRawTokenUnits(1_000, 2_500, 18)).toBe("400000000000000000");
    expect(usdToRawTokenUnits(10, 1, 0)).toBe("10");
    expect(usdToRawTokenUnits(0, 1, 6)).toBeNull();
    expect(usdToRawTokenUnits(100, 0, 6)).toBeNull();
  });

  it("computes exact closed-form L2 max_size_under_100bps_usd and multi-tier VWAP slippage", () => {
    // Mid = 100. Target buy VWAP @ 100bps = 101.00.
    // Ask 1: px=100.5, sz=10 ($1,005). Ask 2: px=102.0, sz=10 ($1,020).
    // Analytic exact partial at Ask 2: q = (101*10 - 1005)/(102 - 101) = 5 -> total USD = 1005 + 510 = 1515.
    const asks = [
      { px: 100.5, sz: 10, n: 2 },
      { px: 102.0, sz: 10, n: 3 },
    ];
    const maxBuy = computeMaxSizeUnderSlippageL2(asks, 100, "buy", 100);
    expect(maxBuy.maxSizeUsd).toBeCloseTo(1515, 2);
    expect(maxBuy.cappedByVisibleBook).toBe(false);

    // Partial fill when requested size ($5,000) exceeds total depth ($2,025)
    const partial = simulateL2TierFill(asks, 100, 5_000, "buy");
    expect(partial.executable).toBe(false);
    expect(partial.fill_pct).toBeCloseTo(40.5, 1);
    expect(partial.effective_price).toBeNull();

    // Spread > 200bps (best ask = 102 vs mid 100 -> 200bps half-spread) => 0 capacity under 100bps
    const wideBook = [{ px: 102, sz: 100, n: 1 }];
    expect(computeMaxSizeUnderSlippageL2(wideBook, 100, "buy", 100).maxSizeUsd).toBe(0);
  });

  it("synthesizes perps quote-check for DEEP and THIN books with conservative both-side bottleneck", () => {
    const deepBook: HyperliquidL2Book = {
      coin: "BTC",
      time: 1730000000000,
      bids: [
        { px: 99_995, sz: 2, n: 5 },
        { px: 99_980, sz: 5, n: 10 },
      ],
      asks: [
        { px: 100_005, sz: 2, n: 5 },
        { px: 100_020, sz: 5, n: 10 },
      ],
    };

    const deep = computePerpsQuoteCheck(makeHlEntry(), deepBook, {
      side: "both",
      sizesUsd: [1_000, 10_000, 50_000, 100_000],
      fetchedAtIso: "2026-11-22T12:00:00.000Z",
    });

    expect(deep.summary.executable).toBe(true);
    expect(deep.summary.liquidity_grade).toBe("DEEP");
    expect(deep.summary.capped_by_visible_book).toBe(true);
    expect(deep.summary.flags).toContain("VISIBLE_BOOK_DEPTH_CAP");
    expect(deep.buy?.executable_all_tiers).toBe(true);
    expect(deep.sell?.executable_all_tiers).toBe(true);
    expect(deep.market.spread_bps).toBeCloseTo(1, 2);

    // Thin book: asks deep, bids only $2,500 -> "both" bottleneck is THIN
    const asymmetricBook: HyperliquidL2Book = {
      coin: "MEME",
      time: 1730000000000,
      bids: [
        { px: 0.999, sz: 2_500, n: 2 },
        { px: 0.95, sz: 10_000, n: 1 },
      ],
      asks: [{ px: 1.001, sz: 100_000, n: 10 }],
    };
    const thin = computePerpsQuoteCheck(
      makeHlEntry({
        canonicalName: "MEME",
        ctx: { ...makeHlEntry().ctx, markPx: 1, oraclePx: 1, midPx: 1 },
      }),
      asymmetricBook,
      {
        side: "both",
        sizesUsd: [1_000, 10_000],
      }
    );
    expect(thin.summary.liquidity_grade).toBe("THIN");
    expect(thin.summary.max_size_under_100bps_usd).toBeGreaterThan(2_000);
    expect(thin.summary.max_size_under_100bps_usd).toBeLessThan(10_000);
    expect(thin.summary.flags).toContain("THIN_LIQUIDITY");
    expect(thin.summary.flags).toContain("HIGH_SLIPPAGE_10K");
  });

  it("interpolates EVM max_size_under_100bps_usd across tiers and handles fallback pricing & grades", () => {
    // $1k -> 10bps, $10k -> 40bps, $50k -> 240bps => linear 100bps crossing at $10k + $40k*(60/200) = $22,000
    const res = computeEvmQuoteCheck(
      [
        {
          sizeUsd: 1_000,
          amountInRaw: "1000000000",
          failureReason: null,
          quote: {
            chain: "base",
            tokenIn: DEFAULT_USDC_BY_CHAIN.base.address,
            tokenOut: SAMPLE_TOKEN,
            amountInRaw: "1000000000",
            amountOutRaw: "500000000000000000000",
            amountInUsd: 1_000,
            amountOutUsd: 999, // 10 bps
            gasUnits: 150000,
            gasUsd: 0.05,
            dexesUsed: ["uniswap-v3"],
            routeHops: 1,
            routerAddress: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
          },
        },
        {
          sizeUsd: 10_000,
          amountInRaw: "10000000000",
          failureReason: null,
          quote: {
            chain: "base",
            tokenIn: DEFAULT_USDC_BY_CHAIN.base.address,
            tokenOut: SAMPLE_TOKEN,
            amountInRaw: "10000000000",
            amountOutRaw: "4985000000000000000000",
            amountInUsd: 10_000,
            amountOutUsd: 9_960, // 40 bps
            gasUnits: 180000,
            gasUsd: 0.06,
            dexesUsed: ["aerodrome", "uniswap-v3"],
            routeHops: 2,
            routerAddress: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
          },
        },
        {
          sizeUsd: 50_000,
          amountInRaw: "50000000000",
          failureReason: null,
          quote: {
            chain: "base",
            tokenIn: DEFAULT_USDC_BY_CHAIN.base.address,
            tokenOut: SAMPLE_TOKEN,
            amountInRaw: "50000000000",
            amountOutRaw: "24425000000000000000000",
            amountInUsd: 50_000,
            amountOutUsd: 48_800, // 240 bps
            gasUnits: 250000,
            gasUsd: 0.09,
            dexesUsed: ["aerodrome", "uniswap-v3"],
            routeHops: 3,
            routerAddress: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
          },
        },
      ],
      {
        chain: EVM_CHAINS.base,
        tokenIn: {
          address: DEFAULT_USDC_BY_CHAIN.base.address,
          symbol: "USDC",
          decimals: 6,
          priceUsd: 1,
        },
        tokenOutAddress: SAMPLE_TOKEN,
        dexOut: {
          pairCount: 3,
          totalLiquidityUsd: 450_000,
          volume24hUsd: 800_000,
          priceUsd: 2.0,
          priceChange24hPct: 4.2,
          fdvUsd: 10_000_000,
          primaryDex: "aerodrome",
          primaryPairAddress: "0x2222",
          symbol: "SMP",
          name: "Sample Token",
        },
        sources: ["dexscreener", "kyberswap"],
      }
    );

    expect(res.summary.executable).toBe(true);
    expect(res.summary.liquidity_grade).toBe("ADEQUATE");
    expect(res.summary.max_size_under_100bps_usd).toBeCloseTo(22_000, 1);
    expect(res.summary.max_size_is_extrapolated).toBe(false);
    expect(res.tiers[0]!.price_impact_bps).toBeCloseTo(10, 2);
    expect(res.tiers[0]!.effective_price_usd).toBeCloseTo(2.002, 4);
    expect(res.tiers[1]!.price_impact_bps).toBeCloseTo(40, 2);
    expect(res.tiers[2]!.price_impact_bps).toBeCloseTo(240, 2);
    expect(classifyLiquidityGrade(500, true)).toBe("ILLIQUID");
    expect(classifyLiquidityGrade(5_000, true)).toBe("THIN");
    expect(classifyLiquidityGrade(25_000, true)).toBe("ADEQUATE");
    expect(classifyLiquidityGrade(75_000, true)).toBe("DEEP");
  });

  it("route handler validates inputs (400) for both modes without touching upstreams", async () => {
    let fetchCalls = 0;
    const neverFetch: typeof fetch = async () => {
      fetchCalls += 1;
      throw new Error("should not be called");
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({ cache: new BoundedTtlCache(), fetchImpl: neverFetch })
    );

    expect((await app.request("http://localhost/v1/execution/quote-check")).status).toBe(400);
    expect((await app.request("http://localhost/v1/execution/quote-check?mode=solana")).status).toBe(400);
    expect((await app.request("http://localhost/v1/execution/quote-check?mode=perps")).status).toBe(400);
    expect(
      (await app.request("http://localhost/v1/execution/quote-check?mode=perps&coin=BTC&side=long")).status
    ).toBe(400);
    expect(
      (
        await app.request(
          "http://localhost/v1/execution/quote-check?mode=perps&coin=BTC&sizes_usd=100,200,300,400,500"
        )
      ).status
    ).toBe(400);
    expect((await app.request("http://localhost/v1/execution/quote-check?mode=evm")).status).toBe(400);
    expect(
      (
        await app.request(
          `http://localhost/v1/execution/quote-check?mode=evm&chain=fantom&token_out=${SAMPLE_TOKEN}`
        )
      ).status
    ).toBe(400);
    // Same token_in and token_out
    expect(
      (
        await app.request(
          `http://localhost/v1/execution/quote-check?mode=evm&token_out=${DEFAULT_USDC_BY_CHAIN.base.address}`
        )
      ).status
    ).toBe(400);
    // Unknown custom token_in without token_in_decimals
    expect(
      (
        await app.request(
          `http://localhost/v1/execution/quote-check?mode=evm&token_in=0x9999999999999999999999999999999999999999&token_out=${SAMPLE_TOKEN}`
        )
      ).status
    ).toBe(400);
    // More than 3 sizes for EVM
    expect(
      (
        await app.request(
          `http://localhost/v1/execution/quote-check?mode=evm&token_out=${SAMPLE_TOKEN}&sizes_usd=100,1000,10000,50000`
        )
      ).status
    ).toBe(400);
    expect(fetchCalls).toBe(0);
  });

  it("route handler executes mode=perps, caches Hyperliquid responses, and returns 404 / 502 cleanly", async () => {
    let fetchCount = 0;
    const hlFetch: typeof fetch = async (_input, init) => {
      fetchCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
      if (body.type === "metaAndAssetCtxs") {
        return new Response(
          JSON.stringify([
            { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] },
            [
              {
                funding: "0.00001",
                openInterest: "2000",
                prevDayPx: "99000",
                dayNtlVlm: "800000000",
                premium: "0.0001",
                oraclePx: "100000",
                markPx: "100000",
                midPx: "100000",
              },
            ],
          ]),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          coin: "BTC",
          time: 1730000000000,
          levels: [
            [{ px: "99990", sz: "3", n: 4 }],
            [{ px: "100010", sz: "3", n: 4 }],
          ],
        }),
        { status: 200 }
      );
    };

    const cache = new BoundedTtlCache();
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({ cache, fetchImpl: hlFetch })
    );

    const r1 = await app.request(
      "http://localhost/v1/execution/quote-check?mode=perps&coin=btc-perp&side=buy&sizes_usd=1000,50000"
    );
    expect(r1.status).toBe(200);
    const data1 = (await r1.json()) as ExecutionQuoteCheckPerpsResponse;
    expect(data1.coin).toBe("BTC");
    expect(data1.buy?.tiers.length).toBe(2);
    expect(data1.sell).toBeNull();
    expect(data1.summary.liquidity_grade).toBe("DEEP");
    expect(fetchCount).toBe(2);

    // Second request uses cached meta + book (zero new upstream calls)
    const r2 = await app.request(
      "http://localhost/v1/execution/quote-check?mode=perps&coin=BTC&side=both"
    );
    expect(r2.status).toBe(200);
    expect(fetchCount).toBe(2);

    // Unknown coin -> 404 unsettled
    const r404 = await app.request(
      "http://localhost/v1/execution/quote-check?mode=perps&coin=NOTACOIN"
    );
    expect(r404.status).toBe(404);

    // Hyperliquid outage -> 502 unsettled
    const downApp = new Hono<AppBindings>();
    downApp.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async () => new Response("err", { status: 503 }),
      })
    );
    expect(
      (await downApp.request("http://localhost/v1/execution/quote-check?mode=perps&coin=BTC")).status
    ).toBe(502);
  });

  it("route handler executes mode=evm with x-client-id header, BSC 18-dec USDC, caching, 404, ILLIQUID 200, and 502", async () => {
    const seenHeaders: Array<string | null> = [];
    const seenUrls: string[] = [];

    const okFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      seenUrls.push(url);
      const headers = new Headers(init?.headers);

      if (url.includes("aggregator-api.kyberswap.com")) {
        seenHeaders.push(headers.get("x-client-id"));
        const parsed = new URL(url);
        const amtIn = parsed.searchParams.get("amountIn") ?? "0";
        const isBsc = url.includes("/bsc/");
        const usdIn = isBsc ? Number(amtIn) / 1e18 : Number(amtIn) / 1e6;
        const impactPct = usdIn >= 50_000 ? 0.008 : usdIn >= 10_000 ? 0.002 : 0.0005;
        const usdOut = usdIn * (1 - impactPct);
        return new Response(
          JSON.stringify({
            code: 0,
            message: "successfully",
            data: {
              routerAddress: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
              routeSummary: {
                tokenIn: parsed.searchParams.get("tokenIn"),
                amountIn: amtIn,
                amountInUsd: usdIn.toFixed(2),
                tokenOut: parsed.searchParams.get("tokenOut"),
                amountOut: String(Math.round(usdOut * 1e12)),
                amountOutUsd: usdOut.toFixed(2),
                gas: "180000",
                gasUsd: "0.04",
                route: [[{ exchange: "aerodrome" }, { exchange: "uniswap-v3" }]],
              },
            },
          }),
          { status: 200 }
        );
      }

      // DEX Screener spot
      return new Response(
        JSON.stringify([
          {
            chainId: url.includes("/bsc/") ? "bsc" : "base",
            dexId: "aerodrome",
            pairAddress: "0xpair",
            baseToken: { address: BASE_WETH, symbol: "WETH", name: "Wrapped Ether" },
            quoteToken: { address: DEFAULT_USDC_BY_CHAIN.base.address, symbol: "USDC" },
            priceUsd: "3000.00",
            liquidity: { usd: 25_000_000 },
            volume: { h24: 40_000_000 },
          },
        ]),
        { status: 200 }
      );
    };

    const cache = new BoundedTtlCache();
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({ cache, fetchImpl: okFetch })
    );

    // 1. Base default USDC (6 decimals) + 3 tiers
    const r1 = await app.request(
      `http://localhost/v1/execution/quote-check?mode=evm&token_out=${BASE_WETH}`
    );
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as ExecutionQuoteCheckEvmResponse;
    expect(body1.chain).toBe("base");
    expect(body1.token_in.decimals).toBe(6);
    expect(body1.token_in.symbol).toBe("USDC");
    expect(body1.tiers.length).toBe(3);
    expect(body1.tiers[0]!.amount_in_raw).toBe("1000000000");
    expect(body1.tiers[2]!.amount_in_raw).toBe("50000000000");
    expect(body1.summary.liquidity_grade).toBe("DEEP");
    expect(seenHeaders.every((h) => h === KYBERSWAP_CLIENT_ID)).toBe(true);

    // 2. Cache HIT on identical request -> no additional upstream calls
    const countBeforeCacheHit = seenUrls.length;
    const r2 = await app.request(
      `http://localhost/v1/execution/quote-check?mode=evm&token_out=${BASE_WETH}`
    );
    expect(r2.status).toBe(200);
    expect(seenUrls.length).toBe(countBeforeCacheHit);

    // 3. BSC native USDC uses 18 decimals
    const rBsc = await app.request(
      `http://localhost/v1/execution/quote-check?mode=evm&chain=bsc&token_out=${SAMPLE_TOKEN}&sizes_usd=1000`
    );
    expect(rBsc.status).toBe(200);
    const bodyBsc = (await rBsc.json()) as ExecutionQuoteCheckEvmResponse;
    expect(bodyBsc.token_in.decimals).toBe(18);
    expect(bodyBsc.tiers[0]!.amount_in_raw).toBe("1000000000000000000000");

    // 4. KyberSwap returns 404 (no route) AND DEX Screener has 0 pairs -> 404 unsettled
    const noTokenApp = new Hono<AppBindings>();
    noTokenApp.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          if (String(input).includes("kyberswap")) {
            return new Response("not found", { status: 404 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        },
      })
    );
    expect(
      (
        await noTokenApp.request(
          `http://localhost/v1/execution/quote-check?mode=evm&token_out=${SAMPLE_TOKEN}&sizes_usd=1000`
        )
      ).status
    ).toBe(404);

    // 5. KyberSwap returns no route BUT DEX Screener has existing pools -> 200 ILLIQUID trap warning
    const trapApp = new Hono<AppBindings>();
    trapApp.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          if (String(input).includes("kyberswap")) {
            return new Response(JSON.stringify({ code: 4221, message: "route not found" }), {
              status: 200,
            });
          }
          return new Response(
            JSON.stringify([
              {
                chainId: "base",
                dexId: "uniswap-v2",
                baseToken: { address: SAMPLE_TOKEN, symbol: "TRAP" },
                priceUsd: "0.01",
                liquidity: { usd: 500 },
                volume: { h24: 100 },
              },
            ]),
            { status: 200 }
          );
        },
      })
    );
    const rTrap = await trapApp.request(
      `http://localhost/v1/execution/quote-check?mode=evm&token_out=${SAMPLE_TOKEN}&sizes_usd=1000`
    );
    expect(rTrap.status).toBe(200);
    const trapBody = (await rTrap.json()) as ExecutionQuoteCheckEvmResponse;
    expect(trapBody.summary.executable).toBe(false);
    expect(trapBody.summary.liquidity_grade).toBe("ILLIQUID");
    expect(trapBody.summary.flags).toContain("NO_EXECUTABLE_ROUTE");

    // 6. KyberSwap 503 outage -> fail closed 502 unsettled
    const outageApp = new Hono<AppBindings>();
    outageApp.get(
      "/v1/execution/quote-check",
      createExecutionQuoteCheckHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: async (input) => {
          if (String(input).includes("kyberswap")) {
            return new Response("down", { status: 503 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        },
      })
    );
    expect(
      (
        await outageApp.request(
          `http://localhost/v1/execution/quote-check?mode=evm&token_out=${SAMPLE_TOKEN}&sizes_usd=1000`
        )
      ).status
    ).toBe(502);
  });
});
