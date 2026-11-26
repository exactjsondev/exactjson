import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import type { CloudProviderId } from "../validation";

export interface CloudProviderIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  updated_at: string | null;
}

export interface CloudProviderStatusItem {
  provider: CloudProviderId;
  name: string;
  indicator: string;
  description: string;
  operational: boolean;
  degraded_components: Array<{ name: string; status: string }>;
  active_incidents: CloudProviderIncident[];
  updated_at: string | null;
}

const PROVIDER_META: Readonly<
  Record<
    Exclude<CloudProviderId, "cloudflare">,
    { name: string; summaryUrl: string }
  >
> = {
  github: {
    name: "GitHub",
    summaryUrl: "https://www.githubstatus.com/api/v2/summary.json",
  },
  openai: {
    name: "OpenAI",
    summaryUrl: "https://status.openai.com/api/v2/summary.json",
  },
  anthropic: {
    name: "Anthropic",
    summaryUrl: "https://status.anthropic.com/api/v2/summary.json",
  },
  vercel: {
    name: "Vercel",
    summaryUrl: "https://www.vercel-status.com/api/v2/summary.json",
  },
  npm: {
    name: "npm",
    summaryUrl: "https://status.npmjs.org/api/v2/summary.json",
  },
};

function parseActiveIncidents(rawIncidents: unknown): {
  incidents: CloudProviderIncident[];
  incidentComponents: Array<{ name: string; status: string }>;
} {
  if (!Array.isArray(rawIncidents)) {
    return { incidents: [], incidentComponents: [] };
  }

  const incidents: CloudProviderIncident[] = [];
  const compMap = new Map<string, string>();

  for (const inc of rawIncidents) {
    if (!inc || typeof inc !== "object") continue;
    const row = inc as Record<string, unknown>;
    const status = typeof row.status === "string" ? row.status.toLowerCase() : "unknown";
    if (status === "resolved" || status === "postmortem" || status === "completed") continue;

    if (incidents.length < 10) {
      incidents.push({
        id: typeof row.id === "string" ? row.id : "unknown",
        name: typeof row.name === "string" ? row.name : "Active Incident",
        status,
        impact: typeof row.impact === "string" ? row.impact.toLowerCase() : "minor",
        updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
      });
    }

    if (Array.isArray(row.components)) {
      for (const comp of row.components as Array<Record<string, unknown>>) {
        const compName = typeof comp?.name === "string" ? comp.name.trim() : "";
        const compStatus = typeof comp?.status === "string" ? comp.status.toLowerCase() : "";
        if (compName && compStatus && compStatus !== "operational") {
          compMap.set(compName, compStatus);
        }
      }
    }
  }

  return {
    incidents,
    incidentComponents: Array.from(compMap.entries())
      .slice(0, 15)
      .map(([name, status]) => ({ name, status })),
  };
}

async function fetchSingleProvider(
  provider: CloudProviderId,
  fetchImpl: typeof fetch
): Promise<CloudProviderStatusItem> {
  if (provider === "cloudflare") {
    const [statusRes, incRes] = await Promise.all([
      fetchJsonWithTimeout<Record<string, unknown>>(
        "https://www.cloudflarestatus.com/api/v2/status.json",
        { provider: "STATUSPAGE", fetchImpl }
      ),
      fetchJsonWithTimeout<Record<string, unknown>>(
        "https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json",
        { provider: "STATUSPAGE", fetchImpl }
      ),
    ]);

    if (statusRes.status !== "ok" || incRes.status !== "ok") {
      throw new UpstreamError("STATUSPAGE", "STATUSPAGE_CF_UNAVAILABLE", "Cloudflare status error");
    }

    const statusObj =
      statusRes.data.status && typeof statusRes.data.status === "object"
        ? (statusRes.data.status as Record<string, unknown>)
        : null;
    const pageObj =
      statusRes.data.page && typeof statusRes.data.page === "object"
        ? (statusRes.data.page as Record<string, unknown>)
        : null;
    if (!statusObj || typeof statusObj.indicator !== "string") {
      throw new UpstreamError("STATUSPAGE", "STATUSPAGE_BAD_SCHEMA", "Invalid Cloudflare status");
    }

    const indicator = statusObj.indicator.toLowerCase();
    const description =
      typeof statusObj.description === "string" ? statusObj.description : "Unknown";
    const { incidents, incidentComponents } = parseActiveIncidents(incRes.data.incidents);
    const operational =
      indicator === "none" && incidents.length === 0 && incidentComponents.length === 0;

    return {
      provider: "cloudflare",
      name: "Cloudflare",
      indicator,
      description,
      operational,
      degraded_components: incidentComponents,
      active_incidents: incidents,
      updated_at: typeof pageObj?.updated_at === "string" ? pageObj.updated_at : null,
    };
  }

  const meta = PROVIDER_META[provider];
  const res = await fetchJsonWithTimeout<Record<string, unknown>>(meta.summaryUrl, {
    provider: "STATUSPAGE",
    fetchImpl,
  });
  if (res.status !== "ok") {
    throw new UpstreamError("STATUSPAGE", "STATUSPAGE_UNAVAILABLE", `${meta.name} status error`);
  }

  const raw = res.data;
  const statusObj =
    raw.status && typeof raw.status === "object"
      ? (raw.status as Record<string, unknown>)
      : null;
  const pageObj =
    raw.page && typeof raw.page === "object" ? (raw.page as Record<string, unknown>) : null;
  if (!statusObj || typeof statusObj.indicator !== "string") {
    throw new UpstreamError("STATUSPAGE", "STATUSPAGE_BAD_SCHEMA", `Invalid ${meta.name} summary`);
  }

  const indicator = statusObj.indicator.toLowerCase();
  const description = typeof statusObj.description === "string" ? statusObj.description : "Unknown";

  const degradedComponents: Array<{ name: string; status: string }> = [];
  if (Array.isArray(raw.components)) {
    for (const comp of raw.components as Array<Record<string, unknown>>) {
      const name = typeof comp?.name === "string" ? comp.name.trim() : "";
      const status = typeof comp?.status === "string" ? comp.status.toLowerCase() : "";
      if (!name || name.startsWith("Visit ") || !status || status === "operational") continue;
      if (degradedComponents.length < 15) {
        degradedComponents.push({ name, status });
      }
    }
  }

  const { incidents } = parseActiveIncidents(raw.incidents);
  const operational =
    indicator === "none" && degradedComponents.length === 0 && incidents.length === 0;

  return {
    provider,
    name: meta.name,
    indicator,
    description,
    operational,
    degraded_components: degradedComponents,
    active_incidents: incidents,
    updated_at: typeof pageObj?.updated_at === "string" ? pageObj.updated_at : null,
  };
}

export async function fetchCloudStatusFeeds(
  providers: readonly CloudProviderId[],
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{
  items: CloudProviderStatusItem[];
  missingProviders: CloudProviderId[];
  cacheHits: boolean[];
}> {
  const settled = await Promise.allSettled(
    providers.map((provider) =>
      withTwoTierCache<CloudProviderStatusItem>({
        key: `statuspage:v2:${provider}`,
        ttlMs: TTL_MS.OPS_CLOUD_STATUS,
        cache,
        waitUntil,
        fetcher: () => fetchSingleProvider(provider, fetchImpl),
      })
    )
  );

  const items: CloudProviderStatusItem[] = [];
  const missingProviders: CloudProviderId[] = [];
  const cacheHits: boolean[] = [];
  let firstError: unknown = null;

  settled.forEach((entry, idx) => {
    const providerId = providers[idx]!;
    if (entry.status === "fulfilled") {
      items.push(entry.value.value);
      cacheHits.push(entry.value.cacheHit);
    } else {
      missingProviders.push(providerId);
      if (!firstError) firstError = entry.reason;
    }
  });

  const requiredQuorum =
    providers.length <= 4 ? providers.length : Math.ceil(providers.length * 0.8);

  if (items.length < requiredQuorum) {
    if (firstError instanceof UpstreamError) throw firstError;
    throw new UpstreamError(
      "STATUSPAGE",
      "STATUSPAGE_QUORUM_FAILED",
      "Insufficient cloud status feeds reachable"
    );
  }

  return { items, missingProviders, cacheHits };
}
