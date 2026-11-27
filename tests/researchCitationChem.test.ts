import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createChemHazardProfileHandler } from "../src/packs/research/routes/chemHazardProfile";
import { createCitationVerifyHandler } from "../src/packs/research/routes/citationVerify";
import {
  computeTitleOverlap,
  matchesRegisteredAuthor,
} from "../src/packs/research/services/citationVerify";
import {
  isValidCasRegistryNumber,
  normalizeDoiInput,
  parseChemHazardInput,
  parseCitationVerifyInput,
} from "../src/packs/research/validation";
import type { AppBindings } from "../src/types";

const FIXED_NOW = Date.parse("2026-11-27T20:00:00.000Z");

describe("science/citation-verify and chem/hazard-profile validation & route handlers", () => {
  it("normalizes DOIs, arXiv IDs, and CAS Registry Number MOD-10 check digits deterministically", () => {
    expect(normalizeDoiInput("https://doi.org/10.1038%2Fs41586-021-03819-2")).toEqual({
      ok: true,
      value: "10.1038/s41586-021-03819-2",
    });
    expect(normalizeDoiInput("arXiv:1706.03762v7")).toEqual({
      ok: true,
      value: "10.48550/arxiv.1706.03762",
    });
    expect(normalizeDoiInput("10.48550/arXiv.1706.03762v7")).toEqual({
      ok: true,
      value: "10.48550/arxiv.1706.03762",
    });
    expect(normalizeDoiInput("https://doi.org/10.48550/arXiv.1706.03762v2")).toEqual({
      ok: true,
      value: "10.48550/arxiv.1706.03762",
    });
    expect(normalizeDoiInput("1706.03762")).toEqual({
      ok: true,
      value: "10.48550/arxiv.1706.03762",
    });
    expect(normalizeDoiInput("10.1038/../../works").ok).toBe(false);
    expect(normalizeDoiInput("not-a-doi").ok).toBe(false);
    expect(parseCitationVerifyInput({}).ok).toBe(false);
    expect(parseCitationVerifyInput({ doi: "10.1038/nature12373", expected_year: "1200" }).ok).toBe(
      false,
    );

    expect(matchesRegisteredAuthor("Sørensen", ["Søren Sørensen"])).toBe(true);
    expect(matchesRegisteredAuthor("Weiß", ["Hans Weiß"])).toBe(true);
    expect(matchesRegisteredAuthor("Łukasiewicz", ["Jan Łukasiewicz"])).toBe(true);
    expect(matchesRegisteredAuthor("张伟", ["张伟"])).toBe(true);
    expect(computeTitleOverlap("人工智能与医疗", "海洋生物多样性")).toBe(0);
    expect(computeTitleOverlap("人工智能与医疗", "人工智能与医疗诊断")).toBe(1);

    expect(isValidCasRegistryNumber("71-43-2")).toBe(true); // Benzene
    expect(isValidCasRegistryNumber("67-64-1")).toBe(true); // Acetone
    expect(isValidCasRegistryNumber("7732-18-5")).toBe(true); // Water
    expect(isValidCasRegistryNumber("71-43-9")).toBe(false); // Bad check digit
    expect(isValidCasRegistryNumber("00-00-0")).toBe(false); // Reject all-zero CAS

    expect(parseChemHazardInput("71-43-2")).toEqual({
      ok: true,
      value: { kind: "cas", rawQuery: "71-43-2", normalizedValue: "71-43-2" },
    });
    expect(parseChemHazardInput("71-43-9").ok).toBe(false);
    expect(parseChemHazardInput("CID:241")).toEqual({
      ok: true,
      value: { kind: "cid", rawQuery: "CID:241", normalizedValue: "241" },
    });
    expect(parseChemHazardInput("UHOVQNZJYSORNB-UHFFFAOYSA-N")).toEqual({
      ok: true,
      value: {
        kind: "inchikey",
        rawQuery: "UHOVQNZJYSORNB-UHFFFAOYSA-N",
        normalizedValue: "UHOVQNZJYSORNB-UHFFFAOYSA-N",
      },
    });
    expect(parseChemHazardInput("bad/slash/path").ok).toBe(false);
  });

  it("verifies Crossref papers, Retraction Watch updated-by notices, arXiv DataCite preprints, swapped-DOI mismatches, 404 hallucinations, and 502 fail-closed errors", async () => {
    const seenUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      seenUrls.push(url);

      // 1. AlphaFold DOI on Crossref
      if (url.includes("api.crossref.org/works/10.1038%2Fs41586-021-03819-2")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            message: {
              DOI: "10.1038/s41586-021-03819-2",
              title: ["Highly accurate protein structure prediction with AlphaFold"],
              type: "journal-article",
              "container-title": ["Nature"],
              publisher: "Springer Science and Business Media LLC",
              published: { "date-parts": [[2021, 7, 15]] },
              author: [
                { given: "John", family: "Jumper" },
                { given: "Richard", family: "Evans" },
                { given: "Alexander", family: "Pritzel" },
                { given: "Tim", family: "Green" },
                { given: "Michael", family: "Figurnov" },
                { given: "Olaf", family: "Ronneberger" },
                { given: "Kathryn", family: "Tunyasuvunakool" },
                { given: "Russ", family: " Bates" },
                { given: "William", family: "Elizabeth" },
                { given: "Karl", family: "Müller" },
                { given: "Demis", family: "Hassabis" }, // 11th author (>8 display slice)
              ],
              "is-referenced-by-count": 47809,
              license: [{ URL: "https://creativecommons.org/licenses/by/4.0" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // 2. Retracted paper with embedded Retraction Watch updated-by notice
      if (url.includes("api.crossref.org/works/10.1016%2Fs0140-6736(97)11096-0")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            message: {
              DOI: "10.1016/s0140-6736(97)11096-0",
              title: ["Ileal-lymphoid-nodular hyperplasia in children"],
              type: "journal-article",
              "container-title": ["The Lancet"],
              published: { "date-parts": [[1998, 2, 28]] },
              author: [{ given: "AJ", family: "Wakefield" }],
              "updated-by": [
                {
                  DOI: "10.1016/s0140-6736(10)60175-4",
                  type: "retraction",
                  label: "Retraction",
                  source: "retraction-watch",
                  updated: { "date-parts": [[2010, 2, 6]] },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // 3. arXiv preprint routed directly to DataCite first
      if (url.includes("api.datacite.org/dois/10.48550%2Farxiv.1706.03762")) {
        return new Response(
          JSON.stringify({
            data: {
              attributes: {
                doi: "10.48550/arxiv.1706.03762",
                titles: [{ title: "Attention Is All You Need" }],
                creators: [{ givenName: "Ashish", familyName: "Vaswani" }],
                publicationYear: 2017,
                publisher: "arXiv",
                types: { resourceTypeGeneral: "Preprint", resourceType: "Article" },
                citationCount: 84,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // 4. Hallucinated DOI returns 404 on BOTH Crossref and DataCite
      if (
        url.includes("10.1038%2Fs41586-999-99999-9") &&
        (url.includes("api.crossref.org") || url.includes("api.datacite.org"))
      ) {
        return new Response("Not Found", { status: 404 });
      }

      // 5. Upstream 429 on Crossref must fail closed 502 (never report exists: false)
      if (url.includes("10.1038%2Fratelimited-999")) {
        return new Response("Too Many Requests", { status: 429 });
      }

      // 6. Bibliographic query search
      if (url.includes("query.bibliographic=")) {
        return new Response(
          JSON.stringify({
            message: {
              items: [
                {
                  DOI: "10.1038/s41586-021-03819-2",
                  title: ["Highly accurate protein structure prediction with AlphaFold"],
                  type: "journal-article",
                  published: { "date-parts": [[2021, 7, 15]] },
                  author: [{ given: "John", family: "Jumper" }],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("api.datacite.org/dois?query=")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Unexpected URL", { status: 500 });
    };

    const testApp = new Hono<AppBindings>();
    testApp.get(
      "/v1/science/citation-verify",
      createCitationVerifyHandler({
        cache: new BoundedTtlCache(32),
        fetchImpl: mockFetch,
        nowMs: () => FIXED_NOW,
      }),
    );

    // Happy path + accent-folded author check
    const okRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2&expected_author=Muller&expected_year=2021",
    );
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as {
      exists: boolean;
      verdict: string;
      metadata_check: { author_match: boolean; year_match: boolean };
      work: { citation_count: number; registry: string };
    };
    expect(okBody.exists).toBe(true);
    expect(okBody.verdict).toBe("VERIFIED");
    expect(okBody.metadata_check.author_match).toBe(true);
    expect(okBody.metadata_check.year_match).toBe(true);
    expect(okBody.work.citation_count).toBe(47809);
    expect(okBody.work.registry).toBe("crossref");

    // Senior/PI >8th author ('Hassabis, D.') & 'Jumper et al.' match, while short 'Li' does NOT false-match 'William'/'Elizabeth'
    const seniorRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2&expected_author=Hassabis,+D.",
    );
    expect(((await seniorRes.json()) as { verdict: string }).verdict).toBe("VERIFIED");

    const etAlRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2&expected_author=Jumper+et+al.",
    );
    expect(((await etAlRes.json()) as { verdict: string }).verdict).toBe("VERIFIED");

    const shortLiRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2&expected_author=Li",
    );
    expect(((await shortLiRes.json()) as { verdict: string }).verdict).toBe("METADATA_MISMATCH");

    // Swapped-DOI hallucination detection
    const swapRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2&expected_title=Quantum+gravity+in+11+dimensions",
    );
    expect(swapRes.status).toBe(200);
    const swapBody = (await swapRes.json()) as { verdict: string; flags: string[] };
    expect(swapBody.verdict).toBe("METADATA_MISMATCH");
    expect(swapBody.flags).toContain("TITLE_MISMATCH_SWAPPED_DOI");

    // Retraction Watch updated-by detection
    const retRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1016/S0140-6736(97)11096-0",
    );
    expect(retRes.status).toBe(200);
    const retBody = (await retRes.json()) as {
      verdict: string;
      integrity: { is_retracted: boolean; updates: Array<{ source: string }> };
      flags: string[];
    };
    expect(retBody.verdict).toBe("RETRACTED");
    expect(retBody.integrity.is_retracted).toBe(true);
    expect(retBody.integrity.updates[0]?.source).toBe("retraction-watch");
    expect(retBody.flags).toContain("RETRACTION_WATCH_RECORD");

    // arXiv DataCite direct prefix routing (zero Crossref subrequest wasted)
    seenUrls.length = 0;
    const arxivRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=arXiv:1706.03762",
    );
    expect(arxivRes.status).toBe(200);
    const arxivBody = (await arxivRes.json()) as {
      verdict: string;
      work: { registry: string; title: string };
      flags: string[];
    };
    expect(arxivBody.verdict).toBe("VERIFIED");
    expect(arxivBody.work.registry).toBe("datacite");
    expect(arxivBody.work.title).toBe("Attention Is All You Need");
    expect(arxivBody.flags).toContain("PREPRINT_NOT_PEER_REVIEWED");
    expect(seenUrls.every((u) => u.includes("datacite.org"))).toBe(true);

    // Authoritative 404 across both registries -> 200 exists: false
    const fakeRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/s41586-999-99999-9",
    );
    expect(fakeRes.status).toBe(200);
    const fakeBody = (await fakeRes.json()) as {
      exists: boolean;
      verdict: string;
      work: null;
      flags: string[];
    };
    expect(fakeBody.exists).toBe(false);
    expect(fakeBody.verdict).toBe("NOT_FOUND");
    expect(fakeBody.work).toBeNull();
    expect(fakeBody.flags).toContain("UNREGISTERED_OR_HALLUCINATED_DOI");

    // Bibliographic query mode
    const qRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?query=Highly+accurate+protein+structure+prediction+with+AlphaFold+Jumper+2021",
    );
    expect(qRes.status).toBe(200);
    expect(((await qRes.json()) as { verdict: string }).verdict).toBe("VERIFIED");

    // 400 validation failure
    const badRes = await testApp.request("http://localhost/v1/science/citation-verify?doi=bogus");
    expect(badRes.status).toBe(400);

    // 502 fail-closed on upstream 429
    const errRes = await testApp.request(
      "http://localhost/v1/science/citation-verify?doi=10.1038/ratelimited-999",
    );
    expect(errRes.status).toBe(502);
  });

  it("compresses NIH PubChem properties, GHS hazards, NFPA 704, non-hazardous compounds, 404s, and 502 fail-closed errors", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("/compound/name/71-43-2/property/")) {
        return new Response(
          JSON.stringify({
            PropertyTable: {
              Properties: [
                {
                  CID: 241,
                  Title: "Benzene",
                  IUPACName: "benzene",
                  MolecularFormula: "C6H6",
                  MolecularWeight: "78.11",
                  ConnectivitySMILES: "C1=CC=CC=C1",
                  InChIKey: "UHOVQNZJYSORNB-UHFFFAOYSA-N",
                  XLogP: 2.1,
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/compound/cid/241/synonyms/JSON")) {
        return new Response(
          JSON.stringify({
            InformationList: {
              Information: [{ Synonym: ["Benzene", "71-43-2", "200-753-7", "benzol"] }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/compound/241/JSON?heading=GHS+Classification")) {
        return new Response(
          JSON.stringify({
            Record: {
              Section: [
                {
                  Information: [
                    {
                      Name: "Pictogram(s)",
                      Value: {
                        StringWithMarkup: [
                          {
                            String: " ",
                            Markup: [
                              {
                                URL: "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS02.svg",
                                Extra: "Flammable",
                              },
                              {
                                URL: "https://pubchem.ncbi.nlm.nih.gov/images/ghs/GHS08.svg",
                                Extra: "Health Hazard",
                              },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      Name: "Signal",
                      Value: { StringWithMarkup: [{ String: "Danger" }] },
                    },
                    {
                      Name: "GHS Hazard Statements",
                      Value: {
                        StringWithMarkup: [
                          {
                            String:
                              "H225 (99.7%): Highly Flammable liquid and vapor [Danger Flammable liquids]",
                          },
                          {
                            String: "H350: May cause cancer [Danger Carcinogenicity]",
                          },
                          {
                            String:
                              "H300 + H310 (98%): Fatal if swallowed or in contact with skin [Danger Acute toxicity]",
                          },
                        ],
                      },
                    },
                    {
                      Name: "Precautionary Statement Codes",
                      Value: {
                        StringWithMarkup: [{ String: "P203, P210, and P280" }],
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/compound/241/JSON?heading=NFPA+Hazard+Classification")) {
        return new Response(
          JSON.stringify({
            Record: {
              Section: [
                {
                  Information: [
                    {
                      Name: "NFPA 704 Diamond",
                      Value: {
                        StringWithMarkup: [{ String: " ", Markup: [{ Extra: "2-3-0" }] }],
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Water (non-hazardous majority ECHA note)
      if (url.includes("/compound/name/water/property/")) {
        return new Response(
          JSON.stringify({
            PropertyTable: {
              Properties: [
                {
                  CID: 962,
                  Title: "Water",
                  MolecularFormula: "H2O",
                  MolecularWeight: "18.015",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/compound/962/JSON?heading=GHS+Classification")) {
        return new Response(
          JSON.stringify({
            Record: {
              Section: [
                {
                  Information: [
                    {
                      Name: "Note",
                      Value: {
                        StringWithMarkup: [
                          {
                            String:
                              "This chemical does not meet GHS hazard criteria for 99.5% of all reports.",
                          },
                        ],
                      },
                    },
                    {
                      Name: "GHS Hazard Statements",
                      Value: { StringWithMarkup: [{ String: "Not Classified" }] },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/cid/962/") || url.includes("/compound/962/")) {
        return new Response("Not Found", { status: 404 });
      }

      if (url.includes("/compound/name/unknownxyz/")) {
        return new Response("Not Found", { status: 404 });
      }

      if (url.includes("/compound/name/serverdown/")) {
        return new Response("Service Unavailable", { status: 503 });
      }

      return new Response("Not Found", { status: 404 });
    };

    const testApp = new Hono<AppBindings>();
    testApp.get(
      "/v1/chem/hazard-profile",
      createChemHazardProfileHandler({
        cache: new BoundedTtlCache(32),
        fetchImpl: mockFetch,
        nowMs: () => FIXED_NOW,
      }),
    );

    const benzRes = await testApp.request("http://localhost/v1/chem/hazard-profile?query=71-43-2");
    expect(benzRes.status).toBe(200);
    const benzBody = (await benzRes.json()) as {
      compound: { cid: number; cas_rn: string; ec_number: string; smiles: string };
      hazard_tier: string;
      ghs: { classified: boolean; signal_word: string; hazard_statements: Array<{ code: string }> };
      nfpa_704: { health: number; flammability: number; instability: number };
      regulatory_flags: { cmr_carcinogen_mutagen_reprotoxic: boolean; flammable: boolean };
    };
    expect(benzBody.compound.cid).toBe(241);
    expect(benzBody.compound.cas_rn).toBe("71-43-2");
    expect(benzBody.compound.ec_number).toBe("200-753-7");
    expect(benzBody.compound.smiles).toBe("C1=CC=CC=C1");
    expect(benzBody.hazard_tier).toBe("EXTREME");
    expect(benzBody.ghs.signal_word).toBe("Danger");
    expect(benzBody.ghs.hazard_statements.map((h) => h.code)).toEqual([
      "H225",
      "H300+H310",
      "H350",
    ]);
    expect(benzBody.nfpa_704).toEqual({
      health: 2,
      flammability: 3,
      instability: 0,
      special: null,
    });
    expect(benzBody.regulatory_flags.cmr_carcinogen_mutagen_reprotoxic).toBe(true);
    expect(benzBody.regulatory_flags.flammable).toBe(true);

    const waterRes = await testApp.request("http://localhost/v1/chem/hazard-profile?query=water");
    expect(waterRes.status).toBe(200);
    const waterBody = (await waterRes.json()) as {
      hazard_tier: string;
      ghs: { classified: boolean };
      flags: string[];
    };
    expect(waterBody.hazard_tier).toBe("LOW");
    expect(waterBody.ghs.classified).toBe(false);
    expect(waterBody.flags).toContain("GHS_NOT_CLASSIFIED_MAJORITY");

    const badCas = await testApp.request("http://localhost/v1/chem/hazard-profile?query=71-43-9");
    expect(badCas.status).toBe(400);

    const notFound = await testApp.request(
      "http://localhost/v1/chem/hazard-profile?query=unknownxyz",
    );
    expect(notFound.status).toBe(404);

    const upstreamErr = await testApp.request(
      "http://localhost/v1/chem/hazard-profile?query=serverdown",
    );
    expect(upstreamErr.status).toBe(502);
  });
});
