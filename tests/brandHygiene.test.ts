import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/config/catalog";

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

const IGNORED_DIRS = new Set([".git", "node_modules", ".wrangler", "dist", "coverage"]);

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
      "migrations/0001_init.sql",
      "package.json",
      "wrangler.jsonc",
      "README.md",
      "GROUND_RULES.md",
      "HANDOFF.md",
      "mcp/package.json",
      "mcp/server.json",
      "mcp/index.mjs",
      "mcp/README.md",
      "skills/exactjson/SKILL.md",
      "scripts/test-payment.ts",
    ];

    for (const rel of requiredFiles) {
      expect(existsSync(resolve(ROOT, rel)), `Missing required file: ${rel}`).toBe(true);
    }

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

  it("keeps mcp/index.mjs, mcp/package.json, mcp/server.json, and scripts/test-payment.ts synced with CATALOG", () => {
    const mcpSource = readFileSync(resolve(ROOT, "mcp/index.mjs"), "utf8");
    const toolMatches = Array.from(mcpSource.matchAll(/server\.tool\(\s*"(exactjson_[a-z0-9_]+)"/g)).map(
      (m) => m[1]
    );
    const expectedTools = new Set(["exactjson_health", ...CATALOG.map((e) => `exactjson_${e.id}`)]);

    expect(toolMatches.length).toBe(12);
    expect(new Set(toolMatches)).toEqual(expectedTools);
    expect(mcpSource).toContain("EXACTJSON_BASE_URL");
    expect(mcpSource).toContain("process.env.EXACTJSON_BASE_URL?.trim()");
    expect(mcpSource).toContain("https://exactjson.com");
    expect(mcpSource).toContain('version: "1.0.0"');
    expect(mcpSource).toContain("AbortSignal.timeout(");
    expect(mcpSource).toContain("/^0x/i.test(rawKey)");
    expect(mcpSource).toContain("Paid ($0.01 USDC): Scan live Polymarket & Kalshi");
    expect(mcpSource).not.toContain("Paid ($0.015 USDC): Scan live Polymarket & Kalshi");

    const mcpPkg = JSON.parse(readFileSync(resolve(ROOT, "mcp/package.json"), "utf8")) as {
      name: string;
      version: string;
      mcpName: string;
      homepage: string;
      bin: Record<string, string>;
    };
    expect(mcpPkg.name).toBe("exactjson-mcp");
    expect(mcpPkg.version).toBe("1.0.0");
    expect(mcpPkg.mcpName).toBe("io.github.exactjsondev/exactjson");
    expect(mcpPkg.homepage).toBe("https://exactjson.com");
    expect(mcpPkg.bin["exactjson-mcp"]).toBe("./index.mjs");

    const serverJson = JSON.parse(readFileSync(resolve(ROOT, "mcp/server.json"), "utf8")) as {
      name: string;
      version: string;
      websiteUrl: string;
      packages: Array<{ identifier: string; version: string }>;
    };
    expect(serverJson.name).toBe("io.github.exactjsondev/exactjson");
    expect(serverJson.version).toBe("1.0.0");
    expect(serverJson.websiteUrl).toBe("https://exactjson.com");
    expect(serverJson.packages[0]?.identifier).toBe("exactjson-mcp");
    expect(serverJson.packages[0]?.version).toBe("1.0.0");

    const paymentScript = readFileSync(resolve(ROOT, "scripts/test-payment.ts"), "utf8");
    expect(paymentScript).toContain("Predictions Scanner ($0.01)");
    expect(paymentScript).not.toContain("Predictions Scanner ($0.015)");
  });
});
