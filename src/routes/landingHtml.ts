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

interface EndpointGroup {
  title: string;
  subtitle: string;
  ids: readonly EndpointId[];
}

const ENDPOINT_GROUPS: readonly EndpointGroup[] = [
  {
    title: "Token Safety & Pre-Trade Execution",
    subtitle: "Dual-engine fail-closed safety audits and multi-tier swap/orderbook slippage ladders.",
    ids: ["evm_safety", "execution_quote_check", "solana_safety", "solana_trending"],
  },
  {
    title: "Perpetuals & Cross-Venue Funding",
    subtitle: "Hyperliquid L2 snapshots, full-market screeners, and 3-venue annualized funding spreads.",
    ids: ["perps_snapshot", "perps_screener", "perps_funding_arb"],
  },
  {
    title: "Prediction Markets, Options & US Macro",
    subtitle: "Polymarket + Kalshi cross-venue arbitrage, Deribit volatility surface, and Treasury/NY Fed liquidity.",
    ids: ["predictions_arb", "predictions_scanner", "options_surface", "macro_liquidity"],
  },
];

function renderEndpointRows(entries: readonly EndpointCatalogEntry[], baseUrl: string): string {
  return entries
    .map((entry) => {
      const sampleQuery = `${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}`;
      return `<tr>
        <td><code>GET ${escapeHtml(entry.path)}</code></td>
        <td class="price">${escapeHtml(entry.priceFormatted)}</td>
        <td>
          <strong>${escapeHtml(entry.summary)}</strong>
          <div class="desc">${escapeHtml(entry.description.replace(DISCLAIMER, "").trim())}</div>
          <div class="sample"><code>${escapeHtml(baseUrl + sampleQuery)}</code></div>
        </td>
      </tr>`;
    })
    .join("\n");
}

export function renderLandingHtml(baseUrl: string, network: string): string {
  const byId = new Map<EndpointId, EndpointCatalogEntry>(
    CATALOG.map((entry) => [entry.id, entry])
  );

  const groupedSections = ENDPOINT_GROUPS.map((group) => {
    const entries = group.ids
      .map((id) => byId.get(id))
      .filter((entry): entry is EndpointCatalogEntry => Boolean(entry));

    return `<section class="group">
      <div class="group-head">
        <h3>${escapeHtml(group.title)}</h3>
        <p>${escapeHtml(group.subtitle)}</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>USDC</th>
              <th>Output &amp; Sample Request</th>
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
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(SERVICE_NAME)} — Live, deterministic x402 APIs for AI agents">
  <meta property="og:description" content="${CATALOG.length} deterministic x402 V2 endpoints for AI agents on Base USDC ($0.005-$0.02/call) plus native MCP (npx -y exactjson-mcp).">
  <meta property="og:url" content="${escapeHtml(baseUrl)}/">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${structuredData}</script>
  <style>
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
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top right, rgba(56, 189, 248, 0.08), transparent 45%), var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.55;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    header {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 1rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border);
    }
    .logo { display: flex; align-items: center; gap: 0.65rem; font-weight: 700; font-size: 1.15rem; letter-spacing: -0.02em; }
    .badge {
      font-family: var(--mono); font-size: 0.75rem; padding: 0.2rem 0.55rem;
      border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted);
    }
    .badge.live { color: var(--green); border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.1); }
    nav { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.9rem; }
    .hero { display: grid; grid-template-columns: 1.15fr 1fr; gap: 2rem; align-items: center; padding: 3rem 0 2.5rem; }
    @media (max-width: 860px) { .hero { grid-template-columns: 1fr; } }
    h1 { margin: 0 0 0.85rem; font-size: clamp(2rem, 3.6vw, 2.85rem); line-height: 1.12; letter-spacing: -0.03em; }
    .lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.05rem; max-width: 58ch; }
    .pills { display: flex; flex-wrap: wrap; gap: 0.55rem; margin-bottom: 1.4rem; }
    .carbon {
      background: linear-gradient(145deg, #101726, #0b101b);
      border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
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
      margin: 0; padding: 1rem 1.1rem; overflow-x: auto; font-family: var(--mono);
      font-size: 0.82rem; line-height: 1.55; color: #dbeafe;
    }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 0 0 2.5rem; }
    @media (max-width: 780px) { .grid-3 { grid-template-columns: 1fr; } }
    .card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.1rem 1.2rem;
    }
    .card h2, .card h3 { margin: 0 0 0.4rem; font-size: 1rem; }
    .card p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    h2.section-title { margin: 2.25rem 0 0.5rem; font-size: 1.45rem; letter-spacing: -0.02em; }
    .section-sub { margin: 0 0 1.4rem; color: var(--muted); }
    .group { margin-bottom: 1.85rem; }
    .group-head h3 { margin: 0 0 0.2rem; font-size: 1.08rem; }
    .group-head p { margin: 0 0 0.75rem; color: var(--muted); font-size: 0.9rem; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); background: var(--surface-2); }
    tr:last-child td { border-bottom: none; }
    code { font-family: var(--mono); font-size: 0.84em; }
    .price { font-family: var(--mono); font-weight: 700; color: var(--green); white-space: nowrap; }
    .desc { color: var(--muted); font-size: 0.86rem; margin-top: 0.25rem; }
    .sample { margin-top: 0.35rem; color: #7dd3fc; font-size: 0.78rem; word-break: break-all; }
    .discovery { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.75rem; margin-top: 1rem; }
    .disc-link {
      display: block; padding: 0.75rem 0.95rem; border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface); font-family: var(--mono); font-size: 0.82rem;
    }
    footer {
      margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
      color: var(--muted); font-size: 0.85rem; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.75rem;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">
        <span>${escapeHtml(SERVICE_NAME)}</span>
        <span class="badge">v${escapeHtml(SERVICE_VERSION)}</span>
        <span class="badge live">x402 V2 · ${escapeHtml(network)}</span>
      </div>
      <nav aria-label="Primary">
        <a href="#endpoints">Endpoints (${CATALOG.length})</a>
        <a href="#quickstart">MCP &amp; Quickstart</a>
        <a href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI</a>
        <a href="${escapeHtml(baseUrl)}/llms.txt">llms.txt</a>
        <a href="https://github.com/exactjsondev/exactjson">GitHub</a>
      </nav>
    </header>

    <section class="hero">
      <div>
        <h1>Live, deterministic x402 APIs for AI agents.</h1>
        <p class="lead">
          <strong>${escapeHtml(SERVICE_NAME)}</strong> delivers pre-computed, strict-schema JSON endpoints paid per call in Base USDC ($0.005–$0.02). Built to replace 200 KB raw API dumps with compact ~2 KB answers that save context tokens and eliminate LLM math hallucinations.
        </p>
        <div class="pills">
          <span class="badge live">Pay-Only-On-Success (HTTP 200)</span>
          <span class="badge">Zero API Keys</span>
          <span class="badge">Fail-Closed 502 Safety</span>
          <span class="badge">Native MCP (12 Tools)</span>
        </div>
        <p class="desc">Send <code>Accept: application/json</code> to <code>GET /</code> for the machine-readable JSON index.</p>
      </div>
      <div class="carbon" aria-label="Quickstart snippet">
        <div class="carbon-bar">
          <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
          <span>exactjson · x402 V2 + MCP</span>
        </div>
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
    </section>

    <section class="grid-3" aria-label="Core guarantees">
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
      <p class="section-sub">All endpoints settle via x402 V2 (<code>exact</code> EVM scheme on <code>${escapeHtml(network)}</code>). Pre-flight status is always free at <code>GET /health</code>.</p>
      ${groupedSections}
    </section>

    <section id="quickstart">
      <h2 class="section-title">Discovery &amp; Machine Endpoints (Free)</h2>
      <p class="section-sub">Zero payment required for discovery, schemas, or health checks.</p>
      <div class="discovery">
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

    <footer>
      <div>${escapeHtml(DISCLAIMER)}</div>
      <div>Contact: <a href="mailto:hello@exactjson.com">hello@exactjson.com</a> · <a href="https://github.com/exactjsondev/exactjson">github.com/exactjsondev/exactjson</a></div>
    </footer>
  </div>
</body>
</html>`;
}
