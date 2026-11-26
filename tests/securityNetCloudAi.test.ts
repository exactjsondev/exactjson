import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { BoundedTtlCache } from "../src/lib/cache";
import { createCensorshipCheckHandler } from "../src/packs/security/routes/censorshipCheck";
import { createCloudStatusHandler } from "../src/packs/security/routes/cloudStatus";
import { createDomainTrustHandler } from "../src/packs/security/routes/domainTrust";
import { createModelAuditHandler } from "../src/packs/security/routes/modelAudit";
import type { AppBindings } from "../src/types";

describe("security pack — domain-trust, cloud-status, model-audit, and censorship-check", () => {
  it("audits domain trust (1.1.1.1 DoH, 1.1.1.2 malware sinkhole, IANA RDAP age, .ai missing RDAP, 404 NXDOMAIN, and fail-closed 502)", async () => {
    const dohRdapFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));

      // IANA RDAP bootstrap (has .com, intentionally omits .ai)
      if (url.hostname === "data.iana.org" && url.pathname === "/rdap/dns.json") {
        return new Response(
          JSON.stringify({
            services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]]],
          }),
          { status: 200 }
        );
      }

      // Verisign RDAP for stripe.com and fresh-phish.com
      if (url.hostname === "rdap.verisign.com") {
        if (url.pathname.endsWith("/domain/stripe.com")) {
          return new Response(
            JSON.stringify({
              ldhName: "STRIPE.COM",
              status: ["client transfer prohibited", "server delete prohibited"],
              events: [
                { eventAction: "registration", eventDate: "1995-09-12T04:00:00Z" },
                { eventAction: "expiration", eventDate: "2035-09-11T04:00:00Z" },
              ],
              entities: [
                {
                  roles: ["registrar"],
                  vcardArray: [
                    "vcard",
                    [
                      ["version", {}, "text", "4.0"],
                      ["fn", {}, "text", "MarkMonitor Inc."],
                    ],
                  ],
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.pathname.endsWith("/domain/bad-malware.com")) {
          return new Response(
            JSON.stringify({
              ldhName: "BAD-MALWARE.COM",
              status: [],
              events: [{ eventAction: "registration", eventDate: "2026-11-20T00:00:00Z" }],
            }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      }

      // Cloudflare 1.1.1.2 Security DoH
      if (url.hostname === "security.cloudflare-dns.com") {
        const name = url.searchParams.get("name");
        if (name === "bad-malware.com") {
          return new Response(
            JSON.stringify({
              Status: 0,
              AD: false,
              Comment: ["EDE 16 (Censored): Blocked by Malware filter"],
              Answer: [{ name: "bad-malware.com", type: 1, TTL: 60, data: "0.0.0.0" }],
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            Status: 0,
            AD: false,
            Answer: [{ name, type: 1, TTL: 300, data: "104.18.10.12" }],
          }),
          { status: 200 }
        );
      }

      // Cloudflare 1.1.1.1 Standard DoH
      if (url.hostname === "cloudflare-dns.com") {
        const name = url.searchParams.get("name") ?? "";
        const qtype = url.searchParams.get("type") ?? "A";

        if (name === "nxdomain-ghost.com" || name === "_dmarc.nxdomain-ghost.com") {
          return new Response(JSON.stringify({ Status: 3, AD: false }), { status: 200 });
        }

        if (name === "stripe.com") {
          if (qtype === "A") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: true,
                Answer: [{ name: "stripe.com", type: 1, TTL: 300, data: "34.111.10.1" }],
              }),
              { status: 200 }
            );
          }
          if (qtype === "AAAA") {
            return new Response(JSON.stringify({ Status: 0, AD: true, Answer: [] }), { status: 200 });
          }
          if (qtype === "MX") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: true,
                Answer: [{ name: "stripe.com", type: 15, TTL: 300, data: "1 aspmx.l.google.com." }],
              }),
              { status: 200 }
            );
          }
          if (qtype === "TXT") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: true,
                Answer: [
                  {
                    name: "stripe.com",
                    type: 16,
                    TTL: 300,
                    data: '"v=spf1 include:_spf.stripe.com -all"',
                  },
                ],
              }),
              { status: 200 }
            );
          }
        }

        if (name === "_dmarc.stripe.com" && qtype === "TXT") {
          return new Response(
            JSON.stringify({
              Status: 0,
              AD: true,
              Answer: [
                {
                  name: "_dmarc.stripe.com",
                  type: 16,
                  TTL: 300,
                  data: '"v=DMARC1; p=reject; rua=mailto:dmarc@stripe.com"',
                },
              ],
            }),
            { status: 200 }
          );
        }

        if (name === "perplexity.ai" || name === "_dmarc.perplexity.ai") {
          if (name === "perplexity.ai" && qtype === "A") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: false,
                Answer: [{ name: "perplexity.ai", type: 1, TTL: 300, data: "104.18.26.48" }],
              }),
              { status: 200 }
            );
          }
          if (name === "perplexity.ai" && qtype === "TXT") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: false,
                Answer: [{ name: "perplexity.ai", type: 16, TTL: 300, data: '"v=spf1 ~all"' }],
              }),
              { status: 200 }
            );
          }
          if (name === "_dmarc.perplexity.ai" && qtype === "TXT") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: false,
                Answer: [{ name: "_dmarc.perplexity.ai", type: 16, TTL: 300, data: '"v=DMARC1; p=quarantine"' }],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ Status: 0, AD: false, Answer: [] }), { status: 200 });
        }

        if (name === "bad-malware.com" || name === "_dmarc.bad-malware.com") {
          if (name === "bad-malware.com" && qtype === "A") {
            return new Response(
              JSON.stringify({
                Status: 0,
                AD: false,
                Answer: [{ name: "bad-malware.com", type: 1, TTL: 60, data: "198.51.100.99" }],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ Status: 0, AD: false, Answer: [] }), { status: 200 });
        }
      }

      return new Response("err", { status: 500 });
    };

    const app = new Hono<AppBindings>();
    const cache = new BoundedTtlCache(50);
    app.get(
      "/v1/net/domain-trust",
      createDomainTrustHandler({
        cache,
        rdapBootstrapCache: cache,
        fetchImpl: dohRdapFetch,
        nowMs: () => Date.parse("2026-11-26T00:00:00Z"),
      })
    );

    // 400 validation (missing, reserved .local, URL with path, raw IP)
    expect((await app.request("http://localhost/v1/net/domain-trust")).status).toBe(400);
    expect(
      (await app.request("http://localhost/v1/net/domain-trust?domain=printer.local")).status
    ).toBe(400);
    expect(
      (await app.request("http://localhost/v1/net/domain-trust?domain=https://stripe.com/login"))
        .status
    ).toBe(400);
    expect(
      (await app.request("http://localhost/v1/net/domain-trust?domain=127.0.0.1")).status
    ).toBe(400);
    expect(
      (await app.request("http://localhost/v1/net/domain-trust?domain=co.uk")).status
    ).toBe(400);

    // 404 NXDOMAIN (unsettled)
    expect(
      (await app.request("http://localhost/v1/net/domain-trust?domain=nxdomain-ghost.com")).status
    ).toBe(404);

    // 200 HIGH trust domain (stripe.com)
    const stripeRes = await app.request("http://localhost/v1/net/domain-trust?domain=stripe.com");
    expect(stripeRes.status).toBe(200);
    const stripeJson = (await stripeRes.json()) as {
      trust_tier: string;
      risk_score: number;
      security: {
        malware_sinkholed: boolean;
        dnssec_validated: boolean;
        spf_all_qualifier: string;
        dmarc_policy: string;
      };
      registration: {
        rdap_supported: boolean;
        domain_age_days: number;
        registrar: string;
        transfer_locked: boolean;
      };
    };
    expect(stripeJson.trust_tier).toBe("HIGH");
    expect(stripeJson.risk_score).toBeLessThan(15);
    expect(stripeJson.security.malware_sinkholed).toBe(false);
    expect(stripeJson.security.dnssec_validated).toBe(true);
    expect(stripeJson.security.spf_all_qualifier).toBe("-all");
    expect(stripeJson.security.dmarc_policy).toBe("reject");
    expect(stripeJson.registration.rdap_supported).toBe(true);
    expect(stripeJson.registration.domain_age_days).toBeGreaterThan(10000);
    expect(stripeJson.registration.registrar).toBe("MarkMonitor Inc.");
    expect(stripeJson.registration.transfer_locked).toBe(true);

    // 200 .ai domain missing from IANA RDAP -> caps trust_tier at MODERATE and flags RDAP_UNAVAILABLE_FOR_TLD
    const aiRes = await app.request("http://localhost/v1/net/domain-trust?domain=perplexity.ai");
    expect(aiRes.status).toBe(200);
    const aiJson = (await aiRes.json()) as {
      trust_tier: string;
      flags: string[];
      registration: { rdap_supported: boolean; domain_age_days: number | null };
    };
    expect(aiJson.registration.rdap_supported).toBe(false);
    expect(aiJson.registration.domain_age_days).toBeNull();
    expect(aiJson.flags).toContain("RDAP_UNAVAILABLE_FOR_TLD");
    expect(aiJson.trust_tier).toBe("MODERATE");

    // 200 Malware sinkholed domain -> CRITICAL
    const badRes = await app.request("http://localhost/v1/net/domain-trust?domain=bad-malware.com");
    expect(badRes.status).toBe(200);
    const badJson = (await badRes.json()) as {
      trust_tier: string;
      risk_score: number;
      flags: string[];
      security: { malware_sinkholed: boolean };
    };
    expect(badJson.trust_tier).toBe("CRITICAL");
    expect(badJson.risk_score).toBeGreaterThanOrEqual(85);
    expect(badJson.security.malware_sinkholed).toBe(true);
    expect(badJson.flags).toContain("MALWARE_SINKHOLED_1_1_1_2");

    // 502 fail-closed if 1.1.1.2 Security DoH fails
    const downApp = new Hono<AppBindings>();
    downApp.get(
      "/v1/net/domain-trust",
      createDomainTrustHandler({
        cache: new BoundedTtlCache(10),
        rdapBootstrapCache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          if (String(input).includes("security.cloudflare-dns.com")) {
            return new Response("down", { status: 503 });
          }
          return dohRdapFetch(input);
        },
      })
    );
    expect(
      (await downApp.request("http://localhost/v1/net/domain-trust?domain=stripe.com")).status
    ).toBe(502);

    // 502 fail-closed if 1.1.1.2 Security DoH returns HTTP 200 with Status: 2 (SERVFAIL)
    const secServfailApp = new Hono<AppBindings>();
    secServfailApp.get(
      "/v1/net/domain-trust",
      createDomainTrustHandler({
        cache: new BoundedTtlCache(10),
        rdapBootstrapCache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          if (String(input).includes("security.cloudflare-dns.com")) {
            return new Response(JSON.stringify({ Status: 2, AD: false }), { status: 200 });
          }
          return dohRdapFetch(input);
        },
      })
    );
    expect(
      (await secServfailApp.request("http://localhost/v1/net/domain-trust?domain=stripe.com"))
        .status
    ).toBe(502);

    // EDE 9 (DNSKEY Missing) on 1.1.1.1 flags DNSSEC_BOGUS -> CRITICAL
    const dnssecBogusApp = new Hono<AppBindings>();
    dnssecBogusApp.get(
      "/v1/net/domain-trust",
      createDomainTrustHandler({
        cache: new BoundedTtlCache(10),
        rdapBootstrapCache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          const u = new URL(String(input));
          if (
            u.hostname === "cloudflare-dns.com" &&
            u.searchParams.get("name") === "stripe.com" &&
            u.searchParams.get("type") === "A"
          ) {
            return new Response(
              JSON.stringify({ Status: 2, AD: false, Comment: ["EDE 9 (DNSKEY Missing)"] }),
              { status: 200 }
            );
          }
          return dohRdapFetch(input);
        },
      })
    );
    const bogusRes = await dnssecBogusApp.request(
      "http://localhost/v1/net/domain-trust?domain=stripe.com"
    );
    expect(bogusRes.status).toBe(200);
    const bogusJson = (await bogusRes.json()) as { trust_tier: string; flags: string[] };
    expect(bogusJson.trust_tier).toBe("CRITICAL");
    expect(bogusJson.flags).toContain("DNSSEC_BOGUS");
  });

  it("checks live cloud status across 6 Statuspage providers (including Cloudflare split endpoints and OpenAI omitted incidents) with quorum 502 guard", async () => {
    const statusFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("cloudflarestatus.com/api/v2/status.json")) {
        return new Response(
          JSON.stringify({
            page: { updated_at: "2026-11-26T22:00:00Z" },
            status: { indicator: "minor", description: "Minor Service Outage" },
          }),
          { status: 200 }
        );
      }
      if (url.includes("cloudflarestatus.com/api/v2/incidents/unresolved.json")) {
        return new Response(
          JSON.stringify({
            incidents: [
              {
                id: "inc-cf-1",
                name: "Elevated Workers KV Latency",
                status: "investigating",
                impact: "minor",
                updated_at: "2026-11-26T22:05:00Z",
                components: [{ name: "Workers KV", status: "degraded_performance" }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("status.openai.com/api/v2/summary.json")) {
        // OpenAI omits `incidents` key when empty
        return new Response(
          JSON.stringify({
            page: { updated_at: "2026-11-26T22:00:00Z" },
            status: { indicator: "none", description: "All Systems Operational" },
            components: [{ name: "API", status: "operational" }],
          }),
          { status: 200 }
        );
      }
      if (
        url.includes("githubstatus.com") ||
        url.includes("status.anthropic.com") ||
        url.includes("vercel-status.com") ||
        url.includes("status.npmjs.org")
      ) {
        return new Response(
          JSON.stringify({
            page: { updated_at: "2026-11-26T22:00:00Z" },
            status: { indicator: "none", description: "All Systems Operational" },
            components: [{ name: "Core API", status: "operational" }],
            incidents: [],
          }),
          { status: 200 }
        );
      }
      return new Response("err", { status: 503 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/ops/cloud-status",
      createCloudStatusHandler({ cache: new BoundedTtlCache(20), fetchImpl: statusFetch })
    );

    expect(
      (await app.request("http://localhost/v1/ops/cloud-status?providers=aws")).status
    ).toBe(400);

    // Subset filter (github,openai -> all operational -> deploy_safe: true)
    const okSubset = await app.request(
      "http://localhost/v1/ops/cloud-status?providers=github,openai"
    );
    expect(okSubset.status).toBe(200);
    const okJson = (await okSubset.json()) as {
      overall_regime: string;
      deploy_safe: boolean;
      queried_count: number;
    };
    expect(okJson.overall_regime).toBe("OPERATIONAL");
    expect(okJson.deploy_safe).toBe(true);
    expect(okJson.queried_count).toBe(2);

    // 3-provider filter (github,openai,anthropic -> must NOT fail quorum!)
    const threeSubset = await app.request(
      "http://localhost/v1/ops/cloud-status?providers=github,openai,anthropic"
    );
    expect(threeSubset.status).toBe(200);
    expect(((await threeSubset.json()) as { queried_count: number }).queried_count).toBe(3);

    // Full 6-provider check catches Cloudflare minor incident -> DEGRADED & deploy_safe: false
    const allRes = await app.request("http://localhost/v1/ops/cloud-status");
    expect(allRes.status).toBe(200);
    const allJson = (await allRes.json()) as {
      overall_regime: string;
      deploy_safe: boolean;
      degraded_count: number;
      active_incidents_count: number;
    };
    expect(allJson.overall_regime).toBe("DEGRADED");
    expect(allJson.deploy_safe).toBe(false);
    expect(allJson.degraded_count).toBe(1);
    expect(allJson.active_incidents_count).toBe(1);

    // Single provider failure -> fail-closed 502
    const brokenApp = new Hono<AppBindings>();
    brokenApp.get(
      "/v1/ops/cloud-status",
      createCloudStatusHandler({
        cache: new BoundedTtlCache(10),
        fetchImpl: async () => new Response("down", { status: 503 }),
      })
    );
    expect(
      (await brokenApp.request("http://localhost/v1/ops/cloud-status?providers=github")).status
    ).toBe(502);
    expect((await brokenApp.request("http://localhost/v1/ops/cloud-status")).status).toBe(502);
  });

  it("audits Hugging Face models for commercial licensing, safetensors vs pickle code-exec risk, VRAM sizing, 404/401, and 502", async () => {
    const hfFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/models/private-org/secret-model")) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (url.endsWith("/api/models/Qwen/Qwen2.5-7B-Instruct")) {
        return new Response(
          JSON.stringify({
            id: "Qwen/Qwen2.5-7B-Instruct",
            author: "Qwen",
            pipeline_tag: "text-generation",
            library_name: "transformers",
            gated: false,
            downloads: 4125000,
            likes: 1820,
            cardData: { license: "apache-2.0" },
            tags: ["transformers", "safetensors", "license:apache-2.0"],
            siblings: [
              { rfilename: "config.json" },
              { rfilename: "model-00001-of-00004.safetensors" },
            ],
            safetensors: { total: 7615616512 },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/models/risky-lab/legacy-pickle-llm")) {
        return new Response(
          JSON.stringify({
            id: "risky-lab/legacy-pickle-llm",
            author: "risky-lab",
            pipeline_tag: "text-generation",
            library_name: "transformers",
            gated: "manual",
            downloads: 120,
            likes: 3,
            cardData: { license: "cc-by-nc-4.0" },
            tags: ["license:cc-by-nc-4.0"],
            siblings: [{ rfilename: "pytorch_model.bin" }, { rfilename: "weights.pkl" }],
          }),
          { status: 200 }
        );
      }
      return new Response("err", { status: 503 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/ai/model-audit",
      createModelAuditHandler({ cache: new BoundedTtlCache(20), fetchImpl: hfFetch })
    );

    expect((await app.request("http://localhost/v1/ai/model-audit")).status).toBe(400);
    expect(
      (await app.request("http://localhost/v1/ai/model-audit?model=../etc/passwd")).status
    ).toBe(400);
    expect(
      (await app.request("http://localhost/v1/ai/model-audit?model=private-org/secret-model")).status
    ).toBe(404);
    expect(
      (await app.request("http://localhost/v1/ai/model-audit?model=org/upstream-503")).status
    ).toBe(502);

    // Safe commercial Apache-2.0 + safetensors model
    const safeRes = await app.request(
      "http://localhost/v1/ai/model-audit?model=Qwen/Qwen2.5-7B-Instruct"
    );
    expect(safeRes.status).toBe(200);
    const safeJson = (await safeRes.json()) as {
      deployment_ready: boolean;
      licensing: { commercial_status: string; gated: boolean | string };
      weights_security: { format_verdict: string; has_pickle_weights: boolean };
      sizing: { estimated_vram_gb: { fp16_bf16: number; int8: number; int4: number } };
    };
    expect(safeJson.deployment_ready).toBe(true);
    expect(safeJson.licensing.commercial_status).toBe("COMMERCIAL_SAFE");
    expect(safeJson.weights_security.format_verdict).toBe("SAFE_SAFETENSORS");
    expect(safeJson.weights_security.has_pickle_weights).toBe(false);
    expect(safeJson.sizing.estimated_vram_gb.fp16_bf16).toBe(18);
    expect(safeJson.sizing.estimated_vram_gb.int8).toBe(9);
    expect(safeJson.sizing.estimated_vram_gb.int4).toBe(4.5);

    // Unsafe pickle + CC-BY-NC + gated model
    const riskyRes = await app.request(
      "http://localhost/v1/ai/model-audit?model=risky-lab/legacy-pickle-llm"
    );
    expect(riskyRes.status).toBe(200);
    const riskyJson = (await riskyRes.json()) as {
      deployment_ready: boolean;
      flags: string[];
      licensing: { commercial_status: string; gated: boolean | string };
      weights_security: { has_pickle_weights: boolean; format_verdict: string };
    };
    expect(riskyJson.deployment_ready).toBe(false);
    expect(riskyJson.licensing.commercial_status).toBe("NON_COMMERCIAL");
    expect(riskyJson.licensing.gated).toBe("manual");
    expect(riskyJson.weights_security.has_pickle_weights).toBe(true);
    expect(riskyJson.weights_security.format_verdict).toBe("UNSAFE_PICKLE_ONLY");
    expect(riskyJson.flags).toContain("PICKLE_CODE_EXEC_RISK");
    expect(riskyJson.flags).toContain("NON_COMMERCIAL_LICENSE");
    expect(riskyJson.flags).toContain("GATED_MODEL");
  });

  it("checks country-level censorship via OONI web_connectivity + global Cloudflare DoH with country alias normalization and fail-closed 502", async () => {
    const ooniFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "cloudflare-dns.com") {
        const domain = url.searchParams.get("name");
        const qtype = url.searchParams.get("type");
        if (domain === "dead-nxdomain.org") {
          return new Response(JSON.stringify({ Status: 3, Answer: [] }), { status: 200 });
        }
        if (qtype === "A") {
          return new Response(
            JSON.stringify({
              Status: 0,
              Answer: [
                { name: domain, type: 1, data: "149.154.167.99" },
                { name: domain, type: 1, data: "149.154.167.100" },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
      }
      if (url.hostname === "api.ooni.io") {
        const cc = url.searchParams.get("probe_cc");
        const domain = url.searchParams.get("domain");
        if (domain === "dead-nxdomain.org") {
          return new Response(
            JSON.stringify({
              result: {
                measurement_count: 0,
                confirmed_count: 0,
                anomaly_count: 0,
                ok_count: 0,
                failure_count: 0,
              },
            }),
            { status: 200 }
          );
        }
        if (cc === "IR" && domain === "telegram.org") {
          return new Response(
            JSON.stringify({
              result: {
                measurement_count: 80,
                confirmed_count: 40,
                anomaly_count: 20,
                ok_count: 18,
                failure_count: 2,
              },
            }),
            { status: 200 }
          );
        }
        if (cc === "DE" && domain === "telegram.org") {
          return new Response(
            JSON.stringify({
              result: {
                measurement_count: 50,
                confirmed_count: 0,
                anomaly_count: 1,
                ok_count: 49,
                failure_count: 0,
              },
            }),
            { status: 200 }
          );
        }
        if (cc === "IS" && domain === "telegram.org") {
          return new Response(
            JSON.stringify({
              result: {
                measurement_count: 2,
                confirmed_count: 0,
                anomaly_count: 0,
                ok_count: 2,
                failure_count: 0,
              },
            }),
            { status: 200 }
          );
        }
      }
      return new Response("err", { status: 503 });
    };

    const app = new Hono<AppBindings>();
    app.get(
      "/v1/net/censorship-check",
      createCensorshipCheckHandler({
        cache: new BoundedTtlCache(20),
        fetchImpl: ooniFetch,
        nowMs: () => Date.parse("2026-11-26T12:00:00Z"),
      })
    );

    // 400 validation
    expect(
      (await app.request("http://localhost/v1/net/censorship-check?domain=telegram.org")).status
    ).toBe(400);
    expect(
      (
        await app.request(
          "http://localhost/v1/net/censorship-check?domain=telegram.org&country=IR&days=30"
        )
      ).status
    ).toBe(400);
    expect(
      (
        await app.request(
          "http://localhost/v1/net/censorship-check?domain=telegram.org&country=XX"
        )
      ).status
    ).toBe(400);

    // 200 CONFIRMED_BLOCKED with country name alias 'iran' -> 'IR'
    const irRes = await app.request(
      "http://localhost/v1/net/censorship-check?domain=telegram.org&country=iran&days=7"
    );
    expect(irRes.status).toBe(200);
    const irJson = (await irRes.json()) as {
      country_code: string;
      blocking_status: string;
      resolves_globally: boolean;
      ooni: { confirmed_rate: number; impaired_rate: number };
      flags: string[];
    };
    expect(irJson.country_code).toBe("IR");
    expect(irJson.blocking_status).toBe("CONFIRMED_BLOCKED");
    expect(irJson.resolves_globally).toBe(true);
    expect(irJson.ooni.confirmed_rate).toBe(0.5);
    expect(irJson.ooni.impaired_rate).toBe(0.75);
    expect(irJson.flags).toContain("OONI_CONFIRMED_CENSORSHIP");

    // 200 REACHABLE in DE
    const deRes = await app.request(
      "http://localhost/v1/net/censorship-check?domain=telegram.org&country=DE"
    );
    expect(deRes.status).toBe(200);
    expect(((await deRes.json()) as { blocking_status: string }).blocking_status).toBe("REACHABLE");

    // 200 INSUFFICIENT_DATA when < 5 OONI measurements
    const isRes = await app.request(
      "http://localhost/v1/net/censorship-check?domain=telegram.org&country=IS"
    );
    expect(isRes.status).toBe(200);
    expect(((await isRes.json()) as { blocking_status: string }).blocking_status).toBe(
      "INSUFFICIENT_DATA"
    );

    // 200 GLOBALLY_UNRESOLVABLE when NXDOMAIN globally
    const deadRes = await app.request(
      "http://localhost/v1/net/censorship-check?domain=dead-nxdomain.org&country=DE"
    );
    expect(deadRes.status).toBe(200);
    expect(((await deadRes.json()) as { blocking_status: string }).blocking_status).toBe(
      "GLOBALLY_UNRESOLVABLE"
    );

    // 502 fail-closed if OONI fails
    const ooniDownApp = new Hono<AppBindings>();
    ooniDownApp.get(
      "/v1/net/censorship-check",
      createCensorshipCheckHandler({
        cache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          if (String(input).includes("api.ooni.io")) return new Response("down", { status: 503 });
          return ooniFetch(input);
        },
      })
    );
    expect(
      (
        await ooniDownApp.request(
          "http://localhost/v1/net/censorship-check?domain=telegram.org&country=IR"
        )
      ).status
    ).toBe(502);

    // 502 fail-closed if global Cloudflare DoH returns HTTP 200 with Status: 2 (SERVFAIL)
    const dohServfailApp = new Hono<AppBindings>();
    dohServfailApp.get(
      "/v1/net/censorship-check",
      createCensorshipCheckHandler({
        cache: new BoundedTtlCache(10),
        fetchImpl: async (input) => {
          if (String(input).includes("cloudflare-dns.com")) {
            return new Response(JSON.stringify({ Status: 2 }), { status: 200 });
          }
          return ooniFetch(input);
        },
      })
    );
    expect(
      (
        await dohServfailApp.request(
          "http://localhost/v1/net/censorship-check?domain=telegram.org&country=DE"
        )
      ).status
    ).toBe(502);
  });
});
