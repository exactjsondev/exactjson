import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types";

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

/**
 * Constant-time string comparison by SHA-256 hashing both inputs into fixed
 * 32-byte Uint8Arrays and comparing via a bitwise XOR accumulator.
 * Portable across Cloudflare Workers and Node/Vitest.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= (hashA[i] ?? 0) ^ (hashB[i] ?? 0);
  }
  return diff === 0;
}

const MAX_AUTH_HEADER_LENGTH = 512;

export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader || authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  return match?.[1] ?? null;
}

export async function verifyDashboardToken(
  authHeader: string | null | undefined,
  expectedToken: string | null | undefined
): Promise<boolean> {
  if (!expectedToken || expectedToken.trim().length === 0) {
    return false;
  }
  const provided = extractBearerToken(authHeader);
  if (!provided) {
    return false;
  }
  return constantTimeEqual(provided, expectedToken.trim());
}

export const adminAuthMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const authorized = await verifyDashboardToken(
    c.req.header("Authorization"),
    c.env.DASHBOARD_TOKEN
  );

  if (!authorized) {
    return c.json(
      {
        error: "UNAUTHORIZED",
        message: "Valid Bearer token required.",
      },
      401
    );
  }

  await next();
};
