import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import {
  CATALOG,
  DISCLAIMER,
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  SERVICE_NAME,
  SERVICE_VERSION,
  USER_AGENT,
  getEndpointById,
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

describe("catalog and dependency guardrails", () => {
  it("enforces CDP Bazaar description length <= 500 characters on every paid route", () => {
    expect(CATALOG.length).toBe(11);
    for (const entry of CATALOG) {
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.description.length).toBeLessThanOrEqual(MAX_BAZAAR_DESCRIPTION_LENGTH);
      expect(entry.description).toContain(DISCLAIMER);
      expect(entry.description).not.toMatch(/\b(BUY|SELL)\b/);

      // Every required top-level key in outputSchema must exist on outputExample
      const requiredKeys = (entry.outputSchema.required as string[] | undefined) ?? [];
      for (const key of requiredKeys) {
        expect(
          Object.prototype.hasOwnProperty.call(entry.outputExample, key),
          `Expected outputExample for ${entry.id} to contain required schema key '${key}'`
        ).toBe(true);
      }
    }
  });

  it("uses exact root-app full paths, ExactJSON branding, and 1.0.0 service version", () => {
    expect(SERVICE_NAME).toBe("ExactJSON");
    expect(SERVICE_VERSION).toBe("1.0.0");
    expect(USER_AGENT).toBe("ExactJSON/1.0");
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
    ]);
    expect(getEndpointById("predictions_scanner").priceFormatted).toBe("$0.01");
    expect(getEndpointById("predictions_scanner").priceUsd).toBe(0.01);
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
      expect(
        isAtLeast(parsed, [2, 27, 0]),
        `Expected ${name}@${spec} to be >= 2.27.0`
      ).toBe(true);
    }
  });
});
