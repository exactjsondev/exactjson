import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";

export interface SlimFcdoAdvisory {
  slug: string;
  alertStatus: string[];
  updatedAt: string | null;
  latestUpdateNote: string | null;
  highlights: {
    warnings_and_insurance: string | null;
    entry_requirements: string | null;
    safety_and_security: string | null;
    health: string | null;
  };
}

export interface PublicHolidayItem {
  date: string;
  name: string;
  localName: string | null;
  global: boolean;
}

export interface HolidayBrief {
  supported: boolean;
  upcoming: PublicHolidayItem[];
}

export function stripHtmlSnippet(html: unknown, maxLen: number = 220): string | null {
  if (typeof html !== "string" || html.trim().length === 0) return null;
  // Linear tag stripper (avoids catastrophic regex backtracking on 95 KB GOV.UK HTML bodies)
  let out = "";
  let inTag = false;
  const limit = Math.min(html.length, 6000);
  for (let i = 0; i < limit; i++) {
    const ch = html[i]!;
    if (ch === "<") {
      inTag = true;
      out += " ";
    } else if (ch === ">") {
      inTag = false;
    } else if (!inTag) {
      out += ch;
      if (out.length >= maxLen * 3) break;
    }
  }

  const cleaned = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&pound;/gi, "GBP ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

export async function fetchFcdoTravelAdvice(
  slug: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<
  | { status: "not_found"; cacheHit: boolean }
  | { status: "ok"; data: SlimFcdoAdvisory; cacheHit: boolean }
> {
  const { value, cacheHit } = await withTwoTierCache<
    { status: "not_found" } | { status: "ok"; data: SlimFcdoAdvisory }
  >({
    key: `world:fcdo:${slug}`,
    ttlMs: TTL_MS.TRAVEL_FCDO,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    fetcher: async () => {
      let resolvedSlug = slug;
      let res = await fetchJsonWithTimeout<Record<string, unknown>>(
        `https://www.gov.uk/api/content/foreign-travel-advice/${encodeURIComponent(resolvedSlug)}`,
        {
          provider: "GOVUK_FCDO",
          timeoutMs: 5000,
          allow404: true,
          fetchImpl,
        }
      );

      if (res.status === "not_found") {
        return { status: "not_found" };
      }

      if (!res.data?.details && res.data?.schema_name === "redirect" && Array.isArray(res.data.redirects)) {
        const dest = (res.data.redirects[0] as { destination?: unknown } | undefined)?.destination;
        const m = typeof dest === "string" ? /^\/foreign-travel-advice\/([a-z0-9-]+)\/?$/.exec(dest) : null;
        if (m?.[1] && m[1] !== resolvedSlug) {
          resolvedSlug = m[1];
          res = await fetchJsonWithTimeout<Record<string, unknown>>(
            `https://www.gov.uk/api/content/foreign-travel-advice/${encodeURIComponent(resolvedSlug)}`,
            {
              provider: "GOVUK_FCDO",
              timeoutMs: 5000,
              allow404: true,
              fetchImpl,
            }
          );
          if (res.status === "not_found") {
            return { status: "not_found" };
          }
        }
      }

      const details =
        res.data?.details && typeof res.data.details === "object"
          ? (res.data.details as Record<string, unknown>)
          : null;
      if (!details) {
        throw new UpstreamError("GOVUK_FCDO", "FCDO_BAD_SCHEMA", "Invalid GOV.UK FCDO Content API payload");
      }

      const alertStatus = Array.isArray(details.alert_status)
        ? details.alert_status.filter((s): s is string => typeof s === "string")
        : [];

      const parts = Array.isArray(details.parts)
        ? (details.parts as Array<{ slug?: unknown; body?: unknown }>)
        : [];
      const partMap = new Map<string, string | null>();
      for (const p of parts) {
        if (typeof p?.slug === "string") {
          partMap.set(p.slug, stripHtmlSnippet(p.body, 220));
        }
      }

      const updatedAt =
        typeof details.updated_at === "string"
          ? details.updated_at
          : typeof res.data.public_updated_at === "string"
            ? res.data.public_updated_at
            : null;

      const latestUpdateNote =
        typeof details.change_description === "string" && details.change_description.trim()
          ? details.change_description.trim().replace(/\s+/g, " ").slice(0, 260)
          : null;

      return {
        status: "ok",
        data: {
          slug: resolvedSlug,
          alertStatus,
          updatedAt,
          latestUpdateNote,
          highlights: {
            warnings_and_insurance:
              partMap.get("warnings-and-insurance") ?? partMap.get("summary") ?? null,
            entry_requirements: partMap.get("entry-requirements") ?? null,
            safety_and_security: partMap.get("safety-and-security") ?? null,
            health: partMap.get("health") ?? null,
          },
        },
      };
    },
  });

  if (value.status === "not_found") {
    return { status: "not_found", cacheHit };
  }
  return { status: "ok", data: value.data, cacheHit };
}

export async function fetchNagerUpcomingHolidays(
  alpha2: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: HolidayBrief; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<HolidayBrief>({
    key: `world:nager:next:${alpha2}`,
    ttlMs: TTL_MS.TRAVEL_HOLIDAYS,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[] | null>(
        `https://date.nager.at/api/v3/NextPublicHolidays/${encodeURIComponent(alpha2)}`,
        {
          provider: "NAGER_DATE",
          timeoutMs: 4500,
          allow404: true,
          empty204Value: null,
          fetchImpl,
        }
      );

      // Nager.Date returns 204 No Content (or 404) for countries outside its ~115-country catalog (e.g., IN, TH, AE)
      if (res.status === "not_found" || res.data === null) {
        return { supported: false, upcoming: [] };
      }
      if (!Array.isArray(res.data)) {
        throw new UpstreamError("NAGER_DATE", "NAGER_BAD_SCHEMA", "Invalid Nager.Date holiday payload");
      }

      const upcoming: PublicHolidayItem[] = [];
      for (const raw of res.data) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        if (typeof row.date !== "string" || typeof row.name !== "string") continue;
        upcoming.push({
          date: row.date,
          name: row.name,
          localName: typeof row.localName === "string" ? row.localName : null,
          global: Boolean(row.global),
        });
        if (upcoming.length >= 5) break;
      }

      return { supported: true, upcoming };
    },
  });

  return { data: value, cacheHit };
}
