import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createPredictionsArbHandler } from "../src/packs/markets/routes/predictionsArb";
import {
  MAX_MARKETS_PER_VENUE,
  computePredictionsArb,
  computeTitleSimilarity,
  estimateKalshiTakerFeeUsd,
  normalizeMarketTitle,
} from "../src/packs/markets/services/predictionsArb";
import type { AppBindings, RawPredictionMarket } from "../src/types";

const NOW_ISO = "2026-11-22T12:00:00Z";
const NOW_MS = Date.parse(NOW_ISO);

function makeMarket(
  overrides: Partial<RawPredictionMarket> & { venue: "polymarket" | "kalshi"; id: string; title: string }
): RawPredictionMarket {
  return {
    category: "Crypto",
    yesProb: 0.5,
    noProb: 0.5,
    yesBid: 0.49,
    yesAsk: 0.51,
    spreadBps: 200,
    volume24hUsd: 100_000,
    liquidityUsd: 50_000,
    openInterestUsd: 50_000,
    expiresAt: "2026-12-22T12:00:00Z", // 30 days (720h) from NOW_ISO
    url: null,
    ...overrides,
  };
}

describe("prediction markets arbitrage engine & route", () => {
  it("normalizes aliases, currency amounts, bps units, and separates calendar days from strike thresholds", () => {
    const polyBtc = normalizeMarketTitle("Will BTC trade above $100k before Dec 31, 2026?");
    const kalshiBtc = normalizeMarketTitle("Bitcoin above $100,000 on December 31?");
    const btcSim = computeTitleSimilarity(polyBtc, kalshiBtc);
    expect(btcSim.confidence).toBe("HIGH");
    expect(btcSim.score).toBeGreaterThanOrEqual(0.75);
    expect(polyBtc.thresholdNumbers.has("100000")).toBe(true);
    expect(polyBtc.thresholdNumbers.has("31")).toBe(false);

    // Ensure "December (25bps cut)" keeps 25 as a strike threshold, NOT a calendar day
    const polyFed = normalizeMarketTitle("Will the Federal Reserve cut interest rates by 25 bps in December?");
    const kalshiFed = normalizeMarketTitle("Fed cuts rates in December (25bps cut)");
    expect(kalshiFed.thresholdNumbers.has("25")).toBe(true);
    const fedSim = computeTitleSimilarity(polyFed, kalshiFed);
    expect(fedSim.confidence).toBe("HIGH");
    expect(fedSim.score).toBe(1);

    // Prototype keys like "constructor" (e.g. F1 Constructor Championship) must stay plain strings
    const f1 = normalizeMarketTitle("Will McLaren win the F1 Constructor Championship?");
    expect(f1.tokens.has("constructor")).toBe(true);
    for (const tok of f1.tokens) {
      expect(typeof tok).toBe("string");
    }

    // Ordinal calendar dates ("December 31st" and "31st of December" vs "Dec 31") normalize cleanly
    const ordSim = computeTitleSimilarity(
      normalizeMarketTitle("Will BTC trade above $100k before Dec 31?"),
      normalizeMarketTitle("Bitcoin above $100,000 by December 31st?")
    );
    expect(ordSim.confidence).toBe("HIGH");
    expect(ordSim.score).toBe(1);

    const ordOf = normalizeMarketTitle("Will Bitcoin reach $100k by the 31st of December 2026?");
    expect(ordOf.thresholdNumbers.has("31")).toBe(false);
    expect(ordOf.thresholdNumbers.has("100000")).toBe(true);
    const ordOfSim = computeTitleSimilarity(
      normalizeMarketTitle("Will BTC exceed $100,000 by Dec 31, 2026?"),
      ordOf
    );
    expect(ordOfSim.confidence).toBe("HIGH");
  });

  it("rejects false positives: mismatched strikes, opposite comparators, antonyms, and range contracts", () => {
    // Different strike ($100k vs $120k)
    const strikeMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will BTC trade above $100k before Dec 31?"),
      normalizeMarketTitle("Bitcoin above $120k on Dec 31?")
    );
    expect(strikeMismatch.confidence).toBeNull();
    expect(strikeMismatch.score).toBe(0);

    // Opposite comparator (above vs below)
    const dirMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will Bitcoin trade above $100k by Dec 31?"),
      normalizeMarketTitle("Bitcoin below $100k by Dec 31?")
    );
    expect(dirMismatch.confidence).toBeNull();

    // Antonym action (cut vs hike)
    const antonymMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Fed cuts rates by 25bps in December"),
      normalizeMarketTitle("Fed hikes rates by 25bps in December")
    );
    expect(antonymMismatch.confidence).toBeNull();

    // Range contract vs single threshold
    const rangeMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Bitcoin between $100k and $110k on Dec 31"),
      normalizeMarketTitle("Bitcoin above $100k on Dec 31")
    );
    expect(rangeMismatch.confidence).toBeNull();

    // Negative vs positive threshold (-0.5% vs +0.5%, -$100k vs $100k)
    const signMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will US GDP growth be below -0.5% in Q4?"),
      normalizeMarketTitle("US GDP growth below 0.5% in Q4")
    );
    expect(signMismatch.confidence).toBeNull();
    expect(signMismatch.score).toBe(0);

    // Matching negative thresholds still match cleanly
    const negMatch = computeTitleSimilarity(
      normalizeMarketTitle("Will US GDP growth be below -0.5% in Q4?"),
      normalizeMarketTitle("US GDP growth below -0.5% in Q4")
    );
    expect(negMatch.confidence).toBe("HIGH");

    // Negation polarity mismatch ("will reach" vs "will not reach" / "won't reach")
    const negationMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will BTC reach $100k before Dec 31?"),
      normalizeMarketTitle("Will BTC not reach $100k before Dec 31?")
    );
    expect(negationMismatch.confidence).toBeNull();

    const contractionMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will BTC reach $100k before Dec 31?"),
      normalizeMarketTitle("BTC won't reach $100k before Dec 31")
    );
    expect(contractionMismatch.confidence).toBeNull();

    // Standalone "no" negation ("no rate cut" vs "a rate cut")
    const noNegationMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will Fed make no rate cut in December?"),
      normalizeMarketTitle("Will Fed make a rate cut in December?")
    );
    expect(noNegationMismatch.confidence).toBeNull();
    expect(noNegationMismatch.score).toBe(0);

    // Opposite temporal direction ("before Dec 31" vs "after Dec 31")
    const temporalMismatch = computeTitleSimilarity(
      normalizeMarketTitle("Will BTC reach $100k before Dec 31?"),
      normalizeMarketTitle("Will BTC reach $100k after Dec 31?")
    );
    expect(temporalMismatch.confidence).toBeNull();
    expect(temporalMismatch.score).toBe(0);

    // One-sided strike threshold ("50bps cut" vs unquantified "any cut")
    const oneSidedThreshold = computeTitleSimilarity(
      normalizeMarketTitle("Fed cuts rates by 50bps in December"),
      normalizeMarketTitle("Fed cuts rates in December")
    );
    expect(oneSidedThreshold.confidence).toBeNull();
    expect(oneSidedThreshold.score).toBe(0);
  });

  it("excludes non-Yes/No Polymarket markets from cross-venue arbitrage", () => {
    const poly = [
      makeMarket({
        venue: "polymarket",
        id: "poly-sports",
        title: "Chiefs vs Eagles December game",
        isBinaryYesNo: false,
        yesProb: null,
        noProb: null,
        yesBid: null,
        yesAsk: null,
      }),
    ];
    const kalshi = [
      makeMarket({
        venue: "kalshi",
        id: "kalshi-sports",
        title: "Chiefs vs Eagles December game",
        yesBid: 0.5,
        yesAsk: 0.52,
      }),
    ];
    const res = computePredictionsArb(poly, kalshi, {
      minSpreadBps: 0,
      minLiquidityUsd: 0,
      query: null,
      limit: 10,
      nowMs: NOW_MS,
    });
    expect(res.summary.polymarket_eligible).toBe(0);
    expect(res.opportunities).toEqual([]);
  });

  it("computes optimal strategy, conservative fees, net edge, APY, and resolution_risk_warning", () => {
    const poly = [
      makeMarket({
        venue: "polymarket",
        id: "poly-btc-100k",
        title: "Will BTC trade above $100k before Dec 31?",
        yesProb: 0.41,
        noProb: 0.59,
        yesBid: 0.4,
        yesAsk: 0.42, // buy YES on Polymarket @ $0.42
        liquidityUsd: 250_000,
        expiresAt: "2026-12-22T12:00:00Z", // 720h
        url: "https://polymarket.com/market/btc-100k",
      }),
    ];

    const kalshi = [
      makeMarket({
        venue: "kalshi",
        id: "KXBTC-26DEC-100K",
        title: "Bitcoin above $100,000 on Dec 31",
        yesProb: 0.51,
        noProb: 0.49,
        yesBid: 0.5, // buy NO on Kalshi @ 1 - 0.50 = $0.50
        yesAsk: 0.52,
        liquidityUsd: 120_000,
        expiresAt: "2026-12-23T12:00:00Z", // 744h (24h later -> within 72h window)
        url: "https://kalshi.com/markets/kxbtc",
      }),
    ];

    const res = computePredictionsArb(poly, kalshi, {
      minSpreadBps: 150,
      minLiquidityUsd: 5000,
      query: null,
      limit: 15,
      nowMs: NOW_MS,
      fetchedAt: NOW_ISO,
    });

    expect(res.summary.matched_pairs_count).toBe(1);
    expect(res.summary.qualifying_opportunities_count).toBe(1);
    expect(res.opportunities.length).toBe(1);

    const opp = res.opportunities[0]!;
    expect(opp.match_confidence).toBe("HIGH");
    expect(opp.strategy).toBe("BUY_YES_POLYMARKET_BUY_NO_KALSHI");
    expect(opp.quote_quality).toBe("EXECUTABLE_BOOK");
    expect(opp.combined_cost_usd).toBeCloseTo(0.92, 4);
    expect(opp.gross_edge_bps).toBeCloseTo(800, 2);

    // Kalshi fee at P=0.50 is 0.07 * 0.5 * 0.5 = 0.0175 (175 bps) + 20 bps Poly buffer = 195 bps
    expect(estimateKalshiTakerFeeUsd(0.5)).toBeCloseTo(0.0175, 6);
    expect(opp.estimated_fees_bps).toBeCloseTo(195, 2);
    expect(opp.net_edge_bps).toBeCloseTo(605, 2);
    expect(opp.net_combined_cost_usd).toBeCloseTo(0.9395, 4);
    expect(opp.implied_prob_gap_bps).toBeCloseTo(1000, 2);
    expect(opp.expiry_diff_hours).toBe(24);
    expect(opp.hours_to_resolution).toBe(744);
    expect(opp.min_liquidity_usd).toBe(120_000);
    expect(opp.resolution_risk_warning).toBe(true);

    // APY uses max expiry (744h): ((1 - 0.9395) / 0.9395) * (8760 / 744) * 100 = 75.81%
    expect(opp.annualized_arb_apy_pct).toBeCloseTo(75.81, 1);
  });

  it("selects reverse strategy BUY_YES_KALSHI_BUY_NO_POLYMARKET when cheaper", () => {
    const poly = [
      makeMarket({
        venue: "polymarket",
        id: "poly-fed",
        title: "Fed cuts rates by 25bps in December",
        yesProb: 0.72,
        noProb: 0.28,
        yesBid: 0.71, // buy NO on Poly @ 0.29
        yesAsk: 0.73,
      }),
    ];
    const kalshi = [
      makeMarket({
        venue: "kalshi",
        id: "KXFED-DEC-25",
        title: "Federal Reserve cuts rates 25 bps in Dec",
        yesProb: 0.62,
        noProb: 0.38,
        yesBid: 0.61,
        yesAsk: 0.63, // buy YES on Kalshi @ 0.63 -> combined 0.92
      }),
    ];

    const res = computePredictionsArb(poly, kalshi, {
      minSpreadBps: 150,
      minLiquidityUsd: 5000,
      query: null,
      limit: 15,
      nowMs: NOW_MS,
    });

    expect(res.opportunities.length).toBe(1);
    expect(res.opportunities[0]!.strategy).toBe("BUY_YES_KALSHI_BUY_NO_POLYMARKET");
    expect(res.opportunities[0]!.polymarket.action).toBe("BUY_NO");
    expect(res.opportunities[0]!.kalshi.action).toBe("BUY_YES");
    expect(res.opportunities[0]!.combined_cost_usd).toBeCloseTo(0.92, 4);
  });

  it("enforces 72h expiry window, empty-book guards, mid-fallback penalty, and 1-to-1 greedy matching", () => {
    const poly = [
      // Valid pair candidate
      makeMarket({
        venue: "polymarket",
        id: "poly-starship",
        title: "SpaceX Starship orbital launch in December",
        yesAsk: 0.4,
        yesBid: 0.38,
        expiresAt: "2026-12-20T12:00:00Z",
      }),
      // Empty ask book ($1.00) and empty bid ($0.00) -> must never emit phantom arb
      makeMarket({
        venue: "polymarket",
        id: "poly-empty",
        title: "Will ETH reach $5000 before Dec 31?",
        yesProb: 0.3,
        noProb: 0.7,
        yesBid: 0,
        yesAsk: 1,
        expiresAt: "2026-12-31T12:00:00Z",
      }),
      // Mid fallback (no book quotes)
      makeMarket({
        venue: "polymarket",
        id: "poly-mid",
        title: "Will CPI inflation exceed 3.0% in November?",
        yesProb: 0.4,
        noProb: 0.6,
        yesBid: null,
        yesAsk: null,
        expiresAt: "2026-12-10T12:00:00Z",
      }),
    ];

    const kalshi = [
      // Too far apart (> 72h from poly-starship)
      makeMarket({
        venue: "kalshi",
        id: "kalshi-starship-far",
        title: "SpaceX Starship orbital launch in December",
        yesBid: 0.55,
        yesAsk: 0.57,
        expiresAt: "2026-12-28T12:00:00Z", // 8 days apart
      }),
      // Duplicate match for starship within 72h (lower score)
      makeMarket({
        venue: "kalshi",
        id: "kalshi-starship-med",
        title: "SpaceX Starship launch in Dec",
        yesBid: 0.54,
        yesAsk: 0.56,
        expiresAt: "2026-12-21T12:00:00Z",
      }),
      // Higher score match for starship within 72h -> should win 1-to-1 assignment
      makeMarket({
        venue: "kalshi",
        id: "kalshi-starship-exact",
        title: "SpaceX Starship orbital launch in Dec",
        yesBid: 0.54,
        yesAsk: 0.56,
        expiresAt: "2026-12-20T18:00:00Z",
      }),
      // Counterpart for empty-book ETH market
      makeMarket({
        venue: "kalshi",
        id: "kalshi-eth",
        title: "Ethereum above $5000 by Dec 31",
        yesBid: 0.6,
        yesAsk: 0.62,
        expiresAt: "2026-12-31T12:00:00Z",
      }),
      // Counterpart for CPI mid-fallback market
      makeMarket({
        venue: "kalshi",
        id: "kalshi-cpi",
        title: "November inflation above 3.0%",
        yesProb: 0.52,
        noProb: 0.48,
        yesBid: 0.51,
        yesAsk: 0.53,
        expiresAt: "2026-12-10T12:00:00Z",
      }),
    ];

    const res = computePredictionsArb(poly, kalshi, {
      minSpreadBps: 100,
      minLiquidityUsd: 5000,
      query: null,
      limit: 15,
      nowMs: NOW_MS,
    });

    // Empty-book ETH pair excluded; starship matched once to exact candidate; CPI uses MID_FALLBACK
    const ids = res.opportunities.map((o) => `${o.polymarket.id}->${o.kalshi.id}`);
    expect(ids).toContain("poly-starship->kalshi-starship-exact");
    expect(ids).not.toContain("poly-starship->kalshi-starship-med");
    expect(ids).not.toContain("poly-starship->kalshi-starship-far");
    expect(ids).not.toContain("poly-empty->kalshi-eth");

    const cpiOpp = res.opportunities.find((o) => o.polymarket.id === "poly-mid");
    expect(cpiOpp).toBeDefined();
    expect(cpiOpp?.quote_quality).toBe("MID_FALLBACK");
    // Extra 50 bps mid-fallback penalty included on top of Kalshi fee + 20 bps Poly buffer
    expect(cpiOpp!.estimated_fees_bps).toBeGreaterThan(240);
  });

  it("caps eligible universe to MAX_MARKETS_PER_VENUE per venue and stays well within CPU budget", () => {
    const poly: RawPredictionMarket[] = [];
    const kalshi: RawPredictionMarket[] = [];

    for (let i = 0; i < 120; i += 1) {
      poly.push(
        makeMarket({
          venue: "polymarket",
          id: `p-${i}`,
          title: `Will AlphaToken${i} exceed $${100 + i} before Dec 31?`,
          liquidityUsd: 10_000 + i * 100,
          yesAsk: 0.4,
          yesBid: 0.39,
        })
      );
      kalshi.push(
        makeMarket({
          venue: "kalshi",
          id: `k-${i}`,
          title: `AlphaToken${i} above $${100 + i} on Dec 31`,
          liquidityUsd: 10_000 + i * 100,
          yesAsk: 0.55,
          yesBid: 0.54,
        })
      );
    }

    const start = performance.now();
    const res = computePredictionsArb(poly, kalshi, {
      minSpreadBps: 150,
      minLiquidityUsd: 5000,
      query: null,
      limit: 15,
      nowMs: NOW_MS,
    });
    const elapsedMs = performance.now() - start;

    expect(res.summary.polymarket_eligible).toBe(MAX_MARKETS_PER_VENUE);
    expect(res.summary.kalshi_eligible).toBe(MAX_MARKETS_PER_VENUE);
    expect(res.opportunities.length).toBe(15);
    expect(elapsedMs).toBeLessThan(100);
  });

  it("route handler validates params (400), fails closed on single-venue outage (502), handles 404 query, and caches", async () => {
    const polyPayload = [
      {
        id: "517310",
        slug: "btc-above-100k",
        question: "Will BTC trade above $100k before Dec 31?",
        category: "Crypto",
        active: true,
        closed: false,
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.41", "0.59"]',
        bestBid: 0.4,
        bestAsk: 0.42,
        volume24hr: 1_500_000,
        liquidityClob: 400_000,
        endDate: "2026-12-22T12:00:00Z",
      },
    ];
    const kalshiPayload = {
      markets: [
        {
          ticker: "KXBTC-26DEC-100K",
          event_ticker: "KXBTC-26DEC",
          title: "Bitcoin above $100,000 on Dec 31",
          category: "Crypto",
          status: "open",
          yes_bid_dollars: "0.5000",
          yes_ask_dollars: "0.5200",
          volume_24h_fp: "320000",
          liquidity_dollars: "180000.00",
          close_time: "2026-12-22T18:00:00Z",
        },
      ],
    };

    let fetchCount = 0;
    const okFetch: typeof fetch = async (input) => {
      fetchCount += 1;
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com")) {
        return new Response(JSON.stringify(polyPayload), { status: 200 });
      }
      return new Response(JSON.stringify(kalshiPayload), { status: 200 });
    };

    const cache = new BoundedTtlCache();
    const app = new Hono<AppBindings>();
    app.get(
      "/v1/predictions/arb",
      createPredictionsArbHandler({ cache, fetchImpl: okFetch, nowMs: () => NOW_MS })
    );

    // First call -> 200 (cache MISS -> fetches both venues)
    const r1 = await app.request("http://localhost/v1/predictions/arb?min_spread_bps=150");
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as {
      opportunities: Array<{ strategy: string; resolution_risk_warning: boolean }>;
      summary: { qualifying_opportunities_count: number };
    };
    expect(body1.summary.qualifying_opportunities_count).toBe(1);
    expect(body1.opportunities[0]!.strategy).toBe("BUY_YES_POLYMARKET_BUY_NO_KALSHI");
    expect(body1.opportunities[0]!.resolution_risk_warning).toBe(true);
    expect(fetchCount).toBe(2);

    // Second call -> served from cache (zero new upstream fetches), including alias query=bitcoin matching "BTC"
    const r2 = await app.request("http://localhost/v1/predictions/arb?query=btc");
    expect(r2.status).toBe(200);
    expect(fetchCount).toBe(2);

    const rAlias = await app.request("http://localhost/v1/predictions/arb?query=bitcoin");
    expect(rAlias.status).toBe(200);
    const aliasBody = (await rAlias.json()) as { summary: { matched_pairs_count: number } };
    expect(aliasBody.summary.matched_pairs_count).toBe(1);
    expect(fetchCount).toBe(2);

    // Non-matching query -> 404 unsettled
    const r404 = await app.request("http://localhost/v1/predictions/arb?query=nonexistentxyz");
    expect(r404.status).toBe(404);

    // Invalid query params -> 400 unsettled
    expect((await app.request("http://localhost/v1/predictions/arb?min_spread_bps=-10")).status).toBe(400);
    expect((await app.request("http://localhost/v1/predictions/arb?min_liquidity_usd=abc")).status).toBe(400);
    expect((await app.request("http://localhost/v1/predictions/arb?limit=99")).status).toBe(400);
    expect((await app.request("http://localhost/v1/predictions/arb?query=" + "a".repeat(65))).status).toBe(400);

    // Fail closed 502 when ONLY Kalshi fails (Polymarket still up)
    const partialOutageFetch: typeof fetch = async (input) => {
      if (String(input).includes("gamma-api.polymarket.com")) {
        return new Response(JSON.stringify(polyPayload), { status: 200 });
      }
      return new Response("down", { status: 503 });
    };
    const appOutage = new Hono<AppBindings>();
    appOutage.get(
      "/v1/predictions/arb",
      createPredictionsArbHandler({
        cache: new BoundedTtlCache(),
        fetchImpl: partialOutageFetch,
        nowMs: () => NOW_MS,
      })
    );
    const r502 = await appOutage.request("http://localhost/v1/predictions/arb");
    expect(r502.status).toBe(502);
  });
});
