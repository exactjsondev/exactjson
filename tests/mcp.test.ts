import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOG, type EndpointCatalogEntry, getPackEndpoints, PACKS } from "../src/config/catalog";
import app from "../src/index";
import { decodeBase64Json, encodeBase64Json } from "../src/lib/headers";
import { detectRequestTransport } from "../src/lib/transport";
import { clearServiceControlCache } from "../src/middleware/serviceControl";
import { createMcpHandler } from "../src/routes/mcp";
import type { AppBindings, Env } from "../src/types";

function createMockDb(initialPaused = false) {
  let paused = initialPaused ? 1 : 0;
  let updatedAt = "2026-11-25T00:00:00.000Z";
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
          return null as T;
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

async function rpcCall(
  body: unknown,
  env: Env,
  headers: Record<string, string> = {},
  targetApp: { request: typeof app.request } = app,
) {
  return targetApp.request(
    "http://localhost:8787/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

describe("Remote Streamable HTTP /mcp endpoint & x402 MCP wire contract", () => {
  beforeEach(() => {
    clearServiceControlCache();
  });

  it("handles initialize, notifications/initialized, ping, and tools/list cleanly", async () => {
    const { db, insertedRows } = createMockDb(false);
    const env = makeEnv(db);

    const initRes = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      },
      env,
    );
    expect(initRes.status).toBe(200);
    expect(initRes.headers.get("mcp-protocol-version")).toBe("2025-03-26");
    expect(initRes.headers.get("cache-control")).toBe("no-store");
    const initJson = (await initRes.json()) as {
      jsonrpc: string;
      id: number;
      result: {
        protocolVersion: string;
        capabilities: { tools: { listChanged: boolean } };
        serverInfo: { name: string; version: string };
        instructions: string;
      };
    };
    expect(initJson.id).toBe(1);
    expect(initJson.result.protocolVersion).toBe("2025-03-26");
    expect(initJson.result.serverInfo.name).toBe("io.github.exactjsondev/exactjson");
    expect(initJson.result.serverInfo.version).toBe("1.5.0");
    expect(initJson.result.instructions).toContain("https://exactjson.com/mcp");

    const notifRes = await rpcCall({ jsonrpc: "2.0", method: "notifications/initialized" }, env);
    expect(notifRes.status).toBe(202);
    expect(await notifRes.text()).toBe("");

    const pingRes = await rpcCall({ jsonrpc: "2.0", id: "p-1", method: "ping" }, env);
    expect(pingRes.status).toBe(200);
    expect(await pingRes.json()).toEqual({ jsonrpc: "2.0", id: "p-1", result: {} });

    const listRes = await rpcCall({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env);
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: { properties: Record<string, { type?: string }> };
          annotations: { readOnlyHint: boolean; destructiveHint: boolean };
        }>;
      };
    };
    expect(listJson.result.tools.length).toBe(1 + getPackEndpoints(["markets"]).length);
    expect(listJson.result.tools[0]?.name).toBe("exactjson_health");
    expect(listJson.result.tools[0]?.annotations.readOnlyHint).toBe(true);
    expect(listJson.result.tools[0]?.annotations.destructiveHint).toBe(false);

    const screener = listJson.result.tools.find((t) => t.name === "exactjson_perps_screener");
    expect(screener?.inputSchema.properties.limit?.type).toBe("integer");
    expect(screener?.inputSchema.properties.min_oi_usd?.type).toBe("number");

    const healthRes = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "exactjson_health", arguments: {} },
      },
      env,
    );
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as {
      result: {
        isError: boolean;
        structuredContent: { status: string; version: string };
      };
    };
    expect(healthJson.result.isError).toBe(false);
    expect(healthJson.result.structuredContent.status).toBe("ok");
    expect(healthJson.result.structuredContent.version).toBe("1.5.0");

    // Free MCP routes must never write paid /v1/* telemetry rows
    await new Promise((r) => setTimeout(r, 10));
    expect(insertedRows.length).toBe(0);
  });

  it("enforces JSON-RPC validation, 405 for GET/DELETE, and CORS preflight headers", async () => {
    const { db } = createMockDb(false);
    const env = makeEnv(db);

    const parseErr = await rpcCall("{bad json", env);
    expect(parseErr.status).toBe(400);
    expect(((await parseErr.json()) as { error: { code: number } }).error.code).toBe(-32700);

    const batchErr = await rpcCall([{ jsonrpc: "2.0", id: 1, method: "ping" }], env);
    expect(batchErr.status).toBe(400);
    expect(((await batchErr.json()) as { error: { code: number } }).error.code).toBe(-32600);

    const unknownMethod = await rpcCall({ jsonrpc: "2.0", id: 9, method: "prompts/list" }, env);
    expect(unknownMethod.status).toBe(200);
    expect(((await unknownMethod.json()) as { error: { code: number } }).error.code).toBe(-32601);

    const unknownTool = await rpcCall(
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "nope", arguments: {} } },
      env,
    );
    expect(unknownTool.status).toBe(200);
    expect(((await unknownTool.json()) as { error: { code: number } }).error.code).toBe(-32602);

    const badArgs = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "exactjson_perps_snapshot", arguments: ["BTC"] },
      },
      env,
    );
    expect(badArgs.status).toBe(200);
    expect(((await badArgs.json()) as { error: { code: number } }).error.code).toBe(-32602);

    // Missing required parameter and non-scalar argument values reject with -32602 before x402 challenge
    const missingReqArg = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 111,
        method: "tools/call",
        params: { name: "exactjson_solana_safety", arguments: {} },
      },
      env,
    );
    expect(missingReqArg.status).toBe(200);
    expect(((await missingReqArg.json()) as { error: { code: number } }).error.code).toBe(-32602);

    const nestedObjArg = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 112,
        method: "tools/call",
        params: { name: "exactjson_perps_snapshot", arguments: { coin: { bad: 1 } } },
      },
      env,
    );
    expect(nestedObjArg.status).toBe(200);
    expect(((await nestedObjArg.json()) as { error: { code: number } }).error.code).toBe(-32602);

    const getRes = await app.request("http://localhost:8787/mcp", { method: "GET" }, env);
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get("allow")).toContain("POST");
    expect(getRes.headers.get("content-type")).toContain("application/json");

    // Browser GET /mcp returns a helpful 405 HTML guide with strict CSP while keeping Allow: POST, OPTIONS
    const getHtmlRes = await app.request(
      "http://localhost:8787/mcp",
      {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      },
      env,
    );
    expect(getHtmlRes.status).toBe(405);
    expect(getHtmlRes.headers.get("allow")).toContain("POST");
    expect(getHtmlRes.headers.get("content-type")).toContain("text/html");
    expect(getHtmlRes.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await getHtmlRes.text()).toContain("Streamable HTTP MCP endpoint");

    const delRes = await app.request("http://localhost:8787/mcp", { method: "DELETE" }, env);
    expect(delRes.status).toBe(405);

    // Oversized JSON-RPC body must return 413 (both with Content-Length and streaming without Content-Length)
    const oversizedPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "ping",
      params: { pad: "a".repeat(17_000) },
    });
    const tooBigRes = await rpcCall(oversizedPayload, env);
    expect(tooBigRes.status).toBe(413);
    expect(((await tooBigRes.json()) as { error: { code: number } }).error.code).toBe(-32600);

    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(oversizedPayload);
        controller.enqueue(bytes.subarray(0, 9_000));
        controller.enqueue(bytes.subarray(9_000));
        controller.close();
      },
    });
    const streamReq = new Request("http://localhost:8787/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: streamBody,
      // @ts-expect-error duplex required by Node Request for ReadableStream bodies
      duplex: "half",
    });
    const streamTooBigRes = await app.fetch(streamReq, env);
    expect(streamTooBigRes.status).toBe(413);

    const optRes = await app.request(
      "http://localhost:8787/mcp",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://smithery.ai",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get("access-control-expose-headers")).toContain("PAYMENT-REQUIRED");
    expect(optRes.headers.get("access-control-expose-headers")).toContain("Mcp-Protocol-Version");
  });

  it("verifies full x402 V2 MCP wire contract (402 challenge -> _meta['x402/payment'] -> 200 _meta['x402/payment-response'] & Pay-Only-On-Success)", async () => {
    const { db } = createMockDb(false);
    const env = makeEnv(db);
    const seenRequests: Array<{ url: string; transport: string; sig: string | null }> = [];

    const testApp = new Hono<AppBindings>();
    const { mcpPostHandler } = createMcpHandler(async (req) => {
      const transport = detectRequestTransport(req);
      const sig = req.headers.get("PAYMENT-SIGNATURE");
      seenRequests.push({ url: req.url, transport, sig });

      if (req.url.includes("coin=FAILSETTLE")) {
        const failReceipt = {
          success: false,
          network: "eip155:8453",
          payer: "0x2222222222222222222222222222222222222222",
          transaction: "",
          errorReason: "insufficient_funds",
        };
        return new Response(JSON.stringify({}), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-RESPONSE": encodeBase64Json(failReceipt),
          },
        });
      }

      if (req.url.includes("coin=BAD")) {
        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!sig) {
        const paymentRequired = {
          x402Version: 2,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:8453",
              amount: "5000",
              payTo: "0x289e67a574a504f06e0C1145007DC469Caf8Bcaf",
            },
          ],
        };
        return new Response(JSON.stringify(paymentRequired), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-REQUIRED": encodeBase64Json(paymentRequired),
          },
        });
      }

      const decodedSig = decodeBase64Json<{ x402Version: number; payload: { sig: string } }>(sig);
      expect(decodedSig).toEqual({ x402Version: 2, payload: { sig: "0xsigned" } });

      const receipt = {
        success: true,
        network: "eip155:8453",
        payer: "0x2222222222222222222222222222222222222222",
        transaction: "0xdeadbeef",
      };
      return new Response(JSON.stringify({ coin: "BTC", funding: { regime: "POSITIVE" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-RESPONSE": encodeBase64Json(receipt),
        },
      });
    });

    testApp.post("/mcp", mcpPostHandler);

    // 1. Unpaid call returns isError: true + PaymentRequired in structuredContent
    const unpaidRes = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { name: "exactjson_perps_snapshot", arguments: { coin: "BTC" } },
      },
      env,
      {},
      testApp,
    );
    expect(unpaidRes.status).toBe(200);
    const unpaidJson = (await unpaidRes.json()) as {
      result: {
        isError: boolean;
        structuredContent: { x402Version: number; accepts: Array<{ network: string }> };
        content: Array<{ text: string }>;
      };
    };
    expect(unpaidJson.result.isError).toBe(true);
    expect(unpaidJson.result.structuredContent.x402Version).toBe(2);
    expect(unpaidJson.result.structuredContent.accepts[0]?.network).toBe("eip155:8453");
    expect(JSON.parse(unpaidJson.result.content[0]!.text).x402Version).toBe(2);

    // 2. Retried call with _meta["x402/payment"] object encodes to PAYMENT-SIGNATURE and returns _meta["x402/payment-response"]
    const paidRes = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "exactjson_perps_snapshot",
          arguments: { coin: "BTC" },
          _meta: {
            "x402/payment": { x402Version: 2, payload: { sig: "0xsigned" } },
          },
        },
      },
      env,
      {},
      testApp,
    );
    expect(paidRes.status).toBe(200);
    const paidJson = (await paidRes.json()) as {
      result: {
        isError: boolean;
        structuredContent: { coin: string };
        _meta?: { "x402/payment-response"?: { success: boolean; transaction: string } };
      };
    };
    expect(paidJson.result.isError).toBe(false);
    expect(paidJson.result.structuredContent.coin).toBe("BTC");
    expect(paidJson.result._meta?.["x402/payment-response"]?.success).toBe(true);
    expect(paidJson.result._meta?.["x402/payment-response"]?.transaction).toBe("0xdeadbeef");

    // 3. Unsettled 404 returns isError: true with NO _meta["x402/payment-response"]
    const errRes = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: { name: "exactjson_perps_snapshot", arguments: { coin: "BAD" } },
      },
      env,
      {},
      testApp,
    );
    const errJson = (await errRes.json()) as {
      result: {
        isError: boolean;
        structuredContent?: { error: string };
        _meta?: unknown;
      };
    };
    expect(errJson.result.isError).toBe(true);
    expect(errJson.result.structuredContent).toEqual({ error: "NOT_FOUND" });
    expect(errJson.result._meta).toBeUndefined();

    // 4. Settlement failure returning 402 + PAYMENT-RESPONSE + "{}" body returns errorReason & _meta (not empty "{}")
    const settleFailRes = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: {
          name: "exactjson_perps_snapshot",
          arguments: { coin: "FAILSETTLE" },
          _meta: {
            "x402/payment": { x402Version: 2, payload: { sig: "0xsigned" } },
          },
        },
      },
      env,
      {},
      testApp,
    );
    const settleFailJson = (await settleFailRes.json()) as {
      result: {
        isError: boolean;
        structuredContent: { error: string; payment_response?: { errorReason?: string } };
        _meta?: { "x402/payment-response"?: { success: boolean; errorReason?: string } };
      };
    };
    expect(settleFailJson.result.isError).toBe(true);
    expect(settleFailJson.result.structuredContent.error).toBe("insufficient_funds");
    expect(settleFailJson.result._meta?.["x402/payment-response"]?.success).toBe(false);
    expect(settleFailJson.result._meta?.["x402/payment-response"]?.errorReason).toBe(
      "insufficient_funds",
    );

    expect(seenRequests.every((r) => r.transport === "mcp")).toBe(true);
  });

  it("tags internal /mcp -> /v1/* telemetry as transport='mcp' and prevents external header spoofing", async () => {
    const { db, insertedRows } = createMockDb(true);
    const env = makeEnv(db);

    // 1. MCP paid tool call hitting real app.fetch -> serviceControlMiddleware 503 -> telemetryMiddleware
    const mcpBlocked = await rpcCall(
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "exactjson_perps_snapshot",
          arguments: { coin: "BTC" },
        },
      },
      env,
    );
    expect(mcpBlocked.status).toBe(200);
    const mcpJson = (await mcpBlocked.json()) as {
      result: { isError: boolean; content: Array<{ text: string }>; _meta?: unknown };
    };
    expect(mcpJson.result.isError).toBe(true);
    expect(mcpJson.result.content[0]?.text).toContain("SERVICE_PAUSED");
    expect(mcpJson.result._meta).toBeUndefined();

    // 2. Direct HTTP request attempting to spoof a custom transport header must still log 'http'
    const httpBlocked = await app.request(
      "http://localhost:8787/v1/perps/snapshot?coin=BTC",
      {
        headers: {
          "X-ExactJSON-Transport": "mcp",
          "X-Transport": "mcp",
        },
      },
      env,
    );
    expect(httpBlocked.status).toBe(503);

    await new Promise((r) => setTimeout(r, 15));
    expect(insertedRows.length).toBe(2);
    // transport is the 16th bound parameter (index 15) in telemetryMiddleware
    expect(insertedRows[0]?.[15]).toBe("mcp");
    expect(insertedRows[1]?.[15]).toBe("http");
  });

  it("supports /mcp/:pack, ?pack=, /mcp/all, CORS on /mcp/*, empty/unknown pack 404s, and cross-pack tools/call hints", async () => {
    const { db } = createMockDb(false);
    const env = makeEnv(db);

    // 1. Live app: /mcp/markets, /mcp?pack=markets, and /mcp/all work with CORS preflight on /mcp/*
    const marketsRes = await app.request(
      "http://localhost:8787/mcp/markets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      env,
    );
    expect(marketsRes.status).toBe(200);
    const marketsJson = (await marketsRes.json()) as { result: { tools: Array<{ name: string }> } };
    expect(marketsJson.result.tools.length).toBe(1 + getPackEndpoints(["markets"]).length);

    const allRes = await app.request(
      "http://localhost:8787/mcp/all",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      },
      env,
    );
    expect(allRes.status).toBe(200);
    const allJson = (await allRes.json()) as { result: { tools: Array<{ name: string }> } };
    expect(allJson.result.tools.length).toBe(1 + CATALOG.length);

    const optPackRes = await app.request(
      "http://localhost:8787/mcp/markets",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://glama.ai",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );
    expect(optPackRes.status).toBe(204);
    expect(optPackRes.headers.get("access-control-expose-headers")).toContain(
      "Mcp-Protocol-Version",
    );

    // Browser GET /mcp/all returns pack-aware 405 HTML guide
    const getAllHtml = await app.request(
      "http://localhost:8787/mcp/all",
      {
        method: "GET",
        headers: { Accept: "text/html" },
      },
      env,
    );
    expect(getAllHtml.status).toBe(405);
    expect(await getAllHtml.text()).toContain("/mcp/all");

    // 2. Live vertical MCP packs stay within MAX_MCP_TOOLS_PER_PACK, while unknown packs return 404 JSON-RPC errors
    const liveSecurityRes = await app.request(
      "http://localhost:8787/mcp/security",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 30, method: "tools/list" }),
      },
      env,
    );
    expect(liveSecurityRes.status).toBe(200);
    const liveSecurityJson = (await liveSecurityRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(liveSecurityJson.result.tools.length).toBe(1 + getPackEndpoints(["security"]).length);
    expect(liveSecurityJson.result.tools.length).toBe(8);

    const liveWorldRes = await app.request(
      "http://localhost:8787/mcp/world",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 31, method: "tools/list" }),
      },
      env,
    );
    expect(liveWorldRes.status).toBe(200);
    const liveWorldJson = (await liveWorldRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(liveWorldJson.result.tools.length).toBe(1 + getPackEndpoints(["world"]).length);
    expect(liveWorldJson.result.tools.length).toBe(6);

    const liveCommerceRes = await app.request(
      "http://localhost:8787/mcp/commerce",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 32, method: "tools/list" }),
      },
      env,
    );
    expect(liveCommerceRes.status).toBe(200);
    const liveCommerceJson = (await liveCommerceRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(liveCommerceJson.result.tools.length).toBe(1 + getPackEndpoints(["commerce"]).length);
    expect(liveCommerceJson.result.tools.length).toBe(5);

    const liveResearchRes = await app.request(
      "http://localhost:8787/mcp/research",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 33, method: "tools/list" }),
      },
      env,
    );
    expect(liveResearchRes.status).toBe(200);
    const liveResearchJson = (await liveResearchRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(liveResearchJson.result.tools.length).toBe(1 + getPackEndpoints(["research"]).length);
    expect(liveResearchJson.result.tools.length).toBe(4);

    const unknownPackRes = await app.request(
      "http://localhost:8787/mcp?pack=nonexistent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
      },
      env,
    );
    expect(unknownPackRes.status).toBe(404);
    expect(
      ((await unknownPackRes.json()) as { error: { message: string } }).error.message,
    ).toContain("Unknown MCP pack");

    const conflictRes = await app.request(
      "http://localhost:8787/mcp/markets?pack=all",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
      },
      env,
    );
    expect(conflictRes.status).toBe(400);

    // Whitespace-only /mcp/%20 or /mcp/%20?pack=all must return 404 Unknown MCP pack (never fall back to markets)
    const wsPathRes = await app.request(
      "http://localhost:8787/mcp/%20?pack=all",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }),
      },
      env,
    );
    expect(wsPathRes.status).toBe(404);
    expect(((await wsPathRes.json()) as { error: { message: string } }).error.message).toContain(
      "Unknown MCP pack",
    );

    // 3. Multi-pack synthetic fixture verifies pack isolation, ?pack=a,b union, and cross-pack tools/call hint
    const mockSecurityEntry: EndpointCatalogEntry = {
      ...CATALOG[0]!,
      id: "solana_safety",
      pack: "security",
      path: "/v1/solana/safety",
      description: `Synthetic security pack fixture. Do NOT use for other things. ${PACKS.security.disclaimer}`,
    };
    const multiCatalog: readonly EndpointCatalogEntry[] = [
      CATALOG[2]!, // perps_snapshot (markets)
      mockSecurityEntry, // security
    ];

    const multiApp = new Hono<AppBindings>();
    const { mcpPostHandler, mcpMethodNotAllowedHandler } = createMcpHandler(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      { catalogEntries: multiCatalog },
    );
    multiApp.post("/mcp", mcpPostHandler);
    multiApp.post("/mcp/:pack", mcpPostHandler);
    multiApp.all("/mcp", mcpMethodNotAllowedHandler);
    multiApp.all("/mcp/:pack", mcpMethodNotAllowedHandler);

    const secListRes = await multiApp.request(
      "http://localhost:8787/mcp/security",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }),
      },
      env,
    );
    expect(secListRes.status).toBe(200);
    const secTools = (
      (await secListRes.json()) as { result: { tools: Array<{ name: string }> } }
    ).result.tools.map((t) => t.name);
    expect(secTools).toEqual(["exactjson_health", "exactjson_solana_safety"]);

    const unionListRes = await multiApp.request(
      "http://localhost:8787/mcp?pack=markets,security",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/list" }),
      },
      env,
    );
    expect(unionListRes.status).toBe(200);
    const unionTools = (
      (await unionListRes.json()) as { result: { tools: Array<{ name: string }> } }
    ).result.tools.map((t) => t.name);
    expect(unionTools).toEqual([
      "exactjson_health",
      "exactjson_perps_snapshot",
      "exactjson_solana_safety",
    ]);

    // Calling security tool on /mcp (default markets) rejects with -32602 and redirects to /mcp/security or /mcp/all
    const crossPackCall = await multiApp.request(
      "http://localhost:8787/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 12,
          method: "tools/call",
          params: {
            name: "exactjson_solana_safety",
            arguments: { mint: "So11111111111111111111111111111111111111112" },
          },
        }),
      },
      env,
    );
    expect(crossPackCall.status).toBe(200);
    const crossPackErr = (await crossPackCall.json()) as {
      error: { code: number; message: string };
    };
    expect(crossPackErr.error.code).toBe(-32602);
    expect(crossPackErr.error.message).toContain("belongs to pack 'security'");
    expect(crossPackErr.error.message).toContain("http://localhost:8787/mcp/security");

    // Unpopulated pack in custom catalog fixture still returns 404 with '0 active endpoints'
    const emptyFixtureRes = await multiApp.request(
      "http://localhost:8787/mcp/research",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 13, method: "tools/list" }),
      },
      env,
    );
    expect(emptyFixtureRes.status).toBe(404);
    expect(
      ((await emptyFixtureRes.json()) as { error: { message: string } }).error.message,
    ).toContain("0 active endpoints");
  });
});
