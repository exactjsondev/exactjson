import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { DISCLAIMER, getEndpointByPath } from "../src/config/catalog";
import { clearServiceControlCache } from "../src/middleware/serviceControl";
import { classifyOutcome } from "../src/middleware/telemetry";
import type { Env } from "../src/types";

function createMockDb(initialPaused = false) {
  let paused = initialPaused ? 1 : 0;
  let updatedAt = "2026-11-24T00:00:00.000Z";
  const insertedRows: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM service_control")) {
            return { paused, updated_at: updatedAt } as T;
          }
          return {
            total_requests: insertedRows.length,
            settled_count: 0,
            revenue_usd: 0,
            challenged_count: 0,
            verify_failed_count: 0,
            error_count: 0,
            avg_latency_ms: 0,
          } as T;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes("INTO service_control")) {
            paused = Number(boundArgs[1] ?? 0);
            updatedAt = String(boundArgs[2] ?? updatedAt);
          } else if (sql.includes("INTO api_requests")) {
            insertedRows.push(boundArgs);
          }
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, insertedRows };
}

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "testnet",
    X402_NETWORK: "eip155:84532",
    X402_PAY_TO: "0x1111111111111111111111111111111111111111",
    PUBLIC_BASE_URL: "",
    DASHBOARD_TOKEN: "test-secret-dashboard-token-1234567890",
    DB: db,
    ...overrides,
  };
}

describe("discovery routes, HTML/JSON negotiation, CORS, telemetry, and service pause gate", () => {
  beforeEach(() => {
    clearServiceControlCache();
  });

  it("serves /health, /.well-known/x402(.json), /openapi.json, /llms.txt, /sitemap.xml, and discovery cards cleanly", async () => {
    const { db } = createMockDb(false);
    const env = makeEnv(db);

    const healthRes = await app.request("http://localhost:8787/health", {}, env);
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get("cache-control")).toBe("no-store");
    expect(await healthRes.json()).toEqual({
      status: "ok",
      service: "ExactJSON",
      env: "testnet",
      network: "eip155:84532",
      version: "1.0.0",
      paused: false,
    });

    const wkRes = await app.request("http://localhost:8787/.well-known/x402", {}, env);
    expect(wkRes.status).toBe(200);
    expect(wkRes.headers.get("cache-control")).toBe("public, max-age=300");
    expect(wkRes.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
    const wkBody = await wkRes.json();
    expect(wkBody).toEqual({
      version: 1,
      resources: [
        "GET http://localhost:8787/v1/solana/safety",
        "GET http://localhost:8787/v1/solana/trending",
        "GET http://localhost:8787/v1/perps/snapshot",
        "GET http://localhost:8787/v1/perps/screener",
        "GET http://localhost:8787/v1/perps/funding-arb",
        "GET http://localhost:8787/v1/predictions/scanner",
        "GET http://localhost:8787/v1/options/surface",
        "GET http://localhost:8787/v1/macro/liquidity",
        "GET http://localhost:8787/v1/evm/safety",
        "GET http://localhost:8787/v1/predictions/arb",
        "GET http://localhost:8787/v1/execution/quote-check",
      ],
    });

    // Exact alias /.well-known/x402.json
    const wkJsonRes = await app.request("http://localhost:8787/.well-known/x402.json", {}, env);
    expect(wkJsonRes.status).toBe(200);
    expect(wkJsonRes.headers.get("cache-control")).toBe("public, max-age=300");
    expect(wkJsonRes.headers.get("access-control-allow-origin")).toBe("*");
    expect(await wkJsonRes.json()).toEqual(wkBody);

    const oaRes = await app.request("http://localhost:8787/openapi.json", {}, env);
    expect(oaRes.status).toBe(200);
    const oa = (await oaRes.json()) as {
      openapi: string;
      info: {
        title: string;
        version: string;
        description: string;
        "x-guidance": string;
        contact: { email?: string };
      };
      security: unknown[];
      paths: Record<string, { get: { "x-payment-info": { protocols: unknown[]; price: { amount: string } } } }>;
    };
    expect(oa.openapi).toBe("3.1.0");
    expect(oa.info.title).toContain("ExactJSON");
    expect(oa.info.version).toBe("1.0.0");
    expect(oa.info.contact.email).toBe("hello@exactjson.com");
    expect(oa.info.description).toContain(DISCLAIMER);
    expect(oa.info["x-guidance"]).toContain("x402 V2");
    expect(oa.info["x-guidance"]).toContain("npx -y exactjson-mcp");
    expect(oa.info["x-guidance"]).toContain("/v1/predictions/scanner ($0.01");
    expect(oa.info["x-guidance"]).not.toContain("/v1/predictions/scanner ($0.015");
    expect(oa.security).toEqual([]);
    expect(oa.paths["/v1/solana/safety"]?.get["x-payment-info"].protocols).toEqual([{ x402: {} }]);
    expect(oa.paths["/v1/solana/safety"]?.get["x-payment-info"].price.amount).toBe("0.01");
    expect(oa.paths["/v1/perps/snapshot"]?.get["x-payment-info"].price.amount).toBe("0.005");
    expect(oa.paths["/v1/predictions/scanner"]?.get["x-payment-info"].price.amount).toBe("0.01");
    expect(oa.paths["/v1/options/surface"]?.get["x-payment-info"].price.amount).toBe("0.015");
    expect(oa.paths["/v1/macro/liquidity"]?.get["x-payment-info"].price.amount).toBe("0.01");
    expect(oa.paths["/v1/evm/safety"]?.get["x-payment-info"].price.amount).toBe("0.01");
    expect(oa.paths["/v1/predictions/arb"]?.get["x-payment-info"].price.amount).toBe("0.02");
    expect(oa.paths["/v1/execution/quote-check"]?.get["x-payment-info"].price.amount).toBe("0.01");

    const llmsRes = await app.request("http://localhost:8787/llms.txt", {}, env);
    expect(llmsRes.status).toBe(200);
    const llmsText = await llmsRes.text();
    expect(llmsText).toContain("ExactJSON");
    expect(llmsText).toContain("Live, deterministic x402 APIs for AI agents");
    expect(llmsText).toContain(DISCLAIMER);
    expect(llmsText).toContain("http://localhost:8787/.well-known/x402");
    expect(llmsText).toContain("http://localhost:8787/.well-known/x402.json");
    expect(llmsText).toContain("http://localhost:8787/.well-known/agent-card.json");
    expect(llmsText).toContain("npx -y exactjson-mcp");
    expect(llmsText).toContain("https://github.com/exactjsondev/exactjson");
    expect(llmsText).toContain("## Recommended Agent Workflows");

    const cardRes = await app.request("http://localhost:8787/.well-known/agent-card.json", {}, env);
    expect(cardRes.status).toBe(200);
    expect(cardRes.headers.get("cache-control")).toBe("public, max-age=300");
    const card = (await cardRes.json()) as {
      name: string;
      version: string;
      description: string;
      skills: unknown[];
      authentication: { schemes: string[] };
    };
    expect(card.name).toBe("ExactJSON");
    expect(card.version).toBe("1.0.0");
    expect(card.description).toContain("prediction scanner ($0.01)");
    expect(card.description).not.toContain("prediction scanner ($0.015)");
    expect(card.skills.length).toBe(11);
    expect(card.authentication.schemes).toContain("x402");

    // Legacy A2A alias /.well-known/agent.json
    const legacyCardRes = await app.request("http://localhost:8787/.well-known/agent.json", {}, env);
    expect(legacyCardRes.status).toBe(200);
    expect(((await legacyCardRes.json()) as { name: string }).name).toBe("ExactJSON");

    // RFC 9727 API Catalog
    const catalogRes = await app.request("http://localhost:8787/.well-known/api-catalog", {}, env);
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.headers.get("content-type")).toContain("application/linkset+json");
    expect(catalogRes.headers.get("access-control-allow-origin")).toBe("*");
    const catalogBody = (await catalogRes.json()) as { linkset: Array<{ anchor: string }> };
    expect(catalogBody.linkset[0]?.anchor).toBe("http://localhost:8787");

    // MCP Server Card
    const mcpCardRes = await app.request(
      "http://localhost:8787/.well-known/mcp/server-card.json",
      {},
      env
    );
    expect(mcpCardRes.status).toBe(200);
    const mcpCard = (await mcpCardRes.json()) as {
      serverInfo: { name: string; version: string };
      tools: Array<{ name: string; inputSchema: { properties: Record<string, { type?: string }> } }>;
    };
    expect(mcpCard.serverInfo.name).toBe("io.github.exactjsondev/exactjson");
    expect(mcpCard.serverInfo.version).toBe("1.0.0");
    expect(mcpCard.tools.length).toBe(12);
    expect(mcpCard.tools[0]?.name).toBe("exactjson_health");
    expect(mcpCard.tools[1]?.name).toBe("exactjson_solana_safety");
    // MCP server-card numeric parameter types match mcp/index.mjs Zod schemas
    const screenerTool = mcpCard.tools.find((t) => t.name === "exactjson_perps_screener");
    expect(screenerTool?.inputSchema.properties.limit?.type).toBe("integer");
    expect(screenerTool?.inputSchema.properties.min_oi_usd?.type).toBe("number");
    const macroTool = mcpCard.tools.find((t) => t.name === "exactjson_macro_liquidity");
    expect(macroTool?.inputSchema.properties.lookback_obs?.type).toBe("integer");

    // Sitemap & Robots
    const sitemapRes = await app.request("http://localhost:8787/sitemap.xml", {}, env);
    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.headers.get("content-type")).toContain("application/xml");
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain("<loc>http://localhost:8787/</loc>");
    expect(sitemapXml).toContain("<loc>http://localhost:8787/llms.txt</loc>");

    const robotsRes = await app.request("http://localhost:8787/robots.txt", {}, env);
    expect(robotsRes.status).toBe(200);
    const robotsTxt = await robotsRes.text();
    expect(robotsTxt).toContain("Content-Signal: search=yes, ai-input=yes");
    expect(robotsTxt).toContain("Sitemap: http://localhost:8787/sitemap.xml");
    expect(robotsTxt).toContain("Disallow: /dashboard");
    expect(robotsTxt).toContain("Disallow: /dashboard/");

    // Path normalization matches URL-encoded and trailing-slash variants for telemetry and rejects Object.prototype keys
    expect(getEndpointByPath("/v1/solana/%73afety")?.path).toBe("/v1/solana/safety");
    expect(getEndpointByPath("/v1/perps/snapshot/")?.path).toBe("/v1/perps/snapshot");
    expect(getEndpointByPath("toString")).toBeUndefined();
    expect(getEndpointByPath("constructor")).toBeUndefined();
  });

  it("negotiates GET / safely between HTML and JSON with Vary: Accept", async () => {
    const { db } = createMockDb(false);
    const env = makeEnv(db);

    // No Accept header -> JSON
    const jsonDefault = await app.request("http://localhost:8787/", {}, env);
    expect(jsonDefault.status).toBe(200);
    expect(jsonDefault.headers.get("vary")).toContain("Accept");
    expect(jsonDefault.headers.get("content-type")).toContain("application/json");
    expect(jsonDefault.headers.get("link")).toContain('rel="api-catalog"');
    expect(jsonDefault.headers.get("link")).toContain("mcp/server-card.json");
    const jsonBody = (await jsonDefault.json()) as {
      service: string;
      version: string;
      mcp: { package: string; registry_name: string };
    };
    expect(jsonBody.service).toBe("ExactJSON");
    expect(jsonBody.version).toBe("1.0.0");
    expect(jsonBody.mcp.package).toBe("exactjson-mcp");
    expect(jsonBody.mcp.registry_name).toBe("io.github.exactjsondev/exactjson");

    // Wildcard */* -> JSON (curl, x402scan, AgentCash)
    const jsonStar = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "*/*" } },
      env
    );
    expect(jsonStar.headers.get("vary")).toContain("Accept");
    expect(jsonStar.headers.get("content-type")).toContain("application/json");

    // Explicit JSON preference over HTML -> JSON
    const jsonPreferred = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "application/json, text/html;q=0.5" } },
      env
    );
    expect(jsonPreferred.headers.get("content-type")).toContain("application/json");

    // Rejected text/html (q=0) -> JSON
    const htmlZero = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "text/html;q=0, application/json;q=0.8" } },
      env
    );
    expect(htmlZero.headers.get("content-type")).toContain("application/json");

    // Browser / Googlebot Accept -> HTML docs
    const htmlBrowser = await app.request(
      "http://localhost:8787/",
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      env
    );
    expect(htmlBrowser.status).toBe(200);
    expect(htmlBrowser.headers.get("vary")).toContain("Accept");
    expect(htmlBrowser.headers.get("cache-control")).toBe("public, max-age=300");
    expect(htmlBrowser.headers.get("content-type")).toContain("text/html");
    expect(htmlBrowser.headers.get("x-content-type-options")).toBe("nosniff");
    expect(htmlBrowser.headers.get("x-frame-options")).toBe("DENY");
    expect(htmlBrowser.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(htmlBrowser.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(htmlBrowser.headers.get("link")).toContain('rel="api-catalog"');
    const html = await htmlBrowser.text();
    expect(html).toContain("ExactJSON");
    expect(html).toContain("Live, deterministic x402 APIs for AI agents");
    expect(html).toContain("/v1/predictions/scanner");
    expect(html).toContain("/v1/execution/quote-check?mode=perps&amp;coin=BTC");
    expect(html).toContain("$0.01");
    expect(html).toContain("npx -y exactjson-mcp");
    expect(html).toContain("hello@exactjson.com");
    expect(html).toContain(DISCLAIMER);
  });

  it("escapes XML special characters in /sitemap.xml and rejects zero burn-address X402_PAY_TO", async () => {
    const { db } = createMockDb(false);
    const xmlEnv = makeEnv(db, { PUBLIC_BASE_URL: "https://exactjson.com/?a=1&b=<tag>" });
    const sitemapRes = await app.request("http://localhost:8787/sitemap.xml", {}, xmlEnv);
    expect(sitemapRes.status).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain("&amp;b=&lt;tag&gt;/");
    expect(sitemapXml).not.toContain("<tag>");

    const burnEnv = makeEnv(db, {
      X402_PAY_TO: "0x0000000000000000000000000000000000000000",
    });
    const burnRes = await app.request(
      "http://localhost:8787/v1/perps/snapshot?coin=BTC",
      {},
      burnEnv
    );
    expect(burnRes.status).toBe(500);
    expect(((await burnRes.json()) as { error: string }).error).toBe("SERVER_MISCONFIGURED");

    // Unmatched /v1/* path must return 404 cleanly without invoking x402 paywall or facilitator
    const notFoundRes = await app.request(
      "http://localhost:8787/v1/does-not-exist",
      {},
      burnEnv
    );
    expect(notFoundRes.status).toBe(404);
  });

  it("never imports @x402/* or @coinbase/x402 in free discovery modules", () => {
    const files = [
      resolve(process.cwd(), "src/routes/discovery.ts"),
      resolve(process.cwd(), "src/routes/landingHtml.ts"),
      resolve(process.cwd(), "src/lib/contentNegotiation.ts"),
    ];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(/from\s+["']@x402\//);
      expect(content).not.toMatch(/from\s+["']@coinbase\/x402/);
    }
  });

  it("keeps /dashboard/api/* strictly same-origin and toggles 503 pause gate before x402", async () => {
    const { db, insertedRows } = createMockDb(false);
    const env = makeEnv(db);

    const unauth = await app.request("http://localhost:8787/dashboard/api/overview", {}, env);
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("access-control-allow-origin")).toBeNull();
    expect(unauth.headers.get("cache-control")).toBe("no-store");
    expect(unauth.headers.get("x-content-type-options")).toBe("nosniff");

    const pauseRes = await app.request(
      "http://localhost:8787/dashboard/api/control",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DASHBOARD_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paused: true }),
      },
      env
    );
    expect(pauseRes.status).toBe(200);
    expect(((await pauseRes.json()) as { paused: boolean }).paused).toBe(true);

    // JSON null / array body must return 400 INVALID_PAYLOAD (never crash with 500)
    const nullBodyRes = await app.request(
      "http://localhost:8787/dashboard/api/control",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DASHBOARD_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: "null",
      },
      env
    );
    expect(nullBodyRes.status).toBe(400);
    expect(((await nullBodyRes.json()) as { error: string }).error).toBe("INVALID_PAYLOAD");

    const blocked = await app.request("http://localhost:8787/v1/perps/snapshot?coin=BTC", {}, env);
    expect(blocked.status).toBe(503);
    const blockedBody = (await blocked.json()) as { error: string; message: string };
    expect(blockedBody.error).toBe("SERVICE_PAUSED");
    expect(blockedBody.message).toContain("ExactJSON");

    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows.length).toBe(1);

    // HEAD /v1/* is also tracked by telemetryMiddleware (parity with x402 HEAD matching)
    const blockedHead = await app.request(
      "http://localhost:8787/v1/perps/snapshot?coin=BTC",
      { method: "HEAD" },
      env
    );
    expect(blockedHead.status).toBe(503);
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows.length).toBe(2);

    const healthPaused = await app.request("http://localhost:8787/health", {}, env);
    expect(healthPaused.status).toBe(200);
    expect(((await healthPaused.json()) as { paused: boolean }).paused).toBe(true);
  });

  it("classifies telemetry outcomes deterministically", () => {
    expect(classifyOutcome(402, false, null)).toBe("CHALLENGED_402");
    expect(classifyOutcome(402, true, null)).toBe("VERIFY_FAILED");
    expect(classifyOutcome(200, true, { success: true, transaction: "0xabc" })).toBe("SETTLED");
    expect(classifyOutcome(200, true, { success: false })).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(400, true, null)).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(502, true, null)).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(503, false, null)).toBe("UNSETTLED_ERROR");
  });
});
