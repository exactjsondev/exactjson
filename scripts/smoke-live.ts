import { CATALOG, SERVICE_VERSION, getPackEndpoints } from "../src/config/catalog";
import { decodeBase64Json } from "../src/lib/headers";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function assert(cond: boolean, detail: string): void {
  if (!cond) {
    throw new Error(detail);
  }
}

async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const urlArg = process.argv
    .slice(2)
    .find((a: string) => a.startsWith("http://") || a.startsWith("https://"));
  const baseUrl = (urlArg ?? "https://exactjson.com").replace(/\/+$/, "");
  const results: CheckResult[] = [];

  results.push(
    await runCheck("GET /health", async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const json = (await res.json()) as { status?: string; version?: string; paused?: boolean };
      assert(json.status === "ok", `Unexpected status=${json.status}`);
      assert(json.version === SERVICE_VERSION, `Expected version=${SERVICE_VERSION}, got ${json.version}`);
      assert(json.paused === false, `Service is paused (${String(json.paused)})`);
      return `200 ok (v${json.version}, paused=false)`;
    })
  );

  results.push(
    await runCheck("GET / content negotiation & HTML security headers", async () => {
      const [htmlRes, mdRes, jsonRes] = await Promise.all([
        fetch(`${baseUrl}/`, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(10_000) }),
        fetch(`${baseUrl}/`, { headers: { Accept: "text/markdown" }, signal: AbortSignal.timeout(10_000) }),
        fetch(`${baseUrl}/`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }),
      ]);
      assert(htmlRes.status === 200, `HTML status=${htmlRes.status}`);
      assert((htmlRes.headers.get("content-type") ?? "").includes("text/html"), "Missing text/html");
      assert((htmlRes.headers.get("vary") ?? "").includes("Accept"), "Missing Vary: Accept");
      assert(
        Boolean(htmlRes.headers.get("strict-transport-security")),
        "Missing Strict-Transport-Security"
      );
      assert(Boolean(htmlRes.headers.get("permissions-policy")), "Missing Permissions-Policy");
      assert(htmlRes.headers.get("x-frame-options") === "DENY", "Missing X-Frame-Options: DENY");
      assert(
        (htmlRes.headers.get("content-security-policy") ?? "").includes("default-src 'none'"),
        "Missing strict CSP"
      );

      assert(mdRes.status === 200, `Markdown status=${mdRes.status}`);
      assert((mdRes.headers.get("content-type") ?? "").includes("text/markdown"), "Missing text/markdown");
      assert((mdRes.headers.get("vary") ?? "").includes("Accept"), "Missing Vary: Accept on markdown");

      assert(jsonRes.status === 200, `JSON status=${jsonRes.status}`);
      assert((jsonRes.headers.get("content-type") ?? "").includes("application/json"), "Missing application/json");
      return "HTML + Markdown + JSON + Vary + HSTS + CSP ok";
    })
  );

  const discoveryPaths = [
    "/.well-known/x402",
    "/.well-known/x402.json",
    "/.well-known/api-catalog",
    "/.well-known/mcp/server-card.json",
    "/.well-known/agent-card.json",
    "/openapi.json",
    "/llms.txt",
    "/sitemap.xml",
    "/robots.txt",
  ];

  results.push(
    await runCheck(`Discovery endpoints (${discoveryPaths.length})`, async () => {
      const responses = await Promise.all(
        discoveryPaths.map(async (path) => {
          const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
          return { path, status: res.status };
        })
      );
      const bad = responses.filter((r) => r.status !== 200);
      assert(bad.length === 0, `Non-200 discovery routes: ${JSON.stringify(bad)}`);
      return `${responses.length}/${responses.length} returned 200`;
    })
  );

  results.push(
    await runCheck("POST /mcp initialize, tools/list, and 413 body limit", async () => {
      const initRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1.0" } },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      assert(initRes.status === 200, `initialize status=${initRes.status}`);

      const listRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        signal: AbortSignal.timeout(10_000),
      });
      assert(listRes.status === 200, `tools/list status=${listRes.status}`);
      const expectedDefaultTools = getPackEndpoints(["markets"]).length + 1;
      const listJson = (await listRes.json()) as { result?: { tools?: unknown[] } };
      const toolCount = listJson.result?.tools?.length ?? 0;
      assert(
        toolCount === expectedDefaultTools,
        `Expected ${expectedDefaultTools} default MCP tools on /mcp, got ${toolCount}`
      );

      const allRes = await fetch(`${baseUrl}/mcp/all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
        signal: AbortSignal.timeout(10_000),
      });
      assert(allRes.status === 200, `/mcp/all tools/list status=${allRes.status}`);
      const allJson = (await allRes.json()) as { result?: { tools?: unknown[] } };
      const allToolCount = allJson.result?.tools?.length ?? 0;
      assert(
        allToolCount === CATALOG.length + 1,
        `Expected ${CATALOG.length + 1} MCP tools on /mcp/all, got ${allToolCount}`
      );

      const hugeRes = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: { pad: "x".repeat(18_000) } }),
        signal: AbortSignal.timeout(10_000),
      });
      assert(hugeRes.status === 413, `Expected 413 on oversized MCP body, got ${hugeRes.status}`);
      return `${toolCount} tools, 413 limit enforced`;
    })
  );

  results.push(
    await runCheck(`All ${CATALOG.length} /v1/* endpoints return 402 + PAYMENT-REQUIRED`, async () => {
      const checks = await Promise.all(
        CATALOG.map(async (entry) => {
          const qs = new URLSearchParams(entry.exampleQueryParams).toString();
          const res = await fetch(`${baseUrl}${entry.path}?${qs}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          const header = res.headers.get("PAYMENT-REQUIRED");
          const decoded = decodeBase64Json<{ x402Version?: number; accepts?: unknown[] }>(header);
          return {
            path: entry.path,
            status: res.status,
            cacheControl: res.headers.get("cache-control"),
            validHeader: Boolean(decoded && decoded.x402Version === 2 && (decoded.accepts?.length ?? 0) > 0),
          };
        })
      );
      const failed = checks.filter(
        (c) => c.status !== 402 || c.cacheControl !== "no-store" || !c.validHeader
      );
      assert(failed.length === 0, `Invalid 402 responses: ${JSON.stringify(failed)}`);
      return `${checks.length}/${checks.length} returned 402 + x402 V2 terms`;
    })
  );

  results.push(
    await runCheck("Dashboard auth boundary & strict CSP", async () => {
      const apiRes = await fetch(`${baseUrl}/dashboard/api/overview`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert(apiRes.status === 401, `Expected 401 on unauth /dashboard/api/overview, got ${apiRes.status}`);

      const htmlRes = await fetch(`${baseUrl}/dashboard`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert(htmlRes.status === 200, `Expected 200 on /dashboard, got ${htmlRes.status}`);
      const csp = htmlRes.headers.get("content-security-policy") ?? "";
      assert(csp.includes("script-src 'self'"), `Expected strict script-src 'self', got: ${csp}`);
      assert(!csp.includes("script-src 'self' 'unsafe-inline'"), "Dashboard CSP still allows unsafe-inline scripts");
      return "401 auth gate + strict script-src 'self' ok";
    })
  );

  let failures = 0;
  console.log(`\nExactJSON $0 Live Smoke Check -> ${baseUrl}\n`);
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.name}: ${r.detail}`);
    if (!r.ok) failures += 1;
  }
  console.log(`\nSummary: ${results.length - failures}/${results.length} checks passed ($0.00 spent).`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Smoke check crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
