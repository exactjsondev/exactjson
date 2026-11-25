# exactjson-mcp

[![ExactJSON MCP server](https://glama.ai/mcp/servers/exactjsondev/exactjson/badge)](https://glama.ai/mcp/servers/exactjsondev/exactjson)

**ExactJSON — Live, deterministic x402 APIs for AI agents** (Model Context Protocol server).

Exposes 12 tools (`exactjson_health` free + 11 Base USDC pay-per-call endpoints) with client-side spend caps (`MAX_PAYMENT_USD`) and Pay-Only-On-Success guarantees.

- **Website & Docs:** https://exactjson.com
- **Remote Streamable HTTP MCP:** `https://exactjson.com/mcp`
- **Official MCP Registry:** `io.github.exactjsondev/exactjson`
- **Repository:** https://github.com/exactjsondev/exactjson
- **Contact:** hello@exactjson.com

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

> Informational market/security data only; not financial advice.
