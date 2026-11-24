import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  adminAuthMiddleware,
  constantTimeEqual,
  extractBearerToken,
  verifyDashboardToken,
} from "../src/middleware/adminAuth";
import type { AppBindings, Env } from "../src/types";

describe("portable constant-time admin auth", () => {
  it("compares equal and unequal strings accurately via SHA-256 XOR", async () => {
    expect(await constantTimeEqual("super-secret-token-123", "super-secret-token-123")).toBe(true);
    expect(await constantTimeEqual("super-secret-token-123", "super-secret-token-124")).toBe(false);
    expect(await constantTimeEqual("short", "much-longer-secret-string")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
    expect(await constantTimeEqual("unicode-✓-token", "unicode-✓-token")).toBe(true);
  });

  it("extracts Bearer tokens and rejects malformed or empty secrets", async () => {
    expect(extractBearerToken("Bearer mytoken123")).toBe("mytoken123");
    expect(extractBearerToken("bearer   mytoken123 ")).toBe("mytoken123");
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken(`Bearer ${"a".repeat(600)}`)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();

    expect(await verifyDashboardToken("Bearer secret-32-chars", "secret-32-chars")).toBe(true);
    expect(await verifyDashboardToken("Bearer wrong", "secret-32-chars")).toBe(false);
    expect(await verifyDashboardToken("Bearer anything", "")).toBe(false);
    expect(await verifyDashboardToken("Bearer anything", undefined)).toBe(false);
  });

  it("enforces 401/200 in Hono middleware", async () => {
    const app = new Hono<AppBindings>();
    app.use("/dashboard/api/*", adminAuthMiddleware);
    app.get("/dashboard/api/ping", (c) => c.json({ ok: true }));

    const env = {
      DASHBOARD_TOKEN: "test-operator-token-0123456789abcdef",
    } as Env;

    const noAuth = await app.request("/dashboard/api/ping", {}, env);
    expect(noAuth.status).toBe(401);

    const badAuth = await app.request(
      "/dashboard/api/ping",
      { headers: { Authorization: "Bearer wrong-token" } },
      env
    );
    expect(badAuth.status).toBe(401);

    const goodAuth = await app.request(
      "/dashboard/api/ping",
      { headers: { Authorization: "Bearer test-operator-token-0123456789abcdef" } },
      env
    );
    expect(goodAuth.status).toBe(200);
  });
});
