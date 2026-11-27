import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG, getPackEndpoints } from "../src/config/catalog";

const ROOT = process.cwd();

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  new RegExp(["x402", "ti"].join(""), "i"),
  new RegExp(["x042", "ti"].join(""), "i"),
  new RegExp(["signal", "402"].join(""), "i"),
  new RegExp(["malwo", "war"].join(""), "i"),
  new RegExp(
    ["0x9478", "A3d557", "9a378E", "b91241", "B2ec03", "e8C014", "C244cF"].join(""),
    "i"
  ),
];

const IGNORED_DIRS = new Set([".git", "node_modules", ".wrangler", ".worktrees", "dist", "coverage"]);

function collectFiles(targetPath: string, out: string[] = []): string[] {
  if (!existsSync(targetPath)) return out;
  const stat = statSync(targetPath);
  if (stat.isFile()) {
    out.push(targetPath);
    return out;
  }
  for (const entry of readdirSync(targetPath)) {
    if (IGNORED_DIRS.has(entry)) continue;
    collectFiles(join(targetPath, entry), out);
  }
  return out;
}

describe("ExactJSON clean-slate brand hygiene and MCP contract parity", () => {
  it("contains zero legacy identifiers or legacy wallet addresses across the entire workspace", () => {
    const requiredFiles = [
      "LICENSE",
      "SECURITY.md",
      "migrations/0001_init.sql",
      "migrations/0002_transport.sql",
      "package.json",
      "wrangler.jsonc",
      "README.md",
      "GROUND_RULES.md",
      "HANDOFF.md",
      "mcp/package.json",
      "mcp/server.json",
      "mcp/index.mjs",
      "mcp/catalog.generated.mjs",
      "mcp/README.md",
      "mcp/LICENSE",
      "skills/exactjson/SKILL.md",
      "scripts/test-payment.ts",
    ];

    for (const rel of requiredFiles) {
      expect(existsSync(resolve(ROOT, rel)), `Missing required file: ${rel}`).toBe(true);
    }

    expect(readFileSync(resolve(ROOT, "mcp/LICENSE"), "utf8").trim()).toBe(
      readFileSync(resolve(ROOT, "LICENSE"), "utf8").trim()
    );

    const files = collectFiles(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file} matched ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps mcp/catalog.generated.mjs, mcp/index.mjs, mcp/package.json, mcp/server.json, and scripts/test-payment.ts synced with CATALOG", async () => {
    const mcpSource = readFileSync(resolve(ROOT, "mcp/index.mjs"), "utf8");
    const generatedSource = readFileSync(resolve(ROOT, "mcp/catalog.generated.mjs"), "utf8");

    expect(mcpSource).toContain("EXACTJSON_BASE_URL");
    expect(mcpSource).toContain("EXACTJSON_PACK");
    expect(mcpSource).toContain("process.env.EXACTJSON_BASE_URL?.trim()");
    expect(mcpSource).toContain("https://exactjson.com");
    expect(mcpSource).toContain("AbortSignal.timeout(");
    expect(mcpSource).toContain("/^0x/i.test(rawKey)");
    expect(generatedSource).toContain('export const SERVICE_VERSION = "1.4.0";');
    expect(generatedSource).toContain("Scan live Polymarket & Kalshi");
    expect(generatedSource).not.toContain('"priceFormatted": "$0.015",\n    "summary": "Polymarket + Kalshi');

    const mcpPkg = JSON.parse(readFileSync(resolve(ROOT, "mcp/package.json"), "utf8")) as {
      name: string;
      version: string;
      mcpName: string;
      author: string;
      bugs: { url: string };
      engines: { node: string };
      files: string[];
      homepage: string;
      bin: Record<string, string>;
    };
    expect(mcpPkg.name).toBe("exactjson-mcp");
    expect(mcpPkg.version).toBe("1.4.0");
    expect(mcpPkg.mcpName).toBe("io.github.exactjsondev/exactjson");
    expect(mcpPkg.author).toContain("ExactJSON");
    expect(mcpPkg.bugs.url).toBe("https://github.com/exactjsondev/exactjson/issues");
    expect(mcpPkg.engines.node).toBe(">=18.18.0");
    expect(mcpPkg.files).toContain("LICENSE");
    expect(mcpPkg.files).toContain("catalog.generated.mjs");
    expect(mcpPkg.homepage).toBe("https://exactjson.com");
    expect(mcpPkg.bin["exactjson-mcp"]).toBe("index.mjs");

    const serverJson = JSON.parse(readFileSync(resolve(ROOT, "mcp/server.json"), "utf8")) as {
      name: string;
      description: string;
      version: string;
      websiteUrl: string;
      remotes: Array<{ type: string; url: string }>;
      packages: Array<{
        identifier: string;
        version: string;
        environmentVariables?: Array<{ name: string }>;
      }>;
    };
    expect(serverJson.name).toBe("io.github.exactjsondev/exactjson");
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
    expect(serverJson.version).toBe("1.4.0");
    expect(serverJson.websiteUrl).toBe("https://exactjson.com");
    expect(serverJson.remotes[0]).toEqual({
      type: "streamable-http",
      url: "https://exactjson.com/mcp",
    });
    expect(serverJson.packages[0]?.identifier).toBe("exactjson-mcp");
    expect(serverJson.packages[0]?.version).toBe("1.4.0");
    const envVarNames = serverJson.packages[0]?.environmentVariables?.map((v) => v.name) ?? [];
    expect(envVarNames).toContain("EXACTJSON_PACK");

    const paymentScript = readFileSync(resolve(ROOT, "scripts/test-payment.ts"), "utf8");
    expect(paymentScript).toContain("Predictions Scanner ($0.01)");
    expect(paymentScript).not.toContain("Predictions Scanner ($0.015)");

    const wranglerConfig = JSON.parse(readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8")) as {
      assets?: { run_worker_first?: string[] };
    };
    expect(wranglerConfig.assets?.run_worker_first).toContain("/mcp");
    expect(wranglerConfig.assets?.run_worker_first).toContain("/mcp/*");

    // Verify stdio mcp/index.mjs --pack / EXACTJSON_PACK over real JSON-RPC stdio + error exit codes
    // Support linked git worktrees where mcp/node_modules lives in the main repo root
    const hasLocalMcpModules = existsSync(resolve(ROOT, "mcp/node_modules"));
    const mainRepoMcpEntry = resolve(ROOT, "../../mcp/index.mjs");
    const loaderArgs: string[] = [];
    if (!hasLocalMcpModules && existsSync(resolve(ROOT, "../../mcp/node_modules"))) {
      const parentUrl = JSON.stringify(`file:///${mainRepoMcpEntry.replace(/\\/g, "/")}`);
      const hookCode = `import { register } from "node:module"; register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (!s.startsWith(".") && !s.startsWith("file:")) return n(s, { ...c, parentURL: ${parentUrl} }); throw e; } }'));`;
      loaderArgs.push("--import", `data:text/javascript,${encodeURIComponent(hookCode)}`);
    }

    const invalidRun = spawnSync(
      process.execPath,
      [...loaderArgs, resolve(ROOT, "mcp/index.mjs"), "--pack", "bogus"],
      {
        encoding: "utf8",
        timeout: 5000,
      }
    );
    expect(invalidRun.status).toBe(1);
    expect(invalidRun.stderr).toContain("Unknown MCP pack 'bogus'");

    const emptyPackRun = spawnSync(
      process.execPath,
      [...loaderArgs, resolve(ROOT, "mcp/index.mjs"), "--pack=research"],
      {
        encoding: "utf8",
        timeout: 5000,
      }
    );
    expect(emptyPackRun.status).toBe(1);
    expect(emptyPackRun.stderr).toContain("0 active endpoints");

    const blankEqRun = spawnSync(
      process.execPath,
      [...loaderArgs, resolve(ROOT, "mcp/index.mjs"), "--pack="],
      {
        encoding: "utf8",
        timeout: 5000,
      }
    );
    expect(blankEqRun.status).toBe(1);
    expect(blankEqRun.stderr).toContain("Missing value");

    const blankSpcRun = spawnSync(
      process.execPath,
      [...loaderArgs, resolve(ROOT, "mcp/index.mjs"), "--pack", "   "],
      {
        encoding: "utf8",
        timeout: 5000,
      }
    );
    expect(blankSpcRun.status).toBe(1);
    expect(blankSpcRun.stderr).toContain("Missing value");

    const listToolsViaStdio = (args: string[], extraEnv: Record<string, string> = {}) =>
      new Promise<Array<{ name: string; description: string }>>((resolvePromise, rejectPromise) => {
        const child = spawn(
          process.execPath,
          [...loaderArgs, resolve(ROOT, "mcp/index.mjs"), ...args],
          {
            env: { ...process.env, ...extraEnv },
            stdio: ["pipe", "pipe", "pipe"],
          }
        );

        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          rejectPromise(new Error(`stdio MCP timed out. stderr=${stderr}`));
        }, 5000);

        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          const parts = stdout.split(/\r?\n/);
          stdout = parts.pop() ?? "";
          for (const line of parts) {
            if (line.trim().length === 0) continue;
            const msg = JSON.parse(line) as {
              id?: number;
              result?: { tools?: Array<{ name: string; description: string }> };
            };
            if (msg.id === 1) {
              child.stdin.write(
                `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
              );
              child.stdin.write(
                `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`
              );
            } else if (msg.id === 2 && msg.result?.tools) {
              clearTimeout(timer);
              child.kill();
              resolvePromise(msg.result.tools);
              return;
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        });

        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "vitest-stdio", version: "1.0.0" },
            },
          })}\n`
        );
      });

    const defaultTools = await listToolsViaStdio([]);
    expect(defaultTools.map((t) => t.name)).toEqual([
      "exactjson_health",
      ...getPackEndpoints(["markets"]).map((e) => `exactjson_${e.id}`),
    ]);
    const scannerStdio = defaultTools.find((t) => t.name === "exactjson_predictions_scanner");
    expect(scannerStdio?.description).toContain("Paid ($0.01 USDC): Scan live Polymarket & Kalshi");
    expect(scannerStdio?.description).toContain("Do NOT use for");

    const securityTools = await listToolsViaStdio(["--pack", "security"]);
    expect(securityTools.map((t) => t.name)).toEqual([
      "exactjson_health",
      ...getPackEndpoints(["security"]).map((e) => `exactjson_${e.id}`),
    ]);
    expect(securityTools.length).toBe(8);

    const worldTools = await listToolsViaStdio(["--pack", "world"]);
    expect(worldTools.map((t) => t.name)).toEqual([
      "exactjson_health",
      ...getPackEndpoints(["world"]).map((e) => `exactjson_${e.id}`),
    ]);
    expect(worldTools.length).toBe(6);

    const commerceTools = await listToolsViaStdio(["--pack", "commerce"]);
    expect(commerceTools.map((t) => t.name)).toEqual([
      "exactjson_health",
      ...getPackEndpoints(["commerce"]).map((e) => `exactjson_${e.id}`),
    ]);
    expect(commerceTools.length).toBe(5);

    const allTools = await listToolsViaStdio(["--pack", "all"]);
    expect(allTools.length).toBe(1 + CATALOG.length);
  }, 15_000);
});
