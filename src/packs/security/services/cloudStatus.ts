import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { CloudProviderStatusItem } from "../providers/cloudStatus";
import type { CloudProviderId } from "../validation";

export type CloudOverallRegime = "OPERATIONAL" | "DEGRADED" | "MAJOR_OUTAGE";

export function computeCloudStatus(
  items: readonly CloudProviderStatusItem[],
  missingProviders: readonly CloudProviderId[],
  nowMs: number
) {
  let degradedCount = 0;
  let activeIncidentsCount = 0;
  let hasMajor = false;

  for (const item of items) {
    if (!item.operational) {
      degradedCount += 1;
    }
    activeIncidentsCount += item.active_incidents.length;

    if (item.indicator === "major" || item.indicator === "critical") {
      hasMajor = true;
    }
    if (
      item.active_incidents.some(
        (inc) => inc.impact === "major" || inc.impact === "critical"
      )
    ) {
      hasMajor = true;
    }
    if (item.degraded_components.some((c) => c.status === "major_outage")) {
      hasMajor = true;
    }
  }

  let overallRegime: CloudOverallRegime = "OPERATIONAL";
  if (hasMajor) {
    overallRegime = "MAJOR_OUTAGE";
  } else if (degradedCount > 0 || missingProviders.length > 0) {
    overallRegime = "DEGRADED";
  }

  return {
    overall_regime: overallRegime,
    deploy_safe: overallRegime === "OPERATIONAL" && missingProviders.length === 0,
    queried_count: items.length + missingProviders.length,
    degraded_count: degradedCount,
    active_incidents_count: activeIncidentsCount,
    providers: items,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: items.map((i) => i.provider),
      missing_providers: [...missingProviders],
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
