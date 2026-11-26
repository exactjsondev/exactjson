import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { EolProductData, EolReleaseCycle } from "../providers/endoflife";

export function matchReleaseCycle(
  releases: readonly EolReleaseCycle[],
  rawCycle: string
): EolReleaseCycle | null {
  const normalized = rawCycle.trim().toLowerCase();
  const exact = releases.find((r) => r.name.toLowerCase() === normalized);
  if (exact) return exact;

  // Match full version strings (e.g. "18.20.4" -> "18" or "3.12.7" -> "3.12") choosing longest matching cycle prefix
  let bestMatch: EolReleaseCycle | null = null;
  for (const r of releases) {
    const prefix = `${r.name.toLowerCase()}.`;
    if (normalized.startsWith(prefix)) {
      if (!bestMatch || r.name.length > bestMatch.name.length) {
        bestMatch = r;
      }
    }
  }
  return bestMatch;
}

function formatCycleDetail(cycle: EolReleaseCycle, nowMs: number) {
  let daysUntilEol: number | null = null;
  if (cycle.eolFrom) {
    const eolMs = Date.parse(`${cycle.eolFrom}T00:00:00Z`);
    if (Number.isFinite(eolMs)) {
      daysUntilEol = Math.floor((eolMs - nowMs) / 86_400_000);
    }
  }

  const status = cycle.isEol
    ? "EOL"
    : cycle.isEoas === true
      ? "MAINTENANCE_SECURITY_ONLY"
      : cycle.isLts
        ? "ACTIVE_LTS"
        : "ACTIVE";

  return {
    cycle: cycle.name,
    label: cycle.label,
    is_eol: cycle.isEol,
    is_maintained: cycle.isMaintained,
    is_lts: cycle.isLts,
    release_date: cycle.releaseDate,
    eoas_date: cycle.eoasFrom,
    eol_date: cycle.eolFrom,
    days_until_eol: daysUntilEol,
    latest_patch: cycle.latestName,
    latest_patch_date: cycle.latestDate,
    status,
  };
}

export function computeRuntimeEol(
  productData: EolProductData,
  queriedCycle: string | null,
  matched: EolReleaseCycle | null,
  nowMs: number = Date.now()
) {
  const activeReleases = productData.releases.filter((r) => !r.isEol && r.isMaintained);
  const recommendedLts = activeReleases.find((r) => r.isLts) ?? null;
  const latestCurrent = productData.releases[0] ?? null;

  return {
    product: productData.name,
    label: productData.label,
    category: productData.category,
    queried_cycle: queriedCycle,
    matched_cycle: matched ? formatCycleDetail(matched, nowMs) : null,
    recommended_lts: recommendedLts
      ? {
          cycle: recommendedLts.name,
          latest_patch: recommendedLts.latestName,
          eol_date: recommendedLts.eolFrom,
        }
      : null,
    latest_current: latestCurrent
      ? {
          cycle: latestCurrent.name,
          latest_patch: latestCurrent.latestName,
          is_lts: latestCurrent.isLts,
          eol_date: latestCurrent.eolFrom,
        }
      : null,
    active_cycles_count: activeReleases.length,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: ["endoflife_date"],
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
