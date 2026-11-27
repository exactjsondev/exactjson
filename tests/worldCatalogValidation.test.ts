import { describe, expect, it } from "vitest";
import {
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_PACK,
  SERVICE_VERSION,
  WORLD_PACK,
  getPackEndpoints,
} from "../src/config/catalog";
import { WORLD_CATALOG, WORLD_DISCLAIMER } from "../src/config/catalog/world";
import {
  parseAirportInput,
  parseDestinationCountry,
  parseGeoHazardInput,
  parseSolarSiteInput,
  parseSpaceWeatherInput,
} from "../src/packs/world/validation";

describe("world pack — catalog contract, static IATA/ISO tables, and input validation", () => {
  it("defines 5 world endpoints at v1.3.0 within Glama TDQS and Bazaar 500-char limits", () => {
    expect(SERVICE_VERSION).toBe("1.3.0");
    expect(WORLD_CATALOG.length).toBe(5);
    expect(1 + getPackEndpoints(["world"]).length).toBe(6);
    expect(1 + getPackEndpoints(["world"]).length).toBeLessThanOrEqual(MAX_MCP_TOOLS_PER_PACK);
    expect(WORLD_PACK.mcpPath).toBe("/mcp/world");

    expect(WORLD_CATALOG.map((e) => e.routeKey)).toEqual([
      "GET /v1/aviation/airport-delays",
      "GET /v1/space/weather-gnss",
      "GET /v1/geo/hazard-brief",
      "GET /v1/travel/destination-brief",
      "GET /v1/solar/site-window",
    ]);
    expect(WORLD_CATALOG.map((e) => e.priceAmount)).toEqual([
      "0.01",
      "0.01",
      "0.015",
      "0.01",
      "0.01",
    ]);

    for (const entry of WORLD_CATALOG) {
      const mcpDesc = `Paid (${entry.priceFormatted} USDC): ${entry.description}`;
      expect(mcpDesc.length).toBeLessThanOrEqual(MAX_BAZAAR_DESCRIPTION_LENGTH);
      expect(entry.description).toMatch(/\bDo NOT use for\b/);
      expect(entry.description).toContain(WORLD_DISCLAIMER);
    }
  });

  it("validates airport IATA/ICAO codes and resolves static coordinates", () => {
    const jfk = parseAirportInput("jfk");
    expect(jfk.ok).toBe(true);
    if (jfk.ok) {
      expect(jfk.value.found).toBe(true);
      if (jfk.value.found) {
        expect(jfk.value.icao).toBe("KJFK");
        expect(jfk.value.iata).toBe("JFK");
        expect(jfk.value.country).toBe("US");
        expect(jfk.value.isUsFaa).toBe(true);
      }
    }

    const lhr = parseAirportInput("LHR");
    expect(lhr.ok).toBe(true);
    if (lhr.ok && lhr.value.found) {
      expect(lhr.value.icao).toBe("EGLL");
      expect(lhr.value.country).toBe("GB");
      expect(lhr.value.isUsFaa).toBe(false);
    }

    const passthroughIcao = parseAirportInput("kteb");
    expect(passthroughIcao.ok).toBe(true);
    if (passthroughIcao.ok && passthroughIcao.value.found) {
      expect(passthroughIcao.value.icao).toBe("KTEB");
      expect(passthroughIcao.value.isUsFaa).toBe(true);
    }

    const unknownIata = parseAirportInput("ZZQ");
    expect(unknownIata).toEqual({ ok: true, value: { found: false, rawCode: "ZZQ" } });

    expect(parseAirportInput("")).toMatchObject({ ok: false });
    expect(parseAirportInput("JFK1")).toMatchObject({ ok: false });
    expect(parseAirportInput("TOOLONG")).toMatchObject({ ok: false });
  });

  it("validates space weather optional latitude", () => {
    expect(parseSpaceWeatherInput(undefined)).toEqual({ ok: true, value: { lat: null } });
    expect(parseSpaceWeatherInput("64.84")).toEqual({ ok: true, value: { lat: 64.84 } });
    expect(parseSpaceWeatherInput("-90")).toEqual({ ok: true, value: { lat: -90 } });
    expect(parseSpaceWeatherInput("91")).toMatchObject({ ok: false });
    expect(parseSpaceWeatherInput("NaN")).toMatchObject({ ok: false });
  });

  it("validates geo hazard location modes (lat+lon, iata, US address) and radius/zip", () => {
    const coords = parseGeoHazardInput({
      lat: "37.7749",
      lon: "-122.4194",
      radius_km: "150",
      zip: "94103",
    });
    expect(coords).toEqual({
      ok: true,
      value: {
        mode: "coords",
        lat: 37.7749,
        lon: -122.4194,
        label: "37.7749,-122.4194",
        radiusKm: 150,
        zip: "94103",
      },
    });

    const iata = parseGeoHazardInput({ iata: "HND" });
    expect(iata.ok).toBe(true);
    if (iata.ok && iata.value.mode === "iata") {
      expect(iata.value.iata).toBe("HND");
      expect(iata.value.radiusKm).toBe(100);
    }

    const unknownIata = parseGeoHazardInput({ iata: "ZZQ" });
    expect(unknownIata).toEqual({
      ok: true,
      value: { mode: "unknown_iata", iata: "ZZQ", radiusKm: 100 },
    });

    const addr = parseGeoHazardInput({ address: "1600 Pennsylvania Ave NW, Washington, DC 20500" });
    expect(addr.ok).toBe(true);
    if (addr.ok) {
      expect(addr.value.mode).toBe("address");
    }

    // Reject missing, mixed, or out-of-bounds inputs
    expect(parseGeoHazardInput({})).toMatchObject({ ok: false });
    expect(parseGeoHazardInput({ lat: "37.7", lon: "-122.4", address: "123 Main St" })).toMatchObject({
      ok: false,
    });
    expect(parseGeoHazardInput({ lat: "37.7" })).toMatchObject({ ok: false });
    expect(parseGeoHazardInput({ lat: "37.7", lon: "-122.4", radius_km: "10" })).toMatchObject({
      ok: false,
    });
    expect(parseGeoHazardInput({ lat: "37.7", lon: "-122.4", zip: "ABCDE" })).toMatchObject({
      ok: false,
    });
    expect(parseGeoHazardInput({ iata: "HND", zip: "77507" })).toMatchObject({
      ok: false,
    });
  });

  it("validates destination countries (alpha-2, alpha-3, common names, and domestic GB null FCDO slug)", () => {
    const jp = parseDestinationCountry("jp");
    expect(jp.ok).toBe(true);
    if (jp.ok) {
      expect(jp.value.alpha2).toBe("JP");
      expect(jp.value.alpha3).toBe("JPN");
      expect(jp.value.fcdoSlug).toBe("japan");
    }

    const usa = parseDestinationCountry("USA");
    expect(usa.ok).toBe(true);
    if (usa.ok) {
      expect(usa.value.alpha2).toBe("US");
      expect(usa.value.fcdoSlug).toBe("usa");
    }

    const gambia = parseDestinationCountry("GM");
    expect(gambia.ok).toBe(true);
    if (gambia.ok) {
      expect(gambia.value.fcdoSlug).toBe("the-gambia");
    }

    const gb = parseDestinationCountry("GB");
    expect(gb.ok).toBe(true);
    if (gb.ok) {
      expect(gb.value.alpha2).toBe("GB");
      expect(gb.value.fcdoSlug).toBeNull();
    }

    expect(parseDestinationCountry("")).toMatchObject({ ok: false });
    expect(parseDestinationCountry("XX")).toMatchObject({ ok: false });
    expect(parseDestinationCountry("__proto__")).toMatchObject({ ok: false });
  });

  it("validates solar site inputs including strict calendar dates and wind thresholds", () => {
    const ok = parseSolarSiteInput({
      lat: "52.3676",
      lon: "4.9041",
      date: "2026-06-21",
      max_wind_ms: "8.5",
    }, Date.UTC(2026, 10, 27));
    expect(ok).toEqual({
      ok: true,
      value: {
        mode: "coords",
        lat: 52.3676,
        lon: 4.9041,
        iata: null,
        date: "2026-06-21",
        maxWindMs: 8.5,
      },
    });

    // Reject impossible calendar date 2026-02-30
    expect(
      parseSolarSiteInput({ lat: "52.3", lon: "4.9", date: "2026-02-30" }, Date.UTC(2026, 10, 27))
    ).toMatchObject({ ok: false });
    expect(
      parseSolarSiteInput({ lat: "52.3", lon: "4.9", max_wind_ms: "0" }, Date.UTC(2026, 10, 27))
    ).toMatchObject({ ok: false });
  });
});
