---
name: exactjson
description: ExactJSON — Live, deterministic x402 APIs for AI agents. Query 23 pay-per-call endpoints across markets (token safety, slippage, perps, predictions, options, macro), security (OSS package audit, domain trust, CVE triage, cloud status, runtime EOL, AI model audit, censorship check), and world (airport delays, space weather GNSS, physical hazard briefs, travel advisories, solar/wind site windows) via x402 V2 on Base Mainnet (USDC), Remote Streamable HTTP MCP (`https://exactjson.com/mcp`, `/mcp/security`, `/mcp/world`, `/mcp/all`), or stdio MCP (`npx -y exactjson-mcp`).
---

# ExactJSON (`v1.3.0`) — Live, Deterministic x402 APIs for AI Agents

Use **ExactJSON** (`https://exactjson.com`) whenever an autonomous agent needs compact, deterministic, pre-computed JSON for pre-trade token safety, multi-tier slippage quotes, cross-venue arbitrage, options volatility, US macro liquidity, OSS supply-chain audits, domain phishing/RDAP trust, CVE KEV+EPSS triage, cloud outage gates, runtime EOL checks, AI model license/safetensors safety, country censorship checks, airport METAR/FAA delays, space weather GNSS/compass risk, physical hazard briefs, foreign travel advisories, or PV solar/wind dispatch windows via **x402 V2 on Base Mainnet (`eip155:8453`, USDC)** — zero API keys, zero subscriptions.

> **Disclaimer:** Informational market, security, and weather/hazard data only; not financial advice, legal audit, or sole life-safety/flight-navigation source.

## Native MCP Quickstart (Pack-Scoped `<= 15` Tools/Pack — Remote HTTP or Stdio)

- **Remote Streamable HTTP:** `https://exactjson.com/mcp` (`markets`, 12 tools), `https://exactjson.com/mcp/security` (`security`, 8 tools), `https://exactjson.com/mcp/world` (`world`, 6 tools), or `https://exactjson.com/mcp/all` (all 24 tools)
- **Local Stdio (`npx -y exactjson-mcp`, optional `--pack <markets|security|world|all>` or `EXACTJSON_PACK`):**

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

Official MCP Registry ID: `io.github.exactjsondev/exactjson` (`exactjson-mcp@1.3.0`).

## Endpoints (23 Paid Resources — Base Mainnet USDC)

### Markets Pack (`/mcp` / `--pack markets`)

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

### Security Pack (`/mcp/security` / `--pack security`)

| Endpoint | Price (USDC) | Query Params | Best Used For |
| --- | --- | --- | --- |
| `GET /v1/oss/package-audit` | `$0.01` | `package` (req), `ecosystem` (`npm`/`pypi`/`cargo`), `version` (opt) | Pre-install npm/PyPI/Cargo OSV vulnerability scan, OpenSSF Scorecard, package age (slopsquatting gate), SLSA & install hooks |
| `GET /v1/net/domain-trust` | `$0.01` | `domain` (req, e.g. `stripe.com`) | Cloudflare 1.1.1.2 malware sinkhole check, DNSSEC validation, SPF/DMARC spoofing posture & IANA RDAP registration age |
| `GET /v1/sec/cve-triage` | `$0.01` | `cve` (req, e.g. `CVE-2024-3094`) | Active exploitation urgency combining CISA KEV status, FIRST.org 30-day EPSS probability, CVSS & OSV fixed versions |
| `GET /v1/ops/cloud-status` | `$0.005` | `providers` (`all` default, or comma-separated `github,cloudflare,openai,anthropic,vercel,npm`) | Live outage & incident gate across 6 core developer/AI clouds before deploying or debugging phantom failures |
| `GET /v1/oss/runtime-eol` | `$0.005` | `product` (req, e.g. `nodejs`, `python`, `postgresql`), `cycle` (opt, e.g. `20`) | Deterministic End-of-Life (EOL), active support, LTS status, latest patch & recommended upgrade cycle |
| `GET /v1/ai/model-audit` | `$0.01` | `model` (req, e.g. `Qwen/Qwen2.5-7B-Instruct`) | Hugging Face commercial license check, safetensors vs unsafe pickle (`.bin`/`.pt`/`.pkl`) code-exec risk & `fp16`/`int8`/`int4` VRAM GB |
| `GET /v1/net/censorship-check` | `$0.01` | `domain` (req), `country` (req, ISO-2 e.g. `IR`), `days` (1–14, default 7) | Country-specific blocking & network anomaly detection via live OONI `web_connectivity` + global Cloudflare DoH |

### World Pack (`/mcp/world` / `--pack world`)

| Endpoint | Price (USDC) | Query Params | Best Used For |
| --- | --- | --- | --- |
| `GET /v1/aviation/airport-delays` | `$0.01` | `airport` (req, IATA e.g. `JFK`/`LHR` or ICAO e.g. `KJFK`/`EGLL`) | NOAA AviationWeather METAR/TAF/SIGMET flight category (`VFR`/`MVFR`/`IFR`/`LIFR`) + US FAA NAS Ground Stops & Closures |
| `GET /v1/space/weather-gnss` | `$0.01` | `lat` (opt, `-90..90`) | NOAA SWPC R/S/G scales, Kp forecast, solar wind `Bz` & CelesTrak `F10.7` flux -> RTK-GPS, drone compass, HF/SATCOM & LEO drag Go/No-Go |
| `GET /v1/geo/hazard-brief` | `$0.015` | `lat`+`lon`, `iata`, or US `address`, plus `radius_km` (25–500) & opt `zip` | Multi-agency physical hazard brief: UN/EU GDACS alerts, USGS seismic 30d, NASA EONET wildfires/storms, MET Norway & US EPA TRI |
| `GET /v1/travel/destination-brief` | `$0.01` | `country` (req, ISO-2/3 or name e.g. `JP`, `UA`, `Japan`) | GOV.UK FCDO foreign travel advisory compression (`95 KB -> ~1.5 KB`), active GDACS disasters & Nager.Date public holidays |
| `GET /v1/solar/site-window` | `$0.01` | `lat`+`lon` or `iata`, opt `date` (`YYYY-MM-DD`) & `max_wind_ms` (`1..25`) | NASA POWER PV irradiance climatology, 7-day MET Norway low-wind/dry drone or ag spray windows & exact UTC sunrise/civil twilight |

*All endpoints live under `https://exactjson.com`.*

## Discovery & Health (Free)

- x402 Manifest: `GET https://exactjson.com/.well-known/x402` (alias: `/.well-known/x402.json`)
- RFC 9727 API Catalog: `GET https://exactjson.com/.well-known/api-catalog`
- MCP Server Card: `GET https://exactjson.com/.well-known/mcp/server-card.json`
- A2A Agent Card: `GET https://exactjson.com/.well-known/agent-card.json` (alias: `/.well-known/agent.json`)
- OpenAPI 3.1: `GET https://exactjson.com/openapi.json`
- Agent Guide: `GET https://exactjson.com/llms.txt`
- Health: `GET https://exactjson.com/health` (check `paused: false` before batch jobs)
