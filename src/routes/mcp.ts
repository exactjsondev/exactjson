import type { Context } from "hono";
import { SERVICE_VERSION, type EndpointCatalogEntry } from "../config/catalog";
import {
  encodeBase64Json,
  extractPaymentRequired,
  extractPaymentResponse,
} from "../lib/headers";
import {
  MCP_INSTRUCTIONS,
  buildMcpTools,
  resolveMcpToolEndpoint,
} from "../lib/mcpTools";
import { markMcpInternalRequest } from "../lib/transport";
import type { AppBindings, Env } from "../types";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep free MCP calls near 0ms cold start.

const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_NAME = "io.github.exactjsondev/exactjson";
const MCP_SERVER_TITLE = "ExactJSON — Live, deterministic x402 APIs for AI agents";

export type InternalRequestDispatcher = (
  req: Request,
  env: Env,
  ctx?: Context["executionCtx"]
) => Response | Promise<Response>;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeExecutionCtx(c: Context<AppBindings>): Context["executionCtx"] | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

function resolveProtocolVersion(
  c: Context<AppBindings>,
  requestedVersion?: unknown
): string {
  if (typeof requestedVersion === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)) {
    return requestedVersion;
  }
  const headerVersion = c.req.header("mcp-protocol-version")?.trim();
  if (headerVersion && SUPPORTED_PROTOCOL_VERSIONS.has(headerVersion)) {
    return headerVersion;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

function resolveInternalOrigin(c: Context<AppBindings>): string {
  const configured = c.env.PUBLIC_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return new URL(c.req.url).origin;
}

function applyMcpHeaders(c: Context<AppBindings>, protocolVersion: string): void {
  c.header("Cache-Control", "no-store");
  c.header("Mcp-Protocol-Version", protocolVersion);
}

function jsonRpcErrorResponse(
  c: Context<AppBindings>,
  httpStatus: 400 | 200,
  id: string | number | null,
  code: number,
  message: string,
  protocolVersion: string
) {
  applyMcpHeaders(c, protocolVersion);
  return c.json(
    {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    },
    httpStatus
  );
}

function jsonRpcResultResponse(
  c: Context<AppBindings>,
  id: string | number | null,
  result: Record<string, unknown>,
  protocolVersion: string
) {
  applyMcpHeaders(c, protocolVersion);
  return c.json(
    {
      jsonrpc: "2.0",
      id,
      result,
    },
    200
  );
}

function buildToolTargetUrl(
  origin: string,
  path: string,
  args: Record<string, unknown>
): string {
  const url = new URL(`${origin}${path}`);
  for (const [key, val] of Object.entries(args)) {
    if (val === undefined || val === null) {
      continue;
    }
    if (typeof val === "number" && !Number.isFinite(val)) {
      continue;
    }
    const str = String(val).trim();
    if (str.length > 0) {
      url.searchParams.set(key, str);
    }
  }
  return url.toString();
}

function resolvePaymentHeaders(
  c: Context<AppBindings>,
  meta: Record<string, unknown> | undefined
): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const mcpPayment = meta?.["x402/payment"];

  if (typeof mcpPayment === "string" && mcpPayment.trim().length > 0) {
    headers.set("PAYMENT-SIGNATURE", mcpPayment.trim());
    return headers;
  }

  if (isPlainObject(mcpPayment)) {
    headers.set("PAYMENT-SIGNATURE", encodeBase64Json(mcpPayment));
    return headers;
  }

  const incomingSig = c.req.header("payment-signature")?.trim();
  if (incomingSig) {
    headers.set("PAYMENT-SIGNATURE", incomingSig);
    return headers;
  }

  const incomingV1 = c.req.header("x-payment")?.trim();
  if (incomingV1) {
    headers.set("X-PAYMENT", incomingV1);
  }

  return headers;
}

async function handleHealthToolCall(
  c: Context<AppBindings>,
  dispatchInternal: InternalRequestDispatcher
): Promise<Record<string, unknown>> {
  const origin = resolveInternalOrigin(c);
  const req = new Request(`${origin}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const res = await dispatchInternal(req, c.env, safeExecutionCtx(c));
  const bodyText = await res.text();
  const parsedObj = safeParseJsonObject(bodyText);

  return {
    isError: !res.ok,
    content: [{ type: "text", text: bodyText }],
    ...(parsedObj ? { structuredContent: parsedObj } : {}),
  };
}

async function handlePaidToolCall(
  c: Context<AppBindings>,
  entry: EndpointCatalogEntry,
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  dispatchInternal: InternalRequestDispatcher
): Promise<Record<string, unknown>> {
  const origin = resolveInternalOrigin(c);
  const url = buildToolTargetUrl(origin, entry.path, args);
  const headers = resolvePaymentHeaders(c, meta);
  const internalReq = markMcpInternalRequest(
    new Request(url, {
      method: "GET",
      headers,
    })
  );

  const res = await dispatchInternal(internalReq, c.env, safeExecutionCtx(c));
  const bodyText = await res.text();

  if (res.status === 402) {
    const paymentRequired =
      extractPaymentRequired(res.headers) ??
      safeParseJsonObject(bodyText) ?? {
        x402Version: 2,
        error: "Payment required",
      };
    return {
      isError: true,
      structuredContent: paymentRequired,
      content: [{ type: "text", text: JSON.stringify(paymentRequired) }],
    };
  }

  if (res.status === 200) {
    const paymentResponse = extractPaymentResponse(res.headers);
    const parsedObj = safeParseJsonObject(bodyText);
    return {
      isError: false,
      content: [{ type: "text", text: bodyText }],
      ...(parsedObj ? { structuredContent: parsedObj } : {}),
      ...(paymentResponse ? { _meta: { "x402/payment-response": paymentResponse } } : {}),
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: bodyText }],
  };
}

export function createMcpHandler(dispatchInternal: InternalRequestDispatcher) {
  const mcpPostHandler = async (c: Context<AppBindings>) => {
    const defaultVersion = resolveProtocolVersion(c);

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return jsonRpcErrorResponse(c, 400, null, -32700, "Parse error", defaultVersion);
    }

    if (
      !isPlainObject(payload) ||
      payload.jsonrpc !== "2.0" ||
      typeof payload.method !== "string" ||
      payload.method.trim().length === 0
    ) {
      return jsonRpcErrorResponse(c, 400, null, -32600, "Invalid Request", defaultVersion);
    }

    const req = payload as unknown as JsonRpcRequest;
    const hasId = Object.prototype.hasOwnProperty.call(payload, "id") && req.id !== undefined;

    if (
      hasId &&
      req.id !== null &&
      typeof req.id !== "string" &&
      typeof req.id !== "number"
    ) {
      return jsonRpcErrorResponse(c, 400, null, -32600, "Invalid Request", defaultVersion);
    }

    // Notifications (no id) must return 202 Accepted with empty body
    if (!hasId) {
      applyMcpHeaders(c, defaultVersion);
      return c.body(null, 202);
    }

    const rpcId = req.id ?? null;

    if (req.method === "initialize") {
      const requestedVersion = isPlainObject(req.params) ? req.params.protocolVersion : undefined;
      const protocolVersion = resolveProtocolVersion(c, requestedVersion);
      return jsonRpcResultResponse(
        c,
        rpcId,
        {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            title: MCP_SERVER_TITLE,
            version: SERVICE_VERSION,
          },
          instructions: MCP_INSTRUCTIONS,
        },
        protocolVersion
      );
    }

    if (req.method === "ping") {
      return jsonRpcResultResponse(c, rpcId, {}, defaultVersion);
    }

    if (req.method === "tools/list") {
      return jsonRpcResultResponse(
        c,
        rpcId,
        { tools: buildMcpTools() },
        defaultVersion
      );
    }

    if (req.method === "tools/call") {
      if (!isPlainObject(req.params) || typeof req.params.name !== "string") {
        return jsonRpcErrorResponse(
          c,
          200,
          rpcId,
          -32602,
          "Invalid params: expected object with string 'name'.",
          defaultVersion
        );
      }

      const rawArgs = req.params.arguments;
      if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
        return jsonRpcErrorResponse(
          c,
          200,
          rpcId,
          -32602,
          "Invalid params: 'arguments' must be an object when provided.",
          defaultVersion
        );
      }

      const rawMeta = req.params._meta;
      if (rawMeta !== undefined && !isPlainObject(rawMeta)) {
        return jsonRpcErrorResponse(
          c,
          200,
          rpcId,
          -32602,
          "Invalid params: '_meta' must be an object when provided.",
          defaultVersion
        );
      }

      const target = resolveMcpToolEndpoint(req.params.name);
      if (!target) {
        return jsonRpcErrorResponse(
          c,
          200,
          rpcId,
          -32602,
          `Unknown tool: ${req.params.name}`,
          defaultVersion
        );
      }

      const result =
        target === "health"
          ? await handleHealthToolCall(c, dispatchInternal)
          : await handlePaidToolCall(
              c,
              target,
              rawArgs ?? {},
              rawMeta,
              dispatchInternal
            );

      return jsonRpcResultResponse(c, rpcId, result, defaultVersion);
    }

    return jsonRpcErrorResponse(
      c,
      200,
      rpcId,
      -32601,
      `Method not found: ${req.method}`,
      defaultVersion
    );
  };

  const mcpMethodNotAllowedHandler = (c: Context<AppBindings>) => {
    c.header("Allow", "POST, OPTIONS");
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "Method not allowed. Send JSON-RPC 2.0 requests via POST /mcp.",
        },
      },
      405
    );
  };

  return { mcpPostHandler, mcpMethodNotAllowedHandler };
}
