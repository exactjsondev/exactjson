import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createSettlementWindowHandler } from "../src/packs/commerce/routes/settlementWindow";
import { createVatVerifyHandler } from "../src/packs/commerce/routes/vatVerify";
import type { AppBindings } from "../src/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("commerce pack — /v1/commerce/settlement-window & /v1/commerce/vat-verify", () => {
  it("computes cross-year mutual settlement windows with Fri-Sat Middle East weekends, bank-only holidays, and p95 FX buffer", async () => {
    const cache = new BoundedTtlCache(64);
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("date.nager.at/api/v3/PublicHolidays/2026/US")) {
        return jsonResponse([
          // Regional non-bank holiday on Dec 31 must NOT close wire clearing
          { date: "2026-12-31", name: "Local Day", localName: "Local Day", global: false, types: ["Optional"] },
        ]);
      }
      if (url.includes("date.nager.at/api/v3/PublicHolidays/2027/US")) {
        return jsonResponse([
          { date: "2027-01-01", name: "New Year's Day", localName: "New Year's Day", global: true, types: ["Public", "Bank"] },
        ]);
      }
      if (url.includes("date.nager.at/api/v3/PublicHolidays/2026/SA") || url.includes("PublicHolidays/2027/SA")) {
        return new Response(null, { status: 204 });
      }
      if (url.includes("api.frankfurter.dev/v1/")) {
        // SAR is outside ECB reference currencies; Frankfurter returns 422 in production, so it must be skipped via ECB allowlist!
        return jsonResponse({ status: 422, message: "invalid currency: SAR" }, 422);
      }
      if (url.includes("api.worldbank.org/v2/country/US?format=json")) {
        return jsonResponse([
          { page: 1 },
          [{ id: "USA", iso2Code: "US", incomeLevel: { value: "High income" } }],
        ]);
      }
      if (url.includes("api.worldbank.org/v2/country/SA?format=json")) {
        return jsonResponse([
          { page: 1 },
          [{ id: "SAU", iso2Code: "SA", incomeLevel: { value: "High income" } }],
        ]);
      }
      if (url.includes("api.worldbank.org/v2/country/SA/indicator/PA.NUS.FCRF")) {
        return jsonResponse([{ page: 1 }, [{ date: "2025", value: 3.75 }]]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/commerce/settlement-window",
      createSettlementWindowHandler({
        cache,
        fetchImpl: mockFetch,
        nowMs: () => Date.UTC(2026, 11, 30, 12, 0, 0),
      })
    );

    // 2026-12-30 is Wednesday:
    // - T+0 = 2026-12-30 (Wed: US open, SA open)
    // - 2026-12-31 (Thu: US open because non-global Optional holiday ignored, SA open) -> T+1 = 2026-12-31
    // - 2027-01-01 (Fri: US New Year's Day holiday + SA Friday weekend) -> skipped
    // - 2027-01-02 (Sat: US Saturday weekend + SA Saturday weekend) -> skipped
    // - 2027-01-03 (Sun: US Sunday weekend, SA open) -> skipped
    // - 2027-01-04 (Mon: US open, SA open) -> T+2 = 2027-01-04 (5 calendar days lag!)
    const res = await app.request(
      "http://localhost/v1/commerce/settlement-window?from=US&to=SA&date=2026-12-30&tenor=T%2B2&amount=10000"
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      corridor: {
        to: { weekend_days: string[]; holiday_calendar_supported: boolean };
      };
      schedule: {
        t0_first_mutual_open_date: string;
        t1_settlement_date: string;
        t2_settlement_date: string;
        selected_settlement_date: string;
        calendar_lag_days: number;
      };
      fx: {
        rate_source: string;
        spot_rate: number;
        conversion: { converted_mid_amount: number };
      };
      flags: string[];
    };

    expect(body.corridor.to.weekend_days).toEqual(["FRIDAY", "SATURDAY"]);
    expect(body.corridor.to.holiday_calendar_supported).toBe(false);
    expect(body.schedule.t0_first_mutual_open_date).toBe("2026-12-30");
    expect(body.schedule.t1_settlement_date).toBe("2026-12-31");
    expect(body.schedule.t2_settlement_date).toBe("2027-01-04");
    expect(body.schedule.selected_settlement_date).toBe("2027-01-04");
    expect(body.schedule.calendar_lag_days).toBe(5);
    expect(body.fx.rate_source).toBe("worldbank_official");
    expect(body.fx.spot_rate).toBe(3.75);
    expect(body.fx.conversion.converted_mid_amount).toBe(37500);
    expect(body.flags).toContain("PARTIAL_HOLIDAY_CALENDAR");
  });

  it("computes Frankfurter ECB 30d annualized volatility and horizon-scaled p95 buffer, and fails closed 502 on upstream failure", async () => {
    const cache = new BoundedTtlCache(64);
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("date.nager.at")) return jsonResponse([]);
      if (url.includes("api.frankfurter.dev")) {
        return jsonResponse({
          amount: 1,
          base: "USD",
          start_date: "2026-11-01",
          end_date: "2026-11-26",
          rates: {
            "2026-11-20": { JPY: 150.0 },
            "2026-11-23": { JPY: 151.5 },
            "2026-11-24": { JPY: 150.3 },
            "2026-11-25": { JPY: 151.8 },
            "2026-11-26": { JPY: 152.0 },
          },
        });
      }
      if (url.includes("api.worldbank.org")) {
        return jsonResponse([{ page: 1 }, [{ incomeLevel: { value: "High income" } }]]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/commerce/settlement-window",
      createSettlementWindowHandler({
        cache,
        fetchImpl: mockFetch,
        nowMs: () => Date.UTC(2026, 10, 27, 10, 0, 0),
      })
    );

    const okRes = await app.request(
      "http://localhost/v1/commerce/settlement-window?from=US&to=JP&date=2026-11-27&amount=1000"
    );
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as {
      fx: { spot_rate: number; volatility_30d_ann_pct: number; horizon_p95_move_pct: number };
      flags: string[];
    };
    expect(okBody.fx.spot_rate).toBe(152);
    expect(okBody.fx.volatility_30d_ann_pct).toBeGreaterThan(0);
    expect(okBody.fx.horizon_p95_move_pct).toBeGreaterThan(0);
    expect(okBody.flags).toContain("ZERO_DECIMAL_TARGET_CURRENCY");

    // Upstream 503 -> fail-closed 502
    const brokenApp = new Hono<AppBindings>();
    brokenApp.get(
      "/v1/commerce/settlement-window",
      createSettlementWindowHandler({
        cache: new BoundedTtlCache(16),
        fetchImpl: async () => new Response("down", { status: 503 }),
      })
    );
    const failRes = await brokenApp.request(
      "http://localhost/v1/commerce/settlement-window?from=US&to=JP"
    );
    expect(failRes.status).toBe(502);
  });

  it("verifies live EU VIES VAT, resolves GLEIF BIC, flags cross-country IBAN swaps, and fails closed 502 on MS_UNAVAILABLE", async () => {
    const cache = new BoundedTtlCache(64);
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("ec.europa.eu/taxation_customs/vies/rest-api/ms/IE/vat/6388047V")) {
        return jsonResponse({
          isValid: true,
          requestDate: "2026-11-27T18:59:20.272Z",
          userError: "VALID",
          name: "GOOGLE IRELAND LIMITED",
          address: "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4",
        });
      }
      if (url.includes("ec.europa.eu/taxation_customs/vies/rest-api/ms/DE/vat/122268496")) {
        // Member state national database unavailable -> MUST return HTTP 502, never false invalid!
        return jsonResponse({
          isValid: false,
          userError: "MS_UNAVAILABLE",
          name: "---",
          address: "---",
        });
      }
      if (url.includes("api.gleif.org/api/v1/lei-records") && url.includes("DEUTDEFF500")) {
        return jsonResponse({ data: [] });
      }
      if (url.includes("api.gleif.org/api/v1/lei-records") && url.includes("DEUTDEFFXXX")) {
        return jsonResponse({
          data: [
            {
              id: "7LTWFZYICNSX8D621K86",
              attributes: {
                entity: {
                  legalName: { name: "DEUTSCHE BANK AKTIENGESELLSCHAFT" },
                  legalAddress: { country: "DE", city: "FRANKFURT AM MAIN" },
                  status: "ACTIVE",
                },
                registration: { status: "ISSUED" },
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const app = new Hono<AppBindings>();
    app.get("/v1/commerce/vat-verify", createVatVerifyHandler({ cache, fetchImpl: mockFetch }));

    // 1. Irish VAT paired with a German IBAN + branch BIC DEUTDEFF500 (falls back to head-office DEUTDEFFXXX) -> REVIEW + IBAN_VAT_COUNTRY_MISMATCH!
    const mismatchRes = await app.request(
      "http://localhost/v1/commerce/vat-verify?vat=IE6388047V&iban=DE89370400440532013000&bic=DEUTDEFF500&lei=HWUPKR0MPOU8FGXBT394"
    );
    expect(mismatchRes.status).toBe(200);
    const mismatchBody = (await mismatchRes.json()) as {
      invoice_gate: string;
      reverse_charge_eligible: boolean;
      fraud_flags: string[];
      vat: { valid: boolean; registered_name: string };
      iban: { valid: boolean; country_code: string };
      bic: { valid_format: boolean; gleif_bank_name: string };
      lei: { valid: boolean };
    };
    expect(mismatchBody.vat.valid).toBe(true);
    expect(mismatchBody.vat.registered_name).toBe("GOOGLE IRELAND LIMITED");
    expect(mismatchBody.reverse_charge_eligible).toBe(true);
    expect(mismatchBody.iban.valid).toBe(true);
    expect(mismatchBody.bic.gleif_bank_name).toBe("DEUTSCHE BANK AKTIENGESELLSCHAFT");
    expect(mismatchBody.lei.valid).toBe(true);
    expect(mismatchBody.fraud_flags).toContain("IBAN_VAT_COUNTRY_MISMATCH");
    expect(mismatchBody.invoice_gate).toBe("REVIEW");

    // 2. VIES HTTP 200 with userError: MS_UNAVAILABLE -> strict fail-closed HTTP 502 (never cached, never settled)
    const unavailRes = await app.request("http://localhost/v1/commerce/vat-verify?vat=DE122268496");
    expect(unavailRes.status).toBe(502);
    const unavailBody = (await unavailRes.json()) as { upstream_error: string };
    expect(unavailBody.upstream_error).toContain("VIES_MS_UNAVAILABLE");

    // 3. Invalid query (UK GB VAT not in VIES) -> 400
    const gbRes = await app.request("http://localhost/v1/commerce/vat-verify?vat=GB123456789");
    expect(gbRes.status).toBe(400);
  });
});
