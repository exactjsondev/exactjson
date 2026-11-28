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
  baseDocs: "https://docs.base.org/",
  x402: "https://x402.org",
  nodejs: "https://nodejs.org/",
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
      "Audit EVM and Solana tokens, measure real swap slippage, and track perpetuals, prediction odds, and central bank rates.",
    exampleQuestion: "Is this token a honeypot or high-tax trap?",
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
      "Vet npm, PyPI, and Rust packages before install, verify domains and active CVEs, and check live cloud status.",
    exampleQuestion: "Is this npm or Python package safe to install?",
    exampleAnswer: "Known vulnerabilities, package age, typosquat flags, and OpenSSF score.",
    examplePrice: "$0.01",
    samplePathWithQuery: "/v1/oss/package-audit?package=lodash&ecosystem=npm",
    mcpRemotePath: "/mcp/security",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "security"],
  },
  world: {
    id: "world",
    label: "World",
    plainTitle: "Flights, Weather & Hazards",
    plainSummary:
      "Live airport delays, travel advisories, seismic and disaster briefs, drone GNSS space weather, and solar windows.",
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
    plainTitle: "Invoices, Entities & Recalls",
    plainSummary:
      "Verify EU VAT IDs and IBANs, inspect corporate registries, calculate banking settlement dates, and screen product recalls.",
    exampleQuestion: "Is this EU VAT number valid before we pay?",
    exampleAnswer: "Live EU VIES registration check plus IBAN and country-mismatch flags.",
    examplePrice: "$0.01",
    samplePathWithQuery: "/v1/commerce/vat-verify?vat=IE6388047V",
    mcpRemotePath: "/mcp/commerce",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "commerce"],
  },
  research: {
    id: "research",
    label: "Research",
    plainTitle: "Papers, Chemistry & Trials",
    plainSummary:
      "Verify DOIs and catch retractions, pull GHS chemical hazard profiles, and track Phase 2/3 clinical trial catalysts.",
    exampleQuestion: "Was this paper retracted or mis-cited?",
    exampleAnswer: "Live Crossref/DataCite verification plus Retraction Watch flags.",
    examplePrice: "$0.005",
    samplePathWithQuery: "/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2",
    mcpRemotePath: "/mcp/research",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "research"],
  },
};

export const HUMAN_ENDPOINT_ONE_LINER: Readonly<Record<EndpointId, string>> = {
  evm_safety: "Audit an Ethereum or Base token for honeypots, hidden taxes, and thin liquidity.",
  execution_quote_check: "Measure real swap or perp price impact across trade sizes before executing.",
  solana_safety: "Audit a Solana token for rug flags, mint authorities, and live liquidity.",
  solana_trending: "Browse trending Solana pools pre-screened for common safety risks.",
  perps_snapshot: "Live snapshot of Hyperliquid funding, spread, and orderbook depth.",
  perps_screener: "Scan 180+ Hyperliquid perpetual markets for extreme funding or volume.",
  perps_funding_arb: "Compare annualized perp funding spreads across Hyperliquid, dYdX, and Kraken.",
  predictions_arb: "Find fee-adjusted arbitrage spreads between Polymarket and Kalshi.",
  predictions_scanner: "Search live Polymarket and Kalshi odds, spreads, and implied carry.",
  options_surface: "Read Deribit BTC or ETH implied volatility, skew, and max pain levels.",
  macro_liquidity: "Track live US Treasury cash, Fed reverse repo, and net USD liquidity.",
  macro_global_rates: "Compare official central bank interest rates across 38 countries.",
  oss_package_audit: "Check an npm, PyPI, or Rust package for vulnerabilities or typosquats.",
  net_domain_trust: "Check malware sinkholes, DNSSEC, SPF/DMARC posture, and domain age.",
  sec_cve_triage: "See if a CVE is actively exploited in the wild and which version fixes it.",
  ops_cloud_status: "Check live outage status for GitHub, Cloudflare, OpenAI, Anthropic, Vercel, and npm.",
  oss_runtime_eol: "Check if a Node, Python, Postgres, or OS version is past end-of-life.",
  ai_model_audit: "Verify Hugging Face model licenses, safetensors format, and GPU VRAM needs.",
  net_censorship_check: "Check if a website is blocked or throttled in a specific country.",
  aviation_airport_delays: "Check live airport weather, flight category, and FAA ground stops.",
  space_weather_gnss: "Check solar storms affecting drone GPS accuracy, compasses, and satellites.",
  geo_hazard_brief: "Get active earthquakes, disasters, and site hazard alerts for any coordinates.",
  travel_destination_brief: "Get official travel advisories, regional alerts, and upcoming public holidays.",
  solar_site_window: "Check solar irradiance and 7-day low-wind windows for outdoor or drone ops.",
  commerce_settlement_window: "Calculate cross-border banking settlement dates, holidays, and FX buffers.",
  commerce_vat_verify: "Verify an EU VAT ID live and validate IBAN/BIC invoice details.",
  entity_company_verify: "Verify a company's legal entity ID, ownership tree, and public filings.",
  consumer_safety_recall: "Search official US consumer product, food, drug, and device recalls.",
  science_citation_verify: "Verify a paper DOI or arXiv link and catch hallucinations or retractions.",
  chem_hazard_profile: "Look up official PubChem GHS toxicity, flammability, and safety ratings.",
  bio_drug_trial_brief: "Track active Phase 2/3 clinical trials and official drug classifications.",
};

export interface HumanFaqItem {
  id: string;
  question: string;
  answer: string;
}

export const HUMAN_FAQ: readonly HumanFaqItem[] = [
  {
    id: "faq-web-search",
    question: "Why not just use web search or call upstream APIs directly?",
    answer:
      "Web search scrapes bulky pages and misses live registries like EU VIES, FAA ground stops, Retraction Watch, and L2 orderbooks. Calling upstream APIs directly means managing dozens of keys and burning context tokens on 200 KB responses. ExactJSON gives your agent the computed answer in one ~2 KB call.",
  },
  {
    id: "faq-pricing-roi",
    question: "How does pricing compare to LLM tokens and other x402 APIs?",
    answer:
      "Every endpoint is $0.005–$0.02 ($5–$20 per 1,000 calls) — below the x402 ecosystem median (~$0.028) and typically cheaper than the input tokens an LLM spends parsing raw upstream JSON.",
  },
  {
    id: "faq-errors-free",
    question: "What happens if a lookup fails or a primary source is down?",
    answer:
      "You pay $0.00. Payment settles only on HTTP 200. Invalid parameters (400), missing targets (404), upstream outages (502), and pauses (503) never charge — and security checks fail closed instead of guessing.",
  },
  {
    id: "faq-keys-limits",
    question: "How do signing keys, gas fees, and spend limits work?",
    answer:
      "Payments sign locally on your machine via gasless Base USDC (EIP-3009), so no ETH is required for gas and ExactJSON never sees your key. Use a dedicated low-balance address and keep MAX_PAYMENT_USD set to $0.05 in your client.",
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

export function buildMcpConfigSnippet(_baseUrl: string, pack: SetupPackChoice): string {
  const meta = HUMAN_PACK_META[pack];
  const serverKey = pack === "all" ? "exactjson" : `exactjson-${pack}`;
  return JSON.stringify(
    {
      mcpServers: {
        [serverKey]: {
          command: "npx",
          args: [...meta.stdioArgs],
          env: {
            BUYER_PRIVATE_KEY: "0xYOUR_BASE_WALLET_PRIVATE_KEY",
            MAX_PAYMENT_USD: "$0.05",
          },
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
        <span class="gen-pack-label">Pack:</span>
        ${packButtons}
      </div>
      <span class="gen-status" data-gen-status role="status" aria-live="polite">Selected: ${escapeHtml(packMeta.plainTitle)} · Single packs (&lt;=15 tools) give sharpest MCP tool selection</span>
    </div>

    <div class="gen-tabs" role="radiogroup" aria-label="Choose integration method">
      <input type="radio" name="${safeId}-mode" id="${safeId}-mode-prompt" data-gen-radio="prompt" class="sr-control" checked>
      <label class="tab-trigger" for="${safeId}-mode-prompt">1. Agent Prompt</label>
      <input type="radio" name="${safeId}-mode" id="${safeId}-mode-mcp" data-gen-radio="mcp" class="sr-control">
      <label class="tab-trigger" for="${safeId}-mode-mcp">2. MCP Config</label>
      <input type="radio" name="${safeId}-mode" id="${safeId}-mode-sdk" data-gen-radio="sdk" class="sr-control">
      <label class="tab-trigger" for="${safeId}-mode-sdk">3. TypeScript SDK</label>
    </div>

    <div class="gen-pane" data-gen-pane="prompt">
      <p class="gen-note">Paste into <strong>Cursor, Claude Code, Antigravity, Lovable, Bolt, or Replit</strong> — your coding agent reads <code>/llms.txt</code> and wires the client safely.</p>
      ${renderCodeWell({
        id: `${opts.idPrefix}-code-prompt`,
        label: `Agent Prompt · ${packMeta.plainTitle}`,
        copyLabel: "Copy agent setup prompt",
        codeHtml: escapeHtml(promptRaw),
        receiptLeft: "Reads /llms.txt · Enforces $0.05 spend cap",
        receiptRight: "400 / 404 / 502 = $0.00",
        codeDataAttr: 'data-gen-code="prompt"',
        labelDataAttr: 'data-gen-label="prompt"',
      })}
    </div>

    <div class="gen-pane" data-gen-pane="mcp">
      <p class="gen-note">Paste into Claude Desktop, Cursor, or Windsurf. Signing stays local on your machine, and <strong>only HTTP 200 answers charge</strong>.</p>
      ${renderCodeWell({
        id: `${opts.idPrefix}-code-mcp`,
        label: `Local MCP · npx ${packMeta.stdioArgs.join(" ")}`,
        copyLabel: "Copy MCP configuration JSON",
        codeHtml: highlightJson(mcpRaw),
        receiptLeft: "Local EIP-3009 signing · MAX_PAYMENT_USD=$0.05",
        receiptRight: "$0 ETH gas",
        codeDataAttr: 'data-gen-code="mcp"',
        labelDataAttr: 'data-gen-label="mcp"',
      })}
      <p class="gen-remote-note">Already using <strong>AgentCash</strong> or an x402-native MCP client? Point directly to <code data-gen-remote-url>${escapeHtml(opts.baseUrl)}${escapeHtml(packMeta.mcpRemotePath)}</code> — no local bridge needed.</p>
    </div>

    <div class="gen-pane" data-gen-pane="sdk">
      <p class="gen-note">Drop into Node.js or TypeScript with <code>@x402/fetch</code> and <code>viem</code>. Swap the URL for any of our ${CATALOG.length} endpoints.</p>
      ${renderCodeWell({
        id: `${opts.idPrefix}-code-sdk`,
        label: `TypeScript · ${packMeta.plainTitle}`,
        copyLabel: "Copy TypeScript SDK quickstart",
        codeHtml: highlightCode(sdkRaw, "ts"),
        receiptLeft: "Client cap: maxAmountPerPayment = $0.05",
        receiptRight: "Payment is authentication",
        codeDataAttr: 'data-gen-code="sdk"',
        labelDataAttr: 'data-gen-label="sdk"',
      })}
    </div>
  </div>`;
}
