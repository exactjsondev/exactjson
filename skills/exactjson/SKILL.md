---
name: exactjson
description: ExactJSON — Live, deterministic x402 APIs for AI agents. Query 11 pay-per-call token safety, pre-trade execution slippage, perps funding/screener, prediction-market scanner & arb, Deribit options surface, and US macro liquidity endpoints via x402 V2 on Base Mainnet (USDC), Remote Streamable HTTP MCP (`https://exactjson.com/mcp`), or stdio MCP (`npx -y exactjson-mcp`).
---

# ExactJSON (`v1.1.0`) — Live, Deterministic x402 APIs for AI Agents

Use **ExactJSON** (`https://exactjson.com`) whenever an autonomous agent needs compact, deterministic, pre-computed JSON for pre-trade token safety checks, multi-tier execution slippage quotes, cross-venue arbitrage scanners, derivatives volatility briefs, or official US macro liquidity data via **x402 V2 on Base Mainnet (`eip155:8453`, USDC)** — zero API keys, zero subscriptions.

> **Disclaimer:** Informational market/security data only; not financial advice. Never present outputs as buy/sell recommendations.

## Native MCP Quickstart (12 Tools — Remote Streamable HTTP or Stdio)

- **Remote Streamable HTTP:** `https://exactjson.com/mcp` (x402 V2 `_meta["x402/payment"]` / `structuredContent` challenge flow)
- **Local Stdio:**

```json
{
  "mcpServers": {
    "exactjson": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_AGENT_WALLET_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    }
  }
}
```

Official MCP Registry ID: `io.github.exactjsondev/exactjson` (`exactjson-mcp@1.1.0`).

## Endpoints (11 Paid Resources — Base Mainnet USDC)

| Endpoint | Price (USDC) | Query Params | Best Used For |
| --- | --- | --- | --- |
| `GET /v1/evm/safety` | `$0.01` | `address` (req, `0x...`), `chain` (`base` default, `ethereum`, `arbitrum`, `optimism`, `polygon`, `bsc`) | Pre-swap honeypot simulation, buy/sell tax audit, GoPlus + Honeypot.is disagreement flags & DEX liquidity ratios |
| `GET /v1/execution/quote-check` | `$0.01` | `mode` (`perps`/`evm`, req), `coin`/`side` (perps) or `token_out`/`chain`/`token_in` (evm), `sizes_usd` | Multi-tier slippage (`$1k/$10k/$50k+`) via KyberSwap Aggregator or Hyperliquid L2, `max_size_under_100bps_usd`, and `liquidity_grade` |
| `GET /v1/solana/safety` | `$0.01` | `mint` (req, 32–44 Base58) | Deep-dive Solana SPL safety, RugCheck risk breakdown, authority booleans & liquidity/FDV ratios |
| `GET /v1/solana/trending` | `$0.015` | `limit` (1–8, opt), `max_risk_score` (0–100, opt) | Discovering trending Solana tokens already pre-screened with RugCheck safety & authority flags |
| `GET /v1/perps/snapshot` | `$0.005` | `coin` (req, e.g. `BTC`, `kPEPE`) | Checking single-coin Hyperliquid funding, basis, spread, depth imbalance & `$10k` L2 VWAP slippage |
| `GET /v1/perps/screener` | `$0.01` | `min_oi_usd` (opt), `limit` (1–25, opt) | Scanning all ~180+ Hyperliquid perps for funding extremes, basis dislocations & turnover |
| `GET /v1/perps/funding-arb` | `$0.015` | `min_oi_usd` (opt), `limit` (1–25, opt), `coin` (opt) | Comparing live annualized funding spreads across Hyperliquid, dYdX v4 & Kraken Futures |
| `GET /v1/predictions/arb` | `$0.02` | `min_spread_bps` (default `150`), `min_liquidity_usd` (`5000`), `query`, `limit` (`1-30`) | Matching overlapping Polymarket vs. Kalshi markets (72h expiry window) for fee-adjusted net edge (bps) & APY |
| `GET /v1/predictions/scanner` | `$0.01` | `venue` (`all`/`polymarket`/`kalshi`), `query` (opt), `min_volume_24h_usd` (opt), `limit` (1–25) | Scanning Polymarket + Kalshi implied probabilities, bid-ask spreads, topic search & high-conviction annualized carry |
| `GET /v1/options/surface` | `$0.015` | `currency` (`BTC` default, or `ETH`) | Deribit ATM IV term structure, contango/backwardation, OTM skew, put/call OI ratios, Max Pain & Call/Put OI walls |
| `GET /v1/macro/liquidity` | `$0.01` | `lookback_obs` (2–20, default 5) | Official US Treasury Debt + TGA cash flows, NY Fed ON RRP, EFFR/SOFR spread (bps) & net USD liquidity impulse (`-ΔTGA - ΔRRP`) |

*All endpoints live under `https://exactjson.com`.*

## Discovery & Health (Free)

- x402 Manifest: `GET https://exactjson.com/.well-known/x402` (alias: `/.well-known/x402.json`)
- RFC 9727 API Catalog: `GET https://exactjson.com/.well-known/api-catalog`
- MCP Server Card: `GET https://exactjson.com/.well-known/mcp/server-card.json`
- A2A Agent Card: `GET https://exactjson.com/.well-known/agent-card.json` (alias: `/.well-known/agent.json`)
- OpenAPI 3.1: `GET https://exactjson.com/openapi.json`
- Agent Guide: `GET https://exactjson.com/llms.txt`
- Health: `GET https://exactjson.com/health` (check `paused: false` before batch jobs)

## Recommended Agent Workflows

1. **Pre-Swap EVM/Base Guard (`$0.02`):** Call `/v1/evm/safety?address=<0x>&chain=base` (`$0.01`) + `/v1/execution/quote-check?mode=evm&chain=base&token_out=<0x>` (`$0.01`) before swapping an unfamiliar ERC-20 token.
2. **Pre-Swap Solana Guard (`$0.01`):** Call `/v1/solana/safety?mint=<MINT>` (`$0.01`), or scan RugCheck-verified trending pools via `/v1/solana/trending?limit=5&max_risk_score=40` (`$0.015`).
3. **Perps Discovery → Execution Check (`$0.005–$0.025`):** Scan `/v1/perps/funding-arb?limit=5` (`$0.015`) or `/v1/perps/screener?limit=10` (`$0.01`), then verify multi-tier L2 slippage via `/v1/execution/quote-check?mode=perps&coin=<COIN>` (`$0.01`) or fast check via `/v1/perps/snapshot?coin=<COIN>` (`$0.005`).
4. **Prediction Arbitrage & Carry (`$0.01–$0.02`):** Call `/v1/predictions/arb` (`$0.02`) for overlapping Polymarket vs. Kalshi mispricings (always verify settlement rules when `resolution_risk_warning: true`), or `/v1/predictions/scanner?query=fed` (`$0.01`) for topic research and carry.
5. **Macro + Volatility Regime Brief (`$0.025`):** Pair `/v1/macro/liquidity` (`$0.01`) with `/v1/options/surface?currency=BTC` (`$0.015`).
6. **Spend Control & Pay-Only-On-Success:** Always cap payments client-side (`maxAmountPerPayment: "$0.05"`). Only HTTP `200` settles; `400`/`404`/`502`/`503` never settle. Do not blindly retry invalid inputs or `502` upstream errors.
