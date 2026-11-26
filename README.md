# ExactJSON — Live, deterministic x402 APIs for AI agents

[![CI](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml/badge.svg)](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/exactjson-mcp)](https://www.npmjs.com/package/exactjson-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/exactjsondev/exactjson/blob/main/LICENSE)
[![ExactJSON MCP server](https://glama.ai/mcp/servers/exactjsondev/exactjson/badge)](https://glama.ai/mcp/servers/exactjsondev/exactjson)

**Website:** https://exactjson.com ([Docs](https://exactjson.com/docs) · [Pricing](https://exactjson.com/pricing)) · **Remote MCP:** `https://exactjson.com/mcp` · **Security MCP:** `https://exactjson.com/mcp/security` · **Stdio MCP:** `npx -y exactjson-mcp` · **x402scan:** [Listing](https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc) · **Security:** [SECURITY.md](SECURITY.md) · **Contact:** hello@exactjson.com

**ExactJSON** (`v1.2.0`) serves **18 pre-computed, strict-schema, token-optimized JSON endpoints** for AI agents via **x402 V2** micro-payments on **Base Mainnet (`eip155:8453`, USDC)** — `$0.005–$0.02/call`, zero API keys, zero subscriptions, strict **Pay-Only-On-Success** settlement (`HTTP 200` only).

> **Disclaimer:** Informational market/security data only; not financial advice or a substitute for full code/legal review.

## Why ExactJSON

- **Cheaper than free raw APIs for LLM agents:** Pulling 600+ Deribit contracts, 180+ Hyperliquid assets, or 430 KB registry packuments raw into an LLM context costs `$0.02–$0.15` in input tokens and invites math hallucinations. ExactJSON returns one deterministic ~2 KB JSON payload.
- **Pay-Only-On-Success:** Unpaid probes return `402` with `PAYMENT-REQUIRED` terms. Invalid inputs (`400`/`404`), upstream outages (`502`), and operator pause (`503`) never settle payment.
- **Fail-Closed Security:** Missing primary security engines (GoPlus + Honeypot.is on EVM; RugCheck on Solana; OSV/deps.dev/CISA KEV/Cloudflare 1.1.1.2 on Security) return `502` instead of falsely marking a target safe.

## Live Endpoints (18 Paid Resources — Base Mainnet USDC)

### Markets Pack (`/mcp` / `--pack markets` — 11 Paid Tools)

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

### Security Pack (`/mcp/security` / `--pack security` — 7 Paid Tools)

| Category | Endpoint | Price (USDC) | What It Returns |
| --- | --- | --- | --- |
| Supply Chain | `GET /v1/oss/package-audit` | `$0.01` | Pre-install npm/PyPI/Cargo OSV vulns, OpenSSF Scorecard, package age (slopsquatting gate), SLSA & install hooks |
| Network | `GET /v1/net/domain-trust` | `$0.01` | Cloudflare 1.1.1.2 malware sinkhole check, DNSSEC validation, SPF/DMARC spoofing posture & IANA RDAP age |
| AppSec | `GET /v1/sec/cve-triage` | `$0.01` | Active exploitation urgency combining CISA KEV status, FIRST.org 30d EPSS probability, CVSS & OSV fixed versions |
| Cloud Ops | `GET /v1/ops/cloud-status` | `$0.005` | Live incident & degraded-component gate across GitHub, Cloudflare, OpenAI, Anthropic, Vercel & npm |
| Compliance | `GET /v1/oss/runtime-eol` | `$0.005` | Deterministic End-of-Life (EOL), LTS status, latest patch & recommended upgrade cycle across 350+ runtimes/OSes |
| MLOps | `GET /v1/ai/model-audit` | `$0.01` | Hugging Face commercial license check, safetensors vs pickle code-exec flags & `fp16`/`int8`/`int4` VRAM sizing |
| Reachability | `GET /v1/net/censorship-check` | `$0.01` | Country-specific blocking & network anomaly detection via live OONI `web_connectivity` + global Cloudflare DoH |

## Native MCP Quickstart (Pack-Scoped `<= 15` Tools/Pack)

- **Remote Streamable HTTP:** `https://exactjson.com/mcp` (`markets`), `https://exactjson.com/mcp/security` (`security`), or `https://exactjson.com/mcp/all` (`all`)
- **Local Stdio (`exactjson-mcp@1.2.0`):**

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
npm run verify
npm run dev
```

## License

MIT
