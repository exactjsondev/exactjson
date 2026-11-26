import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { DomainDnsBundle, DomainRdapInfo } from "../providers/dnsRdap";
import type { ParsedDomain } from "../validation";

export type DomainTrustTier = "HIGH" | "MODERATE" | "LOW" | "CRITICAL";

export function computeDomainTrust(
  parsed: ParsedDomain,
  dns: DomainDnsBundle,
  rdap: DomainRdapInfo,
  nowMs: number
) {
  let risk = 0;
  const flags: string[] = [];

  if (dns.malwareSinkholed) {
    risk += 90;
    flags.push("MALWARE_SINKHOLED_1_1_1_2");
  }
  if (dns.dnssecBogus) {
    risk += 85;
    flags.push("DNSSEC_BOGUS");
  }
  if (!dns.resolvesAOrAaaa) {
    risk += 20;
    flags.push("NO_WEB_A_OR_AAAA_RECORD");
  }

  let domainAgeDays: number | null = null;
  if (rdap.registeredAt) {
    const regMs = Date.parse(rdap.registeredAt);
    if (Number.isFinite(regMs) && regMs <= nowMs) {
      domainAgeDays = Math.floor((nowMs - regMs) / 86_400_000);
    }
  }

  const ageUnverified = !rdap.rdapSupported || domainAgeDays === null;
  if (!rdap.rdapSupported) {
    risk += 15;
    flags.push("RDAP_UNAVAILABLE_FOR_TLD");
  } else if (!rdap.recordFound || domainAgeDays === null) {
    risk += 15;
    flags.push("RDAP_RECORD_NOT_FOUND");
  } else if (domainAgeDays < 14) {
    risk += 45;
    flags.push("NEWLY_REGISTERED_UNDER_14D");
  } else if (domainAgeDays < 30) {
    risk += 35;
    flags.push("NEWLY_REGISTERED_UNDER_30D");
  } else if (domainAgeDays < 90) {
    risk += 20;
    flags.push("YOUNG_DOMAIN_UNDER_90D");
  } else if (domainAgeDays < 365) {
    risk += 8;
  }

  if (!dns.spfPresent) {
    risk += 10;
    flags.push("MISSING_SPF");
  } else if (dns.spfAllQualifier === "+all") {
    risk += 30;
    flags.push("DANGEROUS_SPF_PLUS_ALL");
  } else if (dns.spfAllQualifier === "?all") {
    risk += 8;
    flags.push("NEUTRAL_SPF_POLICY");
  } else if (dns.spfAllQualifier === "~all") {
    risk += 3;
  }

  if (!dns.dmarcPresent) {
    risk += 12;
    flags.push("MISSING_DMARC");
  } else if (dns.dmarcPolicy === "none") {
    risk += 6;
    flags.push("DMARC_MONITOR_ONLY");
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(risk)));

  let trustTier: DomainTrustTier;
  if (dns.malwareSinkholed || dns.dnssecBogus || riskScore >= 70) {
    trustTier = "CRITICAL";
  } else if (riskScore >= 40) {
    trustTier = "LOW";
  } else if (riskScore >= 15 || ageUnverified) {
    trustTier = "MODERATE";
  } else {
    trustTier = "HIGH";
  }

  const sources = rdap.rdapSupported
    ? ["cloudflare_doh", "cloudflare_security_doh", "iana_rdap"]
    : ["cloudflare_doh", "cloudflare_security_doh"];

  return {
    domain: parsed.domain,
    registrable_domain: parsed.registrableDomain,
    tld: parsed.tld,
    risk_score: riskScore,
    trust_tier: trustTier,
    flags,
    security: {
      malware_sinkholed: dns.malwareSinkholed,
      dnssec_validated: dns.dnssecValidated,
      resolves_a_or_aaaa: dns.resolvesAOrAaaa,
      has_mx: dns.hasMx,
      spf_present: dns.spfPresent,
      spf_all_qualifier: dns.spfAllQualifier,
      dmarc_present: dns.dmarcPresent,
      dmarc_policy: dns.dmarcPolicy,
    },
    registration: {
      rdap_supported: rdap.rdapSupported,
      registered_at: rdap.registeredAt,
      expires_at: rdap.expiresAt,
      domain_age_days: domainAgeDays,
      registrar: rdap.registrar,
      transfer_locked: rdap.transferLocked,
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
