import { WORLD_DISCLAIMER } from "../../../config/catalog/world";
import { haversineKm } from "../geoMath";
import {
  deriveFlightCategory,
  type FaaAirportDisruption,
  type SlimMetarObservation,
  type SlimSigmet,
} from "../providers/aviation";

export type DelayRiskTier = "NORMAL" | "MODERATE" | "HIGH" | "SEVERE";
export type FaaSourceStatus = "live" | "fallback_metar_only" | "not_applicable_non_us";

const SEVERE_WX_TOKEN_RE =
  /(?:^|\s)(?:[+-]?(?:TS(?:RA|SN|PL|GR|GS|DZ)?|FZRA|FZDZ|BLSN)|\+SN|SQ|FC|VA|DS|SS)(?=\s|$)/;

export interface ResolvedAirportMeta {
  iata: string | null;
  icao: string;
  name: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

export function computeAirportDelays(
  airport: ResolvedAirportMeta,
  metar: SlimMetarObservation | null,
  rawTaf: string | null,
  allSigmets: readonly SlimSigmet[],
  faaStatus: FaaSourceStatus,
  faaDisruptions: readonly FaaAirportDisruption[],
  nowMs: number
) {
  const flightCategory = metar
    ? deriveFlightCategory(metar.reportedFlightCategory, metar.ceilingFtAgl, metar.visibilitySm)
    : "UNKNOWN";

  let score = 0;
  const flags: string[] = [];

  const hasClosure = faaDisruptions.some((d) => d.category === "AIRPORT_CLOSURE");
  const hasGroundStop = faaDisruptions.some((d) => d.category === "GROUND_STOP");
  const hasGdp = faaDisruptions.some((d) => d.category === "GROUND_DELAY_PROGRAM");
  const hasArrDepDelay = faaDisruptions.some((d) => d.category === "ARRIVAL_DEPARTURE_DELAY");

  // Note: LAX and other hubs often publish partial GA NOTAMs under "Airport Closures" ("CLSD TO NON SKED TRANSIENT GA");
  // distinguish full commercial closure from GA-only PPR notices.
  const isGaOnlyClosure =
    hasClosure &&
    faaDisruptions
      .filter((d) => d.category === "AIRPORT_CLOSURE")
      .every((d) => /NON\s*SKED|TRANSIENT\s*GA|PPR/i.test(d.reason ?? ""));

  if (hasClosure && !isGaOnlyClosure) {
    score += 95;
    flags.push("AIRPORT_CLOSED");
  } else if (isGaOnlyClosure) {
    score += 10;
    flags.push("FAA_GA_OR_PARTIAL_RESTRICTION");
  }

  if (hasGroundStop) {
    score += 85;
    flags.push("FAA_GROUND_STOP");
  }
  if (hasGdp) {
    score += 45;
    flags.push("FAA_GROUND_DELAY_PROGRAM");
  }
  if (hasArrDepDelay) {
    score += 35;
    flags.push("FAA_ARRIVAL_DEPARTURE_DELAY");
  }
  if (faaStatus === "fallback_metar_only") {
    flags.push("FAA_NAS_FALLBACK_METAR_ONLY");
  }

  if (flightCategory === "LIFR") {
    score += 55;
    flags.push("FLIGHT_CAT_LIFR");
  } else if (flightCategory === "IFR") {
    score += 35;
    flags.push("FLIGHT_CAT_IFR");
  } else if (flightCategory === "MVFR") {
    score += 15;
    flags.push("FLIGHT_CAT_MVFR");
  } else if (flightCategory === "UNKNOWN") {
    score += 25;
    flags.push("FLIGHT_CAT_UNKNOWN");
  }

  const wspd = metar?.windSpeedKt ?? 0;
  const wgst = metar?.windGustKt ?? 0;
  if (wgst >= 35 || wspd >= 28) {
    score += 25;
    flags.push("HIGH_SURFACE_WINDS");
  } else if (wgst >= 25 || wspd >= 20) {
    score += 10;
    flags.push("GUSTY_WINDS");
  }

  const rawPreRmk = metar?.rawMetar ? (metar.rawMetar.split(/\sRMK\s/)[0] ?? "") : "";
  const wxProbe = metar?.wxString ?? rawPreRmk;
  if (SEVERE_WX_TOKEN_RE.test(wxProbe)) {
    score += 25;
    flags.push("CONVECTIVE_OR_WINTER_WX");
  }

  const lat = airport.lat ?? metar?.lat ?? null;
  const lon = airport.lon ?? metar?.lon ?? null;
  const nearbySigmets: Array<{
    fir_id: string;
    hazard: string;
    qualifier: string | null;
    base_ft: number | null;
    top_ft: number | null;
    distance_km: number;
  }> = [];

  if (lat !== null && lon !== null) {
    for (const sig of allSigmets) {
      const dist = haversineKm(lat, lon, sig.centroidLat, sig.centroidLon);
      if (dist <= 250) {
        nearbySigmets.push({
          fir_id: sig.firId,
          hazard: sig.hazard,
          qualifier: sig.qualifier,
          base_ft: sig.baseFt,
          top_ft: sig.topFt,
          distance_km: Math.round(dist * 10) / 10,
        });
      }
    }
    nearbySigmets.sort((a, b) => a.distance_km - b.distance_km);
  }

  if (nearbySigmets.length > 0) {
    score += 15;
    flags.push("NEARBY_ACTIVE_SIGMET");
  }

  const delayRiskScore = Math.max(0, Math.min(100, Math.round(score)));
  let delayRiskTier: DelayRiskTier;
  if ((hasClosure && !isGaOnlyClosure) || hasGroundStop || delayRiskScore >= 80) {
    delayRiskTier = "SEVERE";
  } else if (delayRiskScore >= 45) {
    delayRiskTier = "HIGH";
  } else if (delayRiskScore >= 20) {
    delayRiskTier = "MODERATE";
  } else {
    delayRiskTier = "NORMAL";
  }

  const dispatchGo =
    delayRiskTier !== "SEVERE" &&
    flightCategory !== "LIFR" &&
    flightCategory !== "UNKNOWN" &&
    !hasGroundStop &&
    !(hasClosure && !isGaOnlyClosure);

  const sources = ["noaa_awc_metar", "noaa_awc_taf", "noaa_awc_isigmet"];
  if (faaStatus === "live") {
    sources.push("faa_nas");
  }

  return {
    airport: {
      iata: airport.iata,
      icao: airport.icao,
      name: airport.name ?? metar?.stationName ?? airport.icao,
      country: airport.country,
      latitude: lat,
      longitude: lon,
    },
    flight_category: flightCategory,
    delay_risk_score: delayRiskScore,
    delay_risk_tier: delayRiskTier,
    dispatch_go: dispatchGo,
    flags,
    weather: {
      observed_at: metar?.observedAt ?? null,
      temp_c: metar?.tempC ?? null,
      dewpoint_c: metar?.dewpointC ?? null,
      wind_dir_deg: metar?.windDirDeg ?? null,
      wind_speed_kt: metar?.windSpeedKt ?? null,
      wind_gust_kt: metar?.windGustKt ?? null,
      visibility_sm: metar?.visibilitySm ?? null,
      ceiling_ft_agl: metar?.ceilingFtAgl ?? null,
      altimeter_hpa: metar?.altimeterHpa ?? null,
      wx_string: metar?.wxString ?? null,
      raw_metar: metar?.rawMetar ?? null,
      taf_available: rawTaf !== null,
      raw_taf: rawTaf,
    },
    faa_nas: {
      source_status: faaStatus,
      ground_stop: hasGroundStop,
      airport_closed: hasClosure && !isGaOnlyClosure,
      ground_delay_program: hasGdp,
      disruptions: faaDisruptions.map((d) => ({
        category: d.category,
        reason: d.reason,
        avg_delay: d.avgDelay,
        max_delay: d.maxDelay,
        end_or_reopen: d.endOrReopen,
      })),
    },
    nearby_sigmets: nearbySigmets.slice(0, 5),
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: WORLD_DISCLAIMER,
    },
  };
}
