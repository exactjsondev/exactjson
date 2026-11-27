import type { ValidationResult } from "../../lib/validation";
import { AIRPORTS_BY_IATA, AIRPORTS_BY_ICAO, type StaticAirport } from "./data/airports";
import { lookupStaticCountry, type StaticCountry } from "./data/countries";

const AIRPORT_CODE_RE = /^[A-Za-z]{3,4}$/;
const US_ICAO_PREFIX_RE = /^(?:K[A-Z]{3}|PA[A-Z]{2}|PH[A-Z]{2}|PG[A-Z]{2}|TJ[A-Z]{2}|TI[A-Z]{2})$/;
const ZIP5_RE = /^\d{5}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ParsedAirportInput =
  | {
      found: true;
      icao: string;
      iata: string | null;
      faaCode: string | null;
      name: string | null;
      country: string | null;
      lat: number | null;
      lon: number | null;
      isUsFaa: boolean;
    }
  | {
      found: false;
      rawCode: string;
    };

export function parseAirportInput(raw: string | undefined): ValidationResult<ParsedAirportInput> {
  if (!raw?.trim()) {
    return {
      ok: false,
      error: "Query parameter 'airport' is required (3-letter IATA like JFK/LHR or 4-letter ICAO like KJFK/EGLL).",
    };
  }
  const trimmed = raw.trim();
  if (!AIRPORT_CODE_RE.test(trimmed)) {
    return {
      ok: false,
      error: "Invalid 'airport' code (expected 3-letter IATA or 4-letter ICAO letters, e.g., JFK, LHR, KJFK).",
    };
  }

  const upper = trimmed.toUpperCase();
  if (upper.length === 3) {
    const hit: StaticAirport | undefined = AIRPORTS_BY_IATA.get(upper);
    if (!hit) {
      return { ok: true, value: { found: false, rawCode: upper } };
    }
    return {
      ok: true,
      value: {
        found: true,
        icao: hit.icao,
        iata: hit.iata,
        faaCode: hit.country === "US" ? hit.iata : null,
        name: hit.name,
        country: hit.country,
        lat: hit.lat,
        lon: hit.lon,
        isUsFaa: hit.country === "US",
      },
    };
  }

  const staticIcao = AIRPORTS_BY_ICAO.get(upper);
  if (staticIcao) {
    return {
      ok: true,
      value: {
        found: true,
        icao: staticIcao.icao,
        iata: staticIcao.iata,
        faaCode: staticIcao.country === "US" ? staticIcao.iata : null,
        name: staticIcao.name,
        country: staticIcao.country,
        lat: staticIcao.lat,
        lon: staticIcao.lon,
        isUsFaa: staticIcao.country === "US",
      },
    };
  }

  const isUsFaa = US_ICAO_PREFIX_RE.test(upper);
  const derivedFaa = upper.startsWith("K") ? upper.slice(1) : null;
  return {
    ok: true,
    value: {
      found: true,
      icao: upper,
      iata: null,
      faaCode: derivedFaa,
      name: null,
      country: isUsFaa ? "US" : null,
      lat: null,
      lon: null,
      isUsFaa,
    },
  };
}

function parseStrictFloat(
  raw: string,
  min: number,
  max: number,
  name: string
): ValidationResult<number> {
  const trimmed = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: `Invalid '${name}' parameter (expected finite decimal between ${min} and ${max}).` };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < min || num > max) {
    return { ok: false, error: `Parameter '${name}' must be between ${min} and ${max}.` };
  }
  return { ok: true, value: num };
}

export function parseSpaceWeatherInput(
  rawLat: string | undefined
): ValidationResult<{ lat: number | null }> {
  if (rawLat === undefined || rawLat.trim().length === 0) {
    return { ok: true, value: { lat: null } };
  }
  const parsed = parseStrictFloat(rawLat, -90, 90, "lat");
  if (!parsed.ok) return parsed;
  return { ok: true, value: { lat: parsed.value } };
}

export type ParsedGeoHazardInput =
  | {
      mode: "coords";
      lat: number;
      lon: number;
      label: string;
      radiusKm: number;
      zip: string | null;
    }
  | {
      mode: "iata";
      iata: string;
      icao: string;
      name: string;
      country: string;
      lat: number;
      lon: number;
      radiusKm: number;
      zip: string | null;
    }
  | {
      mode: "unknown_iata";
      iata: string;
      radiusKm: number;
    }
  | {
      mode: "address";
      address: string;
      radiusKm: number;
    };

export function parseGeoHazardInput(params: {
  lat?: string;
  lon?: string;
  iata?: string;
  address?: string;
  radius_km?: string;
  zip?: string;
}): ValidationResult<ParsedGeoHazardInput> {
  let radiusKm = 100;
  if (params.radius_km !== undefined && params.radius_km.trim().length > 0) {
    const rTrim = params.radius_km.trim();
    if (!/^\d{1,3}$/.test(rTrim)) {
      return { ok: false, error: "Query parameter 'radius_km' must be an integer between 25 and 500." };
    }
    const rInt = Number.parseInt(rTrim, 10);
    if (rInt < 25 || rInt > 500) {
      return { ok: false, error: "Query parameter 'radius_km' must be between 25 and 500." };
    }
    radiusKm = rInt;
  }

  let zip: string | null = null;
  if (params.zip !== undefined && params.zip.trim().length > 0) {
    const zTrim = params.zip.trim();
    if (!ZIP5_RE.test(zTrim)) {
      return { ok: false, error: "Query parameter 'zip' must be a 5-digit US ZIP code (e.g., 77507)." };
    }
    zip = zTrim;
  }

  const hasLat = Boolean(params.lat?.trim());
  const hasLon = Boolean(params.lon?.trim());
  const hasIata = Boolean(params.iata?.trim());
  const hasAddress = Boolean(params.address?.trim());

  const modeCount = Number(hasLat || hasLon) + Number(hasIata) + Number(hasAddress);
  if (modeCount === 0) {
    return {
      ok: false,
      error: "Provide one location target: ('lat' and 'lon'), 'iata' (e.g., SFO), or US 'address'.",
    };
  }
  if (modeCount > 1) {
    return {
      ok: false,
      error: "Specify only one location input mode at a time: ('lat'+'lon'), 'iata', or 'address'.",
    };
  }

  if (hasLat || hasLon) {
    if (!hasLat || !hasLon) {
      return { ok: false, error: "Both 'lat' and 'lon' are required when querying by coordinates." };
    }
    const latRes = parseStrictFloat(params.lat!, -90, 90, "lat");
    if (!latRes.ok) return latRes;
    const lonRes = parseStrictFloat(params.lon!, -180, 180, "lon");
    if (!lonRes.ok) return lonRes;

    return {
      ok: true,
      value: {
        mode: "coords",
        lat: latRes.value,
        lon: lonRes.value,
        label: `${latRes.value},${lonRes.value}`,
        radiusKm,
        zip,
      },
    };
  }

  if (hasIata) {
    const code = params.iata!.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return { ok: false, error: "Invalid 'iata' parameter (expected 3-letter IATA airport code, e.g., SFO)." };
    }
    const airport = AIRPORTS_BY_IATA.get(code);
    if (!airport) {
      return { ok: true, value: { mode: "unknown_iata", iata: code, radiusKm } };
    }
    if (zip !== null && airport.country !== "US") {
      return {
        ok: false,
        error: `US 'zip' parameter cannot be combined with non-US airport '${airport.iata}' (${airport.country}).`,
      };
    }
    return {
      ok: true,
      value: {
        mode: "iata",
        iata: airport.iata,
        icao: airport.icao,
        name: airport.name,
        country: airport.country,
        lat: airport.lat,
        lon: airport.lon,
        radiusKm,
        zip,
      },
    };
  }

  const address = params.address!.trim();
  if (address.length < 5 || address.length > 200 || /[\r\n<>]/.test(address)) {
    return {
      ok: false,
      error: "Invalid 'address' parameter (expected 5-200 character US street address).",
    };
  }
  return {
    ok: true,
    value: {
      mode: "address",
      address,
      radiusKm,
    },
  };
}

export function parseDestinationCountry(
  raw: string | undefined
): ValidationResult<StaticCountry> {
  if (!raw?.trim()) {
    return {
      ok: false,
      error: "Query parameter 'country' is required (ISO-3166 alpha-2/alpha-3 or country name, e.g., JP, USA, Japan).",
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length > 64) {
    return { ok: false, error: "Query parameter 'country' is too long." };
  }
  const hit = lookupStaticCountry(trimmed);
  if (!hit) {
    return {
      ok: false,
      error: `Unrecognized country '${trimmed}'. Provide a valid ISO-3166 alpha-2 code (e.g., JP, US, NL, AE, UA).`,
    };
  }
  return { ok: true, value: hit };
}

export type ParsedSolarSiteInput =
  | {
      mode: "coords" | "iata";
      lat: number;
      lon: number;
      iata: string | null;
      date: string;
      maxWindMs: number;
    }
  | {
      mode: "unknown_iata";
      iata: string;
    };

function isValidIsoCalendarDate(raw: string): boolean {
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return false;
  const year = Number.parseInt(m[1]!, 10);
  const month = Number.parseInt(m[2]!, 10);
  const day = Number.parseInt(m[3]!, 10);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function parseSolarSiteInput(
  params: {
    lat?: string;
    lon?: string;
    iata?: string;
    date?: string;
    max_wind_ms?: string;
  },
  nowMs: number = Date.now()
): ValidationResult<ParsedSolarSiteInput> {
  let targetDate = new Date(nowMs).toISOString().slice(0, 10);
  if (params.date !== undefined && params.date.trim().length > 0) {
    const dTrim = params.date.trim();
    if (!isValidIsoCalendarDate(dTrim)) {
      return {
        ok: false,
        error: "Invalid 'date' parameter (expected valid calendar date in YYYY-MM-DD format).",
      };
    }
    targetDate = dTrim;
  }

  let maxWindMs = 7;
  if (params.max_wind_ms !== undefined && params.max_wind_ms.trim().length > 0) {
    const windRes = parseStrictFloat(params.max_wind_ms, 1, 25, "max_wind_ms");
    if (!windRes.ok) return windRes;
    maxWindMs = windRes.value;
  }

  const hasLat = Boolean(params.lat?.trim());
  const hasLon = Boolean(params.lon?.trim());
  const hasIata = Boolean(params.iata?.trim());

  if ((hasLat || hasLon) && hasIata) {
    return { ok: false, error: "Specify either ('lat' and 'lon') or 'iata', not both." };
  }
  if (!hasLat && !hasLon && !hasIata) {
    return { ok: false, error: "Provide site coordinates ('lat' and 'lon') or a 3-letter 'iata' airport code." };
  }

  if (hasIata) {
    const code = params.iata!.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return { ok: false, error: "Invalid 'iata' parameter (expected 3-letter IATA airport code, e.g., AMS)." };
    }
    const airport = AIRPORTS_BY_IATA.get(code);
    if (!airport) {
      return { ok: true, value: { mode: "unknown_iata", iata: code } };
    }
    return {
      ok: true,
      value: {
        mode: "iata",
        lat: airport.lat,
        lon: airport.lon,
        iata: airport.iata,
        date: targetDate,
        maxWindMs,
      },
    };
  }

  if (!hasLat || !hasLon) {
    return { ok: false, error: "Both 'lat' and 'lon' are required when querying by coordinates." };
  }
  const latRes = parseStrictFloat(params.lat!, -90, 90, "lat");
  if (!latRes.ok) return latRes;
  const lonRes = parseStrictFloat(params.lon!, -180, 180, "lon");
  if (!lonRes.ok) return lonRes;

  return {
    ok: true,
    value: {
      mode: "coords",
      lat: latRes.value,
      lon: lonRes.value,
      iata: null,
      date: targetDate,
      maxWindMs,
    },
  };
}
