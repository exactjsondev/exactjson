import type { EndpointCatalogEntry, PackDefinition } from "./types";

export const WORLD_DISCLAIMER =
  "Informational weather/hazard data only; never use as sole life-safety or flight-navigation source." as const;

export const WORLD_PACK: PackDefinition = {
  id: "world",
  title: "Aviation, Space Weather, Physical Hazards, Travel & Solar",
  subtitle:
    "Global METAR/TAF + FAA airport delay decoding, NOAA GNSS/drone space weather, multi-agency site hazard briefs, travel advisories, and solar/wind dispatch windows.",
  shortDescription:
    "Airport delays, space weather GNSS drift, physical hazard briefs, travel safety, and solar/wind site windows.",
  mcpPath: "/mcp/world",
  disclaimer: WORLD_DISCLAIMER,
  workflows: [
    "Before autonomous drone/ag dispatch or travel rebooking, check space/weather-gnss, aviation/airport-delays, and solar/site-window.",
  ],
};

export const WORLD_CATALOG: readonly EndpointCatalogEntry[] = [];
