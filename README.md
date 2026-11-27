# ExactJSON — Live, deterministic x402 APIs for AI agents

[![CI](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml/badge.svg)](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/exactjson-mcp)](https://www.npmjs.com/package/exactjson-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/exactjsondev/exactjson/blob/main/LICENSE)
[![ExactJSON MCP server](https://glama.ai/mcp/servers/exactjsondev/exactjson/badge)](https://glama.ai/mcp/servers/exactjsondev/exactjson)

**Website:** https://exactjson.com ([Docs](https://exactjson.com/docs) · [Pricing](https://exactjson.com/pricing)) · **Remote MCP:** `https://exactjson.com/mcp` · **Security MCP:** `https://exactjson.com/mcp/security` · **World MCP:** `https://exactjson.com/mcp/world` · **Commerce MCP:** `https://exactjson.com/mcp/commerce` · **Research MCP:** `https://exactjson.com/mcp/research` · **Stdio MCP:** `npx -y exactjson-mcp` · **x402scan:** [Listing](https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc) · **Security:** [SECURITY.md](SECURITY.md) · **Contact:** hello@exactjson.com

**ExactJSON** (`v1.5.0`) serves **31 pre-computed, strict-schema, token-optimized JSON endpoints** across 5 vertical MCP packs for AI agents via **x402 V2** micro-payments on **Base Mainnet (`eip155:8453`, USDC)** — `$0.005–$0.02/call`, zero API keys, zero subscriptions, strict **Pay-Only-On-Success** settlement (`HTTP 200` only).

> **Disclaimer:** Informational market, security, weather/hazard, entity/compliance, and scientific/clinical metadata only; not financial, legal, tax, accounting, medical, or sole life-safety/flight-navigation advice.

## Why ExactJSON

- **Cheaper than free raw APIs for LLM agents:** Pulling 600+ Deribit contracts, 180+ Hyperliquid assets, 430 KB registry packuments, 555 KB GDACS/95 KB FCDO feeds, 313 KB CPSC / 160 KB SEC dumps, or 112 KB PubChem GHS / SDMX-JSON trees raw into an LLM context costs `$0.02–$0.15` in input tokens and invites math hallucinations. ExactJSON returns one deterministic ~2 KB JSON payload.
- **Pay-Only-On-Success:** Unpaid probes return `402` with `PAYMENT-REQUIRED` terms. Invalid inputs (`400`/`404`), upstream outages (`502`), and operator pause (`503`) never settle payment.
- **Fail-Closed Safety:** Missing primary engines (GoPlus + Honeypot.is on EVM; RugCheck on Solana; OSV/deps.dev/CISA KEV/Cloudflare 1.1.1.2 on Security; NOAA AWC/SWPC/GDACS/USGS/FCDO on World; EU VIES `MS_UNAVAILABLE`/GLEIF/CPSC/openFDA on Commerce; Crossref/DataCite/PubChem/ClinicalTrials.gov/BIS on Research & Global Macro) return `502` instead of falsely marking a target safe or valid.

## Live Endpoints (31 Paid Resources — Base Mainnet USDC)

### Markets Pack (`/mcp` / `--pack markets` — 12 Paid Tools)

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
| Global Macro | `GET /v1/macro/global-rates` | `$0.01` | 38-country BIS policy rates + ECB DFR/MRR/ESTR + Bank of Canada CORRA + NY Fed EFFR/SOFR hike/cut cycles & FX carry matrix |

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

### World Pack (`/mcp/world` / `--pack world` — 5 Paid Tools)

| Category | Endpoint | Price (USDC) | What It Returns |
| --- | --- | --- | --- |
| Aviation | `GET /v1/aviation/airport-delays` | `$0.01` | Global NOAA METAR/TAF/SIGMET flight category (`VFR`/`MVFR`/`IFR`/`LIFR`) + US FAA NAS Ground Stops & Closures |
| Space Weather | `GET /v1/space/weather-gnss` | `$0.01` | NOAA SWPC R/S/G scales, Kp forecast, solar wind `Bz` & CelesTrak `F10.7` flux -> RTK-GPS, compass & LEO drag gates |
| Hazards | `GET /v1/geo/hazard-brief` | `$0.015` | Worldwide site hazard brief combining UN/EU GDACS, USGS seismic, NASA EONET, MET Norway & US Census/EPA TRI |
| Travel | `GET /v1/travel/destination-brief` | `$0.01` | GOV.UK FCDO foreign travel advisory compression, active regional GDACS disasters & Nager.Date public holidays |
| Solar & Wind | `GET /v1/solar/site-window` | `$0.01` | NASA POWER PV irradiance climatology, 7-day MET Norway drone/ag low-wind windows & UTC sunrise/civil twilight |

### Commerce Pack (`/mcp/commerce` / `--pack commerce` — 4 Paid Tools)

| Category | Endpoint | Price (USDC) | What It Returns |
| --- | --- | --- | --- |
| Treasury | `GET /v1/commerce/settlement-window` | `$0.01` | Mutual `T+0`/`T+1`/`T+2` banking open dates (`Fri-Sat` vs `Sat-Sun` + Nager.Date), ISO 4217 minor units, SEPA/CLS rails & `p95` FX buffer |
| Invoice Fraud | `GET /v1/commerce/vat-verify` | `$0.01` | Live EU-27 + `XI` VIES VAT check (`502` fail-closed on `MS_UNAVAILABLE`), 90-country IBAN `MOD 97-10` + SEPA, GLEIF BIC lookup & country-mismatch flags |
| Corporate KYB | `GET /v1/entity/company-verify` | `$0.01` | GLEIF LEI status & direct/ultimate parents, Wikidata domain/ticker, SEC EDGAR submissions & USAspending federal awards |
| Product Safety | `GET /v1/consumer/safety-recall` | `$0.01` | US CPSC consumer product recalls + openFDA Class I–III food/drug/device enforcement with ongoing-status & injury severity ranking |

### Research Pack (`/mcp/research` / `--pack research` — 3 Paid Tools)

| Category | Endpoint | Price (USDC) | What It Returns |
| --- | --- | --- | --- |
| Citations | `GET /v1/science/citation-verify` | `$0.005` | Crossref Polite Pool + DataCite (arXiv/Zenodo) + Retraction Watch DOI existence, retraction/concern flags & swapped-DOI checks |
| Chemistry | `GET /v1/chem/hazard-profile` | `$0.01` | NIH PubChem properties + GHS hazard pictograms, H/P-codes, Signal word, CAS RN, CMR/flammability flags & NFPA 704 ratings |
| Clinical Trials | `GET /v1/bio/drug-trial-brief` | `$0.015` | ClinicalTrials.gov v2 active Phase 2/3 primary completion catalysts + NIH RxNav/RxNorm normalized ingredients & ATC classes |

## Native MCP Quickstart (Pack-Scoped `<= 15` Tools/Pack)

- **Remote Streamable HTTP:** `https://exactjson.com/mcp` (`markets`), `https://exactjson.com/mcp/security` (`security`), `https://exactjson.com/mcp/world` (`world`), `https://exactjson.com/mcp/commerce` (`commerce`), `https://exactjson.com/mcp/research` (`research`), or `https://exactjson.com/mcp/all` (`all`)
- **Local Stdio (`exactjson-mcp@1.5.0`):**

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
