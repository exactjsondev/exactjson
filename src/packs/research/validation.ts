import type { ValidationResult } from "../../lib/validation";

const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;
const DOI_SYNTAX_REGEX = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9<>+[\]]+$/;
const ARXIV_MODERN_REGEX = /^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?$/i;
const ARXIV_LEGACY_REGEX = /^arxiv:\s*([a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;
const CAS_RN_REGEX = /^([1-9]\d{1,6})-(\d{2})-(\d)$/;
const INCHIKEY_REGEX = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;
const CID_PREFIX_REGEX = /^(?:cid:\s*)?(\d{1,9})$/i;
const SAFE_CHEM_NAME_REGEX =
  /^[A-Za-z0-9\u0391-\u03C9][A-Za-z0-9\u0391-\u03C9\s,()[\]+\-'.,:;]{0,119}$/;
const NCT_ID_REGEX = /^nct\d{8}$/i;

export interface CitationVerifyInput {
  mode: "doi" | "bibliographic";
  doi: string | null;
  query: string | null;
  expectedTitle: string | null;
  expectedAuthor: string | null;
  expectedYear: number | null;
}

export function normalizeDoiInput(raw: string): ValidationResult<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Parameter 'doi' cannot be empty." };
  }
  if (trimmed.length > 220 || CONTROL_CHAR_REGEX.test(trimmed)) {
    return { ok: false, error: "Invalid DOI parameter (too long or contains control characters)." };
  }

  const modernArxiv = ARXIV_MODERN_REGEX.exec(trimmed);
  if (modernArxiv?.[1]) {
    return { ok: true, value: `10.48550/arxiv.${modernArxiv[1]}` };
  }

  const legacyArxiv = ARXIV_LEGACY_REGEX.exec(trimmed);
  if (legacyArxiv?.[1]) {
    return { ok: true, value: `10.48550/arxiv.${legacyArxiv[1].toLowerCase()}` };
  }

  let candidate = trimmed;
  const urlMatch = /^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i.exec(candidate);
  if (urlMatch?.[1]) {
    try {
      candidate = decodeURIComponent(urlMatch[1]).trim();
    } catch {
      candidate = urlMatch[1].trim();
    }
  } else if (/^doi:\s*/i.test(candidate)) {
    candidate = candidate.replace(/^doi:\s*/i, "").trim();
  }

  // Strip version suffix on canonical arXiv DataCite DOIs (e.g. 10.48550/arXiv.1706.03762v7 -> 10.48550/arXiv.1706.03762)
  candidate = candidate.replace(
    /^(10\.48550\/arxiv\.(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7}))v\d+$/i,
    "$1",
  );

  if (
    candidate.length < 7 ||
    candidate.length > 160 ||
    /\.\.(?:\/|\\|$)/.test(candidate) ||
    !DOI_SYNTAX_REGEX.test(candidate)
  ) {
    return {
      ok: false,
      error:
        "Invalid DOI format. Expected '10.xxxx/...' (e.g., '10.1038/s41586-021-03819-2'), 'https://doi.org/...', or 'arXiv:1706.03762'.",
    };
  }

  return { ok: true, value: candidate.toLowerCase() };
}

export function parseCitationVerifyInput(raw: {
  doi?: string;
  query?: string;
  expected_title?: string;
  expected_author?: string;
  expected_year?: string;
}): ValidationResult<CitationVerifyInput> {
  let doi: string | null = null;
  if (raw.doi !== undefined && raw.doi.trim().length > 0) {
    const parsedDoi = normalizeDoiInput(raw.doi);
    if (!parsedDoi.ok) return parsedDoi;
    doi = parsedDoi.value;
  }

  let query: string | null = null;
  if (raw.query !== undefined && raw.query.trim().length > 0) {
    const trimmedQuery = raw.query.trim();
    if (
      trimmedQuery.length < 4 ||
      trimmedQuery.length > 240 ||
      CONTROL_CHAR_REGEX.test(trimmedQuery)
    ) {
      return {
        ok: false,
        error: "Parameter 'query' must be 4 to 240 printable characters.",
      };
    }
    query = trimmedQuery;
  }

  if (doi === null && query === null) {
    return {
      ok: false,
      error:
        "Provide at least one of 'doi' (e.g., '10.1038/s41586-021-03819-2' or 'arXiv:1706.03762') or 'query' (bibliographic citation string).",
    };
  }

  let expectedTitle: string | null = null;
  if (raw.expected_title !== undefined && raw.expected_title.trim().length > 0) {
    const t = raw.expected_title.trim();
    if (t.length < 3 || t.length > 240 || CONTROL_CHAR_REGEX.test(t)) {
      return {
        ok: false,
        error: "Parameter 'expected_title' must be 3 to 240 printable characters.",
      };
    }
    expectedTitle = t;
  }

  let expectedAuthor: string | null = null;
  if (raw.expected_author !== undefined && raw.expected_author.trim().length > 0) {
    const a = raw.expected_author.trim();
    if (a.length < 2 || a.length > 80 || CONTROL_CHAR_REGEX.test(a)) {
      return {
        ok: false,
        error: "Parameter 'expected_author' must be 2 to 80 printable characters.",
      };
    }
    expectedAuthor = a;
  }

  let expectedYear: number | null = null;
  if (raw.expected_year !== undefined && raw.expected_year.trim().length > 0) {
    const yStr = raw.expected_year.trim();
    if (yStr.length > 8) {
      return {
        ok: false,
        error: "Parameter 'expected_year' must be an integer between 1665 and 2100.",
      };
    }
    const yNum = Number(yStr);
    if (!Number.isInteger(yNum) || yNum < 1665 || yNum > 2100) {
      return {
        ok: false,
        error: "Parameter 'expected_year' must be an integer between 1665 and 2100.",
      };
    }
    expectedYear = yNum;
  }

  return {
    ok: true,
    value: {
      mode: doi !== null ? "doi" : "bibliographic",
      doi,
      query,
      expectedTitle,
      expectedAuthor,
      expectedYear,
    },
  };
}

export function isValidCasRegistryNumber(cas: string): boolean {
  const match = CAS_RN_REGEX.exec(cas);
  if (!match) return false;
  const digits = `${match[1]}${match[2]}`;
  const checkDigit = Number(match[3]);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += d * (i + 1);
  }
  return sum % 10 === checkDigit;
}

export type ChemLookupKind = "cid" | "cas" | "inchikey" | "name";

export interface ChemHazardInput {
  kind: ChemLookupKind;
  rawQuery: string;
  normalizedValue: string;
}

export function parseChemHazardInput(
  rawQuery: string | undefined,
): ValidationResult<ChemHazardInput> {
  if (rawQuery === undefined || rawQuery.trim().length === 0) {
    return {
      ok: false,
      error:
        "Query parameter 'query' is required (chemical name, CAS RN like '71-43-2', PubChem CID like '241', or InChIKey).",
    };
  }
  const trimmed = rawQuery.trim();
  if (trimmed.length > 120 || CONTROL_CHAR_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: "Parameter 'query' must be 1 to 120 printable characters.",
    };
  }

  const cidMatch = CID_PREFIX_REGEX.exec(trimmed);
  if (cidMatch?.[1]) {
    const cidNum = Number(cidMatch[1]);
    if (!Number.isSafeInteger(cidNum) || cidNum <= 0) {
      return { ok: false, error: "Invalid PubChem CID (must be a positive integer)." };
    }
    return {
      ok: true,
      value: {
        kind: "cid",
        rawQuery: trimmed,
        normalizedValue: String(cidNum),
      },
    };
  }

  if (CAS_RN_REGEX.test(trimmed)) {
    if (!isValidCasRegistryNumber(trimmed)) {
      return {
        ok: false,
        error: `Invalid CAS Registry Number '${trimmed}': check digit failed deterministic CAS MOD-10 verification.`,
      };
    }
    return {
      ok: true,
      value: {
        kind: "cas",
        rawQuery: trimmed,
        normalizedValue: trimmed,
      },
    };
  }

  const upper = trimmed.toUpperCase();
  if (INCHIKEY_REGEX.test(upper)) {
    return {
      ok: true,
      value: {
        kind: "inchikey",
        rawQuery: trimmed,
        normalizedValue: upper,
      },
    };
  }

  if (!SAFE_CHEM_NAME_REGEX.test(trimmed)) {
    return {
      ok: false,
      error:
        "Invalid chemical 'query': slashes, URL fragments, and special query characters are not allowed.",
    };
  }

  return {
    ok: true,
    value: {
      kind: "name",
      rawQuery: trimmed,
      normalizedValue: trimmed.replace(/\s+/g, " ").toLowerCase(),
    },
  };
}

export type TrialPhaseScope = "PHASE2_3" | "PHASE3" | "PHASE2" | "PHASE1" | "PHASE4" | "ALL";

const VALID_PHASE_SCOPES: ReadonlySet<TrialPhaseScope> = new Set([
  "PHASE2_3",
  "PHASE3",
  "PHASE2",
  "PHASE1",
  "PHASE4",
  "ALL",
]);

export interface DrugTrialInput {
  drug: string | null;
  nct: string | null;
  condition: string | null;
  phaseScope: TrialPhaseScope;
  limit: number;
}

export function parseDrugTrialInput(raw: {
  drug?: string;
  nct?: string;
  condition?: string;
  phase?: string;
  limit?: string;
}): ValidationResult<DrugTrialInput> {
  let nct: string | null = null;
  if (raw.nct !== undefined && raw.nct.trim().length > 0) {
    const trimmedNct = raw.nct.trim();
    if (!NCT_ID_REGEX.test(trimmedNct)) {
      return {
        ok: false,
        error:
          "Invalid 'nct' identifier: expected 'NCT' followed by 8 digits (e.g., 'NCT05382286').",
      };
    }
    nct = trimmedNct.toUpperCase();
  }

  let drug: string | null = null;
  if (raw.drug !== undefined && raw.drug.trim().length > 0) {
    const trimmedDrug = raw.drug.trim();
    if (
      trimmedDrug.length < 2 ||
      trimmedDrug.length > 120 ||
      CONTROL_CHAR_REGEX.test(trimmedDrug)
    ) {
      return {
        ok: false,
        error: "Parameter 'drug' must be 2 to 120 printable characters.",
      };
    }
    if (NCT_ID_REGEX.test(trimmedDrug)) {
      const upperDrugNct = trimmedDrug.toUpperCase();
      if (nct === null) {
        nct = upperDrugNct;
      } else if (nct !== upperDrugNct) {
        return {
          ok: false,
          error: "Conflicting NCT IDs supplied in 'drug' and 'nct' parameters.",
        };
      }
    } else {
      drug = trimmedDrug;
    }
  }

  let condition: string | null = null;
  if (raw.condition !== undefined && raw.condition.trim().length > 0) {
    const trimmedCond = raw.condition.trim();
    if (
      trimmedCond.length < 2 ||
      trimmedCond.length > 120 ||
      CONTROL_CHAR_REGEX.test(trimmedCond)
    ) {
      return {
        ok: false,
        error: "Parameter 'condition' must be 2 to 120 printable characters.",
      };
    }
    condition = trimmedCond;
  }

  if (drug === null && nct === null && condition === null) {
    return {
      ok: false,
      error:
        "Provide at least one of 'drug' (e.g., 'semaglutide'), 'nct' (e.g., 'NCT05382286'), or 'condition' (e.g., 'obesity').",
    };
  }

  let phaseScope: TrialPhaseScope = "PHASE2_3";
  if (raw.phase !== undefined && raw.phase.trim().length > 0) {
    const normalizedPhase = raw.phase.trim().toUpperCase() as TrialPhaseScope;
    if (!VALID_PHASE_SCOPES.has(normalizedPhase)) {
      return {
        ok: false,
        error:
          "Invalid 'phase' filter. Supported values: PHASE2_3, PHASE3, PHASE2, PHASE1, PHASE4, ALL.",
      };
    }
    phaseScope = normalizedPhase;
  }

  let limit = 8;
  if (raw.limit !== undefined && raw.limit.trim().length > 0) {
    const lStr = raw.limit.trim();
    const lNum = Number(lStr);
    if (lStr.length > 8 || !Number.isInteger(lNum) || lNum < 1 || lNum > 15) {
      return {
        ok: false,
        error: "Parameter 'limit' must be an integer between 1 and 15.",
      };
    }
    limit = lNum;
  }

  return {
    ok: true,
    value: {
      drug,
      nct,
      condition,
      phaseScope,
      limit,
    },
  };
}
