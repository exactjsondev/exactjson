import { registerExactEvmScheme } from "@x402/evm/exact/client";
import {
  decodePaymentResponseHeader,
  wrapFetchWithPayment,
  x402Client,
} from "@x402/fetch";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const MAX_SPEND_USD = "$0.05";
const MAX_USDC_ATOMIC = 50_000n; // $0.05 in 6-decimal USDC
const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const TEST_SOL_MINT = "So11111111111111111111111111111111111111112";
const TEST_PERP_COIN = "BTC";
const TEST_BASE_WETH = "0x4200000000000000000000000000000000000006";

function getExplorerTxUrl(network: string | undefined, txHash: string | undefined): string | null {
  if (!txHash) return null;
  if (network === "eip155:8453") {
    return `https://basescan.org/tx/${txHash}`;
  }
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

async function runPaidProbe(
  fetchWithPay: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  label: string,
  url: string
): Promise<boolean> {
  console.log(`\n--- [${label}] GET ${url} ---`);
  const started = Date.now();
  const res = await fetchWithPay(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const elapsed = Date.now() - started;

  const paymentResponseRaw =
    res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const extensionResponses = res.headers.get("EXTENSION-RESPONSES");

  console.log(`HTTP Status: ${res.status} (${elapsed}ms)`);
  console.log(
    `EXTENSION-RESPONSES: ${extensionResponses ? extensionResponses : "Not emitted"}`
  );

  if (paymentResponseRaw) {
    try {
      const decoded = decodePaymentResponseHeader(paymentResponseRaw);
      const txUrl = getExplorerTxUrl(decoded.network, decoded.transaction);
      console.log(`Settlement Success: ${decoded.success}`);
      console.log(`Network: ${decoded.network}`);
      console.log(`Payer: ${decoded.payer ?? "unknown"}`);
      console.log(`Tx Hash: ${decoded.transaction || "none"}`);
      if (txUrl) console.log(`Explorer: ${txUrl}`);
    } catch {
      console.log("PAYMENT-RESPONSE present (raw decode failed).");
    }
  } else {
    console.log("PAYMENT-RESPONSE: Not present (not settled)");
  }

  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    console.log("Response preview:", JSON.stringify(parsed, null, 2).slice(0, 700));
  } catch {
    console.log("Response body:", text.slice(0, 400));
  }

  return res.status === 200 && Boolean(paymentResponseRaw);
}

async function main() {
  const args: string[] = process.argv.slice(2);
  const allowMainnet = args.includes("--allow-mainnet");
  const onlyArg = args.find((arg: string) => arg.startsWith("--only="));
  const onlyTarget = onlyArg ? onlyArg.slice("--only=".length).trim().toLowerCase() : null;
  const urlArg = args.find((arg: string) => arg.startsWith("http://") || arg.startsWith("https://"));
  const baseUrl = (urlArg ?? process.env.TARGET_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  const rawKey = process.env.TEST_BUYER_PRIVATE_KEY?.trim();

  if (!rawKey) {
    const freshKey = generatePrivateKey();
    const account = privateKeyToAccount(freshKey);

    console.log("==============================================================");
    console.log("No TEST_BUYER_PRIVATE_KEY set.");
    console.log("Generated a fresh throwaway Base Sepolia testnet wallet:");
    console.log("");
    console.log(`  Testnet Address:     ${account.address}`);
    console.log(`  Throwaway Key (hex): ${freshKey}`);
    console.log("");
    console.log("Next steps (100% free testnet USDC):");
    console.log("  1. Go to https://faucet.circle.com");
    console.log("  2. Select Network: 'Base Sepolia' and Token: 'USDC'");
    console.log(`  3. Paste address ${account.address} and request free test USDC`);
    console.log("  4. Run in PowerShell:");
    console.log(`     $env:TEST_BUYER_PRIVATE_KEY="${freshKey}"`);
    console.log(`     npm run test:payment -- ${baseUrl}`);
    console.log("==============================================================");
    console.log("Note: Throwaway testnet key ONLY. Never fund this key with real mainnet funds.");
    return;
  }

  const normalizedKey = (
    /^0x/i.test(rawKey) ? `0x${rawKey.slice(2)}` : `0x${rawKey}`
  ) as `0x${string}`;
  const account = privateKeyToAccount(normalizedKey);

  console.log(`Buyer Address: ${account.address}`);
  console.log(`Target Server: ${baseUrl}`);
  console.log(`Hard Spend Cap: ${MAX_SPEND_USD} per payment (${MAX_USDC_ATOMIC.toString()} atomic USDC)`);
  console.log(`Mode: ${allowMainnet ? "MAINNET ALLOWED (--allow-mainnet)" : "Base Sepolia testnet only"}`);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });

  // Layer 1: Built-in SDK spendControls cap ($0.05 max per payment)
  client.setSpendControls({
    maxAmountPerPayment: MAX_SPEND_USD,
  });

  // Layer 2: Explicit onBeforePaymentCreation hook enforcing atomic cap + network safety
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    if (!allowMainnet && selectedRequirements.network !== "eip155:84532") {
      return {
        abort: true,
        reason: `Blocked non-testnet network ${selectedRequirements.network}. Pass --allow-mainnet only when intentionally testing mainnet.`,
      };
    }

    const atomicAmount = BigInt(selectedRequirements.amount);
    if (atomicAmount > MAX_USDC_ATOMIC) {
      return {
        abort: true,
        reason: `Requested payment ${atomicAmount.toString()} atomic units exceeds hard $0.05 cap (${MAX_USDC_ATOMIC.toString()}).`,
      };
    }
  });

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const targets: Array<{ key: string; label: string; url: string }> = [
    {
      key: "safety",
      label: "Solana Safety ($0.01)",
      url: `${baseUrl}/v1/solana/safety?mint=${TEST_SOL_MINT}`,
    },
    {
      key: "trending",
      label: "Solana Trending Safe ($0.015)",
      url: `${baseUrl}/v1/solana/trending?limit=3`,
    },
    {
      key: "perps",
      label: "Hyperliquid Perps Snapshot ($0.005)",
      url: `${baseUrl}/v1/perps/snapshot?coin=${TEST_PERP_COIN}`,
    },
    {
      key: "screener",
      label: "Hyperliquid Perps Screener ($0.01)",
      url: `${baseUrl}/v1/perps/screener?limit=5`,
    },
    {
      key: "arb",
      label: "Cross-Venue Funding Arb ($0.015)",
      url: `${baseUrl}/v1/perps/funding-arb?limit=5`,
    },
    {
      key: "predictions",
      label: "Predictions Scanner ($0.01)",
      url: `${baseUrl}/v1/predictions/scanner?limit=5`,
    },
    {
      key: "options",
      label: "Deribit Options Surface ($0.015)",
      url: `${baseUrl}/v1/options/surface?currency=BTC`,
    },
    {
      key: "macro",
      label: "US Macro Liquidity ($0.01)",
      url: `${baseUrl}/v1/macro/liquidity?lookback_obs=5`,
    },
    {
      key: "evm_safety",
      label: "EVM Safety Base WETH ($0.01)",
      url: `${baseUrl}/v1/evm/safety?address=${TEST_BASE_WETH}&chain=base`,
    },
    {
      key: "predictions_arb",
      label: "Predictions Cross-Venue Arb ($0.02)",
      url: `${baseUrl}/v1/predictions/arb?min_spread_bps=0&limit=5`,
    },
    {
      key: "quote_check",
      label: "Execution Quote-Check Perps BTC ($0.01)",
      url: `${baseUrl}/v1/execution/quote-check?mode=perps&coin=${TEST_PERP_COIN}`,
    },
    {
      key: "macro_global_rates",
      label: "Global Central Bank Policy Rates ($0.01)",
      url: `${baseUrl}/v1/macro/global-rates?base=USD&group=all`,
    },
    {
      key: "oss_package_audit",
      label: "OSS Package Audit npm lodash ($0.01)",
      url: `${baseUrl}/v1/oss/package-audit?package=lodash&ecosystem=npm`,
    },
    {
      key: "net_domain_trust",
      label: "Domain Trust stripe.com ($0.01)",
      url: `${baseUrl}/v1/net/domain-trust?domain=stripe.com`,
    },
    {
      key: "sec_cve_triage",
      label: "CVE Triage CVE-2024-3094 ($0.01)",
      url: `${baseUrl}/v1/sec/cve-triage?cve=CVE-2024-3094`,
    },
    {
      key: "ops_cloud_status",
      label: "Cloud Status All Providers ($0.005)",
      url: `${baseUrl}/v1/ops/cloud-status?providers=all`,
    },
    {
      key: "oss_runtime_eol",
      label: "Runtime EOL Node.js 20 ($0.005)",
      url: `${baseUrl}/v1/oss/runtime-eol?product=nodejs&cycle=20`,
    },
    {
      key: "ai_model_audit",
      label: "AI Model Audit Qwen2.5-7B ($0.01)",
      url: `${baseUrl}/v1/ai/model-audit?model=Qwen/Qwen2.5-7B-Instruct`,
    },
    {
      key: "net_censorship_check",
      label: "Censorship Check telegram.org IR ($0.01)",
      url: `${baseUrl}/v1/net/censorship-check?domain=telegram.org&country=IR&days=7`,
    },
    {
      key: "aviation_airport_delays",
      label: "Aviation Airport Delays JFK ($0.01)",
      url: `${baseUrl}/v1/aviation/airport-delays?airport=JFK`,
    },
    {
      key: "space_weather_gnss",
      label: "Space Weather GNSS & LEO Drag ($0.01)",
      url: `${baseUrl}/v1/space/weather-gnss?lat=37.77`,
    },
    {
      key: "geo_hazard_brief",
      label: "Geo Hazard Brief SF Coordinates ($0.015)",
      url: `${baseUrl}/v1/geo/hazard-brief?lat=37.7749&lon=-122.4194&radius_km=100`,
    },
    {
      key: "travel_destination_brief",
      label: "Travel Destination Brief Japan ($0.01)",
      url: `${baseUrl}/v1/travel/destination-brief?country=JP`,
    },
    {
      key: "solar_site_window",
      label: "Solar & Wind Site Window Amsterdam ($0.01)",
      url: `${baseUrl}/v1/solar/site-window?lat=52.3676&lon=4.9041`,
    },
    {
      key: "commerce_settlement_window",
      label: "Cross-Border Settlement Window US->JP ($0.01)",
      url: `${baseUrl}/v1/commerce/settlement-window?from=US&to=JP`,
    },
    {
      key: "commerce_vat_verify",
      label: "EU VIES VAT Verify Google Ireland ($0.01)",
      url: `${baseUrl}/v1/commerce/vat-verify?vat=IE6388047V`,
    },
    {
      key: "entity_company_verify",
      label: "Corporate KYB Verify Apple Inc. ($0.01)",
      url: `${baseUrl}/v1/entity/company-verify?query=Apple%20Inc.`,
    },
    {
      key: "consumer_safety_recall",
      label: "Consumer Safety Recall Stroller ($0.01)",
      url: `${baseUrl}/v1/consumer/safety-recall?query=stroller&category=consumer`,
    },
    {
      key: "science_citation_verify",
      label: "Science Citation Verify AlphaFold ($0.005)",
      url: `${baseUrl}/v1/science/citation-verify?doi=10.1038%2Fs41586-021-03819-2`,
    },
    {
      key: "chem_hazard_profile",
      label: "Chem Hazard Profile Benzene ($0.01)",
      url: `${baseUrl}/v1/chem/hazard-profile?query=71-43-2`,
    },
    {
      key: "bio_drug_trial_brief",
      label: "Bio Drug Trial Brief Semaglutide ($0.015)",
      url: `${baseUrl}/v1/bio/drug-trial-brief?drug=semaglutide`,
    },
  ];

  const marketsKeys = new Set([
    "safety",
    "trending",
    "perps",
    "screener",
    "funding_arb",
    "scanner",
    "options_surface",
    "macro_liquidity",
    "evm_safety",
    "predictions_arb",
    "quote_check",
    "macro_global_rates",
  ]);
  const securityKeys = new Set([
    "oss_package_audit",
    "net_domain_trust",
    "sec_cve_triage",
    "ops_cloud_status",
    "oss_runtime_eol",
    "ai_model_audit",
    "net_censorship_check",
  ]);
  const worldKeys = new Set([
    "aviation_airport_delays",
    "space_weather_gnss",
    "geo_hazard_brief",
    "travel_destination_brief",
    "solar_site_window",
  ]);
  const commerceKeys = new Set([
    "commerce_settlement_window",
    "commerce_vat_verify",
    "entity_company_verify",
    "consumer_safety_recall",
  ]);
  const researchKeys = new Set([
    "science_citation_verify",
    "chem_hazard_profile",
    "bio_drug_trial_brief",
  ]);
  const selected =
    onlyTarget === "all"
      ? targets
      : onlyTarget === "markets"
        ? targets.filter((t) => marketsKeys.has(t.key))
        : onlyTarget === "security"
          ? targets.filter((t) => securityKeys.has(t.key))
          : onlyTarget === "world"
            ? targets.filter((t) => worldKeys.has(t.key))
            : onlyTarget === "commerce"
              ? targets.filter((t) => commerceKeys.has(t.key))
              : onlyTarget === "research"
                ? targets.filter((t) => researchKeys.has(t.key))
                : onlyTarget
                  ? targets.filter((t) => t.key === onlyTarget)
                  : targets.filter((t) => t.key === "safety" || t.key === "perps");

  if (selected.length === 0) {
    throw new Error(
      `Unknown --only=${onlyTarget}. Valid values: all, markets, security, world, commerce, research, ${targets.map((t) => t.key).join(", ")}`
    );
  }

  const results: Array<{ key: string; ok: boolean }> = [];
  for (const target of selected) {
    const ok = await runPaidProbe(fetchWithPay, target.label, target.url);
    results.push({ key: target.key, ok });
  }

  console.log("\n==============================================================");
  console.log(
    "Summary:",
    results.map((r) => `${r.key}=${r.ok ? "SETTLED" : "FAILED"}`).join(", ")
  );
  console.log("==============================================================");

  if (results.some((r) => !r.ok)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Payment test failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
