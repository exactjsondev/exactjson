#!/usr/bin/env node
/**
 * ExactJSON Example — Pre-Trade Safety & Slippage Guard
 *
 * Pairs GET /v1/evm/safety ($0.01) with GET /v1/execution/quote-check ($0.01)
 * to produce a deterministic GO / CAUTION / BLOCK verdict before swapping.
 *
 * Usage:
 *   node examples/pre-trade-guard.mjs [tokenAddress] [chain] [--dry-run]
 *
 * Defaults to $0 dry-run mode (inspects live 402 terms) if BUYER_PRIVATE_KEY is unset.
 */

const BASE_URL = (process.env.EXACTJSON_BASE_URL?.trim() || "https://exactjson.com").replace(
  /\/+$/,
  "",
);
const MAX_PAYMENT_USD = process.env.MAX_PAYMENT_USD?.trim() || "$0.05";
const BASE_MAINNET = "eip155:8453";
const TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
const dryRunFlag = args.includes("--dry-run");
const positional = args.filter((arg) => !arg.startsWith("--"));
const tokenAddress = positional[0] || "0x4200000000000000000000000000000000000006"; // Base WETH
const chain = positional[1] || "base";

function decodeHeaderJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function preview402(label, url) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - started;
  const terms = decodeHeaderJson(res.headers.get("PAYMENT-REQUIRED"));
  const accept = Array.isArray(terms?.accepts) ? terms.accepts[0] : null;
  const priceUsdc = accept?.amount ? (Number(accept.amount) / 1e6).toFixed(4) : "unknown";

  console.log(`[DRY-RUN] ${label}`);
  console.log(`  URL:     ${url}`);
  console.log(`  Status:  HTTP ${res.status} (${ms}ms)`);
  if (res.status === 402 && accept) {
    console.log(`  Terms:   $${priceUsdc} USDC on ${accept.network} -> ${accept.payTo}`);
  } else {
    console.log("  Terms:   no 402 payment terms returned");
  }
}

async function createPaidFetch(rawKey) {
  const normalizedKey = /^0x/i.test(rawKey) ? `0x${rawKey.slice(2)}` : `0x${rawKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    throw new Error("Invalid BUYER_PRIVATE_KEY: expected 64 hex chars (with or without 0x).");
  }

  const [
    { registerExactEvmScheme },
    { wrapFetchWithPayment, x402Client },
    { privateKeyToAccount },
  ] = await Promise.all([
    import("@x402/evm/exact/client"),
    import("@x402/fetch"),
    import("viem/accounts"),
  ]);

  const client = new x402Client()
    .setSpendControls({ maxAmountPerPayment: MAX_PAYMENT_USD })
    .registerPolicy((_version, reqs) => reqs.filter((r) => r.network === BASE_MAINNET));
  registerExactEvmScheme(client, { signer: privateKeyToAccount(normalizedKey) });

  return wrapFetchWithPayment(fetch, client);
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok || body === null) {
    throw new Error(
      `HTTP ${res.status} from ${url}: ${body?.message || body?.error || text.slice(0, 160) || "failed"}`,
    );
  }
  return body;
}

function decideTradeVerdict(safety, quote) {
  if (
    safety.security.is_honeypot === true ||
    safety.risk_tier === "CRITICAL" ||
    !quote.summary.executable ||
    quote.summary.liquidity_grade === "ILLIQUID"
  ) {
    return "BLOCK";
  }
  if (
    safety.risk_tier === "ELEVATED" ||
    safety.security.engine_disagreement ||
    quote.summary.liquidity_grade === "THIN"
  ) {
    return "CAUTION";
  }
  return "GO";
}

async function main() {
  const safetyUrl = `${BASE_URL}/v1/evm/safety?address=${encodeURIComponent(tokenAddress)}&chain=${encodeURIComponent(chain)}`;
  const quoteUrl = `${BASE_URL}/v1/execution/quote-check?mode=evm&chain=${encodeURIComponent(chain)}&token_out=${encodeURIComponent(tokenAddress)}`;

  const rawKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (dryRunFlag || !rawKey) {
    await preview402("EVM Safety", safetyUrl);
    await preview402("Execution Quote-Check", quoteUrl);
    console.log("\nDry-run complete ($0.00 spent). Set BUYER_PRIVATE_KEY to run live paid calls.");
    return;
  }

  const paidFetch = await createPaidFetch(rawKey);
  const [safety, quote] = await Promise.all([
    fetchJson(paidFetch, safetyUrl),
    fetchJson(paidFetch, quoteUrl),
  ]);

  const verdict = decideTradeVerdict(safety, quote);
  console.log(`Verdict:      ${verdict} (${safety.symbol ?? tokenAddress} on ${safety.chain})`);
  console.log(
    `Safety:       ${safety.risk_tier} (score ${safety.risk_score}/100, honeypot=${safety.security.is_honeypot})`,
  );
  console.log(
    `Taxes:        buy=${safety.security.buy_tax_pct ?? "n/a"}% sell=${safety.security.sell_tax_pct ?? "n/a"}%`,
  );
  console.log(
    `Liquidity:    ${quote.summary.liquidity_grade} | max <100bps=$${quote.summary.max_size_under_100bps_usd.toLocaleString("en-US")}`,
  );
  if (safety.flags.length > 0) {
    console.log(`Safety Flags: ${safety.flags.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("pre-trade-guard failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
