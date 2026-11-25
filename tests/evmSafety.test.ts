import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../src/config/catalog";
import { BoundedTtlCache } from "../src/lib/cache";
import { UpstreamError } from "../src/lib/http";
import { EVM_CHAINS, parseEvmAddress, parseEvmChain } from "../src/lib/validation";
import {
  aggregateDexScreenerEvmPairs,
  parseGeckoTerminalToken,
} from "../src/providers/dexscreener";
import { parseGoPlusTokenSecurity } from "../src/providers/goplus";
import { parseHoneypotIsResult } from "../src/providers/honeypotIs";
import { createEvmSafetyHandler } from "../src/routes/evmSafety";
import { computeEvmSafety } from "../src/services/evmSafetyScoring";
import type {
  AppBindings,
  DexScreenerAggregated,
  GoPlusTokenSecurity,
  HoneypotIsResult,
} from "../src/types";

const BASE_WETH_CHECKSUM = "0x4200000000000000000000000000000000000006";
const BASE_USDC_CHECKSUM = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDC_LOWER = BASE_USDC_CHECKSUM.toLowerCase();

const CLEAN_GOPLUS: GoPlusTokenSecurity = {
  address: BASE_WETH_CHECKSUM,
  chainId: 8453,
  tokenName: "Wrapped Ether",
  tokenSymbol: "WETH",
  isHoneypot: false,
  isOpenSource: true,
  isProxy: false,
  isMintable: false,
  ownerChangeBalance: false,
  hiddenOwner: false,
  canTakeBackOwnership: false,
  selfdestruct: false,
  cannotBuy: false,
  cannotSellAll: false,
  transferPausable: false,
  isBlacklisted: false,
  slippageModifiable: false,
  ownerRenounced: true,
  buyTaxPct: 0,
  sellTaxPct: 0,
  holderCount: 250_000,
  top10HolderPct: 8.5,
  lpLockedPct: 95,
};

const CLEAN_HONEYPOT: HoneypotIsResult = {
  address: BASE_WETH_CHECKSUM,
  chainId: 8453,
  tokenName: "Wrapped Ether",
  tokenSymbol: "WETH",
  simulationSuccess: true,
  simulationError: null,
  isHoneypot: false,
  honeypotReason: null,
  buyTaxPct: 0,
  sellTaxPct: 0,
  transferTaxPct: 0,
  openSource: true,
  isProxy: false,
  holderCount: 250_000,
};

const HEALTHY_EVM_DEX: DexScreenerAggregated = {
  pairCount: 20,
  totalLiquidityUsd: 45_000_000,
  volume24hUsd: 120_000_000,
  priceUsd: 3_250.5,
  priceChange24hPct: 2.4,
  fdvUsd: 390_000_000_000,
  primaryDex: "aerodrome",
  primaryPairAddress: "0x1111111111111111111111111111111111111111",
  symbol: "WETH",
  name: "Wrapped Ether",
  earliestPairCreatedAt: "2024-01-01T00:00:00.000Z",
};

describe("EVM validation helpers", () => {
  it("validates and normalizes EVM addresses to lowercase", () => {
    const valid = parseEvmAddress(`  ${BASE_USDC_CHECKSUM}  `);
    expect(valid).toEqual({ ok: true, value: BASE_USDC_LOWER });

    expect(parseEvmAddress(undefined).ok).toBe(false);
    expect(parseEvmAddress("0x1234").ok).toBe(false);
    expect(parseEvmAddress("So11111111111111111111111111111111111111112").ok).toBe(false);
    expect(parseEvmAddress(`0x${"g".repeat(40)}`).ok).toBe(false);
  });

  it("defaults chain to base and resolves canonical names and aliases", () => {
    const def = parseEvmChain(undefined);
    expect(def.ok && def.value.key).toBe("base");

    const eth = parseEvmChain("ETH");
    expect(eth.ok && eth.value.key).toBe("ethereum");
    expect(eth.ok && eth.value.geckoTerminalId).toBe("eth");

    const poly = parseEvmChain("137");
    expect(poly.ok && poly.value.key).toBe("polygon");
    expect(poly.ok && poly.value.geckoTerminalId).toBe("polygon_pos");

    const arb = parseEvmChain("arbitrum");
    expect(arb.ok && arb.value.honeypotSupported).toBe(false);

    const bad = parseEvmChain("solana");
    expect(bad.ok).toBe(false);

    // Prototype keys must never resolve on EVM_CHAIN_ALIASES
    expect(parseEvmChain("constructor").ok).toBe(false);
    expect(parseEvmChain("toString").ok).toBe(false);
    expect(parseEvmChain("valueOf").ok).toBe(false);
  });
});

describe("EVM provider parsers", () => {
  it("parses GoPlus decimal taxes, non-contract top10 holders, and locked/burn LP %", () => {
    const parsed = parseGoPlusTokenSecurity(8453, BASE_USDC_LOWER, {
      code: 1,
      message: "OK",
      result: {
        // Test case-insensitive key lookup
        [BASE_USDC_CHECKSUM]: {
          token_name: "USD Coin",
          token_symbol: "USDC",
          is_honeypot: "0",
          is_open_source: "1",
          is_proxy: "1",
          is_mintable: "1",
          buy_tax: "0.025",
          sell_tax: "0.05",
          holder_count: "150000",
          owner_address: "0x0000000000000000000000000000000000000000",
          holders: [
            { address: "0x000000000000000000000000000000000000dead", percent: "0.40", is_locked: 0, is_contract: 0 },
            { address: "0x2222222222222222222222222222222222222222", percent: "0.30", is_locked: 0, is_contract: 1 },
            { address: "0x3333333333333333333333333333333333333333", percent: "0.12", is_locked: 0, is_contract: 0 },
            { address: "0x4444444444444444444444444444444444444444", percent: "0.08", is_locked: 0, is_contract: 0 },
          ],
          lp_holders: [
            { address: "0x000000000000000000000000000000000000dead", percent: "0.60", is_locked: 0 },
            { address: "0x5555555555555555555555555555555555555555", percent: "0.25", is_locked: 1 },
            { address: "0x6666666666666666666666666666666666666666", percent: "0.15", is_locked: 0 },
          ],
        },
      },
    });

    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.data.buyTaxPct).toBe(2.5);
    expect(parsed.data.sellTaxPct).toBe(5);
    expect(parsed.data.ownerRenounced).toBe(true);
    expect(parsed.data.top10HolderPct).toBe(20); // Excludes dead burn + contract pool
    expect(parsed.data.lpLockedPct).toBe(85); // 60% burned + 25% locked
  });

  it("throws GOPLUS_429 when GoPlus returns HTTP 200 with rate-limit code", () => {
    expect(() =>
      parseGoPlusTokenSecurity(8453, BASE_USDC_LOWER, {
        code: 4029,
        message: "Rate limit exceeded",
      })
    ).toThrow(UpstreamError);
  });

  it("returns not_found when GoPlus result is empty and leaves empty owner_address as null (unknown)", () => {
    const parsed = parseGoPlusTokenSecurity(8453, BASE_USDC_LOWER, { code: 1, result: {} });
    expect(parsed.status).toBe("not_found");

    const unknownOwner = parseGoPlusTokenSecurity(8453, BASE_USDC_LOWER, {
      code: 1,
      result: {
        [BASE_USDC_LOWER]: {
          token_name: "RoleToken",
          token_symbol: "ROLE",
          owner_address: "",
          is_honeypot: "0",
        },
      },
    });
    expect(unknownOwner.status).toBe("ok");
    if (unknownOwner.status === "ok") {
      expect(unknownOwner.data.ownerRenounced).toBeNull();
    }
  });

  it("parses Honeypot.is v2 percentages without rescaling", () => {
    const parsed = parseHoneypotIsResult(8453, BASE_USDC_LOWER, {
      token: { name: "Test", symbol: "TST", totalHolders: 420 },
      simulationSuccess: true,
      honeypotResult: { isHoneypot: false },
      simulationResult: { buyTax: 3.5, sellTax: 12.25, transferTax: 0 },
      contractCode: { openSource: true, isProxy: false },
    });

    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.data.buyTaxPct).toBe(3.5);
    expect(parsed.data.sellTaxPct).toBe(12.25);
    expect(parsed.data.isHoneypot).toBe(false);
    expect(parsed.data.holderCount).toBe(420);
  });

  it("matches checksummed EVM addresses case-insensitively and filters target chain", () => {
    const agg = aggregateDexScreenerEvmPairs(BASE_USDC_LOWER, "base", [
      {
        chainId: "ethereum",
        dexId: "uniswap",
        baseToken: { address: BASE_USDC_CHECKSUM, symbol: "USDC", name: "USD Coin" },
        liquidity: { usd: 999_999_999 },
        volume: { h24: 100_000_000 },
      },
      {
        chainId: "base",
        dexId: "aerodrome",
        pairAddress: "0xpair1",
        pairCreatedAt: 1_710_000_000_000,
        baseToken: { address: BASE_USDC_CHECKSUM, symbol: "USDC", name: "USD Coin" },
        priceUsd: "1.0001",
        liquidity: { usd: 12_000_000 },
        volume: { h24: 50_000_000 },
        priceChange: { h24: 0.01 },
        fdv: 3_000_000_000,
      },
    ]);

    expect(agg.pairCount).toBe(1);
    expect(agg.totalLiquidityUsd).toBe(12_000_000);
    expect(agg.priceUsd).toBe(1.0001);
    expect(agg.earliestPairCreatedAt).toBe(new Date(1_710_000_000_000).toISOString());

    // GeckoTerminal fallback preserves sub-1e-8 micro-cap prices without truncating to 0 and rejects negative prices
    const microGecko = parseGeckoTerminalToken({
      data: { attributes: { symbol: "MICRO", name: "Micro", price_usd: "0.0000000042", fdv_usd: "-100" } },
      included: [],
    });
    expect(microGecko.priceUsd).toBeCloseTo(4.2e-9, 12);
    expect(microGecko.fdvUsd).toBeNull();

    // Transfer tax trap (0% buy/sell, 99% transfer tax) scores EXTREME_TAX
    const transferTrap = computeEvmSafety(
      BASE_WETH_CHECKSUM,
      EVM_CHAINS.base,
      CLEAN_GOPLUS,
      { ...CLEAN_HONEYPOT, transferTaxPct: 99 },
      HEALTHY_EVM_DEX,
      { fetchedAtIso: "2026-11-22T00:00:00.000Z" }
    );
    expect(transferTrap.flags).toContain("EXTREME_TAX");
    expect(transferTrap.risk_score).toBeGreaterThanOrEqual(45);
  });
});

describe("evmSafetyScoring", () => {
  it("computes LOW risk (score 0) for clean deep-liquidity EVM token with no BUY/SELL advice", () => {
    const res = computeEvmSafety(
      BASE_WETH_CHECKSUM,
      EVM_CHAINS.base,
      CLEAN_GOPLUS,
      CLEAN_HONEYPOT,
      HEALTHY_EVM_DEX,
      { fetchedAtIso: "2026-11-22T00:00:00.000Z" }
    );

    expect(res.risk_score).toBe(0);
    expect(res.risk_tier).toBe("LOW");
    expect(res.flags).toEqual([]);
    expect(res.security.is_honeypot).toBe(false);
    expect(res.security.engine_disagreement).toBe(false);
    expect(res.metadata.sources).toEqual(["goplus", "honeypot_is", "dexscreener"]);
    expect(res.metadata.disclaimer).toBe(DISCLAIMER);
    expect(JSON.stringify(res)).not.toMatch(/\b(BUY|SELL)\b/);
  });

  it("flags ENGINE_DISAGREEMENT and scores CRITICAL when GoPlus and Honeypot.is conflict", () => {
    const trapHoneypot: HoneypotIsResult = {
      ...CLEAN_HONEYPOT,
      isHoneypot: true,
      sellTaxPct: 100,
    };

    const res = computeEvmSafety(
      BASE_WETH_CHECKSUM,
      EVM_CHAINS.base,
      CLEAN_GOPLUS,
      trapHoneypot,
      HEALTHY_EVM_DEX,
      { fetchedAtIso: "2026-11-22T00:00:00.000Z" }
    );

    expect(res.security.engine_disagreement).toBe(true);
    expect(res.security.is_honeypot).toBe(true);
    expect(res.risk_tier).toBe("CRITICAL");
    expect(res.risk_score).toBe(100);
    expect(res.flags).toEqual(
      expect.arrayContaining(["ENGINE_DISAGREEMENT", "HONEYPOT_DETECTED", "EXTREME_TAX"])
    );
  });

  it("scores centralized stablecoin privileges as MODERATE without false CRITICAL", () => {
    const usdcGoPlus: GoPlusTokenSecurity = {
      ...CLEAN_GOPLUS,
      address: BASE_USDC_LOWER,
      tokenSymbol: "USDC",
      tokenName: "USD Coin",
      isProxy: true,
      isMintable: true,
      transferPausable: true,
      isBlacklisted: true,
      lpLockedPct: null,
    };

    const res = computeEvmSafety(
      BASE_USDC_LOWER,
      EVM_CHAINS.base,
      usdcGoPlus,
      { ...CLEAN_HONEYPOT, isProxy: true },
      HEALTHY_EVM_DEX,
      { fetchedAtIso: "2026-11-22T00:00:00.000Z" }
    );

    expect(res.risk_score).toBe(40);
    expect(res.risk_tier).toBe("MODERATE");
    expect(res.security.lp_locked_pct).toBeNull();
    expect(res.flags).not.toContain("LP_LOCK_UNKNOWN"); // Deep liquidity >= $1M exemption
    expect(res.flags).toEqual(
      expect.arrayContaining([
        "PROXY_UPGRADEABLE",
        "MINTABLE_TOKEN",
        "TRANSFER_PAUSABLE",
        "BLACKLIST_ENABLED",
      ])
    );
  });

  it("guards zero liquidity division, flags new pairs < 24h, and adds SINGLE_SECURITY_ENGINE on degraded Base", () => {
    const zeroLiqDex: DexScreenerAggregated = {
      ...HEALTHY_EVM_DEX,
      pairCount: 0,
      totalLiquidityUsd: 0,
      volume24hUsd: 25_000,
      earliestPairCreatedAt: "2026-11-21T20:00:00.000Z",
    };

    const res = computeEvmSafety(
      BASE_WETH_CHECKSUM,
      EVM_CHAINS.base,
      { ...CLEAN_GOPLUS, lpLockedPct: null },
      null,
      zeroLiqDex,
      {
        fetchedAtIso: "2026-11-22T00:00:00.000Z",
        goplusStatus: "ok",
        honeypotStatus: "unavailable",
      }
    );

    expect(Number.isFinite(res.risk_score)).toBe(true);
    expect(res.market.pair_age_hours).toBe(4);
    expect(res.flags).toEqual(
      expect.arrayContaining([
        "NO_DEX_LIQUIDITY",
        "LP_LOCK_UNKNOWN",
        "NEW_PAIR_UNDER_24H",
        "SINGLE_SECURITY_ENGINE",
      ])
    );
    expect(res.flags).not.toContain("EXTREME_VOL_TO_LIQ_RATIO");
  });
});

describe("evmSafetyHandler", () => {
  function buildApp(fetchImpl: typeof fetch, cache = new BoundedTtlCache()) {
    const app = new Hono<AppBindings>();
    app.get("/v1/evm/safety", createEvmSafetyHandler({ cache, fetchImpl }));
    return app;
  }

  it("returns 400 on invalid address or unsupported chain", async () => {
    const app = buildApp(async () => new Response("{}", { status: 200 }));

    const badAddr = await app.request("/v1/evm/safety?address=not-an-evm-addr");
    expect(badAddr.status).toBe(400);
    expect(((await badAddr.json()) as { error: string }).error).toBe("INVALID_ADDRESS");

    const badChain = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}&chain=fantom`);
    expect(badChain.status).toBe(400);
    expect(((await badChain.json()) as { error: string }).error).toBe("INVALID_CHAIN");

    const protoChain = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}&chain=constructor`);
    expect(protoChain.status).toBe(400);
    expect(((await protoChain.json()) as { error: string }).error).toBe("INVALID_CHAIN");
  });

  it("fails closed with 502 when both GoPlus and Honeypot.is fail on Base", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("gopluslabs")) return new Response("Rate limit", { status: 429 });
      if (url.includes("honeypot.is")) return new Response("Server error", { status: 503 });
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}&chain=base`);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { upstream_error: string }).upstream_error).toBe("GOPLUS_429");
  });

  it("fails closed with 502 when GoPlus fails on Arbitrum (single-engine chain)", async () => {
    const calledUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes("gopluslabs")) return new Response("Error", { status: 502 });
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}&chain=arbitrum`);
    expect(res.status).toBe(502);
    expect(calledUrls.some((u) => u.includes("honeypot.is"))).toBe(false);
  });

  it("degrades cleanly to 200 with SINGLE_SECURITY_ENGINE when Honeypot.is 429s but GoPlus succeeds", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("gopluslabs")) {
        return new Response(
          JSON.stringify({
            code: 1,
            result: {
              [BASE_WETH_CHECKSUM]: {
                token_name: "Wrapped Ether",
                token_symbol: "WETH",
                is_honeypot: "0",
                is_open_source: "1",
                buy_tax: "0",
                sell_tax: "0",
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("honeypot.is")) return new Response("Too many requests", { status: 429 });
      return new Response(
        JSON.stringify([
          {
            chainId: "base",
            dexId: "aerodrome",
            baseToken: { address: BASE_WETH_CHECKSUM, symbol: "WETH", name: "Wrapped Ether" },
            priceUsd: "3200",
            liquidity: { usd: 5_000_000 },
            volume: { h24: 10_000_000 },
          },
        ]),
        { status: 200 }
      );
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      flags: string[];
      security: { engines: { goplus: string; honeypot_is: string } };
      metadata: { sources: string[] };
    };
    expect(body.flags).toContain("SINGLE_SECURITY_ENGINE");
    expect(body.security.engines).toEqual({ goplus: "ok", honeypot_is: "unavailable" });
    expect(body.metadata.sources).toEqual(["goplus", "dexscreener"]);
  });

  it("returns 404 when security engines return not_found and DEX has 0 pairs", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("gopluslabs")) return new Response(JSON.stringify({ code: 1, result: {} }), { status: 200 });
      if (url.includes("honeypot.is")) return new Response("Not found", { status: 404 });
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("TOKEN_NOT_FOUND");
  });

  it("returns 502 EVM_SECURITY_NOT_FOUND when security engines return not_found but DEX has active pairs", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("gopluslabs")) return new Response(JSON.stringify({ code: 1, result: {} }), { status: 200 });
      if (url.includes("honeypot.is")) return new Response("Not found", { status: 404 });
      return new Response(
        JSON.stringify([
          {
            chainId: "base",
            dexId: "uniswap",
            baseToken: { address: BASE_WETH_CHECKSUM, symbol: "WETH", name: "Wrapped Ether" },
            liquidity: { usd: 250_000 },
            volume: { h24: 500_000 },
          },
        ]),
        { status: 200 }
      );
    };

    const app = buildApp(mockFetch);
    const res = await app.request(`/v1/evm/safety?address=${BASE_WETH_CHECKSUM}`);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { upstream_error: string }).upstream_error).toBe(
      "EVM_SECURITY_NOT_FOUND"
    );
  });

  it("caches repeat calls and falls back to GeckoTerminal when DEX Screener 429s", async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes("gopluslabs")) {
        return new Response(
          JSON.stringify({
            code: 1,
            result: {
              [BASE_USDC_LOWER]: {
                token_name: "USD Coin",
                token_symbol: "USDC",
                is_honeypot: "0",
                is_open_source: "1",
                buy_tax: "0",
                sell_tax: "0",
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("honeypot.is")) {
        return new Response(
          JSON.stringify({
            simulationSuccess: true,
            honeypotResult: { isHoneypot: false },
            simulationResult: { buyTax: 0, sellTax: 0, transferTax: 0 },
            contractCode: { openSource: true, isProxy: false },
          }),
          { status: 200 }
        );
      }
      if (url.includes("dexscreener")) {
        return new Response("Rate limited", { status: 429 });
      }
      if (url.includes("geckoterminal.com/api/v2/networks/eth/tokens")) {
        return new Response(
          JSON.stringify({
            data: {
              attributes: {
                symbol: "USDC",
                name: "USD Coin",
                price_usd: "1.0",
                fdv_usd: "30000000000",
                volume_usd: { h24: "500000000" },
              },
            },
            included: [
              {
                type: "pool",
                attributes: {
                  address: "0xpool1",
                  pool_created_at: "2023-01-01T00:00:00Z",
                  reserve_in_usd: "80000000",
                  volume_usd: { h24: "200000000" },
                  price_change_percentage: { h24: "0.01" },
                },
                relationships: { dex: { data: { id: "uniswap_v3" } } },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("unexpected", { status: 500 });
    };

    const cache = new BoundedTtlCache();
    const app = buildApp(mockFetch, cache);

    const first = await app.request(`/v1/evm/safety?address=${BASE_USDC_CHECKSUM}&chain=ethereum`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      chain: string;
      chain_id: number;
      market: { liquidity_usd: number; primary_dex: string };
      metadata: { sources: string[] };
    };
    expect(firstBody.chain).toBe("ethereum");
    expect(firstBody.chain_id).toBe(1);
    expect(firstBody.market.liquidity_usd).toBe(80_000_000);
    expect(firstBody.market.primary_dex).toBe("uniswap_v3");
    expect(firstBody.metadata.sources).toEqual(["goplus", "honeypot_is", "geckoterminal"]);
    expect(calls).toBe(5); // GoPlus + Honeypot.is + 2x DEX Screener 429 + 1x GeckoTerminal

    const second = await app.request(`/v1/evm/safety?address=${BASE_USDC_LOWER}&chain=eth`);
    expect(second.status).toBe(200);
    expect(calls).toBe(5); // All 3 served from cache
  });
});
