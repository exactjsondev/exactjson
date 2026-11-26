import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";
import type { ParsedPackageInput } from "../validation";

interface RawDepsPackage {
  versions?: Array<{
    versionKey?: { version?: unknown };
    publishedAt?: unknown;
    isDefault?: unknown;
  }>;
}

interface RawDepsVersion {
  versionKey?: { version?: unknown };
  publishedAt?: unknown;
  isDeprecated?: unknown;
  deprecatedReason?: unknown;
  licenses?: unknown;
  links?: Array<{ label?: unknown; url?: unknown }>;
  slsaProvenances?: unknown[];
  attestations?: unknown[];
}

interface RawDepsProject {
  starsCount?: unknown;
  ossFuzz?: unknown;
  scorecard?: {
    overallScore?: unknown;
  };
}

interface RawOsvQueryResponse {
  vulns?: Array<{
    id?: unknown;
    aliases?: unknown;
    severity?: Array<{ type?: unknown; score?: unknown }>;
    database_specific?: { severity?: unknown };
    affected?: Array<{
      ecosystem_specific?: { severity?: unknown };
      database_specific?: { severity?: unknown };
      ranges?: Array<{
        events?: Array<{ fixed?: unknown }>;
      }>;
    }>;
  }>;
}

export interface PackageRawBundle {
  resolvedVersion: string;
  earliestPublishedAt: string | null;
  versionPublishedAt: string | null;
  versionCount: number;
  isDeprecated: boolean;
  isYanked: boolean;
  licenses: string[];
  hasSlsaProvenance: boolean;
  sourceRepo: string | null;
  scorecard: {
    overall_score: number;
    stars_count: number | null;
    oss_fuzz: boolean;
  } | null;
  installHooks: string[];
  sdistOnlyWarning: boolean;
  vulns: Array<{
    id: string;
    isCriticalOrHigh: boolean;
    fixedVersions: string[];
  }>;
  sources: string[];
}

function extractRepoProjectId(links: RawDepsVersion["links"]): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (link?.label !== "SOURCE_REPO" || typeof link.url !== "string") continue;
    try {
      const u = new URL(link.url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "github.com" && host !== "gitlab.com" && host !== "bitbucket.org") continue;
      const parts = u.pathname
        .replace(/\.git$/i, "")
        .split("/")
        .filter(Boolean);
      if (parts.length >= 2) {
        return `${host}/${parts[0]}/${parts[1]}`;
      }
    } catch {
      // ignore malformed repo URL
    }
  }
  return null;
}

function formatNpmRegistryPath(pkg: string): string {
  if (pkg.startsWith("@") && pkg.includes("/")) {
    const [scope, name] = pkg.slice(1).split("/", 2);
    return `@${encodeURIComponent(scope ?? "")}/${encodeURIComponent(name ?? "")}`;
  }
  return encodeURIComponent(pkg);
}

function isSevereOsvVuln(vuln: NonNullable<RawOsvQueryResponse["vulns"]>[number]): boolean {
  const id = typeof vuln.id === "string" ? vuln.id : "";
  if (id.startsWith("MAL-")) return true;

  const dbSev =
    typeof vuln.database_specific?.severity === "string"
      ? vuln.database_specific.severity.toUpperCase()
      : "";
  if (dbSev === "CRITICAL" || dbSev === "HIGH") return true;

  for (const aff of vuln.affected ?? []) {
    for (const rawSev of [aff?.ecosystem_specific?.severity, aff?.database_specific?.severity]) {
      if (typeof rawSev === "string") {
        const upper = rawSev.toUpperCase();
        if (upper === "CRITICAL" || upper === "HIGH") return true;
      }
    }
  }

  for (const sev of vuln.severity ?? []) {
    if (typeof sev?.score !== "string") continue;
    const scoreStr = sev.score.trim();
    const numeric = toFiniteNumber(scoreStr);
    if (numeric !== null && numeric >= 7.0) return true;
    // CVSS v3/v4 vector check: two+ High CIA metrics or Network attack vector + High CIA metric
    const highImpacts = (scoreStr.match(/\/(?:V?[CIA]):H\b/gi) ?? []).length;
    if (highImpacts >= 2 || (highImpacts >= 1 && /\/AV:N\b/i.test(scoreStr))) {
      return true;
    }
  }

  return false;
}

export async function fetchPackageAuditBundle(
  input: ParsedPackageInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: "not_found" } | { status: "ok"; bundle: PackageRawBundle }> {
  const encodedPkg = encodeURIComponent(input.packageName);
  const pkgUrl = `https://api.deps.dev/v3/systems/${input.depsDevSystem}/packages/${encodedPkg}`;

  const pkgRes = await fetchJsonWithTimeout<RawDepsPackage>(pkgUrl, {
    provider: "DEPS_DEV",
    allow404: true,
    fetchImpl,
  });

  if (pkgRes.status === "not_found") {
    return { status: "not_found" };
  }

  if (!pkgRes.data || !Array.isArray(pkgRes.data.versions)) {
    throw new UpstreamError("DEPS_DEV", "DEPS_DEV_BAD_SCHEMA", "Invalid deps.dev package payload");
  }
  const versions = pkgRes.data.versions;
  if (versions.length === 0) {
    return { status: "not_found" };
  }

  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;
  let defaultVersion: string | null = null;

  for (const v of versions) {
    const verStr = typeof v.versionKey?.version === "string" ? v.versionKey.version : null;
    if (v.isDefault === true && verStr) {
      defaultVersion = verStr;
    }
    if (typeof v.publishedAt === "string") {
      const ms = Date.parse(v.publishedAt);
      if (Number.isFinite(ms) && ms < earliestMs) {
        earliestMs = ms;
        earliestIso = v.publishedAt;
      }
    }
  }

  const targetVersion =
    input.version ??
    defaultVersion ??
    (typeof versions[versions.length - 1]?.versionKey?.version === "string"
      ? (versions[versions.length - 1]!.versionKey!.version as string)
      : null);

  if (!targetVersion) {
    return { status: "not_found" };
  }

  const verUrl = `https://api.deps.dev/v3/systems/${input.depsDevSystem}/packages/${encodedPkg}/versions/${encodeURIComponent(targetVersion)}`;

  // Primary fail-closed checks: deps.dev version metadata + OSV vulnerability query + registry hook/yank check
  const fetchRegistryDetail = async (): Promise<{
    source: string;
    found: boolean;
    isDeprecated: boolean;
    isYanked: boolean;
    installHooks: string[];
    sdistOnlyWarning: boolean;
  }> => {
    if (input.ecosystem === "npm") {
      const npmUrl = `https://registry.npmjs.org/${formatNpmRegistryPath(input.packageName)}/${encodeURIComponent(targetVersion)}`;
      const npmRes = await fetchJsonWithTimeout<{
        deprecated?: unknown;
        scripts?: Record<string, unknown>;
      }>(npmUrl, {
        provider: "NPM_REGISTRY",
        allow404: true,
        fetchImpl,
      });
      if (npmRes.status === "not_found") {
        return {
          source: "npm_registry",
          found: false,
          isDeprecated: false,
          isYanked: false,
          installHooks: [],
          sdistOnlyWarning: false,
        };
      }
      const scripts =
        npmRes.data.scripts && typeof npmRes.data.scripts === "object"
          ? npmRes.data.scripts
          : {};
      const hooks = ["preinstall", "install", "postinstall"].filter(
        (hook) => typeof scripts[hook] === "string" && String(scripts[hook]).trim().length > 0
      );
      return {
        source: "npm_registry",
        found: true,
        isDeprecated: Boolean(npmRes.data.deprecated),
        isYanked: false,
        installHooks: hooks,
        sdistOnlyWarning: false,
      };
    }

    if (input.ecosystem === "pypi") {
      const pypiUrl = `https://pypi.org/pypi/${encodeURIComponent(input.packageName)}/${encodeURIComponent(targetVersion)}/json`;
      const pypiRes = await fetchJsonWithTimeout<{
        info?: { yanked?: unknown };
        urls?: Array<{ packagetype?: unknown }>;
      }>(pypiUrl, {
        provider: "PYPI",
        allow404: true,
        fetchImpl,
      });
      if (pypiRes.status === "not_found") {
        return {
          source: "pypi_json",
          found: false,
          isDeprecated: false,
          isYanked: false,
          installHooks: [],
          sdistOnlyWarning: false,
        };
      }
      const urls = Array.isArray(pypiRes.data.urls) ? pypiRes.data.urls : [];
      const hasWheel = urls.some((u) => u?.packagetype === "bdist_wheel");
      const hasSdist = urls.some((u) => u?.packagetype === "sdist");
      return {
        source: "pypi_json",
        found: true,
        isDeprecated: false,
        isYanked: pypiRes.data.info?.yanked === true,
        installHooks: [],
        sdistOnlyWarning: hasSdist && !hasWheel,
      };
    }

    const cargoUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(input.packageName)}/${encodeURIComponent(targetVersion)}`;
    const cargoRes = await fetchJsonWithTimeout<{
      version?: { yanked?: unknown };
    }>(cargoUrl, {
      provider: "CRATES_IO",
      allow404: true,
      fetchImpl,
    });
    return {
      source: "crates_io",
      found: cargoRes.status === "ok",
      isDeprecated: false,
      isYanked: cargoRes.status === "ok" && cargoRes.data.version?.yanked === true,
      installHooks: [],
      sdistOnlyWarning: false,
    };
  };

  const [verRes, osvRes, regDetail] = await Promise.all([
    fetchJsonWithTimeout<RawDepsVersion>(verUrl, {
      provider: "DEPS_DEV",
      allow404: true,
      fetchImpl,
    }),
    fetchJsonWithTimeout<RawOsvQueryResponse>("https://api.osv.dev/v1/query", {
      provider: "OSV",
      method: "POST",
      body: {
        package: { name: input.packageName, ecosystem: input.osvEcosystem },
        version: targetVersion,
      },
      fetchImpl,
    }),
    fetchRegistryDetail(),
  ]);

  if (verRes.status === "not_found") {
    return { status: "not_found" };
  }
  if (osvRes.status !== "ok") {
    throw new UpstreamError("OSV", "OSV_UNAVAILABLE", "OSV query failed");
  }

  const verData = verRes.data;
  const sourceRepo = extractRepoProjectId(verData.links);

  let scorecard: PackageRawBundle["scorecard"] = null;
  if (sourceRepo) {
    try {
      const projRes = await fetchJsonWithTimeout<RawDepsProject>(
        `https://api.deps.dev/v3/projects/${encodeURIComponent(sourceRepo)}`,
        {
          provider: "DEPS_DEV",
          allow404: true,
          fetchImpl,
        }
      );
      if (projRes.status === "ok") {
        const overall = toFiniteNumber(projRes.data.scorecard?.overallScore);
        if (overall !== null) {
          scorecard = {
            overall_score: Math.round(overall * 10) / 10,
            stars_count: toFiniteNumber(projRes.data.starsCount),
            oss_fuzz: projRes.data.ossFuzz === true,
          };
        }
      }
    } catch {
      // Optional OpenSSF project enrichment; core deps.dev + OSV checks already succeeded
    }
  }

  const rawVulns = Array.isArray(osvRes.data.vulns) ? osvRes.data.vulns : [];
  const vulns = rawVulns
    .map((v) => {
      const id = typeof v.id === "string" ? v.id : "";
      if (!id) return null;
      const fixedSet = new Set<string>();
      for (const aff of v.affected ?? []) {
        for (const r of aff.ranges ?? []) {
          for (const ev of r.events ?? []) {
            if (typeof ev.fixed === "string" && ev.fixed.length > 0) {
              fixedSet.add(ev.fixed);
            }
          }
        }
      }
      return {
        id,
        isCriticalOrHigh: isSevereOsvVuln(v),
        fixedVersions: Array.from(fixedSet).slice(0, 5),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const licenses = Array.isArray(verData.licenses)
    ? verData.licenses.filter((l): l is string => typeof l === "string" && l.length > 0)
    : [];

  const hasSlsa =
    (Array.isArray(verData.slsaProvenances) && verData.slsaProvenances.length > 0) ||
    (Array.isArray(verData.attestations) && verData.attestations.length > 0);

  return {
    status: "ok",
    bundle: {
      resolvedVersion: targetVersion,
      earliestPublishedAt: earliestIso,
      versionPublishedAt:
        typeof verData.publishedAt === "string" ? verData.publishedAt : null,
      versionCount: versions.length,
      isDeprecated: verData.isDeprecated === true || regDetail.isDeprecated,
      isYanked: regDetail.isYanked,
      licenses,
      hasSlsaProvenance: hasSlsa,
      sourceRepo,
      scorecard,
      installHooks: regDetail.installHooks,
      sdistOnlyWarning: regDetail.sdistOnlyWarning,
      vulns,
      sources: regDetail.found
        ? ["deps_dev", "osv_dev", regDetail.source]
        : ["deps_dev", "osv_dev"],
    },
  };
}
