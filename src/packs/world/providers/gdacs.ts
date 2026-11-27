import {
  type BoundedTtlCache,
  TTL_MS,
  referenceCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchTextWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export interface SlimGdacsEvent {
  eventId: string;
  eventType: string;
  alertLevel: "Green" | "Orange" | "Red";
  title: string;
  severityText: string | null;
  country: string | null;
  iso3Codes: string[];
  lat: number | null;
  lon: number | null;
  pubDate: string | null;
}

function readTagText(itemXml: string, tagName: string): string | null {
  const exactOpen = `<${tagName}>`;
  const attrOpen = `<${tagName} `;
  const close = `</${tagName}>`;

  let start = itemXml.indexOf(exactOpen);
  let bodyStart = -1;
  if (start !== -1) {
    bodyStart = start + exactOpen.length;
  } else {
    start = itemXml.indexOf(attrOpen);
    if (start === -1) return null;
    const gt = itemXml.indexOf(">", start + attrOpen.length);
    if (gt === -1) return null;
    if (itemXml[gt - 1] === "/") return null;
    bodyStart = gt + 1;
  }

  const end = itemXml.indexOf(close, bodyStart);
  if (end === -1) return null;
  const decoded = itemXml
    .slice(bodyStart, end)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length > 0 ? decoded : null;
}

export function parseGdacsRssXml(xml: string): SlimGdacsEvent[] {
  if (!xml.includes("<rss") && !xml.includes("<channel")) {
    throw new UpstreamError("GDACS", "GDACS_BAD_XML", "Invalid GDACS RSS XML payload");
  }

  const events: SlimGdacsEvent[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<item>", cursor);
    if (start === -1) break;
    const end = xml.indexOf("</item>", start + 6);
    if (end === -1) break;

    const item = xml.slice(start + 6, end);
    cursor = end + 7;

    const isCurrent = readTagText(item, "gdacs:iscurrent");
    if (isCurrent && isCurrent.toLowerCase() === "false") {
      continue;
    }

    const eventType = (readTagText(item, "gdacs:eventtype") ?? "").toUpperCase();
    const eventId = readTagText(item, "gdacs:eventid") ?? readTagText(item, "guid") ?? "";
    const title = readTagText(item, "title");
    if (!eventType || !title) continue;

    const rawLevel = (readTagText(item, "gdacs:alertlevel") ?? "Green").toLowerCase();
    const alertLevel: SlimGdacsEvent["alertLevel"] =
      rawLevel === "red" ? "Red" : rawLevel === "orange" ? "Orange" : "Green";

    let lat = toFiniteNumber(readTagText(item, "geo:lat"));
    let lon = toFiniteNumber(readTagText(item, "geo:long"));
    if (lat === null || lon === null) {
      const georss = readTagText(item, "georss:point");
      if (georss) {
        const parts = georss.split(/\s+/);
        lat = toFiniteNumber(parts[0]);
        lon = toFiniteNumber(parts[1]);
      }
    }

    const iso3Raw = readTagText(item, "gdacs:iso3") ?? "";
    const iso3Codes = iso3Raw
      .split(/[\s,;/]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{3}$/.test(s));

    events.push({
      eventId,
      eventType,
      alertLevel,
      title: title.slice(0, 200),
      severityText: readTagText(item, "gdacs:severity")?.slice(0, 120) ?? null,
      country: readTagText(item, "gdacs:country")?.slice(0, 100) ?? null,
      iso3Codes,
      lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
      lon: lon !== null && lon >= -180 && lon <= 180 ? lon : null,
      pubDate: readTagText(item, "pubDate"),
    });

    if (events.length >= 250) break;
  }

  return events;
}

export async function fetchGdacsActiveEvents(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ events: SlimGdacsEvent[]; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SlimGdacsEvent[]>({
    key: "world:gdacs:rss:v1",
    ttlMs: TTL_MS.WORLD_GDACS,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchTextWithTimeout("https://www.gdacs.org/xml/rss.xml", {
        provider: "GDACS",
        timeoutMs: 6500,
        fetchImpl,
      });
      if (res.status !== "ok") {
        throw new UpstreamError("GDACS", "GDACS_UNAVAILABLE", "GDACS RSS feed unavailable");
      }
      return parseGdacsRssXml(res.data);
    },
  });

  return { events: value, cacheHit };
}
