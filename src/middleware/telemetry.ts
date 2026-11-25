import type { Context, MiddlewareHandler } from "hono";
import { getEndpointByPath } from "../config/catalog";
import {
  extractExtensionResponses,
  extractPaymentResponse,
  hasPaymentSignatureHeader,
} from "../lib/headers";
import { detectRequestTransport } from "../lib/transport";
import type { AppBindings, RequestOutcome } from "../types";

export function classifyOutcome(
  httpStatus: number,
  hadPaymentHeader: boolean,
  paymentResponse: ReturnType<typeof extractPaymentResponse>
): RequestOutcome {
  if (httpStatus === 402) {
    return hadPaymentHeader ? "VERIFY_FAILED" : "CHALLENGED_402";
  }
  if (httpStatus === 200 && paymentResponse !== null && paymentResponse.success !== false) {
    return "SETTLED";
  }
  return "UNSETTLED_ERROR";
}

export function safeWaitUntil(c: Context<AppBindings>, promise: Promise<unknown>): void {
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(promise);
      return;
    }
  } catch {
    // ExecutionContext is absent in unit tests (Vitest / app.request)
  }

  void promise.catch(() => {
    // Swallow background telemetry errors
  });
}

function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function truncate(val: string | null | undefined, maxLen: number): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen);
}

/**
 * Mounted BEFORE x402 paymentMiddleware on /v1/*.
 * Logs strictly 1 D1 row per matched paid endpoint asynchronously via safeWaitUntil().
 */
export const telemetryMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const endpoint = getEndpointByPath(c.req.path);
  const methodMatches =
    endpoint !== undefined &&
    (c.req.method === endpoint.method ||
      (endpoint.method === "GET" && c.req.method === "HEAD"));
  if (!endpoint || !methodMatches) {
    await next();
    return;
  }

  const startMs = Date.now();
  const transport = detectRequestTransport(c.req.raw);
  const hadPaymentHeader = hasPaymentSignatureHeader(c.req.raw.headers);
  const rawTarget = truncate(c.req.query(endpoint.queryParamName), 128);

  await next();

  const latencyMs = Math.max(0, Date.now() - startMs);
  const res = c.res;
  const httpStatus = res.status;
  const paymentResponse = extractPaymentResponse(res.headers);
  const outcome = classifyOutcome(httpStatus, hadPaymentHeader, paymentResponse);
  const extensionResponses = truncate(extractExtensionResponses(res.headers), 2048);

  const queryTarget = truncate(c.get("query_target") ?? rawTarget, 128);
  const cacheStatus = c.get("cache_status") ?? null;
  const upstreamSource = truncate(c.get("upstream_source"), 64);
  const upstreamError = truncate(c.get("upstream_error"), 64);

  const priceUsd = outcome === "SETTLED" ? endpoint.priceUsd : 0;
  const payerAddress = paymentResponse?.payer ?? null;
  const txHash = paymentResponse?.transaction ?? paymentResponse?.txHash ?? null;
  const network = paymentResponse?.network ?? c.env.X402_NETWORK ?? "unknown";

  const db = c.env.DB;
  if (!db) {
    return;
  }

  const writePromise = (async () => {
    try {
      await db
        .prepare(
          `INSERT INTO api_requests (
            id, created_at, endpoint, query_target, http_status, outcome,
            price_usd, network, payer_address, tx_hash, cache_status,
            upstream_source, upstream_error, extension_responses, latency_ms, transport
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          generateRequestId(),
          new Date().toISOString(),
          endpoint.path,
          queryTarget,
          httpStatus,
          outcome,
          priceUsd,
          network,
          payerAddress,
          txHash,
          cacheStatus,
          upstreamSource,
          upstreamError,
          extensionResponses,
          latencyMs,
          transport
        )
        .run();
    } catch {
      // Never let D1 logging errors impact API responses
    }
  })();

  safeWaitUntil(c, writePromise);
};
