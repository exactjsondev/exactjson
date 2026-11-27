import {
  CATALOG,
  type EndpointCatalogEntry,
  getPackEndpoints,
  PACKS,
  SERVICE_NAME,
  SERVICE_VERSION,
} from "../config/catalog";
import {
  escapeHtml,
  formatNetworkLabel,
  highlightCode,
  highlightJson,
  renderCodeWell,
  stripPackDisclaimer,
} from "./escape";
import { renderSwissShell } from "./shell";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

function renderParamRows(entry: EndpointCatalogEntry): string {
  const requiredSet = new Set(entry.inputSchema.required ?? []);
  return Object.entries(entry.inputSchema.properties)
    .map(([name, prop]) => {
      const isReq = requiredSet.has(name);
      const constraints: string[] = [prop.mcpType ?? prop.type];
      if (prop.enum && prop.enum.length > 0) {
        constraints.push(`enum: ${prop.enum.join(" | ")}`);
      }
      if (prop.pattern) {
        constraints.push(`pattern: ${prop.pattern}`);
      }
      if (prop.minimum !== undefined || prop.maximum !== undefined) {
        constraints.push(`${prop.minimum ?? ""}..${prop.maximum ?? ""}`);
      }

      return `<tr>
        <th scope="row" class="ep-cell"><code>${escapeHtml(name)}</code></th>
        <td class="req-cell">${isReq ? '<span class="coord warn">REQUIRED</span>' : '<span class="coord">OPTIONAL</span>'}</td>
        <td>
          <div>${escapeHtml(prop.description)}</div>
          <div class="desc"><code>${escapeHtml(constraints.join(" · "))}</code>${prop.example ? ` · Example: <code>${escapeHtml(prop.example)}</code>` : ""}</div>
        </td>
      </tr>`;
    })
    .join("\n");
}

export function renderPaywallHtml(
  entry: EndpointCatalogEntry,
  baseUrl: string,
  network: string,
  requestedUrl: string,
): string {
  const safeBase = escapeHtml(baseUrl);
  const networkLabel = formatNetworkLabel(network);
  const sampleJson = JSON.stringify(entry.outputExample, null, 2);
  const packDisclaimer = PACKS[entry.pack].disclaimer;
  const stdioArgs =
    entry.pack === "markets"
      ? ["-y", "exactjson-mcp"]
      : ["-y", "exactjson-mcp", "--pack", entry.pack];

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        exactjson: {
          command: "npx",
          args: stdioArgs,
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

  const utf8Encoder = new TextEncoder();
  const safeShellUrl = requestedUrl.replace(/[\x00-\x1f\x7f$`"\\!()'\s<>|;]/g, (ch) =>
    Array.from(
      utf8Encoder.encode(ch),
      (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    ).join(""),
  );

  const curlAndSdkSnippet = `# Inspect live base64 x402 V2 PAYMENT-REQUIRED header
curl -i "${safeShellUrl}"

# Or read the full OpenAPI 3.1 schema
curl -s ${baseUrl}/openapi.json`;

  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.25rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge warn"><span class="sig-dot warn" aria-hidden="true"></span>HTTP 402 · Payment Required</span>
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>${escapeHtml(entry.priceFormatted)} USDC · ${escapeHtml(networkLabel)}</span>
        <span class="sig-badge">Pay-Only-On-Success</span>
      </div>
      <h1 class="page-title"><code>GET ${escapeHtml(entry.path)}</code></h1>
      <p class="lead">${escapeHtml(entry.summary)}. ${escapeHtml(stripPackDisclaimer(entry))}</p>
      <p class="desc">
        Browsers do not automatically attach x402 V2 <code>PAYMENT-SIGNATURE</code> headers. This response already includes the live base64 <code>PAYMENT-REQUIRED</code> challenge for x402 SDKs and MCP clients—and <code>400</code>/<code>404</code>/<code>502</code>/<code>503</code> responses never settle payment.
      </p>
    </section>

    <section class="swiss-section" aria-labelledby="pw-params-heading">
      <div class="section-bar">
        <h2 id="pw-params-heading" class="coord" style="color: var(--ink-primary);">+ 01 // QUERY PARAMETER SCHEMA (${Object.keys(entry.inputSchema.properties).length})</h2>
        <span class="coord">PACK: ${escapeHtml(entry.pack.toUpperCase())}</span>
      </div>
      <div tabindex="0" role="region" aria-labelledby="pw-params-heading" class="table-wrap">
        <table class="param-table">
          <caption class="visually-hidden">Query parameters for ${escapeHtml(entry.path)}</caption>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Requirement</th>
              <th scope="col">Constraints &amp; Description</th>
            </tr>
          </thead>
          <tbody>
            ${renderParamRows(entry)}
          </tbody>
        </table>
      </div>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">+ 02 // CALL VIA MCP (EXACTJSON_${escapeHtml(entry.id.toUpperCase())})</span>
        <h2>Claude Desktop / Cursor Local EIP-3009 Signer</h2>
        <p>Run <code>exactjson_${escapeHtml(entry.id)}</code> automatically with a client-side Base USDC spend cap:</p>
        ${renderCodeWell({
          id: "pw-mcp-json",
          label: `MCP Tool · exactjson_${entry.id}`,
          copyLabel: "Copy MCP configuration for this endpoint",
          codeHtml: highlightJson(mcpSnippet),
        })}
      </div>
      <div class="spec-cell surface">
        <span class="coord">+ 03 // INSPECT CHALLENGE OR CALL VIA SDK</span>
        <h2>Raw PAYMENT-REQUIRED Header &amp; OpenAPI</h2>
        <p>Inspect the base64 challenge in terminal, or wrap <code>fetch</code> with <code>@x402/fetch</code>:</p>
        ${renderCodeWell({
          id: "pw-curl-code",
          label: "bash · inspect 402 challenge",
          copyLabel: "Copy curl challenge inspection command",
          codeHtml: highlightCode(curlAndSdkSnippet, "bash"),
        })}
      </div>
    </section>

    <section class="spec-cell" style="border-bottom: none;">
      <details class="sample-details" open>
        <summary>Sample HTTP 200 JSON response (${escapeHtml(entry.path)})</summary>
        <div class="sample-json-wrap">
          <div class="code-well-bar">
            <span class="code-well-label">GET ${escapeHtml(entry.path)} · ${escapeHtml(entry.priceFormatted)} USDC on HTTP 200</span>
            <span class="copy-wrap">
              <button type="button" class="copy-btn" command="--copy" commandfor="pw-sample-json" aria-label="Copy sample JSON output">
                <span class="copy-text-idle" aria-hidden="true">[ COPY ]</span>
                <span class="copy-text-done" aria-hidden="true">[ ✓ COPIED ]</span>
                <span class="copy-text-fail" aria-hidden="true">[ ! FAILED ]</span>
              </button>
              <span class="copy-tip" role="status"></span>
            </span>
          </div>
          <pre class="sample-json" tabindex="0"><code id="pw-sample-json">${highlightJson(sampleJson)}</code></pre>
        </div>
      </details>
      <div class="btn-row" style="margin-top: 0.75rem;">
        <a class="swiss-btn primary" href="${safeBase}/">← All ${CATALOG.length} Endpoints</a>
        <a class="swiss-btn" href="${safeBase}/docs">API Docs</a>
        <a class="swiss-btn" href="${safeBase}/pricing">Pricing</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `HTTP 402 Payment Required · ${entry.path} | ${SERVICE_NAME}`,
    description: `${entry.summary} (${entry.priceFormatted} USDC via x402 V2 on ${networkLabel}).`,
    noindex: true,
    headerMetaHtml: `<span class="sig-badge warn"><span class="sig-dot warn" aria-hidden="true"></span>HTTP 402</span><span class="sig-badge ok">${escapeHtml(entry.priceFormatted)} USDC</span>`,
    footerDisclaimer: packDisclaimer,
    mainHtml,
  });
}

export function renderMcpGuideHtml(
  baseUrl: string,
  mcpPath = "/mcp",
  toolCount = 1 + getPackEndpoints(["markets"]).length,
): string {
  const safeBase = escapeHtml(baseUrl);
  const packSuffix = mcpPath.startsWith("/mcp/")
    ? mcpPath.slice("/mcp/".length)
    : mcpPath.startsWith("/mcp?pack=")
      ? mcpPath.slice("/mcp?pack=".length)
      : "";
  const stdioArgs =
    !packSuffix || packSuffix === "markets"
      ? ["-y", "exactjson-mcp"]
      : ["-y", "exactjson-mcp", "--pack", packSuffix];

  const curlPost = `curl -s -X POST "${baseUrl}${mcpPath}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        exactjson: {
          command: "npx",
          args: stdioArgs,
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

  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.25rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge warn"><span class="sig-dot warn" aria-hidden="true"></span>HTTP 405 · POST Required</span>
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>MCP Streamable HTTP · v${escapeHtml(SERVICE_VERSION)}</span>
      </div>
      <h1 class="page-title"><code>POST ${safeBase}${escapeHtml(mcpPath)}</code></h1>
      <p class="lead">
        This is ExactJSON's stateless <strong>Streamable HTTP MCP endpoint</strong> (JSON-RPC 2.0, ${toolCount} tools). Browsers send <code>GET</code>, which returns <code>405 Method Not Allowed</code> — connect your MCP client via <code>POST</code> or use the local stdio CLI.
      </p>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">+ 01 // REMOTE STREAMABLE HTTP (ZERO INSTALL)</span>
        <h2>Connect via JSON-RPC 2.0 POST</h2>
        <p>Point any Streamable HTTP MCP client at <code>${safeBase}${escapeHtml(mcpPath)}</code>, or test <code>tools/list</code> for free in terminal:</p>
        ${renderCodeWell({
          id: "mcp-guide-curl",
          label: `POST ${mcpPath} · JSON-RPC 2.0`,
          copyLabel: "Copy MCP JSON-RPC tools/list curl command",
          codeHtml: highlightCode(curlPost, "bash"),
        })}
      </div>
      <div class="spec-cell surface">
        <span class="coord">+ 02 // LOCAL STDIO BRIDGE (AUTO-SIGN BASE USDC)</span>
        <h2>Claude Desktop &amp; Cursor Config</h2>
        <p>Use <code>npx -y exactjson-mcp</code> locally so EIP-3009 Base USDC authorizations sign on your machine:</p>
        ${renderCodeWell({
          id: "mcp-guide-stdio",
          label: "mcpServers · exactjson-mcp",
          copyLabel: "Copy local stdio MCP config",
          codeHtml: highlightJson(stdioConfig),
        })}
      </div>
    </section>

    <section class="spec-cell" style="border-bottom: none;">
      <div class="btn-row">
        <a class="swiss-btn primary" href="${safeBase}/docs">← Back to ExactJSON Docs</a>
        <a class="swiss-btn" href="${safeBase}/">All ${CATALOG.length} Endpoints</a>
        <a class="swiss-btn" href="${safeBase}/.well-known/mcp/server-card.json">View MCP Server Card</a>
        <a class="swiss-btn" href="${safeBase}/openapi.json">OpenAPI 3.1</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `Remote MCP Endpoint (POST ${mcpPath}) | ${SERVICE_NAME}`,
    description: `Connect to ExactJSON's Streamable HTTP MCP endpoint via POST ${baseUrl}${mcpPath} (${toolCount} tools).`,
    noindex: true,
    headerMetaHtml: `<span class="sig-badge warn">HTTP 405 · POST Required</span>`,
    mainHtml,
  });
}

export function renderNotFoundHtml(baseUrl: string, requestedPath: string): string {
  const safeBase = escapeHtml(baseUrl);
  const mainHtml = `
    <section class="spec-cell" style="padding: 3rem 2rem; border-bottom: none;">
      <div class="eyebrow-row">
        <span class="sig-badge warn"><span class="sig-dot warn" aria-hidden="true"></span>HTTP 404 · Unmatched Route</span>
      </div>
      <h1 class="page-title">Page not found</h1>
      <p class="lead">
        No ${escapeHtml(SERVICE_NAME)} route matches <code>${escapeHtml(requestedPath)}</code>. All paid endpoints live under <code>/v1/*</code>—browse our specification, pricing, or machine discovery manifests below.
      </p>
      <div class="btn-row" style="margin-top: 0.75rem;">
        <a class="swiss-btn primary" href="${safeBase}/docs">Go to ExactJSON Docs</a>
        <a class="swiss-btn" href="${safeBase}/pricing">Pricing</a>
        <a class="swiss-btn" href="${safeBase}/#endpoints">View All ${CATALOG.length} Endpoints</a>
        <a class="swiss-btn" href="${safeBase}/openapi.json">OpenAPI 3.1</a>
        <a class="swiss-btn" href="${safeBase}/llms.txt">llms.txt</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `404 Not Found | ${SERVICE_NAME}`,
    description: `No ExactJSON route matches ${requestedPath}.`,
    noindex: true,
    headerMetaHtml: `<span class="sig-badge warn">HTTP 404</span>`,
    mainHtml,
  });
}
