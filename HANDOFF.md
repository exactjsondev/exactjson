# HANDOFF.md — ExactJSON v1.1.0 Baseline

## Overview
- **Brand:** ExactJSON — Live, deterministic x402 APIs for AI agents
- **Canonical URL:** `https://exactjson.com` (Dashboard: `/dashboard`, manual refresh only)
- **Repo:** `https://github.com/exactjsondev/exactjson`
- **Remote MCP:** `https://exactjson.com/mcp` (Stateless Streamable HTTP)
- **Stdio MCP Package:** `exactjson-mcp@1.1.0` (`npx -y exactjson-mcp`) · Official MCP Registry: `io.github.exactjsondev/exactjson`
- **Stack:** TypeScript (strict), Hono, Zod, `@x402/*@2.32.0`, `@coinbase/x402@2.1.0`, Cloudflare Workers (`nodejs_compat`) + D1 (`exactjson-db`), Vitest
- **Network:** Base Mainnet (`eip155:8453`, USDC)

## All 11 Paid Endpoints (Base Mainnet USDC)
1. `GET /v1/solana/safety` (`$0.01`)
2. `GET /v1/solana/trending` (`$0.015`)
3. `GET /v1/perps/snapshot` (`$0.005`)
4. `GET /v1/perps/screener` (`$0.01`)
5. `GET /v1/perps/funding-arb` (`$0.015`)
6. `GET /v1/predictions/scanner` (`$0.01`)
7. `GET /v1/options/surface` (`$0.015`)
8. `GET /v1/macro/liquidity` (`$0.01`)
9. `GET /v1/evm/safety` (`$0.01`)
10. `GET /v1/predictions/arb` (`$0.02`)
11. `GET /v1/execution/quote-check` (`$0.01`)

## Key Commands
- **Typecheck & Test:** `npx tsc --noEmit && npm test`
- **Dev Server:** `npm run dev`
- **D1 Remote Migration:** `npm run db:migrate:remote`
- **Deploy Worker:** `npx wrangler deploy`
- **Paid Bazaar Seed (all 11):** `npm run test:payment -- https://exactjson.com --allow-mainnet --only=all`
- **AgentCash Discovery Check:** `npx -y @agentcash/discovery@latest discover https://exactjson.com --json`
