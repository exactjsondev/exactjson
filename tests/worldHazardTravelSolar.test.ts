import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createDestinationBriefHandler } from "../src/packs/world/routes/destinationBrief";
import { createHazardBriefHandler } from "../src/packs/world/routes/hazardBrief";
import { createSiteWindowHandler } from "../src/packs/world/routes/siteWindow";
import type { computeDestinationBrief } from "../src/packs/world/services/destinationBrief";
import type { computeHazardBrief } from "../src/packs/world/services/hazardBrief";
import type { computeSiteWindow } from "../src/packs/world/services/siteWindow";
import type { AppBindings } from "../src/types";

type HazardBriefResponse = ReturnType<typeof computeHazardBrief>;
type DestinationBriefResponse = ReturnType<typeof computeDestinationBrief>;
type SiteWindowResponse = ReturnType<typeof computeSiteWindow>;

const SAMPLE_GDACS_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:gdacs="http://www.gdacs.org">
  <channel>
    <item>
      <title>Orange flood in Gulf Coast, United States</title>
      <pubDate>Fri, 27 Nov 2026 12:00:00 GMT</pubDate>
      <gdacs:iscurrent>true</gdacs:iscurrent>
      <gdacs:eventtype>FL</gdacs:eventtype>
      <gdacs:eventid>9001</gdacs:eventid>
      <gdacs:alertlevel>Orange</gdacs:alertlevel>
      <gdacs:severity unit="km2" value="1200">Area 1200 km2</gdacs:severity>
      <gdacs:iso3>USA</gdacs:iso3>
      <gdacs:country>United States</gdacs:country>
      <geo:Point><geo:lat>29.62</geo:lat><geo:long>-95.06</geo:long></geo:Point>
    </item>
    <item>
      <title>Red cyclone affecting Eastern Europe</title>
      <pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate>
      <gdacs:iscurrent>true</gdacs:iscurrent>
      <gdacs:eventtype>TC</gdacs:eventtype>
      <gdacs:eventid>9002</gdacs:eventid>
      <gdacs:alertlevel>Red</gdacs:alertlevel>
      <gdacs:severity unit="km/h" value="140">Wind 140 km/h</gdacs:severity>
      <gdacs:iso3>POL, UKR</gdacs:iso3>
      <gdacs:country>Poland, Ukraine</gdacs:country>
      <geo:Point><geo:lat>50.45</geo:lat><geo:long>30.52</geo:long></geo:Point>
    </item>
  </channel>
</rss>`;

// Includes an elapsed 16:00Z hour and a 6h step crossing the 7d boundary to verify strict window clamping
const SAMPLE_MET_NORWAY = {
  type: "Feature",
  properties: {
    timeseries: [
      {
        time: "2026-11-27T16:00:00Z",
        data: {
          instant: { details: { air_temperature: 99, wind_speed: 2.0, cloud_area_fraction: 0 } },
          next_1_hours: { details: { precipitation_amount: 50 } },
        },
      },
      {
        time: "2026-11-27T18:00:00Z",
        data: {
          instant: { details: { air_temperature: 14.5, wind_speed: 4.2, wind_speed_of_gust: 6.1, cloud_area_fraction: 20 } },
          next_1_hours: { details: { precipitation_amount: 0 } },
        },
      },
      {
        time: "2026-11-27T19:00:00Z",
        data: {
          instant: { details: { air_temperature: 14.0, wind_speed: 5.0, cloud_area_fraction: 25 } },
          next_1_hours: { details: { precipitation_amount: 0 } },
        },
      },
      {
        time: "2026-11-27T20:00:00Z",
        data: {
          instant: { details: { air_temperature: 12.0, wind_speed: 11.5, wind_speed_of_gust: 16.0, cloud_area_fraction: 90 } },
          next_1_hours: { details: { precipitation_amount: 4.5 } },
        },
      },
      {
        time: "2026-11-30T12:00:00Z",
        data: {
          instant: { details: { air_temperature: 13.0, wind_speed: 3.8, cloud_area_fraction: 10 } },
          next_6_hours: { details: { precipitation_amount: 0 } },
        },
      },
      {
        // Starts 2h before the 7-day horizon (2026-12-04T18:00:00Z at nowMs=18:00Z; at 17:45Z horizon is 17:45Z so 16:00Z..22:00Z must clamp!)
        time: "2026-12-04T16:00:00Z",
        data: {
          instant: { details: { air_temperature: 11.0, wind_speed: 3.5, cloud_area_fraction: 10 } },
          next_6_hours: { details: { precipitation_amount: 0 } },
        },
      },
    ],
  },
};

describe("world pack — geo/hazard-brief, travel/destination-brief, and solar/site-window", () => {
  it("builds geo/hazard-brief across coords, IATA, and US Census address + EPA TRI, orders USGS by magnitude, skips elapsed weather steps, and enforces 400/404/502", async () => {
    let failGdacs = false;
    let lastUsgsOrderBy: string | null = null;

    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));

      if (url.hostname === "www.gdacs.org") {
        if (failGdacs) return new Response("err", { status: 503 });
        return new Response(SAMPLE_GDACS_RSS, { status: 200 });
      }

      if (url.hostname === "earthquake.usgs.gov") {
        lastUsgsOrderBy = url.searchParams.get("orderby");
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                properties: {
                  mag: 4.7,
                  place: "18 km SE of Pasadena, TX",
                  time: Date.UTC(2026, 10, 25, 8, 0, 0),
                },
                geometry: { type: "Point", coordinates: [-95.02, 29.58, 8.4] },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.hostname === "eonet.gsfc.nasa.gov") {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "EONET_101",
                title: "Wildfire Galveston Bay Marsh",
                categories: [{ id: "wildfires", title: "Wildfires" }],
                geometry: [
                  {
                    date: "2026-11-27T06:00:00Z",
                    type: "Point",
                    coordinates: [-94.98, 29.59],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.hostname === "api.met.no") {
        return new Response(JSON.stringify(SAMPLE_MET_NORWAY), { status: 200 });
      }

      if (url.hostname === "geocoding.geo.census.gov") {
        const addr = url.searchParams.get("address") ?? "";
        if (addr.includes("Nowhere")) {
          return new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            result: {
              addressMatches: [
                {
                  matchedAddress: "9502 BAY PORT BLVD, PASADENA, TX, 77507",
                  coordinates: { x: -95.0633, y: 29.6255 },
                  addressComponents: { zip: "77507", state: "TX", city: "PASADENA" },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }

      if (url.hostname === "data.epa.gov") {
        return new Response(
          JSON.stringify([
            {
              tri_facility_id: "77507BCGSS952BA",
              facility_name: "LINDE GAS NORTH AMERICA LLC",
              city_name: "PASADENA",
              state_abbr: "TX",
              zip_code: "77507",
              fac_closed_ind: "1",
            },
            {
              tri_facility_id: "77507ACTV00001",
              facility_name: "BAYPORT PETROCHEMICAL COMPLEX",
              city_name: "PASADENA",
              state_abbr: "TX",
              zip_code: "77507",
              fac_closed_ind: "0",
            },
          ]),
          { status: 200 }
        );
      }

      return new Response("unexpected", { status: 500 });
    };

    const makeApp = () => {
      const a = new Hono<AppBindings>();
      const cache = new BoundedTtlCache(64);
      a.get(
        "/v1/geo/hazard-brief",
        createHazardBriefHandler({
          cache,
          referenceCache: cache,
          fetchImpl: mockFetch,
          nowMs: () => Date.UTC(2026, 10, 27, 18, 0, 0),
        })
      );
      return a;
    };

    const app = makeApp();
    const addrRes = await app.request(
      "http://localhost/v1/geo/hazard-brief?address=9502+Bay+Port+Blvd,+Pasadena,+TX+77507&radius_km=100"
    );
    expect(addrRes.status).toBe(200);
    expect(lastUsgsOrderBy).toBe("magnitude");
    const addrBody = (await addrRes.json()) as HazardBriefResponse;
    expect(addrBody.location.input_mode).toBe("address");
    expect(addrBody.location.us_zip).toBe("77507");
    // Elapsed 16:00Z cached hour (temp=99, precip=50mm) must NOT pollute active 18:00Z weather_24h
    expect(addrBody.weather_24h.current_temp_c).toBe(14.5);
    expect(addrBody.weather_24h.precip_24h_mm).toBe(4.5);
    expect(addrBody.gdacs_alerts.length).toBe(1);
    expect(addrBody.seismic_30d.count_m4_5_plus).toBe(1);
    expect(addrBody.eonet_open_events.length).toBe(1);
    expect(addrBody.epa_tri.applicable).toBe(true);
    expect(addrBody.epa_tri.total_facility_count).toBe(2);
    expect(addrBody.epa_tri.active_facility_count).toBe(1);
    expect(addrBody.hazard_tier).toBe("CRITICAL");

    const hndRes = await app.request("http://localhost/v1/geo/hazard-brief?iata=HND");
    expect(hndRes.status).toBe(200);
    const hndBody = (await hndRes.json()) as HazardBriefResponse;
    expect(hndBody.location.input_mode).toBe("iata");
    expect(hndBody.epa_tri.applicable).toBe(false);

    expect(
      (await app.request("http://localhost/v1/geo/hazard-brief?address=9999+Nowhere+Road+00000")).status
    ).toBe(404);
    expect((await app.request("http://localhost/v1/geo/hazard-brief?iata=ZZQ")).status).toBe(404);
    expect((await app.request("http://localhost/v1/geo/hazard-brief")).status).toBe(400);

    failGdacs = true;
    const failApp = makeApp();
    expect(
      (await failApp.request("http://localhost/v1/geo/hazard-brief?lat=37.77&lon=-122.41")).status
    ).toBe(502);
  });

  it("compresses travel/destination-brief (FCDO + redirect support + multi-ISO3 GDACS + Nager 204 tolerance) and returns 404 on domestic GB", async () => {
    let failFcdo = false;

    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));

      if (url.hostname === "www.gov.uk") {
        if (failFcdo) return new Response("err", { status: 503 });
        if (url.pathname.endsWith("/bahamas")) {
          // Simulate GOV.UK Content API redirect item -> /foreign-travel-advice/the-bahamas
          return new Response(
            JSON.stringify({
              schema_name: "redirect",
              redirects: [{ destination: "/foreign-travel-advice/the-bahamas" }],
            }),
            { status: 200 }
          );
        }
        if (url.pathname.endsWith("/the-bahamas")) {
          return new Response(
            JSON.stringify({
              public_updated_at: "2026-11-15T10:00:00Z",
              details: {
                alert_status: [],
                change_description: "Hurricane season preparedness note.",
                parts: [{ slug: "safety-and-security", body: "<p>Check local weather bulletins.</p>" }],
              },
            }),
            { status: 200 }
          );
        }
        if (url.pathname.endsWith("/ukraine")) {
          return new Response(
            JSON.stringify({
              public_updated_at: "2026-11-20T10:00:00Z",
              details: {
                alert_status: ["avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_parts"],
                change_description: "Updated regional air-raid and border crossing guidance.",
                parts: [
                  { slug: "warnings-and-insurance", body: "<p>FCDO advises against all travel to frontline oblasts.</p>" },
                  { slug: "entry-requirements", body: "<p>Passports must be valid for the duration of stay.</p>" },
                  { slug: "safety-and-security", body: "<p>Air raid sirens &amp; curfews remain active nationwide.</p>" },
                  { slug: "health", body: "<p>Ensure comprehensive medical evacuation insurance.</p>" },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (url.pathname.endsWith("/india")) {
          return new Response(
            JSON.stringify({
              public_updated_at: "2026-11-01T10:00:00Z",
              details: {
                alert_status: [],
                change_description: "Routine entry e-Visa update.",
                parts: [
                  { slug: "entry-requirements", body: "<p>Apply for an official e-Visa prior to travel.</p>" },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      }

      if (url.hostname === "www.gdacs.org") {
        return new Response(SAMPLE_GDACS_RSS, { status: 200 });
      }

      if (url.hostname === "date.nager.at") {
        if (url.pathname.endsWith("/UA") || url.pathname.endsWith("/BS")) {
          return new Response(
            JSON.stringify([
              { date: "2026-12-25", name: "Christmas Day", localName: "Christmas Day", global: true },
            ]),
            { status: 200 }
          );
        }
        if (url.pathname.endsWith("/IN")) {
          return new Response(null, { status: 204 });
        }
      }

      return new Response("unexpected", { status: 500 });
    };

    const makeApp = () => {
      const a = new Hono<AppBindings>();
      const cache = new BoundedTtlCache(64);
      a.get(
        "/v1/travel/destination-brief",
        createDestinationBriefHandler({
          cache,
          referenceCache: cache,
          fetchImpl: mockFetch,
          nowMs: () => Date.UTC(2026, 10, 27, 18, 0, 0),
        })
      );
      return a;
    };

    const app = makeApp();

    const uaRes = await app.request("http://localhost/v1/travel/destination-brief?country=UA");
    expect(uaRes.status).toBe(200);
    const uaBody = (await uaRes.json()) as DestinationBriefResponse;
    expect(uaBody.advisory_level).toBe("REGIONAL_DO_NOT_TRAVEL");
    expect(uaBody.fcdo_advisory.highlights.safety_and_security).toContain("Air raid sirens & curfews");
    expect(uaBody.fcdo_advisory.highlights.safety_and_security).not.toContain("<p>");
    expect(uaBody.active_gdacs_disasters.length).toBe(1);
    expect(uaBody.public_holidays.supported).toBe(true);
    expect(uaBody.public_holidays.upcoming.length).toBe(1);

    // GOV.UK redirect schema_name -> follows /foreign-travel-advice/the-bahamas cleanly
    const bsRes = await app.request("http://localhost/v1/travel/destination-brief?country=BS");
    expect(bsRes.status).toBe(200);
    const bsBody = (await bsRes.json()) as DestinationBriefResponse;
    expect(bsBody.fcdo_advisory.slug).toBe("the-bahamas");

    const inRes = await app.request("http://localhost/v1/travel/destination-brief?country=IN");
    expect(inRes.status).toBe(200);
    const inBody = (await inRes.json()) as DestinationBriefResponse;
    expect(inBody.advisory_level).toBe("STANDARD_PRECAUTIONS");
    expect(inBody.public_holidays).toEqual({ supported: false, upcoming: [] });

    expect((await app.request("http://localhost/v1/travel/destination-brief?country=GB")).status).toBe(404);
    expect((await app.request("http://localhost/v1/travel/destination-brief?country=Atlantis")).status).toBe(400);

    failFcdo = true;
    const failApp = makeApp();
    expect((await failApp.request("http://localhost/v1/travel/destination-brief?country=UA")).status).toBe(502);
  });

  it("computes solar/site-window PV climatology, rejects all--999 irradiance as 502, clamps 7d windows excluding elapsed hours, and handles polar twilight", async () => {
    let failPower = false;
    let allSentinel999 = false;

    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));

      if (url.hostname === "power.larc.nasa.gov") {
        if (failPower) return new Response("err", { status: 503 });
        if (allSentinel999) {
          return new Response(
            JSON.stringify({
              properties: {
                parameter: {
                  ALLSKY_SFC_SW_DWN: {
                    JAN: -999, FEB: -999, MAR: -999, APR: -999, MAY: -999, JUN: -999,
                    JUL: -999, AUG: -999, SEP: -999, OCT: -999, NOV: -999, DEC: -999, ANN: -999,
                  },
                },
              },
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            properties: {
              parameter: {
                ALLSKY_SFC_SW_DWN: {
                  JAN: 0.69,
                  FEB: 1.39,
                  MAR: 2.67,
                  APR: 4.3,
                  MAY: 5.2,
                  JUN: 5.44,
                  JUL: 5.25,
                  AUG: 4.36,
                  SEP: 3.14,
                  OCT: 1.78,
                  NOV: 0.82,
                  DEC: -999,
                  ANN: 2.97,
                },
                CLRSKY_SFC_SW_DWN: {
                  JUN: 7.4,
                  NOV: 1.7,
                  DEC: -999,
                  ANN: 4.5,
                },
              },
            },
          }),
          { status: 200 }
        );
      }

      if (url.hostname === "api.met.no") {
        return new Response(JSON.stringify(SAMPLE_MET_NORWAY), { status: 200 });
      }

      return new Response("unexpected", { status: 500 });
    };

    const makeApp = () => {
      const a = new Hono<AppBindings>();
      const cache = new BoundedTtlCache(64);
      a.get(
        "/v1/solar/site-window",
        createSiteWindowHandler({
          cache,
          fetchImpl: mockFetch,
          nowMs: () => Date.UTC(2026, 10, 27, 17, 45, 0),
        })
      );
      return a;
    };

    const app = makeApp();

    // nowMs = 2026-11-27T17:45:00Z -> 7d horizon = 2026-12-04T17:45:00Z
    // Safe steps: 18:00..19:00 (1h) + 19:00..20:00 (1h) + Nov 30 12:00..18:00 (6h) + Dec 04 16:00..17:45 (clamped to 1.75h, NOT 6h!) = 9.75h
    const amsRes = await app.request(
      "http://localhost/v1/solar/site-window?lat=52.3676&lon=4.9041&date=2026-06-21&max_wind_ms=7"
    );
    expect(amsRes.status).toBe(200);
    const amsBody = (await amsRes.json()) as SiteWindowResponse;
    expect(amsBody.twilight_and_daylight.regime).toBe("NORMAL");
    expect(amsBody.twilight_and_daylight.daylight_hours).toBeGreaterThan(16);
    expect(amsBody.solar_pv_climatology.target_month).toBe("JUN");
    expect(amsBody.solar_pv_climatology.target_month_ghi_kwh_m2_day).toBe(5.44);
    expect(amsBody.solar_pv_climatology.lowest_month).toEqual({
      month: "JAN",
      ghi_kwh_m2_day: 0.69,
    });
    expect(amsBody.operating_window_7d.dispatchable_hours_next_7d).toBe(9.75);

    const midnightRes = await app.request("http://localhost/v1/solar/site-window?iata=TOS&date=2026-06-21");
    expect(midnightRes.status).toBe(200);
    expect(((await midnightRes.json()) as SiteWindowResponse).twilight_and_daylight.regime).toBe("MIDNIGHT_SUN");

    const polarNightRes = await app.request("http://localhost/v1/solar/site-window?iata=TOS&date=2026-12-21");
    expect(polarNightRes.status).toBe(200);
    expect(((await polarNightRes.json()) as SiteWindowResponse).twilight_and_daylight.regime).toBe("POLAR_NIGHT");

    expect((await app.request("http://localhost/v1/solar/site-window?iata=ZZQ")).status).toBe(404);
    expect((await app.request("http://localhost/v1/solar/site-window?lat=52&lon=4&date=2026-02-30")).status).toBe(400);

    // All -999 sentinel months must fail closed with 502 instead of settling on null data
    allSentinel999 = true;
    const sentinelApp = makeApp();
    expect((await sentinelApp.request("http://localhost/v1/solar/site-window?lat=52.3&lon=4.9")).status).toBe(502);
    allSentinel999 = false;

    failPower = true;
    const failApp = makeApp();
    expect((await failApp.request("http://localhost/v1/solar/site-window?lat=52.3&lon=4.9")).status).toBe(502);
  });
});
