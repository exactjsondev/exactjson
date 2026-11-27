import { WORLD_DISCLAIMER } from "../../../config/catalog/world";
import type { StaticCountry } from "../data/countries";
import type { SlimGdacsEvent } from "../providers/gdacs";
import type { HolidayBrief, SlimFcdoAdvisory } from "../providers/travelFeeds";

export type AdvisoryLevel =
  | "STANDARD_PRECAUTIONS"
  | "REGIONAL_CAUTION"
  | "REGIONAL_DO_NOT_TRAVEL"
  | "AVOID_NON_ESSENTIAL"
  | "DO_NOT_TRAVEL";

export function computeDestinationBrief(
  country: StaticCountry,
  fcdo: SlimFcdoAdvisory,
  gdacsEvents: readonly SlimGdacsEvent[],
  holidays: HolidayBrief,
  nowMs: number
) {
  const alertSet = new Set(fcdo.alertStatus.map((s) => s.toLowerCase()));
  const flags: string[] = [];
  let risk = 10;
  let advisoryLevel: AdvisoryLevel = "STANDARD_PRECAUTIONS";

  if (alertSet.has("avoid_all_travel_to_whole_country")) {
    advisoryLevel = "DO_NOT_TRAVEL";
    risk = 95;
    flags.push("FCDO_AVOID_ALL_TRAVEL_WHOLE_COUNTRY");
  } else if (alertSet.has("avoid_all_but_essential_travel_to_whole_country")) {
    advisoryLevel = "AVOID_NON_ESSENTIAL";
    risk = 75;
    flags.push("FCDO_AVOID_NON_ESSENTIAL_WHOLE_COUNTRY");
  } else if (alertSet.has("avoid_all_travel_to_parts")) {
    advisoryLevel = "REGIONAL_DO_NOT_TRAVEL";
    risk = 55;
    flags.push("FCDO_AVOID_ALL_TRAVEL_TO_PARTS");
  } else if (alertSet.has("avoid_all_but_essential_travel_to_parts")) {
    advisoryLevel = "REGIONAL_CAUTION";
    risk = 35;
    flags.push("FCDO_AVOID_NON_ESSENTIAL_TO_PARTS");
  }

  const countryDisasters = gdacsEvents.filter((ev) => ev.iso3Codes.includes(country.alpha3));
  if (countryDisasters.some((d) => d.alertLevel === "Red")) {
    risk += 30;
    flags.push("ACTIVE_GDACS_RED_DISASTER");
  } else if (countryDisasters.some((d) => d.alertLevel === "Orange")) {
    risk += 18;
    flags.push("ACTIVE_GDACS_ORANGE_DISASTER");
  } else if (countryDisasters.length > 0) {
    risk += 8;
    flags.push("ACTIVE_GDACS_GREEN_EVENT");
  }

  const riskScore = Math.max(5, Math.min(100, Math.round(risk)));
  const sources = holidays.supported
    ? ["govuk_fcdo", "gdacs", "nager_date"]
    : ["govuk_fcdo", "gdacs"];

  return {
    country: {
      alpha2: country.alpha2,
      alpha3: country.alpha3,
      name: country.name,
      region: country.region,
      currency_code: country.currencyCode,
      calling_code: country.callingCode,
      driving_side: country.drivingSide,
    },
    advisory_level: advisoryLevel,
    risk_score: riskScore,
    flags,
    fcdo_advisory: {
      slug: fcdo.slug,
      url: `https://www.gov.uk/foreign-travel-advice/${fcdo.slug}`,
      alert_status: fcdo.alertStatus,
      updated_at: fcdo.updatedAt,
      latest_update_note: fcdo.latestUpdateNote,
      highlights: fcdo.highlights,
    },
    active_gdacs_disasters: countryDisasters.slice(0, 5).map((ev) => ({
      event_id: ev.eventId,
      event_type: ev.eventType,
      alert_level: ev.alertLevel,
      title: ev.title,
      severity: ev.severityText,
      published_at: ev.pubDate,
    })),
    public_holidays: {
      supported: holidays.supported,
      upcoming: holidays.upcoming.map((h) => ({
        date: h.date,
        name: h.name,
        local_name: h.localName,
        global: h.global,
      })),
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: WORLD_DISCLAIMER,
    },
  };
}
