import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createCompanyVerifyHandler } from "../src/packs/commerce/routes/companyVerify";
import { createSafetyRecallHandler } from "../src/packs/commerce/routes/safetyRecall";
import type { AppBindings } from "../src/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("commerce pack — /v1/entity/company-verify & /v1/consumer/safety-recall", () => {
  it("fuses GLEIF LEI ownership, Wikidata CIK/ticker/domain, SEC EDGAR submissions, and USAspending awards", async () => {
    const cache = new BoundedTtlCache(64);
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.gleif.org/api/v1/lei-records?") && url.includes("Apple")) {
        return jsonResponse({
          data: [
            {
              id: "HWUPKR0MPOU8FGXBT394",
              attributes: {
                lei: "HWUPKR0MPOU8FGXBT394",
                bic: [],
                entity: {
                  legalName: { name: "Apple Inc." },
                  jurisdiction: "US-CA",
                  registeredAs: "C0806592",
                  status: "ACTIVE",
                  legalAddress: {
                    city: "Cupertino",
                    region: "US-CA",
                    country: "US",
                    postalCode: "95014",
                  },
                  headquartersAddress: {
                    city: "Cupertino",
                    region: "US-CA",
                    country: "US",
                    postalCode: "95014",
                  },
                },
                registration: { status: "ISSUED" },
              },
            },
          ],
        });
      }
      if (
        url.includes("/lei-records/HWUPKR0MPOU8FGXBT394/direct-parent") ||
        url.includes("/lei-records/HWUPKR0MPOU8FGXBT394/ultimate-parent")
      ) {
        return jsonResponse({ errors: [{ status: "404" }] }, 404);
      }
      if (url.includes("wikidata.org/w/api.php") && url.includes("wbsearchentities")) {
        return jsonResponse({
          search: [
            {
              id: "Q312",
              label: "Apple Inc.",
              description: "American multinational technology company",
            },
          ],
        });
      }
      if (url.includes("query.wikidata.org/sparql")) {
        return jsonResponse({
          results: {
            bindings: [
              {
                lei: { value: "HWUPKR0MPOU8FGXBT394" },
                cik: { value: "0000320193" },
                website: { value: "https://www.apple.com/" },
                ticker: { value: "AAPL" },
              },
            ],
          },
        });
      }
      if (url.includes("data.sec.gov/submissions/CIK0000320193.json")) {
        return jsonResponse({
          cik: "320193",
          name: "Apple Inc.",
          sic: "3571",
          sicDescription: "Electronic Computers",
          stateOfIncorporation: "CA",
          ein: "942404110",
          tickers: ["AAPL"],
          exchanges: ["Nasdaq"],
          filings: {
            recent: {
              form: ["8-K", "10-K", "4"],
              filingDate: ["2026-11-05", "2026-10-30", "2026-10-29"],
              accessionNumber: ["0000320193-26-000110", "0000320193-26-000106", "0000320193-26-000105"],
            },
          },
        });
      }
      if (url.includes("api.usaspending.gov/api/v2/search/spending_by_award/")) {
        return jsonResponse({
          results: [
            // Unrelated prefix collision ("APPLETON ...") must be filtered out!
            {
              "Award ID": "BAD-PREFIX-999",
              "Recipient Name": "APPLETON DEFENSE SYSTEMS LLC",
              "Award Amount": 99999999,
              "Awarding Agency": "Department of Defense",
              "Start Date": "2026-01-01",
            },
            {
              "Award ID": "FA872625F0012",
              "Recipient Name": "APPLE INC.",
              "Award Amount": 1250000.5,
              "Awarding Agency": "Department of Defense",
              "Start Date": "2025-03-15",
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const app = new Hono<AppBindings>();
    app.get("/v1/entity/company-verify", createCompanyVerifyHandler({ cache, fetchImpl: mockFetch }));

    const res = await app.request("http://localhost/v1/entity/company-verify?query=Apple%20Inc.");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kyb_status: string;
      entity: {
        legal_name: string;
        lei: string;
        official_domain: string;
        tickers: string[];
      };
      ownership: { is_ultimate_parent: boolean };
      sec_edgar: { cik: string; sic: string; recent_filings: Array<{ form: string }> };
      us_federal_contracts: { matched_awards_returned: number; top_awards_total_usd: number };
    };

    expect(body.kyb_status).toBe("VERIFIED_ACTIVE");
    expect(body.entity.legal_name).toBe("Apple Inc.");
    expect(body.entity.lei).toBe("HWUPKR0MPOU8FGXBT394");
    expect(body.entity.official_domain).toBe("apple.com");
    expect(body.entity.tickers).toContain("AAPL");
    expect(body.ownership.is_ultimate_parent).toBe(true);
    expect(body.sec_edgar.cik).toBe("0000320193");
    expect(body.sec_edgar.sic).toBe("3571");
    // Form 4 insider noise filtered out; 8-K and 10-K preserved
    expect(body.sec_edgar.recent_filings.map((f) => f.form)).toEqual(["8-K", "10-K"]);
    expect(body.us_federal_contracts.matched_awards_returned).toBe(1);
    expect(body.us_federal_contracts.top_awards_total_usd).toBe(1250000.5);
  });

  it("returns 404 when no corporate entity matches and 502 when GLEIF fails", async () => {
    const missApp = new Hono<AppBindings>();
    missApp.get(
      "/v1/entity/company-verify",
      createCompanyVerifyHandler({
        cache: new BoundedTtlCache(16),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("api.gleif.org")) return jsonResponse({ data: [] });
          if (url.includes("wikidata.org")) return jsonResponse({ search: [] });
          return jsonResponse({ results: [] });
        },
      })
    );
    const missRes = await missApp.request(
      "http://localhost/v1/entity/company-verify?query=NonexistentShellCorp9999"
    );
    expect(missRes.status).toBe(404);

    const errApp = new Hono<AppBindings>();
    errApp.get(
      "/v1/entity/company-verify",
      createCompanyVerifyHandler({
        cache: new BoundedTtlCache(16),
        fetchImpl: async () => new Response("GLEIF error", { status: 500 }),
      })
    );
    const errRes = await errApp.request(
      "http://localhost/v1/entity/company-verify?lei=HWUPKR0MPOU8FGXBT394"
    );
    expect(errRes.status).toBe(502);
  });

  it("screens US CPSC and openFDA enforcement recalls with Class I severity ranking, 404 zero-match tolerance, and 502 fail-closed", async () => {
    const cache = new BoundedTtlCache(64);
    let seenFdaUrl = "";
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("saferproducts.gov/RestWebServices/Recall")) {
        // Simulate CPSC returning 30 oldest 1995 recalls first in ascending RecallID order, with active 2026 recall at index 30!
        const historical = Array.from({ length: 30 }, (_, i) => ({
          RecallID: 100 + i,
          RecallNumber: `950${i}`,
          RecallDate: "1995-04-10T00:00:00",
          Title: `Legacy 1995 Stroller Model ${i}`,
          Description: "Historical stroller latch recall.",
          Manufacturers: [{ Name: "OldCo" }],
          Hazards: [{ Name: "Pinch hazard" }],
          Remedies: [{ Name: "Repair kit" }],
          Products: [{ Name: "Stroller" }],
        }));
        return jsonResponse([
          ...historical,
          {
            RecallID: 10880,
            RecallNumber: "26639",
            RecallDate: "2026-07-23T00:00:00",
            Title:
              "Peony Design Recalls Stroller Bags Due to Risk of Serious Injury or Death from Choking Hazard",
            Description: "Stroller bags with detachable snaps.",
            URL: "https://www.cpsc.gov/Recalls/2026/Peony-Design",
            Manufacturers: [{ Name: "Peony Design" }],
            Hazards: [{ Name: "Choking hazard posing risk of serious injury or death" }],
            Remedies: [{ Name: "Full refund" }],
            Products: [{ Name: "Stroller Bag" }],
          },
        ]);
      }
      if (url.includes("api.fda.gov/food/enforcement.json")) {
        seenFdaUrl = url;
        return jsonResponse({
          results: [
            {
              recall_number: "F-0101-2026",
              recall_initiation_date: "20260915",
              status: "Ongoing",
              classification: "Class I",
              recalling_firm: "Infant Care Nutrition LLC",
              product_description: "Organic Travel Stroller Snack Pouch",
              reason_for_recall: "Potential Cronobacter sakazakii contamination",
            },
          ],
        });
      }
      if (url.includes("api.fda.gov/drug/enforcement.json") || url.includes("api.fda.gov/device/enforcement.json")) {
        // openFDA returns 404 NOT_FOUND when zero recalls match
        return jsonResponse({ error: { code: "NOT_FOUND", message: "No matches found!" } }, 404);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/consumer/safety-recall",
      createSafetyRecallHandler({
        cache,
        fetchImpl: mockFetch,
        nowMs: () => Date.UTC(2026, 10, 27),
      })
    );

    const res = await app.request("http://localhost/v1/consumer/safety-recall?query=stroller");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recall_gate: string;
      listing_clear: boolean;
      highest_severity: string;
      counts: {
        total_matched: number;
        cpsc_consumer: number;
        fda_food: number;
        fda_drug: number;
        fda_device: number;
      };
      recalls: Array<{ agency: string; severity: string }>;
    };

    expect(seenFdaUrl).toContain("sort=recall_initiation_date:desc");
    expect(body.recall_gate).toBe("ACTIVE_RECALL_ALERT");
    expect(body.listing_clear).toBe(false);
    expect(body.highest_severity).toBe("CRITICAL_CLASS_I");
    expect(body.counts.cpsc_consumer).toBe(25);
    expect(body.counts.fda_food).toBe(1);
    expect(body.counts.fda_drug).toBe(0);
    expect(body.counts.fda_device).toBe(0);
    expect(body.recalls[0]?.severity).toBe("CRITICAL_CLASS_I");
    expect(body.recalls.some((r) => (r as { recall_number?: string }).recall_number === "26639")).toBe(
      true
    );

    // Clean product with zero matches across CPSC + openFDA 404s -> CLEAR + listing_clear: true
    const cleanApp = new Hono<AppBindings>();
    cleanApp.get(
      "/v1/consumer/safety-recall",
      createSafetyRecallHandler({
        cache: new BoundedTtlCache(16),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("saferproducts.gov")) return jsonResponse([]);
          return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
        },
      })
    );
    const cleanRes = await cleanApp.request(
      "http://localhost/v1/consumer/safety-recall?query=titanium%20spork"
    );
    expect(cleanRes.status).toBe(200);
    const cleanBody = (await cleanRes.json()) as { recall_gate: string; listing_clear: boolean };
    expect(cleanBody.recall_gate).toBe("CLEAR");
    expect(cleanBody.listing_clear).toBe(true);

    // openFDA 429 rate-limit -> fail-closed 502 (never report missing data as CLEAR!)
    const rateLimitedApp = new Hono<AppBindings>();
    rateLimitedApp.get(
      "/v1/consumer/safety-recall",
      createSafetyRecallHandler({
        cache: new BoundedTtlCache(16),
        fetchImpl: async () => new Response("Too Many Requests", { status: 429 }),
      })
    );
    const rateLimitedRes = await rateLimitedApp.request(
      "http://localhost/v1/consumer/safety-recall?query=ibuprofen&category=drug"
    );
    expect(rateLimitedRes.status).toBe(502);
  });
});
