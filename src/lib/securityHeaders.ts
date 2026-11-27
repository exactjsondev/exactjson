import type { Context } from "hono";
import type { AppBindings } from "../types";

export const HTML_CSP =
  "default-src 'none'; script-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";
export const HSTS_HEADER = "max-age=31536000; includeSubDomains";

export function resolveBaseUrl(c: Context<AppBindings>): string {
  const configured = c.env.PUBLIC_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return new URL(c.req.url).origin;
}

export function applyHtmlSecurityHeaders(target: Context<AppBindings> | Headers): void {
  const setHeader =
    target instanceof Headers
      ? (name: string, value: string) => target.set(name, value)
      : (name: string, value: string) => target.header(name, value);

  setHeader("X-Content-Type-Options", "nosniff");
  setHeader("X-Frame-Options", "DENY");
  setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  setHeader("Strict-Transport-Security", HSTS_HEADER);
  setHeader("Content-Security-Policy", HTML_CSP);
}

export type JsonBodyLimitResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" };

export async function readJsonBodyWithLimit(
  req: Request,
  maxBytes: number,
): Promise<JsonBodyLimitResult> {
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader.trim());
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: "too_large" };
    }
  }

  let rawText: string;
  try {
    if (req.body) {
      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: "too_large" };
        }
        chunks.push(value);
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      rawText = new TextDecoder().decode(combined);
    } else {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return { ok: false, reason: "too_large" };
      }
      rawText = new TextDecoder().decode(buf);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  try {
    const data: unknown = JSON.parse(rawText);
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
