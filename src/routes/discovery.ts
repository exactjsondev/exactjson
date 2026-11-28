import type { Context } from "hono";
import {
  CATALOG,
  DISCLAIMER,
  getActivePacks,
  getEndpointById,
  SERVICE_NAME,
  SERVICE_VERSION,
  toHttpInputSchema,
} from "../config/catalog";
import { negotiateContentType } from "../lib/contentNegotiation";
import { buildMcpTools } from "../lib/mcpTools";
import { applyHtmlSecurityHeaders, resolveBaseUrl } from "../lib/securityHeaders";
import { getServiceControlState } from "../middleware/serviceControl";
import type { AppBindings } from "../types";
import { buildSetupMarkdown } from "../ui/setupPage";
import {
  renderAboutHtml,
  renderContactHtml,
  renderDocsHtml,
  renderLandingHtml,
  renderPricingHtml,
  renderPrivacyHtml,
  renderSetupHtml,
} from "./landingHtml";

// IMPORTANT: Never import @x402/hono or @coinbase/x402 in this file to keep discovery cold starts < 10ms.

const REPO_URL = "https://github.com/exactjsondev/exactjson";
const X_URL = "https://x.com/exactjson";
const CONTACT_EMAIL = "hello@exactjson.com";
const SECURITY_EMAIL = "security@exactjson.com";
const SECURITY_TXT_EXPIRES = "2027-11-28T00:00:00Z";
const MCP_PACKAGE = "exactjson-mcp";
const MCP_REGISTRY_NAME = "io.github.exactjsondev/exactjson";
const GLAMA_URL = "https://glama.ai/mcp/servers/exactjsondev/exactjson";
const X402SCAN_URL = "https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc";
const BRAND_HEADLINE = "ExactJSON — Live, deterministic x402 APIs for AI agents";

export { resolveBaseUrl };

export async function indexHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  const format = negotiateContentType(c.req.header("accept"));

  c.header("Cache-Control", "public, max-age=300");
  c.header("Vary", "Accept");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Link",
    [
      `<${baseUrl}/.well-known/api-catalog>; rel="api-catalog"`,
      `<${baseUrl}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
      `<${baseUrl}/llms.txt>; rel="service-doc"; type="text/plain"`,
      `<${baseUrl}/.well-known/x402>; rel="describedby"; type="application/json"`,
      `<${baseUrl}/.well-known/x402.json>; rel="describedby"; type="application/json"`,
      `<${baseUrl}/.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"`,
    ].join(", "),
  );

  if (format === "html") {
    applyHtmlSecurityHeaders(c);
    return c.html(renderLandingHtml(baseUrl, network));
  }

  if (format === "markdown") {
    return c.text(buildLlmsTxt(baseUrl, network), 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  }

  return c.json({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    headline: BRAND_HEADLINE,
    description: `${BRAND_HEADLINE} (${CATALOG.length} live endpoints across markets, security, world, commerce & research packs): EVM & Solana token safety, multi-tier execution slippage checks, perpetuals (Hyperliquid/dYdX/Kraken), prediction-market scanner & cross-venue arbitrage (Polymarket/Kalshi), Deribit options surface, US macro liquidity (Treasury/NY Fed), 38-country BIS/ECB/BoC/NY Fed policy rates & FX carry, OSS package supply-chain audits, domain DNSSEC/DMARC/RDAP trust, CISA KEV+EPSS CVE triage, cloud status gates, runtime EOL checks, Hugging Face model audits, OONI censorship checks, global airport METAR/FAA delays, NOAA/CelesTrak space weather GNSS, physical hazard briefs, GOV.UK FCDO travel advisories, NASA POWER/MET Norway solar & wind site windows, cross-border T+0/T+1/T+2 banking settlement windows, EU VIES VAT + IBAN/BIC invoice-fraud checks, GLEIF/SEC corporate KYB, US CPSC + openFDA recall screening, Crossref + DataCite + Retraction Watch citation verification, NIH PubChem GHS chemical hazard profiles, and ClinicalTrials.gov + RxNorm catalyst briefs.`,
    disclaimer: DISCLAIMER,
    contact: CONTACT_EMAIL,
    security_contact: SECURITY_EMAIL,
    social: {
      x: X_URL,
      github: REPO_URL,
    },
    mcp: {
      package: MCP_PACKAGE,
      registry_name: MCP_REGISTRY_NAME,
      command: `npx -y ${MCP_PACKAGE}`,
      remote_url: `${baseUrl}/mcp`,
      transport: "streamable-http",
      server_card: `${baseUrl}/.well-known/mcp/server-card.json`,
      packs: {
        default: "markets",
        active: getActivePacks().map((p) => p.id),
        all_url: `${baseUrl}/mcp/all`,
        endpoints: Object.fromEntries(
          getActivePacks().map((p) => [p.id, `${baseUrl}${p.mcpPath}`]),
        ),
      },
    },
    discovery: {
      setup: `${baseUrl}/setup`,
      docs: `${baseUrl}/docs`,
      pricing: `${baseUrl}/pricing`,
      about: `${baseUrl}/about`,
      contact: `${baseUrl}/contact`,
      privacy: `${baseUrl}/privacy`,
      x402: `${baseUrl}/.well-known/x402`,
      x402_json: `${baseUrl}/.well-known/x402.json`,
      api_catalog: `${baseUrl}/.well-known/api-catalog`,
      mcp: `${baseUrl}/mcp`,
      mcp_server_card: `${baseUrl}/.well-known/mcp/server-card.json`,
      agent_card: `${baseUrl}/.well-known/agent-card.json`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
      sitemap: `${baseUrl}/sitemap.xml`,
      security_txt: `${baseUrl}/.well-known/security.txt`,
      health: `${baseUrl}/health`,
    },
    endpoints: CATALOG.map((entry) => ({
      method: entry.method,
      path: entry.path,
      price_usd: entry.priceAmount,
      summary: entry.summary,
    })),
  });
}

export async function healthHandler(c: Context<AppBindings>) {
  const control = await getServiceControlState(c.env.DB);
  c.header("Cache-Control", "no-store");
  return c.json({
    status: "ok",
    service: SERVICE_NAME,
    env: c.env.APP_ENV || "testnet",
    network: c.env.X402_NETWORK || "eip155:84532",
    version: SERVICE_VERSION,
    paused: control.paused,
  });
}

export function wellKnownX402Handler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    version: 1,
    resources: CATALOG.map((entry) => `${entry.method} ${baseUrl}${entry.path}`),
  });
}

export function openApiHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  c.header("Cache-Control", "public, max-age=300");

  const p = (id: Parameters<typeof getEndpointById>[0]) => getEndpointById(id).priceFormatted;

  const paths: Record<string, unknown> = {};
  for (const entry of CATALOG) {
    const cleanInputSchema = toHttpInputSchema(entry.inputSchema);
    const requiredSet = new Set(cleanInputSchema.required);
    const parameters = Object.entries(cleanInputSchema.properties).map(
      ([paramName, propSchema]) => ({
        name: paramName,
        in: "query",
        required: requiredSet.has(paramName),
        description:
          typeof propSchema.description === "string"
            ? propSchema.description
            : entry.queryParamDescription,
        schema: propSchema,
        ...(propSchema.example !== undefined ? { example: propSchema.example } : {}),
      }),
    );

    paths[entry.path] = {
      get: {
        operationId: entry.id,
        summary: entry.summary,
        description: entry.description,
        security: [],
        "x-payment-info": {
          protocols: [{ x402: {} }],
          price: {
            mode: "fixed",
            currency: "USD",
            amount: entry.priceAmount,
          },
        },
        parameters,
        responses: {
          "200": {
            description: "Successful paid response (payment settled).",
            headers: {
              "PAYMENT-RESPONSE": {
                description: "Base64-encoded x402 V2 settlement receipt.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: entry.outputSchema,
                example: entry.outputExample,
              },
            },
          },
          "400": {
            description: "Invalid query parameter (payment NOT settled).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "402": {
            description:
              "Payment Required - x402 V2 payment terms returned in PAYMENT-REQUIRED header.",
            headers: {
              "PAYMENT-REQUIRED": {
                description: "Base64-encoded x402 V2 PaymentRequired payload.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaymentRequiredResponse" },
              },
            },
          },
          "404": {
            description:
              "Requested resource (token, market, package, domain, CVE, airport, entity, DOI, chemical, or trial) not found (payment NOT settled).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "405": {
            description: "Method not allowed; use HTTP GET (payment NOT settled).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "502": {
            description: "Upstream data provider unavailable (payment NOT settled).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "503": {
            description: "Service temporarily paused by operator (payment NOT charged).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    };
  }

  return c.json({
    openapi: "3.1.0",
    info: {
      title: `${BRAND_HEADLINE}`,
      version: SERVICE_VERSION,
      description: `${BRAND_HEADLINE}. Pre-computed, compact JSON endpoints across markets (token safety, pre-trade slippage, perpetuals, prediction markets, options volatility, US macro liquidity, global central bank rates), security (OSS package audit, domain trust, CVE triage, cloud status, runtime EOL, AI model audit, censorship check), world (airport delays, space weather GNSS, physical hazard brief, travel destination brief, solar/wind site window), commerce (settlement window, EU VIES VAT/IBAN/BIC check, GLEIF/SEC corporate KYB, US CPSC + openFDA recall gate), and research (academic DOI/arXiv/Retraction Watch citation verify, NIH PubChem GHS hazard profile, ClinicalTrials.gov + RxNorm drug trial brief). ${DISCLAIMER}`,
      "x-guidance": `Pay per request via x402 V2 (exact EVM USDC in PAYMENT-SIGNATURE header), Remote Streamable HTTP MCP (${baseUrl}/mcp for markets, ${baseUrl}/mcp/security for security, ${baseUrl}/mcp/world for world, ${baseUrl}/mcp/commerce for commerce, ${baseUrl}/mcp/research for research, ${baseUrl}/mcp/all for all packs), or stdio MCP (\`npx -y ${MCP_PACKAGE}\` / \`--pack security\` / \`--pack world\` / \`--pack commerce\` / \`--pack research\`). Unpaid probes return HTTP 402 with PAYMENT-REQUIRED terms. Only HTTP 200 settles; 400/404/502/503 never settle. Recommended chains: call /v1/evm/safety (${p("evm_safety")}) + /v1/execution/quote-check?mode=evm (${p("execution_quote_check")}) before swapping unfamiliar EVM tokens; verify settlement rules when /v1/predictions/arb (${p("predictions_arb")}) returns resolution_risk_warning=true; call /v1/oss/package-audit (${p("oss_package_audit")}) + /v1/oss/runtime-eol (${p("oss_runtime_eol")}) before installing packages; call /v1/net/domain-trust (${p("net_domain_trust")}) + /v1/entity/company-verify (${p("entity_company_verify")}) + /v1/commerce/vat-verify (${p("commerce_vat_verify")}) + /v1/commerce/settlement-window (${p("commerce_settlement_window")}) before paying B2B supplier invoices; call /v1/consumer/safety-recall (${p("consumer_safety_recall")}) before approving product listings; call /v1/science/citation-verify (${p("science_citation_verify")}) before citing academic DOIs or arXiv preprints; call /v1/bio/drug-trial-brief (${p("bio_drug_trial_brief")}) + /v1/chem/hazard-profile (${p("chem_hazard_profile")}) for clinical catalysts & chemical GHS safety; call /v1/ops/cloud-status (${p("ops_cloud_status")}) before deploying; call /v1/space/weather-gnss (${p("space_weather_gnss")}) + /v1/solar/site-window (${p("solar_site_window")}) before drone/ag dispatch; call /v1/travel/destination-brief (${p("travel_destination_brief")}) + /v1/aviation/airport-delays (${p("aviation_airport_delays")}) + /v1/geo/hazard-brief (${p("geo_hazard_brief")}) before travel routing. Scanners & Arb: /v1/perps/screener (${p("perps_screener")}), /v1/perps/funding-arb (${p("perps_funding_arb")}, HL/dYdX/Kraken), /v1/predictions/scanner (${p("predictions_scanner")}, Polymarket+Kalshi), /v1/predictions/arb (${p("predictions_arb")}, Polymarket vs Kalshi net arb), /v1/solana/trending (${p("solana_trending")}, RugCheck-scored). Deep Dives, Macro, Safety, World, Commerce & Research: /v1/evm/safety?address=<0x>&chain=base (${p("evm_safety")}, GoPlus+Honeypot.is), /v1/execution/quote-check?mode=perps&coin=BTC (${p("execution_quote_check")}, multi-tier EVM/Perps slippage), /v1/options/surface?currency=BTC (${p("options_surface")}, Deribit IV/skew/max-pain), /v1/macro/liquidity (${p("macro_liquidity")}, US Treasury & NY Fed), /v1/macro/global-rates (${p("macro_global_rates")}, BIS 38-country + ECB/BoC/NY Fed), /v1/perps/snapshot?coin=BTC (${p("perps_snapshot")}), /v1/solana/safety?mint=<MINT> (${p("solana_safety")}), /v1/sec/cve-triage?cve=CVE-2024-3094 (${p("sec_cve_triage")}), /v1/ai/model-audit?model=Qwen/Qwen2.5-7B-Instruct (${p("ai_model_audit")}), /v1/net/censorship-check?domain=telegram.org&country=IR (${p("net_censorship_check")}). ${DISCLAIMER}`,
      contact: {
        name: `${SERVICE_NAME} Support`,
        url: `${baseUrl}/contact`,
        email: CONTACT_EMAIL,
      },
      license: {
        name: "MIT",
        identifier: "MIT",
        url: `${REPO_URL}/blob/main/LICENSE`,
      },
    },
    externalDocs: {
      description: "ExactJSON API Documentation & Versioning Policy",
      url: `${baseUrl}/docs`,
    },
    servers: [{ url: baseUrl }],
    security: [],
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: {
              type: "string",
              description: "Machine-readable error code",
            },
            message: {
              type: "string",
              description: "Human-readable error explanation",
            },
          },
        },
        PaymentRequiredResponse: {
          type: "object",
          required: ["error", "protocol", "endpoint", "price_usd", "network", "asset"],
          properties: {
            error: { type: "string" },
            protocol: { type: "string" },
            endpoint: { type: "string" },
            price_usd: { type: "string" },
            network: { type: "string" },
            asset: { type: "string" },
            pay_only_on_success: { type: "boolean" },
            how_to_pay: { type: "string" },
            docs: { type: "string" },
            openapi: { type: "string" },
          },
        },
      },
    },
  });
}

export function buildLlmsTxt(baseUrl: string, network: string): string {
  const p = (id: Parameters<typeof getEndpointById>[0]) => getEndpointById(id).priceFormatted;

  const lines = [
    `# ${BRAND_HEADLINE} (v${SERVICE_VERSION})`,
    "",
    `> ${BRAND_HEADLINE}. ${CATALOG.length} pay-per-call x402 V2 endpoints across 5 vertical MCP packs (\`markets\`, \`security\`, \`world\`, \`commerce\` & \`research\`): Hyperliquid screener & L2 slippage, 3-venue funding arb (Hyperliquid/dYdX v4/Kraken), Polymarket + Kalshi prediction-market scanner & cross-venue arbitrage detector, Deribit BTC/ETH options volatility surface & max pain, official US Treasury & NY Fed macro liquidity pulse, 38-country BIS + ECB/BoC/NY Fed policy rates & FX carry matrix, multi-chain EVM & Solana token safety, multi-tier EVM/Perps execution quote checks, OSS package supply-chain audits (npm/PyPI/Cargo), domain malware/DNSSEC/DMARC/RDAP trust, CISA KEV + FIRST EPSS CVE triage, 6-cloud status gates, runtime EOL checks, Hugging Face model license/safetensors audits, OONI censorship checks, global airport METAR/FAA delays, NOAA/CelesTrak space weather GNSS, multi-agency physical hazard briefs, GOV.UK FCDO travel advisories, NASA POWER/MET Norway solar & wind site windows, cross-border banking settlement windows, EU VIES VAT + IBAN/BIC invoice-fraud checks, GLEIF/SEC corporate KYB, US CPSC + openFDA recall gates, Crossref + DataCite + Retraction Watch citation verification, NIH PubChem GHS chemical hazard profiles, and ClinicalTrials.gov + RxNorm clinical catalyst briefs. ${DISCLAIMER}`,
    "",
    "## When to Use ExactJSON",
    "- **Use ExactJSON when** an AI agent needs pre-computed, deterministic, ~2 KB JSON answers for token safety, multi-tier DEX/perps execution slippage, cross-venue arbitrage, options volatility/max pain, US & global central bank macro rates, pre-install OSS package audits, domain phishing/RDAP checks, CVE exploitation urgency, cloud outage gates, runtime EOL lifecycles, Hugging Face model weight/license safety, country-level censorship checks, airport flight delays, drone GNSS/compass storms, physical site hazards, destination travel safety, PV solar/wind operating windows, cross-border banking settlement dates, EU VAT/IBAN/BIC verification, GLEIF/SEC corporate KYB, US CPSC/openFDA product recalls, academic DOI/arXiv/Retraction Watch citation checks, PubChem GHS chemical toxicity, or Phase 2/3 clinical trial catalysts — without managing API keys or burning context tokens on raw 200 KB dumps.",
    "- **Do NOT use ExactJSON for** executing trades directly (ExactJSON is read-only intelligence), private wallet portfolio balances, historical multi-year OHLCV backtests, or custodial order routing.",
    "",
    "## Quickstart for AI Agents",
    `- Remote Streamable HTTP MCP (x402 V2 native clients): \`${baseUrl}/mcp\` (\`markets\` pack, <=15 tools), \`${baseUrl}/mcp/security\` (\`security\` pack, <=15 tools), \`${baseUrl}/mcp/world\` (\`world\` pack, <=15 tools), \`${baseUrl}/mcp/commerce\` (\`commerce\` pack, <=15 tools), \`${baseUrl}/mcp/research\` (\`research\` pack, <=15 tools), or \`${baseUrl}/mcp/all\``,
    `- Local Stdio MCP (Claude Desktop / Cursor / OpenClaw): \`npx -y ${MCP_PACKAGE}\` (default \`markets\`; pass \`--pack security\`, \`--pack world\`, \`--pack commerce\`, \`--pack research\`, or \`--pack all\`; set \`BUYER_PRIVATE_KEY\` and \`MAX_PAYMENT_USD=$0.05\`)`,
    `- Free Health Check: \`GET ${baseUrl}/health\``,
    `- Paid HTTP Protocol: x402 V2 (\`exact\` EVM scheme, USDC on \`${network}\`). Send payment via \`PAYMENT-SIGNATURE\`; inspect \`PAYMENT-REQUIRED\` on \`402\` and \`PAYMENT-RESPONSE\` on \`200\`.`,
    "- Pay-Only-On-Success: `400`, `404`, `502`, and `503` responses are never settled.",
    "",
    "## Recommended Agent Workflows (Cost-Optimized)",
    `- **Pre-Swap EVM/Base Guard ($0.02):** Call \`/v1/evm/safety?address=<0x>&chain=base\` (${p("evm_safety")}) + \`/v1/execution/quote-check?mode=evm&chain=base&token_out=<0x>\` (${p("execution_quote_check")}) before swapping an unfamiliar ERC-20.`,
    `- **Pre-Swap Solana Guard (${p("solana_safety")}):** Call \`/v1/solana/safety?mint=<MINT>\` (${p("solana_safety")}), or scan pre-screened trending pools via \`/v1/solana/trending\` (${p("solana_trending")}).`,
    `- **Pre-Trade Perps Check (${p("perps_snapshot")}-${p("execution_quote_check")}):** Use \`/v1/perps/snapshot?coin=BTC\` (${p("perps_snapshot")}) for a fast check or \`/v1/execution/quote-check?mode=perps&coin=BTC\` (${p("execution_quote_check")}) for multi-tier L2 slippage.`,
    `- **Cross-Venue Arbitrage (${p("perps_funding_arb")}-${p("predictions_arb")}):** Use \`/v1/perps/funding-arb\` (${p("perps_funding_arb")}) for HL/dYdX/Kraken spreads or \`/v1/predictions/arb\` (${p("predictions_arb")}) for Polymarket vs Kalshi (always verify settlement rules when \`resolution_risk_warning: true\`).`,
    `- **Prediction Markets Scan (${p("predictions_scanner")}):** Call \`/v1/predictions/scanner?venue=all&query=fed\` (${p("predictions_scanner")}) for implied probabilities, spreads, and carry.`,
    `- **Global Macro + Volatility Brief ($0.02-$0.035):** Pair \`/v1/macro/liquidity\` (${p("macro_liquidity")}) + \`/v1/macro/global-rates\` (${p("macro_global_rates")}) with \`/v1/options/surface?currency=BTC\` (${p("options_surface")}).`,
    `- **Pre-Install Supply-Chain & EOL Gate ($0.015):** Call \`/v1/oss/package-audit?package=lodash&ecosystem=npm\` (${p("oss_package_audit")}) + \`/v1/oss/runtime-eol?product=nodejs&cycle=20\` (${p("oss_runtime_eol")}) before adding dependencies or upgrading stacks.`,
    `- **CVE, Domain, Cloud & Model Gate ($0.005-$0.01):** Use \`/v1/sec/cve-triage?cve=CVE-2024-3094\` (${p("sec_cve_triage")}) for KEV+EPSS urgency, \`/v1/net/domain-trust?domain=stripe.com\` (${p("net_domain_trust")}) + \`/v1/net/censorship-check?domain=telegram.org&country=IR\` (${p("net_censorship_check")}) for domain posture/blocking, \`/v1/ops/cloud-status\` (${p("ops_cloud_status")}) before deploys, and \`/v1/ai/model-audit?model=Qwen/Qwen2.5-7B-Instruct\` (${p("ai_model_audit")}) before loading Hugging Face weights.`,
    `- **Travel, Aviation, Drone GNSS & Site Hazard Gate ($0.01-$0.015):** Pair \`/v1/travel/destination-brief?country=JP\` (${p("travel_destination_brief")}) + \`/v1/aviation/airport-delays?airport=JFK\` (${p("aviation_airport_delays")}) for travel routing, \`/v1/space/weather-gnss?lat=37.77\` (${p("space_weather_gnss")}) + \`/v1/solar/site-window?lat=52.3676&lon=4.9041\` (${p("solar_site_window")}) before drone/ag dispatch, and \`/v1/geo/hazard-brief?lat=37.7749&lon=-122.4194\` (${p("geo_hazard_brief")}) for site underwriting.`,
    `- **B2B Vendor, Invoice Fraud & Product Recall Gate ($0.01-$0.03):** Pair \`/v1/entity/company-verify?query=Apple%20Inc.\` (${p("entity_company_verify")}) + \`/v1/commerce/vat-verify?vat=IE6388047V\` (${p("commerce_vat_verify")}) + \`/v1/commerce/settlement-window?from=US&to=JP\` (${p("commerce_settlement_window")}) before supplier onboarding or cross-border wires, and \`/v1/consumer/safety-recall?query=stroller\` (${p("consumer_safety_recall")}) before marketplace listing approval.`,
    `- **Scientific Fact-Check, Biotech Catalyst & Chemical Safety Gate ($0.005-$0.02):** Call \`/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2\` (${p("science_citation_verify")}) to verify DOIs/arXiv preprints & Retraction Watch status, \`/v1/bio/drug-trial-brief?drug=semaglutide\` (${p("bio_drug_trial_brief")}) for Phase 2/3 primary completion catalysts, and \`/v1/chem/hazard-profile?query=71-43-2\` (${p("chem_hazard_profile")}) for PubChem GHS toxicity & NFPA ratings.`,
    "",
    "## Retry & Spend Discipline",
    '- Set a client spend cap (e.g. `maxAmountPerPayment: "$0.05"`).',
    "- Do not retry `400` or `404` without fixing query parameters; back off on `502`/`503`. None of `400`/`404`/`502`/`503` settle payment.",
    "",
    "## Versioning & Deprecation Policy",
    "- Paid endpoints are path-versioned (`/v1/*`). Additive fields within `v1` are non-breaking; breaking changes ship under `/v2/*` with at least 90 days notice via HTTP `Deprecation` and `Sunset` headers.",
    "",
    "## Paid Endpoints",
    ...CATALOG.map(
      (entry) =>
        `- \`${entry.method} ${baseUrl}${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}\` (${entry.priceFormatted} USD): ${entry.description}`,
    ),
    "",
    "## Discovery & Metadata",
    `- Setup Guide (Wallet, Vibe Coding & MCP): ${baseUrl}/setup`,
    `- API Documentation: ${baseUrl}/docs`,
    `- Pricing Table: ${baseUrl}/pricing`,
    `- About ExactJSON: ${baseUrl}/about`,
    `- Contact & Support: ${baseUrl}/contact`,
    `- Privacy Policy: ${baseUrl}/privacy`,
    `- Remote Streamable HTTP MCP: ${baseUrl}/mcp`,
    `- x402 Manifest: ${baseUrl}/.well-known/x402`,
    `- x402 Manifest (JSON alias): ${baseUrl}/.well-known/x402.json`,
    `- RFC 9727 API Catalog: ${baseUrl}/.well-known/api-catalog`,
    `- MCP Server Card: ${baseUrl}/.well-known/mcp/server-card.json`,
    `- A2A Agent Card: ${baseUrl}/.well-known/agent-card.json`,
    `- OpenAPI 3.1 Spec: ${baseUrl}/openapi.json`,
    `- Sitemap: ${baseUrl}/sitemap.xml`,
    `- Security Policy (RFC 9116): ${baseUrl}/.well-known/security.txt`,
    `- Health Check: ${baseUrl}/health`,
    `- GitHub & Docs: ${REPO_URL}`,
    `- X (Twitter): ${X_URL}`,
    `- npm MCP Package: https://www.npmjs.com/package/${MCP_PACKAGE}`,
    `- Official MCP Registry: ${MCP_REGISTRY_NAME}`,
    `- Glama MCP Listing: ${GLAMA_URL}`,
    `- x402scan Listing: ${X402SCAN_URL}`,
    `- Contact: ${CONTACT_EMAIL}`,
    `- Security Disclosures: ${SECURITY_EMAIL}`,
    "",
    "## Disclaimer",
    DISCLAIMER,
    "",
  ];

  return lines.join("\n");
}

export function llmsTxtHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";

  return c.text(buildLlmsTxt(baseUrl, network), 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
}

export function agentCardHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  const p = (id: Parameters<typeof getEndpointById>[0]) => getEndpointById(id).priceFormatted;
  c.header("Cache-Control", "public, max-age=300");

  return c.json({
    name: SERVICE_NAME,
    description: `${BRAND_HEADLINE}. ${CATALOG.length} pay-per-request x402 V2 endpoints across markets, security, world, commerce & research: perps screener (${p("perps_screener")}), 3-venue funding arb (${p("perps_funding_arb")}), Hyperliquid L2 slippage snapshot (${p("perps_snapshot")}), Polymarket+Kalshi prediction scanner (${p("predictions_scanner")}) & cross-venue arb (${p("predictions_arb")}), multi-chain EVM token safety (${p("evm_safety")}), multi-tier EVM/Perps execution quote-check (${p("execution_quote_check")}), Deribit BTC/ETH options vol surface & max pain (${p("options_surface")}), US Treasury & NY Fed macro liquidity pulse (${p("macro_liquidity")}), 38-country BIS + ECB/BoC/NY Fed global policy rates (${p("macro_global_rates")}), RugCheck trending Solana pools (${p("solana_trending")}), Solana SPL safety audit (${p("solana_safety")}), OSS package supply-chain audit (${p("oss_package_audit")}), domain trust (${p("net_domain_trust")}), CVE KEV+EPSS triage (${p("sec_cve_triage")}), cloud status (${p("ops_cloud_status")}), runtime EOL (${p("oss_runtime_eol")}), AI model audit (${p("ai_model_audit")}), OONI censorship check (${p("net_censorship_check")}), airport METAR/FAA delays (${p("aviation_airport_delays")}), space weather GNSS (${p("space_weather_gnss")}), physical hazard brief (${p("geo_hazard_brief")}), travel destination brief (${p("travel_destination_brief")}), solar/wind site window (${p("solar_site_window")}), cross-border settlement window (${p("commerce_settlement_window")}), EU VIES VAT + IBAN/BIC verify (${p("commerce_vat_verify")}), GLEIF/SEC corporate KYB (${p("entity_company_verify")}), US CPSC + openFDA safety recall (${p("consumer_safety_recall")}), Crossref + DataCite citation verify (${p("science_citation_verify")}), PubChem GHS chemical hazard profile (${p("chem_hazard_profile")}), and ClinicalTrials.gov + RxNorm drug trial brief (${p("bio_drug_trial_brief")}). ${DISCLAIMER}`,
    url: baseUrl,
    version: SERVICE_VERSION,
    documentationUrl: `${baseUrl}/llms.txt`,
    provider: {
      organization: SERVICE_NAME,
      url: baseUrl,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    authentication: {
      schemes: ["x402"],
      network,
    },
    skills: CATALOG.map((entry) => ({
      id: entry.id,
      name: entry.summary,
      description: `${entry.description} (${entry.method} ${baseUrl}${entry.path}, ${entry.priceFormatted} USD via x402 V2)`,
      tags: [...entry.tags, "x402"],
      examples: [
        `${entry.method} ${baseUrl}${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}`,
      ],
    })),
    links: {
      x402: `${baseUrl}/.well-known/x402`,
      x402_json: `${baseUrl}/.well-known/x402.json`,
      api_catalog: `${baseUrl}/.well-known/api-catalog`,
      mcp: `${baseUrl}/mcp`,
      mcp_server_card: `${baseUrl}/.well-known/mcp/server-card.json`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
      health: `${baseUrl}/health`,
    },
  });
}

export function apiCatalogHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const body = JSON.stringify({
    linkset: [
      {
        anchor: baseUrl,
        "service-desc": [
          {
            href: `${baseUrl}/openapi.json`,
            type: "application/openapi+json",
          },
        ],
        "service-doc": [
          {
            href: `${baseUrl}/llms.txt`,
            type: "text/plain",
          },
          {
            href: REPO_URL,
            type: "text/html",
          },
        ],
        status: [
          {
            href: `${baseUrl}/health`,
            type: "application/json",
          },
        ],
        describedby: [
          {
            href: `${baseUrl}/.well-known/x402`,
            type: "application/json",
          },
          {
            href: `${baseUrl}/.well-known/x402.json`,
            type: "application/json",
          },
          {
            href: `${baseUrl}/.well-known/agent-card.json`,
            type: "application/json",
          },
          {
            href: `${baseUrl}/.well-known/mcp/server-card.json`,
            type: "application/json",
          },
        ],
      },
    ],
  });

  return c.body(body, 200, {
    "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    "Cache-Control": "public, max-age=300",
  });
}

export function mcpServerCardHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  c.header("Cache-Control", "public, max-age=300");

  return c.json({
    serverInfo: {
      name: MCP_REGISTRY_NAME,
      title: BRAND_HEADLINE,
      version: SERVICE_VERSION,
    },
    description: `${BRAND_HEADLINE}: ${CATALOG.length} pay-per-call market, token-safety, supply-chain security, aviation, hazard, settlement, VAT/IBAN, corporate KYB, citation & clinical trial tools on Base USDC via x402 V2. ${DISCLAIMER}`,
    websiteUrl: baseUrl,
    documentationUrl: `${baseUrl}/llms.txt`,
    repository: {
      url: REPO_URL,
      source: "github",
      subfolder: "mcp",
    },
    transport: {
      type: "streamable-http",
      endpoint: `${baseUrl}/mcp`,
    },
    remotes: [
      {
        type: "streamable-http",
        url: `${baseUrl}/mcp`,
      },
      ...getActivePacks().map((pack) => ({
        type: "streamable-http",
        url: `${baseUrl}${pack.mcpPath}`,
      })),
      {
        type: "streamable-http",
        url: `${baseUrl}/mcp/all`,
      },
    ],
    packages: [
      {
        registryType: "npm",
        identifier: MCP_PACKAGE,
        version: SERVICE_VERSION,
        transport: { type: "stdio" },
      },
    ],
    authentication: {
      schemes: ["x402"],
      network,
      asset: "USDC",
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    tools: buildMcpTools(),
    links: {
      docs: `${baseUrl}/docs`,
      pricing: `${baseUrl}/pricing`,
      mcp: `${baseUrl}/mcp`,
      x402: `${baseUrl}/.well-known/x402`,
      x402_json: `${baseUrl}/.well-known/x402.json`,
      api_catalog: `${baseUrl}/.well-known/api-catalog`,
      agent_card: `${baseUrl}/.well-known/agent-card.json`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function respondHtmlOrMarkdown(c: Context<AppBindings>, htmlBody: string, markdownBody: string) {
  c.header("Cache-Control", "public, max-age=300");
  c.header("Vary", "Accept");
  c.header("X-Content-Type-Options", "nosniff");

  if (negotiateContentType(c.req.header("accept")) === "markdown") {
    return c.text(markdownBody, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  }

  applyHtmlSecurityHeaders(c);
  return c.html(htmlBody);
}

export function setupPageHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  return respondHtmlOrMarkdown(
    c,
    renderSetupHtml(baseUrl, network),
    buildSetupMarkdown(baseUrl, network),
  );
}

export function docsPageHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  return respondHtmlOrMarkdown(c, renderDocsHtml(baseUrl, network), buildLlmsTxt(baseUrl, network));
}

export function pricingPageHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  const markdown = [
    `# ExactJSON Pricing — Pay-Per-Call Base USDC (${network})`,
    "",
    "Zero subscriptions, zero API keys. Only HTTP 200 responses settle payment.",
    "",
    "| Endpoint | Price (USDC) | Summary |",
    "| --- | --- | --- |",
    ...CATALOG.map((e) => `| \`${e.method} ${e.path}\` | ${e.priceFormatted} | ${e.summary} |`),
    "",
    `Full documentation: ${baseUrl}/docs · OpenAPI: ${baseUrl}/openapi.json`,
    "",
  ].join("\n");
  return respondHtmlOrMarkdown(c, renderPricingHtml(baseUrl, network), markdown);
}

export function aboutPageHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";
  const markdown = [
    `# About ExactJSON (v${SERVICE_VERSION})`,
    "",
    `ExactJSON provides ${CATALOG.length} live, deterministic, compact JSON APIs and MCP tools for AI agents on Base USDC (${network}) via Cloudflare Workers + D1.`,
    "",
    `- Fail-closed token safety: GoPlus + Honeypot.is (EVM) and RugCheck (Solana) return HTTP 502 if primary engines fail.`,
    `- Open source (MIT): ${REPO_URL}`,
    `- X: ${X_URL}`,
    `- npm MCP Package: https://www.npmjs.com/package/${MCP_PACKAGE} (${MCP_REGISTRY_NAME})`,
    `- Glama MCP Listing: ${GLAMA_URL}`,
    `- x402scan Listing: ${X402SCAN_URL}`,
    `- Contact: ${CONTACT_EMAIL}`,
    `- Security Disclosures: ${SECURITY_EMAIL} (${baseUrl}/.well-known/security.txt)`,
    "",
    DISCLAIMER,
    "",
  ].join("\n");
  return respondHtmlOrMarkdown(c, renderAboutHtml(baseUrl, network), markdown);
}

export function contactPageHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const markdown = [
    "# Contact ExactJSON",
    "",
    `- Support Email: ${CONTACT_EMAIL}`,
    `- Security Disclosures: ${SECURITY_EMAIL} (${baseUrl}/.well-known/security.txt)`,
    `- X: ${X_URL}`,
    `- GitHub Issues: ${REPO_URL}/issues`,
    `- npm MCP Package: https://www.npmjs.com/package/${MCP_PACKAGE} (${MCP_REGISTRY_NAME})`,
    `- Glama MCP Listing: ${GLAMA_URL}`,
    `- x402scan Listing: ${X402SCAN_URL}`,
    `- Live Status: ${baseUrl}/health`,
    "",
    "Never send private keys or seed phrases; EIP-3009 signing happens strictly client-side.",
    "",
  ].join("\n");
  return respondHtmlOrMarkdown(c, renderContactHtml(baseUrl), markdown);
}

export function privacyPageHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const markdown = [
    "# Privacy Policy — ExactJSON",
    "",
    "- **No accounts, no cookies, no tracking scripts:** ExactJSON requires zero signups or API keys.",
    "- **Operational telemetry:** Paid `/v1/*` and bridged MCP calls log endpoint path, status, outcome, transport (`http`/`mcp`), latency, and public on-chain payer wallet + settlement tx hash for settled calls in Cloudflare D1.",
    "- **Retention:** Unpaid `402` challenges are pruned after 7 days and verification failures after 14 days.",
    `- **Questions:** ${CONTACT_EMAIL} · Docs: ${baseUrl}/docs`,
    "",
  ].join("\n");
  return respondHtmlOrMarkdown(c, renderPrivacyHtml(baseUrl), markdown);
}

export function sitemapXmlHandler(c: Context<AppBindings>) {
  const safeBaseUrl = escapeXml(resolveBaseUrl(c));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${safeBaseUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${safeBaseUrl}/setup</loc><changefreq>weekly</changefreq><priority>0.95</priority></url>`,
    `  <url><loc>${safeBaseUrl}/docs</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${safeBaseUrl}/pricing</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${safeBaseUrl}/about</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
    `  <url><loc>${safeBaseUrl}/contact</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
    `  <url><loc>${safeBaseUrl}/privacy</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
    `  <url><loc>${safeBaseUrl}/llms.txt</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    `  <url><loc>${safeBaseUrl}/openapi.json</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    "</urlset>",
    "",
  ].join("\n");

  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
}

export function robotsTxtHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const body = [
    "# ExactJSON AI agent & search discovery policy",
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes",
    "Allow: /",
    "Allow: /.well-known/",
    "Allow: /openapi.json",
    "Allow: /llms.txt",
    "Allow: /sitemap.xml",
    "Disallow: /dashboard",
    "Disallow: /dashboard/",
    "",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    `# Agent discovery: ${baseUrl}/.well-known/x402 | ${baseUrl}/.well-known/x402.json | ${baseUrl}/.well-known/api-catalog | ${baseUrl}/.well-known/mcp/server-card.json | ${baseUrl}/.well-known/agent-card.json | ${baseUrl}/openapi.json`,
    "",
  ].join("\n");

  return c.text(body, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
}

export function securityTxtHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const body = [
    `Contact: mailto:${SECURITY_EMAIL}`,
    `Contact: ${baseUrl}/contact`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    `Canonical: ${baseUrl}/.well-known/security.txt`,
    `Policy: ${REPO_URL}/blob/main/SECURITY.md`,
    "",
  ].join("\n");

  return c.text(body, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
}
