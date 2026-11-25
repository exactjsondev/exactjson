import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { serviceControlMiddleware } from "./middleware/serviceControl";
import { telemetryMiddleware } from "./middleware/telemetry";
import { x402PaywallMiddleware } from "./middleware/x402";
import {
  dashboardGetControlHandler,
  dashboardOverviewHandler,
  dashboardRequestsHandler,
  dashboardSetControlHandler,
} from "./routes/dashboardApi";
import {
  agentCardHandler,
  apiCatalogHandler,
  healthHandler,
  indexHandler,
  llmsTxtHandler,
  mcpServerCardHandler,
  openApiHandler,
  resolveBaseUrl,
  robotsTxtHandler,
  sitemapXmlHandler,
  wellKnownX402Handler,
} from "./routes/discovery";
import { getEndpointByPath } from "./config/catalog";
import { prefersHtml } from "./lib/contentNegotiation";
import { renderNotFoundHtml } from "./routes/landingHtml";
import { evmSafetyHandler } from "./routes/evmSafety";
import { executionQuoteCheckHandler } from "./routes/executionQuoteCheck";
import { fundingArbHandler } from "./routes/fundingArb";
import { macroLiquidityHandler } from "./routes/macroLiquidity";
import { createMcpHandler } from "./routes/mcp";
import { optionsSurfaceHandler } from "./routes/optionsSurface";
import { perpsScreenerHandler } from "./routes/perpsScreener";
import { perpsSnapshotHandler } from "./routes/perpsSnapshot";
import { predictionsArbHandler } from "./routes/predictionsArb";
import { predictionsScannerHandler } from "./routes/predictionsScanner";
import { solanaSafetyHandler } from "./routes/solanaSafety";
import { solanaTrendingHandler } from "./routes/solanaTrending";
import type { AppBindings, Env } from "./types";

const app = new Hono<AppBindings>({ strict: false });

const x402Cors = cors({
  origin: "*",
  allowMethods: ["GET", "OPTIONS"],
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
app.use("/.well-known/*", x402Cors);
app.use("/openapi.json", x402Cors);
app.use("/llms.txt", x402Cors);
app.use("/llms-full.txt", x402Cors);

const { mcpPostHandler, mcpMethodNotAllowedHandler } = createMcpHandler(
  (req, env, ctx) => app.fetch(req, env, ctx)
);

// Free discovery & health routes (never load x402 middleware)
app.get("/", indexHandler);
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
app.all("/mcp", mcpMethodNotAllowedHandler);
app.get("/llms-full.txt", llmsTxtHandler);

// Paid /v1/* pipeline: telemetry -> operator pause gate -> lazy x402 V2 paywall -> exact full-path handlers
app.use("/v1/*", telemetryMiddleware);
app.use("/v1/*", serviceControlMiddleware);
app.use("/v1/*", x402PaywallMiddleware);
app.get("/v1/solana/safety", solanaSafetyHandler);
app.get("/v1/solana/trending", solanaTrendingHandler);
app.get("/v1/perps/snapshot", perpsSnapshotHandler);
app.get("/v1/perps/screener", perpsScreenerHandler);
app.get("/v1/perps/funding-arb", fundingArbHandler);
app.get("/v1/predictions/scanner", predictionsScannerHandler);
app.get("/v1/options/surface", optionsSurfaceHandler);
app.get("/v1/macro/liquidity", macroLiquidityHandler);
app.get("/v1/evm/safety", evmSafetyHandler);
app.get("/v1/predictions/arb", predictionsArbHandler);
app.get("/v1/execution/quote-check", executionQuoteCheckHandler);

// Return 405 Method Not Allowed when a known /v1/* endpoint is called with a non-GET/HEAD method
app.all("/v1/*", (c, next) => {
  const endpoint = getEndpointByPath(c.req.path);
  if (endpoint && c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
    c.header("Allow", "GET, HEAD, OPTIONS");
    return c.json(
      {
        error: "METHOD_NOT_ALLOWED",
        message: `All ExactJSON endpoints use HTTP GET. Use GET ${endpoint.path} instead.`,
        allowed_methods: ["GET", "HEAD", "OPTIONS"],
        endpoint: endpoint.path,
      },
      405
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

// Branded HTML 404 for browsers and structured JSON 404 with discovery links for APIs/agents
app.notFound((c) => {
  const baseUrl = resolveBaseUrl(c);
  const path = c.req.path;
  c.header("X-Content-Type-Options", "nosniff");

  if (prefersHtml(c.req.header("accept"))) {
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
    );
    return c.html(renderNotFoundHtml(baseUrl, path), 404);
  }

  return c.json(
    {
      error: "NOT_FOUND",
      message: `No ExactJSON route matches ${path}.`,
      path,
      discovery: {
        index: `${baseUrl}/`,
        x402: `${baseUrl}/.well-known/x402`,
        openapi: `${baseUrl}/openapi.json`,
        llms: `${baseUrl}/llms.txt`,
        health: `${baseUrl}/health`,
      },
    },
    404
  );
});

const RETENTION_DAYS_402 = 7;
const PRUNE_BATCH_LIMIT = 5000;

export async function pruneOldChallengedRequests(db: Env["DB"]): Promise<number> {
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS_402 * 24 * 60 * 60 * 1000
  ).toISOString();

  // Covering index scan on idx_api_requests_outcome_created via rowid; SETTLED revenue rows are kept forever
  const result = await db
    .prepare(
      `DELETE FROM api_requests
       WHERE rowid IN (
         SELECT rowid FROM api_requests
         WHERE outcome = 'CHALLENGED_402' AND created_at < ?
         ORDER BY created_at ASC
         LIMIT ?
       )`
    )
    .bind(cutoff, PRUNE_BATCH_LIMIT)
    .run();

  return Number(result.meta?.changes ?? 0);
}

export { app };

export default {
  fetch: app.fetch,
  request: app.request.bind(app),
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      pruneOldChallengedRequests(env.DB)
        .then((deleted) => {
          if (deleted > 0) {
            console.log(`Pruned ${deleted} CHALLENGED_402 rows older than ${RETENTION_DAYS_402}d`);
          }
        })
        .catch((err) => {
          console.error("Daily D1 402 prune failed:", err);
        })
    );
  },
};
