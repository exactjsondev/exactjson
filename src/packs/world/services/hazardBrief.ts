import { WORLD_DISCLAIMER } from "../../../config/catalog/world";
import { haversineKm } from "../geoMath";
import type { SlimGdacsEvent } from "../providers/gdacs";
import type { EpaTriSummary, SlimEonetEvent, UsgsQuakeSummary } from "../providers/geoHazards";
import type { MetNorwayStep } from "../providers/metNorway";

export type HazardTier = "LOW" | "MODERATE" | "ELEVATED" | "CRITICAL";

export interface ResolvedHazardLocation {
  inputMode: "coords" | "iata" | "address";
  label: string;
  lat: number;
  lon: number;
  radiusKm: number;
  zip: string | null;
}

export function computeHazardBrief(
  loc: ResolvedHazardLocation,
  gdacsEvents: readonly SlimGdacsEvent[],
  usgs: UsgsQuakeSummary,
  eonetEvents: readonly SlimEonetEvent[],
  metSteps: readonly MetNorwayStep[],
  epaTri: EpaTriSummary | null,
  nowMs: number
) {
  let score = 0;
  const flags: string[] = [];

  const nearbyGdacs = gdacsEvents
    .filter((ev) => ev.lat !== null && ev.lon !== null)
    .map((ev) => ({
      ev,
      distKm: haversineKm(loc.lat, loc.lon, ev.lat!, ev.lon!),
    }))
    .filter((x) => x.distKm <= loc.radiusKm)
    .sort((a, b) => a.distKm - b.distKm);

  const hasRedGdacs = nearbyGdacs.some((x) => x.ev.alertLevel === "Red");
  const hasOrangeGdacs = nearbyGdacs.some((x) => x.ev.alertLevel === "Orange");
  if (hasRedGdacs) {
    score += 55;
    flags.push("GDACS_RED_DISASTER_ALERT");
  } else if (hasOrangeGdacs) {
    score += 35;
    flags.push("GDACS_ORANGE_DISASTER_ALERT");
  } else if (nearbyGdacs.length > 0) {
    score += 15;
    flags.push("GDACS_GREEN_EVENT_NEARBY");
  }

  if ((usgs.maxMagnitude ?? 0) >= 5.5) {
    score += 45;
    flags.push("MAJOR_EARTHQUAKE_30D_M5_5_PLUS");
  } else if (usgs.countM45Plus > 0 || (usgs.maxMagnitude ?? 0) >= 4.5) {
    score += 25;
    flags.push("MODERATE_EARTHQUAKE_30D_M4_5_PLUS");
  } else if (usgs.countM25Plus >= 5 || (usgs.maxMagnitude ?? 0) >= 3.0) {
    score += 15;
    flags.push("SEISMIC_ACTIVITY_30D");
  }

  const nearbyEonet = eonetEvents
    .map((ev) => ({
      ev,
      distKm: haversineKm(loc.lat, loc.lon, ev.lat, ev.lon),
    }))
    .filter((x) => x.distKm <= loc.radiusKm)
    .sort((a, b) => a.distKm - b.distKm);

  if (nearbyEonet.length > 0) {
    score += 25;
    flags.push("ACTIVE_NASA_EONET_HAZARD");
  }

  const currentStep =
    metSteps.find((s) => s.timeMs + s.stepHours * 3_600_000 > nowMs) ?? metSteps[0];

  const horizon24hMs = nowMs + 24 * 3_600_000;
  let maxWind24hMs = 0;
  let precip24hMm = 0;
  for (const st of metSteps) {
    if (st.timeMs + st.stepHours * 3_600_000 <= nowMs) continue;
    if (st.timeMs >= horizon24hMs) break;
    if (st.windSpeedMs > maxWind24hMs) maxWind24hMs = st.windSpeedMs;
    const effectiveStart = Math.max(st.timeMs, nowMs);
    const effectiveEnd = Math.min(st.timeMs + st.stepHours * 3_600_000, horizon24hMs);
    const fraction = Math.max(0, (effectiveEnd - effectiveStart) / (st.stepHours * 3_600_000));
    precip24hMm += st.precipMm * fraction;
  }
  maxWind24hMs = Math.round(maxWind24hMs * 10) / 10;
  precip24hMm = Math.round(precip24hMm * 10) / 10;

  if (maxWind24hMs >= 20 || precip24hMm >= 50) {
    score += 25;
    flags.push("SEVERE_WEATHER_24H");
  } else if (maxWind24hMs >= 14 || precip24hMm >= 25) {
    score += 12;
    flags.push("ADVERSE_WEATHER_24H");
  }

  if (epaTri) {
    if (epaTri.activeCount >= 5) {
      score += 15;
      flags.push("HIGH_DENSITY_EPA_TRI_ZIP");
    } else if (epaTri.activeCount >= 1) {
      score += 10;
      flags.push("ACTIVE_EPA_TRI_FACILITY_IN_ZIP");
    }
  }

  const hazardScore = Math.max(5, Math.min(100, Math.round(score || 5)));
  let hazardTier: HazardTier;
  if (hasRedGdacs || hazardScore >= 70) {
    hazardTier = "CRITICAL";
  } else if (hazardScore >= 45) {
    hazardTier = "ELEVATED";
  } else if (hazardScore >= 20) {
    hazardTier = "MODERATE";
  } else {
    hazardTier = "LOW";
  }

  const sources = ["gdacs", "usgs_seismic", "nasa_eonet", "met_norway"];
  if (loc.inputMode === "address") {
    sources.push("us_census_geocoder");
  }
  if (epaTri) {
    sources.push("us_epa_tri");
  }

  const strongestEvent = usgs.strongest
    ? {
        magnitude: usgs.strongest.magnitude,
        place: usgs.strongest.place,
        time_utc: usgs.strongest.timeUtc,
        depth_km: usgs.strongest.depthKm,
        distance_km:
          Math.round(haversineKm(loc.lat, loc.lon, usgs.strongest.lat, usgs.strongest.lon) * 10) / 10,
      }
    : null;

  return {
    location: {
      input_mode: loc.inputMode,
      label: loc.label,
      latitude: loc.lat,
      longitude: loc.lon,
      radius_km: loc.radiusKm,
      us_zip: loc.zip,
    },
    hazard_score: hazardScore,
    hazard_tier: hazardTier,
    flags,
    gdacs_alerts: nearbyGdacs.slice(0, 5).map(({ ev, distKm }) => ({
      event_id: ev.eventId,
      event_type: ev.eventType,
      alert_level: ev.alertLevel,
      title: ev.title,
      severity: ev.severityText,
      distance_km: Math.round(distKm * 10) / 10,
      published_at: ev.pubDate,
    })),
    seismic_30d: {
      count_m2_5_plus: usgs.countM25Plus,
      count_m4_5_plus: usgs.countM45Plus,
      max_magnitude: usgs.maxMagnitude,
      strongest_event: strongestEvent,
    },
    eonet_open_events: nearbyEonet.slice(0, 5).map(({ ev, distKm }) => ({
      id: ev.id,
      category: ev.category,
      title: ev.title,
      date_utc: ev.dateUtc,
      distance_km: Math.round(distKm * 10) / 10,
    })),
    weather_24h: {
      current_temp_c: currentStep?.tempC ?? null,
      current_wind_ms: currentStep?.windSpeedMs ?? null,
      max_wind_24h_ms: maxWind24hMs,
      precip_24h_mm: precip24hMm,
    },
    epa_tri: epaTri
      ? {
          applicable: true,
          zip: epaTri.zip,
          total_facility_count: epaTri.totalCount,
          active_facility_count: epaTri.activeCount,
          sample_facilities: epaTri.sampleFacilities.map((f) => ({
            tri_id: f.triId,
            name: f.name,
            city: f.city,
            state: f.state,
            active: f.active,
          })),
        }
      : {
          applicable: false,
          zip: null,
          total_facility_count: null,
          active_facility_count: null,
          sample_facilities: [],
        },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: WORLD_DISCLAIMER,
    },
  };
}
