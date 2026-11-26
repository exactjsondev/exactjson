import type { ValidationResult } from "../../lib/validation";

export type PackageEcosystem = "npm" | "pypi" | "cargo";

export interface ParsedPackageInput {
  packageName: string;
  ecosystem: PackageEcosystem;
  depsDevSystem: "npm" | "pypi" | "cargo";
  osvEcosystem: "npm" | "PyPI" | "crates.io";
  version: string | null;
}

const ECOSYSTEM_ALIASES: Readonly<Record<string, PackageEcosystem>> = {
  npm: "npm",
  node: "npm",
  nodejs: "npm",
  js: "npm",
  pypi: "pypi",
  pip: "pypi",
  python: "pypi",
  py: "pypi",
  cargo: "cargo",
  crates: "cargo",
  "crates.io": "cargo",
  rust: "cargo",
};

const NPM_PKG_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PYPI_PKG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const CARGO_PKG_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_~-]{0,63}$/;

export function parsePackageInput(
  rawPkg: string | undefined,
  rawEco: string | undefined,
  rawVersion: string | undefined
): ValidationResult<ParsedPackageInput> {
  if (!rawPkg?.trim()) {
    return { ok: false, error: "Query parameter 'package' is required." };
  }
  const pkgTrimmed = rawPkg.trim();
  if (pkgTrimmed.length > 214 || pkgTrimmed.includes("..") || pkgTrimmed.includes("\\")) {
    return { ok: false, error: "Invalid 'package' name." };
  }

  let ecosystem: PackageEcosystem = "npm";
  if (rawEco !== undefined && rawEco.trim().length > 0) {
    const key = rawEco.trim().toLowerCase();
    const mapped = Object.hasOwn(ECOSYSTEM_ALIASES, key) ? ECOSYSTEM_ALIASES[key] : undefined;
    if (!mapped) {
      return {
        ok: false,
        error: `Unsupported ecosystem '${rawEco.trim()}'. Supported values: npm, pypi, cargo.`,
      };
    }
    ecosystem = mapped;
  }

  if (ecosystem === "npm" && !NPM_PKG_RE.test(pkgTrimmed)) {
    return { ok: false, error: "Invalid npm package name." };
  }
  if (ecosystem === "pypi" && !PYPI_PKG_RE.test(pkgTrimmed)) {
    return { ok: false, error: "Invalid PyPI package name." };
  }
  if (ecosystem === "cargo" && !CARGO_PKG_RE.test(pkgTrimmed)) {
    return { ok: false, error: "Invalid Cargo crate name." };
  }

  let version: string | null = null;
  if (rawVersion !== undefined && rawVersion.trim().length > 0) {
    const ver = rawVersion.trim();
    if (!SAFE_VERSION_RE.test(ver) || ver.includes("..")) {
      return { ok: false, error: "Invalid 'version' parameter." };
    }
    version = ver;
  }

  const osvEcosystem =
    ecosystem === "npm" ? "npm" : ecosystem === "pypi" ? "PyPI" : "crates.io";

  return {
    ok: true,
    value: {
      packageName: ecosystem === "pypi" ? pkgTrimmed.toLowerCase().replace(/[_.]+/g, "-") : pkgTrimmed,
      ecosystem,
      depsDevSystem: ecosystem,
      osvEcosystem,
      version,
    },
  };
}

const RUNTIME_ALIASES: Readonly<Record<string, string>> = {
  node: "nodejs",
  "node.js": "nodejs",
  nodejs: "nodejs",
  py: "python",
  python3: "python",
  postgres: "postgresql",
  psql: "postgresql",
  golang: "go",
  k8s: "kubernetes",
  next: "nextjs",
  "next.js": "nextjs",
  ".net": "dotnet",
  dotnetcore: "dotnet",
  jdk: "temurin",
  openjdk: "temurin",
  java: "temurin",
  mongo: "mongodb",
  docker: "docker-engine",
  ts: "typescript",
};

const PRODUCT_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CYCLE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;

export function parseRuntimeInput(
  rawProduct: string | undefined,
  rawCycle: string | undefined
): ValidationResult<{ product: string; cycle: string | null }> {
  if (!rawProduct?.trim()) {
    return { ok: false, error: "Query parameter 'product' is required." };
  }
  const lowered = rawProduct.trim().toLowerCase();
  const product = Object.hasOwn(RUNTIME_ALIASES, lowered) ? RUNTIME_ALIASES[lowered]! : lowered;
  if (!PRODUCT_SLUG_RE.test(product) || product.includes("..")) {
    return { ok: false, error: "Invalid 'product' identifier." };
  }

  let cycle: string | null = null;
  if (rawCycle !== undefined && rawCycle.trim().length > 0) {
    const trimmedCycle = rawCycle.trim().replace(/^[vV](?=\d)/, "");
    if (!CYCLE_SLUG_RE.test(trimmedCycle) || trimmedCycle.includes("..")) {
      return { ok: false, error: "Invalid 'cycle' parameter." };
    }
    cycle = trimmedCycle;
  }

  return { ok: true, value: { product, cycle } };
}

const CVE_RE = /^CVE-\d{4}-\d{4,8}$/;

export function parseCveId(raw: string | undefined): ValidationResult<string> {
  if (!raw?.trim()) {
    return { ok: false, error: "Query parameter 'cve' is required (e.g., CVE-2024-3094)." };
  }
  const normalized = raw.trim().toUpperCase();
  if (!CVE_RE.test(normalized)) {
    return {
      ok: false,
      error: "Invalid CVE format (expected CVE-YYYY-NNNN+, e.g., CVE-2024-3094).",
    };
  }
  return { ok: true, value: normalized };
}

const HOSTNAME_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RESERVED_TLDS = new Set(["localhost", "local", "internal", "onion", "invalid", "test", "example"]);
const TWO_LEVEL_SLDS = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.nz",
  "com.br",
  "co.in",
  "com.sg",
  "com.mx",
  "co.za",
  "com.hk",
  "com.tw",
]);

export interface ParsedDomain {
  domain: string;
  registrableDomain: string;
  tld: string;
}

export function parseDomainInput(raw: string | undefined): ValidationResult<ParsedDomain> {
  if (!raw?.trim()) {
    return { ok: false, error: "Query parameter 'domain' is required." };
  }
  let candidate = raw.trim().toLowerCase();

  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    try {
      const parsedUrl = new URL(candidate);
      if (
        parsedUrl.username ||
        parsedUrl.password ||
        parsedUrl.port ||
        (parsedUrl.pathname !== "/" && parsedUrl.pathname !== "") ||
        parsedUrl.search ||
        parsedUrl.hash
      ) {
        return {
          ok: false,
          error: "Expected a domain/hostname (e.g., stripe.com), not a URL with path, port, or query.",
        };
      }
      candidate = parsedUrl.hostname.toLowerCase();
    } catch {
      return { ok: false, error: "Invalid domain name." };
    }
  }

  candidate = candidate.replace(/\.$/, "");
  if (!HOSTNAME_RE.test(candidate)) {
    return {
      ok: false,
      error: "Invalid domain name (expected valid public hostname such as stripe.com).",
    };
  }

  const labels = candidate.split(".");
  const tld = labels[labels.length - 1]!;
  if (RESERVED_TLDS.has(tld) || RESERVED_TLDS.has(candidate) || TWO_LEVEL_SLDS.has(candidate)) {
    return {
      ok: false,
      error: `Reserved or public-suffix domain '${candidate}' cannot be audited.`,
    };
  }

  let registrableDomain = labels.slice(-2).join(".");
  if (labels.length >= 3) {
    const lastTwo = labels.slice(-2).join(".");
    if (TWO_LEVEL_SLDS.has(lastTwo)) {
      registrableDomain = labels.slice(-3).join(".");
    }
  }

  return {
    ok: true,
    value: {
      domain: candidate,
      registrableDomain,
      tld,
    },
  };
}

export const CLOUD_PROVIDER_IDS = [
  "github",
  "cloudflare",
  "openai",
  "anthropic",
  "vercel",
  "npm",
] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];
const CLOUD_PROVIDER_SET: ReadonlySet<string> = new Set(CLOUD_PROVIDER_IDS);

export function parseCloudProviders(
  raw: string | undefined
): ValidationResult<readonly CloudProviderId[]> {
  if (!raw || raw.trim().length === 0 || raw.trim().toLowerCase() === "all") {
    return { ok: true, value: CLOUD_PROVIDER_IDS };
  }
  if (raw.length > 128) {
    return { ok: false, error: "Parameter 'providers' is too long." };
  }
  const seen = new Set<CloudProviderId>();
  const ordered: CloudProviderId[] = [];
  for (const token of raw.split(",")) {
    const key = token.trim().toLowerCase();
    if (!CLOUD_PROVIDER_SET.has(key)) {
      return {
        ok: false,
        error: `Unknown cloud status provider '${token.trim()}'. Valid providers: ${CLOUD_PROVIDER_IDS.join(", ")}, all.`,
      };
    }
    const typed = key as CloudProviderId;
    if (!seen.has(typed)) {
      seen.add(typed);
      ordered.push(typed);
    }
  }
  return { ok: true, value: ordered };
}

const HF_MODEL_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,95})?$/;

export function parseHfModelId(raw: string | undefined): ValidationResult<string> {
  if (!raw?.trim()) {
    return {
      ok: false,
      error: "Query parameter 'model' is required (e.g., Qwen/Qwen2.5-7B-Instruct).",
    };
  }
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/huggingface\.co\//i, "")
    .replace(/\/+$/, "");
  if (trimmed.length > 160 || !HF_MODEL_RE.test(trimmed) || trimmed.includes("..")) {
    return {
      ok: false,
      error: "Invalid Hugging Face model ID (expected 'org/model' or 'model').",
    };
  }
  return { ok: true, value: trimmed };
}

const COUNTRY_NAME_ALIASES: Readonly<Record<string, string>> = {
  iran: "IR",
  china: "CN",
  russia: "RU",
  turkey: "TR",
  turkiye: "TR",
  myanmar: "MM",
  burma: "MM",
  vietnam: "VN",
  india: "IN",
  pakistan: "PK",
  venezuela: "VE",
  belarus: "BY",
  egypt: "EG",
  turkmenistan: "TM",
  uzbekistan: "UZ",
  cuba: "CU",
  thailand: "TH",
  indonesia: "ID",
  nigeria: "NG",
  ethiopia: "ET",
  uganda: "UG",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  germany: "DE",
  france: "FR",
  netherlands: "NL",
  brazil: "BR",
};

const ISO_ALPHA2_RE = /^[A-Z]{2}$/;
const INVALID_ISO_CODES = new Set(["XX", "ZZ", "AA", "QM", "QZ", "XA", "XZ"]);

export function parseCountryCode(raw: string | undefined): ValidationResult<string> {
  if (!raw?.trim()) {
    return {
      ok: false,
      error: "Query parameter 'country' is required (2-letter ISO-3166 alpha-2 code, e.g., IR, CN, RU).",
    };
  }
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (Object.hasOwn(COUNTRY_NAME_ALIASES, lower)) {
    return { ok: true, value: COUNTRY_NAME_ALIASES[lower]! };
  }
  const upper = trimmed.toUpperCase();
  if (!ISO_ALPHA2_RE.test(upper) || INVALID_ISO_CODES.has(upper)) {
    return {
      ok: false,
      error: `Invalid country '${trimmed}'. Provide a 2-letter ISO-3166 alpha-2 country code (e.g., IR, CN, RU, DE, US).`,
    };
  }
  return { ok: true, value: upper };
}
