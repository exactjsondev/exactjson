import { CATALOG, DISCLAIMER, SERVICE_NAME, SERVICE_VERSION } from "../config/catalog";
import { CONTACT_EMAIL, escapeHtml, GLAMA_URL, NPM_URL, REPO_URL, X402SCAN_URL } from "./escape";
import { SWISS_CSS } from "./styles";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

export function renderBrandJsonLd(baseUrl: string, includeOffers = false): string {
  const organization = {
    "@type": "Organization",
    "@id": `${baseUrl}/#organization`,
    name: SERVICE_NAME,
    url: baseUrl,
    logo: `${baseUrl}/favicon.svg`,
    description:
      "ExactJSON builds live, deterministic, token-optimized x402 V2 pay-per-call JSON APIs and MCP servers for AI agents on Base Mainnet USDC.",
    email: CONTACT_EMAIL,
    sameAs: [REPO_URL, NPM_URL, GLAMA_URL, X402SCAN_URL],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "technical support",
      email: CONTACT_EMAIL,
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

export interface SwissShellOptions {
  baseUrl: string;
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterDescription?: string;
  canonicalPath?: string;
  activeNav?: "/" | "/docs" | "/pricing" | "/about" | "/contact" | "/privacy";
  headerMetaHtml?: string;
  jsonLd?: string;
  noindex?: boolean;
  footerDisclaimer?: string;
  mainHtml: string;
}

export function renderSwissShell(opts: SwissShellOptions): string {
  const safeBase = escapeHtml(opts.baseUrl);
  const canonicalUrl =
    opts.canonicalPath !== undefined ? `${opts.baseUrl}${opts.canonicalPath}` : null;
  const robotsMeta = opts.noindex ? '\n  <meta name="robots" content="noindex, nofollow">' : "";
  const canonicalLink = canonicalUrl
    ? `\n  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">`
    : "";
  const ogTitle = opts.ogTitle ?? opts.title;
  const ogDesc = opts.ogDescription ?? opts.description;
  const twDesc = opts.twitterDescription ?? ogDesc;
  const ogUrl = canonicalUrl ?? `${opts.baseUrl}/`;
  const jsonLdScript = opts.jsonLd
    ? `\n  <script type="application/ld+json">${opts.jsonLd}</script>`
    : "";

  const cur = (route: SwissShellOptions["activeNav"]) =>
    opts.activeNav === route ? ' aria-current="page"' : "";

  const endpointsHref = opts.activeNav === "/" ? "#endpoints" : `${safeBase}/#endpoints`;
  const disclaimerText = opts.footerDisclaimer ?? DISCLAIMER;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">${robotsMeta}
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}">${canonicalLink}
  <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDesc)}">
  <meta property="og:url" content="${escapeHtml(ogUrl)}">
  <meta property="og:image" content="${safeBase}/og-image.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(twDesc)}">
  <meta name="twitter:image" content="${safeBase}/og-image.jpg">${jsonLdScript}
  <style>${SWISS_CSS}</style>
</head>
<body>
  <a href="#main-content" class="skip-link visually-hidden">Skip to main content</a>

  <header class="header-band">
    <div class="header-inner">
      <div class="brand-cluster">
        <a class="brand-link" href="${safeBase}/">
          <span class="brand-mark" aria-hidden="true">{:}</span>
          <span>${escapeHtml(SERVICE_NAME)}</span>
        </a>
        <span class="meta-tag">v${escapeHtml(SERVICE_VERSION)}</span>
        ${opts.headerMetaHtml ?? ""}
      </div>
      <nav class="nav-cluster" aria-label="Primary">
        <a href="${endpointsHref}">Endpoints [${CATALOG.length}]</a>
        <a href="${safeBase}/docs"${cur("/docs")}>Docs</a>
        <a href="${safeBase}/pricing"${cur("/pricing")}>Pricing</a>
        <a href="${safeBase}/openapi.json">OpenAPI</a>
        <a href="${safeBase}/llms.txt">llms.txt</a>
        <a href="${REPO_URL}">GitHub</a>
        <label class="polarity-switch" for="polarity-toggle" title="Switch between Carbon Dark and Stark Paper polarity">
          <input type="checkbox" id="polarity-toggle" class="sr-control" aria-label="Stark Paper light theme">
          <span class="pol-carbon" aria-hidden="true">◐ Paper</span>
          <span class="pol-paper" aria-hidden="true">◑ Carbon</span>
        </label>
      </nav>
    </div>
  </header>

  <main id="main-content">
    ${opts.mainHtml}
  </main>

  <footer class="footer-band">
    <div class="footer-inner">
      <div>${escapeHtml(disclaimerText)}</div>
      <div class="footer-links">
        <a href="${safeBase}/docs"${cur("/docs")}>Docs</a>
        <a href="${safeBase}/pricing"${cur("/pricing")}>Pricing</a>
        <a href="${safeBase}/about"${cur("/about")}>About</a>
        <a href="${safeBase}/contact"${cur("/contact")}>Contact</a>
        <a href="${safeBase}/privacy"${cur("/privacy")}>Privacy</a>
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
        <a href="${REPO_URL}">GitHub</a>
        <a href="${NPM_URL}">npm</a>
        <a href="${GLAMA_URL}">Glama</a>
        <a href="${X402SCAN_URL}">x402scan</a>
      </div>
    </div>
  </footer>

  <script src="/ui.js" defer></script>
</body>
</html>`;
}
