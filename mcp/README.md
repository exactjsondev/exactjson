# exactjson-mcp

[![CI](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml/badge.svg)](https://github.com/exactjsondev/exactjson/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/exactjson-mcp)](https://www.npmjs.com/package/exactjson-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/exactjsondev/exactjson/blob/main/LICENSE)
[![ExactJSON MCP server](https://glama.ai/mcp/servers/exactjsondev/exactjson/badge)](https://glama.ai/mcp/servers/exactjsondev/exactjson)

**ExactJSON — Live, deterministic x402 APIs for AI agents** (Model Context Protocol server).

Exposes 12 tools (`exactjson_health` free + 11 Base USDC pay-per-call endpoints) with client-side spend caps (`MAX_PAYMENT_USD`) and Pay-Only-On-Success guarantees.

- **Website & Docs:** https://exactjson.com · https://exactjson.com/docs · https://exactjson.com/pricing
- **Remote Streamable HTTP MCP:** `https://exactjson.com/mcp`
- **Official MCP Registry:** `io.github.exactjsondev/exactjson`
- **x402scan Listing:** https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc
- **Repository:** https://github.com/exactjsondev/exactjson
- **Contact:** hello@exactjson.com

## Requirements

- **Local Stdio (`exactjson-mcp`):** `Node.js >= 18.18.0` and a dedicated low-balance Base Mainnet (`eip155:8453`) wallet holding USDC for paid calls (`exactjson_health` works without a key).
- **Remote Streamable HTTP (`https://exactjson.com/mcp`):** Zero local installation required for x402-native MCP clients.

## Quickstart (Remote Streamable HTTP or Stdio)

For x402-native MCP clients, connect directly to the stateless Remote Streamable HTTP endpoint:
`https://exactjson.com/mcp`

For local desktop hosts (Claude Desktop / Cursor / OpenClaw):

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

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BUYER_PRIVATE_KEY` | For paid tools | — | Dedicated low-balance Base EVM wallet private key (`0x...` or 64-char hex) holding USDC for paid x402 calls. |
| `MAX_PAYMENT_USD` | No | `$0.05` | Maximum USDC spend per call enforced client-side before signing. |
| `EXACTJSON_BASE_URL` | No | `https://exactjson.com` | Optional base URL override when self-hosting ExactJSON. |

## Security & Spend Controls

- **Local-only signing:** `BUYER_PRIVATE_KEY` never leaves your local `exactjson-mcp` process. EIP-3009 payment authorizations are signed client-side via `viem` + `@x402/fetch`; ExactJSON never custodies user funds.
- **Hard client-side cap:** `MAX_PAYMENT_USD` (default `$0.05`) enforces `maxAmountPerPayment` locally before any authorization is signed. Use a dedicated low-balance operational wallet.
- **Pay-Only-On-Success:** Unpaid probes (`402`), bad inputs (`400`/`404`), fail-closed upstream outages (`502`), and operator pauses (`503`) never settle payment.

## Tools (12 Total)

| Tool | Price (USDC) | Endpoint |
| --- | --- | --- |
| `exactjson_health` | Free | `GET /health` |
| `exactjson_evm_safety` | `$0.01` | `GET /v1/evm/safety` |
| `exactjson_execution_quote_check` | `$0.01` | `GET /v1/execution/quote-check` |
| `exactjson_solana_safety` | `$0.01` | `GET /v1/solana/safety` |
| `exactjson_solana_trending` | `$0.015` | `GET /v1/solana/trending` |
| `exactjson_perps_snapshot` | `$0.005` | `GET /v1/perps/snapshot` |
| `exactjson_perps_screener` | `$0.01` | `GET /v1/perps/screener` |
| `exactjson_perps_funding_arb` | `$0.015` | `GET /v1/perps/funding-arb` |
| `exactjson_predictions_arb` | `$0.02` | `GET /v1/predictions/arb` |
| `exactjson_predictions_scanner` | `$0.01` | `GET /v1/predictions/scanner` |
| `exactjson_options_surface` | `$0.015` | `GET /v1/options/surface` |
| `exactjson_macro_liquidity` | `$0.01` | `GET /v1/macro/liquidity` |

## References

- [API Documentation](https://exactjson.com/docs) · [Pricing](https://exactjson.com/pricing)
- [OpenAPI 3.1 Spec](https://exactjson.com/openapi.json) · [llms.txt](https://exactjson.com/llms.txt)
- [MCP Server Card](https://exactjson.com/.well-known/mcp/server-card.json) · [x402scan](https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc)

> Informational market/security data only; not financial advice.
