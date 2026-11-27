import { COMMERCE_DISCLAIMER } from "../../../config/catalog/commerce";
import type { SlimGleifEntity, ViesLookupResult } from "../providers/viesAndGleif";
import {
  type ParsedVatVerifyInput,
  validateBicCode,
  validateIbanChecksum,
  validateLeiChecksum,
} from "../validation";

export interface ComputeVatVerifyInput {
  parsed: ParsedVatVerifyInput;
  viesResult: ViesLookupResult | null;
  bicGleifEntity: SlimGleifEntity | null;
  bicGleifQueried: boolean;
  nowMs: number;
}

export function computeVatVerify(input: ComputeVatVerifyInput) {
  const { parsed, viesResult, bicGleifEntity, bicGleifQueried, nowMs } = input;
  const fraudFlags: string[] = [];
  let hardFail = false;
  let reviewFlag = false;

  // 1. VAT result
  let vatOut: Record<string, unknown> | null = null;
  let reverseChargeEligible: boolean | null = null;
  const vatIsoCountry = parsed.vat?.isoCountry ?? null;

  if (parsed.vat && viesResult) {
    reverseChargeEligible = viesResult.valid;
    if (!viesResult.valid) {
      fraudFlags.push(
        viesResult.viesStatus === "INVALID_INPUT" ? "VAT_INVALID_FORMAT" : "VAT_UNREGISTERED"
      );
      hardFail = true;
    }
    vatOut = {
      checked: true,
      input: parsed.vat.raw,
      vies_country_code: parsed.vat.viesCountry,
      iso_country_code: parsed.vat.isoCountry,
      vat_number: parsed.vat.vatNumber,
      valid: viesResult.valid,
      vies_status: viesResult.viesStatus,
      registered_name: viesResult.registeredName,
      registered_address: viesResult.registeredAddress,
      checked_at: viesResult.checkedAt,
    };
  }

  // 2. IBAN result
  let ibanOut: Record<string, unknown> | null = null;
  let ibanCountry: string | null = null;
  if (parsed.ibanRaw) {
    const ibanCheck = validateIbanChecksum(parsed.ibanRaw);
    ibanCountry = ibanCheck.countryCode;
    if (!ibanCheck.valid) {
      const flagByReason =
        ibanCheck.reason === "INVALID_COUNTRY_LENGTH"
          ? "IBAN_INVALID_LENGTH"
          : ibanCheck.reason === "UNSUPPORTED_IBAN_COUNTRY"
            ? "IBAN_UNSUPPORTED_COUNTRY"
            : ibanCheck.reason === "INVALID_CHARACTERS"
              ? "IBAN_INVALID_FORMAT"
              : "IBAN_INVALID_CHECKSUM";
      fraudFlags.push(flagByReason);
      hardFail = true;
    }
    ibanOut = {
      checked: true,
      normalized: ibanCheck.normalized,
      valid: ibanCheck.valid,
      country_code: ibanCheck.countryCode,
      check_digits: ibanCheck.checkDigits,
      bank_code: ibanCheck.bankCode,
      expected_length: ibanCheck.expectedLength,
      actual_length: ibanCheck.actualLength,
      sepa_member: ibanCheck.sepaMember,
      failure_reason: ibanCheck.reason,
    };
  }

  // 3. BIC result + live GLEIF bank entity resolution
  let bicOut: Record<string, unknown> | null = null;
  let bicCountry: string | null = null;
  if (parsed.bicRaw) {
    const bicCheck = validateBicCode(parsed.bicRaw);
    bicCountry = bicCheck.countryCode;
    if (!bicCheck.valid) {
      fraudFlags.push("BIC_INVALID_FORMAT");
      hardFail = true;
    } else if (bicGleifQueried && !bicGleifEntity) {
      fraudFlags.push("BIC_UNMAPPED_IN_GLEIF");
      reviewFlag = true;
    } else if (bicGleifEntity && bicGleifEntity.entityStatus !== "ACTIVE") {
      fraudFlags.push("BIC_BANK_ENTITY_INACTIVE");
      hardFail = true;
    }

    bicOut = {
      checked: true,
      normalized_8: bicCheck.normalized8,
      normalized_11: bicCheck.normalized11,
      valid_format: bicCheck.valid,
      bank_code: bicCheck.bankCode,
      country_code: bicCheck.countryCode,
      location_code: bicCheck.locationCode,
      branch_code: bicCheck.branchCode,
      is_head_office: bicCheck.isHeadOffice,
      gleif_bank_lei: bicGleifEntity?.lei ?? null,
      gleif_bank_name: bicGleifEntity?.legalName ?? null,
      gleif_entity_status: bicGleifEntity?.entityStatus ?? null,
      failure_reason: bicCheck.reason,
    };
  }

  // 4. LEI check-digit result
  let leiOut: Record<string, unknown> | null = null;
  if (parsed.leiRaw) {
    const leiCheck = validateLeiChecksum(parsed.leiRaw);
    if (!leiCheck.valid) {
      fraudFlags.push("LEI_INVALID_CHECKSUM");
      hardFail = true;
    }
    leiOut = {
      checked: true,
      normalized: leiCheck.normalized,
      valid: leiCheck.valid,
      lou_prefix: leiCheck.louPrefix,
      check_digits: leiCheck.checkDigits,
      failure_reason: leiCheck.reason,
    };
  }

  // 5. Cross-identifier country mismatch flags (B2B Business Email Compromise bank-redirect detection)
  if (vatIsoCountry && ibanCountry && vatIsoCountry !== ibanCountry) {
    fraudFlags.push("IBAN_VAT_COUNTRY_MISMATCH");
    reviewFlag = true;
  }
  if (ibanCountry && bicCountry && ibanCountry !== bicCountry) {
    fraudFlags.push("BIC_IBAN_COUNTRY_MISMATCH");
    reviewFlag = true;
  }
  if (parsed.expectedCountry) {
    if (vatIsoCountry && vatIsoCountry !== parsed.expectedCountry) {
      fraudFlags.push("VAT_EXPECTED_COUNTRY_MISMATCH");
      reviewFlag = true;
    }
    if (ibanCountry && ibanCountry !== parsed.expectedCountry) {
      fraudFlags.push("IBAN_EXPECTED_COUNTRY_MISMATCH");
      reviewFlag = true;
    }
    if (bicCountry && bicCountry !== parsed.expectedCountry) {
      fraudFlags.push("BIC_EXPECTED_COUNTRY_MISMATCH");
      reviewFlag = true;
    }
  }

  const presentCountries = [parsed.expectedCountry, vatIsoCountry, ibanCountry, bicCountry].filter(
    (c): c is string => c !== null
  );
  const allAligned = new Set(presentCountries).size <= 1;

  const invoiceGate: "PASS" | "REVIEW" | "FAIL" = hardFail
    ? "FAIL"
    : reviewFlag
      ? "REVIEW"
      : "PASS";

  const sources: string[] = [];
  if (parsed.vat) sources.push("eu_vies");
  if (parsed.ibanRaw) sources.push("iso_13616_iban");
  if (parsed.bicRaw) sources.push(bicGleifQueried ? "gleif_bic_registry" : "iso_9362_bic");
  if (parsed.leiRaw) sources.push("iso_17442_lei");

  return {
    invoice_gate: invoiceGate,
    reverse_charge_eligible: reverseChargeEligible,
    fraud_flags: fraudFlags,
    vat: vatOut,
    iban: ibanOut,
    bic: bicOut,
    lei: leiOut,
    country_consistency: {
      expected_country: parsed.expectedCountry,
      vat_country: vatIsoCountry,
      iban_country: ibanCountry,
      bic_country: bicCountry,
      all_aligned: allAligned,
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: COMMERCE_DISCLAIMER,
    },
  };
}
