import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { EpssScore, OsvVulnDetail, SlimKevEntry } from "../providers/cveFeeds";

export function computeCveTriage(
  cveId: string,
  osv: OsvVulnDetail,
  epss: EpssScore,
  kev: SlimKevEntry | undefined,
  nowMs: number = Date.now()
) {
  let priorityScore = 10;
  const inKev = Boolean(kev);
  const prob = epss.probability ?? 0;

  if (inKev) {
    priorityScore += 55;
    if (kev?.ransomwareUse === "Known") {
      priorityScore += 15;
    }
  }

  if (prob >= 0.5) {
    priorityScore += 30;
  } else if (prob >= 0.1) {
    priorityScore += 22;
  } else if (prob >= 0.01) {
    priorityScore += 12;
  }

  if (osv.databaseSeverity === "CRITICAL") {
    priorityScore += 18;
  } else if (osv.databaseSeverity === "HIGH") {
    priorityScore += 12;
  } else if (osv.cvssVector?.includes("/C:H/I:H/A:H")) {
    priorityScore += 15;
  }

  const fixAvailable = osv.affectedPackages.some((p) => p.fixedVersions.length > 0);
  if (fixAvailable) {
    priorityScore += 5;
  }

  const clampedScore = Math.min(100, Math.max(0, priorityScore));
  const urgencyTier =
    inKev || prob >= 0.5 || clampedScore >= 85
      ? "ACT_IMMEDIATELY"
      : prob >= 0.1 || osv.databaseSeverity === "CRITICAL" || clampedScore >= 55
        ? "HIGH_PRIORITY"
        : clampedScore >= 30
          ? "SCHEDULED"
          : "LOW_URGENCY";

  const mergedCwes = Array.from(new Set([...osv.cwes, ...(kev?.cwes ?? [])]));

  return {
    cve: cveId,
    urgency_tier: urgencyTier,
    priority_score: clampedScore,
    summary: osv.summary,
    published_at: osv.published,
    modified_at: osv.modified,
    exploitation: {
      in_cisa_kev: inKev,
      kev_date_added: kev?.dateAdded ?? null,
      kev_due_date: kev?.dueDate ?? null,
      ransomware_campaign_use: kev?.ransomwareUse ?? null,
      epss_30d_probability: epss.probability,
      epss_percentile: epss.percentile,
    },
    severity: {
      cvss_vector: osv.cvssVector,
      database_severity: osv.databaseSeverity,
      cwes: mergedCwes,
    },
    remediation: {
      fix_available: fixAvailable,
      affected_packages: osv.affectedPackages.map((p) => ({
        ecosystem: p.ecosystem,
        package: p.package,
        fixed_versions: p.fixedVersions,
      })),
      aliases: osv.aliases,
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: [osv.source, "first_epss", "cisa_kev"],
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
