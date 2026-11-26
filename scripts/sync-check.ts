import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG, SERVICE_VERSION } from "../src/config/catalog";

const ROOT = process.cwd();

function readText(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readText(relPath)) as T;
}

function extractMcpToolBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const toolStartRe = /server\.tool\(\s*"(exactjson_[a-z0-9_]+)"/g;
  const matches = Array.from(source.matchAll(toolStartRe));
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const name = current[1]!;
    const startIdx = current.index ?? 0;
    const endIdx = matches[i + 1]?.index ?? source.length;
    blocks.set(name, source.slice(startIdx, endIdx));
  }
  return blocks;
}

function main() {
  const failures: string[] = [];

  const rootPkg = readJson<{ version: string }>("package.json");
  if (rootPkg.version !== SERVICE_VERSION) {
    failures.push(`package.json version '${rootPkg.version}' !== SERVICE_VERSION '${SERVICE_VERSION}'`);
  }

  const mcpPkg = readJson<{ version: string }>("mcp/package.json");
  if (mcpPkg.version !== SERVICE_VERSION) {
    failures.push(`mcp/package.json version '${mcpPkg.version}' !== SERVICE_VERSION '${SERVICE_VERSION}'`);
  }

  const serverJson = readJson<{
    version: string;
    packages?: Array<{ identifier?: string; version?: string }>;
  }>("mcp/server.json");
  if (serverJson.version !== SERVICE_VERSION) {
    failures.push(`mcp/server.json version '${serverJson.version}' !== SERVICE_VERSION '${SERVICE_VERSION}'`);
  }
  if (serverJson.packages?.[0]?.version !== SERVICE_VERSION) {
    failures.push(
      `mcp/server.json packages[0].version '${serverJson.packages?.[0]?.version ?? ""}' !== '${SERVICE_VERSION}'`
    );
  }

  const mcpSource = readText("mcp/index.mjs");
  if (!mcpSource.includes(`version: "${SERVICE_VERSION}"`)) {
    failures.push(`mcp/index.mjs missing McpServer version "${SERVICE_VERSION}"`);
  }

  const toolBlocks = extractMcpToolBlocks(mcpSource);
  const expectedToolNames = new Set([
    "exactjson_health",
    ...CATALOG.map((entry) => `exactjson_${entry.id}`),
  ]);
  for (const expected of expectedToolNames) {
    if (!toolBlocks.has(expected)) {
      failures.push(`mcp/index.mjs missing tool '${expected}'`);
    }
  }
  for (const actual of toolBlocks.keys()) {
    if (!expectedToolNames.has(actual)) {
      failures.push(`mcp/index.mjs has unexpected tool '${actual}'`);
    }
  }

  for (const entry of CATALOG) {
    const toolName = `exactjson_${entry.id}`;
    const block = toolBlocks.get(toolName);
    if (!block) continue;

    const expectedPriceTag = `Paid (${entry.priceFormatted} USDC):`;
    if (!block.includes(expectedPriceTag)) {
      failures.push(`${toolName} in mcp/index.mjs missing price tag '${expectedPriceTag}'`);
    }

    for (const paramName of Object.keys(entry.inputSchema.properties)) {
      const paramPattern = new RegExp(`\\b${paramName}\\s*:`);
      if (!paramPattern.test(block)) {
        failures.push(`${toolName} in mcp/index.mjs missing input parameter '${paramName}'`);
      }
    }
  }

  const paymentScript = readText("scripts/test-payment.ts");
  const paymentBlocks = Array.from(
    paymentScript.matchAll(/\{\s*key:\s*"[^"]+",\s*label:\s*"([^"]+)",\s*url:\s*`([^`]+)`/g)
  );
  for (const entry of CATALOG) {
    const matchedBlock = paymentBlocks.find((m) => m[2]?.includes(entry.path));
    if (!matchedBlock) {
      failures.push(`scripts/test-payment.ts missing endpoint '${entry.path}'`);
      continue;
    }
    const label = matchedBlock[1] ?? "";
    if (!label.includes(`(${entry.priceFormatted})`)) {
      failures.push(
        `scripts/test-payment.ts label '${label}' for '${entry.path}' missing price '(${entry.priceFormatted})'`
      );
    }
  }

  const dashboardHtml = readText("public/dashboard/index.html");
  const filterSelectMatch = dashboardHtml.match(
    /<select id="filter-endpoint"[\s\S]*?<\/select>/
  );
  const filterSelectHtml = filterSelectMatch?.[0] ?? "";
  for (const entry of CATALOG) {
    if (!filterSelectHtml.includes(`value="${entry.path}"`)) {
      failures.push(`public/dashboard/index.html #filter-endpoint missing '${entry.path}'`);
    }
  }

  const skillMd = readText("skills/exactjson/SKILL.md");
  for (const entry of CATALOG) {
    if (!skillMd.includes(entry.path)) {
      failures.push(`skills/exactjson/SKILL.md missing endpoint '${entry.path}'`);
    }
    const rowPattern = new RegExp(
      `\\|\\s*\`GET ${entry.path.replace(/\//g, "\\/")}\`\\s*\\|\\s*\`${entry.priceFormatted.replace("$", "\\$")}\``
    );
    if (!rowPattern.test(skillMd)) {
      failures.push(
        `skills/exactjson/SKILL.md endpoint table row for '${entry.path}' does not match price '${entry.priceFormatted}'`
      );
    }
  }

  if (failures.length > 0) {
    console.error("CATALOG sync-check failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `CATALOG sync-check passed: ${CATALOG.length} endpoints & ${expectedToolNames.size} MCP tools synced across v${SERVICE_VERSION}.`
  );
}

main();
