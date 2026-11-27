import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATALOG,
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_PACK,
  PACKS,
  PACK_IDS,
  SERVICE_VERSION,
  getPackEndpoints,
} from "../src/config/catalog";
import { renderMcpManifestSource } from "./sync-mcp-manifest";

const ROOT = process.cwd();

function readText(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readText(relPath)) as T;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function main() {
  const failures: string[] = [];

  const rootPkg = readJson<{ version: string }>("package.json");
  if (rootPkg.version !== SERVICE_VERSION) {
    failures.push(
      `package.json version '${rootPkg.version}' !== SERVICE_VERSION '${SERVICE_VERSION}'`
    );
  }

  const mcpPkg = readJson<{ version: string; files?: string[] }>("mcp/package.json");
  if (mcpPkg.version !== SERVICE_VERSION) {
    failures.push(
      `mcp/package.json version '${mcpPkg.version}' !== SERVICE_VERSION '${SERVICE_VERSION}'`
    );
  }
  if (!mcpPkg.files?.includes("catalog.generated.mjs")) {
    failures.push("mcp/package.json 'files' must include 'catalog.generated.mjs'");
  }

  const serverJson = readJson<{
    version: string;
    packages?: Array<{
      identifier?: string;
      version?: string;
      environmentVariables?: Array<{ name?: string }>;
    }>;
  }>("mcp/server.json");
  if (serverJson.version !== SERVICE_VERSION) {
    failures.push(
      `mcp/server.json version '${serverJson.version}' !== SERVICE_VERSION '${SERVICE_VERSION}'`
    );
  }
  if (serverJson.packages?.[0]?.version !== SERVICE_VERSION) {
    failures.push(
      `mcp/server.json packages[0].version '${serverJson.packages?.[0]?.version ?? ""}' !== '${SERVICE_VERSION}'`
    );
  }
  const serverEnvNames =
    serverJson.packages?.[0]?.environmentVariables?.map((e) => e.name) ?? [];
  if (!serverEnvNames.includes("EXACTJSON_PACK")) {
    failures.push("mcp/server.json packages[0].environmentVariables missing 'EXACTJSON_PACK'");
  }

  // Enforce <= 15 tools per vertical MCP pack ceiling (1 health tool + paid pack tools)
  for (const packId of PACK_IDS) {
    const toolCount = 1 + getPackEndpoints([packId]).length;
    if (toolCount > MAX_MCP_TOOLS_PER_PACK) {
      failures.push(
        `Pack '${packId}' has ${toolCount} MCP tools (exceeds ${MAX_MCP_TOOLS_PER_PACK} MCP tool ceiling)`
      );
    }
  }

  // Enforce Bazaar <= 500 char cap, explicit MCP negative-scope boundary, and pack disclaimer
  for (const entry of CATALOG) {
    const mcpDesc = `Paid (${entry.priceFormatted} USDC): ${entry.description}`;
    if (mcpDesc.length > MAX_BAZAAR_DESCRIPTION_LENGTH) {
      failures.push(
        `Endpoint '${entry.id}' MCP description is ${mcpDesc.length} chars (exceeds ${MAX_BAZAAR_DESCRIPTION_LENGTH})`
      );
    }
    if (!/\bDo NOT use for\b/.test(entry.description)) {
      failures.push(`Endpoint '${entry.id}' description missing 'Do NOT use for' negative boundary`);
    }
    const expectedDisclaimer = PACKS[entry.pack].disclaimer;
    if (!entry.description.includes(expectedDisclaimer)) {
      failures.push(
        `Endpoint '${entry.id}' description missing pack '${entry.pack}' disclaimer`
      );
    }
  }

  // Enforce byte-for-byte sync of mcp/catalog.generated.mjs with src/config/catalog/index.ts
  const expectedGenerated = normalizeNewlines(renderMcpManifestSource());
  try {
    const actualGenerated = normalizeNewlines(readText("mcp/catalog.generated.mjs"));
    if (actualGenerated !== expectedGenerated) {
      failures.push(
        "mcp/catalog.generated.mjs is out of sync with CATALOG (run `npm run sync:mcp`)"
      );
    }
  } catch {
    failures.push(
      "Missing mcp/catalog.generated.mjs (run `npm run sync:mcp` to generate from CATALOG)"
    );
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
    `CATALOG sync-check passed: ${CATALOG.length} endpoints & ${1 + CATALOG.length} MCP tools synced across v${SERVICE_VERSION} (<= ${MAX_MCP_TOOLS_PER_PACK} tools/pack).`
  );
}

main();
