# exactjson-mcp

[![CI](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml/badge.svg)](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/exactjson-mcp)](https://www.npmjs.com/package/exactjson-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/exactjsondev/exactjson/blob/main/LICENSE)
[![ExactJSON MCP server](https://glama.ai/mcp/servers/exactjsondev/exactjson/badge)](https://glama.ai/mcp/servers/exactjsondev/exactjson)

**ExactJSON — Live, deterministic x402 APIs for AI agents** (Model Context Protocol server).

Exposes **27 Base USDC pay-per-call endpoints + free `exactjson_health`** organized into focused vertical packs (`<= 15` tools per pack for zero-bloat LLM tool selection) with client-side spend caps (`MAX_PAYMENT_USD`) and Pay-Only-On-Success guarantees:

- **`markets` (default, 12 tools):** `https://exactjson.com/mcp` or `npx -y exactjson-mcp`
- **`security` (8 tools):** `https://exactjson.com/mcp/security` or `npx -y exactjson-mcp --pack security`
- **`world` (6 tools):** `https://exactjson.com/mcp/world` or `npx -y exactjson-mcp --pack world`
- **`commerce` (5 tools):** `https://exactjson.com/mcp/commerce` or `npx -y exactjson-mcp --pack commerce`
- **`all` (28 tools):** `https://exactjson.com/mcp/all` or `npx -y exactjson-mcp --pack all`

- **Website & Docs:** https://exactjson.com · https://exactjson.com/docs · https://exactjson.com/pricing
- **Official MCP Registry:** `io.github.exactjsondev/exactjson`
- **x402scan Listing:** https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc
- **Repository:** https://github.com/exactjsondev/exactjson
- **Contact:** hello@exactjson.com

## Quickstart (Remote Streamable HTTP or Stdio)

For x402-native MCP clients, connect directly to the stateless Remote Streamable HTTP endpoints (`https://exactjson.com/mcp`, `https://exactjson.com/mcp/security`, `https://exactjson.com/mcp/world`, `https://exactjson.com/mcp/commerce`, or `https://exactjson.com/mcp/all`).

For local desktop hosts (Claude Desktop / Cursor / OpenClaw):

```json
{
  "mcpServers": {
    "exactjson-markets": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_BASE_WALLET_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    },
    "exactjson-security": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp", "--pack", "security"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_BASE_WALLET_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    },
    "exactjson-world": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp", "--pack", "world"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_BASE_WALLET_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    },
    "exactjson-commerce": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp", "--pack", "commerce"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_BASE_WALLET_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BUYER_PRIVATE_KEY` | For paid tools | — | Dedicated low-balance Base EVM wallet private key (`0x...` or 64-char hex) holding USDC for paid x402 calls. |
| `MAX_PAYMENT_USD` | No | `$0.05` | Maximum USDC spend per call enforced client-side before signing. |
| `EXACTJSON_BASE_URL` | No | `https://exactjson.com` | Optional base URL override when self-hosting ExactJSON. |
| `EXACTJSON_PACK` | No | `markets` | Vertical tool pack filter (`markets`, `security`, `world`, `commerce`, comma-separated, or `all`; also available via `--pack`). |

## Security & Spend Controls

- **Local-only signing:** `BUYER_PRIVATE_KEY` never leaves your local `exactjson-mcp` process. EIP-3009 payment authorizations are signed client-side via `viem` + `@x402/fetch`; ExactJSON never custodies user funds.
- **Hard client-side cap:** `MAX_PAYMENT_USD` (default `$0.05`) enforces `maxAmountPerPayment` locally before any authorization is signed. Use a dedicated low-balance operational wallet.
- **Pay-Only-On-Success:** Unpaid probes (`402`), bad inputs (`400`/`404`), fail-closed upstream outages (`502`), and operator pauses (`503`) never settle payment.

## Tools (28 Total Across Active Packs)

| Pack | Tool | Price (USDC) | Endpoint |
| --- | --- | --- | --- |
| All | `exactjson_health` | Free | `GET /health` |
| `markets` | `exactjson_evm_safety` | `$0.01` | `GET /v1/evm/safety` |
| `markets` | `exactjson_execution_quote_check` | `$0.01` | `GET /v1/execution/quote-check` |
| `markets` | `exactjson_solana_safety` | `$0.01` | `GET /v1/solana/safety` |
| `markets` | `exactjson_solana_trending` | `$0.015` | `GET /v1/solana/trending` |
| `markets` | `exactjson_perps_snapshot` | `$0.005` | `GET /v1/perps/snapshot` |
| `markets` | `exactjson_perps_screener` | `$0.01` | `GET /v1/perps/screener` |
| `markets` | `exactjson_perps_funding_arb` | `$0.015` | `GET /v1/perps/funding-arb` |
| `markets` | `exactjson_predictions_arb` | `$0.02` | `GET /v1/predictions/arb` |
| `markets` | `exactjson_predictions_scanner` | `$0.01` | `GET /v1/predictions/scanner` |
| `markets` | `exactjson_options_surface` | `$0.015` | `GET /v1/options/surface` |
| `markets` | `exactjson_macro_liquidity` | `$0.01` | `GET /v1/macro/liquidity` |
| `security` | `exactjson_oss_package_audit` | `$0.01` | `GET /v1/oss/package-audit` |
| `security` | `exactjson_net_domain_trust` | `$0.01` | `GET /v1/net/domain-trust` |
| `security` | `exactjson_sec_cve_triage` | `$0.01` | `GET /v1/sec/cve-triage` |
| `security` | `exactjson_ops_cloud_status` | `$0.005` | `GET /v1/ops/cloud-status` |
| `security` | `exactjson_oss_runtime_eol` | `$0.005` | `GET /v1/oss/runtime-eol` |
| `security` | `exactjson_ai_model_audit` | `$0.01` | `GET /v1/ai/model-audit` |
| `security` | `exactjson_net_censorship_check` | `$0.01` | `GET /v1/net/censorship-check` |
| `world` | `exactjson_aviation_airport_delays` | `$0.01` | `GET /v1/aviation/airport-delays` |
| `world` | `exactjson_space_weather_gnss` | `$0.01` | `GET /v1/space/weather-gnss` |
| `world` | `exactjson_geo_hazard_brief` | `$0.015` | `GET /v1/geo/hazard-brief` |
| `world` | `exactjson_travel_destination_brief` | `$0.01` | `GET /v1/travel/destination-brief` |
| `world` | `exactjson_solar_site_window` | `$0.01` | `GET /v1/solar/site-window` |
| `commerce` | `exactjson_commerce_settlement_window` | `$0.01` | `GET /v1/commerce/settlement-window` |
| `commerce` | `exactjson_commerce_vat_verify` | `$0.01` | `GET /v1/commerce/vat-verify` |
| `commerce` | `exactjson_entity_company_verify` | `$0.01` | `GET /v1/entity/company-verify` |
| `commerce` | `exactjson_consumer_safety_recall` | `$0.01` | `GET /v1/consumer/safety-recall` |

## References

- [API Documentation](https://exactjson.com/docs) · [Pricing](https://exactjson.com/pricing)
- [OpenAPI 3.1 Spec](https://exactjson.com/openapi.json) · [llms.txt](https://exactjson.com/llms.txt)
- [MCP Server Card](https://exactjson.com/.well-known/mcp/server-card.json) · [x402scan](https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc)

> Informational market, security, weather/hazard, and entity/compliance data only; not financial, legal, tax, accounting, or sole life-safety/flight-navigation advice.
