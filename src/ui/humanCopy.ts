import {
  CATALOG,
  type EndpointId,
  getActivePacks,
  getPackEndpoints,
  type PackId,
} from "../config/catalog";
import { escapeHtml, highlightCode, highlightJson, renderCodeWell } from "./escape";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

export type SetupPackChoice = "all" | PackId;

export const POPULAR_ENDPOINT_IDS: readonly EndpointId[] = [
  "evm_safety",
  "oss_package_audit",
  "aviation_airport_delays",
  "commerce_vat_verify",
  "science_citation_verify",
];

export const POPULAR_ENDPOINT_SET: ReadonlySet<EndpointId> = new Set(POPULAR_ENDPOINT_IDS);

export const WALLET_LINKS = {
  rabby: "https://rabby.io/",
  metamask: "https://metamask.io/",
  baseHome: "https://www.base.org/",
  baseDocs: "https://docs.base.org/",
  x402: "https://x402.org",
  baseUsdcContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

export interface HumanPackMeta {
  id: SetupPackChoice;
  label: string;
  plainTitle: string;
  plainSummary: string;
  exampleQuestion: string;
  exampleAnswer: string;
  examplePrice: string;
  samplePathWithQuery: string;
  mcpRemotePath: string;
  stdioArgs: readonly string[];
}

export const HUMAN_PACK_META: Readonly<Record<SetupPackChoice, HumanPackMeta>> = {
  all: {
    id: "all",
    label: "All packs",
    plainTitle: "All 31 live tools",
    plainSummary: "Every market, security, travel, business, and research check in one setup.",
    exampleQuestion: "Check a token, an npm package, an EU VAT ID, or a paper DOI in one call.",
    exampleAnswer: "Clean ~2 KB JSON from official live sources.",
    examplePrice: "$0.005–$0.02",
    samplePathWithQuery: "/v1/evm/safety?address=0x4200000000000000000000000000000000000006&chain=base",
    mcpRemotePath: "/mcp/all",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "all"],
  },
  markets: {
    id: "markets",
    label: "Markets",
    plainTitle: "Crypto, Trading & Macro",
    plainSummary:
      "Spot scam tokens, check real swap slippage, track live futures, prediction odds, and central bank rates.",
    exampleQuestion: "Is this crypto token a honeypot scam?",
    exampleAnswer: "Dual-engine safety score, hidden buy/sell taxes, and live liquidity.",
    examplePrice: "$0.01",
    samplePathWithQuery: "/v1/evm/safety?address=0x4200000000000000000000000000000000000006&chain=base",
    mcpRemotePath: "/mcp",
    stdioArgs: ["-y", "exactjson-mcp"],
  },
  security: {
    id: "security",
    label: "Security",
    plainTitle: "Code, Domain & Cloud Safety",
    plainSummary:
      "Check packages before installing, verify sketchy domains, triage active CVEs, and check cloud outages.",
    exampleQuestion: "Is this npm or Python package safe to install?",
    exampleAnswer: "Known vulnerabilities, package age, fake-package flags, and OpenSSF score.",
    examplePrice: "$0.01",
    samplePathWithQuery: "/v1/oss/package-audit?package=lodash&ecosystem=npm",
    mcpRemotePath: "/mcp/security",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "security"],
  },
  world: {
    id: "world",
    label: "World",
    plainTitle: "Flights, Weather, Travel & Hazards",
    plainSummary:
      "Live airport delays, travel advisories, earthquake/disaster briefs, drone GPS storms, and solar windows.",
    exampleQuestion: "Are flights delayed at JFK right now?",
    exampleAnswer: "Decoded airport weather, flight category, and active FAA ground stops.",
    examplePrice: "$0.01",
    samplePathWithQuery: "/v1/aviation/airport-delays?airport=JFK",
    mcpRemotePath: "/mcp/world",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "world"],
  },
  commerce: {
    id: "commerce",
    label: "Commerce",
    plainTitle: "Invoices, Companies & Recalls",
    plainSummary:
      "Verify EU VAT numbers and IBANs, check real company registries, banking settlement dates, and product recalls.",
    exampleQuestion: "Is this EU company's VAT number real before I pay?",
    exampleAnswer: "Official EU VIES registration check plus IBAN and country-mismatch flags.",
    examplePrice: "$0.01",
    samplePathWithQuery: "/v1/commerce/vat-verify?vat=IE6388047V",
    mcpRemotePath: "/mcp/commerce",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "commerce"],
  },
  research: {
    id: "research",
    label: "Research",
    plainTitle: "Papers, Chemistry & Clinical Trials",
    plainSummary:
      "Catch fake or retracted citations, check chemical safety ratings, and track live clinical trial milestones.",
    exampleQuestion: "Was this research paper made up or retracted?",
    exampleAnswer: "Official Crossref/DataCite verification plus Retraction Watch flags.",
    examplePrice: "$0.005",
    samplePathWithQuery: "/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2",
    mcpRemotePath: "/mcp/research",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "research"],
  },
};

export const HUMAN_ENDPOINT_ONE_LINER: Readonly<Record<EndpointId, string>> = {
  evm_safety: "Check if an Ethereum or Base token is a honeypot, scam, or high-tax trap.",
  execution_quote_check: "See real swap or perp price impact across trade sizes before executing.",
  solana_safety: "Audit a Solana token for rug flags, mint permissions, and real liquidity.",
  solana_trending: "Browse trending Solana pools already screened for common safety risks.",
  perps_snapshot: "Fast live snapshot of Hyperliquid funding, spread, and orderbook depth.",
  perps_screener: "Scan 180+ Hyperliquid perpetual markets for extreme funding or volume.",
  perps_funding_arb: "Compare annualized perp funding spreads across Hyperliquid, dYdX, and Kraken.",
  predictions_arb: "Find fee-adjusted arbitrage spreads between Polymarket and Kalshi.",
  predictions_scanner: "Search live Polymarket and Kalshi odds, spreads, and implied carry.",
  options_surface: "Read Deribit BTC or ETH implied volatility, skew, and max pain levels.",
  macro_liquidity: "Track live US Treasury cash, Fed reverse repo, and net USD liquidity.",
  macro_global_rates: "Compare official central bank interest rates across 38 countries.",
  oss_package_audit: "Check an npm, PyPI, or Rust package for vulnerabilities or fake clones.",
  net_domain_trust: "Spot malware, phishing risk, missing email protection, and new domains.",
  sec_cve_triage: "See if a CVE is actively exploited in the wild and which version fixes it.",
  ops_cloud_status: "Check live outage status for GitHub, Cloudflare, OpenAI, Anthropic, Vercel, and npm.",
  oss_runtime_eol: "Check if a Node, Python, Postgres, or OS version is past end-of-life.",
  ai_model_audit: "Verify Hugging Face model licenses, safe file formats, and GPU VRAM needs.",
  net_censorship_check: "Check if a website is blocked or throttled in a specific country.",
  aviation_airport_delays: "Check live airport weather, flight conditions, and FAA ground stops.",
  space_weather_gnss: "Check solar storms affecting drone GPS accuracy, compasses, and satellites.",
  geo_hazard_brief: "Get active earthquakes, disasters, and site hazard alerts for any coordinates.",
  travel_destination_brief: "Get official travel advisories, regional alerts, and upcoming public holidays.",
  solar_site_window: "Check solar irradiance and 7-day low-wind windows for outdoor or drone ops.",
  commerce_settlement_window: "Calculate cross-border banking settlement dates, holidays, and FX buffers.",
  commerce_vat_verify: "Verify an EU VAT ID live and validate IBAN/BIC invoice details.",
  entity_company_verify: "Verify a company's legal entity ID, ownership tree, and public filings.",
  consumer_safety_recall: "Search official US consumer product, food, drug, and device recalls.",
  science_citation_verify: "Verify a paper DOI or arXiv link and catch hallucinations or retractions.",
  chem_hazard_profile: "Look up official chemical toxicity, flammability, and safety ratings.",
  bio_drug_trial_brief: "Track active Phase 2/3 clinical trials and official drug classifications.",
};

export interface HumanFaqItem {
  id: string;
  question: string;
  answer: string;
}

export const HUMAN_FAQ: readonly HumanFaqItem[] = [
  {
    id: "faq-not-llm",
    question: "Is ExactJSON a replacement for ChatGPT or Claude?",
    answer:
      "No — it works alongside your AI. ExactJSON feeds your AI verified live facts and pre-computed math in ~2 KB so it stops guessing and uses up to 99% fewer context tokens.",
  },
  {
    id: "faq-web-search",
    question: "Why not just let my AI search the web?",
    answer:
      "Web search scrapes bulky web pages, burns tokens, and often misses live official registries like EU VAT checks, FAA ground stops, or Retraction Watch. ExactJSON queries primary sources directly and computes exact numbers in code.",
  },
  {
    id: "faq-eth-gas",
    question: "Do I need crypto experience or ETH for gas fees?",
    answer:
      "No ETH is needed. You pay with USDC on Base (1 USDC = $1.00), and the x402 payment relay covers Base network gas fees automatically. Putting $2–$5 of USDC in a separate pocket wallet covers hundreds of calls.",
  },
  {
    id: "faq-wallet-safety",
    question: "Can my AI accidentally drain my wallet?",
    answer:
      "Keep your AI safe with two layers: put only $2–$5 in a dedicated pocket wallet (never your main wallet) and keep MAX_PAYMENT_USD set to $0.05 so no single call can ever exceed a few cents.",
  },
  {
    id: "faq-errors-free",
    question: "What happens if a lookup fails or an API is down?",
    answer:
      "You pay $0.00. Invalid parameters (400), not-found items (404), and upstream outages (502) never settle payment, and security checks fail closed instead of guessing.",
  },
];

const X402_FETCH_PKG = ["@x402", "fetch"].join("/");
const X402_EVM_PKG = ["@x402", "evm/exact/client"].join("/");

export function buildVibePrompt(baseUrl: string, pack: SetupPackChoice): string {
  const meta = HUMAN_PACK_META[pack];
  const scopeNote =
    pack === "all"
      ? `all 5 ExactJSON packs (${baseUrl}/mcp/all or any /v1/* endpoint)`
      : `the ExactJSON ${meta.label} pack (${meta.plainTitle} — ${baseUrl}${meta.mcpRemotePath})`;

  return `Read ${baseUrl}/llms.txt and connect my app to ${scopeNote}.

Requirements:
1. Use ${X402_FETCH_PKG} with ${X402_EVM_PKG} (or exactjson-mcp if wiring an MCP client).
2. Read BUYER_PRIVATE_KEY from process.env (.env only, add .env to .gitignore, never hardcode keys).
3. Enforce a hard spend limit of maxAmountPerPayment: "$0.05".
4. Handle non-200 responses cleanly (400/404/502/503 cost $0.00 — never treat 502 as safe).
5. Start by testing ${baseUrl}${meta.samplePathWithQuery} and show me the parsed JSON result.`;
}

export function buildMcpConfigSnippet(baseUrl: string, pack: SetupPackChoice): string {
  const meta = HUMAN_PACK_META[pack];
  const serverKey = pack === "all" ? "exactjson" : `exactjson-${pack}`;
  return JSON.stringify(
    {
      mcpServers: {
        [serverKey]: {
          command: "npx",
          args: [...meta.stdioArgs],
          env: {
            BUYER_PRIVATE_KEY: "0xYOUR_POCKET_WALLET_PRIVATE_KEY",
            MAX_PAYMENT_USD: "$0.05",
          },
        },
        [`${serverKey}-remote`]: {
          url: `${baseUrl}${meta.mcpRemotePath}`,
        },
      },
    },
    null,
    2,
  );
}

export function buildSdkSnippet(baseUrl: string, pack: SetupPackChoice): string {
  const meta = HUMAN_PACK_META[pack];
  return `import { wrapFetchWithPayment, x402Client } from "${X402_FETCH_PKG}";
import { registerExactEvmScheme } from "${X402_EVM_PKG}";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client()
  .setSpendControls({ maxAmountPerPayment: "$0.05" });
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY),
});

const payFetch = wrapFetchWithPayment(fetch, client);
const res = await payFetch("${baseUrl}${meta.samplePathWithQuery}");
console.log(await res.json());`;
}

export interface DialogOptions {
  id: string;
  title: string;
  eyebrow?: string;
  bodyHtml: string;
  footerHtml?: string;
}

export function renderDialog(opts: DialogOptions): string {
  const safeId = escapeHtml(opts.id);
  const titleId = `${safeId}-title`;
  const eyebrowHtml = opts.eyebrow
    ? `<span class="modal-eyebrow">${escapeHtml(opts.eyebrow)}</span>`
    : "";
  const footerHtml = opts.footerHtml
    ? `<div class="modal-foot">${opts.footerHtml}</div>`
    : "";

  return `<dialog id="${safeId}" class="modal-dialog" aria-labelledby="${titleId}">
    <div class="modal-head">
      <div class="modal-head-copy">
        ${eyebrowHtml}
        <h2 id="${titleId}" class="modal-title">${escapeHtml(opts.title)}</h2>
      </div>
      <button type="button" class="modal-close" data-close-dialog aria-label="Close window">Close ✕</button>
    </div>
    <div class="modal-body">
      ${opts.bodyHtml}
    </div>
    ${footerHtml}
  </dialog>`;
}

export function renderQuickWalletModal(baseUrl: string): string {
  const safeBase = escapeHtml(baseUrl);
  const bodyHtml = `
    <p class="modal-lead">Think of this like a <strong>$5 prepaid gift card for your AI</strong>. No account signup, no monthly bill, and no ETH needed for gas.</p>
    <div class="callout-box warn">
      <strong>Safety rule:</strong> Never use your main crypto wallet. Create a brand-new "AI pocket wallet" and fund it with only <strong>$2–$5 of USDC on Base</strong> (good for 100–1,000 calls).
    </div>
    <ol class="step-list">
      <li><strong>Create a fresh pocket address:</strong> Install <a href="${WALLET_LINKS.rabby}" target="_blank" rel="noopener noreferrer">Rabby Wallet</a> or <a href="${WALLET_LINKS.metamask}" target="_blank" rel="noopener noreferrer">MetaMask</a> and add a new address just for your AI. <em>(Avoid passkey-only smart wallets — they don't export a <code>0x...</code> private key.)</em></li>
      <li><strong>Add $2–$5 of native USDC on Base:</strong> Send USDC directly to the <strong>Base</strong> network from Coinbase (no bridge needed) or follow the <a href="${WALLET_LINKS.baseDocs}" target="_blank" rel="noopener noreferrer">Base official docs</a>. You need <strong>$0 ETH</strong> for gas — x402 covers it.</li>
      <li><strong>Verify native Base USDC &amp; export key:</strong> Native Base USDC contract is <code>${WALLET_LINKS.baseUsdcContract}</code>. Export only that pocket address's private key into your local <code>.env</code> or MCP config with <code>MAX_PAYMENT_USD="$0.05"</code>.</li>
    </ol>`;

  const footerHtml = `
    <a class="swiss-btn primary" href="${safeBase}/setup">Open Full 4-Step Setup Guide →</a>
    <button type="button" class="swiss-btn" data-close-dialog>Done</button>`;

  return renderDialog({
    id: "wallet-quick-dialog",
    eyebrow: "Quick Wallet Guide · $0 ETH Gas Needed",
    title: "How to make a $5 AI pocket wallet",
    bodyHtml,
    footerHtml,
  });
}

export interface PackSetupWidgetOptions {
  baseUrl: string;
  idPrefix: string;
  defaultPack?: SetupPackChoice;
  networkLabel: string;
}

export function renderPackSetupWidget(opts: PackSetupWidgetOptions): string {
  const pack: SetupPackChoice = opts.defaultPack ?? "all";
  const safeId = escapeHtml(opts.idPrefix);
  const activePacks = getActivePacks();

  const packButtons = [
    `<button type="button" class="pack-pill" data-gen-pack="all" aria-pressed="${pack === "all" ? "true" : "false"}">All tools (${CATALOG.length})</button>`,
    ...activePacks.map((p) => {
      const count = getPackEndpoints([p.id]).length;
      const meta = HUMAN_PACK_META[p.id];
      const pressed = pack === p.id ? "true" : "false";
      return `<button type="button" class="pack-pill" data-gen-pack="${escapeHtml(p.id)}" aria-pressed="${pressed}">${escapeHtml(meta.label)} (${count})</button>`;
    }),
  ].join("\n        ");

  const promptRaw = buildVibePrompt(opts.baseUrl, pack);
  const mcpRaw = buildMcpConfigSnippet(opts.baseUrl, pack);
  const sdkRaw = buildSdkSnippet(opts.baseUrl, pack);
  const packMeta = HUMAN_PACK_META[pack];

  return `<div class="setup-generator" data-setup-generator data-base-url="${escapeHtml(opts.baseUrl)}" data-network-label="${escapeHtml(opts.networkLabel)}">
    <div class="gen-pack-bar">
      <div class="gen-pack-group" role="group" aria-label="Choose a tool pack">
        <span class="gen-pack-label">Pick a pack:</span>
        ${packButtons}
      </div>
      <span class="gen-status" data-gen-status role="status" aria-live="polite">Selected: ${escapeHtml(packMeta.plainTitle)} · Tip: single packs (&lt;=15 tools) give sharpest MCP accuracy</span>
    </div>

    <div class="gen-tabs" role="radiogroup" aria-label="Choose integration method">
      <input type="radio" name="${safeId}-mode" id="${safeId}-mode-prompt" data-gen-radio="prompt" class="sr-control" checked>
      <label class="tab-trigger" for="${safeId}-mode-prompt">1. Vibe-Code Prompt</label>
      <input type="radio" name="${safeId}-mode" id="${safeId}-mode-mcp" data-gen-radio="mcp" class="sr-control">
      <label class="tab-trigger" for="${safeId}-mode-mcp">2. Claude &amp; Cursor (MCP)</label>
      <input type="radio" name="${safeId}-mode" id="${safeId}-mode-sdk" data-gen-radio="sdk" class="sr-control">
      <label class="tab-trigger" for="${safeId}-mode-sdk">3. TypeScript SDK</label>
    </div>

    <div class="gen-pane" data-gen-pane="prompt">
      <p class="gen-note">Paste this into <strong>Cursor, Claude Code, Antigravity, Lovable, Bolt, or Replit</strong> — your coding AI will read our spec and wire everything safely.</p>
      ${renderCodeWell({
        id: `${opts.idPrefix}-code-prompt`,
        label: `Prompt · ${packMeta.plainTitle}`,
        copyLabel: "Copy vibe-coding prompt",
        codeHtml: escapeHtml(promptRaw),
        receiptLeft: "Reads /llms.txt automatically · Enforces $0.05 spend cap",
        receiptRight: "400 / 404 / 502 = $0.00",
        codeDataAttr: 'data-gen-code="prompt"',
        labelDataAttr: 'data-gen-label="prompt"',
      })}
    </div>

    <div class="gen-pane" data-gen-pane="mcp">
      <p class="gen-note">Paste into your MCP client config. Your key stays on your machine — <strong>only HTTP 200 answers settle</strong>.</p>
      ${renderCodeWell({
        id: `${opts.idPrefix}-code-mcp`,
        label: `MCP Config · ${packMeta.mcpRemotePath}`,
        copyLabel: "Copy MCP configuration JSON",
        codeHtml: highlightJson(mcpRaw),
        receiptLeft: "Local signing · MAX_PAYMENT_USD=$0.05",
        receiptRight: `${opts.networkLabel}`,
        codeDataAttr: 'data-gen-code="mcp"',
        labelDataAttr: 'data-gen-label="mcp"',
      })}
    </div>

    <div class="gen-pane" data-gen-pane="sdk">
      <p class="gen-note">Drop into Node.js or TypeScript with <code>@x402/fetch</code> and <code>viem</code>. Swap the URL for any of our ${CATALOG.length} endpoints.</p>
      ${renderCodeWell({
        id: `${opts.idPrefix}-code-sdk`,
        label: `TypeScript · ${packMeta.plainTitle}`,
        copyLabel: "Copy TypeScript SDK quickstart",
        codeHtml: highlightCode(sdkRaw, "ts"),
        receiptLeft: "Client cap: maxAmountPerPayment = $0.05",
        receiptRight: "Zero API keys needed",
        codeDataAttr: 'data-gen-code="sdk"',
        labelDataAttr: 'data-gen-label="sdk"',
      })}
    </div>
  </div>`;
}
