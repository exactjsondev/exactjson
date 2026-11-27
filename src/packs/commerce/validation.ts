import {
  COUNTRIES_BY_ALPHA2,
  SEPA_COUNTRIES,
  lookupStaticCountry,
  type StaticCountry,
} from "../../lib/countries";
import type { ValidationResult } from "../../lib/validation";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const IBAN_FORMAT_RE = /^([A-Z]{2})([0-9]{2})([A-Z0-9]{10,30})$/;
const BIC_FORMAT_RE = /^([A-Z]{4})([A-Z]{2})([A-Z0-9]{2})([A-Z0-9]{3})?$/;
const LEI_FORMAT_RE = /^([0-9A-Z]{4})([0-9A-Z]{14})([0-9]{2})$/;
const ISIN_FORMAT_RE = /^([A-Z]{2})([A-Z0-9]{9})([0-9])$/;
const CIK_FORMAT_RE = /^\d{1,10}$/;

// Official SWIFT ISO 13616 IBAN country lengths (~88 participating jurisdictions)
const IBAN_LENGTH_BY_COUNTRY: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  DZ: 26,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GG: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IM: 22,
  IQ: 23,
  IS: 26,
  IT: 27,
  JE: 22,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MA: 28,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

// BBAN [start, end] character slice indices relative to full IBAN string (index 4 = start of BBAN)
const IBAN_BANK_SLICE_BY_COUNTRY: Readonly<Record<string, readonly [number, number]>> = {
  AE: [4, 7],
  AT: [4, 9],
  BE: [4, 7],
  CH: [4, 9],
  DE: [4, 12],
  DK: [4, 8],
  ES: [4, 8],
  FI: [4, 7],
  FR: [4, 9],
  GB: [4, 8],
  IE: [4, 8],
  IT: [5, 10], // index 4 is 1-char CIN
  LU: [4, 7],
  NL: [4, 8],
  NO: [4, 8],
  PL: [4, 12],
  PT: [4, 8],
  SA: [4, 6],
  SE: [4, 7],
};

// EU-27 VIES member state prefixes + Northern Ireland Windsor Framework (XI)
export const VIES_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "EL",
  "ES",
  "FI",
  "FR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  "XI",
]);

const SUPRANATIONAL_ISIN_PREFIXES: ReadonlySet<string> = new Set(["XS", "EU", "XA", "XB", "XC", "XD"]);

function computeMod97(alphanumericUpper: string): number {
  let digits = "";
  for (let i = 0; i < alphanumericUpper.length; i++) {
    const code = alphanumericUpper.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      digits += alphanumericUpper[i]!;
    } else if (code >= 65 && code <= 90) {
      digits += String(code - 55);
    } else {
      return -1;
    }
  }
  return Number(BigInt(digits) % 97n);
}

export interface IbanCheckResult {
  valid: boolean;
  normalized: string;
  countryCode: string | null;
  checkDigits: string | null;
  bankCode: string | null;
  expectedLength: number | null;
  actualLength: number;
  sepaMember: boolean;
  reason:
    | null
    | "INVALID_CHARACTERS"
    | "UNSUPPORTED_IBAN_COUNTRY"
    | "INVALID_COUNTRY_LENGTH"
    | "CHECKSUM_MISMATCH";
}

export function validateIbanChecksum(raw: string): IbanCheckResult {
  const normalized = raw.replace(/[\s-]+/g, "").toUpperCase();
  const match = IBAN_FORMAT_RE.exec(normalized);
  if (!match) {
    const maybeCountry = /^[A-Z]{2}/.test(normalized) ? normalized.slice(0, 2) : null;
    const expectedLen =
      maybeCountry && Object.hasOwn(IBAN_LENGTH_BY_COUNTRY, maybeCountry)
        ? IBAN_LENGTH_BY_COUNTRY[maybeCountry]!
        : null;
    return {
      valid: false,
      normalized,
      countryCode: maybeCountry,
      checkDigits: null,
      bankCode: null,
      expectedLength: expectedLen,
      actualLength: normalized.length,
      sepaMember: maybeCountry ? SEPA_COUNTRIES.has(maybeCountry) : false,
      reason: "INVALID_CHARACTERS",
    };
  }

  const countryCode = match[1]!;
  const checkDigits = match[2]!;
  const sepaMember = SEPA_COUNTRIES.has(countryCode);

  if (!Object.hasOwn(IBAN_LENGTH_BY_COUNTRY, countryCode)) {
    return {
      valid: false,
      normalized,
      countryCode,
      checkDigits,
      bankCode: null,
      expectedLength: null,
      actualLength: normalized.length,
      sepaMember,
      reason: "UNSUPPORTED_IBAN_COUNTRY",
    };
  }

  const expectedLength = IBAN_LENGTH_BY_COUNTRY[countryCode]!;
  if (normalized.length !== expectedLength) {
    return {
      valid: false,
      normalized,
      countryCode,
      checkDigits,
      bankCode: null,
      expectedLength,
      actualLength: normalized.length,
      sepaMember,
      reason: "INVALID_COUNTRY_LENGTH",
    };
  }

  const rearranged = `${normalized.slice(4)}${normalized.slice(0, 4)}`;
  const mod = computeMod97(rearranged);
  const sliceSpec = Object.hasOwn(IBAN_BANK_SLICE_BY_COUNTRY, countryCode)
    ? IBAN_BANK_SLICE_BY_COUNTRY[countryCode]!
    : ([4, 8] as const);
  const bankCode = normalized.slice(sliceSpec[0], sliceSpec[1]);

  // ISO 13616 / ISO 7064 MOD 97-10 check digits are 98 - (N mod 97), so 00, 01, and 99 are strictly invalid
  if (checkDigits === "00" || checkDigits === "01" || checkDigits === "99" || mod !== 1) {
    return {
      valid: false,
      normalized,
      countryCode,
      checkDigits,
      bankCode,
      expectedLength,
      actualLength: normalized.length,
      sepaMember,
      reason: "CHECKSUM_MISMATCH",
    };
  }

  return {
    valid: true,
    normalized,
    countryCode,
    checkDigits,
    bankCode,
    expectedLength,
    actualLength: normalized.length,
    sepaMember,
    reason: null,
  };
}

export interface BicCheckResult {
  valid: boolean;
  normalized8: string;
  normalized11: string;
  bankCode: string | null;
  countryCode: string | null;
  locationCode: string | null;
  branchCode: string | null;
  isHeadOffice: boolean;
  reason: null | "INVALID_BIC_FORMAT" | "UNKNOWN_ISO_COUNTRY";
}

export function validateBicCode(raw: string): BicCheckResult {
  const cleaned = raw.trim().toUpperCase();
  const m = BIC_FORMAT_RE.exec(cleaned);
  if (!m) {
    return {
      valid: false,
      normalized8: cleaned.slice(0, 8),
      normalized11: cleaned,
      bankCode: null,
      countryCode: null,
      locationCode: null,
      branchCode: null,
      isHeadOffice: false,
      reason: "INVALID_BIC_FORMAT",
    };
  }

  const bankCode = m[1]!;
  const countryCode = m[2]!;
  const locationCode = m[3]!;
  const branchCode = m[4] ?? "XXX";
  const normalized8 = `${bankCode}${countryCode}${locationCode}`;
  const normalized11 = `${normalized8}${branchCode}`;

  if (!COUNTRIES_BY_ALPHA2.has(countryCode)) {
    return {
      valid: false,
      normalized8,
      normalized11,
      bankCode,
      countryCode,
      locationCode,
      branchCode,
      isHeadOffice: branchCode === "XXX",
      reason: "UNKNOWN_ISO_COUNTRY",
    };
  }

  return {
    valid: true,
    normalized8,
    normalized11,
    bankCode,
    countryCode,
    locationCode,
    branchCode,
    isHeadOffice: branchCode === "XXX",
    reason: null,
  };
}

export interface LeiCheckResult {
  valid: boolean;
  normalized: string;
  louPrefix: string | null;
  checkDigits: string | null;
  reason: null | "INVALID_LEI_FORMAT" | "CHECKSUM_MISMATCH";
}

export function validateLeiChecksum(raw: string): LeiCheckResult {
  const cleaned = raw.trim().toUpperCase();
  const m = LEI_FORMAT_RE.exec(cleaned);
  if (!m) {
    return {
      valid: false,
      normalized: cleaned,
      louPrefix: null,
      checkDigits: null,
      reason: "INVALID_LEI_FORMAT",
    };
  }
  const louPrefix = m[1]!;
  const checkDigits = m[3]!;
  if (checkDigits === "00" || checkDigits === "01" || checkDigits === "99") {
    return {
      valid: false,
      normalized: cleaned,
      louPrefix,
      checkDigits,
      reason: "CHECKSUM_MISMATCH",
    };
  }
  const mod = computeMod97(cleaned);
  if (mod !== 1) {
    return {
      valid: false,
      normalized: cleaned,
      louPrefix,
      checkDigits,
      reason: "CHECKSUM_MISMATCH",
    };
  }
  return {
    valid: true,
    normalized: cleaned,
    louPrefix,
    checkDigits,
    reason: null,
  };
}

export interface IsinCheckResult {
  valid: boolean;
  normalized: string;
  countryCode: string | null;
}

export function validateIsinChecksum(raw: string): IsinCheckResult {
  const cleaned = raw.trim().toUpperCase();
  const m = ISIN_FORMAT_RE.exec(cleaned);
  if (!m) {
    return { valid: false, normalized: cleaned, countryCode: null };
  }
  const countryCode = m[1]!;
  if (!COUNTRIES_BY_ALPHA2.has(countryCode) && !SUPRANATIONAL_ISIN_PREFIXES.has(countryCode)) {
    return { valid: false, normalized: cleaned, countryCode };
  }

  let digits = "";
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    digits += code >= 65 && code <= 90 ? String(code - 55) : cleaned[i]!;
  }

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const fromRight = digits.length - 1 - i;
    let d = digits.charCodeAt(i) - 48;
    if (fromRight % 2 === 1) {
      d *= 2;
      if (d > 9) d = Math.floor(d / 10) + (d % 10);
    }
    sum += d;
  }

  return {
    valid: sum % 10 === 0,
    normalized: cleaned,
    countryCode,
  };
}

function validateStrictIsoDate(raw: string): ValidationResult<string> {
  const trimmed = raw.trim();
  const m = ISO_DATE_RE.exec(trimmed);
  if (!m) {
    return { ok: false, error: "Invalid 'date' parameter (expected YYYY-MM-DD)." };
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, error: "Invalid calendar 'date' (expected real date in 2000..2100)." };
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, error: `Impossible calendar date '${trimmed}'.` };
  }
  return { ok: true, value: trimmed };
}

export type SettlementTenor = "T+0" | "T+1" | "T+2";

export interface ParsedSettlementWindowInput {
  from: StaticCountry;
  to: StaticCountry;
  date: string;
  tenor: SettlementTenor;
  amount: number | null;
}

export function parseSettlementWindowInput(
  query: {
    from?: string;
    to?: string;
    date?: string;
    tenor?: string;
    amount?: string;
  },
  nowMs: number = Date.now()
): ValidationResult<ParsedSettlementWindowInput> {
  if (!query.from?.trim()) {
    return { ok: false, error: "Query parameter 'from' is required (e.g., US, GB, DE, AE, SA)." };
  }
  if (!query.to?.trim()) {
    return { ok: false, error: "Query parameter 'to' is required (e.g., JP, IE, SG, SA)." };
  }
  if (query.from.trim().length > 64 || query.to.trim().length > 64) {
    return { ok: false, error: "Country parameters 'from' and 'to' must be <= 64 characters." };
  }

  const from = lookupStaticCountry(query.from);
  if (!from) {
    return {
      ok: false,
      error: `Unknown origin country '${query.from.trim()}'. Use an ISO-3166 alpha-2/alpha-3 code or standard country name.`,
    };
  }

  const to = lookupStaticCountry(query.to);
  if (!to) {
    return {
      ok: false,
      error: `Unknown destination country '${query.to.trim()}'. Use an ISO-3166 alpha-2/alpha-3 code or standard country name.`,
    };
  }

  let dateStr: string;
  if (query.date !== undefined && query.date.trim().length > 0) {
    const parsedDate = validateStrictIsoDate(query.date);
    if (!parsedDate.ok) return parsedDate;
    dateStr = parsedDate.value;
  } else {
    dateStr = new Date(nowMs).toISOString().slice(0, 10);
  }

  let tenor: SettlementTenor = "T+2";
  if (query.tenor !== undefined && query.tenor.trim().length > 0) {
    const upperTenor = query.tenor.trim().toUpperCase();
    if (upperTenor !== "T+0" && upperTenor !== "T+1" && upperTenor !== "T+2") {
      return { ok: false, error: "Invalid 'tenor' parameter (expected T+0, T+1, or T+2)." };
    }
    tenor = upperTenor;
  }

  let amount: number | null = null;
  if (query.amount !== undefined && query.amount.trim().length > 0) {
    const trimmedAmt = query.amount.trim();
    if (!/^\d+(?:\.\d+)?$/.test(trimmedAmt)) {
      return {
        ok: false,
        error: "Invalid 'amount' parameter (expected positive number between 0.01 and 1000000000).",
      };
    }
    const num = Number(trimmedAmt);
    if (!Number.isFinite(num) || num < 0.01 || num > 1_000_000_000) {
      return {
        ok: false,
        error: "Parameter 'amount' must be between 0.01 and 1000000000.",
      };
    }
    amount = num;
  }

  return {
    ok: true,
    value: { from, to, date: dateStr, tenor, amount },
  };
}

export interface ParsedVatIdentifier {
  raw: string;
  viesCountry: string;
  isoCountry: string;
  vatNumber: string;
}

export interface ParsedVatVerifyInput {
  vat: ParsedVatIdentifier | null;
  ibanRaw: string | null;
  bicRaw: string | null;
  leiRaw: string | null;
  expectedCountry: string | null;
}

export function parseVatVerifyInput(query: {
  vat?: string;
  iban?: string;
  bic?: string;
  lei?: string;
  country?: string;
}): ValidationResult<ParsedVatVerifyInput> {
  const hasVat = Boolean(query.vat?.trim());
  const hasIban = Boolean(query.iban?.trim());
  const hasBic = Boolean(query.bic?.trim());
  const hasLei = Boolean(query.lei?.trim());

  if (!hasVat && !hasIban && !hasBic && !hasLei) {
    return {
      ok: false,
      error: "Supply at least one identifier: 'vat' (EU-27 + XI), 'iban', 'bic', or 'lei'.",
    };
  }

  let expectedCountry: string | null = null;
  let explicitVatPrefixHint: string | null = null;
  if (query.country !== undefined && query.country.trim().length > 0) {
    const rawCountry = query.country.trim().toUpperCase();
    if (rawCountry === "XI") {
      expectedCountry = "GB";
      explicitVatPrefixHint = "XI";
    } else if (rawCountry === "EL") {
      expectedCountry = "GR";
      explicitVatPrefixHint = "EL";
    } else {
      const resolved = lookupStaticCountry(rawCountry);
      if (!resolved) {
        return { ok: false, error: `Unknown ISO country '${query.country.trim()}'.` };
      }
      expectedCountry = resolved.alpha2;
      explicitVatPrefixHint = resolved.alpha2 === "GR" ? "EL" : resolved.alpha2;
    }
  }

  let parsedVat: ParsedVatIdentifier | null = null;
  if (hasVat) {
    const compact = query.vat!.replace(/[\s.-]+/g, "").toUpperCase();
    if (compact.length < 4 || compact.length > 20 || !/^[A-Z0-9]+$/.test(compact)) {
      return {
        ok: false,
        error: "Invalid 'vat' format (expected 4-20 alphanumeric characters, e.g., IE6388047V or DE122268496).",
      };
    }

    let prefix: string;
    let body: string;
    if (/^[A-Z]{2}/.test(compact)) {
      prefix = compact.slice(0, 2);
      body = compact.slice(2);
    } else if (explicitVatPrefixHint) {
      prefix = explicitVatPrefixHint;
      body = compact;
    } else {
      return {
        ok: false,
        error:
          "VAT number must start with a 2-letter country prefix (e.g., IE6388047V, DE122268496, EL094019245, XI123456789).",
      };
    }

    const viesCountry = prefix === "GR" ? "EL" : prefix;
    if (!VIES_COUNTRY_CODES.has(viesCountry)) {
      return {
        ok: false,
        error: `Unsupported VAT jurisdiction '${prefix}'. EU Commission VIES covers EU-27 + XI (Northern Ireland); UK domestic GB VAT requires UK HMRC.`,
      };
    }
    if (body.length < 2 || body.length > 16) {
      return {
        ok: false,
        error: `Invalid VAT body length for '${viesCountry}'.`,
      };
    }
    const isoCountry = viesCountry === "EL" ? "GR" : viesCountry === "XI" ? "GB" : viesCountry;
    parsedVat = {
      raw: `${prefix}${body}`,
      viesCountry,
      isoCountry,
      vatNumber: body,
    };
  }

  if (hasIban && query.iban!.trim().length > 42) {
    return { ok: false, error: "Parameter 'iban' exceeds maximum length of 42 characters." };
  }
  if (hasBic && (query.bic!.trim().length < 8 || query.bic!.trim().length > 11)) {
    return { ok: false, error: "Parameter 'bic' must be 8 or 11 characters." };
  }
  if (hasLei && query.lei!.trim().length !== 20) {
    return { ok: false, error: "Parameter 'lei' must be exactly 20 characters." };
  }

  return {
    ok: true,
    value: {
      vat: parsedVat,
      ibanRaw: hasIban ? query.iban!.trim() : null,
      bicRaw: hasBic ? query.bic!.trim() : null,
      leiRaw: hasLei ? query.lei!.trim() : null,
      expectedCountry,
    },
  };
}

export interface ParsedCompanyVerifyInput {
  query: string | null;
  lei: string | null;
  cik: string | null;
  bic: string | null;
  isin: string | null;
  country: string | null;
}

export function parseCompanyVerifyInput(raw: {
  query?: string;
  lei?: string;
  cik?: string;
  bic?: string;
  isin?: string;
  country?: string;
}): ValidationResult<ParsedCompanyVerifyInput> {
  const q = raw.query?.trim() || null;
  const leiRaw = raw.lei?.trim() || null;
  const cikRaw = raw.cik?.trim() || null;
  const bicRaw = raw.bic?.trim() || null;
  const isinRaw = raw.isin?.trim() || null;

  if (!q && !leiRaw && !cikRaw && !bicRaw && !isinRaw) {
    return {
      ok: false,
      error: "Supply at least one corporate identifier: 'query' (name), 'lei', 'cik', 'bic', or 'isin'.",
    };
  }

  if (q && (q.length < 2 || q.length > 120)) {
    return { ok: false, error: "Parameter 'query' must be between 2 and 120 characters." };
  }

  let lei: string | null = null;
  if (leiRaw) {
    const check = validateLeiChecksum(leiRaw);
    if (!check.valid) {
      return {
        ok: false,
        error: "Invalid 'lei' parameter (expected valid 20-character ISO 17442 LEI passing MOD 97-10).",
      };
    }
    lei = check.normalized;
  }

  // If caller passed a 20-char valid LEI inside `query`, promote it seamlessly
  if (!lei && q && q.length === 20) {
    const maybeLei = validateLeiChecksum(q);
    if (maybeLei.valid) {
      lei = maybeLei.normalized;
    }
  }

  let cik: string | null = null;
  if (cikRaw) {
    const stripped = cikRaw.replace(/^CIK/i, "");
    if (!CIK_FORMAT_RE.test(stripped) || Number(stripped) === 0) {
      return { ok: false, error: "Invalid 'cik' parameter (expected 1-10 digit SEC CIK)." };
    }
    cik = stripped.padStart(10, "0");
  }

  let bic: string | null = null;
  if (bicRaw) {
    const check = validateBicCode(bicRaw);
    if (!check.valid) {
      return { ok: false, error: "Invalid 'bic' parameter (expected 8- or 11-character ISO 9362 SWIFT/BIC)." };
    }
    bic = check.normalized11;
  }

  let isin: string | null = null;
  if (isinRaw) {
    const check = validateIsinChecksum(isinRaw);
    if (!check.valid) {
      return { ok: false, error: "Invalid 'isin' parameter (expected valid 12-character ISO 6166 ISIN)." };
    }
    isin = check.normalized;
  }

  let country: string | null = null;
  if (raw.country !== undefined && raw.country.trim().length > 0) {
    const resolved = lookupStaticCountry(raw.country);
    if (!resolved) {
      return { ok: false, error: `Unknown 'country' filter '${raw.country.trim()}'.` };
    }
    country = resolved.alpha2;
  }

  return {
    ok: true,
    value: { query: q, lei, cik, bic, isin, country },
  };
}

export type RecallCategory = "all" | "consumer" | "food" | "drug" | "device";

export interface ParsedSafetyRecallInput {
  query: string;
  brand: string | null;
  category: RecallCategory;
}

const RECALL_CATEGORIES: ReadonlySet<string> = new Set(["all", "consumer", "food", "drug", "device"]);

export function parseSafetyRecallInput(raw: {
  query?: string;
  brand?: string;
  category?: string;
}): ValidationResult<ParsedSafetyRecallInput> {
  const q = raw.query?.trim() ?? "";
  if (q.length < 3 || q.length > 100) {
    return {
      ok: false,
      error: "Query parameter 'query' is required (3-100 characters, e.g., stroller, lithium power bank, infant formula).",
    };
  }
  if (!/[\p{L}\p{N}]{2,}/u.test(q)) {
    return {
      ok: false,
      error: "Query parameter 'query' must contain at least 2 alphanumeric search characters.",
    };
  }

  let brand: string | null = null;
  if (raw.brand !== undefined && raw.brand.trim().length > 0) {
    const b = raw.brand.trim();
    if (b.length < 2 || b.length > 80 || !/[\p{L}\p{N}]/u.test(b)) {
      return {
        ok: false,
        error: "Parameter 'brand' must be 2-80 characters and contain alphanumeric letters or digits.",
      };
    }
    brand = b;
  }

  let category: RecallCategory = "all";
  if (raw.category !== undefined && raw.category.trim().length > 0) {
    const cat = raw.category.trim().toLowerCase();
    if (!RECALL_CATEGORIES.has(cat)) {
      return {
        ok: false,
        error: "Invalid 'category' parameter (expected all, consumer, food, drug, or device).",
      };
    }
    category = cat as RecallCategory;
  }

  return {
    ok: true,
    value: { query: q, brand, category },
  };
}
