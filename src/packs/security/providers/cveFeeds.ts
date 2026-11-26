import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  referenceCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

const CISA_KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export interface SlimKevEntry {
  vendor: string | null;
  product: string | null;
  dateAdded: string | null;
  dueDate: string | null;
  ransomwareUse: string | null;
  cwes: string[];
}

export interface OsvVulnDetail {
  id: string;
  source: "osv_dev" | "mitre_cve";
  summary: string | null;
  published: string | null;
  modified: string | null;
  aliases: string[];
  cvssVector: string | null;
  databaseSeverity: string | null;
  cwes: string[];
  affectedPackages: Array<{
    ecosystem: string;
    package: string;
    fixedVersions: string[];
  }>;
}

export interface EpssScore {
  probability: number | null;
  percentile: number | null;
}

export function parseCisaKevMap(raw: unknown): Map<string, SlimKevEntry> {
  const obj = raw as { vulnerabilities?: Array<Record<string, unknown>> } | null;
  if (!obj || !Array.isArray(obj.vulnerabilities)) {
    throw new UpstreamError("CISA_KEV", "CISA_KEV_BAD_SCHEMA", "Invalid CISA KEV payload");
  }

  const map = new Map<string, SlimKevEntry>();
  for (const row of obj.vulnerabilities) {
    if (!row || typeof row.cveID !== "string") continue;
    const cveId = row.cveID.trim().toUpperCase();
    if (!cveId) continue;
    const cwes = Array.isArray(row.cwes)
      ? row.cwes.filter((c): c is string => typeof c === "string")
      : [];
    map.set(cveId, {
      vendor: typeof row.vendorProject === "string" ? row.vendorProject : null,
      product: typeof row.product === "string" ? row.product : null,
      dateAdded: typeof row.dateAdded === "string" ? row.dateAdded : null,
      dueDate: typeof row.dueDate === "string" ? row.dueDate : null,
      ransomwareUse:
        typeof row.knownRansomwareCampaignUse === "string" ? row.knownRansomwareCampaignUse : null,
      cwes,
    });
  }
  return map;
}

export async function fetchCisaKevMap(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ map: Map<string, SlimKevEntry>; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    Map<string, SlimKevEntry>,
    Array<[string, SlimKevEntry]>
  >({
    key: "cisa:kev:map",
    ttlMs: TTL_MS.SEC_CISA_KEV,
    cache,
    waitUntil,
    serializeEdge: (m) => Array.from(m.entries()),
    deserializeEdge: (arr) => (Array.isArray(arr) ? new Map(arr) : null),
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown>(CISA_KEV_URL, {
        provider: "CISA_KEV",
        timeoutMs: 6000,
        fetchImpl,
      });
      if (res.status !== "ok") {
        throw new UpstreamError("CISA_KEV", "CISA_KEV_UNAVAILABLE", "CISA KEV unavailable");
      }
      return parseCisaKevMap(res.data);
    },
  });

  return { map: value, cacheHit };
}

function parseMitreCveRecord(
  cveId: string,
  raw: Record<string, unknown>
): { status: "not_found" } | { status: "ok"; data: OsvVulnDetail } {
  const meta =
    raw.cveMetadata && typeof raw.cveMetadata === "object"
      ? (raw.cveMetadata as Record<string, unknown>)
      : null;
  if (raw.dataType !== "CVE_RECORD" || !meta) {
    throw new UpstreamError("MITRE_CVE", "MITRE_CVE_BAD_SCHEMA", "Invalid MITRE CVE 5.1 record");
  }
  if (typeof meta.state === "string" && meta.state.toUpperCase() === "REJECTED") {
    return { status: "not_found" };
  }

  const containers =
    raw.containers && typeof raw.containers === "object"
      ? (raw.containers as Record<string, unknown>)
      : {};
  const cna =
    containers.cna && typeof containers.cna === "object"
      ? (containers.cna as Record<string, unknown>)
      : {};
  const adpList = Array.isArray(containers.adp)
    ? (containers.adp as Array<Record<string, unknown>>)
    : [];

  let summary: string | null = null;
  if (Array.isArray(cna.descriptions)) {
    const descs = cna.descriptions as Array<{ lang?: unknown; value?: unknown }>;
    const en =
      descs.find(
        (d) => typeof d?.lang === "string" && d.lang.toLowerCase().startsWith("en") && typeof d.value === "string"
      ) ?? descs.find((d) => typeof d?.value === "string");
    if (typeof en?.value === "string" && en.value.trim()) {
      summary = en.value.trim().slice(0, 280);
    }
  }

  let cvssVector: string | null = null;
  let databaseSeverity: string | null = null;
  const metricSources = [
    ...(Array.isArray(cna.metrics) ? (cna.metrics as Array<Record<string, unknown>>) : []),
    ...adpList.flatMap((a) =>
      Array.isArray(a?.metrics) ? (a.metrics as Array<Record<string, unknown>>) : []
    ),
  ];
  for (const m of metricSources) {
    for (const key of ["cvssV4_0", "cvssV3_1", "cvssV3_0"]) {
      const obj = m?.[key];
      if (obj && typeof obj === "object") {
        const rec = obj as Record<string, unknown>;
        if (!cvssVector && typeof rec.vectorString === "string") {
          cvssVector = rec.vectorString;
        }
        if (!databaseSeverity && typeof rec.baseSeverity === "string") {
          databaseSeverity = rec.baseSeverity.toUpperCase();
        }
      }
    }
    if (cvssVector && databaseSeverity) break;
  }

  const cweSet = new Set<string>();
  const probSources = [
    ...(Array.isArray(cna.problemTypes)
      ? (cna.problemTypes as Array<{ descriptions?: Array<{ cweId?: unknown }> }>)
      : []),
    ...adpList.flatMap((a) =>
      Array.isArray(a?.problemTypes)
        ? (a.problemTypes as Array<{ descriptions?: Array<{ cweId?: unknown }> }>)
        : []
    ),
  ];
  for (const pt of probSources) {
    for (const d of pt?.descriptions ?? []) {
      if (typeof d?.cweId === "string" && d.cweId.startsWith("CWE-")) {
        cweSet.add(d.cweId);
      }
    }
  }

  const affectedPackages: OsvVulnDetail["affectedPackages"] = [];
  if (Array.isArray(cna.affected)) {
    for (const aff of (cna.affected as Array<Record<string, unknown>>).slice(0, 15)) {
      const vendor = typeof aff?.vendor === "string" && aff.vendor.trim() ? aff.vendor.trim() : "vendor";
      const product = typeof aff?.product === "string" && aff.product.trim() ? aff.product.trim() : null;
      if (!product) continue;

      const fixedSet = new Set<string>();
      if (Array.isArray(aff.versions)) {
        for (const v of aff.versions as Array<Record<string, unknown>>) {
          if (typeof v?.lessThan === "string" && v.lessThan.trim() && v.lessThan !== "*") {
            fixedSet.add(v.lessThan.trim());
          }
          if (Array.isArray(v?.changes)) {
            for (const ch of v.changes as Array<{ at?: unknown; status?: unknown }>) {
              if (ch?.status === "unaffected" && typeof ch.at === "string" && ch.at.trim()) {
                fixedSet.add(ch.at.trim());
              }
            }
          }
        }
      }
      affectedPackages.push({
        ecosystem: vendor,
        package: product,
        fixedVersions: Array.from(fixedSet).slice(0, 5),
      });
    }
  }

  return {
    status: "ok",
    data: {
      id: typeof meta.cveId === "string" ? meta.cveId : cveId,
      source: "mitre_cve",
      summary,
      published: typeof meta.datePublished === "string" ? meta.datePublished : null,
      modified: typeof meta.dateUpdated === "string" ? meta.dateUpdated : null,
      aliases: [],
      cvssVector,
      databaseSeverity,
      cwes: Array.from(cweSet),
      affectedPackages,
    },
  };
}

export async function fetchOsvCveDetail(
  cveId: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ status: "not_found"; cacheHit: boolean } | { status: "ok"; data: OsvVulnDetail; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<
    { status: "not_found" } | { status: "ok"; data: OsvVulnDetail }
  >({
    key: `cve:detail:${cveId}`,
    ttlMs: TTL_MS.SEC_CVE_DETAIL,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<Record<string, unknown>>(
        `https://api.osv.dev/v1/vulns/${encodeURIComponent(cveId)}`,
        {
          provider: "OSV",
          allow404: true,
          fetchImpl,
        }
      );

      if (res.status === "not_found") {
        // Fallback to official keyless MITRE CVE JSON 5.1 API for closed-source/enterprise CVEs (e.g. PAN-OS, Exchange, Ivanti)
        const mitreRes = await fetchJsonWithTimeout<Record<string, unknown>>(
          `https://cveawg.mitre.org/api/cve/${encodeURIComponent(cveId)}`,
          {
            provider: "MITRE_CVE",
            allow404: true,
            fetchImpl,
          }
        );
        if (mitreRes.status === "not_found") {
          return { status: "not_found" };
        }
        return parseMitreCveRecord(cveId, mitreRes.data);
      }

      const raw = res.data;
      if (!raw || typeof raw.id !== "string") {
        throw new UpstreamError("OSV", "OSV_BAD_SCHEMA", "Invalid OSV vulnerability payload");
      }

      const severityArr = Array.isArray(raw.severity)
        ? (raw.severity as Array<{ type?: unknown; score?: unknown }>)
        : [];
      const cvssVector =
        typeof severityArr[0]?.score === "string" ? severityArr[0].score : null;

      const dbSpec =
        raw.database_specific && typeof raw.database_specific === "object"
          ? (raw.database_specific as Record<string, unknown>)
          : null;
      const databaseSeverity =
        typeof dbSpec?.severity === "string" ? dbSpec.severity.toUpperCase() : null;
      const cwes = Array.isArray(dbSpec?.cwe_ids)
        ? dbSpec.cwe_ids.filter((c): c is string => typeof c === "string")
        : [];

      const byPkg = new Map<string, { ecosystem: string; package: string; fixed: Set<string> }>();
      const affectedList = Array.isArray(raw.affected)
        ? (raw.affected as Array<Record<string, unknown>>)
        : [];
      for (const aff of affectedList) {
        const pkg =
          aff?.package && typeof aff.package === "object"
            ? (aff.package as { ecosystem?: unknown; name?: unknown })
            : null;
        if (!pkg || typeof pkg.ecosystem !== "string" || typeof pkg.name !== "string") continue;
        const mapKey = `${pkg.ecosystem}|${pkg.name}`;
        let entry = byPkg.get(mapKey);
        if (!entry) {
          entry = { ecosystem: pkg.ecosystem, package: pkg.name, fixed: new Set() };
          byPkg.set(mapKey, entry);
        }
        const ranges = Array.isArray(aff.ranges)
          ? (aff.ranges as Array<{ events?: Array<{ fixed?: unknown }> }>)
          : [];
        for (const r of ranges) {
          for (const ev of r.events ?? []) {
            if (typeof ev.fixed === "string" && ev.fixed.length > 0) {
              entry.fixed.add(ev.fixed);
            }
          }
        }
      }

      const affectedPackages = Array.from(byPkg.values())
        .slice(0, 15)
        .map((p) => ({
          ecosystem: p.ecosystem,
          package: p.package,
          fixedVersions: Array.from(p.fixed).slice(0, 5),
        }));

      const summaryRaw =
        typeof raw.summary === "string" && raw.summary.trim().length > 0
          ? raw.summary.trim()
          : typeof raw.details === "string" && raw.details.trim().length > 0
            ? raw.details.trim().slice(0, 280)
            : null;

      return {
        status: "ok",
        data: {
          id: raw.id,
          source: "osv_dev",
          summary: summaryRaw,
          published: typeof raw.published === "string" ? raw.published : null,
          modified: typeof raw.modified === "string" ? raw.modified : null,
          aliases: Array.isArray(raw.aliases)
            ? raw.aliases.filter((a): a is string => typeof a === "string").slice(0, 10)
            : [],
          cvssVector,
          databaseSeverity,
          cwes,
          affectedPackages,
        },
      };
    },
  });

  if (value.status === "not_found") {
    return { status: "not_found", cacheHit };
  }
  return { status: "ok", data: value.data, cacheHit };
}

export async function fetchFirstEpssScore(
  cveId: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ score: EpssScore; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<EpssScore>({
    key: `epss:cve:${cveId}`,
    ttlMs: TTL_MS.SEC_CVE_DETAIL,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<{
        data?: Array<{ epss?: unknown; percentile?: unknown }>;
      }>(`https://api.first.org/data/v1/epss?cve=${encodeURIComponent(cveId)}`, {
        provider: "FIRST_EPSS",
        fetchImpl,
      });
      if (res.status !== "ok" || !res.data || !Array.isArray(res.data.data)) {
        throw new UpstreamError("FIRST_EPSS", "EPSS_BAD_SCHEMA", "Invalid FIRST EPSS payload");
      }
      const row = res.data.data[0];
      const prob = toFiniteNumber(row?.epss);
      const pct = toFiniteNumber(row?.percentile);
      return {
        probability: prob !== null ? Math.round(prob * 100_000) / 100_000 : null,
        percentile: pct !== null ? Math.round(pct * 100_000) / 100_000 : null,
      };
    },
  });

  return { score: value, cacheHit };
}
