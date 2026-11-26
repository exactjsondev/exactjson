import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { GlobalDnsBaseline, OoniAggregationCounts } from "../providers/ooni";

export type CensorshipBlockingStatus =
  | "CONFIRMED_BLOCKED"
  | "ELEVATED_ANOMALIES"
  | "REACHABLE"
  | "GLOBALLY_UNRESOLVABLE"
  | "INSUFFICIENT_DATA";

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function computeCensorshipCheck(
  domain: string,
  countryCode: string,
  days: number,
  ooni: OoniAggregationCounts,
  dns: GlobalDnsBaseline,
  nowMs: number
) {
  const flags: string[] = [];

  const confirmedRate =
    ooni.measurementCount > 0 ? round4(ooni.confirmedCount / ooni.measurementCount) : 0;
  const impairedRate =
    ooni.measurementCount > 0
      ? round4((ooni.confirmedCount + ooni.anomalyCount) / ooni.measurementCount)
      : 0;

  let blockingStatus: CensorshipBlockingStatus;
  if (!dns.resolvesGlobally && ooni.confirmedCount === 0) {
    blockingStatus = "GLOBALLY_UNRESOLVABLE";
    flags.push("DOMAIN_DOES_NOT_RESOLVE_GLOBALLY");
  } else if (ooni.measurementCount < 5) {
    blockingStatus = "INSUFFICIENT_DATA";
    flags.push("LOW_OONI_SAMPLE_SIZE");
  } else if (
    (ooni.confirmedCount >= 2 && confirmedRate >= 0.05) ||
    confirmedRate >= 0.15
  ) {
    blockingStatus = "CONFIRMED_BLOCKED";
    flags.push("OONI_CONFIRMED_CENSORSHIP");
    if (impairedRate >= 0.5) {
      flags.push("HIGH_IMPAIRMENT_RATE");
    }
  } else if (impairedRate >= 0.25 && ooni.confirmedCount + ooni.anomalyCount >= 3) {
    blockingStatus = "ELEVATED_ANOMALIES";
    flags.push("OONI_ELEVATED_ANOMALIES");
  } else {
    blockingStatus = "REACHABLE";
  }

  return {
    domain,
    country_code: countryCode,
    window_days: days,
    blocking_status: blockingStatus,
    resolves_globally: dns.resolvesGlobally,
    global_a_record_count: dns.aRecordCount,
    ooni: {
      measurement_count: ooni.measurementCount,
      confirmed_count: ooni.confirmedCount,
      anomaly_count: ooni.anomalyCount,
      ok_count: ooni.okCount,
      failure_count: ooni.failureCount,
      confirmed_rate: confirmedRate,
      impaired_rate: impairedRate,
      since_date: ooni.sinceDate,
      until_date: ooni.untilDate,
    },
    flags,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: ["ooni_aggregation", "cloudflare_doh"],
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
