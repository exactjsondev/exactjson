import type { Context, MiddlewareHandler } from "hono";
import { getEndpointByPath } from "../config/catalog";
import {
  extractExtensionResponses,
  extractPaymentRequired,
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
  if (paymentResponse !== null && paymentResponse.success === false) {
    return "UNSETTLED_ERROR";
  }
  if (httpStatus === 402) {
    return hadPaymentHeader ? "VERIFY_FAILED" : "CHALLENGED_402";
  }
  if (httpStatus === 200 && paymentResponse !== null) {
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

export function createWaitUntil(
  c: Context<AppBindings>
): (promise: Promise<unknown>) => void {
  return (promise) => safeWaitUntil(c, promise);
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
 * Resolves the most specific failure reason for telemetry logging without
 * touching normal CHALLENGED_402 or SETTLED rows.
 */
export function extractTelemetryError(
  explicitError: string | null | undefined,
  outcome: RequestOutcome,
  paymentResponse: ReturnType<typeof extractPaymentResponse>,
  paymentRequired: ReturnType<typeof extractPaymentRequired>
): string | null {
  const explicit = truncate(explicitError, 64);
  if (explicit) {
    return explicit;
  }

  if (paymentResponse && typeof paymentResponse.errorReason === "string") {
    const reason = truncate(paymentResponse.errorReason, 64);
    if (reason) return reason;
  }

  if (
    outcome === "VERIFY_FAILED" &&
    paymentRequired &&
    typeof paymentRequired.error === "string"
  ) {
    const rawErr = paymentRequired.error.trim();
    if (rawErr === "Payment required") {
      return "MALFORMED_PAYMENT_HEADER";
    }
    return truncate(rawErr, 64);
  }

  return null;
}

/**
 * Mounted BEFORE x402 paymentMiddleware on /v1/*.
 * Logs strictly 1 D1 row per matched paid endpoint asynchronously via safeWaitUntil().
 */
export const telemetryMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const endpoint = c.get("matched_endpoint") ?? getEndpointByPath(c.req.path);
  const methodMatches =
    endpoint !== undefined &&
    (c.req.method === endpoint.method ||
      (endpoint.method === "GET" && c.req.method === "HEAD"));
  if (!endpoint || !methodMatches) {
    await next();
    return;
  }
  c.set("matched_endpoint", endpoint);

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
  const explicitError = c.get("upstream_error");
  const paymentRequired =
    outcome === "VERIFY_FAILED" && !explicitError
      ? extractPaymentRequired(res.headers)
      : null;
  const upstreamError = extractTelemetryError(
    explicitError,
    outcome,
    paymentResponse,
    paymentRequired
  );

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
