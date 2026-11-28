import {
  CATALOG,
  type EndpointCatalogEntry,
  type EndpointId,
  getActivePacks,
  getEndpointById,
  getPackEndpoints,
  SERVICE_NAME,
} from "../config/catalog";
import {
  escapeHtml,
  formatHumanNetwork,
  formatNetworkLabel,
  highlightJson,
  renderCodeWell,
  stripPackDisclaimer,
} from "./escape";
import {
  buildMcpConfigSnippet,
  buildVibePrompt,
  HUMAN_ENDPOINT_ONE_LINER,
  HUMAN_FAQ,
  HUMAN_PACK_META,
  POPULAR_ENDPOINT_IDS,
  POPULAR_ENDPOINT_SET,
  renderDialog,
  renderPackSetupWidget,
} from "./humanCopy";
import { renderBrandJsonLd, renderSwissShell } from "./shell";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

const highlightedSampleCache = new Map<EndpointId, string>();
const escapedSampleJsonCache = new Map<EndpointId, string>();

function getHighlightedSample(entry: EndpointCatalogEntry): string {
  const cached = highlightedSampleCache.get(entry.id);
  if (cached !== undefined) {
    return cached;
  }
  const highlighted = highlightJson(JSON.stringify(entry.outputExample, null, 2));
  highlightedSampleCache.set(entry.id, highlighted);
  return highlighted;
}

function getEscapedSampleJson(entry: EndpointCatalogEntry): string {
  const cached = escapedSampleJsonCache.get(entry.id);
  if (cached !== undefined) {
    return cached;
  }
  const escaped = escapeHtml(JSON.stringify(entry.outputExample, null, 2));
  escapedSampleJsonCache.set(entry.id, escaped);
  return escaped;
}

export function renderEndpointRows(
  entries: readonly EndpointCatalogEntry[],
  baseUrl: string,
  idPrefix = "ep",
): string {
  return entries
    .map((entry) => {
      const sampleQuery = `${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}`;
      const sampleUrl = `${baseUrl}${sampleQuery}`;
      const highlightedJson = getHighlightedSample(entry);
      const snippetId = `${idPrefix}-json-${entry.id}`;
      const oneLiner = HUMAN_ENDPOINT_ONE_LINER[entry.id];
      const searchBlob = `${entry.path} ${entry.summary} ${oneLiner} ${entry.pack} ${entry.tags.join(" ")}`;

      return `<tr data-endpoint-row data-pack="${escapeHtml(entry.pack)}" data-search-text="${escapeHtml(searchBlob)}">
        <th scope="row" class="ep-cell"><code>GET ${escapeHtml(entry.path)}</code></th>
        <td class="price">${escapeHtml(entry.priceFormatted)} USDC</td>
        <td>
          <strong>${escapeHtml(entry.summary)}</strong>
          <div class="desc">${escapeHtml(stripPackDisclaimer(entry))}</div>
          <div class="sample">
            <a href="${escapeHtml(sampleUrl)}"><code>${escapeHtml(sampleUrl)}</code></a>
          </div>
          <details class="sample-details">
            <summary>Sample JSON response (${escapeHtml(entry.path)})</summary>
            <div class="sample-json-wrap">
              <div class="code-well-bar">
                <span class="code-well-label">${escapeHtml(entry.method)} ${escapeHtml(entry.path)} · HTTP 200 OK</span>
                <span class="copy-wrap">
                  <button type="button" class="copy-btn" command="--copy" commandfor="${escapeHtml(snippetId)}" aria-label="Copy sample JSON for ${escapeHtml(entry.path)}">
                    <span class="copy-text-idle" aria-hidden="true">Copy</span>
                    <span class="copy-text-done" aria-hidden="true">✓ Copied</span>
                    <span class="copy-text-fail" aria-hidden="true">! Failed</span>
                  </button>
                  <span class="copy-tip" role="status"></span>
                </span>
              </div>
              <pre class="sample-json" tabindex="0"><code id="${escapeHtml(snippetId)}">${highlightedJson}</code></pre>
            </div>
          </details>
        </td>
      </tr>`;
    })
    .join("\n");
}

function renderCompactEndpointRows(
  entries: readonly EndpointCatalogEntry[],
  baseUrl: string,
): string {
  return entries
    .map((entry) => {
      const sampleQuery = `${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}`;
      const sampleUrl = `${baseUrl}${sampleQuery}`;
      const isPopular = POPULAR_ENDPOINT_SET.has(entry.id);
      const packLabel = HUMAN_PACK_META[entry.pack].label;
      const oneLiner = HUMAN_ENDPOINT_ONE_LINER[entry.id];
      const searchBlob = `${entry.path} ${entry.summary} ${oneLiner} ${entry.pack} ${packLabel} ${entry.tags.join(" ")}`;
      const escapedJson = getEscapedSampleJson(entry);

      return `<tr data-endpoint-row data-pack="${escapeHtml(entry.pack)}" data-popular="${isPopular ? "true" : "false"}" data-search-text="${escapeHtml(searchBlob)}">
        <th scope="row" class="ep-cell"><a href="${escapeHtml(sampleUrl)}"><code>GET ${escapeHtml(entry.path)}</code></a><span class="pack-chip">${escapeHtml(packLabel)}</span></th>
        <td class="price">${escapeHtml(entry.priceFormatted)}</td>
        <td>${escapeHtml(oneLiner)}</td>
        <td class="action-cell"><button type="button" class="preview-btn" data-preview-tool="${escapeHtml(entry.id)}" data-preview-path="GET ${escapeHtml(entry.path)}" data-preview-price="${escapeHtml(entry.priceFormatted)} USDC" data-preview-summary="${escapeHtml(oneLiner)}" data-sample-url="${escapeHtml(sampleUrl)}" data-preview-pack="${escapeHtml(entry.pack)}">Preview</button><template id="tpl-json-${escapeHtml(entry.id)}">${escapedJson}</template></td>
      </tr>`;
    })
    .join("\n");
}

export function renderLandingHtml(baseUrl: string, network: string): string {
  const safeBase = escapeHtml(baseUrl);
  const networkLabel = formatNetworkLabel(network);
  const humanNet = formatHumanNetwork(network);
  const activePacks = getActivePacks();

  // Hero Tab 1: Flagship Live Answer (/v1/evm/safety)
  const flagship = getEndpointById("evm_safety");
  const payloadWell = renderCodeWell({
    id: "hero-payload-json",
    label: `GET ${flagship.path}?${new URLSearchParams(flagship.exampleQueryParams).toString()}`,
    copyLabel: "Copy sample ExactJSON response",
    codeHtml: getHighlightedSample(flagship),
    receiptLeft: `HTTP 200 OK · ${flagship.priceFormatted} USDC (${networkLabel})`,
    receiptRight: "400 / 404 / 502 = $0.00",
  });

  // Hero Tab 2: Agent Prompt
  const promptWell = renderCodeWell({
    id: "hero-prompt-code",
    label: `Agent Prompt · ${HUMAN_PACK_META.all.plainTitle}`,
    copyLabel: "Copy agent setup prompt",
    codeHtml: escapeHtml(buildVibePrompt(baseUrl, "all")),
    receiptLeft: "Reads /llms.txt · $0.05 spend cap",
    receiptRight: "400 / 404 / 502 = $0.00",
  });

  // Hero Tab 3: MCP Config
  const mcpWell = renderCodeWell({
    id: "hero-mcp-json",
    label: "Local MCP · npx -y exactjson-mcp",
    copyLabel: "Copy MCP client configuration JSON",
    codeHtml: highlightJson(buildMcpConfigSnippet(baseUrl, "markets")),
    receiptLeft: "Local EIP-3009 signing · MAX_PAYMENT_USD=$0.05",
    receiptRight: "$0 ETH gas",
  });

  // Section 3: 5 Focused Tool Packs
  const packMatrixHtml = activePacks
    .map((pack) => {
      const count = getPackEndpoints([pack.id]).length;
      const meta = HUMAN_PACK_META[pack.id];

      return `<article class="spec-cell surface">
        <div class="eyebrow-row" style="justify-content: space-between;">
          <span class="coord">${escapeHtml(meta.label)}</span>
          <span class="sig-badge ok">${count} tools</span>
        </div>
        <h3>${escapeHtml(meta.plainTitle)}</h3>
        <p>${escapeHtml(meta.plainSummary)}</p>
        <div class="pack-example-q">&ldquo;${escapeHtml(meta.exampleQuestion)}&rdquo; → <strong>${escapeHtml(meta.examplePrice)}</strong></div>
        <div class="pack-card-foot">
          <code>${escapeHtml(pack.mcpPath)}</code>
          <a href="#endpoints" data-jump-pack="${escapeHtml(pack.id)}">Browse ${escapeHtml(meta.label)} →</a>
        </div>
      </article>`;
    })
    .join("\n");

  // Section 4: Pack filter radios & labels (Popular checked by default)
  const packTabRadios = [
    `<input type="radio" name="pack-tab" id="pack-tab-popular" class="sr-control" checked>`,
    `<input type="radio" name="pack-tab" id="pack-tab-all" class="sr-control">`,
    ...activePacks.map(
      (pack) =>
        `<input type="radio" name="pack-tab" id="pack-tab-${escapeHtml(pack.id)}" class="sr-control">`,
    ),
  ].join("\n          ");

  const packTabLabels = [
    `<label class="pack-pill" for="pack-tab-popular">Popular (${POPULAR_ENDPOINT_IDS.length})</label>`,
    `<label class="pack-pill" for="pack-tab-all">All (${CATALOG.length})</label>`,
    ...activePacks.map(
      (pack) =>
        `<label class="pack-pill" for="pack-tab-${escapeHtml(pack.id)}">${escapeHtml(HUMAN_PACK_META[pack.id].label)} (${getPackEndpoints([pack.id]).length})</label>`,
    ),
  ].join("\n          ");

  // Section 6: Plain-English FAQ
  const faqHtml = HUMAN_FAQ.map(
    (item) => `<details class="faq-item" id="${escapeHtml(item.id)}">
        <summary>${escapeHtml(item.question)}</summary>
        <div class="faq-answer">${escapeHtml(item.answer)}</div>
      </details>`,
  ).join("\n      ");

  // Floating Modals: Reusable Tool Preview Dialog + Quick Wallet Guide
  const toolPreviewModal = renderDialog({
    id: "tool-preview-dialog",
    eyebrow: "Sample JSON Response",
    title: "Live tool preview",
    bodyHtml: `
      <p id="preview-dialog-summary" class="modal-lead"></p>
      <div class="modal-url-bar">
        <div class="modal-url-scroll">
          <a id="preview-dialog-url-link" href="#" target="_blank" rel="noopener noreferrer"><span id="preview-dialog-url"></span></a>
        </div>
        <span class="copy-wrap">
          <button type="button" class="copy-btn" command="--copy" commandfor="preview-dialog-url" aria-label="Copy sample request URL">
            <span class="copy-text-idle" aria-hidden="true">Copy</span>
            <span class="copy-text-done" aria-hidden="true">✓ Copied</span>
            <span class="copy-text-fail" aria-hidden="true">! Failed</span>
          </button>
          <span class="copy-tip" role="status"></span>
        </span>
      </div>
      <div class="code-well">
        <div class="code-well-bar">
          <span id="preview-dialog-code-label" class="code-well-label">HTTP 200 OK · Sample JSON</span>
          <span class="copy-wrap">
            <button type="button" class="copy-btn" command="--copy" commandfor="preview-dialog-json" aria-label="Copy sample JSON response">
              <span class="copy-text-idle" aria-hidden="true">Copy</span>
              <span class="copy-text-done" aria-hidden="true">✓ Copied</span>
              <span class="copy-text-fail" aria-hidden="true">! Failed</span>
            </button>
            <span class="copy-tip" role="status"></span>
          </span>
        </div>
        <pre class="sample-json" tabindex="0"><code id="preview-dialog-json"></code></pre>
      </div>`,
    footerHtml: `
      <button type="button" class="swiss-btn primary" id="preview-dialog-connect" data-connect-pack="markets">Connect this pack →</button>
      <button type="button" class="swiss-btn" data-close-dialog>Close</button>`,
  });

  const mainHtml = `
    <section class="hero-split" aria-label="ExactJSON overview">
      <div class="hero-narrative">
        <div class="eyebrow-row">
          <span class="coord">Live, deterministic x402 APIs for AI agents</span>
          <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Pay only on success</span>
        </div>

        <h1 class="display-title">Live facts and exact math, distilled to ~2 KB.</h1>

        <p class="lead">
          Raw financial, security, and government APIs dump hundreds of kilobytes of noise into your context window. <strong>${escapeHtml(SERVICE_NAME)}</strong> queries the primary source, runs the math in code, and returns a clean ~2 KB answer — for $0.005–$0.02 per successful call on ${escapeHtml(humanNet)} USDC. No accounts, no API keys, and $0 on errors.
        </p>

        <div class="btn-row">
          <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
          <a class="swiss-btn" href="#endpoints">Explore ${CATALOG.length} Tools</a>
          <a class="swiss-btn" href="${safeBase}/docs">Docs</a>
        </div>

        <div class="kpi-strip" role="group" aria-label="Key service highlights">
          <div class="kpi-cell">
            <div class="kpi-val">${CATALOG.length}</div>
            <div class="kpi-lbl">Live endpoints</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-val">~99%</div>
            <div class="kpi-lbl">Smaller payloads</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-val">$0.005–.02</div>
            <div class="kpi-lbl">Per real answer</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-val">$0.00</div>
            <div class="kpi-lbl">On errors &amp; gas</div>
          </div>
        </div>
      </div>

      <div class="hero-inspector" role="region" aria-label="Live output, agent prompt, and MCP inspector">
        <div class="inspector-tabs" role="radiogroup" aria-label="Inspector view">
          <input type="radio" name="hero-mode" id="hero-mode-payload" class="sr-control" checked>
          <label class="tab-trigger" for="hero-mode-payload">1. Live Output</label>
          <input type="radio" name="hero-mode" id="hero-mode-prompt" class="sr-control">
          <label class="tab-trigger" for="hero-mode-prompt">2. Agent Prompt</label>
          <input type="radio" name="hero-mode" id="hero-mode-mcp" class="sr-control">
          <label class="tab-trigger" for="hero-mode-mcp">3. MCP Config</label>
        </div>

        <div class="inspector-pane" data-pane="payload">
          <div class="compare-visual">
            <div class="compare-row">
              <span class="compare-label">Raw upstream feeds</span>
              <span class="compare-metric">~214.6 KB (~54,000 tokens)</span>
              <div class="compare-track" aria-hidden="true"><div class="compare-bar-raw"></div></div>
            </div>
            <div class="compare-row">
              <span class="compare-label">ExactJSON answer</span>
              <span class="compare-metric ok">1.8 KB · -99.1% tokens</span>
              <div class="compare-track" aria-hidden="true"><div class="compare-bar-exact"></div></div>
            </div>
          </div>
          ${payloadWell}
        </div>

        <div class="inspector-pane" data-pane="prompt">
          <div class="compression-bar">
            <span>Works in Cursor, Claude Code, Antigravity, Lovable &amp; Bolt</span>
            <span class="coord ok">1-click copy</span>
          </div>
          ${promptWell}
        </div>

        <div class="inspector-pane" data-pane="mcp">
          <div class="compression-bar">
            <span>Claude Desktop, Cursor &amp; Remote Streamable HTTP</span>
            <span class="coord ok">${CATALOG.length} paid + 1 free tool</span>
          </div>
          ${mcpWell}
        </div>
      </div>
    </section>

    <section class="swiss-section grid-3" aria-label="Why ExactJSON">
      <div class="spec-cell">
        <h2>Direct from the source</h2>
        <p>Every answer comes straight from live registries and exchanges — EU VIES, FAA, NOAA, OSV, Crossref, BIS, Hyperliquid — with exact math computed in code. If a primary source goes offline, we fail closed and charge $0.00.</p>
      </div>
      <div class="spec-cell">
        <h2>Cheaper than raw tokens</h2>
        <p>Feeding 200 KB of raw upstream JSON into an LLM costs $0.02–$0.15 in input tokens and invites math errors. Compressing it to ~2 KB usually pays for the API call itself.</p>
      </div>
      <div class="spec-cell">
        <h2>Pay as your agent runs</h2>
        <p>Payment is authentication. Calls settle in Base USDC with zero ETH gas and client-side spend caps ($0.05 default). Invalid queries, missing targets, and outages never charge.</p>
      </div>
    </section>

    <section class="swiss-section" aria-labelledby="packs-heading">
      <div class="section-bar">
        <h2 id="packs-heading" class="section-title">Five focused packs</h2>
        <span class="coord ok">&lt;= 15 tools per pack for sharp tool selection</span>
      </div>
      <div class="pack-matrix">
        ${packMatrixHtml}
      </div>
    </section>

    <section id="endpoints" class="swiss-section" aria-labelledby="endpoints-heading">
      <div class="section-bar">
        <h2 id="endpoints-heading" class="section-title">Explore live endpoints</h2>
        <span id="endpoint-count-live" class="coord ok" role="status" aria-live="polite">${POPULAR_ENDPOINT_IDS.length} popular tools (${CATALOG.length} total)</span>
      </div>

      <div class="catalog-toolbar">
        <div class="pack-tabs" role="radiogroup" aria-label="Filter tools by pack">
          ${packTabRadios}
          ${packTabLabels}
        </div>
        <div class="search-cluster">
          <label for="endpoint-search" class="visually-hidden">Search all ${CATALOG.length} tools</label>
          <input type="search" id="endpoint-search" class="search-input" placeholder="Search ${CATALOG.length} tools (vat, npm, airport...)" autocomplete="off">
        </div>
      </div>

      <div tabindex="0" role="region" aria-labelledby="endpoints-heading" class="table-wrap">
        <table>
          <caption class="visually-hidden">Live ExactJSON pay-per-call tools</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">Price</th>
              <th scope="col">What it checks</th>
              <th scope="col" class="action-cell">Sample</th>
            </tr>
          </thead>
          <tbody>
            ${renderCompactEndpointRows(CATALOG, baseUrl)}
          </tbody>
        </table>
      </div>
    </section>

    <section id="quickstart" class="swiss-section" aria-labelledby="quickstart-heading">
      <div class="section-bar">
        <h2 id="quickstart-heading" class="section-title">Connect in under a minute</h2>
        <div class="btn-row">
          <a class="swiss-btn primary" href="${safeBase}/setup">Full Quickstart →</a>
        </div>
      </div>
      ${renderPackSetupWidget({ baseUrl, idPrefix: "home-gen", defaultPack: "all", networkLabel })}
    </section>

    <section class="swiss-section" aria-labelledby="faq-heading">
      <div class="section-bar">
        <h2 id="faq-heading" class="section-title">Questions</h2>
        <span class="coord">Pricing, safety &amp; signing</span>
      </div>
      <div class="faq-list">
        ${faqHtml}
      </div>
    </section>

    <section id="discovery" class="swiss-section" style="border-bottom: none;" aria-labelledby="discovery-heading">
      <div class="section-bar">
        <h2 id="discovery-heading" class="section-title">Machine discovery</h2>
        <span class="coord ok">Free · Vary: Accept · CORS enabled</span>
      </div>
      <div class="grid-3">
        <div class="spec-cell">
          <span class="coord ok">Accept: text/html</span>
          <h3>Human docs (you are here)</h3>
          <p>Interactive endpoint explorer, sample payloads, and copy-paste configs.</p>
        </div>
        <div class="spec-cell">
          <span class="coord">Accept: text/markdown</span>
          <h3>Clean Markdown</h3>
          <p>Serves compact <code>/llms.txt</code> Markdown directly from <code>/</code>, <code>/setup</code>, <code>/docs</code>, and <code>/pricing</code>.</p>
        </div>
        <div class="spec-cell">
          <span class="coord">Accept: application/json</span>
          <h3>JSON catalog in &lt;10ms</h3>
          <p>Default for <code>*/*</code> and agents: endpoint index, pack map, and RFC 9727 <code>Link</code> headers.</p>
        </div>
      </div>
      <div class="discovery-matrix">
        <a class="disc-cell" href="${safeBase}/mcp" target="_blank" rel="noopener noreferrer"><span class="disc-path">/mcp ↗</span><span class="disc-note">Remote Streamable HTTP MCP (JSON-RPC 2.0)</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/x402" target="_blank" rel="noopener noreferrer"><span class="disc-path">/.well-known/x402 ↗</span><span class="disc-note">x402 Resource Discovery Manifest</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/x402.json" target="_blank" rel="noopener noreferrer"><span class="disc-path">/.well-known/x402.json ↗</span><span class="disc-note">x402 JSON Manifest Alias</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/api-catalog" target="_blank" rel="noopener noreferrer"><span class="disc-path">/.well-known/api-catalog ↗</span><span class="disc-note">RFC 9727 Linkset API Catalog</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/mcp/server-card.json" target="_blank" rel="noopener noreferrer"><span class="disc-path">/.well-known/mcp/server-card.json ↗</span><span class="disc-note">MCP Server Card &amp; Pack Remotes</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/agent-card.json" target="_blank" rel="noopener noreferrer"><span class="disc-path">/.well-known/agent-card.json ↗</span><span class="disc-note">A2A Autonomous Agent Card</span></a>
        <a class="disc-cell" href="${safeBase}/openapi.json" target="_blank" rel="noopener noreferrer"><span class="disc-path">/openapi.json ↗</span><span class="disc-note">OpenAPI 3.1 Specification + x-payment-info</span></a>
        <a class="disc-cell" href="${safeBase}/llms.txt" target="_blank" rel="noopener noreferrer"><span class="disc-path">/llms.txt ↗</span><span class="disc-note">LLM Context &amp; Workflow Guide</span></a>
        <a class="disc-cell" href="${safeBase}/health" target="_blank" rel="noopener noreferrer"><span class="disc-path">/health ↗</span><span class="disc-note">Live Uncached Service Health Gate</span></a>
      </div>
    </section>

    ${toolPreviewModal}`;

  return renderSwissShell({
    baseUrl,
    title: `${SERVICE_NAME} — Live, deterministic x402 APIs for AI agents`,
    description:
      "Live facts and exact math, distilled to ~2 KB JSON. 31 primary-source x402 APIs and MCP packs on Base USDC ($0.005–$0.02/call, $0 on errors).",
    ogDescription: `${CATALOG.length} primary-source x402 APIs distilled to ~2 KB JSON on Base USDC ($0.005–$0.02/call) + native MCP. Pay only on success.`,
    twitterDescription: `${CATALOG.length} primary-source x402 APIs distilled to ~2 KB JSON ($0.005–$0.02 Base USDC, $0 on errors) + native MCP.`,
    canonicalPath: "/",
    activeNav: "/",
    jsonLd: renderBrandJsonLd(baseUrl, true),
    mainHtml,
  });
}
