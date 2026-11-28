import { CATALOG, getActivePacks, getEndpointById, getPackEndpoints } from "../config/catalog";
import {
  CONTACT_EMAIL,
  escapeHtml,
  formatHumanNetwork,
  formatNetworkLabel,
  GLAMA_URL,
  highlightCode,
  MCP_REGISTRY_ID,
  NPM_URL,
  REPO_URL,
  renderCodeWell,
  SECURITY_EMAIL,
  X_HANDLE,
  X_URL,
  X402SCAN_URL,
} from "./escape";
import { renderEndpointRows } from "./homePage";
import { HUMAN_ENDPOINT_ONE_LINER, HUMAN_PACK_META } from "./humanCopy";
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
    `POST ${baseUrl}/mcp/all        # All packs combined (${totalTools} tools)`,
  ].join("\n");

  const packTablesHtml = activePacks
    .map((pack) => {
      const entries = getPackEndpoints([pack.id]);
      const meta = HUMAN_PACK_META[pack.id];
      const secId = `docs-pack-${pack.id}`;
      const headingId = `${secId}-heading`;
      return `<section id="${escapeHtml(secId)}" data-pack-section="${escapeHtml(pack.id)}" class="swiss-section">
        <div class="subgroup-bar">
          <h3 id="${escapeHtml(headingId)}">${escapeHtml(meta.plainTitle)} (${entries.length})</h3>
          <p>MCP: <code>${escapeHtml(pack.mcpPath)}</code></p>
        </div>
        <div tabindex="0" role="region" aria-labelledby="${escapeHtml(headingId)}" class="table-wrap">
          <table>
            <caption class="visually-hidden">${escapeHtml(meta.plainTitle)} endpoint reference</caption>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Price</th>
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
      (pack) =>
        `<a class="toc-link" href="#docs-pack-${escapeHtml(pack.id)}">${escapeHtml(HUMAN_PACK_META[pack.id].label)} (${getPackEndpoints([pack.id]).length})</a>`,
    )
    .join("\n          ");

  const mainHtml = `
    <div class="docs-layout">
      <aside class="docs-rail" aria-label="Documentation Sections">
        <div class="docs-rail-sticky">
          <span class="coord" style="margin-bottom: 0.25rem;">On this page</span>
          <a class="toc-link" href="#auth-flow">How payment works</a>
          <a class="toc-link" href="#mcp-packs">MCP &amp; Vibe Coding</a>
          ${tocPackLinks}
          <a class="toc-link" href="#errors">Errors &amp; retries</a>
          <a class="toc-link" href="#versioning">Versioning</a>
        </div>
      </aside>

      <div class="docs-main">
        <section class="spec-cell swiss-section" style="padding: 2.25rem 2rem;">
          <div class="eyebrow-row">
            <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>API &amp; MCP Docs</span>
            <span class="sig-badge">${escapeHtml(networkLabel)}</span>
          </div>
          <h1 class="page-title">ExactJSON API &amp; MCP Documentation</h1>
          <p class="lead">
            ${CATALOG.length} live, deterministic JSON endpoints over <strong>x402 V2</strong> (Base USDC) and <strong>Model Context Protocol (MCP)</strong>. Payment is authentication — no accounts, no API keys, and $0.00 on errors.
          </p>
          <div class="btn-row" style="margin-top: 0.5rem;">
            <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
            <a class="swiss-btn" href="${safeBase}/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI 3.1 ↗</a>
            <a class="swiss-btn" href="${safeBase}/llms.txt" target="_blank" rel="noopener noreferrer">llms.txt ↗</a>
            <a class="swiss-btn" href="${safeBase}/pricing">Pricing</a>
            <a class="swiss-btn" href="${escapeHtml(X402SCAN_URL)}" target="_blank" rel="noopener noreferrer">x402scan ↗</a>
          </div>
        </section>

        <section id="auth-flow" class="swiss-section">
          <div class="section-bar">
            <h2 class="section-title">How x402 payment works</h2>
            <span class="coord ok">HTTP 200 or $0.00</span>
          </div>
          <div class="grid-2">
            <div class="spec-cell surface">
              <span class="coord">Step 1 · Free 402 quote</span>
              <h3>Inspect exact terms first</h3>
              <p>Send a standard <code>GET /v1/*</code> request to receive HTTP <code>402 Payment Required</code> with a base64-encoded <code>PAYMENT-REQUIRED</code> header quoting exact Base USDC terms ($0.005–$0.02).</p>
            </div>
            <div class="spec-cell surface">
              <span class="coord">Step 2 · Local EIP-3009 signing</span>
              <h3>Pay only on HTTP 200</h3>
              <p>Retry with <code>PAYMENT-SIGNATURE</code> signed locally via <code>@x402/fetch</code> or <code>exactjson-mcp</code>. Only HTTP <code>200</code> settles; <code>400</code>, <code>404</code>, <code>405</code>, <code>502</code>, and <code>503</code> never charge.</p>
            </div>
          </div>
        </section>

        <section id="mcp-packs" class="swiss-section">
          <div class="section-bar">
            <h2 class="section-title">Connect via MCP or Agent Prompt</h2>
            <span class="coord">${escapeHtml(MCP_REGISTRY_ID)}</span>
          </div>
          <div class="spec-cell surface">
            <div class="callout-box ok">
              <strong>Fastest way to wire a client:</strong> Use the <a href="${safeBase}/setup">Quickstart</a> for copy-paste MCP configs, TypeScript SDK snippets, AgentCash direct URLs, and Base USDC signing setup ($0 ETH gas).
            </div>
            <p>Connect x402-native MCP clients directly to our stateless Remote Streamable HTTP routes (each pack stays <code>&lt;= 15</code> tools for sharp tool selection), or run <code>npx -y exactjson-mcp</code> locally with <code>BUYER_PRIVATE_KEY</code> and <code>MAX_PAYMENT_USD="$0.05"</code>. Listed on <a href="${NPM_URL}" target="_blank" rel="noopener noreferrer">npm</a>, <a href="${GLAMA_URL}" target="_blank" rel="noopener noreferrer">Glama</a>, and <a href="${escapeHtml(X402SCAN_URL)}" target="_blank" rel="noopener noreferrer">x402scan</a>.</p>
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
            <h2 class="section-title">All ${CATALOG.length} Endpoints</h2>
            <div class="search-cluster">
              <span id="endpoint-count-live" class="coord ok" role="status" aria-live="polite">${CATALOG.length} live endpoints</span>
              <label for="endpoint-search" class="visually-hidden">Filter documentation endpoints</label>
              <input type="search" id="endpoint-search" class="search-input" placeholder="Search endpoints..." autocomplete="off">
            </div>
          </div>
          ${packTablesHtml}
        </section>

        <section class="grid-2" style="border-bottom: none;">
          <div id="errors" class="spec-cell">
            <span class="coord warn">Non-settling errors ($0.00)</span>
            <h2>Errors &amp; retries</h2>
            <p>Errors return clean JSON with machine-readable <code>error</code> and human-readable <code>message</code> fields. Fix inputs before retrying <code>400</code> (bad input), <code>404</code> (not found), or <code>405</code> (wrong method). Back off exponentially on <code>502</code> (fail-closed upstream outage) and <code>503</code> (maintenance pause).</p>
          </div>
          <div id="versioning" class="spec-cell">
            <span class="coord">Contract stability</span>
            <h2>API stability &amp; versioning</h2>
            <p>All paid routes are versioned under <code>/v1/*</code>. Additive fields within <code>v1</code> are non-breaking. Any breaking schema change ships under a new prefix (<code>/v2/*</code>) with at least 90 days advance notice via HTTP <code>Deprecation</code> and <code>Sunset</code> headers.</p>
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
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderPricingHtml(baseUrl: string, network: string): string {
  const safeBase = escapeHtml(baseUrl);
  const humanNet = formatHumanNetwork(network);
  const activePacks = getActivePacks();
  const p = (id: Parameters<typeof getEndpointById>[0]) => getEndpointById(id).priceFormatted;
  const sumUsd = (...ids: Array<Parameters<typeof getEndpointById>[0]>) =>
    `$${ids.reduce((acc, id) => acc + getEndpointById(id).priceUsd, 0).toFixed(3)} total`;

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
    .map((pack) => {
      const entries = getPackEndpoints([pack.id]);
      const meta = HUMAN_PACK_META[pack.id];
      const secId = `pricing-${pack.id}`;
      const rows = entries
        .map(
          (entry) => `<tr>
            <th scope="row" class="ep-cell"><code>${escapeHtml(entry.method)} ${escapeHtml(entry.path)}</code></th>
            <td class="price">${escapeHtml(entry.priceFormatted)} USDC</td>
            <td>${escapeHtml(HUMAN_ENDPOINT_ONE_LINER[entry.id])}</td>
          </tr>`,
        )
        .join("\n");

      return `<section class="swiss-section">
        <div class="subgroup-bar">
          <h2 id="${escapeHtml(secId)}">${escapeHtml(meta.plainTitle)} (${entries.length})</h2>
          <p>MCP: <code>${escapeHtml(pack.mcpPath)}</code></p>
        </div>
        <div tabindex="0" role="region" aria-labelledby="${escapeHtml(secId)}" class="table-wrap">
          <table>
            <caption class="visually-hidden">${escapeHtml(meta.plainTitle)} USDC pricing</caption>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Price</th>
                <th scope="col">What it checks</th>
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
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Pay only on success</span>
        <span class="sig-badge">${escapeHtml(humanNet)} USDC · $0 ETH gas</span>
      </div>
      <h1 class="page-title">Half a cent to two cents — only when it works.</h1>
      <p class="lead">
        Flat per-call pricing ($5–$20 per 1,000 successful answers) settled in <strong>${escapeHtml(humanNet)}</strong> USDC. No subscriptions, no minimums, no ETH gas, and $0.00 on every error.
      </p>
      <div class="btn-row" style="margin-top: 0.5rem;">
        <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
        <a class="swiss-btn" href="${safeBase}/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI 3.1 ↗</a>
      </div>
    </section>

    <section class="swiss-section" aria-label="HTTP Status Settlement Matrix">
      <div class="section-bar">
        <h2 class="section-title">What settles — and what doesn't</h2>
        <span class="coord ok">Non-200 never settles</span>
      </div>
      <div class="status-matrix">
        <div class="spec-cell ok-tint">
          <span class="coord ok">HTTP 200 OK</span>
          <h3>$0.005–$0.02</h3>
          <p>Verified answer delivered with a receipt.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord">HTTP 400 / 404</span>
          <h3>$0.00</h3>
          <p>Invalid parameters or target not found.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord warn">HTTP 402</span>
          <h3>$0.00</h3>
          <p>Free price quote before your client signs.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord warn">HTTP 502</span>
          <h3>$0.00</h3>
          <p>Primary source offline; fails closed.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord">HTTP 503</span>
          <h3>$0.00</h3>
          <p>Service temporarily paused.</p>
        </div>
      </div>
    </section>

    <section class="swiss-section" aria-label="Typical Multi-Step Workflow Costs">
      <div class="section-bar">
        <h2 class="section-title">Typical multi-step workflow costs</h2>
        <span class="coord">Client cap: MAX_PAYMENT_USD="$0.05"</span>
      </div>
      <div class="grid-3">
        <div class="spec-cell">
          <span class="coord ok">${sumUsd("evm_safety", "execution_quote_check")}</span>
          <h3>Check a crypto token before swapping</h3>
          <p>Pair <code>/v1/evm/safety</code> (${p("evm_safety")}) + <code>/v1/execution/quote-check</code> (${p("execution_quote_check")}) to catch honeypots and real swap slippage before trading.</p>
        </div>
        <div class="spec-cell">
          <span class="coord ok">${sumUsd("macro_global_rates", "options_surface")}</span>
          <h3>Check global rates &amp; BTC/ETH volatility</h3>
          <p>Pair <code>/v1/macro/global-rates</code> (${p("macro_global_rates")}) + <code>/v1/options/surface</code> (${p("options_surface")}) for 38-country central bank rates and live Deribit volatility.</p>
        </div>
        <div class="spec-cell">
          <span class="coord ok">${sumUsd("oss_package_audit", "oss_runtime_eol")}</span>
          <h3>Check an npm package before installing</h3>
          <p>Pair <code>/v1/oss/package-audit</code> (${p("oss_package_audit")}) + <code>/v1/oss/runtime-eol</code> (${p("oss_runtime_eol")}) to catch vulnerabilities, typosquats, and end-of-life runtimes.</p>
        </div>
        <div class="spec-cell">
          <span class="coord ok">${sumUsd("space_weather_gnss", "solar_site_window")}</span>
          <h3>Check drone GPS &amp; flight weather</h3>
          <p>Pair <code>/v1/space/weather-gnss</code> (${p("space_weather_gnss")}) + <code>/v1/solar/site-window</code> (${p("solar_site_window")}) to check solar GPS storms and low-wind flight windows.</p>
        </div>
        <div class="spec-cell">
          <span class="coord ok">${sumUsd("commerce_vat_verify", "entity_company_verify")}</span>
          <h3>Verify an EU company &amp; VAT before paying</h3>
          <p>Pair <code>/v1/commerce/vat-verify</code> (${p("commerce_vat_verify")}) + <code>/v1/entity/company-verify</code> (${p("entity_company_verify")}) to verify EU VAT IDs, IBANs, and ownership before wiring funds.</p>
        </div>
        <div class="spec-cell">
          <span class="coord ok">${sumUsd("science_citation_verify", "bio_drug_trial_brief")}</span>
          <h3>Fact-check a paper &amp; clinical trial</h3>
          <p>Pair <code>/v1/science/citation-verify</code> (${p("science_citation_verify")}) + <code>/v1/bio/drug-trial-brief</code> (${p("bio_drug_trial_brief")}) to catch retracted DOIs and check active Phase 2/3 trials.</p>
        </div>
      </div>
    </section>

    ${packPricingTables}

    <section class="grid-2" style="border-bottom: none;">
      <div class="spec-cell surface">
        <span class="coord ok">Always $0.00</span>
        <h2>Free routes &amp; discovery</h2>
        <p><code>GET /health</code>, <code>/</code>, <code>/setup</code>, <code>/docs</code>, <code>/pricing</code>, <code>/openapi.json</code>, <code>/llms.txt</code>, <code>/.well-known/*</code>, and MCP <code>initialize</code> / <code>tools/list</code> / <code>exactjson_health</code> are always free.</p>
      </div>
      <div class="spec-cell surface">
        <span class="coord">Client-side spend protection</span>
        <h2>Hard per-call spend caps</h2>
        <p>Set a hard limit on every call with <code>MAX_PAYMENT_USD="$0.05"</code> in <code>exactjson-mcp</code> or <code>.setSpendControls({ maxAmountPerPayment: "$0.05" })</code> in <code>@x402/fetch</code>.</p>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "ExactJSON Pricing — Pay-Per-Call Base USDC ($0.005–$0.02)",
    description: `Flat pay-per-call x402 V2 pricing for all ${CATALOG.length} ExactJSON endpoints on Base Mainnet USDC ($0.005–$0.02/call, $5–$20 per 1,000 calls). Pay only on HTTP 200.`,
    canonicalPath: "/pricing",
    activeNav: "/pricing",
    jsonLd: offerCatalogJsonLd,
    mainHtml,
  });
}

export function renderAboutHtml(baseUrl: string, network: string): string {
  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Open Source · MIT</span>
      </div>
      <h1 class="page-title">About ExactJSON</h1>
      <p class="lead">
        ExactJSON queries primary official sources at the edge, runs deterministic math in code, and delivers ~2 KB JSON answers for AI agents — with zero accounts or API keys.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">Why we built it</span>
        <h2>Sharp answers, ~99% smaller payloads</h2>
        <p>Raw financial, security, and government APIs often return 200 KB of noise — burning context tokens and inviting LLM math errors. ExactJSON queries primary sources directly, computes the answer in code, and delivers ~2 KB JSON for $0.005–$0.02 per call.</p>
      </div>
      <div class="spec-cell surface">
        <span class="coord warn">Safety first</span>
        <h2>Fail-closed safety boundary</h2>
        <p>ExactJSON runs on Cloudflare Workers and D1 with gasless USDC settlement on ${escapeHtml(formatHumanNetwork(network))}. Security and compliance checks combine authoritative engines (GoPlus + Honeypot.is on EVM, RugCheck on Solana, EU Commission VIES) and fail closed with HTTP 502 ($0.00 charged) whenever a primary source is offline.</p>
      </div>
    </section>

    <section class="swiss-section" aria-labelledby="sources-heading">
      <div class="section-bar">
        <h2 id="sources-heading" class="section-title">Authoritative data sources by pack</h2>
        <span class="coord">Direct public registries &amp; live feeds</span>
      </div>
      <div class="pack-matrix">
        <article class="spec-cell surface">
          <span class="coord ok">Markets</span>
          <h3>${escapeHtml(HUMAN_PACK_META.markets.plainTitle)}</h3>
          <ul class="clean-list">
            <li><strong>Token &amp; swap safety:</strong> GoPlus, Honeypot.is, KyberSwap, DEX Screener, RugCheck</li>
            <li><strong>Perps, options &amp; odds:</strong> Hyperliquid, dYdX, Kraken, Deribit, Polymarket, Kalshi</li>
            <li><strong>Macro &amp; central banks:</strong> US Treasury, NY Fed, BIS (38 countries), ECB, Bank of Canada</li>
          </ul>
        </article>
        <article class="spec-cell surface">
          <span class="coord ok">Security</span>
          <h3>${escapeHtml(HUMAN_PACK_META.security.plainTitle)}</h3>
          <ul class="clean-list">
            <li><strong>Packages &amp; CVEs:</strong> deps.dev, OSV.dev, npm, PyPI, crates.io, CISA KEV, FIRST EPSS, MITRE CVE</li>
            <li><strong>Domains &amp; networks:</strong> Cloudflare DoH, IANA RDAP, OONI censorship measurements</li>
            <li><strong>Cloud, runtimes &amp; AI:</strong> Statuspage feeds, endoflife.date, Hugging Face Hub</li>
          </ul>
        </article>
        <article class="spec-cell surface">
          <span class="coord ok">World</span>
          <h3>${escapeHtml(HUMAN_PACK_META.world.plainTitle)}</h3>
          <ul class="clean-list">
            <li><strong>Aviation &amp; space:</strong> NOAA AviationWeather, FAA NAS, NOAA SWPC, CelesTrak</li>
            <li><strong>Hazards &amp; solar:</strong> UN/EU GDACS, USGS Seismic, NASA EONET, NASA POWER, MET Norway, US Census &amp; EPA TRI</li>
            <li><strong>Travel:</strong> GOV.UK FCDO advisories, Nager.Date holidays</li>
          </ul>
        </article>
        <article class="spec-cell surface">
          <span class="coord ok">Commerce</span>
          <h3>${escapeHtml(HUMAN_PACK_META.commerce.plainTitle)}</h3>
          <ul class="clean-list">
            <li><strong>VAT &amp; FX:</strong> EU Commission VIES, Frankfurter (ECB FX), World Bank</li>
            <li><strong>Companies:</strong> GLEIF LEI, Wikidata, SEC EDGAR, USAspending</li>
            <li><strong>Product safety:</strong> US CPSC, openFDA</li>
          </ul>
        </article>
        <article class="spec-cell surface">
          <span class="coord ok">Research</span>
          <h3>${escapeHtml(HUMAN_PACK_META.research.plainTitle)}</h3>
          <ul class="clean-list">
            <li><strong>Citations:</strong> Crossref Polite Pool, DataCite, Retraction Watch</li>
            <li><strong>Chemistry:</strong> NIH PubChem (PUG-REST, GHS, NFPA)</li>
            <li><strong>Clinical &amp; drugs:</strong> ClinicalTrials.gov v2, NIH RxNav / RxNorm</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="spec-cell" style="border-bottom: none;">
      <span class="coord">Open source · MIT</span>
      <h2>Inspect the code &amp; public listings</h2>
      <p>The API worker, test suite, and <code>exactjson-mcp</code> package are open source under MIT (Official MCP Registry: <code>${escapeHtml(MCP_REGISTRY_ID)}</code>), with machine discovery via OpenAPI 3.1, RFC 9727 API Catalog, A2A Agent Card, and MCP Server Card.</p>
      <div class="btn-row" style="margin-top: 0.35rem;">
        <a class="swiss-btn" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        <a class="swiss-btn" href="${X_URL}" target="_blank" rel="noopener noreferrer">X (${X_HANDLE}) ↗</a>
        <a class="swiss-btn" href="${NPM_URL}" target="_blank" rel="noopener noreferrer">npm (exactjson-mcp) ↗</a>
        <a class="swiss-btn" href="${GLAMA_URL}" target="_blank" rel="noopener noreferrer">Glama ↗</a>
        <a class="swiss-btn" href="${escapeHtml(X402SCAN_URL)}" target="_blank" rel="noopener noreferrer">x402scan ↗</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "About ExactJSON — Live, deterministic x402 APIs for AI agents",
    description:
      "Learn how ExactJSON delivers compact, deterministic, fail-closed JSON endpoints and MCP tools for AI agents on Cloudflare Workers and Base Mainnet USDC.",
    canonicalPath: "/about",
    activeNav: "/about",
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderContactHtml(baseUrl: string): string {
  const safeBase = escapeHtml(baseUrl);
  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Support &amp; Security</span>
      </div>
      <h1 class="page-title">Contact ExactJSON</h1>
      <p class="lead">
        Questions about x402 setup, MCP packs, higher throughput, or responsible security disclosure? Reach our engineering team directly.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">Direct channels</span>
        <h2>Support &amp; live status</h2>
        <ul class="clean-list">
          <li><strong>General support:</strong> <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li>
          <li><strong>Security disclosures:</strong> <a href="mailto:${SECURITY_EMAIL}">${SECURITY_EMAIL}</a> (<a href="${safeBase}/.well-known/security.txt"><code>security.txt</code></a>)</li>
          <li><strong>Updates on X:</strong> <a href="${X_URL}" target="_blank" rel="noopener noreferrer">${X_HANDLE}</a></li>
          <li><strong>Canonical origin:</strong> <a href="${safeBase}/">${safeBase}</a></li>
          <li><strong>Live health gate:</strong> <a href="${safeBase}/health"><code>GET /health</code></a></li>
        </ul>
      </div>
      <div class="spec-cell surface">
        <span class="coord">Open source &amp; registries</span>
        <h2>Issues &amp; package listings</h2>
        <p>Open technical issues on <a href="${REPO_URL}/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a>, inspect the CLI on <a href="${NPM_URL}" target="_blank" rel="noopener noreferrer">npm (exactjson-mcp)</a> (<code>${escapeHtml(MCP_REGISTRY_ID)}</code>), or view our <a href="${GLAMA_URL}" target="_blank" rel="noopener noreferrer">Glama MCP</a> and <a href="${escapeHtml(X402SCAN_URL)}" target="_blank" rel="noopener noreferrer">x402scan</a> profiles.</p>
      </div>
    </section>

    <section class="spec-cell" style="border-bottom: none;">
      <div class="callout-box warn">
        <strong>Key safety:</strong> Never include private keys or seed phrases in emails or GitHub issues. ExactJSON signs Base USDC authorizations strictly on your device and never custodies funds.
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "Contact ExactJSON — Support & Technical Inquiries",
    description:
      "Contact the ExactJSON team at hello@exactjson.com, report security issues to security@exactjson.com, or reach us on X (@exactjson) and GitHub Issues.",
    canonicalPath: "/contact",
    activeNav: "/contact",
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderPrivacyHtml(baseUrl: string): string {
  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Zero Accounts · Zero Cookies</span>
      </div>
      <h1 class="page-title">Privacy Policy</h1>
      <p class="lead">
        ExactJSON is designed for minimal data collection: no user accounts, no login credentials, no tracking cookies, and no third-party analytics or ad scripts.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">No trackers or profiles</span>
        <h2>What we do not collect</h2>
        <p>ExactJSON requires zero API keys, emails, passwords, or billing profiles. Public HTML pages set no cookies, load self-hosted fonts and scripts strictly from the same origin under <code>Content-Security-Policy: default-src 'none'</code>, and store your optional Carbon Dark theme preference (over the Stark Paper light default) solely in local browser storage.</p>
      </div>
      <div class="spec-cell surface">
        <span class="coord">Minimal edge telemetry</span>
        <h2>Operational API logs</h2>
        <p>For paid <code>/v1/*</code> calls and MCP tool executions, ExactJSON logs minimal operational telemetry in Cloudflare D1: endpoint path, sanitized query target, HTTP status, outcome, transport (<code>http</code> or <code>mcp</code>), latency, and — for settled x402 payments — the public on-chain payer wallet address and Base transaction hash.</p>
      </div>
    </section>

    <section class="grid-2" style="border-bottom: none;">
      <div class="spec-cell">
        <span class="coord">Automated pruning</span>
        <h2>Retention &amp; cleanup</h2>
        <p>A daily scheduled job automatically prunes unpaid <code>402</code> challenge rows after 7 days and failed verification logs after 14 days. Settled transaction records are kept for accounting and debugging against public Base blockchain receipts.</p>
      </div>
      <div class="spec-cell">
        <span class="coord">Questions &amp; audit</span>
        <h2>Privacy questions</h2>
        <p>Questions about ExactJSON operational logs? Email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> or review our open-source telemetry middleware on <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>.</p>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: "Privacy Policy — ExactJSON",
    description:
      "ExactJSON privacy policy: zero user accounts, zero tracking cookies, minimal operational telemetry in Cloudflare D1, and automatic pruning of unpaid challenge logs.",
    canonicalPath: "/privacy",
    activeNav: "/privacy",
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}
