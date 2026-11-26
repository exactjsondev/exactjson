import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../src/config/catalog";
import { BoundedTtlCache } from "../src/lib/cache";
import { indexMetaAndAssetCtxs, parseL2Book } from "../src/providers/hyperliquid";
import { createPerpsSnapshotHandler } from "../src/routes/perpsSnapshot";
import {
  classifyFundingRegime,
  computePerpsSnapshot,
  estimateExecutionSlippageBps,
} from "../src/services/perpMetrics";
import type { AppBindings, HyperliquidAssetEntry, HyperliquidL2Book } from "../src/types";

const BTC_ENTRY: HyperliquidAssetEntry = {
  canonicalName: "BTC",
  maxLeverage: 50,
  szDecimals: 5,
  ctx: {
    funding: 0.0000125,
    openInterest: 1000,
    prevDayPx: 90_000,
    dayNtlVlm: 2_500_000_000.456,
    premium: 0.0001,
    oraclePx: 95_000,
    markPx: 95_095,
    midPx: 95_050,
  },
};

const BTC_BOOK: HyperliquidL2Book = {
  coin: "BTC",
  time: 1_700_000_000_000,
  bids: [
    { px: 95_000, sz: 2, n: 3 },
    { px: 94_990, sz: 3, n: 4 },
  ],
  asks: [
    { px: 95_100, sz: 1, n: 2 },
    { px: 95_110, sz: 1, n: 1 },
  ],
};

describe("perpMetrics", () => {
  it("computes deterministic funding, basis, spread, open interest, and L2 depth imbalance", () => {
    const res = computePerpsSnapshot(BTC_ENTRY, BTC_BOOK, "2026-11-21T00:00:00.000Z");

    expect(res.coin).toBe("BTC");
    expect(res.funding.annualized_pct).toBe(10.95);
    expect(res.funding.regime).toBe("POSITIVE");
    expect(res.market.mark_oracle_basis_bps).toBe(10);
    expect(res.market.price_change_24h_pct).toBe(5.6611);
    expect(res.market.open_interest_usd).toBe(95_095_000);
    expect(res.orderbook.best_bid).toBe(95_000);
    expect(res.orderbook.best_ask).toBe(95_100);
    expect(res.orderbook.spread_bps).toBe(10.5208);

    // bid depth = 95000*2 + 94990*3 = 190000 + 284970 = 474970
    // ask depth = 95100*1 + 95110*1 = 190210
    expect(res.orderbook.bid_depth_5_usd).toBe(474_970);
    expect(res.orderbook.ask_depth_5_usd).toBe(190_210);
    expect(res.orderbook.imbalance_5).toBe(0.4281);
    expect(res.orderbook.slippage_10k_buy_bps).toBe(5.2604);
    expect(res.orderbook.slippage_10k_sell_bps).toBe(5.2604);
    expect(res.market.volume_to_oi_ratio).toBe(26.2895);
    expect(res.metadata.disclaimer).toBe(DISCLAIMER);
  });

  it("estimates multi-level L2 VWAP execution slippage and returns null when depth is insufficient", () => {
    const thinAsks = [
      { px: 100, sz: 50, n: 1 }, // $5,000
      { px: 102, sz: 50, n: 1 }, // $5,100 -> walks both levels for $10k
    ];
    const slip = estimateExecutionSlippageBps(thinAsks, 99.5, 10_000, "buy");
    expect(slip).not.toBeNull();
    expect(slip!).toBeGreaterThan(100);

    // Book only has $500 depth -> insufficient to fill $10k -> null
    const tooThin = [{ px: 100, sz: 5, n: 1 }];
    expect(estimateExecutionSlippageBps(tooThin, 100, 10_000, "buy")).toBeNull();
  });

  it("guards all divisions against 0, null, NaN, and empty books", () => {
    const zeroEntry: HyperliquidAssetEntry = {
      canonicalName: "ZERO",
      maxLeverage: null,
      szDecimals: null,
      ctx: {
        funding: 0,
        openInterest: 0,
        prevDayPx: 0,
        dayNtlVlm: 0,
        premium: null,
        oraclePx: 0,
        markPx: 0,
        midPx: null,
      },
    };
    const emptyBook: HyperliquidL2Book = { coin: "ZERO", time: null, bids: [], asks: [] };

    const res = computePerpsSnapshot(zeroEntry, emptyBook);
    expect(res.market.mark_oracle_basis_bps).toBeNull();
    expect(res.market.price_change_24h_pct).toBeNull();
    expect(res.market.open_interest_usd).toBeNull();
    expect(res.orderbook.spread_bps).toBeNull();
    expect(res.orderbook.imbalance_5).toBeNull();
    expect(res.funding.regime).toBe("NEUTRAL");
  });

  it("classifies funding regimes cleanly", () => {
    expect(classifyFundingRegime(0.0001)).toBe("POSITIVE");
    expect(classifyFundingRegime(-0.0001)).toBe("NEGATIVE");
    expect(classifyFundingRegime(0.000001)).toBe("NEUTRAL");
    expect(classifyFundingRegime(null)).toBe("NEUTRAL");
  });

  it("indexes metaAndAssetCtxs case-insensitively while preserving canonical names like kPEPE and skipping delisted perps", () => {
    const map = indexMetaAndAssetCtxs([
      {
        universe: [
          { name: "BTC", maxLeverage: 50, szDecimals: 5 },
          { name: "kPEPE", maxLeverage: 10, szDecimals: 0 },
          { name: "RLB", maxLeverage: 3, szDecimals: 0, isDelisted: true },
        ],
      },
      [
        { markPx: "95000", oraclePx: "94990", funding: "0.00001", openInterest: "10" },
        { markPx: "0.018", oraclePx: "0.0179", funding: "-0.00002", openInterest: "500000" },
        { markPx: "0.05", oraclePx: "0.05", funding: "0", openInterest: "0" },
      ],
    ]);

    expect(map.get("kpepe")?.canonicalName).toBe("kPEPE");
    expect(map.get("btc")?.canonicalName).toBe("BTC");
    expect(map.has("rlb")).toBe(false);

    const parsedBook = parseL2Book("kPEPE", {
      coin: "kPEPE",
      time: 123,
      levels: [
        [
          { px: "0.0180", sz: "0", n: 0 },
          { px: "0.0179", sz: "1000", n: 2 },
        ],
        [
          { px: "0.01805", sz: "0", n: 0 },
          { px: "0.0181", sz: "1000", n: 1 },
        ],
      ],
    });
    expect(parsedBook.bids.length).toBe(1);
    expect(parsedBook.bids[0]?.px).toBe(0.0179);
    expect(parsedBook.asks.length).toBe(1);
    expect(parsedBook.asks[0]?.px).toBe(0.0181);
  });
});

describe("perpsSnapshotHandler", () => {
  function buildApp(fetchImpl: typeof fetch, cache = new BoundedTtlCache()) {
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/perps/snapshot",
      createPerpsSnapshotHandler({ cache, fetchImpl, sleepImpl: async () => {} })
    );
    return app;
  }

  it("returns 400 on missing or invalid coin", async () => {
    const app = buildApp(async () => new Response("[]", { status: 200 }));
    const res = await app.request("/v1/perps/snapshot?coin=BAD$COIN");
    expect(res.status).toBe(400);
  });

  it("strips -PERP suffix, preserves canonical kPEPE for l2Book, and caches snapshot", async () => {
    const seenBodies: unknown[] = [];
    const mockFetch: typeof fetch = async (_input, init) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { type?: string; coin?: string };
      seenBodies.push(parsed);
      if (parsed.type === "metaAndAssetCtxs") {
        return new Response(
          JSON.stringify([
            { universe: [{ name: "kPEPE", maxLeverage: 10, szDecimals: 0 }] },
            [{ markPx: "0.02", oraclePx: "0.02", funding: "0.00001", openInterest: "1000", prevDayPx: "0.019", dayNtlVlm: "100000" }],
          ]),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          coin: parsed.coin,
          time: 1000,
          levels: [
            [{ px: "0.0199", sz: "5000", n: 2 }],
            [{ px: "0.0201", sz: "5000", n: 2 }],
          ],
        }),
        { status: 200 }
      );
    };

    const app = buildApp(mockFetch);
    const first = await app.request("/v1/perps/snapshot?coin=kpepe-perp");
    expect(first.status).toBe(200);
    const body = (await first.json()) as { coin: string };
    expect(body.coin).toBe("kPEPE");
    expect(seenBodies).toEqual([
      { type: "metaAndAssetCtxs" },
      { type: "l2Book", coin: "kPEPE" },
    ]);

    // Second hit uses cached snapshot (0 extra upstream calls)
    const second = await app.request("/v1/perps/snapshot?coin=KPEPE-PERP");
    expect(second.status).toBe(200);
    expect(seenBodies.length).toBe(2);
  });

  it("returns 404 when coin is absent from universe and 502 on upstream 429", async () => {
    const notFoundApp = buildApp(async () =>
      new Response(JSON.stringify([{ universe: [{ name: "BTC" }] }, [{ markPx: "95000" }]]), {
        status: 200,
      })
    );
    const nf = await notFoundApp.request("/v1/perps/snapshot?coin=DOESNOTEXIST");
    expect(nf.status).toBe(404);

    const rateLimitApp = buildApp(async () => new Response("rate limited", { status: 429 }));
    const rl = await rateLimitApp.request("/v1/perps/snapshot?coin=BTC");
    expect(rl.status).toBe(502);
    const rlBody = (await rl.json()) as { upstream_error: string };
    expect(rlBody.upstream_error).toBe("HYPERLIQUID_429");
  });

  it("retries transient Hyperliquid 429 responses and succeeds on recovery", async () => {
    let metaCalls = 0;
    let bookCalls = 0;
    const flakyFetch: typeof fetch = async (_input, init) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { type?: string; coin?: string };
      if (parsed.type === "metaAndAssetCtxs") {
        metaCalls += 1;
        if (metaCalls === 1) {
          return new Response("rate limited", { status: 429 });
        }
        return new Response(
          JSON.stringify([
            { universe: [{ name: "BTC", maxLeverage: 50, szDecimals: 5 }] },
            [{ markPx: "95000", oraclePx: "95000", funding: "0.00001", openInterest: "100", prevDayPx: "94000", dayNtlVlm: "1000000" }],
          ]),
          { status: 200 }
        );
      }
      bookCalls += 1;
      if (bookCalls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(
        JSON.stringify({
          coin: parsed.coin,
          time: 1000,
          levels: [
            [{ px: "94995", sz: "2", n: 1 }],
            [{ px: "95005", sz: "2", n: 1 }],
          ],
        }),
        { status: 200 }
      );
    };

    const app = buildApp(flakyFetch);
    const res = await app.request("/v1/perps/snapshot?coin=BTC");
    expect(res.status).toBe(200);
    expect(metaCalls).toBe(2);
    expect(bookCalls).toBe(2);
  });
});
