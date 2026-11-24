import type { Context } from "hono";
import {
  CATALOG,
  DISCLAIMER,
  SERVICE_NAME,
  SERVICE_VERSION,
  getEndpointById,
} from "../config/catalog";
import { prefersHtml } from "../lib/contentNegotiation";
import { getServiceControlState } from "../middleware/serviceControl";
import type { AppBindings } from "../types";
import { renderLandingHtml } from "./landingHtml";

// IMPORTANT: Never import @x402/hono or @coinbase/x402 in this file to keep discovery cold starts < 10ms.

const REPO_URL = "https://github.com/exactjsondev/exactjson";
const CONTACT_EMAIL = "hello@exactjson.com";
const MCP_PACKAGE = "exactjson-mcp";
const MCP_REGISTRY_NAME = "io.github.exactjsondev/exactjson";
const BRAND_HEADLINE = "ExactJSON — Live, deterministic x402 APIs for AI agents";

export function resolveBaseUrl(c: Context<AppBindings>): string {
  const configured = c.env.PUBLIC_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return new URL(c.req.url).origin;
}

export async function indexHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:8453";

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
    ].join(", ")
  );

  if (prefersHtml(c.req.header("accept"))) {
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
    );
    return c.html(renderLandingHtml(baseUrl, network));
  }

  return c.json({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    headline: BRAND_HEADLINE,
    description: `${BRAND_HEADLINE} (${CATALOG.length} live endpoints): EVM & Solana token safety, multi-tier execution slippage checks, perpetuals (Hyperliquid/dYdX/Kraken), prediction-market scanner & cross-venue arbitrage (Polymarket/Kalshi), Deribit options surface, and US macro liquidity (Treasury/NY Fed).`,
    disclaimer: DISCLAIMER,
    contact: CONTACT_EMAIL,
    mcp: {
      package: MCP_PACKAGE,
      registry_name: MCP_REGISTRY_NAME,
      command: `npx -y ${MCP_PACKAGE}`,
      server_card: `${baseUrl}/.well-known/mcp/server-card.json`,
    },
    discovery: {
      x402: `${baseUrl}/.well-known/x402`,
      x402_json: `${baseUrl}/.well-known/x402.json`,
      api_catalog: `${baseUrl}/.well-known/api-catalog`,
      mcp_server_card: `${baseUrl}/.well-known/mcp/server-card.json`,
      agent_card: `${baseUrl}/.well-known/agent-card.json`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
      sitemap: `${baseUrl}/sitemap.xml`,
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
    const requiredSet = new Set(entry.inputSchema.required ?? []);
    const parameters = Object.entries(entry.inputSchema.properties).map(
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
      })
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
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          "402": {
            description: "Payment Required - x402 V2 payment terms returned in PAYMENT-REQUIRED header.",
            headers: {
              "PAYMENT-REQUIRED": {
                description: "Base64-encoded x402 V2 PaymentRequired payload.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
          "404": {
            description: "Requested token or perpetual market not found (payment NOT settled).",
          },
          "502": {
            description: "Upstream data provider unavailable (payment NOT settled).",
          },
          "503": {
            description: "Service temporarily paused by operator (payment NOT charged).",
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
      description: `${BRAND_HEADLINE}. Pre-computed, compact JSON endpoints for token safety, pre-trade slippage, perpetuals, prediction markets, options volatility, and US macro liquidity. ${DISCLAIMER}`,
      "x-guidance":
        `Pay per request via x402 V2 (exact EVM USDC in PAYMENT-SIGNATURE header) or via MCP (\`npx -y ${MCP_PACKAGE}\`). Unpaid probes return HTTP 402 with PAYMENT-REQUIRED terms. Only HTTP 200 settles; 400/404/502/503 never settle. Recommended chains: call /v1/evm/safety (${p("evm_safety")}) + /v1/execution/quote-check?mode=evm (${p("execution_quote_check")}) before swapping unfamiliar EVM tokens; verify settlement rules when /v1/predictions/arb (${p("predictions_arb")}) returns resolution_risk_warning=true. Scanners & Arb: /v1/perps/screener (${p("perps_screener")}), /v1/perps/funding-arb (${p("perps_funding_arb")}, HL/dYdX/Kraken), /v1/predictions/scanner (${p("predictions_scanner")}, Polymarket+Kalshi), /v1/predictions/arb (${p("predictions_arb")}, Polymarket vs Kalshi net arb), /v1/solana/trending (${p("solana_trending")}, RugCheck-scored). Deep Dives, Safety & Execution: /v1/evm/safety?address=<0x>&chain=base (${p("evm_safety")}, GoPlus+Honeypot.is), /v1/execution/quote-check?mode=perps&coin=BTC (${p("execution_quote_check")}, multi-tier EVM/Perps slippage), /v1/options/surface?currency=BTC (${p("options_surface")}, Deribit IV/skew/max-pain), /v1/macro/liquidity (${p("macro_liquidity")}, US Treasury & NY Fed), /v1/perps/snapshot?coin=BTC (${p("perps_snapshot")}), /v1/solana/safety?mint=<MINT> (${p("solana_safety")}). ${DISCLAIMER}`,
      contact: {
        name: `${SERVICE_NAME} Support`,
        url: baseUrl,
        email: CONTACT_EMAIL,
      },
    },
    servers: [{ url: baseUrl }],
    security: [],
    paths,
  });
}

export function llmsTxtHandler(c: Context<AppBindings>) {
  const baseUrl = resolveBaseUrl(c);
  const network = c.env.X402_NETWORK || "eip155:84532";
  const p = (id: Parameters<typeof getEndpointById>[0]) => getEndpointById(id).priceFormatted;

  const lines = [
    `# ${BRAND_HEADLINE} (v${SERVICE_VERSION})`,
    "",
    `> ${BRAND_HEADLINE}. ${CATALOG.length} pay-per-call x402 V2 endpoints delivering compact, deterministic JSON: Hyperliquid screener & L2 slippage, 3-venue funding arb (Hyperliquid/dYdX v4/Kraken), Polymarket + Kalshi prediction-market scanner & cross-venue arbitrage detector, Deribit BTC/ETH options volatility surface & max pain, official US Treasury & NY Fed macro liquidity pulse, multi-chain EVM & Solana token safety, and multi-tier EVM/Perps execution quote checks. ${DISCLAIMER}`,
    "",
    "## Quickstart for AI Agents",
    `- Native MCP Server (Claude Desktop / Cursor / OpenClaw): \`npx -y ${MCP_PACKAGE}\` (set \`BUYER_PRIVATE_KEY\` and \`MAX_PAYMENT_USD=$0.05\`)`,
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
    `- **Macro + Volatility Brief ($0.025):** Pair \`/v1/macro/liquidity\` (${p("macro_liquidity")}) with \`/v1/options/surface?currency=BTC\` (${p("options_surface")}).`,
    "",
    "## Retry & Spend Discipline",
    '- Set a client spend cap (e.g. `maxAmountPerPayment: "$0.05"`).',
    "- Do not retry `400` or `404` without fixing query parameters; back off on `502`/`503`. None of `400`/`404`/`502`/`503` settle payment.",
    "",
    "## Paid Endpoints",
    ...CATALOG.map(
      (entry) =>
        `- \`${entry.method} ${baseUrl}${entry.path}?${new URLSearchParams(entry.exampleQueryParams).toString()}\` (${entry.priceFormatted} USD): ${entry.description}`
    ),
    "",
    "## Discovery & Metadata",
    `- x402 Manifest: ${baseUrl}/.well-known/x402`,
    `- x402 Manifest (JSON alias): ${baseUrl}/.well-known/x402.json`,
    `- RFC 9727 API Catalog: ${baseUrl}/.well-known/api-catalog`,
    `- MCP Server Card: ${baseUrl}/.well-known/mcp/server-card.json`,
    `- A2A Agent Card: ${baseUrl}/.well-known/agent-card.json`,
    `- OpenAPI 3.1 Spec: ${baseUrl}/openapi.json`,
    `- Sitemap: ${baseUrl}/sitemap.xml`,
    `- Health Check: ${baseUrl}/health`,
    `- GitHub & Docs: ${REPO_URL}`,
    `- Contact: ${CONTACT_EMAIL}`,
    "",
    "## Disclaimer",
    DISCLAIMER,
    "",
  ];

  return c.text(lines.join("\n"), 200, {
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
    description: `${BRAND_HEADLINE}. ${CATALOG.length} pay-per-request x402 V2 endpoints: perps screener (${p("perps_screener")}), 3-venue funding arb (${p("perps_funding_arb")}), Hyperliquid L2 slippage snapshot (${p("perps_snapshot")}), Polymarket+Kalshi prediction scanner (${p("predictions_scanner")}) & cross-venue arb (${p("predictions_arb")}), multi-chain EVM token safety (${p("evm_safety")}), multi-tier EVM/Perps execution quote-check (${p("execution_quote_check")}), Deribit BTC/ETH options vol surface & max pain (${p("options_surface")}), US Treasury & NY Fed macro liquidity pulse (${p("macro_liquidity")}), RugCheck trending Solana pools (${p("solana_trending")}), and Solana SPL safety audit (${p("solana_safety")}). ${DISCLAIMER}`,
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
    description: `${BRAND_HEADLINE}: ${CATALOG.length} pay-per-call token-safety, execution slippage, perps, prediction-market, options & macro tools on Base USDC via x402 V2. ${DISCLAIMER}`,
    websiteUrl: baseUrl,
    documentationUrl: `${baseUrl}/llms.txt`,
    repository: {
      url: REPO_URL,
      source: "github",
      subfolder: "mcp",
    },
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", MCP_PACKAGE],
    },
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
    tools: [
      {
        name: "exactjson_health",
        description:
          "Free: Check ExactJSON API availability, version, network (Base eip155:8453), and paused status before running paid workflows.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      ...CATALOG.map((entry) => ({
        name: `exactjson_${entry.id}`,
        description: `Paid (${entry.priceFormatted} USDC): ${entry.description}`,
        inputSchema: entry.inputSchema,
      })),
    ],
    links: {
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

export function sitemapXmlHandler(c: Context<AppBindings>) {
  const safeBaseUrl = escapeXml(resolveBaseUrl(c));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${safeBaseUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
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
