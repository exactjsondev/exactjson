import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createDrugTrialBriefHandler } from "../src/packs/research/routes/drugTrialBrief";
import { parseDrugTrialInput } from "../src/packs/research/validation";
import type { AppBindings } from "../src/types";

const FIXED_NOW = Date.parse("2026-11-27T20:00:00.000Z");

describe("bio/drug-trial-brief validation, catalyst ranking & RxNorm enrichment", () => {
  it("validates drug, NCT promotion, condition, phase, and limit parameters", () => {
    expect(parseDrugTrialInput({ drug: "NCT05382286" })).toEqual({
      ok: true,
      value: {
        drug: null,
        nct: "NCT05382286",
        condition: null,
        phaseScope: "PHASE2_3",
        limit: 8,
      },
    });
    expect(parseDrugTrialInput({ drug: "NCT05382286", nct: "NCT05382286" })).toEqual({
      ok: true,
      value: {
        drug: null,
        nct: "NCT05382286",
        condition: null,
        phaseScope: "PHASE2_3",
        limit: 8,
      },
    });
    expect(parseDrugTrialInput({ drug: "NCT05382286", nct: "NCT99999999" }).ok).toBe(false);
    expect(parseDrugTrialInput({}).ok).toBe(false);
    expect(parseDrugTrialInput({ nct: "NCT123" }).ok).toBe(false);
    expect(parseDrugTrialInput({ drug: "semaglutide", phase: "PHASE9" }).ok).toBe(false);
    expect(parseDrugTrialInput({ drug: "semaglutide", limit: "99" }).ok).toBe(false);
  });

  it("ranks upcoming Phase 2/3 catalysts ahead of stale overdue records, normalizes RxNorm/RxClass, and handles 404/502", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("clinicaltrials.gov/api/v2/studies?filter.overallStatus=") && url.includes("semaglutide")) {
        return new Response(
          JSON.stringify({
            totalCount: 3,
            studies: [
              // Stale 2022 unupdated entry — must be demoted behind live upcoming catalysts
              {
                protocolSection: {
                  identificationModule: {
                    nctId: "NCT04000001",
                    briefTitle: "Old Unupdated Academic Study",
                  },
                  statusModule: {
                    overallStatus: "RECRUITING",
                    startDateStruct: { date: "2020-01-10" },
                    primaryCompletionDateStruct: { date: "2022-06-01", type: "ESTIMATED" },
                    lastUpdatePostDateStruct: { date: "2022-01-15" },
                  },
                  sponsorCollaboratorsModule: {
                    leadSponsor: { name: "Regional Clinic", class: "OTHER" },
                  },
                  conditionsModule: { conditions: ["Obesity"] },
                  designModule: { phases: ["PHASE2"], enrollmentInfo: { count: 40 } },
                  armsInterventionsModule: {
                    interventions: [{ name: "Semaglutide", type: "DRUG" }],
                  },
                },
                hasResults: false,
              },
              // Imminent Phase 3 INDUSTRY catalyst (Dec 2026)
              {
                protocolSection: {
                  identificationModule: {
                    nctId: "NCT06000002",
                    briefTitle: "Pivotal Phase 3 Semaglutide Outcomes Trial",
                  },
                  statusModule: {
                    overallStatus: "ACTIVE_NOT_RECRUITING",
                    startDateStruct: { date: "2024-02-01" },
                    primaryCompletionDateStruct: { date: "2026-12", type: "ESTIMATED" },
                    lastUpdatePostDateStruct: { date: "2026-11-01" },
                  },
                  sponsorCollaboratorsModule: {
                    leadSponsor: { name: "Novo Nordisk A/S", class: "INDUSTRY" },
                  },
                  conditionsModule: { conditions: ["MASH", "Obesity"] },
                  designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 1200 } },
                  armsInterventionsModule: {
                    interventions: [{ name: "Semaglutide", type: "DRUG" }],
                  },
                  outcomesModule: {
                    primaryOutcomes: [
                      { measure: "Resolution of steatohepatitis", timeFrame: "Week 72" },
                    ],
                  },
                },
                hasResults: false,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("rxnav.nlm.nih.gov/REST/rxcui.json?name=semaglutide")) {
        return new Response(JSON.stringify({ idGroup: { rxnormId: ["1991302"] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("rxnav.nlm.nih.gov/REST/rxcui/1991302/related.json")) {
        return new Response(
          JSON.stringify({
            relatedGroup: {
              conceptGroup: [
                {
                  tty: "IN",
                  conceptProperties: [{ rxcui: "1991302", name: "semaglutide", tty: "IN" }],
                },
                {
                  tty: "BN",
                  conceptProperties: [
                    { rxcui: "1991316", name: "Ozempic", tty: "BN" },
                    { rxcui: "2553902", name: "Wegovy", tty: "BN" },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui=1991302")) {
        return new Response(
          JSON.stringify({
            rxclassDrugInfoList: {
              rxclassDrugInfo: [
                {
                  minConcept: { rxcui: "1991302", name: "semaglutide", tty: "IN" },
                  rxclassMinConceptItem: {
                    classId: "A10BJ",
                    className: "Glucagon-like peptide-1 (GLP-1) analogues",
                    classType: "ATC1-4",
                  },
                },
                {
                  minConcept: { rxcui: "1991302", name: "semaglutide", tty: "IN" },
                  rxclassMinConceptItem: {
                    classId: "D013964",
                    className: "Thyroid Neoplasms",
                    classType: "DISEASE",
                  },
                  rela: "ci_with",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Single NCT COMPLETED study with Placebo first + active drug second
      if (url.includes("clinicaltrials.gov/api/v2/studies/NCT05382286")) {
        return new Response(
          JSON.stringify({
            protocolSection: {
              identificationModule: {
                nctId: "NCT05382286",
                briefTitle: "Completed Semaglutide Study",
              },
              statusModule: {
                overallStatus: "COMPLETED",
                primaryCompletionDateStruct: { date: "2025-05-01", type: "ACTUAL" },
              },
              designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 500 } },
              armsInterventionsModule: {
                interventions: [
                  { name: "Placebo", type: "DRUG" },
                  { name: "semaglutide", type: "DRUG" },
                ],
              },
            },
            hasResults: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Single NCT not found
      if (url.includes("clinicaltrials.gov/api/v2/studies/NCT99999999")) {
        return new Response("Not Found", { status: 404 });
      }

      // Upstream 500
      if (url.includes("drugdown")) {
        return new Response("Internal Error", { status: 500 });
      }

      return new Response("Not Found", { status: 404 });
    };

    const testApp = new Hono<AppBindings>();
    testApp.get(
      "/v1/bio/drug-trial-brief",
      createDrugTrialBriefHandler({
        cache: new BoundedTtlCache(32),
        fetchImpl: mockFetch,
        nowMs: () => FIXED_NOW,
      })
    );

    const okRes = await testApp.request(
      "http://localhost/v1/bio/drug-trial-brief?drug=semaglutide"
    );
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      drug_normalization: {
        normalized: boolean;
        rxcui: string;
        brand_names: string[];
        atc_classes: Array<{ code: string }>;
        contraindications: string[];
      };
      pipeline_summary: {
        phase3_count: number;
        overdue_unupdated_count: number;
        nearest_primary_completion_date: string;
      };
      upcoming_catalysts: Array<{ nct_id: string; primary_outcome: string }>;
      flags: string[];
    };

    expect(body.drug_normalization.normalized).toBe(true);
    expect(body.drug_normalization.rxcui).toBe("1991302");
    expect(body.drug_normalization.brand_names).toEqual(["Ozempic", "Wegovy"]);
    expect(body.drug_normalization.atc_classes[0]?.code).toBe("A10BJ");
    expect(body.drug_normalization.contraindications).toContain("Thyroid Neoplasms");

    // Upcoming Phase 3 Dec 2026 catalyst ranked #1 ahead of stale 2022 record
    expect(body.upcoming_catalysts[0]?.nct_id).toBe("NCT06000002");
    expect(body.upcoming_catalysts[0]?.primary_outcome).toContain("Week 72");
    expect(body.pipeline_summary.phase3_count).toBe(1);
    expect(body.pipeline_summary.overdue_unupdated_count).toBe(1);
    expect(body.pipeline_summary.nearest_primary_completion_date).toBe("2026-12");
    expect(body.flags).toContain("IMMINENT_PRIMARY_COMPLETION_90D");
    expect(body.flags).toContain("ACTIVE_PHASE3_PROGRAM");
    expect(body.flags).toContain("OVERDUE_REGISTRY_ENTRIES_FILTERED");

    const completedNctRes = await testApp.request(
      "http://localhost/v1/bio/drug-trial-brief?nct=NCT05382286"
    );
    expect(completedNctRes.status).toBe(200);
    const completedBody = (await completedNctRes.json()) as {
      drug_normalization: { preferred_name: string };
      pipeline_summary: {
        total_matching_active_trials: number;
        nearest_primary_completion_date: string | null;
      };
      flags: string[];
    };
    // Skipped Placebo and normalized 'semaglutide'; marked 0 active trials on COMPLETED study
    expect(completedBody.drug_normalization.preferred_name).toBe("semaglutide");
    expect(completedBody.pipeline_summary.total_matching_active_trials).toBe(0);
    expect(completedBody.pipeline_summary.nearest_primary_completion_date).toBeNull();
    expect(completedBody.flags).toContain("ZERO_ACTIVE_MATCHING_TRIALS");

    const nfRes = await testApp.request(
      "http://localhost/v1/bio/drug-trial-brief?nct=NCT99999999"
    );
    expect(nfRes.status).toBe(404);

    const badRes = await testApp.request("http://localhost/v1/bio/drug-trial-brief?nct=BAD");
    expect(badRes.status).toBe(400);

    const errRes = await testApp.request("http://localhost/v1/bio/drug-trial-brief?drug=drugdown");
    expect(errRes.status).toBe(502);
  });
});
