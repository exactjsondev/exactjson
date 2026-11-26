import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { PackageRawBundle } from "../providers/ossSupplyChain";
import type { PackageEcosystem } from "../validation";

export function computePackageAudit(
  packageName: string,
  ecosystem: PackageEcosystem,
  bundle: PackageRawBundle,
  nowMs: number = Date.now()
) {
  let riskScore = 0;
  const flags: string[] = [];

  const hasMalwareAdvisory = bundle.vulns.some((v) => v.id.startsWith("MAL-"));
  const criticalOrHighCount = bundle.vulns.filter((v) => v.isCriticalOrHigh).length;

  if (hasMalwareAdvisory) {
    riskScore += 75;
    flags.push("MALWARE_ADVISORY");
  }
  if (bundle.vulns.length > 0) {
    flags.push("KNOWN_VULNERABILITIES");
    riskScore += criticalOrHighCount > 0 ? Math.min(55, 35 + (criticalOrHighCount - 1) * 10) : 20;
  }

  let packageAgeDays: number | null = null;
  if (bundle.earliestPublishedAt) {
    const parsedMs = Date.parse(bundle.earliestPublishedAt);
    if (Number.isFinite(parsedMs)) {
      packageAgeDays = Math.max(0, Math.floor((nowMs - parsedMs) / 86_400_000));
    }
  }

  if (packageAgeDays !== null && packageAgeDays < 7) {
    riskScore += 30;
    flags.push("NEW_PACKAGE_UNDER_7D", "NEW_PACKAGE_UNDER_30D");
  } else if (packageAgeDays !== null && packageAgeDays < 30) {
    riskScore += 20;
    flags.push("NEW_PACKAGE_UNDER_30D");
  }

  if (bundle.installHooks.length > 0) {
    riskScore += 25;
    flags.push("INSTALL_SCRIPT_HOOKS");
  }

  if (bundle.sdistOnlyWarning) {
    riskScore += 15;
    flags.push("SDIST_ONLY_NO_WHEEL");
  }

  if (bundle.isYanked) {
    riskScore += 35;
    flags.push("VERSION_YANKED");
  }
  if (bundle.isDeprecated) {
    riskScore += 15;
    flags.push("PACKAGE_DEPRECATED");
  }

  if (bundle.licenses.length === 0) {
    riskScore += 10;
    flags.push("MISSING_LICENSE");
  }

  if (!bundle.sourceRepo) {
    riskScore += 10;
    flags.push("UNVERIFIED_SOURCE_REPO");
  }

  if (bundle.scorecard && bundle.scorecard.overall_score < 4.0) {
    riskScore += 15;
    flags.push("LOW_OPENSSF_SCORECARD");
  }

  if (
    riskScore === 0 &&
    !bundle.hasSlsaProvenance &&
    (!bundle.scorecard || bundle.scorecard.overall_score < 7.0)
  ) {
    riskScore = 5;
  }

  const clampedScore = Math.min(100, Math.max(0, riskScore));
  const riskTier =
    clampedScore >= 70
      ? "CRITICAL"
      : clampedScore >= 40
        ? "ELEVATED"
        : clampedScore >= 15
          ? "MODERATE"
          : "LOW";

  const fixedSet = new Set<string>();
  for (const v of bundle.vulns) {
    for (const f of v.fixedVersions) {
      fixedSet.add(f);
    }
  }

  return {
    package: packageName,
    ecosystem,
    version: bundle.resolvedVersion,
    risk_score: clampedScore,
    risk_tier: riskTier,
    flags,
    vulnerabilities: {
      total_count: bundle.vulns.length,
      critical_or_high_count: criticalOrHighCount,
      ids: bundle.vulns.map((v) => v.id).slice(0, 20),
      fixed_versions: Array.from(fixedSet).slice(0, 10),
    },
    supply_chain: {
      package_age_days: packageAgeDays,
      version_count: bundle.versionCount,
      version_published_at: bundle.versionPublishedAt,
      is_deprecated: bundle.isDeprecated,
      is_yanked: bundle.isYanked,
      has_install_scripts: bundle.installHooks.length > 0,
      install_script_hooks: bundle.installHooks,
      sdist_only_warning: bundle.sdistOnlyWarning,
      has_slsa_provenance: bundle.hasSlsaProvenance,
      licenses: bundle.licenses,
      source_repo: bundle.sourceRepo,
      openssf_scorecard: bundle.scorecard,
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: bundle.sources,
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
