import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import app, { pruneOldChallengedRequests } from "../src/index";
import { DISCLAIMER, getEndpointByPath } from "../src/config/catalog";
import { isolateCache } from "../src/lib/cache";
import { clearServiceControlCache } from "../src/middleware/serviceControl";
import { classifyOutcome, extractTelemetryError } from "../src/middleware/telemetry";
import { classifyFacilitatorInitError } from "../src/middleware/x402";
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
      version: "1.2.0",
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
        "GET http://localhost:8787/v1/oss/package-audit",
        "GET http://localhost:8787/v1/net/domain-trust",
        "GET http://localhost:8787/v1/sec/cve-triage",
        "GET http://localhost:8787/v1/ops/cloud-status",
        "GET http://localhost:8787/v1/oss/runtime-eol",
        "GET http://localhost:8787/v1/ai/model-audit",
        "GET http://localhost:8787/v1/net/censorship-check",
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
    expect(oa.info.version).toBe("1.2.0");
    expect(oa.info.contact.email).toBe("hello@exactjson.com");
    expect(oa.info.description).toContain(DISCLAIMER);
    expect(oa.info["x-guidance"]).toContain("x402 V2");
    expect(oa.info["x-guidance"]).toContain("npx -y exactjson-mcp");
    expect(oa.info["x-guidance"]).toContain("/v1/predictions/scanner ($0.01");
    expect(oa.info["x-guidance"]).not.toContain("/v1/predictions/scanner ($0.015");
    expect(oa.security).toEqual([]);
    const oaFull = oa as unknown as {
      info?: { license?: { name: string; identifier: string } };
      externalDocs?: { url: string };
      components?: { schemas?: { ErrorResponse?: unknown; PaymentRequiredResponse?: unknown } };
      paths: Record<
        string,
        {
          get: {
            parameters?: Array<{ name: string; schema: Record<string, unknown> }>;
            responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }>;
          };
        }
      >;
    };
    const screenerParams = oaFull.paths["/v1/perps/screener"]?.get.parameters ?? [];
    const limitParam = screenerParams.find((p) => p.name === "limit");
    expect(limitParam?.schema.type).toBe("string");
    expect(limitParam?.schema.mcpType).toBeUndefined();
    expect(oaFull.info?.license?.identifier).toBe("MIT");
    expect(oaFull.info?.license?.name).toBe("MIT");
    expect(oaFull.externalDocs?.url).toBe("http://localhost:8787/docs");
    expect(oaFull.components?.schemas?.ErrorResponse).toBeDefined();
    expect(oaFull.components?.schemas?.PaymentRequiredResponse).toBeDefined();
    for (const code of ["400", "404", "405", "502", "503"]) {
      expect(
        oaFull.paths["/v1/solana/safety"]?.get.responses[code]?.content?.["application/json"]?.schema?.$ref
      ).toBe("#/components/schemas/ErrorResponse");
    }
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
    expect(llmsText).toContain("https://www.npmjs.com/package/exactjson-mcp");
    expect(llmsText).toContain("https://glama.ai/mcp/servers/exactjsondev/exactjson");
    expect(llmsText).toContain("https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc");
    expect(llmsText).toContain("## When to Use ExactJSON");
    expect(llmsText).toContain("## Recommended Agent Workflows");
    expect(llmsText).toContain("## Versioning & Deprecation Policy");

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
    expect(card.version).toBe("1.2.0");
    expect(card.description).toContain("prediction scanner ($0.01)");
    expect(card.description).not.toContain("prediction scanner ($0.015)");
    expect(card.skills.length).toBe(18);
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
      transport: { type: string; endpoint?: string };
      remotes: Array<{ type: string; url: string }>;
      tools: Array<{ name: string; inputSchema: { properties: Record<string, { type?: string }> } }>;
    };
    expect(mcpCard.serverInfo.name).toBe("io.github.exactjsondev/exactjson");
    expect(mcpCard.serverInfo.version).toBe("1.2.0");
    expect(mcpCard.transport.type).toBe("streamable-http");
    expect(mcpCard.transport.endpoint).toBe("http://localhost:8787/mcp");
    expect(mcpCard.remotes).toEqual([
      {
        type: "streamable-http",
        url: "http://localhost:8787/mcp",
      },
      {
        type: "streamable-http",
        url: "http://localhost:8787/mcp/markets",
      },
      {
        type: "streamable-http",
        url: "http://localhost:8787/mcp/security",
      },
      {
        type: "streamable-http",
        url: "http://localhost:8787/mcp/all",
      },
    ]);
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
    expect(sitemapXml).toContain("<loc>http://localhost:8787/docs</loc>");
    expect(sitemapXml).toContain("<loc>http://localhost:8787/pricing</loc>");
    expect(sitemapXml).toContain("<loc>http://localhost:8787/about</loc>");
    expect(sitemapXml).toContain("<loc>http://localhost:8787/contact</loc>");
    expect(sitemapXml).toContain("<loc>http://localhost:8787/privacy</loc>");
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
      mcp: { package: string; registry_name: string; remote_url: string };
    };
    expect(jsonBody.service).toBe("ExactJSON");
    expect(jsonBody.version).toBe("1.2.0");
    expect(jsonBody.mcp.package).toBe("exactjson-mcp");
    expect(jsonBody.mcp.registry_name).toBe("io.github.exactjsondev/exactjson");
    expect(jsonBody.mcp.remote_url).toBe("http://localhost:8787/mcp");

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
    expect(htmlBrowser.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(htmlBrowser.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
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
    expect(html).toContain("<main id=\"main-content\">");
    expect(html).toContain("class=\"skip-link visually-hidden\"");
    expect(html).toContain("id=\"quickstart\"");
    expect(html).toContain("id=\"discovery\"");
    expect(html).toContain("@x402/fetch");
    expect(html).toContain("<details class=\"sample-details\">");
    expect(html).toContain("og-image.jpg");
    expect(html).toContain("apple-touch-icon.png");
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"ContactPoint"');
    expect(html).toContain('"sameAs"');
    expect(html).toContain('"@type":"Offer"');
    expect(html).toContain("minmax(0,");
    expect(html).toContain("Base Sepolia (eip155:84532)");

    // Markdown negotiation on GET / -> text/markdown with Vary: Accept
    const mdRoot = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "text/markdown" } },
      env
    );
    expect(mdRoot.status).toBe(200);
    expect(mdRoot.headers.get("content-type")).toContain("text/markdown");
    expect(mdRoot.headers.get("vary")).toContain("Accept");
    const mdRootText = await mdRoot.text();
    expect(mdRootText.startsWith("# ExactJSON")).toBe(true);
    expect(mdRootText).toContain("## When to Use ExactJSON");

    const mdOverHtml = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "text/markdown, text/html;q=0.9" } },
      env
    );
    expect(mdOverHtml.headers.get("content-type")).toContain("text/markdown");

    const htmlOverMd = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "text/html, text/markdown;q=0.5" } },
      env
    );
    expect(htmlOverMd.headers.get("content-type")).toContain("text/html");

    const jsonOverMd = await app.request(
      "http://localhost:8787/",
      { headers: { Accept: "application/json, text/markdown;q=0.5" } },
      env
    );
    expect(jsonOverMd.headers.get("content-type")).toContain("application/json");

    // Dedicated docs, pricing, and trust pages (HTML + Markdown negotiation)
    for (const pagePath of ["/docs", "/pricing", "/about", "/contact", "/privacy"]) {
      const htmlPage = await app.request(
        `http://localhost:8787${pagePath}`,
        { headers: { Accept: "text/html" } },
        env
      );
      expect(htmlPage.status, pagePath).toBe(200);
      expect(htmlPage.headers.get("content-type")).toContain("text/html");
      expect(htmlPage.headers.get("vary")).toContain("Accept");
      expect(htmlPage.headers.get("content-security-policy")).toContain("default-src 'none'");
      const body = await htmlPage.text();
      expect(body.length, pagePath).toBeGreaterThan(500);
      expect(body).toContain("apple-touch-icon.png");
      expect(body).toContain('property="og:title"');
      expect(body).toContain('property="og:image"');
      expect(body).toContain('name="twitter:card"');
      if (pagePath === "/docs") {
        expect(body).toContain("https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc");
      }

      const mdPage = await app.request(
        `http://localhost:8787${pagePath}`,
        { headers: { Accept: "text/markdown" } },
        env
      );
      expect(mdPage.status, `${pagePath} md`).toBe(200);
      expect(mdPage.headers.get("content-type")).toContain("text/markdown");
      expect((await mdPage.text()).startsWith("# ")).toBe(true);
    }

    // CORS on / (JSON), /health, and /llms-full.txt alias
    expect(jsonDefault.headers.get("access-control-allow-origin")).toBe("*");
    const healthCors = await app.request("http://localhost:8787/health", {}, env);
    expect(healthCors.headers.get("access-control-allow-origin")).toBe("*");
    const llmsFull = await app.request("http://localhost:8787/llms-full.txt", {}, env);
    expect(llmsFull.status).toBe(200);
    expect(llmsFull.headers.get("access-control-allow-origin")).toBe("*");
    expect(await llmsFull.text()).toContain("## Paid Endpoints");
  });

  it("returns 405 Method Not Allowed on wrong HTTP method for known /v1/* routes and branded 404s for unknown paths", async () => {
    const { db } = createMockDb(false);
    const env = makeEnv(db);

    const postRes = await app.request(
      "http://localhost:8787/v1/perps/snapshot?coin=BTC",
      { method: "POST" },
      env
    );
    expect(postRes.status).toBe(405);
    expect(postRes.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    const postBody = (await postRes.json()) as { error: string; endpoint: string };
    expect(postBody.error).toBe("METHOD_NOT_ALLOWED");
    expect(postBody.endpoint).toBe("/v1/perps/snapshot");

    // Browser unknown path -> branded HTML 404 with strict CSP
    const html404 = await app.request(
      "http://localhost:8787/this-route-does-not-exist",
      { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } },
      env
    );
    expect(html404.status).toBe(404);
    expect(html404.headers.get("content-type")).toContain("text/html");
    expect(html404.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html404Body = await html404.text();
    expect(html404Body).toContain("Page not found");
    expect(html404Body).toContain("Go to ExactJSON Docs");

    // Agent Markdown unknown path -> 404 text/markdown with docs/llms/sitemap links
    const md404 = await app.request(
      "http://localhost:8787/this-route-does-not-exist",
      { headers: { Accept: "text/markdown" } },
      env
    );
    expect(md404.status).toBe(404);
    expect(md404.headers.get("content-type")).toContain("text/markdown");
    expect(md404.headers.get("vary")).toContain("Accept");
    const md404Body = await md404.text();
    expect(md404Body).toContain("http://localhost:8787/docs");
    expect(md404Body).toContain("http://localhost:8787/llms.txt");
    expect(md404Body).toContain("http://localhost:8787/sitemap.xml");

    // API/agent unknown path -> structured JSON 404 with discovery links
    const json404 = await app.request("http://localhost:8787/v1/does-not-exist", {}, env);
    expect(json404.status).toBe(404);
    expect(json404.headers.get("content-type")).toContain("application/json");
    const json404Body = (await json404.json()) as {
      error: string;
      discovery: { openapi: string; x402: string };
    };
    expect(json404Body.error).toBe("NOT_FOUND");
    expect(json404Body.discovery.openapi).toBe("http://localhost:8787/openapi.json");
    expect(json404Body.discovery.x402).toBe("http://localhost:8787/.well-known/x402");
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
      resolve(process.cwd(), "src/routes/mcp.ts"),
      resolve(process.cwd(), "src/lib/mcpTools.ts"),
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

    // Oversized JSON body on /dashboard/api/control must return 413 PAYLOAD_TOO_LARGE
    const hugeControlBody = JSON.stringify({ paused: false, pad: "x".repeat(5000) });
    const hugeControlRes = await app.request(
      "http://localhost:8787/dashboard/api/control",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DASHBOARD_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: hugeControlBody,
      },
      env
    );
    expect(hugeControlRes.status).toBe(413);
    expect(((await hugeControlRes.json()) as { error: string }).error).toBe("PAYLOAD_TOO_LARGE");

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

    // Trailing slash matches Hono route cleanly (strict: false parity with x402 & getEndpointByPath)
    const healthSlash = await app.request("http://localhost:8787/health/", {}, env);
    expect(healthSlash.status).toBe(200);
    const pausedSlash = await app.request("http://localhost:8787/v1/perps/snapshot/?coin=BTC", {}, env);
    expect(pausedSlash.status).toBe(503);
  });

  it("classifies telemetry outcomes deterministically", () => {
    expect(classifyOutcome(402, false, null)).toBe("CHALLENGED_402");
    expect(classifyOutcome(402, true, null)).toBe("VERIFY_FAILED");
    expect(
      classifyOutcome(402, true, { success: false, errorReason: "insufficient_funds" })
    ).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(200, true, { success: true, transaction: "0xabc" })).toBe("SETTLED");
    expect(classifyOutcome(200, true, { success: false })).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(400, true, null)).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(502, true, null)).toBe("UNSETTLED_ERROR");
    expect(classifyOutcome(503, false, null)).toBe("UNSETTLED_ERROR");
  });

  it("extracts telemetry error reasons and classifies facilitator init failures", () => {
    expect(
      extractTelemetryError("FACILITATOR_INIT_429", "UNSETTLED_ERROR", null, null)
    ).toBe("FACILITATOR_INIT_429");
    expect(
      extractTelemetryError(
        null,
        "UNSETTLED_ERROR",
        { success: false, errorReason: "insufficient_balance" },
        null
      )
    ).toBe("insufficient_balance");
    expect(
      extractTelemetryError(null, "VERIFY_FAILED", null, { error: "Payment required" })
    ).toBe("MALFORMED_PAYMENT_HEADER");
    expect(
      extractTelemetryError(null, "VERIFY_FAILED", null, { error: "invalid_signature" })
    ).toBe("invalid_signature");
    expect(
      extractTelemetryError(null, "CHALLENGED_402", null, { error: "Payment required" })
    ).toBeNull();

    expect(classifyFacilitatorInitError(new Error("Request timed out after 5000ms"))).toBe(
      "FACILITATOR_INIT_TIMEOUT"
    );
    expect(classifyFacilitatorInitError(Object.assign(new Error("Auth failed"), { status: 401 }))).toBe(
      "FACILITATOR_INIT_401"
    );
    expect(classifyFacilitatorInitError(new Error("HTTP 403 Forbidden"))).toBe(
      "FACILITATOR_INIT_403"
    );
    expect(classifyFacilitatorInitError(new Error("429 Too Many Requests"))).toBe(
      "FACILITATOR_INIT_429"
    );
    expect(classifyFacilitatorInitError(new Error("Facilitator returned 503"))).toBe(
      "FACILITATOR_INIT_5XX"
    );
    expect(classifyFacilitatorInitError(new Error("unexpected socket reset"))).toBe(
      "FACILITATOR_INIT_ERROR"
    );
    expect(
      classifyFacilitatorInitError(
        new Error("Failed to initialize: no supported payment kinds loaded from any facilitator.", {
          cause: new Error("HTTP 401 Unauthorized"),
        })
      )
    ).toBe("FACILITATOR_INIT_401");
    expect(
      classifyFacilitatorInitError(
        new Error("Failed to initialize: no supported payment kinds loaded from any facilitator.", {
          cause: Object.assign(new Error("boom"), { status: 429 }),
        })
      )
    ).toBe("FACILITATOR_INIT_429");
    expect(
      classifyFacilitatorInitError(
        new Error("Failed to initialize: no supported payment kinds loaded from any facilitator.", {
          cause: new Error("fetch timed out"),
        })
      )
    ).toBe("FACILITATOR_INIT_TIMEOUT");
  });

  it("includes verify_failed_count in /dashboard/api/overview and bypasses stale service_control cache on refresh=1 and /control", async () => {
    isolateCache.clear();
    let dbPaused = 0;
    const overviewDb = {
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first<T>() {
            if (sql.includes("FROM service_control")) {
              return { paused: dbPaused, updated_at: "2026-11-26T00:00:00.000Z" } as T;
            }
            return null as T;
          },
          async all<T>() {
            return {
              results: [
                {
                  endpoint: "/v1/perps/snapshot",
                  total_requests: 5,
                  settled_count: 1,
                  revenue_usd: 0.005,
                  challenged_count: 2,
                  verify_failed_count: 1,
                  error_count: 1,
                  sum_latency_ms: 500,
                  avg_latency_ms: 100,
                  total_requests_24h: 5,
                  settled_count_24h: 1,
                  revenue_usd_24h: 0.005,
                  challenged_count_24h: 2,
                  verify_failed_count_24h: 1,
                  error_count_24h: 1,
                  mcp_requests: 0,
                  mcp_settled: 0,
                  mcp_requests_24h: 0,
                  mcp_settled_24h: 0,
                },
              ] as T[],
            };
          },
        };
      },
    } as unknown as D1Database;

    const env = makeEnv(overviewDb);
    const firstOverview = await app.request(
      "http://localhost:8787/dashboard/api/overview",
      { headers: { Authorization: `Bearer ${env.DASHBOARD_TOKEN}` } },
      env
    );
    expect(firstOverview.status).toBe(200);
    const firstBody = (await firstOverview.json()) as {
      control: { paused: boolean };
      by_endpoint: Array<{ endpoint: string; verify_failed_count: number }>;
    };
    expect(firstBody.control.paused).toBe(false);
    expect(firstBody.by_endpoint[0]?.verify_failed_count).toBe(1);

    // Simulate another isolate flipping service_control in D1 while this isolate's cache still has paused=false
    dbPaused = 1;

    const controlRes = await app.request(
      "http://localhost:8787/dashboard/api/control",
      { headers: { Authorization: `Bearer ${env.DASHBOARD_TOKEN}` } },
      env
    );
    expect(controlRes.status).toBe(200);
    expect(((await controlRes.json()) as { paused: boolean }).paused).toBe(true);

    // Reset cache back to stale false and verify ?refresh=1 bypasses both overview and pause caches
    isolateCache.set("service_control:state", { paused: false, updated_at: null }, 60_000);
    const refreshedOverview = await app.request(
      "http://localhost:8787/dashboard/api/overview?refresh=1",
      { headers: { Authorization: `Bearer ${env.DASHBOARD_TOKEN}` } },
      env
    );
    expect(refreshedOverview.status).toBe(200);
    expect(((await refreshedOverview.json()) as { control: { paused: boolean } }).control.paused).toBe(
      true
    );
  });

  it("prunes both CHALLENGED_402 and VERIFY_FAILED rows without touching SETTLED", async () => {
    const boundCalls: unknown[][] = [];
    const mockDb = {
      prepare(sql: string) {
        let args: unknown[] = [];
        return {
          bind(...params: unknown[]) {
            args = params;
            boundCalls.push(params);
            return this;
          },
          async run() {
            expect(sql).toContain("DELETE FROM api_requests");
            expect(sql).toContain("WHERE outcome = ? AND created_at < ?");
            return { meta: { changes: args[0] === "CHALLENGED_402" ? 42 : 7 } };
          },
        };
      },
    } as unknown as D1Database;

    const totalDeleted = await pruneOldChallengedRequests(mockDb);
    expect(totalDeleted).toBe(49);
    expect(boundCalls.map((b) => b[0])).toEqual(["CHALLENGED_402", "VERIFY_FAILED"]);
  });

  it("sets Cache-Control: no-cache and strict script-src 'self' CSP on /dashboard, caches apple-touch-icon.png, and uses external app.js", () => {
    const headersFile = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");
    expect(headersFile).toMatch(/\/dashboard\r?\n\s+Cache-Control:\s*no-cache/);
    expect(headersFile).toMatch(/\/dashboard\/app\.js\r?\n\s+Cache-Control:\s*no-cache/);
    expect(headersFile).toMatch(/\/dashboard\/\*\r?\n\s+Cache-Control:\s*no-cache/);
    expect(headersFile).toContain("script-src 'self'; style-src");
    expect(headersFile).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(headersFile).toContain("Strict-Transport-Security: max-age=31536000; includeSubDomains");
    expect(headersFile).toMatch(/\/apple-touch-icon\.png\r?\n\s+Cache-Control:\s*public, max-age=86400/);

    const appleIcon = readFileSync(resolve(process.cwd(), "public/apple-touch-icon.png"));
    expect(Array.from(appleIcon.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const dashboardHtml = readFileSync(
      resolve(process.cwd(), "public/dashboard/index.html"),
      "utf8"
    );
    expect(dashboardHtml).toContain("<th>Verify Failed</th>");
    expect(dashboardHtml).toContain('<script src="/dashboard/app.js" defer></script>');
    expect(dashboardHtml).not.toContain("<script>");

    const dashboardAppJs = readFileSync(
      resolve(process.cwd(), "public/dashboard/app.js"),
      "utf8"
    );
    expect(dashboardAppJs).toContain("verify_failed_count");
    expect(dashboardAppJs).toContain("loadRequestsOnly");
  });
});
