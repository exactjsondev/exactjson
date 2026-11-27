import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  referenceCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export interface CensusGeocodeMatch {
  lat: number;
  lon: number;
  matchedAddress: string;
  zip: string | null;
  state: string | null;
}

export interface UsgsQuakeSummary {
  countM25Plus: number;
  countM45Plus: number;
  maxMagnitude: number | null;
  strongest: {
    magnitude: number;
    place: string | null;
    timeUtc: string | null;
    depthKm: number | null;
    lat: number;
    lon: number;
  } | null;
}

export interface SlimEonetEvent {
  id: string;
  title: string;
  category: string;
  dateUtc: string | null;
  lat: number;
  lon: number;
}

export interface EpaTriSummary {
  zip: string;
  totalCount: number;
  activeCount: number;
  sampleFacilities: Array<{
    triId: string;
    name: string;
    city: string | null;
    state: string | null;
    active: boolean;
  }>;
}

export async function fetchCensusGeocode(
  address: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<
  | { status: "not_found"; cacheHit: boolean }
  | { status: "ok"; data: CensusGeocodeMatch; cacheHit: boolean }
> {
  const normKey = address.trim().toLowerCase().replace(/\s+/g, " ");
  const { value, cacheHit } = await withTwoTierCache<
    { status: "not_found" } | { status: "ok"; data: CensusGeocodeMatch }
  >({
    key: `world:census:geo:${normKey}`,
    ttlMs: TTL_MS.GEO_CENSUS_GEOCODE,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    fetcher: async () => {
      const url =
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
        `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
      const res = await fetchJsonWithTimeout<{
        result?: { addressMatches?: Array<Record<string, unknown>> };
      }>(url, {
        provider: "US_CENSUS",
        timeoutMs: 5500,
        fetchImpl,
      });

      if (res.status !== "ok" || !res.data?.result || !Array.isArray(res.data.result.addressMatches)) {
        throw new UpstreamError("US_CENSUS", "CENSUS_BAD_SCHEMA", "Invalid US Census geocoder payload");
      }

      const first = res.data.result.addressMatches[0];
      if (!first) {
        return { status: "not_found" };
      }

      const coords =
        first.coordinates && typeof first.coordinates === "object"
          ? (first.coordinates as { x?: unknown; y?: unknown })
          : null;
      const lon = toFiniteNumber(coords?.x);
      const lat = toFiniteNumber(coords?.y);
      if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw new UpstreamError("US_CENSUS", "CENSUS_BAD_COORDS", "Missing coordinates in US Census match");
      }

      const comps =
        first.addressComponents && typeof first.addressComponents === "object"
          ? (first.addressComponents as { zip?: unknown; state?: unknown })
          : null;
      const rawZip = typeof comps?.zip === "string" ? comps.zip.trim() : "";
      const zip = /^\d{5}$/.test(rawZip) ? rawZip : null;
      const state = typeof comps?.state === "string" && comps.state.trim() ? comps.state.trim() : null;

      return {
        status: "ok",
        data: {
          lat: Math.round(lat * 100_000) / 100_000,
          lon: Math.round(lon * 100_000) / 100_000,
          matchedAddress:
            typeof first.matchedAddress === "string" ? first.matchedAddress : address.trim(),
          zip,
          state,
        },
      };
    },
  });

  if (value.status === "not_found") {
    return { status: "not_found", cacheHit };
  }
  return { status: "ok", data: value.data, cacheHit };
}

export async function fetchUsgsQuakes(
  lat: number,
  lon: number,
  radiusKm: number,
  nowMs: number,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: UsgsQuakeSummary; cacheHit: boolean }> {
  const latKey = lat.toFixed(2);
  const lonKey = lon.toFixed(2);
  const startDate = new Date(nowMs - 30 * 86_400_000).toISOString().slice(0, 10);

  const { value, cacheHit } = await withTwoTierCache<UsgsQuakeSummary>({
    key: `world:usgs:${latKey}:${lonKey}:${radiusKm}:${startDate}`,
    ttlMs: TTL_MS.GEO_USGS_QUAKE,
    cache,
    waitUntil,
    fetcher: async () => {
      const url =
        `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
        `&latitude=${latKey}&longitude=${lonKey}&maxradiuskm=${radiusKm}` +
        `&starttime=${startDate}&minmagnitude=2.5&orderby=magnitude&limit=250`;

      const res = await fetchJsonWithTimeout<{
        features?: Array<{
          properties?: { mag?: unknown; place?: unknown; time?: unknown };
          geometry?: { coordinates?: unknown[] };
        }>;
      }>(url, {
        provider: "USGS",
        timeoutMs: 5500,
        fetchImpl,
      });

      if (res.status !== "ok" || !res.data || !Array.isArray(res.data.features)) {
        throw new UpstreamError("USGS", "USGS_BAD_SCHEMA", "Invalid USGS GeoJSON payload");
      }

      let countM25Plus = 0;
      let countM45Plus = 0;
      let maxMagnitude: number | null = null;
      let strongest: UsgsQuakeSummary["strongest"] = null;

      for (const feat of res.data.features) {
        const mag = toFiniteNumber(feat?.properties?.mag);
        if (mag === null) continue;
        if (mag >= 2.5) countM25Plus += 1;
        if (mag >= 4.5) countM45Plus += 1;

        const coords = Array.isArray(feat?.geometry?.coordinates) ? feat.geometry.coordinates : [];
        const qLon = toFiniteNumber(coords[0]);
        const qLat = toFiniteNumber(coords[1]);
        const depthKm = toFiniteNumber(coords[2]);
        const timeMs = toFiniteNumber(feat?.properties?.time);

        if (maxMagnitude === null || mag > maxMagnitude) {
          maxMagnitude = Math.round(mag * 100) / 100;
          if (qLat !== null && qLon !== null) {
            strongest = {
              magnitude: Math.round(mag * 100) / 100,
              place: typeof feat?.properties?.place === "string" ? feat.properties.place : null,
              timeUtc: timeMs !== null ? new Date(timeMs).toISOString() : null,
              depthKm: depthKm !== null ? Math.round(depthKm * 10) / 10 : null,
              lat: qLat,
              lon: qLon,
            };
          }
        }
      }

      return {
        countM25Plus,
        countM45Plus,
        maxMagnitude,
        strongest,
      };
    },
  });

  return { data: value, cacheHit };
}

function extractEonetCoords(geom: Record<string, unknown>): { lat: number; lon: number } | null {
  const gType = typeof geom.type === "string" ? geom.type : "";
  const coords = geom.coordinates;
  if (gType === "Point" && Array.isArray(coords)) {
    const lon = toFiniteNumber(coords[0]);
    const lat = toFiniteNumber(coords[1]);
    if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon };
    }
  } else if (gType === "Polygon" && Array.isArray(coords) && Array.isArray(coords[0])) {
    const ring = coords[0] as unknown[];
    let latSum = 0;
    let lonSum = 0;
    let count = 0;
    for (const pt of ring) {
      if (Array.isArray(pt)) {
        const lo = toFiniteNumber(pt[0]);
        const la = toFiniteNumber(pt[1]);
        if (la !== null && lo !== null && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) {
          latSum += la;
          lonSum += lo;
          count += 1;
        }
      }
    }
    if (count > 0) {
      return { lat: latSum / count, lon: lonSum / count };
    }
  }
  return null;
}

export async function fetchNasaEonetOpenEvents(
  cache: BoundedTtlCache = referenceCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ events: SlimEonetEvent[]; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<SlimEonetEvent[]>({
    key: "world:eonet:open:v1",
    ttlMs: TTL_MS.GEO_NASA_EONET,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<{ events?: Array<Record<string, unknown>> }>(
        "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100",
        {
          provider: "NASA_EONET",
          timeoutMs: 5500,
          fetchImpl,
        }
      );
      if (res.status !== "ok" || !res.data || !Array.isArray(res.data.events)) {
        throw new UpstreamError("NASA_EONET", "EONET_BAD_SCHEMA", "Invalid NASA EONET payload");
      }

      const slimmed: SlimEonetEvent[] = [];
      for (const ev of res.data.events) {
        if (!ev || typeof ev !== "object") continue;
        const geomArr = Array.isArray(ev.geometry)
          ? (ev.geometry as Array<Record<string, unknown>>)
          : [];
        if (geomArr.length === 0) continue;
        const latestGeom = geomArr[geomArr.length - 1]!;
        const pt = extractEonetCoords(latestGeom);
        if (!pt) continue;

        const cats = Array.isArray(ev.categories)
          ? (ev.categories as Array<{ id?: unknown; title?: unknown }>)
          : [];
        const category =
          typeof cats[0]?.id === "string"
            ? cats[0].id
            : typeof cats[0]?.title === "string"
              ? cats[0].title
              : "natural_event";

        slimmed.push({
          id: typeof ev.id === "string" ? ev.id : "EONET",
          title: typeof ev.title === "string" ? ev.title.slice(0, 160) : "Natural Event",
          category,
          dateUtc: typeof latestGeom.date === "string" ? latestGeom.date : null,
          lat: Math.round(pt.lat * 10_000) / 10_000,
          lon: Math.round(pt.lon * 10_000) / 10_000,
        });
      }
      return slimmed;
    },
  });

  return { events: value, cacheHit };
}

export async function fetchEpaTriByZip(
  zip: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: EpaTriSummary; cacheHit: boolean }> {
  const { value, cacheHit } = await withTwoTierCache<EpaTriSummary>({
    key: `world:epatri:zip:${zip}`,
    ttlMs: TTL_MS.GEO_EPA_TRI,
    cache,
    waitUntil,
    fetcher: async () => {
      const res = await fetchJsonWithTimeout<unknown[]>(
        `https://data.epa.gov/efservice/tri_facility/zip_code/${encodeURIComponent(zip)}/rows/0:99/JSON`,
        {
          provider: "EPA_TRI",
          timeoutMs: 6500,
          empty204Value: [],
          fetchImpl,
        }
      );
      if (res.status !== "ok" || !Array.isArray(res.data)) {
        throw new UpstreamError("EPA_TRI", "EPA_TRI_BAD_SCHEMA", "Invalid US EPA TRI payload");
      }

      let activeCount = 0;
      const sampleFacilities: EpaTriSummary["sampleFacilities"] = [];
      for (const raw of res.data) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        const closedVal = String(row.fac_closed_ind ?? row.FAC_CLOSED_IND ?? "0").trim();
        const active = closedVal !== "1" && closedVal.toUpperCase() !== "Y";
        if (active) activeCount += 1;

        const nameRaw = row.facility_name ?? row.FACILITY_NAME;
        const idRaw = row.tri_facility_id ?? row.TRI_FACILITY_ID;
        const cityRaw = row.city_name ?? row.CITY_NAME;
        const stateRaw = row.state_abbr ?? row.STATE_ABBR;

        if (sampleFacilities.length < 5 && typeof nameRaw === "string" && nameRaw.trim()) {
          sampleFacilities.push({
            triId: typeof idRaw === "string" ? idRaw : "TRI",
            name: nameRaw.trim().slice(0, 120),
            city: typeof cityRaw === "string" ? cityRaw.trim() : null,
            state: typeof stateRaw === "string" ? stateRaw.trim() : null,
            active,
          });
        }
      }

      return {
        zip,
        totalCount: res.data.length,
        activeCount,
        sampleFacilities,
      };
    },
  });

  return { data: value, cacheHit };
}
