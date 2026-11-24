# ExactJSON — Live, deterministic x402 APIs for AI agents

**Website & Docs:** https://exactjson.com · **MCP:** `npx -y exactjson-mcp` · **Contact:** hello@exactjson.com

**ExactJSON** serves pre-computed, strict-schema, token-optimized JSON endpoints for AI agents via **x402 V2** micro-payments on **Base Mainnet (`eip155:8453`, USDC)** — `$0.005–$0.02/call`, zero API keys, zero subscriptions, strict **Pay-Only-On-Success** settlement (`HTTP 200` only).

> **Disclaimer:** Informational market/security data only; not financial advice.

## Why ExactJSON

- **Cheaper than free raw APIs for LLM agents:** Pulling 600+ Deribit contracts or 180+ Hyperliquid assets raw into an LLM context costs `$0.02–$0.15` in input tokens and invites math hallucinations. ExactJSON returns one deterministic ~2 KB JSON payload.
- **Pay-Only-On-Success:** Unpaid probes return `402` with `PAYMENT-REQUIRED` terms. Invalid inputs (`400`/`404`), upstream outages (`502`), and operator pause (`503`) never settle payment.
- **Fail-Closed Security:** Missing primary security engines (GoPlus + Honeypot.is on EVM; RugCheck on Solana) return `502` instead of falsely marking a token safe.

## Live Endpoints (11 Paid Resources — Base Mainnet USDC)

| Category | Endpoint | Price (USDC) | What It Returns |
| --- | --- | --- | --- |
| Safety | `GET /v1/evm/safety` | `$0.01` | GoPlus + Honeypot.is dual-engine audit, disagreement flags, taxes & DEX liquidity (Base, ETH, Arb, OP, Polygon, BSC) |
| Execution | `GET /v1/execution/quote-check` | `$0.01` | Multi-tier `$1k/$10k/$50k+` slippage ladder (KyberSwap EVM or Hyperliquid L2), `max_size_under_100bps_usd`, `liquidity_grade` |
| Safety | `GET /v1/solana/safety` | `$0.01` | RugCheck 0–100 risk score, authority booleans, LP lock & liquidity/FDV ratios |
| Discovery | `GET /v1/solana/trending` | `$0.015` | Trending Solana pools pre-screened in parallel with RugCheck safety flags |
| Perps | `GET /v1/perps/snapshot` | `$0.005` | Single-coin Hyperliquid funding, basis, spread, depth imbalance & `$10k` L2 VWAP slippage |
| Perps | `GET /v1/perps/screener` | `$0.01` | Full ~180+ Hyperliquid perp scan for extreme funding APRs, basis dislocations & turnover |
| Perps | `GET /v1/perps/funding-arb` | `$0.015` | 3-venue annualized funding spreads (Hyperliquid, dYdX v4, Kraken Futures) with bottleneck leg OI |
| Predictions | `GET /v1/predictions/arb` | `$0.02` | Polymarket vs. Kalshi 72h-window arbitrage detector with fee-adjusted net edge & `resolution_risk_warning` |
| Predictions | `GET /v1/predictions/scanner` | `$0.01` | Polymarket + Kalshi implied probabilities, bid-ask spreads, keyword search & annualized carry |
| Options | `GET /v1/options/surface` | `$0.015` | Deribit BTC/ETH ATM IV term structure, contango/backwardation, OTM skew, Max Pain & OI walls |
| Macro | `GET /v1/macro/liquidity` | `$0.01` | Official US Treasury Debt + TGA flows, NY Fed ON RRP, EFFR/SOFR spread & net USD liquidity impulse |

## Native MCP Quickstart (12 Tools)

```json
{
  "mcpServers": {
    "exactjson": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_BASE_WALLET_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    }
  }
}
```

Official MCP Registry ID: `io.github.exactjsondev/exactjson`.

## Machine Discovery (Free, 0ms x402 Overhead)

- `GET https://exactjson.com/` (`Accept: text/html` for docs; `Accept: application/json` for JSON index, `Vary: Accept`)
- `GET https://exactjson.com/.well-known/x402` (alias: `/.well-known/x402.json`)
- `GET https://exactjson.com/.well-known/api-catalog` (RFC 9727)
- `GET https://exactjson.com/.well-known/mcp/server-card.json`
- `GET https://exactjson.com/.well-known/agent-card.json` (alias: `/.well-known/agent.json`)
- `GET https://exactjson.com/openapi.json`
- `GET https://exactjson.com/llms.txt`
- `GET https://exactjson.com/sitemap.xml`
- `GET https://exactjson.com/health`

## Local Development

```powershell
npm install
npx tsc --noEmit
npm test
npm run dev
```

## License

MIT
