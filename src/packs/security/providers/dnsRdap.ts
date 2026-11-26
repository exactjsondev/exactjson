import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  referenceCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";

const CF_DOH_URL = "https://cloudflare-dns.com/dns-query";
const CF_SECURITY_DOH_URL = "https://security.cloudflare-dns.com/dns-query";
const IANA_RDAP_DNS_URL = "https://data.iana.org/rdap/dns.json";

interface DohAnswer {
  name?: unknown;
  type?: unknown;
  TTL?: unknown;
  data?: unknown;
}

interface DohResponse {
  Status?: unknown;
  AD?: unknown;
  Comment?: unknown;
  Answer?: DohAnswer[];
}

export interface DomainDnsBundle {
  malwareSinkholed: boolean;
  dnssecBogus: boolean;
  dnssecValidated: boolean;
  resolvesAOrAaaa: boolean;
  aRecordCount: number;
  aaaaRecordCount: number;
  hasMx: boolean;
  spfPresent: boolean;
  spfAllQualifier: string | null;
  dmarcPresent: boolean;
  dmarcPolicy: string | null;
}

export interface DomainRdapInfo {
  rdapSupported: boolean;
  recordFound: boolean;
  registeredAt: string | null;
  expiresAt: string | null;
  registrar: string | null;
  transferLocked: boolean | null;
}

function normalizeTxtData(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Join adjacent quoted segments `"part1" "part2"` -> `part1part2`
  const matches = raw.match(/"([^"]*)"/g);
  if (matches && matches.length > 0) {
    return matches.map((seg) => seg.slice(1, -1)).join("");
  }
  return raw.replace(/^"+|"+$/g, "");
}

function normalizeDohComment(comment: unknown): string {
  if (typeof comment === "string") return comment;
  if (Array.isArray(comment)) {
    return comment.filter((c): c is string => typeof c === "string").join(" ");
  }
  return "";
}

const DNSSEC_BOGUS_RE = /\bEDE\s*(?:6|7|8|9|10|11|12)\b|DNSSEC|DNSKEY|RRSIG|NSEC/i;

function checkDohStatus(
  res: DohResponse,
  provider: "CF_DOH" | "CF_SECURITY_DOH"
): { status: number; dnssecBogus: boolean; comment: string } {
  const status = res.Status;
  if (typeof status !== "number") {
    throw new UpstreamError(provider, `${provider}_BAD_SCHEMA`, `${provider} missing Status`);
  }
  const comment = normalizeDohComment(res.Comment);
  if (status === 0 || status === 3) {
    return { status, dnssecBogus: false, comment };
  }
  if (status === 2 && DNSSEC_BOGUS_RE.test(comment)) {
    return { status, dnssecBogus: true, comment };
  }
  throw new UpstreamError(
    provider,
    `${provider}_SERVFAIL`,
    `${provider} returned DNS Status ${status}`
  );
}

async function queryDoh(
  baseUrl: string,
  provider: "CF_DOH" | "CF_SECURITY_DOH",
  name: string,
  qtype: "A" | "AAAA" | "MX" | "TXT",
  fetchImpl: typeof fetch
): Promise<DohResponse> {
  const url = `${baseUrl}?name=${encodeURIComponent(name)}&type=${qtype}`;
  const res = await fetchJsonWithTimeout<DohResponse>(url, {
    provider,
    headers: { Accept: "application/dns-json" },
    fetchImpl,
  });
  if (res.status !== "ok" || !res.data || typeof res.data.Status !== "number") {
    throw new UpstreamError(provider, `${provider}_BAD_SCHEMA`, `${provider} invalid DNS JSON`);
  }
  return res.data;
}

function extractDmarc(answers: DohAnswer[] | undefined): {
  present: boolean;
  policy: string | null;
} {
  for (const ans of answers ?? []) {
    if (ans.type !== 16) continue;
    const txt = normalizeTxtData(ans.data).trim();
    if (/^v\s*=\s*DMARC1\b/i.test(txt)) {
      const match = txt.match(/;\s*p\s*=\s*(none|quarantine|reject)\b/i);
      return {
        present: true,
        policy: match?.[1] ? match[1].toLowerCase() : null,
      };
    }
  }
  return { present: false, policy: null };
}

export async function fetchDomainDnsBundle(
  domain: string,
  registrableDomain: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ status: "not_found"; cacheHit: boolean } | { status: "ok"; data: DomainDnsBundle; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    { status: "not_found" } | { status: "ok"; data: DomainDnsBundle }
  >({
    key: `doh:trust:${domain}`,
    ttlMs: TTL_MS.NET_DOMAIN_DOH,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    fetcher: async () => {
      const [resA, resAAAA, resMx, resTxt, resDmarc, resSec] = await Promise.all([
        queryDoh(CF_DOH_URL, "CF_DOH", domain, "A", fetchImpl),
        queryDoh(CF_DOH_URL, "CF_DOH", domain, "AAAA", fetchImpl),
        queryDoh(CF_DOH_URL, "CF_DOH", domain, "MX", fetchImpl),
        queryDoh(CF_DOH_URL, "CF_DOH", domain, "TXT", fetchImpl),
        queryDoh(CF_DOH_URL, "CF_DOH", `_dmarc.${domain}`, "TXT", fetchImpl),
        queryDoh(CF_SECURITY_DOH_URL, "CF_SECURITY_DOH", domain, "A", fetchImpl),
      ]);

      const chkA = checkDohStatus(resA, "CF_DOH");
      const chkAAAA = checkDohStatus(resAAAA, "CF_DOH");
      const chkMx = checkDohStatus(resMx, "CF_DOH");
      const chkTxt = checkDohStatus(resTxt, "CF_DOH");
      const chkDmarc = checkDohStatus(resDmarc, "CF_DOH");
      const chkSec = checkDohStatus(resSec, "CF_SECURITY_DOH");

      const dnssecBogus =
        chkA.dnssecBogus ||
        chkAAAA.dnssecBogus ||
        chkMx.dnssecBogus ||
        chkTxt.dnssecBogus ||
        chkDmarc.dnssecBogus ||
        chkSec.dnssecBogus;

      // NXDOMAIN on both A and AAAA (and not DNSSEC-bogus) -> non-existent domain (404 unsettled)
      if (!dnssecBogus && chkA.status === 3 && chkAAAA.status === 3) {
        return { status: "not_found" };
      }

      const secAnswers = Array.isArray(resSec.Answer) ? resSec.Answer : [];
      const secComment = chkSec.comment;
      const sinkholeAnswer = secAnswers.some(
        (a) => a.data === "0.0.0.0" || a.data === "::"
      );
      const sinkholeComment =
        /\bEDE\s*(?:15|16|17)\b|Blocked|Censored|Filtered|Malware|Phishing/i.test(secComment);
      const malwareSinkholed = sinkholeAnswer || sinkholeComment;

      const aAnswers = (Array.isArray(resA.Answer) ? resA.Answer : []).filter(
        (a) => a.type === 1 && typeof a.data === "string" && a.data !== "0.0.0.0"
      );
      const aaaaAnswers = (Array.isArray(resAAAA.Answer) ? resAAAA.Answer : []).filter(
        (a) => a.type === 28 && typeof a.data === "string" && a.data !== "::"
      );

      const mxAnswers = (Array.isArray(resMx.Answer) ? resMx.Answer : []).filter(
        (a) => a.type === 15 && typeof a.data === "string" && a.data.trim() !== "0 ."
      );

      let spfPresent = false;
      let spfAllQualifier: string | null = null;
      for (const ans of Array.isArray(resTxt.Answer) ? resTxt.Answer : []) {
        if (ans.type !== 16) continue;
        const txt = normalizeTxtData(ans.data).trim();
        if (/^v\s*=\s*spf1\b/i.test(txt)) {
          spfPresent = true;
          const allMatch = txt.match(/(?:^|\s)([+?~-]?all)\b/i);
          if (allMatch?.[1]) {
            const rawQual = allMatch[1].toLowerCase();
            spfAllQualifier = rawQual === "all" ? "+all" : rawQual;
          }
          break;
        }
      }

      let dmarc = extractDmarc(Array.isArray(resDmarc.Answer) ? resDmarc.Answer : []);
      if (!dmarc.present && domain !== registrableDomain) {
        const orgDmarcRes = await queryDoh(
          CF_DOH_URL,
          "CF_DOH",
          `_dmarc.${registrableDomain}`,
          "TXT",
          fetchImpl
        );
        checkDohStatus(orgDmarcRes, "CF_DOH");
        dmarc = extractDmarc(Array.isArray(orgDmarcRes.Answer) ? orgDmarcRes.Answer : []);
      }

      return {
        status: "ok",
        data: {
          malwareSinkholed,
          dnssecBogus,
          dnssecValidated: Boolean(resA.AD || resAAAA.AD),
          resolvesAOrAaaa: aAnswers.length > 0 || aaaaAnswers.length > 0,
          aRecordCount: aAnswers.length,
          aaaaRecordCount: aaaaAnswers.length,
          hasMx: mxAnswers.length > 0,
          spfPresent,
          spfAllQualifier,
          dmarcPresent: dmarc.present,
          dmarcPolicy: dmarc.policy,
        },
      };
    },
  });

  if (value.status === "not_found") {
    return { status: "not_found", cacheHit };
  }
  return { status: "ok", data: value.data, cacheHit };
}

const SAFE_RDAP_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function sanitizeRdapBaseUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.port !== "" && parsed.port !== "443") ||
      parsed.search ||
      parsed.hash ||
      !SAFE_RDAP_HOST_RE.test(parsed.hostname)
    ) {
      return null;
    }
    const lowerHost = parsed.hostname.toLowerCase();
    if (
      lowerHost.endsWith(".local") ||
      lowerHost.endsWith(".internal") ||
      lowerHost.endsWith(".localhost")
    ) {
      return null;
    }
    const normalizedPath = parsed.pathname.endsWith("/")
      ? parsed.pathname
      : `${parsed.pathname}/`;
    return `https://${lowerHost}${normalizedPath}`;
  } catch {
    return null;
  }
}

export function parseIanaRdapDnsMap(raw: unknown): Map<string, string> {
  const obj = raw as { services?: unknown } | null;
  if (!obj || !Array.isArray(obj.services)) {
    throw new UpstreamError("IANA_RDAP", "IANA_RDAP_BAD_SCHEMA", "Invalid IANA RDAP bootstrap");
  }

  const map = new Map<string, string>();
  for (const entry of obj.services) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [tlds, urls] = entry as [unknown, unknown];
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;

    let safeBase: string | null = null;
    for (const candidateUrl of urls) {
      safeBase = sanitizeRdapBaseUrl(candidateUrl);
      if (safeBase) break;
    }
    if (!safeBase) continue;

    for (const tld of tlds) {
      if (typeof tld === "string" && tld.trim().length > 0) {
        map.set(tld.trim().toLowerCase(), safeBase);
      }
    }
  }
  return map;
}

export async function fetchIanaRdapMap(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ map: Map<string, string>; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    Map<string, string>,
    Array<[string, string]>
  >({
    key: "iana:rdap:dns",
    ttlMs: TTL_MS.NET_RDAP_BOOTSTRAP,
    cache,
    waitUntil,
    serializeEdge: (m) => Array.from(m.entries()),
    deserializeEdge: (arr) => (Array.isArray(arr) ? new Map(arr) : null),
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown>(IANA_RDAP_DNS_URL, {
        provider: "IANA_RDAP",
        timeoutMs: 5000,
        fetchImpl,
      });
      if (res.status !== "ok") {
        throw new UpstreamError("IANA_RDAP", "IANA_RDAP_UNAVAILABLE", "IANA RDAP unavailable");
      }
      return parseIanaRdapDnsMap(res.data);
    },
  });

  return { map: value, cacheHit };
}

function extractRegistrarName(entities: unknown): string | null {
  if (!Array.isArray(entities)) return null;
  for (const ent of entities) {
    if (!ent || typeof ent !== "object") continue;
    const record = ent as { roles?: unknown; vcardArray?: unknown; handle?: unknown };
    const roles = Array.isArray(record.roles) ? record.roles : [];
    if (!roles.some((r) => typeof r === "string" && r.toLowerCase() === "registrar")) continue;

    if (Array.isArray(record.vcardArray) && Array.isArray(record.vcardArray[1])) {
      for (const prop of record.vcardArray[1] as unknown[]) {
        if (Array.isArray(prop) && prop[0] === "fn" && typeof prop[3] === "string" && prop[3].trim()) {
          return prop[3].trim();
        }
      }
    }
    if (typeof record.handle === "string" && record.handle.trim()) {
      return record.handle.trim();
    }
  }
  return null;
}

export async function fetchDomainRdapInfo(
  registrableDomain: string,
  tld: string,
  ianaMap: Map<string, string>,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ info: DomainRdapInfo; cacheHit: boolean }> {
  const rdapBase = ianaMap.get(tld);
  if (!rdapBase) {
    return {
      info: {
        rdapSupported: false,
        recordFound: false,
        registeredAt: null,
        expiresAt: null,
        registrar: null,
        transferLocked: null,
      },
      cacheHit: true,
    };
  }

  const { value, cacheHit } = await withTwoTierCache<DomainRdapInfo>({
    key: `rdap:domain:${registrableDomain}`,
    ttlMs: TTL_MS.NET_RDAP_DOMAIN,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<Record<string, unknown>>(
        `${rdapBase}domain/${encodeURIComponent(registrableDomain)}`,
        {
          provider: "RDAP",
          allow404: true,
          timeoutMs: 4500,
          headers: { Accept: "application/rdap+json, application/json" },
          fetchImpl,
        }
      );

      if (res.status === "not_found") {
        return {
          rdapSupported: true,
          recordFound: false,
          registeredAt: null,
          expiresAt: null,
          registrar: null,
          transferLocked: null,
        };
      }

      const raw = res.data;
      let registeredAt: string | null = null;
      let expiresAt: string | null = null;
      const events = Array.isArray(raw.events)
        ? (raw.events as Array<{ eventAction?: unknown; eventDate?: unknown }>)
        : [];
      for (const ev of events) {
        if (typeof ev?.eventAction !== "string" || typeof ev?.eventDate !== "string") continue;
        const action = ev.eventAction.toLowerCase();
        if (action === "registration" && !registeredAt) {
          registeredAt = ev.eventDate;
        } else if (action === "expiration" && !expiresAt) {
          expiresAt = ev.eventDate;
        }
      }

      const statuses = Array.isArray(raw.status)
        ? raw.status.filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase())
        : [];
      const transferLocked = statuses.some((s) => s.includes("transfer prohibited"));

      return {
        rdapSupported: true,
        recordFound: true,
        registeredAt,
        expiresAt,
        registrar: extractRegistrarName(raw.entities),
        transferLocked,
      };
    },
  });

  return { info: value, cacheHit };
}
