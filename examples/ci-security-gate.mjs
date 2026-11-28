#!/usr/bin/env node
/**
 * ExactJSON Example — Zero-API-Key CI & Agent Security Gate
 *
 * Calls GET /v1/oss/package-audit ($0.01) and GET /v1/sec/cve-triage ($0.01)
 * to check OSV vulnerabilities, OpenSSF Scorecard, package age, CISA KEV,
 * and FIRST.org EPSS probability. Exits non-zero on critical findings.
 *
 * Usage:
 *   node examples/ci-security-gate.mjs [package] [ecosystem] [cveId] [--dry-run]
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
const pkgName = positional[0] || "lodash";
const ecosystem = positional[1] || "npm";
const cveId = positional[2] || "CVE-2024-3094";

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

async function main() {
  const pkgUrl = `${BASE_URL}/v1/oss/package-audit?package=${encodeURIComponent(pkgName)}&ecosystem=${encodeURIComponent(ecosystem)}`;
  const cveUrl = `${BASE_URL}/v1/sec/cve-triage?cve=${encodeURIComponent(cveId)}`;

  const rawKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (dryRunFlag || !rawKey) {
    await preview402("OSS Package Audit", pkgUrl);
    await preview402("CVE Triage", cveUrl);
    console.log("\nDry-run complete ($0.00 spent). Set BUYER_PRIVATE_KEY to run live paid calls.");
    return;
  }

  const paidFetch = await createPaidFetch(rawKey);
  const [audit, cve] = await Promise.all([
    fetchJson(paidFetch, pkgUrl),
    fetchJson(paidFetch, cveUrl),
  ]);

  console.log(
    `Package: ${audit.ecosystem}/${audit.package}@${audit.version ?? "latest"} -> ${audit.risk_tier} (${audit.risk_score}/100)`,
  );
  console.log(
    `  Vulns: ${audit.vulnerabilities.total_count} total (${audit.vulnerabilities.critical_or_high_count} critical/high) | Age: ${audit.supply_chain.package_age_days ?? "n/a"}d | Install hooks: ${audit.supply_chain.has_install_scripts}`,
  );
  console.log(
    `CVE:     ${cve.cve} -> ${cve.urgency_tier} (score ${cve.priority_score}/100, KEV=${cve.exploitation.in_cisa_kev}, EPSS=${cve.exploitation.epss_30d_probability ?? "n/a"})`,
  );

  const shouldBlock =
    audit.risk_tier === "CRITICAL" ||
    audit.vulnerabilities.critical_or_high_count > 0 ||
    cve.urgency_tier === "ACT_IMMEDIATELY";

  if (shouldBlock) {
    console.error("\nCI Gate: BLOCKED (critical package or active KEV/high-EPSS CVE detected).");
    process.exitCode = 1;
  } else {
    console.log("\nCI Gate: PASS");
  }
}

main().catch((err) => {
  console.error("ci-security-gate failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
