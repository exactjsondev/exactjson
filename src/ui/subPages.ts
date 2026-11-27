import { CATALOG, getActivePacks, getEndpointById, getPackEndpoints } from "../config/catalog";
import {
  CONTACT_EMAIL,
  escapeHtml,
  formatNetworkLabel,
  GLAMA_URL,
  highlightCode,
  MCP_REGISTRY_ID,
  NPM_URL,
  REPO_URL,
  renderCodeWell,
  X402SCAN_URL,
} from "./escape";
import { renderEndpointRows } from "./homePage";
import { renderBrandJsonLd, renderSwissShell } from "./shell";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

export function renderDocsHtml(baseUrl: string, network: string): string {
  const safeBase = escapeHtml(baseUrl);
  const networkLabel = formatNetworkLabel(network);
  const activePacks = getActivePacks();
  const totalTools = 1 + CATALOG.length;

  const packRouteLines = [
    `POST ${baseUrl}/mcp            # Default markets pack (${1 + getPackEndpoints(["markets"]).length} tools)`,
    ...activePacks
      .filter((p) => p.id !== "markets")
      .map(
        (p) =>
          `POST ${baseUrl}${p.mcpPath.padEnd(15, " ")}# ${p.id} pack (${1 + getPackEndpoints([p.id]).length} tools, <=15 per pack)`,
      ),
    `POST ${baseUrl}/mcp/all        # Unified multi-vertical hub (${totalTools} tools)`,
  ].join("\n");

  const packTablesHtml = activePacks
    .map((pack, idx) => {
      const entries = getPackEndpoints([pack.id]);
      const secId = `docs-pack-${pack.id}`;
      const headingId = `${secId}-heading`;
      const num = String(idx + 1).padStart(2, "0");
      return `<section id="${escapeHtml(secId)}" data-pack-section="${escapeHtml(pack.id)}" class="swiss-section">
        <div class="subgroup-bar">
          <h3 id="${escapeHtml(headingId)}">03.${num} // ${escapeHtml(pack.title)} (${entries.length})</h3>
          <p>MCP: <code>${escapeHtml(pack.mcpPath)}</code></p>
        </div>
        <div tabindex="0" role="region" aria-labelledby="${escapeHtml(headingId)}" class="table-wrap">
          <table>
            <caption class="visually-hidden">${escapeHtml(pack.title)} endpoint reference</caption>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">USDC</th>
                <th scope="col">Summary, Constraints &amp; Sample</th>
              </tr>
            </thead>
            <tbody>
              ${renderEndpointRows(entries, baseUrl, "docs")}
            </tbody>
          </table>
        </div>
      </section>`;
    })
    .join("\n");

  const tocPackLinks = activePacks
    .map(
      (pack, idx) =>
        `<a class="toc-link" href="#docs-pack-${escapeHtml(pack.id)}">03.${idx + 1} // ${escapeHtml(pack.id)} [${getPackEndpoints([pack.id]).length}]</a>`,
    )
    .join("\n          ");

  const mainHtml = `
    <div class="docs-layout">
      <aside class="docs-rail" aria-label="Documentation Sections">
        <div class="docs-rail-sticky">
          <span class="coord" style="margin-bottom: 0.25rem;">+ INDEX // SPECIFICATION</span>
          <a class="toc-link" href="#auth-flow">01 // x402 Payment Flow</a>
          <a class="toc-link" href="#mcp-packs">02 // MCP Packs &amp; CLI</a>
          ${tocPackLinks}
          <a class="toc-link" href="#errors">04 // Error &amp; Retry Model</a>
          <a class="toc-link" href="#versioning">05 // Versioning Policy</a>
        </div>
      </aside>

      <div class="docs-main">
        <section class="spec-cell swiss-section" style="padding: 2.25rem 2rem;">
          <span class="coord ok">+ SPECIFICATION // X402 V2 &amp; MODEL CONTEXT PROTOCOL</span>
          <h1 class="page-title">ExactJSON API &amp; MCP Documentation</h1>
          <p class="lead">
            ExactJSON exposes ${CATALOG.length} live, deterministic, pay-per-call JSON endpoints over <strong>x402 V2</strong> (${escapeHtml(networkLabel)}, USDC) and <strong>Model Context Protocol (MCP)</strong>. Zero API keys, zero account registration, and strict Pay-Only-On-Success settlement.
          </p>
          <div class="btn-row" style="margin-top: 0.5rem;">
            <a class="swiss-btn primary" href="${safeBase}/openapi.json">OpenAPI 3.1 Spec →</a>
            <a class="swiss-btn" href="${safeBase}/llms.txt">llms.txt Guide</a>
            <a class="swiss-btn" href="${safeBase}/pricing">Pricing (${CATALOG.length} Endpoints)</a>
            <a class="swiss-btn" href="${escapeHtml(X402SCAN_URL)}">x402scan Verified</a>
          </div>
        </section>

        <section id="auth-flow" class="swiss-section">
          <div class="section-bar">
            <h2 class="coord" style="color: var(--ink-primary);">+ 01 // AUTHENTICATION &amp; X402 V2 HANDSHAKE</h2>
            <span class="coord ok">HTTP 200 OR $0.00</span>
          </div>
          <div class="grid-2">
            <div class="spec-cell surface">
              <span class="coord">STEP 01–02 // UNPAID 402 PROBE</span>
              <h3>Zero API Keys or Accounts</h3>
              <p>Send an unpaid <code>GET /v1/*</code> request to receive HTTP <code>402 Payment Required</code> with a base64-encoded <code>PAYMENT-REQUIRED</code> header specifying exact Base USDC terms ($0.005–$0.02).</p>
            </div>
            <div class="spec-cell surface">
              <span class="coord">STEP 03–04 // CLIENT SIGNING &amp; SETTLEMENT</span>
              <h3>Pay-Only-On-Success</h3>
              <p>Retry with <code>PAYMENT-SIGNATURE</code> signed locally via EIP-3009 (<code>@x402/fetch</code> or <code>exactjson-mcp</code>). Only HTTP <code>200</code> settles; <code>400</code>, <code>404</code>, <code>405</code>, <code>502</code>, and <code>503</code> never charge your wallet.</p>
            </div>
          </div>
        </section>

        <section id="mcp-packs" class="swiss-section">
          <div class="section-bar">
            <h2 class="coord" style="color: var(--ink-primary);">+ 02 // MCP SERVER (STREAMABLE HTTP &amp; STDIO PACKS)</h2>
            <span class="coord">${escapeHtml(MCP_REGISTRY_ID)}</span>
          </div>
          <div class="spec-cell surface">
            <p>Connect x402-native MCP clients directly to ExactJSON's stateless Streamable HTTP endpoints (each pack kept <code>&lt;= 15</code> tools for lean agent context), or run <code>npx -y exactjson-mcp</code> locally with <code>BUYER_PRIVATE_KEY</code> and <code>MAX_PAYMENT_USD=$0.05</code>. Listed on <a href="${NPM_URL}">npm</a>, <a href="${GLAMA_URL}">Glama</a>, and <a href="${escapeHtml(X402SCAN_URL)}">x402scan</a>.</p>
            ${renderCodeWell({
              id: "docs-mcp-routes",
              label: "Remote Streamable HTTP MCP Endpoints",
              copyLabel: "Copy Remote MCP endpoint list",
              codeHtml: highlightCode(packRouteLines, "bash"),
            })}
          </div>
        </section>

        <section class="swiss-section">
          <div class="catalog-toolbar">
            <span class="coord" style="color: var(--ink-primary);">+ 03 // ENDPOINT REFERENCE (${CATALOG.length} PAID + FREE /HEALTH)</span>
            <div class="search-cluster">
              <span id="endpoint-count-live" class="coord ok" role="status" aria-live="polite">${CATALOG.length} LIVE ENDPOINTS</span>
              <label for="endpoint-search" class="visually-hidden">Filter documentation endpoints</label>
              <input type="search" id="endpoint-search" class="search-input" placeholder="Filter endpoints..." autocomplete="off">
            </div>
          </div>
          ${packTablesHtml}
        </section>

        <section class="grid-2" style="border-bottom: none;">
          <div id="errors" class="spec-cell">
            <span class="coord warn">+ 04 // ERROR MODEL &amp; RETRY DISCIPLINE</span>
            <h2>Structured Non-Settling Errors</h2>
            <p>Errors return deterministic JSON with machine-readable <code>error</code> and human-readable <code>message</code> fields. Never retry <code>400</code> (invalid parameter) or <code>404</code> (unlisted target) without fixing inputs. Back off exponentially on <code>502</code> (fail-closed upstream outage) and <code>503</code> (operator pause).</p>
          </div>
          <div id="versioning" class="spec-cell">
            <span class="coord">+ 05 // CONTRACT STABILITY</span>
            <h2>API Versioning &amp; Deprecation Policy</h2>
            <p>All paid routes are path-versioned under <code>/v1/*</code>. Additive fields within <code>v1</code> are non-breaking. Any breaking schema change ships under a new path prefix (<code>/v2/*</code>) with at least 90 days advance notice via standard HTTP <code>Deprecation</code> and <code>Sunset</code> headers.</p>
          </div>
        </section>
      </div>
    </div>`;

  return renderSwissShell({
    baseUrl,
    title: "ExactJSON API Documentation — x402 V2 & MCP Guide",
    description:
      "Complete API and MCP documentation for ExactJSON: x402 V2 Base USDC payment flow, Remote Streamable HTTP /mcp, stdio CLI, endpoint schemas, error model, and v1 versioning policy.",
    canonicalPath: "/docs",
    activeNav: "/docs",
    headerMetaHtml: `<span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Docs · x402 V2</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderPricingHtml(baseUrl: string, network: string): string {
  const networkLabel = formatNetworkLabel(network);
  const activePacks = getActivePacks();
  const p = (id: Parameters<typeof getEndpointById>[0]) => getEndpointById(id).priceFormatted;

  const offerCatalogJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "OfferCatalog",
    name: "ExactJSON Pay-Per-Call x402 API Pricing",
    url: `${baseUrl}/pricing`,
    numberOfItems: CATALOG.length,
    itemListElement: CATALOG.map((entry) => ({
      "@type": "Offer",
      name: `${entry.method} ${entry.path} — ${entry.summary}`,
      description: entry.description,
      price: entry.priceAmount,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${baseUrl}/pricing`,
    })),
  }).replace(/</g, "\\u003c");

  const packPricingTables = activePacks
    .map((pack, idx) => {
      const entries = getPackEndpoints([pack.id]);
      const secId = `pricing-${pack.id}`;
      const rows = entries
        .map(
          (entry) => `<tr>
            <th scope="row" class="ep-cell"><code>${escapeHtml(entry.method)} ${escapeHtml(entry.path)}</code></th>
            <td class="price">${escapeHtml(entry.priceFormatted)} USD</td>
            <td><strong>${escapeHtml(entry.summary)}</strong><div class="desc">Asset: USDC on ${escapeHtml(networkLabel)} · Settles strictly on HTTP 200</div></td>
          </tr>`,
        )
        .join("\n");

      return `<section class="swiss-section">
        <div class="subgroup-bar">
          <h2 id="${escapeHtml(secId)}" style="font-size: 0.95rem;">03.${idx + 1} // ${escapeHtml(pack.title)} (${entries.length})</h2>
          <p><code>${escapeHtml(pack.mcpPath)}</code></p>
        </div>
        <div tabindex="0" role="region" aria-labelledby="${escapeHtml(secId)}" class="table-wrap">
          <table>
            <caption class="visually-hidden">${escapeHtml(pack.title)} USDC pricing</caption>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Price</th>
                <th scope="col">Summary &amp; Settlement Rule</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
    })
    .join("\n");

  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <div class="eyebrow-row">
        <span class="coord ok">+ ECONOMICS // PAY-PER-CALL BASE MAINNET USDC</span>
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Pay-Only-On-Success</span>
      </div>
      <h1 class="page-title">Transparent Micropayments: $0.005–$0.02 / Call.</h1>
      <p class="lead">
        Pay per successful HTTP <code>200</code> response on <strong>${escapeHtml(networkLabel)}</strong>. Zero subscriptions, zero monthly minimums, zero API keys, and free machine discovery routes.
      </p>
    </section>

    <section class="swiss-section" aria-label="HTTP Status Settlement Matrix">
      <div class="section-bar">
        <h2 class="coord" style="color: var(--ink-primary);">+ 01 // HTTP STATUS SETTLEMENT GUARANTEE MATRIX</h2>
        <span class="coord ok">NON-200 NEVER SETTLES</span>
      </div>
      <div class="status-matrix">
        <div class="spec-cell ok-tint">
          <span class="coord ok">HTTP 200 OK</span>
          <h3>Settled ($0.005–.02)</h3>
          <p>Deterministic JSON verified and delivered with <code>PAYMENT-RESPONSE</code> receipt.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord">HTTP 400 / 404</span>
          <h3>$0.00 Charged</h3>
          <p>Invalid query parameter or unlisted token/domain/entity; facilitator never settles.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord warn">HTTP 402</span>
          <h3>$0.00 Challenge</h3>
          <p>Unpaid probe returning live base64 <code>PAYMENT-REQUIRED</code> Base USDC terms.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord warn">HTTP 502</span>
          <h3>$0.00 Fail-Closed</h3>
          <p>Primary upstream engine unavailable; fails closed rather than guessing.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord">HTTP 503</span>
          <h3>$0.00 Paused</h3>
          <p>Operator maintenance gate checked prior to x402 verification.</p>
        </div>
      </div>
    </section>

    <section class="swiss-section" aria-label="Agent Workflow Cost Recipes">
      <div class="section-bar">
        <h2 class="coord" style="color: var(--ink-primary);">+ 02 // MULTI-ENDPOINT AGENT WORKFLOW RECIPES</h2>
        <span class="coord">CLIENT CAP: MAX_PAYMENT_USD=$0.05</span>
      </div>
      <div class="grid-3">
        <div class="spec-cell">
          <span class="coord">RECIPE 01 // PRE-SWAP EVM GUARD</span>
          <h3 style="color: var(--signal-ok); font-family: var(--font-mono);">$0.020 Total</h3>
          <p>Pair <code>/v1/evm/safety</code> (${p("evm_safety")}) + <code>/v1/execution/quote-check</code> (${p("execution_quote_check")}) before swapping unfamiliar ERC-20 tokens.</p>
        </div>
        <div class="spec-cell">
          <span class="coord">RECIPE 02 // SUPPLY-CHAIN GATE</span>
          <h3 style="color: var(--signal-ok); font-family: var(--font-mono);">$0.015 Total</h3>
          <p>Pair <code>/v1/oss/package-audit</code> (${p("oss_package_audit")}) + <code>/v1/oss/runtime-eol</code> (${p("oss_runtime_eol")}) before installing packages or upgrading runtimes.</p>
        </div>
        <div class="spec-cell">
          <span class="coord">RECIPE 03 // DRONE &amp; SITE DISPATCH</span>
          <h3 style="color: var(--signal-ok); font-family: var(--font-mono);">$0.020 Total</h3>
          <p>Pair <code>/v1/space/weather-gnss</code> (${p("space_weather_gnss")}) + <code>/v1/solar/site-window</code> (${p("solar_site_window")}) before autonomous field operations.</p>
        </div>
      </div>
    </section>

    ${packPricingTables}

    <section class="grid-2" style="border-bottom: none;">
      <div class="spec-cell surface">
        <span class="coord ok">+ FREE ENDPOINTS ($0.00)</span>
        <h2>Discovery, Schemas &amp; Health</h2>
        <p><code>GET /health</code>, <code>GET /</code>, <code>GET /docs</code>, <code>GET /pricing</code>, <code>GET /openapi.json</code>, <code>GET /llms.txt</code>, <code>/.well-known/*</code>, and MCP <code>initialize</code> / <code>tools/list</code> / <code>exactjson_health</code> are always free.</p>
      </div>
      <div class="spec-cell surface">
        <span class="coord">+ SPEND CONTROLS</span>
        <h2>Per-Call Budget Enforcement</h2>
        <p>Enforce hard client-side spend ceilings via <code>MAX_PAYMENT_USD="$0.05"</code> in <code>exactjson-mcp</code> or <code>.setSpendControls({ maxAmountPerPayment: "$0.05" })</code> in <code>@x402/fetch</code>.</p>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "ExactJSON Pricing — Pay-Per-Call Base USDC ($0.005–$0.02)",
    description: `Transparent pay-per-call x402 V2 pricing for all ${CATALOG.length} ExactJSON endpoints on Base Mainnet USDC ($0.005 to $0.02/call). Pay only on HTTP 200 success.`,
    canonicalPath: "/pricing",
    activeNav: "/pricing",
    headerMetaHtml: `<span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Base USDC · $0.005–$0.02</span>`,
    jsonLd: offerCatalogJsonLd,
    mainHtml,
  });
}

export function renderAboutHtml(baseUrl: string, network: string): string {
  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <span class="coord ok">+ 01 // MISSION &amp; ARCHITECTURE</span>
      <h1 class="page-title">About ExactJSON</h1>
      <p class="lead">
        ExactJSON builds live, deterministic, token-optimized JSON APIs and Model Context Protocol (MCP) tools engineered specifically for autonomous AI agents and quantitative pipelines.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">+ 02 // SIGNAL COMPRESSION</span>
        <h2>Why ExactJSON Exists</h2>
        <p>Raw DeFi, derivatives, security, and agency feeds routinely return 200 KB+ payloads across hundreds of contracts or records. Feeding raw dumps into an LLM wastes $0.02–$0.15 in context tokens and triggers arithmetic hallucinations. ExactJSON computes safety checks, slippage ladders, volatility surfaces, and compliance gates deterministically at the edge and returns compact ~2 KB JSON.</p>
      </div>
      <div class="spec-cell surface">
        <span class="coord warn">+ 03 // SAFETY BOUNDARIES</span>
        <h2>Fail-Closed Engineering</h2>
        <p>ExactJSON runs on Cloudflare Workers and D1 with x402 V2 settlement on ${escapeHtml(formatNetworkLabel(network))}. Security and compliance endpoints combine authoritative sources (GoPlus + Honeypot.is on EVM; RugCheck on Solana; EU Commission VIES) and fail closed with HTTP <code>502</code> if primary engines are unavailable, never reporting missing data as safe.</p>
      </div>
    </section>

    <section class="grid-2" style="border-bottom: none;">
      <div class="spec-cell">
        <span class="coord">+ 04 // AUTHORITATIVE FEEDS</span>
        <h2>Data Sources &amp; Coverage</h2>
        <p>Coverage spans Markets (GoPlus, Honeypot.is, KyberSwap, DEX Screener, RugCheck, Hyperliquid, dYdX, Kraken, Polymarket, Kalshi, Deribit, US Treasury &amp; NY Fed, BIS 38-country + ECB + Bank of Canada policy rates), Security (deps.dev, OSV.dev, npm/PyPI/crates.io, CISA KEV, FIRST EPSS, MITRE CVE, Cloudflare DoH, IANA RDAP, Statuspage, endoflife.date, Hugging Face Hub, OONI), World (NOAA AviationWeather, FAA NAS, NOAA SWPC, CelesTrak, UN/EU GDACS, USGS Seismic, NASA EONET, MET Norway, US Census/EPA TRI, GOV.UK FCDO, Nager.Date, NASA POWER), Commerce (Frankfurter ECB FX, World Bank, EU Commission VIES, GLEIF LEI, Wikidata, SEC EDGAR, USAspending, US CPSC, openFDA), and Research (Crossref Polite Pool, DataCite, Retraction Watch, NIH PubChem PUG-REST/GHS/NFPA, ClinicalTrials.gov v2, and NIH RxNav/RxNorm).</p>
      </div>
      <div class="spec-cell">
        <span class="coord">+ 05 // VERIFIABLE ECOSYSTEM</span>
        <h2>Open Source &amp; Machine Discovery</h2>
        <p>Source code, tests, and <code>exactjson-mcp</code> are published under MIT on <a href="${REPO_URL}">GitHub</a> and <a href="${NPM_URL}">npm</a> (Official MCP Registry: <code>${escapeHtml(MCP_REGISTRY_ID)}</code>), indexed on <a href="${escapeHtml(X402SCAN_URL)}">x402scan</a> and <a href="${GLAMA_URL}">Glama</a>, with full discovery via OpenAPI 3.1, RFC 9727 API Catalog, A2A Agent Card, and MCP Server Card.</p>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "About ExactJSON — Live, deterministic x402 APIs for AI agents",
    description:
      "Learn how ExactJSON delivers compact, deterministic, fail-closed JSON endpoints and MCP tools for AI agents on Cloudflare Workers and Base Mainnet USDC.",
    canonicalPath: "/about",
    activeNav: "/about",
    headerMetaHtml: `<span class="sig-badge">Open Source · MIT</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderContactHtml(baseUrl: string): string {
  const safeBase = escapeHtml(baseUrl);
  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <span class="coord ok">+ 01 // TECHNICAL SUPPORT &amp; DISCLOSURE</span>
      <h1 class="page-title">Contact ExactJSON</h1>
      <p class="lead">
        Questions about x402 V2 integration, MCP server setup, enterprise rate needs, or responsible vulnerability disclosure? Reach the ExactJSON engineering team directly.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">+ 02 // DIRECT CHANNELS</span>
        <h2>Support &amp; Live Status</h2>
        <p>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><br>Canonical origin: <a href="${safeBase}/">${safeBase}</a><br>Live health gate: <a href="${safeBase}/health"><code>GET /health</code></a></p>
      </div>
      <div class="spec-cell surface">
        <span class="coord">+ 03 // OPEN SOURCE &amp; REGISTRIES</span>
        <h2>Issues &amp; Package Listings</h2>
        <p>Open technical issues on <a href="${REPO_URL}/issues">GitHub Issues</a>, inspect the stdio bridge on <a href="${NPM_URL}">npm (exactjson-mcp)</a> (<code>${escapeHtml(MCP_REGISTRY_ID)}</code>), or view our <a href="${GLAMA_URL}">Glama MCP</a> and <a href="${escapeHtml(X402SCAN_URL)}">x402scan</a> profiles.</p>
      </div>
    </section>

    <section class="spec-cell" style="border-bottom: none;">
      <span class="coord warn">+ 04 // CLIENT-SIDE SIGNING HYGIENE</span>
      <h2>Wallet &amp; Key Security Reminder</h2>
      <p>Never send private keys, seed phrases, or signing secrets in support emails or GitHub issues. ExactJSON signs EIP-3009 Base USDC authorizations strictly client-side in your own wallet or local <code>exactjson-mcp</code> process; we never custody user funds or ask for private keys.</p>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "Contact ExactJSON — Support & Technical Inquiries",
    description:
      "Contact the ExactJSON team at hello@exactjson.com or via GitHub Issues for x402 V2 API integration, MCP server support, and security inquiries.",
    canonicalPath: "/contact",
    activeNav: "/contact",
    headerMetaHtml: `<span class="sig-badge">Support</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderPrivacyHtml(baseUrl: string): string {
  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <span class="coord ok">+ 01 // DATA MINIMIZATION</span>
      <h1 class="page-title">Privacy Policy — ExactJSON</h1>
      <p class="lead">
        ExactJSON is engineered for permissionless machine-to-machine requests with minimal data collection: no user accounts, no login credentials, no tracking cookies, and no third-party ad or analytics scripts.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">+ 02 // ZERO TRACKERS OR COOKIES</span>
        <h2>What We Do Not Collect</h2>
        <p>ExactJSON requires zero API keys, emails, passwords, or billing profiles. Public HTML pages set no cookies, load self-hosted fonts and scripts strictly from the same origin under <code>Content-Security-Policy: default-src 'none'</code>, and store your optional Carbon/Paper theme preference solely in local browser storage.</p>
      </div>
      <div class="spec-cell surface">
        <span class="coord">+ 03 // EDGE TELEMETRY</span>
        <h2>Operational API Logs</h2>
        <p>For paid <code>/v1/*</code> calls and bridged MCP tool executions, ExactJSON logs minimal operational telemetry in Cloudflare D1: requested endpoint path, sanitized query target, HTTP status, outcome classification, transport (<code>http</code> or <code>mcp</code>), latency, and—for settled x402 payments—the public on-chain payer wallet address and Base transaction hash.</p>
      </div>
    </section>

    <section class="grid-2" style="border-bottom: none;">
      <div class="spec-cell">
        <span class="coord">+ 04 // AUTOMATED PRUNING</span>
        <h2>Retention &amp; Edge Processing</h2>
        <p>Unpaid <code>402</code> challenge rows are automatically pruned after 7 days and failed verification logs after 14 days via a daily scheduled job. Settled transaction records are retained for accounting and debugging against public Base blockchain receipts.</p>
      </div>
      <div class="spec-cell">
        <span class="coord">+ 05 // INQUIRIES</span>
        <h2>Privacy Questions</h2>
        <p>For privacy inquiries regarding ExactJSON operational logs, contact <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> or audit our open-source telemetry middleware on <a href="${REPO_URL}">GitHub</a>.</p>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "Privacy Policy — ExactJSON",
    description:
      "ExactJSON privacy policy: zero user accounts, zero tracking cookies, minimal operational telemetry in Cloudflare D1, and automatic pruning of unpaid challenge logs.",
    canonicalPath: "/privacy",
    activeNav: "/privacy",
    headerMetaHtml: `<span class="sig-badge">Privacy</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}
