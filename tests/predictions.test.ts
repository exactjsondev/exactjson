import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { parseKalshiMarkets } from "../src/packs/markets/providers/kalshi";
import { parsePolymarketMarkets } from "../src/packs/markets/providers/polymarket";
import { createPredictionsScannerHandler } from "../src/packs/markets/routes/predictionsScanner";
import { computePredictionsScanner } from "../src/packs/markets/services/predictionsScanner";
import type { AppBindings } from "../src/types";

const SAMPLE_POLY = [
  {
    id: "517310",
    slug: "btc-above-100k",
    question: "Will BTC trade above $100k before Dec 31?",
    category: "Crypto",
    active: true,
    closed: false,
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.88", "0.12"]',
    bestBid: 0.87,
    bestAsk: 0.89,
    volume24hr: 4250000,
    liquidityClob: 1850000,
    endDate: "2026-12-22T12:00:00Z",
  },
  {
    id: "517311",
    slug: "closed-market",
    question: "Already closed market",
    active: true,
    closed: true,
    outcomePrices: '["1.0", "0.0"]',
    volume24hr: 9999999,
  },
];

const SAMPLE_KALSHI = {
  markets: [
    {
      ticker: "KXFED-26DEC-T425",
      event_ticker: "KXFED-26DEC",
      title: "Fed cuts rates in December",
      yes_sub_title: "25bps cut",
      category: "Economics",
      status: "open",
      yes_bid_dollars: "0.9000",
      yes_ask_dollars: "0.9200",
      volume_24h_fp: "320000",
      liquidity_dollars: "500000.00",
      open_interest_fp: "150000",
      close_time: "2026-12-10T18:00:00Z",
    },
    {
      ticker: "KXLEGACY-26DEC",
      event_ticker: "KXLEGACY",
      title: "Legacy cent-quoted BTC market",
      category: "Crypto",
      status: "open",
      yes_bid: 40,
      yes_ask: 46,
      volume_24h: 12000,
      liquidity: 5000000, // cents -> $50,000
      close_time: "2026-12-20T12:00:00Z",
    },
  ],
};

describe("prediction markets providers & scanner", () => {
  it("parses Polymarket double-encoded outcomePrices and filters closed markets", () => {
    const parsed = parsePolymarketMarkets(SAMPLE_POLY);
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.id).toBe("517310");
    expect(parsed[0]!.yesProb).toBe(0.88);
    expect(parsed[0]!.noProb).toBe(0.12);
    expect(parsed[0]!.spreadBps).toBeCloseTo(200, 4);
    expect(parsed[0]!.url).toBe("https://polymarket.com/market/btc-above-100k");
  });

  it("inverts Polymarket bestBid/bestAsk when outcomes are [No, Yes] and avoids mislabeling non-Yes/No markets", () => {
    const parsed = parsePolymarketMarkets([
      {
        id: "inv-1",
        question: "Will X happen?",
        active: true,
        closed: false,
        outcomes: '["No", "Yes"]',
        outcomePrices: '["0.70", "0.30"]',
        bestBid: 0.69,
        bestAsk: 0.71,
        volume24hr: 100000,
      },
      {
        id: "sports-1",
        question: "Chiefs vs Eagles",
        active: true,
        closed: false,
        outcomes: '["Chiefs", "Eagles"]',
        outcomePrices: '["0.62", "0.38"]',
        bestBid: 0.61,
        bestAsk: 0.63,
        volume24hr: 500000,
      },
    ]);

    expect(parsed.length).toBe(2);
    const inv = parsed[0]!;
    expect(inv.isBinaryYesNo).toBe(true);
    expect(inv.yesProb).toBe(0.3);
    expect(inv.noProb).toBe(0.7);
    expect(inv.yesBid).toBeCloseTo(0.29, 6);
    expect(inv.yesAsk).toBeCloseTo(0.31, 6);
    expect(inv.spreadBps).toBeCloseTo(200, 4);

    const sports = parsed[1]!;
    expect(sports.isBinaryYesNo).toBe(false);
    expect(sports.yesProb).toBeNull();
    expect(sports.noProb).toBeNull();
    expect(sports.yesBid).toBeNull();
    expect(sports.yesAsk).toBeNull();
    expect(sports.spreadBps).toBeCloseTo(200, 4);

    const scan = computePredictionsScanner([sports], {
      venue: "polymarket",
      query: null,
      minVolume24hUsd: 0,
      limit: 5,
      venuesActive: ["polymarket"],
    });
    expect(scan.top_by_volume[0]?.dominant_side).toBeNull();
    expect(scan.top_by_volume[0]?.yes_prob).toBeNull();
    expect(scan.high_conviction_carry).toEqual([]);
  });

  it("parses both Kalshi fixed-point _dollars/_fp and legacy integer-cent formats", () => {
    const parsed = parseKalshiMarkets(SAMPLE_KALSHI);
    expect(parsed.length).toBe(2);

    const modern = parsed[0]!;
    expect(modern.id).toBe("KXFED-26DEC-T425");
    expect(modern.yesProb).toBeCloseTo(0.91, 4);
    expect(modern.spreadBps).toBeCloseTo(200, 4);
    expect(modern.volume24hUsd).toBe(320000);
    expect(modern.liquidityUsd).toBe(500000);

    const legacy = parsed[1]!;
    expect(legacy.yesProb).toBeCloseTo(0.43, 4);
    expect(legacy.spreadBps).toBeCloseTo(600, 4);
    expect(legacy.liquidityUsd).toBe(50000);

    // String integer cent "1" must parse as 0.01 (1 cent), never 1.00 (100%)
    const strCent = parseKalshiMarkets({
      markets: [{ ticker: "KXCENT", title: "Cent test", status: "open", yes_bid: "1", yes_ask: "2", volume_24h: 1000 }],
    });
    expect(strCent[0]?.yesBid).toBeCloseTo(0.01, 4);
    expect(strCent[0]?.yesAsk).toBeCloseTo(0.02, 4);
    expect(strCent[0]?.yesProb).toBeCloseTo(0.015, 4);
  });

  it("computes deterministic carry APR, spreads, and keyword filtering", () => {
    const nowMs = Date.parse("2026-11-22T12:00:00Z");
    const markets = [...parsePolymarketMarkets(SAMPLE_POLY), ...parseKalshiMarkets(SAMPLE_KALSHI)];

    const result = computePredictionsScanner(markets, {
      venue: "all",
      query: null,
      minVolume24hUsd: 1000,
      limit: 10,
      venuesActive: ["polymarket", "kalshi"],
      nowMs,
    });

    expect(result.market_summary.matching_count).toBe(3);
    expect(result.top_by_volume[0]!.id).toBe("517310");
    expect(result.high_conviction_carry.length).toBe(2);
    // Polymarket BTC: entry yesAsk=0.89, 30 days = 720h -> ((1-0.89)/0.89)*(8760/720)*100 = 150.37%
    const btcCarry = result.high_conviction_carry.find((m) => m.id === "517310");
    expect(btcCarry?.implied_annualized_carry_pct).toBeCloseTo(150.37, 1);
    // Widest spread is legacy 600 bps
    expect(result.widest_spreads[0]!.id).toBe("KXLEGACY-26DEC");
    expect(result.widest_spreads[0]!.bid_ask_spread_bps).toBe(600);
  });

  it("never emits phantom carry APR when Kalshi/Polymarket ask is $1.00 or bid is $0.00", () => {
    const nowMs = Date.parse("2026-11-22T12:00:00Z");
    const emptyBook = parseKalshiMarkets({
      markets: [
        {
          ticker: "KXNOASK",
          title: "No resting ask on YES",
          status: "open",
          yes_bid_dollars: "0.8600",
          yes_ask_dollars: "1.0000",
          volume_24h_fp: "50000",
          close_time: "2026-12-10T12:00:00Z",
        },
        {
          ticker: "KXNOBID",
          title: "No resting bid on YES (NO dominant)",
          status: "open",
          yes_bid_dollars: "0.0000",
          yes_ask_dollars: "0.1500",
          last_price_dollars: "0.1000",
          volume_24h_fp: "50000",
          close_time: "2026-12-10T12:00:00Z",
        },
        {
          ticker: "KXEMPTYBOOK",
          title: "Completely empty 0/100 book",
          status: "open",
          yes_bid_dollars: "0.0000",
          yes_ask_dollars: "1.0000",
          volume_24h_fp: "50000",
          close_time: "2026-12-10T12:00:00Z",
        },
      ],
    });

    const result = computePredictionsScanner(emptyBook, {
      venue: "kalshi",
      query: null,
      minVolume24hUsd: 0,
      limit: 10,
      venuesActive: ["kalshi"],
      nowMs,
    });

    expect(result.high_conviction_carry).toEqual([]);
    expect(result.widest_spreads.some((m) => m.id === "KXEMPTYBOOK")).toBe(false);
    for (const item of result.top_by_volume) {
      expect(item.implied_annualized_carry_pct).toBeNull();
    }

    // Explicit yesAsk=0 or yesBid=1 must never fall back to dominantProb and emit phantom carry
    const zeroAskScan = computePredictionsScanner(
      [
        {
          venue: "polymarket",
          id: "zero-ask",
          title: "Invalid zero ask",
          category: "Crypto",
          yesProb: 0.9,
          noProb: 0.1,
          yesBid: 0.88,
          yesAsk: 0,
          spreadBps: null,
          volume24hUsd: 50_000,
          liquidityUsd: 50_000,
          openInterestUsd: null,
          expiresAt: "2026-12-10T12:00:00Z",
          url: null,
        },
        {
          venue: "polymarket",
          id: "one-bid",
          title: "Invalid one bid on NO dominant",
          category: "Crypto",
          yesProb: 0.1,
          noProb: 0.9,
          yesBid: 1,
          yesAsk: 1,
          spreadBps: 0,
          volume24hUsd: 50_000,
          liquidityUsd: 50_000,
          openInterestUsd: null,
          expiresAt: "2026-12-10T12:00:00Z",
          url: null,
        },
      ],
      {
        venue: "polymarket",
        query: null,
        minVolume24hUsd: 0,
        limit: 10,
        venuesActive: ["polymarket"],
        nowMs,
      }
    );
    expect(zeroAskScan.high_conviction_carry).toEqual([]);
    for (const item of zeroAskScan.top_by_volume) {
      expect(item.implied_annualized_carry_pct).toBeNull();
    }
  });

  it("falls back gracefully when 1 of 2 venues fails and returns 404/400/502 unsettled", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com")) {
        return new Response(JSON.stringify(SAMPLE_POLY), { status: 200 });
      }
      return new Response("down", { status: 503 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/predictions/scanner",
      createPredictionsScannerHandler({ cache: new BoundedTtlCache(), fetchImpl: mockFetch })
    );

    // 1 of 2 venues succeeds -> 200 with polymarket active (supports canonical aliases like bitcoin <-> BTC)
    const okRes = await app.request("http://localhost/v1/predictions/scanner?query=btc");
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { venues_active: string[]; market_summary: { matching_count: number } };
    expect(body.venues_active).toEqual(["polymarket"]);
    expect(body.market_summary.matching_count).toBe(1);

    const aliasRes = await app.request("http://localhost/v1/predictions/scanner?query=bitcoin");
    expect(aliasRes.status).toBe(200);
    const aliasBody = (await aliasRes.json()) as { market_summary: { matching_count: number } };
    expect(aliasBody.market_summary.matching_count).toBe(1);

    // Non-matching query -> 404 unsettled
    const notFound = await app.request("http://localhost/v1/predictions/scanner?query=nonexistentxyz");
    expect(notFound.status).toBe(404);

    // Invalid venue -> 400 unsettled
    const badVenue = await app.request("http://localhost/v1/predictions/scanner?venue=invalid");
    expect(badVenue.status).toBe(400);

    // Single requested venue fails -> 502 unsettled
    const kalshiDown = await app.request("http://localhost/v1/predictions/scanner?venue=kalshi");
    expect(kalshiDown.status).toBe(502);
  });
});
