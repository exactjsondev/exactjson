import { describe, expect, it } from "vitest";
import {
  COMMERCE_PACK,
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_PACK,
  SERVICE_VERSION,
  getPackEndpoints,
} from "../src/config/catalog";
import { COMMERCE_CATALOG, COMMERCE_DISCLAIMER } from "../src/config/catalog/commerce";
import {
  parseCompanyVerifyInput,
  parseSafetyRecallInput,
  parseSettlementWindowInput,
  parseVatVerifyInput,
  validateBicCode,
  validateIbanChecksum,
  validateIsinChecksum,
  validateLeiChecksum,
} from "../src/packs/commerce/validation";

describe("commerce pack — catalog contract, ISO financial checksums, and input validation", () => {
  it("defines 4 commerce endpoints at v1.4.0 within Glama TDQS and Bazaar 500-char limits", () => {
    expect(SERVICE_VERSION).toBe("1.4.0");
    expect(COMMERCE_CATALOG.length).toBe(4);
    expect(1 + getPackEndpoints(["commerce"]).length).toBe(5);
    expect(1 + getPackEndpoints(["commerce"]).length).toBeLessThanOrEqual(MAX_MCP_TOOLS_PER_PACK);
    expect(COMMERCE_PACK.mcpPath).toBe("/mcp/commerce");

    expect(COMMERCE_CATALOG.map((e) => e.routeKey)).toEqual([
      "GET /v1/commerce/settlement-window",
      "GET /v1/commerce/vat-verify",
      "GET /v1/entity/company-verify",
      "GET /v1/consumer/safety-recall",
    ]);
    expect(COMMERCE_CATALOG.map((e) => e.priceAmount)).toEqual([
      "0.01",
      "0.01",
      "0.01",
      "0.01",
    ]);

    for (const entry of COMMERCE_CATALOG) {
      const mcpDesc = `Paid (${entry.priceFormatted} USDC): ${entry.description}`;
      expect(mcpDesc.length).toBeLessThanOrEqual(MAX_BAZAAR_DESCRIPTION_LENGTH);
      expect(entry.description).toMatch(/\bDo NOT use for\b/);
      expect(entry.description).toContain(COMMERCE_DISCLAIMER);
    }

    // Verify negative boundary guardrails required by roadmap
    const vatEntry = COMMERCE_CATALOG.find((e) => e.id === "commerce_vat_verify")!;
    expect(vatEntry.description).toContain("EU-27 + XI");
    expect(vatEntry.description).toContain("UK GB");

    const recallEntry = COMMERCE_CATALOG.find((e) => e.id === "consumer_safety_recall")!;
    expect(recallEntry.description).toContain("US CPSC");
    expect(recallEntry.description).toContain("openFDA");
  });

  it("validates ISO 13616 IBAN MOD 97-10 checksums, lengths, BBAN bank codes, and SEPA membership", () => {
    const deOk = validateIbanChecksum("DE89 3704 0044 0532 0130 00");
    expect(deOk).toEqual({
      valid: true,
      normalized: "DE89370400440532013000",
      countryCode: "DE",
      checkDigits: "89",
      bankCode: "37040044",
      expectedLength: 22,
      actualLength: 22,
      sepaMember: true,
      reason: null,
    });

    const gbOk = validateIbanChecksum("GB29NWBK60161331926819");
    expect(gbOk.valid).toBe(true);
    expect(gbOk.countryCode).toBe("GB");
    expect(gbOk.bankCode).toBe("NWBK");
    expect(gbOk.sepaMember).toBe(true);

    const aeOk = validateIbanChecksum("AE070331234567890123456");
    expect(aeOk.valid).toBe(true);
    expect(aeOk.countryCode).toBe("AE");
    expect(aeOk.sepaMember).toBe(false);

    // Corrupted check digit
    const badCheck = validateIbanChecksum("DE88370400440532013000");
    expect(badCheck.valid).toBe(false);
    expect(badCheck.reason).toBe("CHECKSUM_MISMATCH");

    // Reserved ISO 13616 check digits 00 / 01 / 99 must always be rejected even when BigInt(rearranged) % 97n === 1n!
    expect(validateIbanChecksum("DE01370400440532013088").valid).toBe(false);
    expect(validateIbanChecksum("DE99370400440532013004").valid).toBe(false);
    expect(validateIbanChecksum("DE00370400440532013033").valid).toBe(false);

    // Wrong length for DE (21 instead of 22)
    const badLen = validateIbanChecksum("DE8937040044053201300");
    expect(badLen.valid).toBe(false);
    expect(badLen.reason).toBe("INVALID_COUNTRY_LENGTH");
  });

  it("validates ISO 9362 BIC, ISO 17442 LEI MOD 97-10, and ISO 6166 ISIN Luhn check digits", () => {
    expect(validateBicCode("deutdeff")).toEqual({
      valid: true,
      normalized8: "DEUTDEFF",
      normalized11: "DEUTDEFFXXX",
      bankCode: "DEUT",
      countryCode: "DE",
      locationCode: "FF",
      branchCode: "XXX",
      isHeadOffice: true,
      reason: null,
    });
    // Crown Dependency Jersey BIC & FTSE-100 Jersey ISIN (Glencore JE00B4T3BW64)
    expect(validateBicCode("NWBKJESHXXX").valid).toBe(true);
    expect(validateIsinChecksum("JE00B4T3BW64")).toEqual({
      valid: true,
      normalized: "JE00B4T3BW64",
      countryCode: "JE",
    });
    expect(validateBicCode("BADBIC1")).toMatchObject({ valid: false });
    expect(validateBicCode("DEUTZZFFXXX")).toMatchObject({
      valid: false,
      reason: "UNKNOWN_ISO_COUNTRY",
    });

    // Apple Inc. real LEI
    expect(validateLeiChecksum("hwupkr0mpou8fgxbt394")).toEqual({
      valid: true,
      normalized: "HWUPKR0MPOU8FGXBT394",
      louPrefix: "HWUP",
      checkDigits: "94",
      reason: null,
    });
    expect(validateLeiChecksum("HWUPKR0MPOU8FGXBT395")).toMatchObject({
      valid: false,
      reason: "CHECKSUM_MISMATCH",
    });

    // Apple Inc. real ISIN US0378331005
    expect(validateIsinChecksum("us0378331005")).toEqual({
      valid: true,
      normalized: "US0378331005",
      countryCode: "US",
    });
    expect(validateIsinChecksum("US0378331006")).toMatchObject({ valid: false });
  });

  it("validates settlement-window, vat-verify, company-verify, and safety-recall query parameters", () => {
    const sw = parseSettlementWindowInput(
      { from: "usa", to: "Saudi Arabia", date: "2026-12-30", tenor: "T+2", amount: "25000.5" },
      Date.UTC(2026, 10, 27)
    );
    expect(sw.ok).toBe(true);
    if (sw.ok) {
      expect(sw.value.from.alpha2).toBe("US");
      expect(sw.value.to.alpha2).toBe("SA");
      expect(sw.value.date).toBe("2026-12-30");
      expect(sw.value.tenor).toBe("T+2");
      expect(sw.value.amount).toBe(25000.5);
    }

    expect(
      parseSettlementWindowInput({ from: "US", to: "JP", date: "2026-02-30" }, Date.UTC(2026, 10, 27))
    ).toMatchObject({ ok: false });
    expect(
      parseSettlementWindowInput({ from: "US", to: "JP", tenor: "T+5" }, Date.UTC(2026, 10, 27))
    ).toMatchObject({ ok: false });
    expect(
      parseSettlementWindowInput({ from: "US", to: "JP", amount: "-10" }, Date.UTC(2026, 10, 27))
    ).toMatchObject({ ok: false });

    // VAT: Greece GR -> EL auto-normalization, Northern Ireland XI allowed, UK GB rejected with explicit guidance
    const grVat = parseVatVerifyInput({ vat: "GR 094019245" });
    expect(grVat.ok).toBe(true);
    if (grVat.ok) {
      expect(grVat.value.vat).toEqual({
        raw: "GR094019245",
        viesCountry: "EL",
        isoCountry: "GR",
        vatNumber: "094019245",
      });
    }

    const xiVat = parseVatVerifyInput({ vat: "XI123456789" });
    expect(xiVat.ok).toBe(true);
    if (xiVat.ok) {
      expect(xiVat.value.vat?.viesCountry).toBe("XI");
      expect(xiVat.value.vat?.isoCountry).toBe("GB");
    }

    // Unprefixed Northern Ireland VAT with country=XI must resolve viesCountry=XI (not fail as GB)
    const xiUnprefixed = parseVatVerifyInput({ vat: "123456789", country: "XI" });
    expect(xiUnprefixed.ok).toBe(true);
    if (xiUnprefixed.ok) {
      expect(xiUnprefixed.value.vat?.viesCountry).toBe("XI");
      expect(xiUnprefixed.value.vat?.isoCountry).toBe("GB");
    }

    // Bulgaria 2026 Eurozone currency check
    const bgSw = parseSettlementWindowInput({ from: "DE", to: "BG" }, Date.UTC(2026, 10, 27));
    expect(bgSw.ok).toBe(true);
    if (bgSw.ok) {
      expect(bgSw.value.to.currencyCode).toBe("EUR");
    }

    // Standalone IBAN without VAT (supports non-EU supplier invoices)
    const ibanOnly = parseVatVerifyInput({ iban: "GB29NWBK60161331926819", country: "GB" });
    expect(ibanOnly.ok).toBe(true);

    // Reject UK GB VAT prefix (not in VIES) and empty input
    const gbVat = parseVatVerifyInput({ vat: "GB123456789" });
    expect(gbVat.ok).toBe(false);
    if (!gbVat.ok) {
      expect(gbVat.error).toContain("EU-27 + XI");
    }
    expect(parseVatVerifyInput({})).toMatchObject({ ok: false });

    // Company verify
    const cv = parseCompanyVerifyInput({ cik: "320193", country: "us" });
    expect(cv.ok).toBe(true);
    if (cv.ok) {
      expect(cv.value.cik).toBe("0000320193");
      expect(cv.value.country).toBe("US");
    }
    expect(parseCompanyVerifyInput({})).toMatchObject({ ok: false });
    expect(parseCompanyVerifyInput({ lei: "HWUPKR0MPOU8FGXBT395" })).toMatchObject({ ok: false });

    // Safety recall (requires >= 3 chars on query, alphanumeric characters in brand)
    const sr = parseSafetyRecallInput({ query: "infant formula", brand: "Abbott", category: "food" });
    expect(sr).toEqual({
      ok: true,
      value: { query: "infant formula", brand: "Abbott", category: "food" },
    });
    expect(parseSafetyRecallInput({ query: "ba" })).toMatchObject({ ok: false });
    expect(parseSafetyRecallInput({ query: "crib", brand: "**" })).toMatchObject({ ok: false });
    expect(parseSafetyRecallInput({ query: "crib", category: "vehicles" })).toMatchObject({
      ok: false,
    });
  });
});
