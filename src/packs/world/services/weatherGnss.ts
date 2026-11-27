import { WORLD_DISCLAIMER } from "../../../config/catalog/world";
import type { SwpcSpaceWeatherBundle, ThermosphereDragData } from "../providers/spaceWeather";

export type GoNoGoStatus = "GO" | "CAUTION" | "NO_GO";
export type LeoDragRegime = "LOW" | "MODERATE" | "ELEVATED" | "EXTREME";
export type MagneticZone = "AURORAL_HIGH_LAT" | "MID_LATITUDE" | "EQUATORIAL_SCINTILLATION" | "GLOBAL_DEFAULT";

export function computeWeatherGnss(
  lat: number | null,
  swpc: SwpcSpaceWeatherBundle,
  drag: ThermosphereDragData,
  nowMs: number
) {
  const absLat = lat !== null ? Math.abs(lat) : null;
  const magneticZone: MagneticZone =
    absLat === null
      ? "GLOBAL_DEFAULT"
      : absLat >= 55
        ? "AURORAL_HIGH_LAT"
        : absLat <= 20
          ? "EQUATORIAL_SCINTILLATION"
          : "MID_LATITUDE";

  const flags: string[] = [];
  let risk = 0;

  // High-latitude auroral zones suffer ionospheric RTK phase lock loss at lower Kp thresholds
  const kpCaution = magneticZone === "AURORAL_HIGH_LAT" ? 4.0 : 5.0;
  const kpNoGo = magneticZone === "AURORAL_HIGH_LAT" ? 5.5 : 7.0;

  let rtkGnssStatus: GoNoGoStatus = "GO";
  if (swpc.kpCurrent >= kpNoGo || swpc.gCurrent >= 3 || swpc.sCurrent >= 3) {
    rtkGnssStatus = "NO_GO";
    risk += 60;
    flags.push("SEVERE_GNSS_IONOSPHERIC_STORM");
  } else if (
    swpc.kpCurrent >= kpCaution ||
    swpc.gCurrent >= 1 ||
    swpc.sCurrent >= 2 ||
    (magneticZone === "EQUATORIAL_SCINTILLATION" && (swpc.kpCurrent >= 4.5 || swpc.rCurrent >= 2))
  ) {
    rtkGnssStatus = "CAUTION";
    risk += 30;
    flags.push("ELEVATED_RTK_GPS_DRIFT_RISK");
  }

  let compassStatus: GoNoGoStatus = "GO";
  const bz = swpc.imfBzGsmNt ?? 0;
  if (swpc.kpCurrent >= 6.5 || swpc.gCurrent >= 3 || (bz <= -15 && swpc.kpCurrent >= 5)) {
    compassStatus = "NO_GO";
    risk += 30;
    flags.push("GEOMAGNETIC_COMPASS_INTERFERENCE");
  } else if (swpc.kpCurrent >= 5.0 || swpc.gCurrent >= 1 || bz <= -10) {
    compassStatus = "CAUTION";
    risk += 15;
    flags.push("SOUTHWARD_IMF_OR_MINOR_STORM");
  }

  let hfCommsStatus: GoNoGoStatus = "GO";
  if (swpc.rCurrent >= 3) {
    hfCommsStatus = "NO_GO";
    risk += 25;
    flags.push("HF_RADIO_BLACKOUT_R3_PLUS");
  } else if (swpc.rCurrent >= 1 || (swpc.rMajorProb24h ?? 0) >= 25) {
    hfCommsStatus = "CAUTION";
    risk += 10;
    flags.push("RADIO_BLACKOUT_WATCH");
  }

  let satcomStatus: GoNoGoStatus = "GO";
  if (swpc.sCurrent >= 3 || swpc.gCurrent >= 4) {
    satcomStatus = "NO_GO";
    risk += 20;
    flags.push("SOLAR_RADIATION_STORM_S3_PLUS");
  } else if (swpc.sCurrent >= 1 || swpc.rCurrent >= 2 || swpc.gCurrent >= 2) {
    satcomStatus = "CAUTION";
    risk += 10;
  }

  let leoDragRegime: LeoDragRegime = "LOW";
  const f107 = drag.f107ObsSfu;
  const ap = drag.apDailyAvg ?? 0;
  if (f107 >= 200 || swpc.gCurrent >= 3 || ap >= 80) {
    leoDragRegime = "EXTREME";
  } else if (f107 >= 145 || swpc.gCurrent >= 2 || ap >= 30) {
    leoDragRegime = "ELEVATED";
  } else if (f107 >= 95 || swpc.gCurrent >= 1 || ap >= 15) {
    leoDragRegime = "MODERATE";
  }

  if (drag.source === "noaa_swpc_10cm_fallback") {
    flags.push("CELESTRAK_FALLBACK_NOAA_F107");
  }

  const riskScore = Math.max(5, Math.min(100, Math.round(risk || 8)));
  const sources =
    drag.source === "celestrak" ? ["noaa_swpc", "celestrak"] : ["noaa_swpc"];

  return {
    latitude_context: {
      latitude: lat,
      magnetic_zone: magneticZone,
    },
    gates: {
      rtk_gnss_status: rtkGnssStatus,
      magnetometer_compass_status: compassStatus,
      hf_comms_status: hfCommsStatus,
      satcom_status: satcomStatus,
      leo_drag_regime: leoDragRegime,
    },
    risk_score: riskScore,
    flags,
    noaa_scales: {
      current: {
        r_radio_blackout: swpc.rCurrent,
        s_solar_radiation: swpc.sCurrent,
        g_geomagnetic_storm: swpc.gCurrent,
      },
      next_24h_forecast: {
        g_geomagnetic_max: swpc.gNext24hMax,
        r_minor_prob_pct: swpc.rMinorProb24h,
        r_major_prob_pct: swpc.rMajorProb24h,
        s_prob_pct: swpc.sProb24h,
      },
    },
    geomagnetic_and_solar_wind: {
      kp_current: swpc.kpCurrent,
      kp_max_next_24h: swpc.kpMaxNext24h,
      solar_wind_speed_kms: swpc.solarWindSpeedKms,
      imf_bt_nt: swpc.imfBtNt,
      imf_bz_gsm_nt: swpc.imfBzGsmNt,
    },
    thermosphere_drag: {
      obs_date: drag.obsDate,
      f107_obs_sfu: drag.f107ObsSfu,
      f107_adj_sfu: drag.f107AdjSfu,
      f107_81d_center_sfu: drag.f107Center81Sfu,
      ap_daily_avg: drag.apDailyAvg,
    },
    recent_alerts: swpc.recentAlerts.map((a) => ({
      product_id: a.productId,
      issued_at: a.issuedAt,
      headline: a.headline,
    })),
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: WORLD_DISCLAIMER,
    },
  };
}
