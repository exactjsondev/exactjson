#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE_URL = (process.env.EXACTJSON_BASE_URL?.trim() || "https://exactjson.com").replace(
  /\/+$/,
  ""
);
const MAX_PAYMENT = process.env.MAX_PAYMENT_USD?.trim() || "$0.05";
const REQUEST_TIMEOUT_MS = 20_000;

let paidFetchCache = null;

function getPaidFetch() {
  if (paidFetchCache) return paidFetchCache;
  const rawKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!rawKey) {
    throw new Error(
      "BUYER_PRIVATE_KEY environment variable is required to call paid ExactJSON endpoints (Base USDC)."
    );
  }
  const normalizedKey = /^0x/i.test(rawKey) ? `0x${rawKey.slice(2)}` : `0x${rawKey}`;
  const account = privateKeyToAccount(normalizedKey);
  const client = new x402Client().setSpendControls({ maxAmountPerPayment: MAX_PAYMENT });
  registerExactEvmScheme(client, { signer: account });
  paidFetchCache = wrapFetchWithPayment(fetch, client);
  return paidFetchCache;
}

function buildUrl(path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim().length > 0) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function callPaidEndpoint(path, params = {}) {
  try {
    const fetchWithPay = getPaidFetch();
    const res = await fetchWithPay(buildUrl(path, params), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ExactJSON returned HTTP ${res.status} (unsettled): ${text}`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `ExactJSON request failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

const server = new McpServer(
  {
    name: "exactjson",
    version: "1.0.0",
  },
  {
    instructions: [
      "ExactJSON provides live, deterministic x402 V2 APIs for AI agents paid per call in Base USDC ($0.005-$0.02/call; exactjson_health is free).",
      "Pay-only-on-success: HTTP 400/404/502/503 responses are never settled. Do not blindly retry invalid inputs or 502 upstream errors.",
      "Recommended workflows: (1) Before swapping an unfamiliar EVM/Base token, call exactjson_evm_safety ($0.01) and exactjson_execution_quote_check with mode='evm' ($0.01). (2) Before buying a Solana SPL token, call exactjson_solana_safety ($0.01). (3) For Hyperliquid perps, use exactjson_perps_snapshot ($0.005) for a fast check or exactjson_execution_quote_check with mode='perps' ($0.01) for multi-tier slippage. (4) When using exactjson_predictions_arb ($0.02), always verify Polymarket vs Kalshi settlement rules whenever resolution_risk_warning is true.",
      "Informational market/security data only; not financial advice.",
    ].join(" "),
  }
);

server.tool(
  "exactjson_health",
  "Free: Check ExactJSON API availability, version, network (Base eip155:8453), and paused status before running paid workflows.",
  {},
  async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `ExactJSON /health returned HTTP ${res.status}: ${text}` }],
        };
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ExactJSON /health failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "exactjson_evm_safety",
  "Paid ($0.01 USDC): Check if an ERC-20 token on Base, Ethereum, Arbitrum, Optimism, Polygon, or BSC is a honeypot or high-tax rug before swapping (GoPlus + Honeypot.is + DEX Screener). Returns 0-100 risk_score, risk_tier, taxes, and flags.",
  {
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("EVM ERC-20 token contract address (0x...)"),
    chain: z.enum(["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc"]).optional().describe("EVM chain (default base)"),
  },
  async (args) => callPaidEndpoint("/v1/evm/safety", args)
);

server.tool(
  "exactjson_execution_quote_check",
  "Paid ($0.01 USDC): Simulate pre-trade slippage across USD size tiers ($1k/$10k/$50k+) before executing an EVM DEX swap (KyberSwap) or Hyperliquid perp order. Returns price_impact_bps, max_size_under_100bps_usd, and liquidity_grade (DEEP/ADEQUATE/THIN/ILLIQUID).",
  {
    mode: z.enum(["perps", "evm"]).describe("Execution venue mode: 'perps' or 'evm'"),
    coin: z.string().optional().describe("Required for mode=perps: Hyperliquid ticker (e.g., BTC, ETH, SOL)"),
    side: z.enum(["buy", "sell", "both"]).optional().describe("Optional for mode=perps (default both)"),
    chain: z.enum(["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc"]).optional().describe("Optional for mode=evm (default base)"),
    token_out: z.string().optional().describe("Required for mode=evm: destination ERC-20 address (0x...)"),
    token_in: z.string().optional().describe("Optional for mode=evm: source ERC-20 address (defaults to native USDC)"),
    token_in_decimals: z.number().int().min(0).max(18).optional().describe("Optional for mode=evm: decimals for custom token_in"),
    sizes_usd: z.string().optional().describe("Optional comma-separated USD tiers (e.g., '1000,10000,50000')"),
  },
  async (args) => callPaidEndpoint("/v1/execution/quote-check", args)
);

server.tool(
  "exactjson_solana_safety",
  "Paid ($0.01 USDC): Check if a Solana SPL token mint is a rug before swapping. Returns RugCheck 0-100 risk_score, risk_tier, mint/freeze/mutable authority flags, lp_locked_pct, and liquidity/FDV ratios.",
  {
    mint: z.string().min(32).max(44).describe("Base58 Solana SPL token mint address"),
  },
  async (args) => callPaidEndpoint("/v1/solana/safety", args)
);

server.tool(
  "exactjson_solana_trending",
  "Paid ($0.015 USDC): Discover live trending Solana pools already pre-screened in parallel with RugCheck safety scores and authority flags.",
  {
    limit: z.number().int().min(1).max(8).optional().describe("Number of tokens (1-8, default 5)"),
    max_risk_score: z.number().int().min(0).max(100).optional().describe("Optional RugCheck risk score ceiling (0-100)"),
  },
  async (args) => callPaidEndpoint("/v1/solana/trending", args)
);

server.tool(
  "exactjson_perps_snapshot",
  "Paid ($0.005 USDC): Fast pre-trade check for a single Hyperliquid perpetual: funding rate, mark/oracle basis, spread, L2 depth imbalance, and $10k VWAP slippage.",
  {
    coin: z.string().min(1).describe("Hyperliquid ticker symbol (e.g., BTC, ETH, SOL, kPEPE)"),
  },
  async (args) => callPaidEndpoint("/v1/perps/snapshot", args)
);

server.tool(
  "exactjson_perps_screener",
  "Paid ($0.01 USDC): Scan all ~180+ Hyperliquid perpetuals in one call to find extreme funding APRs, basis dislocations, market breadth, and top turnover.",
  {
    min_oi_usd: z.number().min(0).optional().describe("Minimum open interest USD (default 1000000)"),
    limit: z.number().int().min(1).max(25).optional().describe("Leaderboard size (1-25, default 10)"),
  },
  async (args) => callPaidEndpoint("/v1/perps/screener", args)
);

server.tool(
  "exactjson_perps_funding_arb",
  "Paid ($0.015 USDC): Find cross-venue perpetual funding arbitrage spreads across Hyperliquid, dYdX v4, and Kraken Futures with bottleneck leg OI.",
  {
    min_oi_usd: z.number().min(0).optional().describe("Minimum per-leg OI USD (default 100000)"),
    limit: z.number().int().min(1).max(25).optional().describe("Top spreads to return (1-25, default 10)"),
    coin: z.string().optional().describe("Optional base asset filter (e.g., BTC, ETH, SOL)"),
  },
  async (args) => callPaidEndpoint("/v1/perps/funding-arb", args)
);

server.tool(
  "exactjson_predictions_arb",
  "Paid ($0.02 USDC): Detect overlapping Polymarket vs Kalshi arbitrage spreads, fee-adjusted net edge (bps), and annualized APY. Always verify settlement rules when resolution_risk_warning is true.",
  {
    min_spread_bps: z.number().min(0).max(5000).optional().describe("Minimum net edge in bps (default 150)"),
    min_liquidity_usd: z.number().min(0).optional().describe("Minimum per-venue liquidity USD (default 5000)"),
    query: z.string().max(64).optional().describe("Optional keyword filter across matched market titles"),
    limit: z.number().int().min(1).max(30).optional().describe("Max opportunities to return (1-30, default 15)"),
  },
  async (args) => callPaidEndpoint("/v1/predictions/arb", args)
);

server.tool(
  "exactjson_predictions_scanner",
  "Paid ($0.01 USDC): Scan live Polymarket & Kalshi prediction markets for implied odds, spreads, topic search, volume/liquidity ratios, and high-conviction carry.",
  {
    venue: z.enum(["all", "polymarket", "kalshi"]).optional().describe("Venue filter (default all)"),
    query: z.string().max(64).optional().describe("Optional keyword search across market titles/categories"),
    min_volume_24h_usd: z.number().min(0).optional().describe("Minimum 24h volume USD"),
    limit: z.number().int().min(1).max(25).optional().describe("Leaderboard size (1-25, default 10)"),
  },
  async (args) => callPaidEndpoint("/v1/predictions/scanner", args)
);

server.tool(
  "exactjson_options_surface",
  "Paid ($0.015 USDC): Distill Deribit BTC or ETH options into ATM IV term structure, contango/backwardation, OTM put-call skew, Max Pain strike, and Call/Put OI walls.",
  {
    currency: z.enum(["BTC", "ETH"]).optional().describe("Underlying asset: BTC (default) or ETH"),
  },
  async (args) => callPaidEndpoint("/v1/options/surface", args)
);

server.tool(
  "exactjson_macro_liquidity",
  "Paid ($0.01 USDC): Measure USD macro liquidity regime from 5 official US Treasury & NY Fed feeds (public debt, TGA delta, ON RRP, SOFR/EFFR spread, net liquidity impulse).",
  {
    lookback_obs: z.number().int().min(2).max(20).optional().describe("Lookback business days for delta (2-20, default 5)"),
  },
  async (args) => callPaidEndpoint("/v1/macro/liquidity", args)
);

const transport = new StdioServerTransport();
await server.connect(transport);
