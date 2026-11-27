import { Hono } from "hono";
import { cors } from "hono/cors";
import { getEndpointByPath } from "./config/catalog";
import { negotiateContentType } from "./lib/contentNegotiation";
import { applyHtmlSecurityHeaders } from "./lib/securityHeaders";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { serviceControlMiddleware } from "./middleware/serviceControl";
import { telemetryMiddleware } from "./middleware/telemetry";
import { x402PaywallMiddleware } from "./middleware/x402";
import { registerCommercePackRoutes } from "./packs/commerce";
import { registerMarketsPackRoutes } from "./packs/markets";
import { registerResearchPackRoutes } from "./packs/research";
import { registerSecurityPackRoutes } from "./packs/security";
import { registerWorldPackRoutes } from "./packs/world";
import {
  dashboardGetControlHandler,
  dashboardOverviewHandler,
  dashboardRequestsHandler,
  dashboardSetControlHandler,
} from "./routes/dashboardApi";
import {
  aboutPageHandler,
  agentCardHandler,
  apiCatalogHandler,
  contactPageHandler,
  docsPageHandler,
  healthHandler,
  indexHandler,
  llmsTxtHandler,
  mcpServerCardHandler,
  openApiHandler,
  pricingPageHandler,
  privacyPageHandler,
  resolveBaseUrl,
  robotsTxtHandler,
  setupPageHandler,
  sitemapXmlHandler,
  wellKnownX402Handler,
} from "./routes/discovery";
import { renderNotFoundHtml } from "./routes/landingHtml";
import { createMcpHandler } from "./routes/mcp";
import type { AppBindings, Env } from "./types";

const app = new Hono<AppBindings>({ strict: false });

const x402Cors = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE", "X-PAYMENT"],
  exposeHeaders: [
    "PAYMENT-REQUIRED",
    "PAYMENT-RESPONSE",
    "X-PAYMENT-RESPONSE",
    "EXTENSION-RESPONSES",
  ],
  maxAge: 86400,
});

const mcpCors = cors({
  origin: "*",
  allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Content-Type",
    "Accept",
    "Mcp-Protocol-Version",
    "Mcp-Session-Id",
    "PAYMENT-SIGNATURE",
    "X-PAYMENT",
  ],
  exposeHeaders: [
    "Mcp-Protocol-Version",
    "Mcp-Session-Id",
    "PAYMENT-REQUIRED",
    "PAYMENT-RESPONSE",
    "X-PAYMENT-RESPONSE",
    "EXTENSION-RESPONSES",
  ],
  maxAge: 86400,
});

// CORS strictly on paid, MCP, and discovery routes (never wildcard on /dashboard/api/*)
app.use("/", x402Cors);
app.use("/health", x402Cors);
app.use("/v1/*", x402Cors);
app.use("/mcp", mcpCors);
app.use("/mcp/*", mcpCors);
app.use("/.well-known/*", x402Cors);
app.use("/openapi.json", x402Cors);
app.use("/llms.txt", x402Cors);
app.use("/llms-full.txt", x402Cors);

const { mcpPostHandler, mcpMethodNotAllowedHandler } = createMcpHandler((req, env, ctx) =>
  app.fetch(req, env, ctx),
);

// Free discovery & health routes (never load x402 middleware)
app.get("/", indexHandler);
app.get("/setup", setupPageHandler);
app.get("/docs", docsPageHandler);
app.get("/pricing", pricingPageHandler);
app.get("/about", aboutPageHandler);
app.get("/contact", contactPageHandler);
app.get("/privacy", privacyPageHandler);
app.get("/health", healthHandler);
app.get("/robots.txt", robotsTxtHandler);
app.get("/sitemap.xml", sitemapXmlHandler);
app.get("/.well-known/x402", wellKnownX402Handler);
app.get("/.well-known/x402.json", wellKnownX402Handler);
app.get("/.well-known/api-catalog", apiCatalogHandler);
app.get("/.well-known/mcp/server-card.json", mcpServerCardHandler);
app.get("/.well-known/agent-card.json", agentCardHandler);
app.get("/.well-known/agent.json", agentCardHandler);
app.get("/openapi.json", openApiHandler);
app.get("/llms.txt", llmsTxtHandler);

// Remote Streamable HTTP MCP (stateless JSON-RPC 2.0; free discovery + paid /v1/* bridge)
app.post("/mcp", mcpPostHandler);
app.post("/mcp/:pack", mcpPostHandler);
app.all("/mcp", mcpMethodNotAllowedHandler);
app.all("/mcp/:pack", mcpMethodNotAllowedHandler);
app.get("/llms-full.txt", llmsTxtHandler);

// Paid /v1/* pipeline: telemetry -> operator pause gate -> lazy x402 V2 paywall -> pack route handlers
app.use("/v1/*", telemetryMiddleware);
app.use("/v1/*", serviceControlMiddleware);
app.use("/v1/*", x402PaywallMiddleware);
registerMarketsPackRoutes(app);
registerSecurityPackRoutes(app);
registerWorldPackRoutes(app);
registerCommercePackRoutes(app);
registerResearchPackRoutes(app);

// Return 405 Method Not Allowed when a known /v1/* endpoint is called with a non-GET/HEAD method
app.all("/v1/*", (c, next) => {
  const endpoint = c.get("matched_endpoint") ?? getEndpointByPath(c.req.path);
  if (endpoint && c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
    c.header("Allow", "GET, HEAD, OPTIONS");
    return c.json(
      {
        error: "METHOD_NOT_ALLOWED",
        message: `All ExactJSON endpoints use HTTP GET. Use GET ${endpoint.path} instead.`,
        allowed_methods: ["GET", "HEAD", "OPTIONS"],
        endpoint: endpoint.path,
      },
      405,
    );
  }
  return next();
});

// Same-origin private operator dashboard API (never cached, hardened headers)
app.use("/dashboard/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
});
app.use("/dashboard/api/*", adminAuthMiddleware);
app.get("/dashboard/api/overview", dashboardOverviewHandler);
app.get("/dashboard/api/requests", dashboardRequestsHandler);
app.get("/dashboard/api/control", dashboardGetControlHandler);
app.post("/dashboard/api/control", dashboardSetControlHandler);

// Branded HTML/Markdown/JSON 404 with discovery links for browsers and agents
app.notFound((c) => {
  const baseUrl = resolveBaseUrl(c);
  const path = c.req.path;
  const format = negotiateContentType(c.req.header("accept"));
  c.header("Vary", "Accept");
  c.header("X-Content-Type-Options", "nosniff");

  if (format === "html") {
    applyHtmlSecurityHeaders(c);
    return c.html(renderNotFoundHtml(baseUrl, path), 404);
  }

  if (format === "markdown") {
    const md = [
      `# 404 Not Found — ${path}`,
      "",
      `No ExactJSON route matches \`${path}\`. All paid endpoints live under \`/v1/*\`.`,
      "",
      "## Helpful Links",
      `- [Setup Guide](${baseUrl}/setup)`,
      `- [API Docs](${baseUrl}/docs)`,
      `- [Pricing](${baseUrl}/pricing)`,
      `- [llms.txt](${baseUrl}/llms.txt)`,
      `- [OpenAPI 3.1](${baseUrl}/openapi.json)`,
      `- [Sitemap](${baseUrl}/sitemap.xml)`,
      "",
    ].join("\n");
    return c.text(md, 404, { "Content-Type": "text/markdown; charset=utf-8" });
  }

  return c.json(
    {
      error: "NOT_FOUND",
      message: `No ExactJSON route matches ${path}.`,
      path,
      discovery: {
        index: `${baseUrl}/`,
        setup: `${baseUrl}/setup`,
        docs: `${baseUrl}/docs`,
        pricing: `${baseUrl}/pricing`,
        x402: `${baseUrl}/.well-known/x402`,
        openapi: `${baseUrl}/openapi.json`,
        llms: `${baseUrl}/llms.txt`,
        health: `${baseUrl}/health`,
      },
    },
    404,
  );
});

app.onError((err, c) => {
  console.error("Unhandled Worker error:", err instanceof Error ? err.message : err);
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.json(
    {
      error: "INTERNAL_ERROR",
      message: "Unexpected internal server error. Payment was not settled.",
    },
    500,
  );
});

const RETENTION_DAYS_402 = 7;
const RETENTION_DAYS_VERIFY_FAILED = 14;
const PRUNE_BATCH_LIMIT = 5000;
const MAX_PRUNE_ITERATIONS = 4;

export async function pruneOldChallengedRequests(db: Env["DB"]): Promise<number> {
  const cutoff402 = new Date(Date.now() - RETENTION_DAYS_402 * 24 * 60 * 60 * 1000).toISOString();
  const cutoffVerifyFailed = new Date(
    Date.now() - RETENTION_DAYS_VERIFY_FAILED * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Covering index scan on idx_api_requests_outcome_created via rowid; SETTLED revenue and UNSETTLED_ERROR rows are kept
  const deleteSql = `DELETE FROM api_requests
       WHERE rowid IN (
         SELECT rowid FROM api_requests
         WHERE outcome = ? AND created_at < ?
         ORDER BY created_at ASC
         LIMIT ?
       )`;

  let totalDeleted = 0;
  for (let i = 0; i < MAX_PRUNE_ITERATIONS; i += 1) {
    const [res402, resVerify] = await Promise.all([
      db.prepare(deleteSql).bind("CHALLENGED_402", cutoff402, PRUNE_BATCH_LIMIT).run(),
      db.prepare(deleteSql).bind("VERIFY_FAILED", cutoffVerifyFailed, PRUNE_BATCH_LIMIT).run(),
    ]);
    const c402 = Number(res402.meta?.changes ?? 0);
    const cVer = Number(resVerify.meta?.changes ?? 0);
    totalDeleted += c402 + cVer;
    if (c402 < PRUNE_BATCH_LIMIT && cVer < PRUNE_BATCH_LIMIT) {
      break;
    }
  }

  return totalDeleted;
}

export { app };

export default {
  fetch: app.fetch,
  request: app.request.bind(app),
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      pruneOldChallengedRequests(env.DB)
        .then((deleted) => {
          if (deleted > 0) {
            console.log(
              `Pruned ${deleted} unpaid rows (CHALLENGED_402 > ${RETENTION_DAYS_402}d, VERIFY_FAILED > ${RETENTION_DAYS_VERIFY_FAILED}d)`,
            );
          }
        })
        .catch((err) => {
          console.error("Daily D1 unpaid telemetry prune failed:", err);
        }),
    );
  },
};
