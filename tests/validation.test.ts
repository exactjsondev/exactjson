import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { decodeBase64Json } from "../src/lib/headers";
import { clampLimit, parsePerpCoin, parseSolanaMint } from "../src/lib/validation";

describe("input validation", () => {
  it("validates Solana Base58 mint addresses strictly", () => {
    expect(parseSolanaMint("So11111111111111111111111111111111111111112")).toEqual({
      ok: true,
      value: "So11111111111111111111111111111111111111112",
    });

    // Rejects missing, too short, too long, and non-Base58 characters (0, O, I, l)
    expect(parseSolanaMint(undefined).ok).toBe(false);
    expect(parseSolanaMint("").ok).toBe(false);
    expect(parseSolanaMint("shortMint").ok).toBe(false);
    expect(parseSolanaMint("0".repeat(44)).ok).toBe(false);
    expect(parseSolanaMint("O".repeat(44)).ok).toBe(false);
    expect(parseSolanaMint("I".repeat(44)).ok).toBe(false);
    expect(parseSolanaMint("l".repeat(44)).ok).toBe(false);
    expect(parseSolanaMint("1".repeat(45)).ok).toBe(false);
  });

  it("validates perp coin symbols and strips optional -PERP suffix", () => {
    expect(parsePerpCoin("BTC")).toEqual({
      ok: true,
      value: { raw: "BTC", stripped: "BTC", lookupKey: "btc" },
    });
    expect(parsePerpCoin("btc-perp")).toEqual({
      ok: true,
      value: { raw: "btc-perp", stripped: "btc", lookupKey: "btc" },
    });
    expect(parsePerpCoin("kPEPE-PERP")).toEqual({
      ok: true,
      value: { raw: "kPEPE-PERP", stripped: "kPEPE", lookupKey: "kpepe" },
    });

    expect(parsePerpCoin(undefined).ok).toBe(false);
    expect(parsePerpCoin("BTC/USD").ok).toBe(false);
    expect(parsePerpCoin("BTC; DROP TABLE").ok).toBe(false);
    expect(parsePerpCoin("A".repeat(17)).ok).toBe(false);
  });

  it("clamps D1 pagination limits to 1..100", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit("0")).toBe(1);
    expect(clampLimit("-10")).toBe(1);
    expect(clampLimit("25")).toBe(25);
    expect(clampLimit("999")).toBe(100);
    expect(clampLimit("not-a-number")).toBe(50);
  });
});

describe("BoundedTtlCache", () => {
  it("evicts expired entries and enforces maxEntries bound", () => {
    const cache = new BoundedTtlCache(3);
    cache.set("a", 1, 1000, 0);
    cache.set("b", 2, 5000, 0);
    cache.set("c", 3, 5000, 0);

    // At t=2000, "a" is expired and should be pruned before evicting "b"
    cache.set("d", 4, 5000, 2000);
    expect(cache.size).toBe(3);
    expect(cache.get("a", 2000).hit).toBe(false);
    expect(cache.get("b", 2000).hit).toBe(true);
    expect(cache.get("d", 2000).hit).toBe(true);

    // At t=2100, none expired -> oldest ("b") evicted
    cache.set("e", 5, 5000, 2100);
    expect(cache.size).toBe(3);
    expect(cache.get("b", 2100).hit).toBe(false);
    expect(cache.get("e", 2100).hit).toBe(true);
  });
});

describe("decodeBase64Json", () => {
  it("decodes standard Base64 and Base64URL without padding safely", () => {
    const sample = { success: true, transaction: "0xabc", payer: "0x123" };
    const b64 = Buffer.from(JSON.stringify(sample), "utf8").toString("base64");
    const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect(decodeBase64Json(b64)).toEqual(sample);
    expect(decodeBase64Json(b64url)).toEqual(sample);
    expect(decodeBase64Json("%%%invalid%%%")).toBeNull();
    expect(decodeBase64Json(null)).toBeNull();
  });
});
