import {
  CATALOG,
  type EndpointCatalogEntry,
  getPackEndpoints,
  PACKS,
  SERVICE_NAME,
} from "../config/catalog";
import {
  escapeHtml,
  formatNetworkLabel,
  highlightCode,
  highlightJson,
  renderCodeWell,
} from "./escape";
import { buildVibePrompt, HUMAN_ENDPOINT_ONE_LINER, HUMAN_PACK_META } from "./humanCopy";
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
  const packMeta = HUMAN_PACK_META[entry.pack];
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
            BUYER_PRIVATE_KEY: "0xYOUR_BASE_WALLET_PRIVATE_KEY",
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

  const curlSnippet = `# Inspect live base64 x402 V2 PAYMENT-REQUIRED header ($0.00)
curl -i "${safeShellUrl}"

# Or read the full OpenAPI 3.1 schema
curl -s ${baseUrl}/openapi.json`;

  const vibePromptRaw = buildVibePrompt(baseUrl, entry.pack);

  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.25rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge warn"><span class="sig-dot warn" aria-hidden="true"></span>HTTP 402 · Payment Required</span>
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>${escapeHtml(entry.priceFormatted)} USDC · ${escapeHtml(networkLabel)}</span>
        <span class="sig-badge">Pay only on success</span>
      </div>
      <h1 class="page-title"><code>GET ${escapeHtml(entry.path)}</code></h1>
      <p class="lead">${escapeHtml(HUMAN_ENDPOINT_ONE_LINER[entry.id])}</p>
      <div class="callout-box ok">
        <strong>$0.00 charged.</strong> This route settles <strong>${escapeHtml(entry.priceFormatted)} Base USDC</strong> when called with an x402 <code>PAYMENT-SIGNATURE</code> header. Inspect the parameters and sample output below, or connect via MCP or <code>@x402/fetch</code>.
      </div>
      <div class="btn-row" style="margin-top: 0.35rem;">
        <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
        <a class="swiss-btn" href="${safeBase}/">← All ${CATALOG.length} Tools</a>
      </div>
    </section>

    <section class="swiss-section" aria-labelledby="pw-params-heading">
      <div class="section-bar">
        <h2 id="pw-params-heading" class="section-title">Inputs &amp; parameters (${Object.keys(entry.inputSchema.properties).length})</h2>
        <span class="coord">QUERY PARAMETER SCHEMA · ${escapeHtml(entry.pack)}</span>
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
        <span class="coord">MCP tool · exactjson_${escapeHtml(entry.id)}</span>
        <h2>Connect in Claude Desktop or Cursor (MCP)</h2>
        <p>Add the <strong>${escapeHtml(packMeta.label)}</strong> pack to run <code>exactjson_${escapeHtml(entry.id)}</code> locally with a $0.05 spend cap:</p>
        ${renderCodeWell({
          id: "pw-mcp-json",
          label: `MCP Tool · exactjson_${entry.id}`,
          copyLabel: "Copy MCP configuration for this endpoint",
          codeHtml: highlightJson(mcpSnippet),
          receiptLeft: "Local EIP-3009 signing · MAX_PAYMENT_USD=$0.05",
          receiptRight: networkLabel,
        })}
      </div>
      <div class="spec-cell surface">
        <span class="coord">Agent prompt &amp; terminal probe</span>
        <h2>Agent prompt or terminal probe</h2>
        <p>Inspect the live base64 <code>PAYMENT-REQUIRED</code> quote with <code>curl</code>, or copy the prompt for Cursor, Claude Code, Lovable, Bolt, or Replit:</p>
        ${renderCodeWell({
          id: "pw-curl-code",
          label: "bash · inspect 402 challenge",
          copyLabel: "Copy curl challenge inspection command",
          codeHtml: highlightCode(curlSnippet, "bash"),
          receiptLeft: "Free unpaid probe ($0.00)",
          receiptRight: "400 / 404 / 502 = $0.00",
        })}
        <details class="sample-details">
          <summary>Agent setup prompt (${escapeHtml(packMeta.plainTitle)})</summary>
          <div class="sample-json-wrap">
            <div class="code-well-bar">
              <span class="code-well-label">Agent Prompt · ${escapeHtml(packMeta.plainTitle)}</span>
              <span class="copy-wrap">
                <button type="button" class="copy-btn" command="--copy" commandfor="pw-vibe-prompt" aria-label="Copy agent setup prompt">
                  <span class="copy-text-idle" aria-hidden="true">Copy</span>
                  <span class="copy-text-done" aria-hidden="true">✓ Copied</span>
                  <span class="copy-text-fail" aria-hidden="true">! Failed</span>
                </button>
                <span class="copy-tip" role="status"></span>
              </span>
            </div>
            <pre class="sample-json" tabindex="0"><code id="pw-vibe-prompt">${escapeHtml(vibePromptRaw)}</code></pre>
          </div>
        </details>
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
                <span class="copy-text-idle" aria-hidden="true">Copy</span>
                <span class="copy-text-done" aria-hidden="true">✓ Copied</span>
                <span class="copy-text-fail" aria-hidden="true">! Failed</span>
              </button>
              <span class="copy-tip" role="status"></span>
            </span>
          </div>
          <pre class="sample-json" tabindex="0"><code id="pw-sample-json">${highlightJson(sampleJson)}</code></pre>
        </div>
      </details>
      <div class="btn-row" style="margin-top: 0.75rem;">
        <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
        <a class="swiss-btn" href="${safeBase}/">← All ${CATALOG.length} Tools</a>
        <a class="swiss-btn" href="${safeBase}/docs">API Docs</a>
        <a class="swiss-btn" href="${safeBase}/pricing">Pricing</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `HTTP 402 Payment Required · ${entry.path} | ${SERVICE_NAME}`,
    description: `${entry.summary} (${entry.priceFormatted} USDC via x402 V2 on ${networkLabel}).`,
    noindex: true,
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
            BUYER_PRIVATE_KEY: "0xYOUR_BASE_WALLET_PRIVATE_KEY",
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
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>MCP Streamable HTTP</span>
      </div>
      <h1 class="page-title"><code>POST ${safeBase}${escapeHtml(mcpPath)}</code></h1>
      <p class="lead">
        Stateless <strong>Streamable HTTP MCP endpoint</strong> (${toolCount} tools). Send JSON-RPC 2.0 <code>POST</code> requests from any x402-compatible MCP client, or run <code>npx -y exactjson-mcp</code> locally.
      </p>
      <div class="callout-box ok">
        <strong>Ready for MCP clients.</strong> Point an x402-native MCP client (such as AgentCash) at <code>${safeBase}${escapeHtml(mcpPath)}</code>, or use the local stdio config below.
      </div>
    </section>

    <section class="swiss-section grid-2">
      <div class="spec-cell surface">
        <span class="coord">Remote Streamable HTTP · zero install</span>
        <h2>Connect via JSON-RPC 2.0 POST</h2>
        <p>Point any Streamable HTTP MCP client at <code>${safeBase}${escapeHtml(mcpPath)}</code>, or list all ${toolCount} tools for free in your terminal:</p>
        ${renderCodeWell({
          id: "mcp-guide-curl",
          label: `POST ${mcpPath} · JSON-RPC 2.0`,
          copyLabel: "Copy MCP JSON-RPC tools/list curl command",
          codeHtml: highlightCode(curlPost, "bash"),
        })}
      </div>
      <div class="spec-cell surface">
        <span class="coord">Local stdio bridge · auto-sign Base USDC</span>
        <h2>Claude Desktop &amp; Cursor config</h2>
        <p>Run <code>npx -y exactjson-mcp</code> locally so Base USDC authorizations sign on your own machine with a $0.05 cap:</p>
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
        <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
        <a class="swiss-btn" href="${safeBase}/docs">API Docs</a>
        <a class="swiss-btn" href="${safeBase}/">All ${CATALOG.length} Tools</a>
        <a class="swiss-btn" href="${safeBase}/.well-known/mcp/server-card.json" target="_blank" rel="noopener noreferrer">MCP Server Card ↗</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `Remote MCP Endpoint (POST ${mcpPath}) | ${SERVICE_NAME}`,
    description: `Connect to ExactJSON's Streamable HTTP MCP endpoint via POST ${baseUrl}${mcpPath} (${toolCount} tools).`,
    noindex: true,
    mainHtml,
  });
}

export function renderNotFoundHtml(baseUrl: string, requestedPath: string): string {
  const safeBase = escapeHtml(baseUrl);
  const mainHtml = `
    <section class="spec-cell" style="padding: 3rem 2rem; border-bottom: none;">
      <div class="eyebrow-row">
        <span class="sig-badge warn"><span class="sig-dot warn" aria-hidden="true"></span>HTTP 404 · Not Found</span>
      </div>
      <h1 class="page-title">Page not found</h1>
      <p class="lead">
        No ${escapeHtml(SERVICE_NAME)} page or endpoint exists at <code>${escapeHtml(requestedPath)}</code>. Paid routes live under <code>/v1/*</code>.
      </p>
      <div class="btn-row" style="margin-top: 0.75rem;">
        <a class="swiss-btn primary" href="${safeBase}/setup">Quickstart →</a>
        <a class="swiss-btn" href="${safeBase}/#endpoints">Browse All ${CATALOG.length} Tools</a>
        <a class="swiss-btn" href="${safeBase}/docs">Go to ExactJSON Docs</a>
        <a class="swiss-btn" href="${safeBase}/pricing">Pricing</a>
      </div>
    </section>`;

  return renderSwissShell({
    baseUrl,
    title: `404 Not Found | ${SERVICE_NAME}`,
    description: `No ExactJSON route matches ${requestedPath}.`,
    noindex: true,
    mainHtml,
  });
}
