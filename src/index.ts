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
  robotsTxtHandler,
  sitemapXmlHandler,
  wellKnownX402Handler,
} from "./routes/discovery";
import { evmSafetyHandler } from "./routes/evmSafety";
import { executionQuoteCheckHandler } from "./routes/executionQuoteCheck";
import { fundingArbHandler } from "./routes/fundingArb";
import { macroLiquidityHandler } from "./routes/macroLiquidity";
import { optionsSurfaceHandler } from "./routes/optionsSurface";
import { perpsScreenerHandler } from "./routes/perpsScreener";
import { perpsSnapshotHandler } from "./routes/perpsSnapshot";
import { predictionsArbHandler } from "./routes/predictionsArb";
import { predictionsScannerHandler } from "./routes/predictionsScanner";
import { solanaSafetyHandler } from "./routes/solanaSafety";
import { solanaTrendingHandler } from "./routes/solanaTrending";
import type { AppBindings, Env } from "./types";

const app = new Hono<AppBindings>();

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

// CORS strictly on paid and discovery routes (never wildcard on /dashboard/api/*)
app.use("/v1/*", x402Cors);
app.use("/.well-known/*", x402Cors);
app.use("/openapi.json", x402Cors);
app.use("/llms.txt", x402Cors);

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
