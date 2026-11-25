import {
  CATALOG,
  DISCLAIMER,
  SERVICE_NAME,
  SERVICE_VERSION,
  type EndpointCatalogEntry,
  type EndpointId,
} from "../config/catalog";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep GET / cold starts < 10ms.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNetworkLabel(network: string): string {
  if (network === "eip155:8453") return "Base Mainnet (eip155:8453)";
  if (network === "eip155:84532") return "Base Sepolia (eip155:84532)";
  return network;
}

interface EndpointGroup {
  id: string;
  title: string;
  subtitle: string;
  ids: readonly EndpointId[];
}

const ENDPOINT_GROUPS: readonly EndpointGroup[] = [
  {
    id: "group-safety-execution",
    title: "Token Safety & Pre-Trade Execution",
    subtitle: "Dual-engine fail-closed safety audits and multi-tier swap/orderbook slippage ladders.",
    ids: ["evm_safety", "execution_quote_check", "solana_safety", "solana_trending"],
  },
  {
    id: "group-perps-funding",
    title: "Perpetuals & Cross-Venue Funding",
    subtitle: "Hyperliquid L2 snapshots, full-market screeners, and 3-venue annualized funding spreads.",
    ids: ["perps_snapshot", "perps_screener", "perps_funding_arb"],
  },
  {
    id: "group-predictions-options-macro",
    title: "Prediction Markets, Options & US Macro",
    subtitle: "Polymarket + Kalshi cross-venue arbitrage, Deribit volatility surface, and Treasury/NY Fed liquidity.",
    ids: ["predictions_arb", "predictions_scanner", "options_surface", "macro_liquidity"],
  },
];

function renderEndpointRows(entries: readonly EndpointCatalogEntry[], baseUrl: string): string {
  return entries
    .map((entry) => {
      const sampleQuery = `${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}`;
      const sampleUrl = `${baseUrl}${sampleQuery}`;
      const sampleJson = JSON.stringify(entry.outputExample, null, 2);
      return `<tr>
        <th scope="row" class="ep-cell"><code>GET ${escapeHtml(entry.path)}</code></th>
        <td class="price">${escapeHtml(entry.priceFormatted)}</td>
        <td>
          <strong>${escapeHtml(entry.summary)}</strong>
          <div class="desc">${escapeHtml(entry.description.replace(DISCLAIMER, "").trim())}</div>
          <div class="sample">
            <a href="${escapeHtml(sampleUrl)}"><code>${escapeHtml(sampleUrl)}</code></a>
          </div>
          <details class="sample-details">
            <summary>Sample JSON response (${escapeHtml(entry.path)})</summary>
            <pre class="sample-json">${escapeHtml(sampleJson)}</pre>
          </details>
        </td>
      </tr>`;
    })
    .join("\n");
}

const SHARED_CSS = `
    :root {
      color-scheme: dark;
      --bg: #090c12;
      --surface: #111622;
      --surface-2: #161d2d;
      --border: #232d42;
      --text: #edf2fa;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --green: #34d399;
      --amber: #fbbf24;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    html { overflow-x: clip; }
    body {
      margin: 0;
      background: radial-gradient(circle at top right, rgba(56, 189, 248, 0.08), transparent 45%), var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.55;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    :where(a:any-link, button, summary, [tabindex="0"]):focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 3px;
      border-radius: 4px;
    }
    .visually-hidden:where(:not(:focus-within, :active)) {
      position: absolute !important;
      clip-path: inset(50%) !important;
      overflow: hidden !important;
      width: 1px !important;
      height: 1px !important;
      margin: -1px !important;
      padding: 0 !important;
      border: 0 !important;
      white-space: nowrap !important;
    }
    .skip-link:focus-visible {
      position: fixed;
      inset-block-start: 0.75rem;
      inset-inline-start: 0.75rem;
      z-index: 100;
      padding: 0.6rem 1rem;
      border-radius: 8px;
      background: var(--accent);
      color: #06131f;
      font-weight: 700;
      text-decoration: none;
    }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    header {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 1rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border);
    }
    .logo { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem; font-weight: 700; font-size: 1.15rem; letter-spacing: -0.02em; }
    .logo-brand { color: var(--text); }
    .badge {
      font-family: var(--mono); font-size: 0.75rem; padding: 0.2rem 0.55rem;
      border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted);
    }
    .badge.live { color: var(--green); border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.1); }
    .badge.warn { color: var(--amber); border-color: rgba(251, 191, 36, 0.35); background: rgba(251, 191, 36, 0.1); }
    nav { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; }
    nav a { min-block-size: 24px; display: inline-flex; align-items: center; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 2rem; align-items: center; padding: 3rem 0 2.5rem; }
    .hero > * { min-width: 0; }
    @media (max-width: 860px) { .hero { grid-template-columns: minmax(0, 1fr); padding: 2rem 0; } }
    h1 { margin: 0 0 0.85rem; font-size: clamp(2rem, 3.6vw, 2.85rem); line-height: 1.12; letter-spacing: -0.03em; }
    .lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.05rem; max-width: 58ch; }
    .pills { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-bottom: 1.25rem; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.1rem; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      min-block-size: 38px; padding: 0.5rem 1rem; border-radius: 9px;
      font-size: 0.9rem; font-weight: 600; border: 1px solid var(--border);
      background: var(--surface-2); color: var(--text); text-decoration: none;
    }
    .btn:hover { border-color: var(--accent); text-decoration: none; }
    .btn.primary { background: var(--accent); color: #06131f; border-color: var(--accent); }
    .btn.primary:hover { filter: brightness(1.06); }
    .carbon {
      background: linear-gradient(145deg, #101726, #0b101b);
      border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      min-width: 0; max-inline-size: 100%;
    }
    .carbon-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.65rem 0.95rem; border-bottom: 1px solid var(--border); background: rgba(255, 255, 255, 0.02);
      font-family: var(--mono); font-size: 0.75rem; color: var(--muted);
    }
    .dots { display: flex; gap: 0.4rem; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot.r { background: #ef4444; } .dot.y { background: #f59e0b; } .dot.g { background: #22c55e; }
    pre {
      margin: 0; padding: 1rem 1.1rem; overflow-x: auto; max-inline-size: 100%; font-family: var(--mono);
      font-size: 0.82rem; line-height: 1.55; color: #dbeafe;
    }
    .security-note {
      margin: 0.65rem 0 0; padding: 0 0.2rem; color: var(--muted); font-size: 0.82rem;
    }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 0 0 2.5rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
    @media (max-width: 780px) { .grid-3, .grid-2 { grid-template-columns: minmax(0, 1fr); } }
    .card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.1rem 1.2rem;
      min-width: 0;
    }
    .card h2, .card h3 { margin: 0 0 0.45rem; font-size: 1rem; }
    .card p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .card pre {
      margin-top: 0.75rem; padding: 0.85rem 0.95rem; border-radius: 9px;
      background: #0b101b; border: 1px solid var(--border); font-size: 0.78rem;
    }
    h2.section-title { margin: 2.5rem 0 0.5rem; font-size: 1.45rem; letter-spacing: -0.02em; }
    .section-sub { margin: 0 0 1.4rem; color: var(--muted); }
    .group { margin-bottom: 1.85rem; }
    .group-head h3 { margin: 0 0 0.2rem; font-size: 1.08rem; }
    .group-head p { margin: 0 0 0.75rem; color: var(--muted); font-size: 0.9rem; }
    .table-wrap {
      overflow-x: auto; max-inline-size: 100%; container-type: inline-size;
      border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
    }
    table {
      width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.9rem;
      --label-1: "Endpoint";
      --label-2: "Price (USDC)";
      --label-3: "Output & Sample";
    }
    th, td { text-align: left; padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    thead th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); background: var(--surface-2); }
    tbody th.ep-cell { font-weight: 600; white-space: nowrap; }
    tr:last-child th, tr:last-child td { border-bottom: none; }
    code { font-family: var(--mono); font-size: 0.84em; }
    .price { font-family: var(--mono); font-weight: 700; color: var(--green); white-space: nowrap; }
    .desc { color: var(--muted); font-size: 0.86rem; margin-top: 0.25rem; }
    .sample { margin-top: 0.4rem; font-size: 0.78rem; word-break: break-all; }
    .sample a { color: #7dd3fc; }
    .sample-details {
      margin-top: 0.65rem; border: 1px solid var(--border); border-radius: 8px; background: #0c111d;
    }
    .sample-details > summary {
      list-style: none; cursor: pointer; display: flex; align-items: center; gap: 0.5ch;
      padding: 0.45rem 0.75rem; min-block-size: 32px; font-family: var(--mono);
      font-size: 0.78rem; color: var(--muted); user-select: none;
    }
    .sample-details > summary::-webkit-details-marker { display: none; }
    .sample-details > summary::before {
      content: "▸"; display: inline-block; flex-shrink: 0; color: var(--accent);
      transform: rotate(0deg);
    }
    .sample-details[open] > summary::before { transform: rotate(90deg); }
    .sample-details[open] > summary { color: var(--text); border-bottom: 1px solid var(--border); }
    .sample-json {
      padding: 0.75rem 0.9rem; font-size: 0.75rem; line-height: 1.48;
      max-block-size: 320px; overflow: auto; color: #cbd5e1;
    }
    .sample-details::details-content {
      interpolate-size: allow-keywords;
      overflow: clip;
      contain: layout;
    }
    .sample-details:not([open])::details-content { block-size: 0; }
    @media (prefers-reduced-motion: no-preference) {
      .sample-details > summary::before { transition: transform 0.2s ease; }
      .sample-details::details-content {
        transition: block-size 0.22s ease-in-out, content-visibility 0.22s allow-discrete;
      }
    }
    @container (width < 680px) {
      table, thead, tbody, tr, th, td { display: block; }
      thead { display: none; }
      tbody tr {
        margin: 0.75rem; border: 1px solid var(--border); border-radius: 10px; background: #0d1320;
      }
      tbody th.ep-cell {
        white-space: normal; word-break: break-word; background: var(--surface-2);
        border-radius: 10px 10px 0 0; border-bottom: 1px solid var(--border);
      }
      tbody td { border-bottom: 1px solid var(--border); }
      tbody tr td:last-child { border-bottom: none; }
      tbody td.price::before { content: var(--label-2) ": "; color: var(--muted); font-weight: 500; }
    }
    .discovery { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.75rem; margin-top: 1rem; }
    .disc-link {
      display: block; padding: 0.75rem 0.95rem; border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface); font-family: var(--mono); font-size: 0.82rem;
    }
    footer {
      margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
      color: var(--muted); font-size: 0.85rem; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.75rem;
    }
`;

export function renderLandingHtml(baseUrl: string, network: string): string {
  const byId = new Map<EndpointId, EndpointCatalogEntry>(
    CATALOG.map((entry) => [entry.id, entry])
  );
  const networkLabel = formatNetworkLabel(network);

  const groupedSections = ENDPOINT_GROUPS.map((group) => {
    const entries = group.ids
      .map((id) => byId.get(id))
      .filter((entry): entry is EndpointCatalogEntry => Boolean(entry));

    return `<section class="group">
      <div class="group-head">
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
              <th scope="col">Output &amp; Sample Request</th>
            </tr>
          </thead>
          <tbody>
            ${renderEndpointRows(entries, baseUrl)}
          </tbody>
        </table>
      </div>
    </section>`;
  }).join("\n");

  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: `${SERVICE_NAME} — Live, deterministic x402 APIs for AI agents`,
    url: baseUrl,
    documentation: `${baseUrl}/llms.txt`,
    description:
      "Pre-computed, deterministic, compact JSON endpoints for AI agents via x402 V2 Base Mainnet USDC micro-payments ($0.005-$0.02/call). Pay-only-on-success with zero API keys or subscriptions.",
    provider: {
      "@type": "Organization",
      name: SERVICE_NAME,
      url: baseUrl,
      email: "hello@exactjson.com",
    },
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(SERVICE_NAME)} — Live, deterministic x402 APIs for AI agents</title>
  <meta name="description" content="ExactJSON serves live, deterministic, token-optimized x402 V2 JSON endpoints for AI agents on Base USDC ($0.005-$0.02/call). Zero API keys, strict schemas, pay-only-on-success.">
  <link rel="canonical" href="${escapeHtml(baseUrl)}/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(SERVICE_NAME)} — Live, deterministic x402 APIs for AI agents">
  <meta property="og:description" content="${CATALOG.length} deterministic x402 V2 endpoints for AI agents on Base USDC ($0.005-$0.02/call) plus native MCP (npx -y exactjson-mcp).">
  <meta property="og:url" content="${escapeHtml(baseUrl)}/">
  <meta property="og:image" content="${escapeHtml(baseUrl)}/og-image.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1376">
  <meta property="og:image:height" content="768">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(SERVICE_NAME)} — Live, deterministic x402 APIs for AI agents">
  <meta name="twitter:description" content="${CATALOG.length} live x402 V2 JSON APIs for AI agents on Base USDC ($0.005-$0.02/call) + native MCP.">
  <meta name="twitter:image" content="${escapeHtml(baseUrl)}/og-image.jpg">
  <script type="application/ld+json">${structuredData}</script>
  <style>${SHARED_CSS}  </style>
</head>
<body>
  <a href="#main-content" class="skip-link visually-hidden">Skip to main content</a>
  <div class="wrap">
    <header>
      <div class="logo">
        <a class="logo-brand" href="${escapeHtml(baseUrl)}/">${escapeHtml(SERVICE_NAME)}</a>
        <span class="badge">v${escapeHtml(SERVICE_VERSION)}</span>
        <span class="badge live">x402 V2 · ${escapeHtml(networkLabel)}</span>
      </div>
      <nav aria-label="Primary">
        <a href="#endpoints">Endpoints (${CATALOG.length})</a>
        <a href="#quickstart">Quickstart</a>
        <a href="#discovery">Discovery</a>
        <a href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI</a>
        <a href="${escapeHtml(baseUrl)}/llms.txt">llms.txt</a>
        <a href="https://github.com/exactjsondev/exactjson">GitHub</a>
      </nav>
    </header>

    <main id="main-content">
      <section class="hero">
        <div>
          <h1 tabindex="-1">Live, deterministic x402 APIs for AI agents.</h1>
          <p class="lead">
            <strong>${escapeHtml(SERVICE_NAME)}</strong> delivers pre-computed, strict-schema JSON endpoints paid per call in Base USDC ($0.005–$0.02). Built to replace 200 KB raw API dumps with compact ~2 KB answers that save context tokens and eliminate LLM math hallucinations.
          </p>
          <div class="pills">
            <span class="badge live">Pay-Only-On-Success (HTTP 200)</span>
            <span class="badge">Zero API Keys</span>
            <span class="badge">Fail-Closed 502 Safety</span>
            <span class="badge">Remote &amp; Stdio MCP (12 Tools)</span>
          </div>
          <div class="hero-actions">
            <a class="btn primary" href="#quickstart">MCP &amp; HTTP Quickstart</a>
            <a class="btn" href="#endpoints">Explore ${CATALOG.length} Endpoints</a>
            <a class="btn" href="${escapeHtml(baseUrl)}/health">Free /health Check</a>
          </div>
          <p class="desc">Remote Streamable HTTP MCP: <code>${escapeHtml(baseUrl)}/mcp</code> · Machine JSON index: <code>GET /</code> with <code>Accept: application/json</code>.</p>
        </div>
        <div>
          <div class="carbon">
            <div class="carbon-bar">
              <div class="dots" aria-hidden="true"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
              <span>Remote Streamable HTTP &amp; Stdio MCP</span>
            </div>
            <pre>{
  "mcpServers": {
    "exactjson-remote": {
      "url": "${escapeHtml(baseUrl)}/mcp"
    },
    "exactjson-stdio": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    }
  }
}</pre>
          </div>
          <p class="security-note">
            Use Remote Streamable HTTP (<code>${escapeHtml(baseUrl)}/mcp</code>) with x402-native MCP clients, or run <code>exactjson-mcp</code> locally so EIP-3009 Base USDC authorizations sign on your machine capped by <code>MAX_PAYMENT_USD</code>.
          </p>
        </div>
      </section>

      <section class="grid-3">
        <div class="card">
          <h2>Token-Efficient JSON</h2>
          <p>Every endpoint distills multi-source feeds (600+ options contracts, 3-venue perp funding, dual-engine token audits) into one deterministic payload.</p>
        </div>
        <div class="card">
          <h2>Pay-Only-On-Success</h2>
          <p>Unpaid probes return HTTP <code>402</code> with <code>PAYMENT-REQUIRED</code> terms. Invalid inputs (<code>400</code>/<code>404</code>) and upstream failures (<code>502</code>/<code>503</code>) never settle.</p>
        </div>
        <div class="card">
          <h2>Machine Discovery First</h2>
          <p>Auto-discoverable via <code>/.well-known/x402</code>, <code>/.well-known/x402.json</code>, RFC 9727 API Catalog, OpenAPI 3.1, A2A Agent Card, and MCP Server Card.</p>
        </div>
      </section>

      <section id="endpoints">
        <h2 class="section-title">Paid Endpoints (${CATALOG.length} Live on Base USDC)</h2>
        <p class="section-sub">
          All endpoints settle via x402 V2 (<code>exact</code> EVM scheme on <code>${escapeHtml(networkLabel)}</code>). Expand any row to inspect the exact output schema, or check live availability for free at <a href="${escapeHtml(baseUrl)}/health"><code>GET /health</code></a>.
        </p>
        ${groupedSections}
      </section>

      <section id="quickstart">
        <h2 class="section-title">Quickstart: Try Free, Then Pay Per Call</h2>
        <p class="section-sub">
          No signup, no API keys, no subscriptions. Start with a free <code>/health</code> or <code>402</code> probe, then call paid endpoints via MCP or <code>@x402/fetch</code> using a low-balance Base USDC wallet.
        </p>
        <div class="grid-2">
          <div class="card">
            <h3>1. Test Free in Terminal (curl)</h3>
            <p>Verify live status or inspect x402 V2 payment terms (<code>PAYMENT-REQUIRED</code> header) with zero wallet setup:</p>
            <pre># Free health check (HTTP 200)
curl -s ${escapeHtml(baseUrl)}/health

# Unpaid probe returns HTTP 402 + PAYMENT-REQUIRED header
curl -i "${escapeHtml(baseUrl)}/v1/perps/snapshot?coin=BTC"</pre>
          </div>
          <div class="card">
            <h3>2. Call from Node / TypeScript (@x402/fetch)</h3>
            <p>Wrap standard <code>fetch</code> so 402 challenges are signed locally with Base USDC and capped per call:</p>
            <pre>import { wrapFetchWithPayment, x402Client } from &quot;@x402/fetch&quot;;
import { registerExactEvmScheme } from &quot;@x402/evm/exact/client&quot;;
import { privateKeyToAccount } from &quot;viem/accounts&quot;;

const client = new x402Client()
  .setSpendControls({ maxAmountPerPayment: "$0.05" });
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY),
});
const payFetch = wrapFetchWithPayment(fetch, client);
const res = await payFetch(
  "${escapeHtml(baseUrl)}/v1/perps/snapshot?coin=BTC"
);
console.log(await res.json());</pre>
          </div>
        </div>
      </section>

      <section id="discovery">
        <h2 class="section-title">Discovery &amp; Machine Endpoints (Free)</h2>
        <p class="section-sub">Zero payment required for discovery, schemas, or health checks. CORS-enabled for browser agents and playgrounds.</p>
        <div class="discovery">
          <a class="disc-link" href="${escapeHtml(baseUrl)}/mcp">/mcp (Streamable HTTP)</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/.well-known/x402">/.well-known/x402</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/.well-known/x402.json">/.well-known/x402.json</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/.well-known/api-catalog">/.well-known/api-catalog</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/.well-known/agent-card.json">/.well-known/agent-card.json</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/openapi.json">/openapi.json</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/llms.txt">/llms.txt</a>
          <a class="disc-link" href="${escapeHtml(baseUrl)}/health">/health</a>
        </div>
      </section>
    </main>

    <footer>
      <div>${escapeHtml(DISCLAIMER)}</div>
      <div>Contact: <a href="mailto:hello@exactjson.com">hello@exactjson.com</a> · <a href="https://github.com/exactjsondev/exactjson">github.com/exactjsondev/exactjson</a> · <a href="https://www.npmjs.com/package/exactjson-mcp">npm: exactjson-mcp</a></div>
    </footer>
  </div>
</body>
</html>`;
}

export function renderPaywallHtml(
  entry: EndpointCatalogEntry,
  baseUrl: string,
  network: string,
  requestedUrl: string
): string {
  const networkLabel = formatNetworkLabel(network);
  const sampleJson = JSON.stringify(entry.outputExample, null, 2);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex, nofollow">
  <title>HTTP 402 Payment Required · ${escapeHtml(entry.path)} | ${escapeHtml(SERVICE_NAME)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <style>${SHARED_CSS}  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">
        <a class="logo-brand" href="${escapeHtml(baseUrl)}/">${escapeHtml(SERVICE_NAME)}</a>
        <span class="badge warn">HTTP 402 · Payment Required</span>
        <span class="badge live">${escapeHtml(entry.priceFormatted)} USDC · ${escapeHtml(networkLabel)}</span>
      </div>
      <nav aria-label="Primary">
        <a href="${escapeHtml(baseUrl)}/">← All Endpoints</a>
        <a href="${escapeHtml(baseUrl)}/#quickstart">Quickstart</a>
        <a href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI</a>
      </nav>
    </header>

    <main>
      <section style="padding: 2rem 0 1rem;">
        <h1><code>GET ${escapeHtml(entry.path)}</code></h1>
        <p class="lead">${escapeHtml(entry.summary)}. ${escapeHtml(entry.description.replace(DISCLAIMER, "").trim())}</p>
        <div class="pills">
          <span class="badge live">Price: ${escapeHtml(entry.priceFormatted)} USDC</span>
          <span class="badge">x402 V2 · ${escapeHtml(networkLabel)}</span>
          <span class="badge">Pay-Only-On-Success (400/404/502/503 never settle)</span>
        </div>
        <p class="desc">
          Browsers cannot automatically attach x402 V2 <code>PAYMENT-SIGNATURE</code> headers. This response already includes the live base64 <code>PAYMENT-REQUIRED</code> header for x402 clients and AI agents.
        </p>
      </section>

      <div class="grid-2">
        <div class="card">
          <h3>Call via MCP (Claude Desktop / Cursor)</h3>
          <p>Run <code>exactjson_${escapeHtml(entry.id)}</code> automatically with a local Base USDC spend cap:</p>
          <pre>{
  "mcpServers": {
    "exactjson": {
      "command": "npx",
      "args": ["-y", "exactjson-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    }
  }
}</pre>
        </div>
        <div class="card">
          <h3>Inspect x402 Challenge or Call via SDK</h3>
          <p>Inspect the raw <code>PAYMENT-REQUIRED</code> header in terminal, or wrap <code>fetch</code> with <code>@x402/fetch</code>:</p>
          <pre># Inspect base64 x402 V2 terms
curl -i "${escapeHtml(requestedUrl)}"

# Or read the full OpenAPI 3.1 schema
curl -s ${escapeHtml(baseUrl)}/openapi.json</pre>
        </div>
      </div>

      <section style="margin-top: 1.5rem;">
        <details class="sample-details" open>
          <summary>Sample JSON response for ${escapeHtml(entry.path)}</summary>
          <pre class="sample-json">${escapeHtml(sampleJson)}</pre>
        </details>
      </section>
    </main>

    <footer>
      <div>${escapeHtml(DISCLAIMER)}</div>
      <div><a href="${escapeHtml(baseUrl)}/">← Back to ${escapeHtml(SERVICE_NAME)} Docs</a> · <a href="mailto:hello@exactjson.com">hello@exactjson.com</a></div>
    </footer>
  </div>
</body>
</html>`;
}

export function renderNotFoundHtml(baseUrl: string, requestedPath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex, nofollow">
  <title>404 Not Found | ${escapeHtml(SERVICE_NAME)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <style>${SHARED_CSS}  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">
        <a class="logo-brand" href="${escapeHtml(baseUrl)}/">${escapeHtml(SERVICE_NAME)}</a>
        <span class="badge">v${escapeHtml(SERVICE_VERSION)}</span>
      </div>
      <nav aria-label="Primary">
        <a href="${escapeHtml(baseUrl)}/">Home</a>
        <a href="${escapeHtml(baseUrl)}/#endpoints">Endpoints (${CATALOG.length})</a>
        <a href="${escapeHtml(baseUrl)}/#quickstart">Quickstart</a>
        <a href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI</a>
      </nav>
    </header>

    <main style="padding: 3rem 0;">
      <span class="badge warn">HTTP 404</span>
      <h1 style="margin-top: 0.75rem;">Page not found</h1>
      <p class="lead">
        No ${escapeHtml(SERVICE_NAME)} route matches <code>${escapeHtml(requestedPath)}</code>. All documentation, pricing, and quickstart guides live on the main page.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="${escapeHtml(baseUrl)}/">Go to ExactJSON Docs</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/#endpoints">View All ${CATALOG.length} Endpoints</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI 3.1</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/llms.txt">llms.txt</a>
      </div>
    </main>

    <footer>
      <div>${escapeHtml(DISCLAIMER)}</div>
      <div>Contact: <a href="mailto:hello@exactjson.com">hello@exactjson.com</a></div>
    </footer>
  </div>
</body>
</html>`;
}
