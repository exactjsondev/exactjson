import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  referenceCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout, fetchTextWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN";

export interface SlimMetarObservation {
  icaoId: string;
  stationName: string | null;
  lat: number | null;
  lon: number | null;
  observedAt: string | null;
  tempC: number | null;
  dewpointC: number | null;
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibilitySm: number | null;
  ceilingFtAgl: number | null;
  altimeterHpa: number | null;
  wxString: string | null;
  rawMetar: string | null;
  reportedFlightCategory: FlightCategory | null;
}

export interface SlimSigmet {
  firId: string;
  hazard: string;
  qualifier: string | null;
  baseFt: number | null;
  topFt: number | null;
  centroidLat: number;
  centroidLon: number;
}

export interface FaaAirportDisruption {
  category: "AIRPORT_CLOSURE" | "GROUND_STOP" | "GROUND_DELAY_PROGRAM" | "ARRIVAL_DEPARTURE_DELAY";
  reason: string | null;
  avgDelay: string | null;
  maxDelay: string | null;
  endOrReopen: string | null;
}

const VALID_FLT_CATS = new Set(["VFR", "MVFR", "IFR", "LIFR"]);
const CEILING_COVERS = new Set(["BKN", "OVC", "VV", "OVX"]);

export function parseVisibilityStatuteMiles(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(/^[MP<>]\s*/i, "")
    .replace(/\+$/, "")
    .replace(/SM$/i, "")
    .trim();
  if (!cleaned) return null;

  // Mixed fraction e.g. "1 1/2"
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(cleaned);
  if (mixed) {
    const whole = Number.parseInt(mixed[1]!, 10);
    const num = Number.parseInt(mixed[2]!, 10);
    const den = Number.parseInt(mixed[3]!, 10);
    if (den > 0) return Math.round((whole + num / den) * 100) / 100;
  }

  // Simple fraction e.g. "1/2" or "3/4"
  const frac = /^(\d+)\/(\d+)$/.exec(cleaned);
  if (frac) {
    const num = Number.parseInt(frac[1]!, 10);
    const den = Number.parseInt(frac[2]!, 10);
    if (den > 0) return Math.round((num / den) * 100) / 100;
  }

  const dec = Number(cleaned);
  if (Number.isFinite(dec) && dec >= 0) {
    return Math.round(dec * 100) / 100;
  }
  return null;
}

export function deriveFlightCategory(
  reported: FlightCategory | null,
  ceilingFt: number | null,
  visibSm: number | null
): FlightCategory {
  if (reported && reported !== "UNKNOWN") {
    return reported;
  }
  if (ceilingFt === null && visibSm === null) {
    return "UNKNOWN";
  }
  if ((ceilingFt !== null && ceilingFt < 500) || (visibSm !== null && visibSm < 1)) {
    return "LIFR";
  }
  if ((ceilingFt !== null && ceilingFt < 1000) || (visibSm !== null && visibSm < 3)) {
    return "IFR";
  }
  if ((ceilingFt !== null && ceilingFt <= 3000) || (visibSm !== null && visibSm <= 5)) {
    return "MVFR";
  }
  return "VFR";
}

export async function fetchAirportMetar(
  icao: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ metar: SlimMetarObservation | null; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SlimMetarObservation | null>({
    key: `world:awc:metar:${icao}`,
    ttlMs: TTL_MS.AVIATION_METAR,
    cache,
    waitUntil,
    shouldCache: (v) => v !== null,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[]>(
        `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`,
        {
          provider: "AWC",
          empty204Value: [],
          fetchImpl,
        }
      );
      if (res.status !== "ok" || !Array.isArray(res.data)) {
        throw new UpstreamError("AWC", "AWC_METAR_BAD_SCHEMA", "Invalid NOAA AWC METAR payload");
      }
      if (res.data.length === 0) return null;

      const row = res.data[0] as Record<string, unknown>;
      if (!row || typeof row !== "object") {
        throw new UpstreamError("AWC", "AWC_METAR_BAD_SCHEMA", "Invalid NOAA AWC METAR row");
      }

      let ceilingFtAgl: number | null = null;
      if (Array.isArray(row.clouds)) {
        for (const cl of row.clouds as Array<{ cover?: unknown; base?: unknown }>) {
          const cover = typeof cl?.cover === "string" ? cl.cover.toUpperCase() : "";
          const base = toFiniteNumber(cl?.base);
          if (CEILING_COVERS.has(cover) && base !== null && base >= 0) {
            if (ceilingFtAgl === null || base < ceilingFtAgl) {
              ceilingFtAgl = Math.round(base);
            }
          }
        }
      }
      const vertVis = toFiniteNumber(row.vertVis);
      if (vertVis !== null && vertVis >= 0) {
        if (ceilingFtAgl === null || vertVis < ceilingFtAgl) {
          ceilingFtAgl = Math.round(vertVis);
        }
      }

      const fltCatRaw = typeof row.fltCat === "string" ? row.fltCat.trim().toUpperCase() : "";
      const reportedFlightCategory: FlightCategory | null = VALID_FLT_CATS.has(fltCatRaw)
        ? (fltCatRaw as FlightCategory)
        : null;

      const lat = toFiniteNumber(row.lat);
      const lon = toFiniteNumber(row.lon);

      return {
        icaoId: typeof row.icaoId === "string" ? row.icaoId.toUpperCase() : icao,
        stationName: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
        lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
        lon: lon !== null && lon >= -180 && lon <= 180 ? lon : null,
        observedAt:
          typeof row.reportTime === "string"
            ? row.reportTime
            : typeof row.receiptTime === "string"
              ? row.receiptTime
              : null,
        tempC: toFiniteNumber(row.temp),
        dewpointC: toFiniteNumber(row.dewp),
        windDirDeg: toFiniteNumber(row.wdir),
        windSpeedKt: toFiniteNumber(row.wspd),
        windGustKt: toFiniteNumber(row.wgst),
        visibilitySm: parseVisibilityStatuteMiles(row.visib),
        ceilingFtAgl,
        altimeterHpa: toFiniteNumber(row.altim),
        wxString: typeof row.wxString === "string" && row.wxString.trim() ? row.wxString.trim() : null,
        rawMetar: typeof row.rawOb === "string" && row.rawOb.trim() ? row.rawOb.trim() : null,
        reportedFlightCategory,
      };
    },
  });

  return { metar: value, cacheHit };
}

export async function fetchAirportTaf(
  icao: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ rawTaf: string | null; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<string | null>({
    key: `world:awc:taf:${icao}`,
    ttlMs: TTL_MS.AVIATION_TAF,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[]>(
        `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`,
        {
          provider: "AWC",
          timeoutMs: 6000,
          empty204Value: [],
          fetchImpl,
        }
      );
      if (res.status !== "ok" || !Array.isArray(res.data)) {
        throw new UpstreamError("AWC", "AWC_TAF_BAD_SCHEMA", "Invalid NOAA AWC TAF payload");
      }
      if (res.data.length === 0) return null;
      const row = res.data[0] as Record<string, unknown>;
      return typeof row?.rawTAF === "string" && row.rawTAF.trim()
        ? row.rawTAF.trim().slice(0, 600)
        : null;
    },
  });

  return { rawTaf: value, cacheHit };
}

export async function fetchActiveSigmets(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ sigmets: SlimSigmet[]; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SlimSigmet[]>({
    key: "world:awc:isigmet:v1",
    ttlMs: TTL_MS.AVIATION_SIGMET,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[]>(
        "https://aviationweather.gov/api/data/isigmet?format=json",
        {
          provider: "AWC",
          timeoutMs: 5000,
          empty204Value: [],
          fetchImpl,
        }
      );
      if (res.status !== "ok" || !Array.isArray(res.data)) {
        throw new UpstreamError("AWC", "AWC_SIGMET_BAD_SCHEMA", "Invalid NOAA AWC SIGMET payload");
      }

      const slimmed: SlimSigmet[] = [];
      for (const raw of res.data) {
        if (!raw || typeof raw !== "object") continue;
        const rec = raw as Record<string, unknown>;
        const coords = Array.isArray(rec.coords)
          ? (rec.coords as Array<{ lat?: unknown; lon?: unknown }>)
          : [];
        let latSum = 0;
        let lonSum = 0;
        let validPts = 0;
        for (const pt of coords) {
          const la = toFiniteNumber(pt?.lat);
          const lo = toFiniteNumber(pt?.lon);
          if (la !== null && lo !== null && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) {
            latSum += la;
            lonSum += lo;
            validPts += 1;
          }
        }
        if (validPts === 0) continue;

        slimmed.push({
          firId: typeof rec.firId === "string" ? rec.firId : "UNKNOWN",
          hazard: typeof rec.hazard === "string" ? rec.hazard.toUpperCase() : "SIGMET",
          qualifier: typeof rec.qualifier === "string" && rec.qualifier.trim() ? rec.qualifier.trim() : null,
          baseFt: toFiniteNumber(rec.base),
          topFt: toFiniteNumber(rec.top),
          centroidLat: Math.round((latSum / validPts) * 1000) / 1000,
          centroidLon: Math.round((lonSum / validPts) * 1000) / 1000,
        });
        if (slimmed.length >= 250) break;
      }
      return slimmed;
    },
  });

  return { sigmets: value, cacheHit };
}

function extractXmlTag(block: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = block.indexOf(open);
  if (start === -1) return null;
  const contentStart = start + open.length;
  const end = block.indexOf(close, contentStart);
  if (end === -1) return null;
  const val = block
    .slice(contentStart, end)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return val.length > 0 ? val : null;
}

function extractXmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf(open, cursor);
    if (start === -1) break;
    const end = xml.indexOf(close, start + open.length);
    if (end === -1) break;
    blocks.push(xml.slice(start + open.length, end));
    cursor = end + close.length;
  }
  return blocks;
}

export function parseFaaNasXml(xml: string): Record<string, FaaAirportDisruption[]> {
  if (!xml.includes("<AIRPORT_STATUS_INFORMATION")) {
    throw new UpstreamError("FAA_NAS", "FAA_NAS_BAD_XML", "Invalid FAA NAS XML document");
  }

  const byAirport: Record<string, FaaAirportDisruption[]> = Object.create(null);

  function pushDisruption(code: string | null, item: FaaAirportDisruption): void {
    if (!code) return;
    const key = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(key)) return;
    if (!byAirport[key]) byAirport[key] = [];
    byAirport[key]!.push(item);
  }

  for (const delayBlock of extractXmlBlocks(xml, "Delay_type")) {
    const name = (extractXmlTag(delayBlock, "Name") ?? "").toLowerCase();

    if (name.includes("closure")) {
      for (const ap of extractXmlBlocks(delayBlock, "Airport")) {
        pushDisruption(extractXmlTag(ap, "ARPT"), {
          category: "AIRPORT_CLOSURE",
          reason: extractXmlTag(ap, "Reason")?.slice(0, 180) ?? null,
          avgDelay: null,
          maxDelay: null,
          endOrReopen: extractXmlTag(ap, "Reopen"),
        });
      }
    } else if (name.includes("ground stop")) {
      for (const gs of extractXmlBlocks(delayBlock, "Program")) {
        pushDisruption(extractXmlTag(gs, "ARPT"), {
          category: "GROUND_STOP",
          reason: extractXmlTag(gs, "Reason")?.slice(0, 180) ?? null,
          avgDelay: null,
          maxDelay: null,
          endOrReopen: extractXmlTag(gs, "End_Time"),
        });
      }
      for (const gsAp of extractXmlBlocks(delayBlock, "Airport")) {
        pushDisruption(extractXmlTag(gsAp, "ARPT"), {
          category: "GROUND_STOP",
          reason: extractXmlTag(gsAp, "Reason")?.slice(0, 180) ?? null,
          avgDelay: null,
          maxDelay: null,
          endOrReopen: extractXmlTag(gsAp, "End_Time"),
        });
      }
    } else if (name.includes("ground delay")) {
      for (const gd of extractXmlBlocks(delayBlock, "Ground_Delay")) {
        pushDisruption(extractXmlTag(gd, "ARPT"), {
          category: "GROUND_DELAY_PROGRAM",
          reason: extractXmlTag(gd, "Reason")?.slice(0, 180) ?? null,
          avgDelay: extractXmlTag(gd, "Avg") ?? extractXmlTag(gd, "Average_Delay"),
          maxDelay: extractXmlTag(gd, "Max") ?? extractXmlTag(gd, "Maximum_Delay"),
          endOrReopen: null,
        });
      }
    } else if (name.includes("arrival") || name.includes("departure")) {
      for (const ad of extractXmlBlocks(delayBlock, "Delay")) {
        pushDisruption(extractXmlTag(ad, "ARPT"), {
          category: "ARRIVAL_DEPARTURE_DELAY",
          reason: extractXmlTag(ad, "Reason")?.slice(0, 180) ?? null,
          avgDelay: extractXmlTag(ad, "Min") ?? extractXmlTag(ad, "Avg"),
          maxDelay: extractXmlTag(ad, "Max"),
          endOrReopen: null,
        });
      }
    }
  }

  return byAirport;
}

export async function fetchFaaNasMap(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ map: Record<string, FaaAirportDisruption[]>; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<Record<string, FaaAirportDisruption[]>>({
    key: "world:faa:nas:v1",
    ttlMs: TTL_MS.AVIATION_FAA_NAS,
    cache,
    waitUntil,
    fetcher: async () => {
      // Strictly cap US FAA NAS XML to 3.5s per guardrail so slow cold responses fallback cleanly to METAR
      const res = await fetchTextWithTimeout(
        "https://nasstatus.faa.gov/api/airport-status-information",
        {
          provider: "FAA_NAS",
          timeoutMs: 3500,
          fetchImpl,
        }
      );
      if (res.status !== "ok") {
        throw new UpstreamError("FAA_NAS", "FAA_NAS_UNAVAILABLE", "FAA NAS XML unavailable");
      }
      return parseFaaNasXml(res.data);
    },
  });

  return { map: value, cacheHit };
}
