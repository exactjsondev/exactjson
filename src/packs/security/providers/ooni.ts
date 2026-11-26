import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export interface OoniAggregationCounts {
  measurementCount: number;
  confirmedCount: number;
  anomalyCount: number;
  okCount: number;
  failureCount: number;
  sinceDate: string;
  untilDate: string;
}

export interface GlobalDnsBaseline {
  resolvesGlobally: boolean;
  aRecordCount: number;
}

export async function fetchOoniWebConnectivity(
  domain: string,
  countryCode: string,
  days: number,
  nowMs: number,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: OoniAggregationCounts; cacheHit: boolean }> {
  const untilDate = new Date(nowMs).toISOString().slice(0, 10);
  const sinceDate = new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);

  const { value, cacheHit } = await withTwoTierCache<OoniAggregationCounts>({
    key: `ooni:wc:${countryCode}:${domain}:${sinceDate}:${untilDate}`,
    ttlMs: TTL_MS.NET_CENSORSHIP_OONI,
    cache,
    waitUntil,
    fetcher: async () => {
      const url =
        `https://api.ooni.io/api/v1/aggregation?test_name=web_connectivity` +
        `&probe_cc=${encodeURIComponent(countryCode)}` +
        `&domain=${encodeURIComponent(domain)}` +
        `&since=${encodeURIComponent(sinceDate)}` +
        `&until=${encodeURIComponent(untilDate)}`;

      const res = await fetchJsonWithTimeout<{ result?: unknown }>(url, {
        provider: "OONI",
        timeoutMs: 6000,
        fetchImpl,
      });

      if (res.status !== "ok" || !res.data || typeof res.data.result !== "object" || !res.data.result) {
        throw new UpstreamError("OONI", "OONI_BAD_SCHEMA", "Invalid OONI aggregation payload");
      }

      const rawResult = Array.isArray(res.data.result)
        ? (res.data.result[0] as Record<string, unknown> | undefined)
        : (res.data.result as Record<string, unknown>);
      if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
        throw new UpstreamError("OONI", "OONI_BAD_SCHEMA", "Invalid OONI aggregation row");
      }
      const row = rawResult;
      const measurementCount = toFiniteNumber(row.measurement_count);
      const confirmedCount = toFiniteNumber(row.confirmed_count);
      const anomalyCount = toFiniteNumber(row.anomaly_count);
      const okCount = toFiniteNumber(row.ok_count);
      const failureCount = toFiniteNumber(row.failure_count);

      if (
        measurementCount === null ||
        confirmedCount === null ||
        anomalyCount === null ||
        okCount === null ||
        failureCount === null
      ) {
        throw new UpstreamError("OONI", "OONI_BAD_SCHEMA", "Missing numeric counts in OONI payload");
      }

      return {
        measurementCount: Math.max(0, Math.round(measurementCount)),
        confirmedCount: Math.max(0, Math.round(confirmedCount)),
        anomalyCount: Math.max(0, Math.round(anomalyCount)),
        okCount: Math.max(0, Math.round(okCount)),
        failureCount: Math.max(0, Math.round(failureCount)),
        sinceDate,
        untilDate,
      };
    },
  });

  return { data: value, cacheHit };
}

export async function fetchGlobalDnsBaseline(
  domain: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: GlobalDnsBaseline; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<GlobalDnsBaseline>({
    key: `doh:global:${domain}`,
    ttlMs: TTL_MS.NET_DOMAIN_DOH,
    cache,
    waitUntil,
    fetcher: async () => {
      const [resA, resAAAA] = await Promise.all([
        fetchJsonWithTimeout<{ Status?: unknown; Answer?: Array<{ type?: unknown; data?: unknown }> }>(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
          { provider: "CF_DOH", headers: { Accept: "application/dns-json" }, fetchImpl }
        ),
        fetchJsonWithTimeout<{ Status?: unknown; Answer?: Array<{ type?: unknown; data?: unknown }> }>(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=AAAA`,
          { provider: "CF_DOH", headers: { Accept: "application/dns-json" }, fetchImpl }
        ),
      ]);

      if (resA.status !== "ok" || resAAAA.status !== "ok") {
        throw new UpstreamError("CF_DOH", "CF_DOH_UNAVAILABLE", "Cloudflare DoH unavailable");
      }

      const statusA = resA.data?.Status;
      const statusAAAA = resAAAA.data?.Status;
      if (
        typeof statusA !== "number" ||
        typeof statusAAAA !== "number" ||
        (statusA !== 0 && statusA !== 3) ||
        (statusAAAA !== 0 && statusAAAA !== 3)
      ) {
        throw new UpstreamError(
          "CF_DOH",
          "CF_DOH_SERVFAIL",
          `Cloudflare DoH returned DNS error Status A=${String(statusA)} AAAA=${String(statusAAAA)}`
        );
      }

      const aCount = (Array.isArray(resA.data.Answer) ? resA.data.Answer : []).filter(
        (a) => a.type === 1 && typeof a.data === "string"
      ).length;
      const aaaaCount = (Array.isArray(resAAAA.data.Answer) ? resAAAA.data.Answer : []).filter(
        (a) => a.type === 28 && typeof a.data === "string"
      ).length;

      return {
        resolvesGlobally: aCount > 0 || aaaaCount > 0,
        aRecordCount: aCount,
      };
    },
  });

  return { data: value, cacheHit };
}
