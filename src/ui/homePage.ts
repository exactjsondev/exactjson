import {
  CATALOG,
  type EndpointCatalogEntry,
  type EndpointId,
  getActivePacks,
  getEndpointById,
  getPackEndpoints,
  MARKETS_PACK,
  SERVICE_NAME,
} from "../config/catalog";
import {
  escapeHtml,
  formatNetworkLabel,
  highlightCode,
  highlightJson,
  renderCodeWell,
  stripPackDisclaimer,
} from "./escape";
import { renderBrandJsonLd, renderSwissShell } from "./shell";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

const highlightedSampleCache = new Map<EndpointId, string>();

function getHighlightedSample(entry: EndpointCatalogEntry): string {
  const cached = highlightedSampleCache.get(entry.id);
  if (cached !== undefined) {
    return cached;
  }
  const highlighted = highlightJson(JSON.stringify(entry.outputExample, null, 2));
  highlightedSampleCache.set(entry.id, highlighted);
  return highlighted;
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
      const searchBlob = `${entry.path} ${entry.summary} ${entry.pack} ${entry.tags.join(" ")}`;

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
                    <span class="copy-text-idle" aria-hidden="true">[ COPY ]</span>
                    <span class="copy-text-done" aria-hidden="true">[ ✓ COPIED ]</span>
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

export function renderLandingHtml(baseUrl: string, network: string): string {
  const safeBase = escapeHtml(baseUrl);
  const networkLabel = formatNetworkLabel(network);
  const activePacks = getActivePacks();
  const totalTools = 1 + CATALOG.length;
  const byId = new Map<EndpointId, EndpointCatalogEntry>(CATALOG.map((entry) => [entry.id, entry]));

  // Hero Tab 01: Flagship Payload Inspector (/v1/evm/safety)
  const flagship = getEndpointById("evm_safety");
  const flagshipJson = JSON.stringify(flagship.outputExample, null, 2);
  const payloadWell = renderCodeWell({
    id: "hero-payload-json",
    label: `GET ${flagship.path}?${new URLSearchParams(flagship.exampleQueryParams).toString()}`,
    copyLabel: "Copy sample ExactJSON response",
    codeHtml: highlightJson(flagshipJson),
    receiptLeft: `HTTP 200 OK · SETTLED ${flagship.priceFormatted} USDC (${networkLabel})`,
    receiptRight: "400 / 404 / 502 = $0.00",
  });

  // Hero Tab 02: Connect MCP Config
  const mcpConfigRaw = JSON.stringify(
    {
      mcpServers: {
        "exactjson-remote": {
          url: `${baseUrl}/mcp`,
        },
        "exactjson-stdio": {
          command: "npx",
          args: ["-y", "exactjson-mcp"],
          env: {
            BUYER_PRIVATE_KEY: "0xYOUR_LOW_BALANCE_KEY",
            MAX_PAYMENT_USD: "$0.05",
          },
        },
      },
    },
    null,
    2,
  );
  const mcpWell = renderCodeWell({
    id: "hero-mcp-json",
    label: `Remote HTTP (/mcp, /mcp/<pack>, /mcp/all) & Stdio (${totalTools} total tools)`,
    copyLabel: "Copy MCP client configuration JSON",
    codeHtml: highlightJson(mcpConfigRaw),
    receiptLeft: "CLIENT SPEND CAP: MAX_PAYMENT_USD=$0.05",
    receiptRight: "EIP-3009 LOCAL SIGNING",
  });

  // Pack Matrix Cells (getActivePacks())
  const packMatrixHtml = activePacks
    .map((pack, idx) => {
      const count = getPackEndpoints([pack.id]).length;
      const packTools = 1 + count;
      const stdioCmd =
        pack.id === "markets" ? "npx -y exactjson-mcp" : `npx -y exactjson-mcp --pack ${pack.id}`;
      const remoteRoute = pack.id === "markets" ? "/mcp" : pack.mcpPath;
      const num = String(idx + 1).padStart(2, "0");

      return `<article class="spec-cell surface">
        <div class="eyebrow-row" style="justify-content: space-between;">
          <span class="coord">PACK ${num} // ${escapeHtml(pack.id.toUpperCase())}</span>
          <span class="coord ok">${count} PAID · ${packTools} MCP TOOLS</span>
        </div>
        <h3>${escapeHtml(pack.title)}</h3>
        <p>${escapeHtml(pack.subtitle)}</p>
        <div class="pack-route-strip">POST ${safeBase}${escapeHtml(remoteRoute)} · ${escapeHtml(stdioCmd)}</div>
      </article>`;
    })
    .join("\n");

  // Catalog Sections: Markets subgroups + remaining active packs
  const marketsSubgroups = (MARKETS_PACK.subgroups ?? [])
    .map((group) => {
      const entries = group.ids
        .map((id) => byId.get(id))
        .filter((entry): entry is EndpointCatalogEntry => Boolean(entry));

      return `<div class="pack-subgroup">
        <div class="subgroup-bar">
          <h3 id="${escapeHtml(group.id)}">${escapeHtml(group.title)}</h3>
          <p>${escapeHtml(group.subtitle)}</p>
        </div>
        <div tabindex="0" role="region" aria-labelledby="${escapeHtml(group.id)}" class="table-wrap">
          <table>
            <caption class="visually-hidden">${escapeHtml(group.title)} paid x402 endpoints</caption>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">USDC</th>
                <th scope="col">Specification &amp; Sample Request</th>
              </tr>
            </thead>
            <tbody>
              ${renderEndpointRows(entries, baseUrl, "home")}
            </tbody>
          </table>
        </div>
      </div>`;
    })
    .join("\n");

  const extraPackSections = activePacks
    .filter((pack) => pack.id !== "markets")
    .map((pack) => {
      const entries = getPackEndpoints([pack.id]);
      const headingId = `pack-${pack.id}`;
      return `<section data-pack-section="${escapeHtml(pack.id)}">
        <div class="subgroup-bar">
          <h3 id="${escapeHtml(headingId)}">${escapeHtml(pack.title)}</h3>
          <p>${escapeHtml(pack.subtitle)}</p>
        </div>
        <div tabindex="0" role="region" aria-labelledby="${escapeHtml(headingId)}" class="table-wrap">
          <table>
            <caption class="visually-hidden">${escapeHtml(pack.title)} paid x402 endpoints</caption>
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">USDC</th>
                <th scope="col">Specification &amp; Sample Request</th>
              </tr>
            </thead>
            <tbody>
              ${renderEndpointRows(entries, baseUrl, "home")}
            </tbody>
          </table>
        </div>
      </section>`;
    })
    .join("\n");

  const packTabRadios = [
    `<input type="radio" name="pack-tab" id="pack-tab-all" class="sr-control" checked>`,
    ...activePacks.map(
      (pack) =>
        `<input type="radio" name="pack-tab" id="pack-tab-${escapeHtml(pack.id)}" class="sr-control">`,
    ),
  ].join("\n        ");

  const packTabLabels = [
    `<label class="pack-pill" for="pack-tab-all">All [${CATALOG.length}]</label>`,
    ...activePacks.map(
      (pack) =>
        `<label class="pack-pill" for="pack-tab-${escapeHtml(pack.id)}">${escapeHtml(pack.id)} [${getPackEndpoints([pack.id]).length}]</label>`,
    ),
  ].join("\n            ");

  // Quickstart Snippets
  const curlRaw = `# 1. Free health check (HTTP 200)
curl -s ${baseUrl}/health

# 2. Unpaid probe returns HTTP 402 + base64 PAYMENT-REQUIRED terms
curl -i "${baseUrl}/v1/perps/snapshot?coin=BTC"`;

  const x402FetchPkg = ["@x402", "fetch"].join("/");
  const x402EvmPkg = ["@x402", "evm/exact/client"].join("/");
  const tsRaw = `import { wrapFetchWithPayment, x402Client } from "${x402FetchPkg}";
import { registerExactEvmScheme } from "${x402EvmPkg}";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client()
  .setSpendControls({ maxAmountPerPayment: "$0.05" });
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY),
});
const payFetch = wrapFetchWithPayment(fetch, client);
const res = await payFetch("${baseUrl}/v1/perps/snapshot?coin=BTC");
console.log(await res.json());`;

  const mainHtml = `
    <section class="hero-split" aria-label="Protocol Overview">
      <div class="hero-narrative">
        <div class="eyebrow-row">
          <span class="coord">+ 01 // PROTOCOL</span>
          <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Pay-Only-On-Success · HTTP 200</span>
        </div>

        <h1 class="display-title" tabindex="-1">Live, deterministic x402 APIs for AI agents.</h1>

        <p class="lead">
          <strong>${escapeHtml(SERVICE_NAME)}</strong> replaces 200 KB raw upstream API dumps with pre-computed ~2 KB strict-schema JSON. Paid per call in Base USDC ($0.005–$0.02) on <code>${escapeHtml(networkLabel)}</code> with zero API keys, zero accounts, and fail-closed <code>502</code> safety.
        </p>

        <div class="btn-row">
          <a class="swiss-btn primary" href="#quickstart">MCP &amp; HTTP Quickstart →</a>
          <a class="swiss-btn" href="#endpoints">Browse ${CATALOG.length} Endpoints</a>
          <a class="swiss-btn" href="${safeBase}/health">Free /health</a>
        </div>

        <div class="kpi-strip" aria-label="Key Service Specifications">
          <div class="kpi-cell">
            <div class="kpi-val">${CATALOG.length}</div>
            <div class="kpi-lbl">Paid Endpoints</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-val">${activePacks.length} Packs</div>
            <div class="kpi-lbl">&lt;=15 Tools / Pack</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-val">$0.005–.02</div>
            <div class="kpi-lbl">Base USDC / Call</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-val">$0.00</div>
            <div class="kpi-lbl">400 / 404 / 502</div>
          </div>
        </div>
      </div>

      <div class="hero-inspector" aria-label="Protocol Payload and MCP Inspector">
        <input type="radio" name="hero-mode" id="hero-mode-payload" class="sr-control" checked>
        <input type="radio" name="hero-mode" id="hero-mode-mcp" class="sr-control">
        <input type="radio" name="hero-mode" id="hero-mode-accept" class="sr-control">

        <div class="inspector-tabs" role="group" aria-label="Inspector View">
          <label class="tab-trigger" for="hero-mode-payload">01 Payload [214KB → 1.8KB]</label>
          <label class="tab-trigger" for="hero-mode-mcp">02 Connect MCP</label>
          <label class="tab-trigger" for="hero-mode-accept">03 Accept Header</label>
        </div>

        <div class="inspector-pane" data-pane="payload">
          <div class="compression-bar">
            <span class="coord">Raw Upstream: ~214.6 KB (~54,000 Tokens)</span>
            <span class="coord ok">ExactJSON: 1.8 KB · -99.1% Tokens</span>
          </div>
          ${payloadWell}
        </div>

        <div class="inspector-pane" data-pane="mcp">
          <div class="compression-bar">
            <span class="coord">Official MCP Registry: io.github.exactjsondev/exactjson</span>
            <span class="coord ok">${totalTools} Total Tools</span>
          </div>
          ${mcpWell}
        </div>

        <div class="inspector-pane" data-pane="accept">
          <div class="compression-bar">
            <span class="coord">One Canonical Origin · Content Negotiation</span>
            <span class="coord ok">Vary: Accept</span>
          </div>
          <div class="spec-cell surface" style="flex: 1; gap: 0.9rem;">
            <div>
              <div class="coord ok">Accept: text/html (You Are Here)</div>
              <p>Serves this Swiss architectural specification for human engineers evaluating trust, schemas, and pricing.</p>
            </div>
            <div>
              <div class="coord">Accept: text/markdown</div>
              <p>Serves compact Markdown documentation (<code>/llms.txt</code>) directly from <code>GET /</code>, <code>/docs</code>, and <code>/pricing</code> for LLMs.</p>
            </div>
            <div>
              <div class="coord">Accept: application/json (Default for */* &amp; Agents)</div>
              <p>Serves the machine-readable JSON catalog, pack map, and RFC 9727 <code>Link</code> discovery headers in <code>&lt;10ms</code>.</p>
            </div>
            <div>
              <div class="coord warn">Unpaid GET /v1/*</div>
              <p>Returns HTTP <code>402 Payment Required</code> with base64 <code>PAYMENT-REQUIRED</code> Base USDC terms ($0.00 charged).</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="swiss-section grid-3" aria-label="Engineering Guarantees">
      <div class="spec-cell">
        <span class="coord">+ 02.1 // DETERMINISTIC EDGE MATH</span>
        <h2>Token-Efficient JSON</h2>
        <p>Every endpoint distills noisy multi-source feeds (600+ options contracts, 3-venue perp books, dual-engine token &amp; CVE audits) into one deterministic ~2 KB payload.</p>
      </div>
      <div class="spec-cell">
        <span class="coord">+ 02.2 // SETTLEMENT DISCIPLINE</span>
        <h2>Pay-Only-On-Success</h2>
        <p>Unpaid probes return HTTP <code>402</code> with <code>PAYMENT-REQUIRED</code> terms. Invalid inputs (<code>400</code>/<code>404</code>) and upstream outages (<code>502</code>/<code>503</code>) never settle.</p>
      </div>
      <div class="spec-cell">
        <span class="coord">+ 02.3 // ZERO API KEYS</span>
        <h2>Machine Discovery First</h2>
        <p>Auto-discoverable via <code>/.well-known/x402</code>, <code>/.well-known/x402.json</code>, RFC 9727 API Catalog, OpenAPI 3.1, A2A Agent Card, and MCP Server Card.</p>
      </div>
    </section>

    <section class="swiss-section" aria-labelledby="packs-heading">
      <div class="section-bar">
        <h2 id="packs-heading" class="coord" style="color: var(--ink-primary);">+ 03 // ACTIVE VERTICAL MCP PACKS (${activePacks.length} LIVE)</h2>
        <span class="coord ok">Every Pack &lt;= 15 Tools · /mcp/all = ${totalTools} Tools</span>
      </div>
      <div class="pack-matrix">
        ${packMatrixHtml}
      </div>
    </section>

    <section id="endpoints" class="swiss-section" aria-labelledby="endpoints-heading">
      ${packTabRadios}
      <div class="section-bar">
        <h2 id="endpoints-heading" class="coord" style="color: var(--ink-primary);">+ 04 // PAID ENDPOINT CATALOG (${CATALOG.length} LIVE ON ${escapeHtml(networkLabel.toUpperCase())})</h2>
        <span id="endpoint-count-live" class="coord ok" role="status" aria-live="polite">${CATALOG.length} LIVE ENDPOINTS</span>
      </div>

      <div class="catalog-toolbar">
        <div class="pack-tabs" role="group" aria-label="Filter by vertical pack">
          ${packTabLabels}
        </div>
        <div class="search-cluster">
          <label for="endpoint-search" class="visually-hidden">Filter endpoints by path, summary, or tag</label>
          <input type="search" id="endpoint-search" class="search-input" placeholder="Filter ${CATALOG.length} /v1/* endpoints..." autocomplete="off">
        </div>
      </div>

      <section data-pack-section="markets">
        ${marketsSubgroups}
      </section>
      ${extraPackSections}
    </section>

    <section id="quickstart" class="swiss-section" aria-labelledby="quickstart-heading">
      <div class="section-bar">
        <h2 id="quickstart-heading" class="coord" style="color: var(--ink-primary);">+ 05 // QUICKSTART: TRY FREE, THEN PAY PER CALL</h2>
        <span class="coord">Zero Signup · Zero API Keys · Local EIP-3009 Signing</span>
      </div>
      <div class="grid-2">
        <div class="spec-cell surface">
          <span class="coord">+ 05.1 // TERMINAL PROBE (CURL)</span>
          <h3>Test Free Status &amp; Inspect 402 Terms</h3>
          <p>Verify live service state or inspect raw base64 <code>PAYMENT-REQUIRED</code> headers with zero wallet setup:</p>
          ${renderCodeWell({
            id: "qs-curl-code",
            label: "bash · zero wallet required",
            copyLabel: "Copy curl quickstart commands",
            codeHtml: highlightCode(curlRaw, "bash"),
          })}
        </div>
        <div class="spec-cell surface">
          <span class="coord">+ 05.2 // TYPESCRIPT SDK (@X402/FETCH)</span>
          <h3>Wrap Fetch with Client Spend Controls</h3>
          <p>Sign <code>402</code> challenges locally with Base USDC capped per request via <code>maxAmountPerPayment</code>:</p>
          ${renderCodeWell({
            id: "qs-ts-code",
            label: "TypeScript · @x402/fetch + viem",
            copyLabel: "Copy TypeScript @x402/fetch quickstart",
            codeHtml: highlightCode(tsRaw, "ts"),
          })}
        </div>
      </div>
    </section>

    <section id="discovery" class="swiss-section" style="border-bottom: none;" aria-labelledby="discovery-heading">
      <div class="section-bar">
        <h2 id="discovery-heading" class="coord" style="color: var(--ink-primary);">+ 06 // MACHINE DISCOVERY &amp; SCHEMAS ($0.00 FREE)</h2>
        <span class="coord ok">CORS-Enabled · Public Cache</span>
      </div>
      <div class="discovery-matrix">
        <a class="disc-cell" href="${safeBase}/mcp"><span class="disc-path">/mcp</span><span class="disc-note">Remote Streamable HTTP MCP (JSON-RPC 2.0)</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/x402"><span class="disc-path">/.well-known/x402</span><span class="disc-note">x402 Resource Discovery Manifest</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/x402.json"><span class="disc-path">/.well-known/x402.json</span><span class="disc-note">x402 JSON Manifest Alias</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/api-catalog"><span class="disc-path">/.well-known/api-catalog</span><span class="disc-note">RFC 9727 Linkset API Catalog</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/mcp/server-card.json"><span class="disc-path">/.well-known/mcp/server-card.json</span><span class="disc-note">MCP Server Card &amp; Pack Remotes</span></a>
        <a class="disc-cell" href="${safeBase}/.well-known/agent-card.json"><span class="disc-path">/.well-known/agent-card.json</span><span class="disc-note">A2A Autonomous Agent Card</span></a>
        <a class="disc-cell" href="${safeBase}/openapi.json"><span class="disc-path">/openapi.json</span><span class="disc-note">OpenAPI 3.1 Specification + x-payment-info</span></a>
        <a class="disc-cell" href="${safeBase}/llms.txt"><span class="disc-path">/llms.txt</span><span class="disc-note">LLM Context &amp; Workflow Guide</span></a>
        <a class="disc-cell" href="${safeBase}/health"><span class="disc-path">/health</span><span class="disc-note">Live Uncached Service Health Gate</span></a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `${SERVICE_NAME} — Live, deterministic x402 APIs for AI agents`,
    description:
      "ExactJSON serves live, deterministic, token-optimized x402 V2 JSON endpoints for AI agents on Base USDC ($0.005-$0.02/call). Zero API keys, strict schemas, pay-only-on-success.",
    ogDescription: `${CATALOG.length} deterministic x402 V2 endpoints for AI agents on Base USDC ($0.005-$0.02/call) plus native MCP (npx -y exactjson-mcp).`,
    twitterDescription: `${CATALOG.length} live x402 V2 JSON APIs for AI agents on Base USDC ($0.005-$0.02/call) + native MCP.`,
    canonicalPath: "/",
    activeNav: "/",
    headerMetaHtml: `<span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>x402 V2 · ${escapeHtml(networkLabel)}</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, true),
    mainHtml,
  });
}
