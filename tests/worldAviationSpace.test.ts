import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createAirportDelaysHandler } from "../src/packs/world/routes/airportDelays";
import { createWeatherGnssHandler } from "../src/packs/world/routes/weatherGnss";
import type { computeAirportDelays } from "../src/packs/world/services/airportDelays";
import type { computeWeatherGnss } from "../src/packs/world/services/weatherGnss";
import type { AppBindings } from "../src/types";

type AirportDelaysResponse = ReturnType<typeof computeAirportDelays>;
type WeatherGnssResponse = ReturnType<typeof computeWeatherGnss>;

describe("world pack — aviation/airport-delays and space/weather-gnss", () => {
  it("decodes US & international airport METAR/TAF/SIGMET + FAA NAS, handles +TSRA/+SN/M1-4/vertVis/UNKNOWN-cat, skips FAA outside US, and enforces 400/404/502", async () => {
    let faaCalls = 0;
    let forceFaaError = false;
    let forceMetar500 = false;

    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));

      if (url.hostname === "nasstatus.faa.gov") {
        faaCalls += 1;
        if (forceFaaError) {
          return new Response("gateway timeout", { status: 504 });
        }
        const xml = `<?xml version="1.0"?>
          <AIRPORT_STATUS_INFORMATION>
            <Update_Time>Fri Nov 27 17:36:34 2026 GMT</Update_Time>
            <Delay_type>
              <Name>Ground Delay Programs</Name>
              <Ground_Delay_List>
                <Ground_Delay>
                  <ARPT>JFK</ARPT>
                  <Reason>wind</Reason>
                  <Avg>45 minutes</Avg>
                  <Max>1 hour and 30 minutes</Max>
                </Ground_Delay>
              </Ground_Delay_List>
            </Delay_type>
          </AIRPORT_STATUS_INFORMATION>`;
        return new Response(xml, { status: 200 });
      }

      if (url.hostname === "aviationweather.gov") {
        if (url.pathname === "/api/data/metar") {
          if (forceMetar500) {
            return new Response("upstream down", { status: 503 });
          }
          const ids = url.searchParams.get("ids");
          if (ids === "KJFK") {
            return new Response(
              JSON.stringify([
                {
                  icaoId: "KJFK",
                  reportTime: "2026-11-27T17:00:00.000Z",
                  temp: 12.2,
                  dewp: 5.6,
                  wdir: 200,
                  wspd: 18,
                  wgst: 28,
                  visib: "10+",
                  altim: 999.1,
                  rawOb: "METAR KJFK 271651Z 20018G28KT 10SM BKN043 12/06 A2950",
                  clouds: [{ cover: "BKN", base: 4300 }],
                  fltCat: "VFR",
                },
              ]),
              { status: 200 }
            );
          }
          if (ids === "KLAX") {
            // Omit fltCat, test M1/4SM dense fog + vertVis 200ft obscured sky + +SN convective/winter wx
            return new Response(
              JSON.stringify([
                {
                  icaoId: "KLAX",
                  reportTime: "2026-11-27T17:00:00.000Z",
                  temp: -1,
                  dewp: -1,
                  wdir: 250,
                  wspd: 8,
                  visib: "M1/4",
                  vertVis: 200,
                  altim: 1014,
                  wxString: "+SN FG",
                  rawOb: "METAR KLAX 271653Z 25008KT M1/4SM +SN FG VV002 M01/M01 A2994",
                  clouds: [{ cover: "OVX", base: null }],
                },
              ]),
              { status: 200 }
            );
          }
          if (ids === "KORD") {
            // Compound +TSRA token in rawOb without wxString
            return new Response(
              JSON.stringify([
                {
                  icaoId: "KORD",
                  reportTime: "2026-11-27T17:00:00.000Z",
                  temp: 19,
                  dewp: 17,
                  wdir: 230,
                  wspd: 15,
                  visib: "4",
                  altim: 1008,
                  rawOb: "METAR KORD 271651Z 23015KT 4SM +TSRA BKN025CB 19/17 A2977 RMK AO2",
                  clouds: [{ cover: "BKN", base: 2500 }],
                  fltCat: "MVFR",
                },
              ]),
              { status: 200 }
            );
          }
          if (ids === "EGLL") {
            return new Response(
              JSON.stringify([
                {
                  icaoId: "EGLL",
                  reportTime: "2026-11-27T17:20:00.000Z",
                  temp: 5,
                  dewp: 2,
                  wdir: 100,
                  wspd: 9,
                  visib: "6+",
                  altim: 1020,
                  rawOb: "METAR EGLL 271720Z AUTO 10009KT 9999 OVC011 05/02 Q1020",
                  clouds: [{ cover: "OVC", base: 1100 }],
                  fltCat: "MVFR",
                },
              ]),
              { status: 200 }
            );
          }
          // KTEB returns empty METAR (TAF-only) to verify UNKNOWN flight_category never marks dispatch_go: true
          return new Response("[]", { status: 200 });
        }

        if (url.pathname === "/api/data/taf") {
          const ids = url.searchParams.get("ids");
          if (ids === "KZZZ") {
            return new Response("[]", { status: 200 });
          }
          return new Response(
            JSON.stringify([{ icaoId: ids, rawTAF: `TAF ${ids} 271720Z 2718/2824 20012KT P6SM SCT040` }]),
            { status: 200 }
          );
        }

        if (url.pathname === "/api/data/isigmet") {
          return new Response(
            JSON.stringify([
              {
                firId: "KZNY",
                hazard: "TURB",
                qualifier: "SEV",
                base: 18000,
                top: 36000,
                coords: [
                  { lat: 40.5, lon: -74.0 },
                  { lat: 40.9, lon: -73.5 },
                ],
              },
            ]),
            { status: 200 }
          );
        }
      }

      return new Response("unexpected", { status: 500 });
    };

    const makeApp = () => {
      const a = new Hono<AppBindings>();
      const cache = new BoundedTtlCache(64);
      a.get(
        "/v1/aviation/airport-delays",
        createAirportDelaysHandler({
          cache,
          referenceCache: cache,
          fetchImpl: mockFetch,
          nowMs: () => Date.UTC(2026, 10, 27, 17, 30, 0),
        })
      );
      return a;
    };

    // 1. Non-US hub (LHR -> EGLL): must NOT touch FAA NAS
    const ukApp = makeApp();
    const lhrRes = await ukApp.request("http://localhost/v1/aviation/airport-delays?airport=LHR");
    expect(lhrRes.status).toBe(200);
    expect(faaCalls).toBe(0);
    const lhrBody = (await lhrRes.json()) as AirportDelaysResponse;
    expect(lhrBody.airport.icao).toBe("EGLL");
    expect(lhrBody.flight_category).toBe("MVFR");
    expect(lhrBody.faa_nas.source_status).toBe("not_applicable_non_us");

    // 2. US hub (JFK -> KJFK): combines NOAA METAR/TAF/SIGMET + FAA Ground Delay Program
    const usApp = makeApp();
    const jfkRes = await usApp.request("http://localhost/v1/aviation/airport-delays?airport=jfk");
    expect(jfkRes.status).toBe(200);
    expect(faaCalls).toBe(1);
    const jfkBody = (await jfkRes.json()) as AirportDelaysResponse;
    expect(jfkBody.airport.icao).toBe("KJFK");
    expect(jfkBody.flight_category).toBe("VFR");
    expect(jfkBody.faa_nas.source_status).toBe("live");
    expect(jfkBody.faa_nas.ground_delay_program).toBe(true);
    expect(jfkBody.flags).toContain("FAA_GROUND_DELAY_PROGRAM");
    expect(jfkBody.nearby_sigmets.length).toBe(1);
    expect(jfkBody.delay_risk_tier).toBe("HIGH");

    // 3. US hub (LAX) when FAA NAS fails: M1/4SM (0.25) + vertVis 200ft + +SN convective/winter wx
    forceFaaError = true;
    const laxApp = makeApp();
    const laxRes = await laxApp.request("http://localhost/v1/aviation/airport-delays?airport=LAX");
    expect(laxRes.status).toBe(200);
    const laxBody = (await laxRes.json()) as AirportDelaysResponse;
    expect(laxBody.flight_category).toBe("LIFR");
    expect(laxBody.weather.visibility_sm).toBe(0.25);
    expect(laxBody.weather.ceiling_ft_agl).toBe(200);
    expect(laxBody.flags).toContain("CONVECTIVE_OR_WINTER_WX");
    expect(laxBody.faa_nas.source_status).toBe("fallback_metar_only");
    expect(laxBody.flags).toContain("FAA_NAS_FALLBACK_METAR_ONLY");
    expect(laxBody.dispatch_go).toBe(false);
    forceFaaError = false;

    // 4. Compound +TSRA token detection in rawOb (ORD)
    const ordRes = await usApp.request("http://localhost/v1/aviation/airport-delays?airport=ORD");
    expect(ordRes.status).toBe(200);
    const ordBody = (await ordRes.json()) as AirportDelaysResponse;
    expect(ordBody.flags).toContain("CONVECTIVE_OR_WINTER_WX");

    // 5. TAF-only station with missing METAR (KTEB) -> UNKNOWN flight_category must NOT report dispatch_go: true
    const tebRes = await usApp.request("http://localhost/v1/aviation/airport-delays?airport=KTEB");
    expect(tebRes.status).toBe(200);
    const tebBody = (await tebRes.json()) as AirportDelaysResponse;
    expect(tebBody.flight_category).toBe("UNKNOWN");
    expect(tebBody.flags).toContain("FLIGHT_CAT_UNKNOWN");
    expect(tebBody.dispatch_go).toBe(false);

    // 6. 404 unknown IATA & nonexistent ICAO; 400 invalid code
    expect((await usApp.request("http://localhost/v1/aviation/airport-delays?airport=ZZQ")).status).toBe(404);
    expect((await usApp.request("http://localhost/v1/aviation/airport-delays?airport=KZZZ")).status).toBe(404);
    expect((await usApp.request("http://localhost/v1/aviation/airport-delays?airport=12!")).status).toBe(400);

    // 7. 502 fail-closed when primary NOAA METAR fails
    forceMetar500 = true;
    const failApp = makeApp();
    const res502 = await failApp.request("http://localhost/v1/aviation/airport-delays?airport=JFK");
    expect(res502.status).toBe(502);
  });

  it("evaluates space/weather-gnss Go/No-Go gates, keeps next_24h_forecast strictly to Day-1, ignores CelesTrak 2041 PRM rows, and fails closed on 502", async () => {
    let stormMode = false;
    let failCelestrak = false;
    let failSwpc = false;

    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));

      if (url.hostname === "services.swpc.noaa.gov") {
        if (failSwpc) {
          return new Response("swpc down", { status: 503 });
        }
        if (url.pathname === "/products/noaa-scales.json") {
          if (stormMode) {
            return new Response(
              JSON.stringify({
                "0": {
                  R: { Scale: "2", Text: "moderate" },
                  S: { Scale: "2", Text: "moderate" },
                  G: { Scale: "3", Text: "strong" },
                },
                "1": {
                  R: { Scale: null, MinorProb: "65", MajorProb: "25" },
                  S: { Scale: null, Prob: "40" },
                  G: { Scale: "3", Text: "strong" },
                },
                "2": {
                  G: { Scale: "5", Text: "extreme" },
                },
              }),
              { status: 200 }
            );
          }
          return new Response(
            JSON.stringify({
              "0": {
                R: { Scale: "0", Text: "none" },
                S: { Scale: "0", Text: "none" },
                G: { Scale: "0", Text: "none" },
              },
              "1": {
                R: { Scale: null, MinorProb: "1", MajorProb: "1" },
                S: { Scale: null, Prob: "1" },
                G: { Scale: "1", Text: "minor" },
              },
              "2": {
                // Day 2 (48-72h) G4 must NOT leak into next_24h_forecast.g_geomagnetic_max
                G: { Scale: "4", Text: "severe" },
              },
            }),
            { status: 200 }
          );
        }

        if (url.pathname === "/products/noaa-planetary-k-index-forecast.json") {
          return new Response(
            JSON.stringify([
              { time_tag: "2026-11-27 15:00:00", kp: stormMode ? 6.67 : 1.67, observed: "observed" },
              { time_tag: "2026-11-27 21:00:00", kp: stormMode ? 7.33 : 3.33, observed: "predicted" },
            ]),
            { status: 200 }
          );
        }

        if (url.pathname === "/products/summary/solar-wind-speed.json") {
          return new Response(
            JSON.stringify([{ proton_speed: stormMode ? 690 : 325, time_tag: "2026-11-27T17:31:00Z" }]),
            { status: 200 }
          );
        }

        if (url.pathname === "/products/summary/solar-wind-mag-field.json") {
          return new Response(
            JSON.stringify([{ bt: stormMode ? 22 : 9, bz_gsm: stormMode ? -16 : 5, time_tag: "2026-11-27T17:31:00Z" }]),
            { status: 200 }
          );
        }

        if (url.pathname === "/products/alerts.json") {
          return new Response(
            JSON.stringify(
              stormMode
                ? [
                    {
                      product_id: "K07W",
                      issue_datetime: "2026-11-27 16:10:00.000",
                      message: "Space Weather Message Code: WARK07\r\nWARNING: Geomagnetic K-index of 7 expected",
                    },
                  ]
                : []
            ),
            { status: 200 }
          );
        }

        if (url.pathname === "/products/summary/10cm-flux.json") {
          return new Response(
            JSON.stringify([{ Flux: "215", TimeStamp: "2026-11-27 17:00:00" }]),
            { status: 200 }
          );
        }
      }

      if (url.hostname === "celestrak.org") {
        if (failCelestrak) {
          return new Response("throttled", { status: 503 });
        }
        const csv = [
          "DATE,BSRN,ND,KP1,KP2,KP3,KP4,KP5,KP6,KP7,KP8,KP_SUM,AP1,AP2,AP3,AP4,AP5,AP6,AP7,AP8,AP_AVG,CP,C9,ISN,F10.7_OBS,F10.7_ADJ,F10.7_DATA_TYPE,F10.7_OBS_CENTER81,F10.7_OBS_LAST81,F10.7_ADJ_CENTER81,F10.7_ADJ_LAST81",
          "2026-11-26,2636,5,0,20,7,3,7,10,10,13,70,0,7,3,2,3,4,4,5,4,0.1,0,29,87.4,85.1,OBS,111.7,108.6,109.0,107.9",
          "2041-10-01,2837,1,,,,,,,,,,,,,,,,,,,,,10,69.8,70.0,PRM,68.8,69.0,69.2,70.5",
        ].join("\n");
        return new Response(csv, { status: 200 });
      }

      return new Response("unexpected", { status: 500 });
    };

    const makeApp = () => {
      const a = new Hono<AppBindings>();
      const cache = new BoundedTtlCache(64);
      a.get(
        "/v1/space/weather-gnss",
        createWeatherGnssHandler({
          referenceCache: cache,
          fetchImpl: mockFetch,
          nowMs: () => Date.UTC(2026, 10, 27, 17, 35, 0),
        })
      );
      return a;
    };

    // 1. Nominal conditions + Day-1-only g_geomagnetic_max + CelesTrak OBS row selection
    const calmApp = makeApp();
    const calmRes = await calmApp.request("http://localhost/v1/space/weather-gnss?lat=37.77");
    expect(calmRes.status).toBe(200);
    const calmBody = (await calmRes.json()) as WeatherGnssResponse;
    expect(calmBody.gates).toEqual({
      rtk_gnss_status: "GO",
      magnetometer_compass_status: "GO",
      hf_comms_status: "GO",
      satcom_status: "GO",
      leo_drag_regime: "LOW",
    });
    expect(calmBody.noaa_scales.next_24h_forecast.g_geomagnetic_max).toBe(1);
    expect(calmBody.thermosphere_drag.obs_date).toBe("2026-11-26");
    expect(calmBody.thermosphere_drag.f107_obs_sfu).toBe(87.4);
    expect(calmBody.thermosphere_drag.ap_daily_avg).toBe(4);

    // 2. Storm mode at auroral latitude + CelesTrak fallback to SWPC 10cm-flux (Flux/TimeStamp keys)
    stormMode = true;
    failCelestrak = true;
    const stormApp = makeApp();
    const stormRes = await stormApp.request("http://localhost/v1/space/weather-gnss?lat=64.84");
    expect(stormRes.status).toBe(200);
    const stormBody = (await stormRes.json()) as WeatherGnssResponse;
    expect(stormBody.latitude_context.magnetic_zone).toBe("AURORAL_HIGH_LAT");
    expect(stormBody.gates.rtk_gnss_status).toBe("NO_GO");
    expect(stormBody.gates.magnetometer_compass_status).toBe("NO_GO");
    expect(stormBody.gates.leo_drag_regime).toBe("EXTREME");
    expect(stormBody.thermosphere_drag.f107_obs_sfu).toBe(215);
    expect(stormBody.thermosphere_drag.obs_date).toBe("2026-11-27");
    expect(stormBody.recent_alerts.length).toBe(1);

    // 3. 400 validation & 502 fail-closed
    expect((await stormApp.request("http://localhost/v1/space/weather-gnss?lat=999")).status).toBe(400);
    failSwpc = true;
    const failApp = makeApp();
    expect((await failApp.request("http://localhost/v1/space/weather-gnss")).status).toBe(502);
  });
});
