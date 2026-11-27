# HANDOFF.md — ExactJSON v1.5.0 Baseline

## Overview
- **Brand:** ExactJSON — Live, deterministic x402 APIs for AI agents
- **Canonical URL:** `https://exactjson.com` (Dashboard: `/dashboard`, manual refresh only)
- **Repo:** `https://github.com/exactjsondev/exactjson`
- **Remote MCP:** `https://exactjson.com/mcp` (`markets` default, `13` tools), `https://exactjson.com/mcp/security` (`security`, `8` tools), `https://exactjson.com/mcp/world` (`world`, `6` tools), `https://exactjson.com/mcp/commerce` (`commerce`, `5` tools), `https://exactjson.com/mcp/research` (`research`, `4` tools), `https://exactjson.com/mcp/all` (`32` tools)
- **Stdio MCP Package:** `exactjson-mcp@1.5.0` (`npx -y exactjson-mcp` / `--pack security` / `--pack world` / `--pack commerce` / `--pack research`) · Official MCP Registry: `io.github.exactjsondev/exactjson`
- **Stack:** TypeScript (strict), Hono, Zod, `@x402/*@2.32.0`, `@coinbase/x402@2.1.0`, Cloudflare Workers (`nodejs_compat`) + D1 (`exactjson-db`), Vitest
- **Network:** Base Mainnet (`eip155:8453`, USDC)

## All 31 Paid Endpoints (Base Mainnet USDC)

### Markets Pack (`markets` — 12 Paid Endpoints)
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
12. `GET /v1/macro/global-rates` (`$0.01`)

### Security Pack (`security` — 7 Paid Endpoints)
13. `GET /v1/oss/package-audit` (`$0.01`)
14. `GET /v1/net/domain-trust` (`$0.01`)
15. `GET /v1/sec/cve-triage` (`$0.01`)
16. `GET /v1/ops/cloud-status` (`$0.005`)
17. `GET /v1/oss/runtime-eol` (`$0.005`)
18. `GET /v1/ai/model-audit` (`$0.01`)
19. `GET /v1/net/censorship-check` (`$0.01`)

### World Pack (`world` — 5 Paid Endpoints)
20. `GET /v1/aviation/airport-delays` (`$0.01`)
21. `GET /v1/space/weather-gnss` (`$0.01`)
22. `GET /v1/geo/hazard-brief` (`$0.015`)
23. `GET /v1/travel/destination-brief` (`$0.01`)
24. `GET /v1/solar/site-window` (`$0.01`)

### Commerce Pack (`commerce` — 4 Paid Endpoints)
25. `GET /v1/commerce/settlement-window` (`$0.01`)
26. `GET /v1/commerce/vat-verify` (`$0.01`)
27. `GET /v1/entity/company-verify` (`$0.01`)
28. `GET /v1/consumer/safety-recall` (`$0.01`)

### Research Pack (`research` — 3 Paid Endpoints)
29. `GET /v1/science/citation-verify` (`$0.005`)
30. `GET /v1/chem/hazard-profile` (`$0.01`)
31. `GET /v1/bio/drug-trial-brief` (`$0.015`)

## Key Commands
- **Full Verify Gate:** `npm run verify`
- **Sync Generated MCP Manifest:** `npm run sync:mcp`
- **Dev Server:** `npm run dev`
- **D1 Remote Migration:** `npm run db:migrate:remote`
- **Deploy Worker:** `npx wrangler deploy`
- **Live $0 Smoke Check:** `npm run smoke:live -- https://exactjson.com`
- **Paid Bazaar Seed (Waves 1–4 New 20):** `npm run test:payment -- https://exactjson.com --allow-mainnet --only=new20`
- **Paid Bazaar Seed (All 31):** `npm run test:payment -- https://exactjson.com --allow-mainnet --only=all`
- **AgentCash Discovery Check:** `npx -y @agentcash/discovery@latest discover https://exactjson.com --json`
