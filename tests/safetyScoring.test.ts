import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../src/config/catalog";
import { BoundedTtlCache } from "../src/lib/cache";
import { aggregateDexScreenerPairs } from "../src/providers/dexscreener";
import { parseRugCheckSummary } from "../src/providers/rugcheck";
import { createSolanaSafetyHandler } from "../src/routes/solanaSafety";
import { computeSolanaSafety } from "../src/services/safetyScoring";
import type { AppBindings, DexScreenerAggregated, RugCheckSummary } from "../src/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const HEALTHY_RUG: RugCheckSummary = {
  mint: SOL_MINT,
  rawScore: 100,
  scoreNormalised: 4,
  lpLockedPct: 98.5,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  tokenType: "Fungible",
  risks: [],
};

const HEALTHY_DEX: DexScreenerAggregated = {
  pairCount: 12,
  totalLiquidityUsd: 25_000_000,
  volume24hUsd: 80_000_000,
  priceUsd: 182.5,
  priceChange24hPct: 3.2,
  fdvUsd: 95_000_000_000,
  primaryDex: "raydium",
  primaryPairAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
  symbol: "SOL",
  name: "Wrapped SOL",
};

describe("safetyScoring", () => {
  it("computes LOW risk for healthy liquidity, locked LP, and clean RugCheck", () => {
    const res = computeSolanaSafety(SOL_MINT, HEALTHY_RUG, HEALTHY_DEX, "2026-11-21T00:00:00.000Z");

    expect(res.risk_score).toBe(2);
    expect(res.risk_tier).toBe("LOW");
    expect(res.flags).toEqual([]);
    expect(res.security.lp_locked_pct).toBe(98.5);
    expect(res.metadata.disclaimer).toBe(DISCLAIMER);
    expect(JSON.stringify(res)).not.toMatch(/\b(BUY|SELL)\b/);
  });

  it("preserves lp_locked_pct as null (never coerces missing to 0) and flags LP_LOCK_UNKNOWN", () => {
    const rugWithoutLp: RugCheckSummary = { ...HEALTHY_RUG, lpLockedPct: null };
    const res = computeSolanaSafety(SOL_MINT, rugWithoutLp, HEALTHY_DEX);

    expect(res.security.lp_locked_pct).toBeNull();
    expect(res.flags).toContain("LP_LOCK_UNKNOWN");
    expect(res.flags).not.toContain("LOW_LP_LOCK");
    expect(res.risk_score).toBe(7);
  });

  it("scores CRITICAL and clamps to 100 on danger risks, low LP lock, thin liquidity, and drawdown", () => {
    const riskyRug: RugCheckSummary = {
      ...HEALTHY_RUG,
      scoreNormalised: 95,
      lpLockedPct: 10,
      risks: [
        { name: "Mint Authority", description: "Enabled", level: "danger", score: 2500 },
        { name: "Freeze Authority", description: "Enabled", level: "danger", score: 2500 },
        { name: "Mutable Metadata", description: "Mutable", level: "warn", score: 500 },
      ],
    };
    const riskyDex: DexScreenerAggregated = {
      ...HEALTHY_DEX,
      pairCount: 1,
      totalLiquidityUsd: 500,
      volume24hUsd: 60_000,
      priceChange24hPct: -82,
    };

    const res = computeSolanaSafety(SOL_MINT, riskyRug, riskyDex);
    expect(res.risk_score).toBe(100);
    expect(res.risk_tier).toBe("CRITICAL");
    expect(res.security.mint_authority_flagged).toBe(true);
    expect(res.security.freeze_authority_flagged).toBe(true);
    expect(res.security.mutable_metadata_flagged).toBe(true);
    expect(res.market.volume_to_liquidity_ratio).toBe(120);
    expect(res.flags).toEqual(
      expect.arrayContaining([
        "RUGCHECK_DANGER_RISKS",
        "RUGCHECK_WARN_RISKS",
        "LOW_OR_NO_LIQUIDITY",
        "LOW_LP_LOCK",
        "EXTREME_VOL_TO_LIQ_RATIO",
        "SEVERE_24H_DRAWDOWN",
      ])
    );
  });

  it("guards against zero liquidity division without NaN/Infinity", () => {
    const emptyDex: DexScreenerAggregated = {
      ...HEALTHY_DEX,
      pairCount: 0,
      totalLiquidityUsd: 0,
      volume24hUsd: 10_000,
    };
    const res = computeSolanaSafety(SOL_MINT, HEALTHY_RUG, emptyDex);
    expect(Number.isFinite(res.risk_score)).toBe(true);
    expect(res.flags).toContain("NO_DEX_LIQUIDITY");
    expect(res.flags).not.toContain("EXTREME_VOL_TO_LIQ_RATIO");
  });

  it("parses DEX Screener raw array and { pairs } shapes defensively", () => {
    const pair = {
      chainId: "solana",
      dexId: "orca",
      pairAddress: "pair1",
      baseToken: { address: SOL_MINT, symbol: "SOL", name: "Wrapped SOL" },
      priceUsd: "150.5",
      liquidity: { usd: 120_000 },
      volume: { h24: 500_000 },
      priceChange: { h24: -1.5 },
      fdv: 1_000_000,
    };

    const fromArray = aggregateDexScreenerPairs(SOL_MINT, [
      pair,
      { ...pair, chainId: "ethereum", liquidity: { usd: 999_999 } },
    ]);
    const fromObject = aggregateDexScreenerPairs(SOL_MINT, { pairs: [pair] });

    expect(fromArray.pairCount).toBe(1);
    expect(fromArray.totalLiquidityUsd).toBe(120_000);
    expect(fromObject.pairCount).toBe(1);
    expect(fromObject.primaryDex).toBe("orca");
  });

  it("parses RugCheck summary without coercing absent lpLockedPct to 0", () => {
    const parsed = parseRugCheckSummary(SOL_MINT, { score: 200, risks: [] });
    expect(parsed.lpLockedPct).toBeNull();
    expect(parsed.rawScore).toBe(200);
  });

  it("prefers baseToken pair for price/fdv and never attributes another token's price when mint is only quoteToken", () => {
    const memeAsBase = {
      chainId: "solana",
      dexId: "raydium",
      pairAddress: "meme-sol",
      baseToken: { address: "MemeMint11111111111111111111111111111111111", symbol: "MEME", name: "Meme" },
      quoteToken: { address: SOL_MINT, symbol: "SOL", name: "Wrapped SOL" },
      priceUsd: "0.0001",
      priceChange: { h24: -90 },
      fdv: 10_000,
      liquidity: { usd: 5_000_000 },
      volume: { h24: 10_000_000 },
    };
    const solAsBase = {
      chainId: "solana",
      dexId: "orca",
      pairAddress: "sol-usdc",
      baseToken: { address: SOL_MINT, symbol: "SOL", name: "Wrapped SOL" },
      quoteToken: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin" },
      priceUsd: "75.25",
      priceChange: { h24: 1.5 },
      fdv: 40_000_000_000,
      liquidity: { usd: 2_000_000 },
      volume: { h24: 5_000_000 },
    };

    const mixed = aggregateDexScreenerPairs(SOL_MINT, [memeAsBase, solAsBase]);
    expect(mixed.priceUsd).toBe(75.25);
    expect(mixed.priceChange24hPct).toBe(1.5);
    expect(mixed.symbol).toBe("SOL");
    expect(mixed.totalLiquidityUsd).toBe(7_000_000);

    const quoteOnly = aggregateDexScreenerPairs(SOL_MINT, [memeAsBase]);
    expect(quoteOnly.symbol).toBe("SOL");
    expect(quoteOnly.priceUsd).toBeNull();
    expect(quoteOnly.priceChange24hPct).toBeNull();
    expect(quoteOnly.fdvUsd).toBeNull();
  });

  it("does not apply LOW_LP_LOCK penalty to deep CLMM liquidity >= $1M while keeping lp_locked_pct faithful", () => {
    const deepClmmRug: RugCheckSummary = { ...HEALTHY_RUG, lpLockedPct: 0 };
    const deepRes = computeSolanaSafety(SOL_MINT, deepClmmRug, HEALTHY_DEX);
    expect(deepRes.security.lp_locked_pct).toBe(0);
    expect(deepRes.flags).not.toContain("LOW_LP_LOCK");

    const smallPoolDex: DexScreenerAggregated = { ...HEALTHY_DEX, totalLiquidityUsd: 25_000 };
    const smallRes = computeSolanaSafety(SOL_MINT, deepClmmRug, smallPoolDex);
    expect(smallRes.flags).toContain("LOW_LP_LOCK");
  });
});

describe("solanaSafetyHandler", () => {
  function buildApp(fetchImpl: typeof fetch, cache = new BoundedTtlCache()) {
    const app = new Hono<AppBindings>();
    app.get("/v1/solana/safety", createSolanaSafetyHandler({ cache, fetchImpl }));
    return app;
  }

  it("returns 400 on missing or invalid mint", async () => {
    const app = buildApp(async () => new Response("{}", { status: 200 }));
    const res = await app.request("/v1/solana/safety?mint=not-valid");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_MINT");
  });

  it("returns 502 (unsettled) with RUGCHECK_429 and never pretends token is safe", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("rugcheck")) {
        return new Response("Too many requests", { status: 429 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { upstream_error: string };
    expect(body.upstream_error).toBe("RUGCHECK_429");
  });

  it("returns 502 RUGCHECK_NOT_FOUND when RugCheck 404s but DEX Screener has pairs", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("rugcheck")) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(
        JSON.stringify([
          {
            chainId: "solana",
            dexId: "raydium",
            baseToken: { address: SOL_MINT, symbol: "SOL", name: "Wrapped SOL" },
            liquidity: { usd: 100_000 },
            volume: { h24: 200_000 },
          },
        ]),
        { status: 200 }
      );
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { upstream_error: string };
    expect(body.upstream_error).toBe("RUGCHECK_NOT_FOUND");
  });

  it("returns 404 when both RugCheck 404s and DEX Screener has 0 pairs", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("rugcheck")) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 and serves cached upstream data on repeat call", async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes("rugcheck")) {
        return new Response(
          JSON.stringify({ score: 50, score_normalised: 2, lpLockedPct: 95, risks: [] }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify([
          {
            chainId: "solana",
            dexId: "raydium",
            pairAddress: "pairA",
            baseToken: { address: SOL_MINT, symbol: "SOL", name: "Wrapped SOL" },
            priceUsd: "180.0",
            liquidity: { usd: 500_000 },
            volume: { h24: 1_000_000 },
          },
        ]),
        { status: 200 }
      );
    };

    const cache = new BoundedTtlCache();
    const app = buildApp(mockFetch, cache);

    const first = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(first.status).toBe(200);
    expect(calls).toBe(2);

    const second = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(second.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("falls back cleanly to GeckoTerminal when both DEX Screener endpoints return 429", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("rugcheck")) {
        return new Response(
          JSON.stringify({ score: 10, score_normalised: 2, lpLockedPct: 90, risks: [] }),
          { status: 200 }
        );
      }
      if (url.includes("dexscreener")) {
        return new Response("Rate limited", { status: 429 });
      }
      if (url.includes("geckoterminal")) {
        return new Response(
          JSON.stringify({
            data: {
              attributes: {
                symbol: "SOL",
                name: "Wrapped SOL",
                price_usd: "70.5",
                fdv_usd: "950000000",
                volume_usd: { h24: "120000000" },
              },
            },
            included: [
              {
                type: "pool",
                attributes: {
                  address: "pool1",
                  reserve_in_usd: "15000000",
                  volume_usd: { h24: "80000000" },
                  price_change_percentage: { h24: "2.1" },
                },
                relationships: { dex: { data: { id: "orca" } } },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("unexpected", { status: 500 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      symbol: string;
      market: { liquidity_usd: number; primary_dex: string };
      metadata: { sources: string[] };
    };
    expect(body.symbol).toBe("SOL");
    expect(body.market.liquidity_usd).toBe(15_000_000);
    expect(body.market.primary_dex).toBe("orca");
    expect(body.metadata.sources).toEqual(["rugcheck", "geckoterminal"]);
  });

  it("returns 502 DEXSCREENER_429 when DEX Screener and GeckoTerminal both fail", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("rugcheck")) {
        return new Response(JSON.stringify({ score: 10, risks: [] }), { status: 200 });
      }
      return new Response("Rate limited", { status: 429 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/solana/safety?mint=${SOL_MINT}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { upstream_error: string };
    expect(body.upstream_error).toBe("DEXSCREENER_429");
  });
});
