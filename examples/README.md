# ExactJSON Runnable Examples

Copy-paste scripts for calling [ExactJSON](https://exactjson.com) over **x402 V2** (Base Mainnet USDC, `$0.005–$0.02` per successful call, `$0` on errors, `$0` ETH gas).

Every script is self-contained and defaults to **`$0` dry-run mode** when `BUYER_PRIVATE_KEY` is unset—so you can inspect live `402 Payment Required` terms immediately with zero setup and zero spend.

| Script | Endpoints Used | Live Cost | Use Case |
| --- | --- | --- | --- |
| [`pre-trade-guard.mjs`](./pre-trade-guard.mjs) | `GET /v1/evm/safety` + `GET /v1/execution/quote-check` | `$0.02` | Pre-swap honeypot consensus + multi-tier slippage ladder (`GO` / `CAUTION` / `BLOCK`) |
| [`prediction-arb-watch.mjs`](./prediction-arb-watch.mjs) | `GET /v1/predictions/arb` | `$0.02` | Polymarket vs. Kalshi fee-adjusted net edge (`bps`), annualized carry & resolution warnings |
| [`ci-security-gate.mjs`](./ci-security-gate.mjs) | `GET /v1/oss/package-audit` + `GET /v1/sec/cve-triage` | `$0.02` | Zero-API-key supply-chain audit (OSV + OpenSSF) and CISA KEV + EPSS triage gate |

## 1. Try Immediately (`$0`, No Wallet Needed)

Requires Node.js 18+. Run any script without a wallet key to inspect the live `402` payment terms:

```bash
node examples/pre-trade-guard.mjs
node examples/prediction-arb-watch.mjs
node examples/ci-security-gate.mjs
```

## 2. Run Live Paid Calls (Base Mainnet USDC)

Install dependencies once (`npm install` in this repo, or `npm install @x402/fetch @x402/evm viem` in your own project), then pass a dedicated low-balance Base USDC wallet key. Each script enforces a built-in **`$0.05` per-call spend cap** (`MAX_PAYMENT_USD`) and refuses non-Base-Mainnet payment challenges.

**Bash / macOS / Linux:**

```bash
export BUYER_PRIVATE_KEY="0xYOUR_LOW_BALANCE_BASE_WALLET_KEY"
export MAX_PAYMENT_USD='$0.05'

node examples/pre-trade-guard.mjs 0x4200000000000000000000000000000000000006 base
node examples/prediction-arb-watch.mjs 100
node examples/ci-security-gate.mjs lodash npm CVE-2024-3094
```

**PowerShell:**

```powershell
$env:BUYER_PRIVATE_KEY = "0xYOUR_LOW_BALANCE_BASE_WALLET_KEY"
$env:MAX_PAYMENT_USD = '$0.05'

node examples/pre-trade-guard.mjs 0x4200000000000000000000000000000000000006 base
node examples/prediction-arb-watch.mjs 100
node examples/ci-security-gate.mjs lodash npm CVE-2024-3094
```

## Why Pay `$0.01` Instead of Calling Free Upstream APIs?

| Data Feed | Raw Upstream Payload | ExactJSON Output | Reduction |
| --- | --- | --- | --- |
| EVM token safety + DEX liquidity | ~214.6 KB (~54k tokens) | ~1.8 KB | -99.1% |
| OSS package registry + OSV + Scorecard | ~430 KB | ~2.1 KB | -99.5% |
| PubChem GHS chemical safety tree | ~112 KB | ~1.5 KB | -98.7% |

For an LLM agent, feeding raw 100–400 KB API responses into context costs `$0.02–$0.15` in input tokens alone and risks math hallucinations. Distilled ~2 KB JSON with deterministic server-side math is cheaper and safer.

See **[exactjson.com/setup](https://exactjson.com/setup)** for MCP, AgentCash, and agent prompt integrations.
