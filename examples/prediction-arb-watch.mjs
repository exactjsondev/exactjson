#!/usr/bin/env node
/**
 * ExactJSON Example — Cross-Venue Prediction Market Arbitrage Watcher
 *
 * Calls GET /v1/predictions/arb ($0.02) to compare overlapping Polymarket and
 * Kalshi contracts with fee-adjusted net edge (bps) and resolution warnings.
 *
 * Usage:
 *   node examples/prediction-arb-watch.mjs [minSpreadBps] [limit] [--dry-run]
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
const minSpreadBps = positional[0] || "100";
const limit = positional[1] || "5";

function decodeHeaderJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function preview402(url) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - started;
  const terms = decodeHeaderJson(res.headers.get("PAYMENT-REQUIRED"));
  const accept = Array.isArray(terms?.accepts) ? terms.accepts[0] : null;
  const priceUsdc = accept?.amount ? (Number(accept.amount) / 1e6).toFixed(4) : "unknown";

  console.log("[DRY-RUN] Predictions Cross-Venue Arbitrage");
  console.log(`  URL:    ${url}`);
  console.log(`  Status: HTTP ${res.status} (${ms}ms)`);
  if (res.status === 402 && accept) {
    console.log(`  Terms:  $${priceUsdc} USDC on ${accept.network} -> ${accept.payTo}`);
  } else {
    console.log("  Terms:  no 402 payment terms returned");
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

async function main() {
  const url = `${BASE_URL}/v1/predictions/arb?min_spread_bps=${encodeURIComponent(minSpreadBps)}&limit=${encodeURIComponent(limit)}`;
  const rawKey = process.env.BUYER_PRIVATE_KEY?.trim();

  if (dryRunFlag || !rawKey) {
    await preview402(url);
    console.log("\nDry-run complete ($0.00 spent). Set BUYER_PRIVATE_KEY to run live paid calls.");
    return;
  }

  const paidFetch = await createPaidFetch(rawKey);
  const res = await paidFetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok || data === null) {
    throw new Error(
      `HTTP ${res.status}: ${data?.message || data?.error || text.slice(0, 160) || "request failed"}`,
    );
  }

  const { summary, opportunities } = data;
  console.log(
    `Scanned Polymarket (${summary.polymarket_scanned}) vs Kalshi (${summary.kalshi_scanned}) -> ${summary.qualifying_opportunities_count} qualifying opportunities`,
  );

  if (opportunities.length === 0) {
    console.log("No spreads cleared the minimum net-edge threshold right now.");
    return;
  }

  for (const opp of opportunities) {
    const apy = opp.annualized_arb_apy_pct !== null ? `${opp.annualized_arb_apy_pct}% APY` : "n/a";
    console.log(
      `\n• [${opp.match_confidence} | ${opp.quote_quality}] +${opp.net_edge_bps} bps net (${apy})`,
    );
    console.log(`  Strategy:   ${opp.strategy}`);
    console.log(
      `  Polymarket: ${opp.polymarket.action} @ $${opp.polymarket.entry_price_usd} — ${opp.polymarket.title}`,
    );
    console.log(
      `  Kalshi:     ${opp.kalshi.action} @ $${opp.kalshi.entry_price_usd} — ${opp.kalshi.title}`,
    );
    console.log(
      `  Min Liq:    $${opp.min_liquidity_usd.toLocaleString("en-US")} | Resolution warning: ${opp.resolution_risk_warning}`,
    );
  }
}

main().catch((err) => {
  console.error("prediction-arb-watch failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
