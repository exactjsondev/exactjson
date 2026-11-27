import {
  CATALOG,
  DISCLAIMER,
  MARKETS_PACK,
  PACKS,
  SERVICE_NAME,
  SERVICE_VERSION,
  getActivePacks,
  getPackEndpoints,
  type EndpointCatalogEntry,
  type EndpointId,
} from "../config/catalog";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep GET / cold starts < 10ms.

const X402SCAN_URL = "https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc";

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

const ENDPOINT_GROUPS = MARKETS_PACK.subgroups ?? [];

function stripPackDisclaimer(entry: EndpointCatalogEntry): string {
  return entry.description.replace(PACKS[entry.pack].disclaimer, "").trim();
}

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
          <div class="desc">${escapeHtml(stripPackDisclaimer(entry))}</div>
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

function renderBrandJsonLd(baseUrl: string, includeOffers = false): string {
  const organization = {
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: SERVICE_NAME,
    url: baseUrl,
    logo: `${baseUrl}/favicon.svg`,
    description:
      "ExactJSON builds live, deterministic, token-optimized x402 V2 pay-per-call JSON APIs and MCP servers for AI agents on Base Mainnet USDC.",
    email: "hello@exactjson.com",
    sameAs: [
      "https://github.com/exactjsondev/exactjson",
      "https://www.npmjs.com/package/exactjson-mcp",
      "https://glama.ai/mcp/servers/exactjsondev/exactjson",
      X402SCAN_URL,
    ],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "technical support",
      email: "hello@exactjson.com",
      url: `${baseUrl}/contact`,
      availableLanguage: "English",
    },
  };

  const webApi: Record<string, unknown> = {
    "@type": "WebAPI",
    "@id": `${baseUrl}/#api`,
    name: "ExactJSON x402 API",
    serviceType:
      "x402 pay-per-call market, security, physical-world, B2B commerce, and scientific research intelligence JSON API",
    url: baseUrl,
    documentation: `${baseUrl}/docs`,
    keywords:
      "x402 API, AI agent API, MCP server, Base USDC micropayments, EVM token safety, Solana safety, Hyperliquid perpetuals, Polymarket Kalshi arbitrage, Deribit options surface, US macro liquidity, BIS central bank policy rates, OSS package audit, CVE triage, domain trust, airport delays METAR, space weather GNSS, GDACS hazard brief, travel advisories, NASA POWER solar, EU VIES VAT verify, IBAN checksum, GLEIF LEI KYB, CPSC openFDA recall, Crossref DataCite DOI citation verify, PubChem GHS chemical safety, ClinicalTrials.gov RxNorm",
    description:
      "Pre-computed, deterministic, compact JSON endpoints for AI agents via x402 V2 Base Mainnet USDC micro-payments ($0.005-$0.02/call). Pay-only-on-success with zero API keys or subscriptions.",
    provider: { "@id": `${baseUrl}/#organization` },
  };

  if (includeOffers) {
    webApi.offers = CATALOG.map((entry) => ({
      "@type": "Offer",
      name: `${entry.method} ${entry.path} — ${entry.summary}`,
      description: entry.summary,
      price: entry.priceAmount,
      priceCurrency: "USD",
      url: `${baseUrl}/pricing`,
    }));
  }

  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [organization, webApi],
  }).replace(/</g, "\\u003c");
}

function renderHtmlPageShell(opts: {
  baseUrl: string;
  title: string;
  description: string;
  canonicalPath: string;
  badgesHtml?: string;
  jsonLd?: string;
  noindex?: boolean;
  mainHtml: string;
}): string {
  const canonicalUrl = `${opts.baseUrl}${opts.canonicalPath}`;
  const robotsMeta = opts.noindex ? '\n  <meta name="robots" content="noindex, nofollow">' : "";
  const jsonLdScript = opts.jsonLd
    ? `\n  <script type="application/ld+json">${opts.jsonLd}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">${robotsMeta}
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(opts.title)}">
  <meta property="og:description" content="${escapeHtml(opts.description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(opts.baseUrl)}/og-image.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(opts.title)}">
  <meta name="twitter:description" content="${escapeHtml(opts.description)}">
  <meta name="twitter:image" content="${escapeHtml(opts.baseUrl)}/og-image.jpg">${jsonLdScript}
  <style>${SHARED_CSS}  </style>
</head>
<body>
  <a href="#main-content" class="skip-link visually-hidden">Skip to main content</a>
  <div class="wrap">
    <header>
      <div class="logo">
        <a class="logo-brand" href="${escapeHtml(opts.baseUrl)}/">${escapeHtml(SERVICE_NAME)}</a>
        <span class="badge">v${escapeHtml(SERVICE_VERSION)}</span>
        ${opts.badgesHtml ?? ""}
      </div>
      <nav aria-label="Primary">
        <a href="${escapeHtml(opts.baseUrl)}/">Home</a>
        <a href="${escapeHtml(opts.baseUrl)}/docs">Docs</a>
        <a href="${escapeHtml(opts.baseUrl)}/pricing">Pricing</a>
        <a href="${escapeHtml(opts.baseUrl)}/openapi.json">OpenAPI</a>
        <a href="${escapeHtml(opts.baseUrl)}/llms.txt">llms.txt</a>
        <a href="https://github.com/exactjsondev/exactjson">GitHub</a>
      </nav>
    </header>

    <main id="main-content">
      ${opts.mainHtml}
    </main>

    <footer>
      <div>${escapeHtml(DISCLAIMER)}</div>
      <div><a href="${escapeHtml(opts.baseUrl)}/docs">Docs</a> · <a href="${escapeHtml(opts.baseUrl)}/pricing">Pricing</a> · <a href="${escapeHtml(opts.baseUrl)}/about">About</a> · <a href="${escapeHtml(opts.baseUrl)}/contact">Contact</a> · <a href="${escapeHtml(opts.baseUrl)}/privacy">Privacy</a> · <a href="mailto:hello@exactjson.com">hello@exactjson.com</a> · <a href="https://github.com/exactjsondev/exactjson">GitHub</a> · <a href="https://www.npmjs.com/package/exactjson-mcp">npm</a></div>
    </footer>
  </div>
</body>
</html>`;
}

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

  const extraPackSections = getActivePacks()
    .filter((pack) => pack.id !== "markets")
    .map((pack) => {
      const entries = getPackEndpoints([pack.id]);
      return `<section class="group">
      <div class="group-head">
        <h3 id="pack-${escapeHtml(pack.id)}">${escapeHtml(pack.title)}</h3>
        <p>${escapeHtml(pack.subtitle)}</p>
      </div>
      <div tabindex="0" role="region" aria-labelledby="pack-${escapeHtml(pack.id)}" class="table-wrap">
        <table>
          <caption class="visually-hidden">${escapeHtml(pack.title)} paid x402 endpoints</caption>
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
    })
    .join("\n");

  const structuredData = renderBrandJsonLd(baseUrl, true);

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
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(SERVICE_NAME)} — Live, deterministic x402 APIs for AI agents">
  <meta property="og:description" content="${CATALOG.length} deterministic x402 V2 endpoints for AI agents on Base USDC ($0.005-$0.02/call) plus native MCP (npx -y exactjson-mcp).">
  <meta property="og:url" content="${escapeHtml(baseUrl)}/">
  <meta property="og:image" content="${escapeHtml(baseUrl)}/og-image.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
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
        <a href="${escapeHtml(baseUrl)}/docs">Docs</a>
        <a href="${escapeHtml(baseUrl)}/pricing">Pricing</a>
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
            <span class="badge">Remote &amp; Stdio MCP (${1 + getPackEndpoints(["markets"]).length} Tools)</span>
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
        ${extraPackSections}
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
      <div><a href="${escapeHtml(baseUrl)}/docs">Docs</a> · <a href="${escapeHtml(baseUrl)}/pricing">Pricing</a> · <a href="${escapeHtml(baseUrl)}/about">About</a> · <a href="${escapeHtml(baseUrl)}/contact">Contact</a> · <a href="${escapeHtml(baseUrl)}/privacy">Privacy</a> · <a href="mailto:hello@exactjson.com">hello@exactjson.com</a> · <a href="https://github.com/exactjsondev/exactjson">GitHub</a> · <a href="https://www.npmjs.com/package/exactjson-mcp">npm</a></div>
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
  const packDisclaimer = PACKS[entry.pack].disclaimer;
  const stdioArgsJson =
    entry.pack === "markets"
      ? '["-y", "exactjson-mcp"]'
      : `["-y", "exactjson-mcp", "--pack", "${escapeHtml(entry.pack)}"]`;

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
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
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
        <p class="lead">${escapeHtml(entry.summary)}. ${escapeHtml(stripPackDisclaimer(entry))}</p>
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
      "args": ${stdioArgsJson},
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
      <div>${escapeHtml(packDisclaimer)}</div>
      <div><a href="${escapeHtml(baseUrl)}/">← Back to ${escapeHtml(SERVICE_NAME)} Docs</a> · <a href="mailto:hello@exactjson.com">hello@exactjson.com</a></div>
    </footer>
  </div>
</body>
</html>`;
}

export function renderMcpGuideHtml(
  baseUrl: string,
  mcpPath = "/mcp",
  toolCount = 1 + getPackEndpoints(["markets"]).length
): string {
  const packSuffix = mcpPath.startsWith("/mcp/")
    ? mcpPath.slice("/mcp/".length)
    : mcpPath.startsWith("/mcp?pack=")
      ? mcpPath.slice("/mcp?pack=".length)
      : "";
  const stdioArgsJson =
    !packSuffix || packSuffix === "markets"
      ? '["-y", "exactjson-mcp"]'
      : `["-y", "exactjson-mcp", "--pack", "${escapeHtml(packSuffix)}"]`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex, nofollow">
  <title>Remote MCP Endpoint (POST ${escapeHtml(mcpPath)}) | ${escapeHtml(SERVICE_NAME)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <style>${SHARED_CSS}  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">
        <a class="logo-brand" href="${escapeHtml(baseUrl)}/">${escapeHtml(SERVICE_NAME)}</a>
        <span class="badge warn">HTTP 405 · POST Required</span>
        <span class="badge live">MCP Streamable HTTP · v${escapeHtml(SERVICE_VERSION)}</span>
      </div>
      <nav aria-label="Primary">
        <a href="${escapeHtml(baseUrl)}/">← All Endpoints</a>
        <a href="${escapeHtml(baseUrl)}/#quickstart">Quickstart</a>
        <a href="${escapeHtml(baseUrl)}/.well-known/mcp/server-card.json">Server Card</a>
      </nav>
    </header>

    <main>
      <section style="padding: 2rem 0 1rem;">
        <h1><code>POST ${escapeHtml(baseUrl)}${escapeHtml(mcpPath)}</code></h1>
        <p class="lead">
          This is ExactJSON's stateless <strong>Streamable HTTP MCP endpoint</strong> (JSON-RPC 2.0, ${toolCount} tools). Browsers send <code>GET</code>, which returns <code>405 Method Not Allowed</code> — connect your MCP client via <code>POST</code> or use the local stdio CLI.
        </p>
      </section>

      <div class="grid-2">
        <div class="card">
          <h3>1. Remote Streamable HTTP (Zero Install)</h3>
          <p>Point any Streamable HTTP MCP client at <code>${escapeHtml(baseUrl)}${escapeHtml(mcpPath)}</code>, or test in terminal:</p>
          <pre>curl -s -X POST "${escapeHtml(baseUrl)}${escapeHtml(mcpPath)}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</pre>
        </div>
        <div class="card">
          <h3>2. Local Stdio MCP (Auto-Sign Base USDC)</h3>
          <p>Use <code>npx -y exactjson-mcp</code> in Claude Desktop or Cursor for local EIP-3009 signing:</p>
          <pre>{
  "mcpServers": {
    "exactjson": {
      "command": "npx",
      "args": ${stdioArgsJson},
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_LOW_BALANCE_KEY",
        "MAX_PAYMENT_USD": "$0.05"
      }
    }
  }
}</pre>
        </div>
      </div>

      <div class="hero-actions" style="margin-top: 1.5rem;">
        <a class="btn primary" href="${escapeHtml(baseUrl)}/">← Back to ExactJSON Docs</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/.well-known/mcp/server-card.json">View MCP Server Card</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI 3.1</a>
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

export function renderDocsHtml(baseUrl: string, network: string): string {
  const networkLabel = formatNetworkLabel(network);
  const endpointRows = CATALOG.map((entry) => {
    const sampleUrl = `${baseUrl}${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}`;
    return `<tr>
      <th scope="row" class="ep-cell"><code>GET ${escapeHtml(entry.path)}</code></th>
      <td class="price">${escapeHtml(entry.priceFormatted)}</td>
      <td>
        <strong>${escapeHtml(entry.summary)}</strong>
        <div class="desc">${escapeHtml(stripPackDisclaimer(entry))}</div>
        <div class="sample"><a href="${escapeHtml(sampleUrl)}"><code>${escapeHtml(sampleUrl)}</code></a></div>
      </td>
    </tr>`;
  }).join("\n");

  const mainHtml = `
    <section style="padding: 2rem 0 1.25rem;">
      <h1>ExactJSON API &amp; MCP Documentation</h1>
      <p class="lead">
        ExactJSON exposes ${CATALOG.length} live, deterministic, pay-per-call JSON endpoints over <strong>x402 V2</strong> (${escapeHtml(networkLabel)}, USDC) and <strong>Model Context Protocol (MCP)</strong>. No API keys, no account registration, and strict Pay-Only-On-Success settlement.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="${escapeHtml(baseUrl)}/openapi.json">OpenAPI 3.1 Spec</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/llms.txt">llms.txt Guide</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/pricing">Pricing (${CATALOG.length} Endpoints)</a>
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <h2>Authentication &amp; x402 V2 Payment Flow</h2>
        <p>Every paid <code>/v1/*</code> route requires zero API keys. Send an unpaid <code>GET</code> request to receive HTTP <code>402 Payment Required</code> with a base64-encoded <code>PAYMENT-REQUIRED</code> header containing exact Base USDC terms, then retry with <code>PAYMENT-SIGNATURE</code> via <code>@x402/fetch</code>. Only HTTP <code>200</code> responses settle; <code>400</code>, <code>404</code>, <code>405</code>, <code>502</code>, and <code>503</code> never charge your wallet.</p>
      </div>
      <div class="card">
        <h2>MCP Server (Remote HTTP &amp; Stdio)</h2>
        <p>Connect x402-native MCP clients directly to <code>${escapeHtml(baseUrl)}/mcp</code> (Streamable HTTP, JSON-RPC 2.0, ${1 + getPackEndpoints(["markets"]).length} default tools; pack routes at <code>/mcp/&lt;pack&gt;</code> &amp; <code>/mcp/all</code>), or run the local stdio bridge <code>npx -y exactjson-mcp</code> with <code>BUYER_PRIVATE_KEY</code> and <code>MAX_PAYMENT_USD=$0.05</code>. Official MCP Registry ID: <code>io.github.exactjsondev/exactjson</code>.</p>
      </div>
    </section>

    <section style="margin-top: 2rem;">
      <h2 class="section-title">Endpoint Reference (${CATALOG.length} Paid Routes + Free Health)</h2>
      <p class="section-sub">Check <code>GET ${escapeHtml(baseUrl)}/health</code> for free before batch workflows to verify <code>paused: false</code>.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">USDC</th>
              <th scope="col">Summary &amp; Sample Request</th>
            </tr>
          </thead>
          <tbody>
            ${endpointRows}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid-2" style="margin-top: 2rem;">
      <div class="card">
        <h2>Error Model &amp; Retry Discipline</h2>
        <p>Errors return structured JSON with machine-readable <code>error</code> and human-readable <code>message</code> fields. Do not retry <code>400</code> (bad query parameter) or <code>404</code> (unknown token/market) without fixing inputs. Back off on <code>502</code> (fail-closed upstream outage) and <code>503</code> (operator pause).</p>
      </div>
      <div class="card" id="versioning">
        <h2>API Versioning &amp; Deprecation Policy</h2>
        <p>All paid endpoints are versioned in the URL path under <code>/v1/*</code>. Additive fields within <code>v1</code> are non-breaking. Any breaking contract change ships under a new path prefix (e.g. <code>/v2/*</code>) with at least 90 days of advance notice via standard HTTP <code>Deprecation</code> and <code>Sunset</code> headers before retirement.</p>
      </div>
    </section>`;

  return renderHtmlPageShell({
    baseUrl,
    title: "ExactJSON API Documentation — x402 V2 & MCP Guide",
    description:
      "Complete API and MCP documentation for ExactJSON: x402 V2 Base USDC payment flow, Remote Streamable HTTP /mcp, stdio CLI, endpoint schemas, error model, and v1 versioning policy.",
    canonicalPath: "/docs",
    badgesHtml: `<span class="badge live">Docs · x402 V2</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderPricingHtml(baseUrl: string, network: string): string {
  const networkLabel = formatNetworkLabel(network);
  const rows = CATALOG.map(
    (entry) => `<tr>
      <th scope="row" class="ep-cell"><code>${escapeHtml(entry.method)} ${escapeHtml(entry.path)}</code></th>
      <td class="price">${escapeHtml(entry.priceFormatted)} USD</td>
      <td>${escapeHtml(entry.summary)}<div class="desc">Asset: USDC on ${escapeHtml(networkLabel)} · Settles on HTTP 200 only</div></td>
    </tr>`
  ).join("\n");

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

  const mainHtml = `
    <section style="padding: 2rem 0 1.25rem;">
      <h1>ExactJSON Pricing — Pay-Per-Call Base USDC</h1>
      <p class="lead">
        Simple, transparent micropayments from <strong>$0.005 to $0.02 USDC</strong> per successful request on <strong>${escapeHtml(networkLabel)}</strong>. Zero subscriptions, zero monthly minimums, zero API keys, and free machine discovery endpoints.
      </p>
      <div class="pills">
        <span class="badge live">Pay-Only-On-Success (HTTP 200)</span>
        <span class="badge">Free /health &amp; Discovery</span>
        <span class="badge">Client Spend Caps (MAX_PAYMENT_USD)</span>
      </div>
    </section>

    <section>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Endpoint</th>
              <th scope="col">Price</th>
              <th scope="col">Description &amp; Settlement</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid-2" style="margin-top: 2rem;">
      <div class="card">
        <h2>Free Endpoints ($0.00)</h2>
        <p><code>GET /health</code>, <code>GET /</code>, <code>GET /docs</code>, <code>GET /pricing</code>, <code>GET /openapi.json</code>, <code>GET /llms.txt</code>, <code>/.well-known/*</code>, and MCP <code>initialize</code> / <code>tools/list</code> / <code>exactjson_health</code> are always free.</p>
      </div>
      <div class="card">
        <h2>Non-200 Never Settles</h2>
        <p>If you send invalid parameters (<code>400</code>), query an unlisted asset (<code>404</code>), or hit a fail-closed upstream outage (<code>502</code>) or pause (<code>503</code>), the x402 facilitator does not settle payment.</p>
      </div>
    </section>`;

  return renderHtmlPageShell({
    baseUrl,
    title: "ExactJSON Pricing — Pay-Per-Call Base USDC ($0.005–$0.02)",
    description:
      `Transparent pay-per-call x402 V2 pricing for all ${CATALOG.length} ExactJSON endpoints on Base Mainnet USDC ($0.005 to $0.02/call). Pay only on HTTP 200 success.`,
    canonicalPath: "/pricing",
    badgesHtml: `<span class="badge live">Base USDC · $0.005–$0.02</span>`,
    jsonLd: offerCatalogJsonLd,
    mainHtml,
  });
}

export function renderAboutHtml(baseUrl: string, network: string): string {
  const mainHtml = `
    <section style="padding: 2rem 0 1.25rem;">
      <h1>About ExactJSON</h1>
      <p class="lead">
        ExactJSON builds live, deterministic, token-optimized JSON APIs and Model Context Protocol (MCP) tools designed specifically for autonomous AI agents and quantitative trading pipelines.
      </p>
    </section>

    <section class="grid-2">
      <div class="card">
        <h2>Why ExactJSON Exists</h2>
        <p>Raw DeFi, derivatives, and market feeds routinely return 200 KB+ payloads across hundreds of contracts or orderbook levels. Feeding raw dumps into an LLM wastes $0.02–$0.15 in context tokens and triggers arithmetic hallucinations. ExactJSON computes safety checks, slippage ladders, implied volatility surfaces, and cross-venue spreads deterministically at the edge and returns compact ~2 KB JSON.</p>
      </div>
      <div class="card">
        <h2>Fail-Closed Engineering</h2>
        <p>ExactJSON runs on Cloudflare Workers and D1 with x402 V2 settlement on ${escapeHtml(formatNetworkLabel(network))}. Security endpoints combine dual engines (GoPlus + Honeypot.is on EVM; RugCheck on Solana) and fail closed with HTTP <code>502</code> if primary engines are unavailable, rather than falsely reporting a token as safe. Informational data only; not financial advice.</p>
      </div>
    </section>

    <section class="grid-2" style="margin-top: 1rem;">
      <div class="card">
        <h2>Data Sources &amp; Coverage</h2>
        <p>Coverage spans Markets (EVM via GoPlus/Honeypot.is/KyberSwap/DEX Screener, Solana via RugCheck, Hyperliquid/dYdX/Kraken perps, Polymarket/Kalshi predictions, Deribit options, US Treasury &amp; NY Fed macro, BIS 38-country + ECB + Bank of Canada policy rates), Security (deps.dev, OSV.dev, npm/PyPI/crates.io, CISA KEV, FIRST EPSS, MITRE CVE, Cloudflare 1.1.1.1/1.1.1.2 DoH, IANA RDAP, Statuspage, endoflife.date, Hugging Face Hub, OONI), World (NOAA AviationWeather, FAA NAS, NOAA SWPC, CelesTrak, UN/EU GDACS, USGS Seismic, NASA EONET, MET Norway, US Census/EPA TRI, GOV.UK FCDO, Nager.Date, NASA POWER), Commerce (Frankfurter ECB FX, World Bank, EU Commission VIES, GLEIF LEI, Wikidata, SEC EDGAR, USAspending, US CPSC, openFDA), and Research (Crossref Polite Pool, DataCite, Retraction Watch, NIH PubChem PUG-REST/GHS/NFPA, ClinicalTrials.gov v2, and NIH RxNav/RxNorm).</p>
      </div>
      <div class="card">
        <h2>Open Source &amp; Machine Discovery</h2>
        <p>Source code, tests, and the <code>exactjson-mcp</code> stdio package are published under the MIT license on <a href="https://github.com/exactjsondev/exactjson">GitHub</a> and <a href="https://www.npmjs.com/package/exactjson-mcp">npm</a> (Official MCP Registry ID: <code>io.github.exactjsondev/exactjson</code>), listed on <a href="${escapeHtml(X402SCAN_URL)}">x402scan</a> and <a href="https://glama.ai/mcp/servers/exactjsondev/exactjson">Glama</a>, with full discovery via OpenAPI 3.1, RFC 9727 API Catalog, A2A Agent Card, and MCP Server Card.</p>
      </div>
    </section>`;

  return renderHtmlPageShell({
    baseUrl,
    title: "About ExactJSON — Live x402 APIs for AI Agents",
    description:
      "Learn how ExactJSON delivers compact, deterministic, fail-closed JSON endpoints and MCP tools for AI agents on Cloudflare Workers and Base Mainnet USDC.",
    canonicalPath: "/about",
    badgesHtml: `<span class="badge">Open Source · MIT</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderContactHtml(baseUrl: string): string {
  const mainHtml = `
    <section style="padding: 2rem 0 1.25rem;">
      <h1>Contact ExactJSON</h1>
      <p class="lead">
        Questions about x402 V2 integration, MCP server setup, enterprise rate needs, or responsible vulnerability disclosure? Reach the ExactJSON engineering team directly.
      </p>
    </section>

    <section class="grid-2">
      <div class="card">
        <h2>Direct Support &amp; Inquiries</h2>
        <p>Email: <a href="mailto:hello@exactjson.com">hello@exactjson.com</a><br>Canonical website: <a href="${escapeHtml(baseUrl)}/">${escapeHtml(baseUrl)}</a><br>Live service status: <a href="${escapeHtml(baseUrl)}/health">GET /health</a></p>
      </div>
      <div class="card">
        <h2>Bug Reports &amp; Community</h2>
        <p>Open technical issues or pull requests on <a href="https://github.com/exactjsondev/exactjson/issues">GitHub Issues</a>, inspect the stdio package on <a href="https://www.npmjs.com/package/exactjson-mcp">npm (exactjson-mcp)</a> (Official MCP Registry: <code>io.github.exactjsondev/exactjson</code>), or view our <a href="https://glama.ai/mcp/servers/exactjsondev/exactjson">Glama MCP</a> and <a href="${escapeHtml(X402SCAN_URL)}">x402scan</a> listings.</p>
      </div>
    </section>

    <section class="card" style="margin-top: 1rem;">
      <h2>Wallet &amp; Key Security Reminder</h2>
      <p>Never send private keys, seed phrases, or signing secrets in support emails or GitHub issues. ExactJSON signs EIP-3009 authorizations strictly client-side in your own wallet or local <code>exactjson-mcp</code> process; we never custody user funds or ask for private keys.</p>
    </section>`;

  return renderHtmlPageShell({
    baseUrl,
    title: "Contact ExactJSON — Support & Technical Inquiries",
    description:
      "Contact the ExactJSON team at hello@exactjson.com or via GitHub Issues for x402 V2 API integration, MCP server support, and security inquiries.",
    canonicalPath: "/contact",
    badgesHtml: `<span class="badge">Support</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function renderPrivacyHtml(baseUrl: string): string {
  const mainHtml = `
    <section style="padding: 2rem 0 1.25rem;">
      <h1>Privacy Policy — ExactJSON</h1>
      <p class="lead">
        ExactJSON is built for permissionless machine-to-machine requests with minimal data collection: no user accounts, no login credentials, no tracking cookies, and no third-party ad or analytics scripts.
      </p>
    </section>

    <section class="grid-2">
      <div class="card">
        <h2>What We Do Not Collect</h2>
        <p>ExactJSON does not require API keys, emails, passwords, names, or billing profiles to call any endpoint. Our web pages set no advertising or analytics cookies and load no third-party tracking scripts under strict <code>Content-Security-Policy</code> headers.</p>
      </div>
      <div class="card">
        <h2>Operational API Telemetry</h2>
        <p>For paid <code>/v1/*</code> calls and bridged MCP tool executions, ExactJSON logs minimal operational telemetry in Cloudflare D1: requested endpoint path, sanitized query target, HTTP status, outcome classification, transport (<code>http</code> or <code>mcp</code>), latency, and—for settled x402 payments—the public on-chain payer wallet address and Base settlement transaction hash.</p>
      </div>
    </section>

    <section class="grid-2" style="margin-top: 1rem;">
      <div class="card">
        <h2>Retention &amp; Edge Processing</h2>
        <p>Unpaid <code>402</code> challenge logs are automatically pruned after 7 days and failed verification logs after 14 days via a daily scheduled job. Settled transaction records are retained for accounting and debugging against public Base blockchain receipts. Traffic is routed through Cloudflare Workers infrastructure.</p>
      </div>
      <div class="card">
        <h2>Privacy Questions</h2>
        <p>For privacy inquiries or data questions regarding ExactJSON operational logs, contact <a href="mailto:hello@exactjson.com">hello@exactjson.com</a> or review our open-source telemetry middleware on <a href="https://github.com/exactjsondev/exactjson">GitHub</a>.</p>
      </div>
    </section>`;

  return renderHtmlPageShell({
    baseUrl,
    title: "Privacy Policy — ExactJSON",
    description:
      "ExactJSON privacy policy: zero user accounts, zero tracking cookies, minimal operational telemetry in Cloudflare D1, and automatic pruning of unpaid challenge logs.",
    canonicalPath: "/privacy",
    badgesHtml: `<span class="badge">Privacy</span>`,
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
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
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
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
        No ${escapeHtml(SERVICE_NAME)} route matches <code>${escapeHtml(requestedPath)}</code>. Browse our documentation, pricing, or machine discovery specs below.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="${escapeHtml(baseUrl)}/docs">Go to ExactJSON Docs</a>
        <a class="btn" href="${escapeHtml(baseUrl)}/pricing">Pricing</a>
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