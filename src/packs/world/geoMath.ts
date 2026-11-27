const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

export interface SolarTwilightResult {
  regime: "NORMAL" | "MIDNIGHT_SUN" | "POLAR_NIGHT";
  civil_dawn_utc: string | null;
  sunrise_utc: string | null;
  solar_noon_utc: string;
  sunset_utc: string | null;
  civil_dusk_utc: string | null;
  daylight_hours: number;
  civil_twilight_hours: number;
}

function minutesToUtcIso(dayStartMs: number, minutesFromMidnightUtc: number): string {
  const ms = dayStartMs + Math.round(minutesFromMidnightUtc * 60_000);
  return new Date(ms).toISOString();
}

/**
 * Pure-math NOAA General Solar Position calculation for UTC sunrise, sunset, solar noon,
 * and civil twilight (-0.833° atmospheric refraction sunrise/sunset; -6.0° civil twilight).
 * Handles high-latitude polar day (MIDNIGHT_SUN) and polar night (POLAR_NIGHT) deterministically.
 */
export function computeSolarTwilight(
  lat: number,
  lon: number,
  isoDate: string
): SolarTwilightResult {
  const [yStr, mStr, dStr] = isoDate.split("-");
  const year = Number.parseInt(yStr!, 10);
  const month = Number.parseInt(mStr!, 10);
  const day = Number.parseInt(dStr!, 10);

  const dayStartMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const yearStartMs = Date.UTC(year, 0, 1, 0, 0, 0);
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  const dayOfYear = Math.floor((dayStartMs - yearStartMs) / 86_400_000) + 1;

  // Fractional year in radians at 12:00 UTC
  const gamma = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1 + (12 - 12) / 24);

  // Equation of time (minutes)
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination (radians)
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const solarNoonMin = 720 - 4 * lon - eqTime;
  const solarNoonUtc = minutesToUtcIso(dayStartMs, solarNoonMin);

  const latRad = lat * DEG_TO_RAD;
  const cosLatCosDecl = Math.cos(latRad) * Math.cos(decl);
  const sinLatSinDecl = Math.sin(latRad) * Math.sin(decl);

  function computeCosHourAngle(zenithDeg: number): number {
    if (Math.abs(cosLatCosDecl) < 1e-9) {
      // Exact pole (+/-90°): sign depends only on sin(lat)*sin(decl) vs cos(zenith)
      const num = Math.cos(zenithDeg * DEG_TO_RAD) - sinLatSinDecl;
      return num < 0 ? -2 : 2;
    }
    return (Math.cos(zenithDeg * DEG_TO_RAD) - sinLatSinDecl) / cosLatCosDecl;
  }

  const cosHaSun = computeCosHourAngle(90.833);
  const cosHaCivil = computeCosHourAngle(96.0);

  let regime: SolarTwilightResult["regime"] = "NORMAL";
  let sunriseUtc: string | null = null;
  let sunsetUtc: string | null = null;
  let daylightHours = 0;

  if (cosHaSun < -1) {
    regime = "MIDNIGHT_SUN";
    daylightHours = 24;
  } else if (cosHaSun > 1) {
    regime = "POLAR_NIGHT";
    daylightHours = 0;
  } else {
    const haSunDeg = Math.acos(cosHaSun) * RAD_TO_DEG;
    sunriseUtc = minutesToUtcIso(dayStartMs, solarNoonMin - 4 * haSunDeg);
    sunsetUtc = minutesToUtcIso(dayStartMs, solarNoonMin + 4 * haSunDeg);
    daylightHours = Math.round(((2 * haSunDeg) / 15) * 100) / 100;
  }

  let civilDawnUtc: string | null = null;
  let civilDuskUtc: string | null = null;
  let civilTwilightHours = 0;

  if (cosHaCivil < -1) {
    civilTwilightHours = 24;
  } else if (cosHaCivil > 1) {
    civilTwilightHours = 0;
  } else {
    const haCivilDeg = Math.acos(cosHaCivil) * RAD_TO_DEG;
    civilDawnUtc = minutesToUtcIso(dayStartMs, solarNoonMin - 4 * haCivilDeg);
    civilDuskUtc = minutesToUtcIso(dayStartMs, solarNoonMin + 4 * haCivilDeg);
    civilTwilightHours = Math.round(((2 * haCivilDeg) / 15) * 100) / 100;
  }

  return {
    regime,
    civil_dawn_utc: civilDawnUtc,
    sunrise_utc: sunriseUtc,
    solar_noon_utc: solarNoonUtc,
    sunset_utc: sunsetUtc,
    civil_dusk_utc: civilDuskUtc,
    daylight_hours: daylightHours,
    civil_twilight_hours: Math.max(daylightHours, civilTwilightHours),
  };
}
