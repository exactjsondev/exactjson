import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import {
  CATALOG,
  DISCLAIMER,
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_PACK,
  PACKS,
  PACK_IDS,
  SERVICE_NAME,
  SERVICE_VERSION,
  USER_AGENT,
  getActivePacks,
  getEndpointById,
  getPackEndpoints,
  parsePackSelector,
} from "../src/config/catalog";

function parseMinSemver(versionSpec: string): [number, number, number] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(versionSpec);
  if (!match) {
    throw new Error(`Unable to parse semver from: ${versionSpec}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(ver: [number, number, number], min: [number, number, number]): boolean {
  if (ver[0] !== min[0]) return ver[0] > min[0];
  if (ver[1] !== min[1]) return ver[1] > min[1];
  return ver[2] >= min[2];
}

describe("catalog, 5-pack architecture, and 260%-rule description guardrails", () => {
  it("enforces Bazaar <= 500 chars, Glama 260%-rule negative boundaries, and pack disclaimers on every route", () => {
    expect(CATALOG.length).toBe(18);
    expect(MAX_MCP_TOOLS_PER_PACK).toBe(15);

    for (const packId of PACK_IDS) {
      const pack = PACKS[packId];
      expect(pack.id).toBe(packId);
      expect(pack.mcpPath).toBe(`/mcp/${packId}`);
      expect(pack.disclaimer.length).toBeGreaterThan(20);
      const endpoints = getPackEndpoints([packId]);
      expect(
        1 + endpoints.length,
        `Pack '${packId}' exceeds ${MAX_MCP_TOOLS_PER_PACK} MCP tool ceiling`
      ).toBeLessThanOrEqual(MAX_MCP_TOOLS_PER_PACK);
    }

    for (const entry of CATALOG) {
      const packDisclaimer = PACKS[entry.pack].disclaimer;
      const mcpWrappedDescription = `Paid (${entry.priceFormatted} USDC): ${entry.description}`;

      expect(PACK_IDS).toContain(entry.pack);
      expect(entry.description.length).toBeGreaterThan(60);
      expect(entry.description.length).toBeLessThanOrEqual(MAX_BAZAAR_DESCRIPTION_LENGTH);
      expect(mcpWrappedDescription.length).toBeLessThanOrEqual(MAX_BAZAAR_DESCRIPTION_LENGTH);
      expect(entry.description).toContain(packDisclaimer);
      expect(entry.description).toMatch(/\bDo NOT use for\b/);
      expect(entry.description).not.toMatch(/\b(BUY|SELL)\b/);

      // Every required top-level key in outputSchema must exist on outputExample
      const requiredKeys = (entry.outputSchema.required as string[] | undefined) ?? [];
      for (const key of requiredKeys) {
        expect(
          Object.hasOwn(entry.outputExample, key),
          `Expected outputExample for ${entry.id} to contain required schema key '${key}'`
        ).toBe(true);
      }
    }
  });

  it("parses pack selectors deterministically and filters active packs", () => {
    expect(PACK_IDS).toEqual(["markets", "security", "world", "commerce", "research"]);

    expect(parsePackSelector(undefined)).toEqual({
      ok: true,
      packs: ["markets"],
      isAll: false,
      canonical: "markets",
    });
    expect(parsePackSelector("  ")).toEqual({
      ok: true,
      packs: ["markets"],
      isAll: false,
      canonical: "markets",
    });
    expect(parsePackSelector("SECURITY, world , security")).toEqual({
      ok: true,
      packs: ["security", "world"],
      isAll: false,
      canonical: "security,world",
    });
    expect(parsePackSelector("ALL")).toEqual({
      ok: true,
      packs: ["markets", "security", "world", "commerce", "research"],
      isAll: true,
      canonical: "all",
    });

    expect(parsePackSelector("unknown")).toEqual({
      ok: false,
      invalid: "unknown",
    });
    expect(parsePackSelector("markets,all")).toEqual({
      ok: false,
      invalid: "all",
    });
    expect(parsePackSelector("markets,")).toEqual({
      ok: false,
      invalid: "",
    });
    expect(parsePackSelector("__proto__")).toEqual({
      ok: false,
      invalid: "__proto__",
    });

    expect(getActivePacks().map((p) => p.id)).toEqual(["markets", "security"]);
    expect(getPackEndpoints(["markets"]).length).toBe(11);
    expect(getPackEndpoints(["security"]).length).toBe(7);
    expect(getPackEndpoints(["world"]).length).toBe(0);
  });

  it("uses exact root-app full paths, compliant upstream USER_AGENT, and typed numeric MCP param metadata", () => {
    expect(SERVICE_NAME).toBe("ExactJSON");
    expect(SERVICE_VERSION).toBe("1.2.0");
    expect(USER_AGENT).toBe("ExactJSON/1.2 (+https://exactjson.com; mailto:hello@exactjson.com)");
    expect(DISCLAIMER).toBe("Informational market/security data only; not financial advice.");

    expect(CATALOG.map((e) => e.routeKey)).toEqual([
      "GET /v1/solana/safety",
      "GET /v1/solana/trending",
      "GET /v1/perps/snapshot",
      "GET /v1/perps/screener",
      "GET /v1/perps/funding-arb",
      "GET /v1/predictions/scanner",
      "GET /v1/options/surface",
      "GET /v1/macro/liquidity",
      "GET /v1/evm/safety",
      "GET /v1/predictions/arb",
      "GET /v1/execution/quote-check",
      "GET /v1/oss/package-audit",
      "GET /v1/net/domain-trust",
      "GET /v1/sec/cve-triage",
      "GET /v1/ops/cloud-status",
      "GET /v1/oss/runtime-eol",
      "GET /v1/ai/model-audit",
      "GET /v1/net/censorship-check",
    ]);
    expect(CATALOG.map((e) => e.priceAmount)).toEqual([
      "0.01",
      "0.015",
      "0.005",
      "0.01",
      "0.015",
      "0.01",
      "0.015",
      "0.01",
      "0.01",
      "0.02",
      "0.01",
      "0.01",
      "0.01",
      "0.01",
      "0.005",
      "0.005",
      "0.01",
      "0.01",
    ]);
    expect(getEndpointById("predictions_scanner").priceFormatted).toBe("$0.01");
    expect(getEndpointById("predictions_scanner").priceUsd).toBe(0.01);
    expect(getEndpointById("perps_screener").inputSchema.properties.limit?.mcpType).toBe("integer");
    expect(getEndpointById("perps_screener").inputSchema.properties.min_oi_usd?.mcpType).toBe(
      "number"
    );
  });

  it("verifies all @x402/* dependencies are >= 2.27.0 and @x402/paywall is absent", () => {
    const allDeps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    expect(allDeps["@x402/paywall"]).toBeUndefined();

    const x402Deps = Object.entries(allDeps).filter(([name]) => name.startsWith("@x402/"));
    expect(x402Deps.length).toBeGreaterThanOrEqual(4);

    for (const [name, spec] of x402Deps) {
      const parsed = parseMinSemver(spec);
      expect(isAtLeast(parsed, [2, 27, 0]), `Expected ${name}@${spec} to be >= 2.27.0`).toBe(true);
    }
  });
});
