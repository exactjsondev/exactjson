import type { Context } from "hono";
import {
  CATALOG,
  PACK_IDS,
  SERVICE_VERSION,
  getActivePacks,
  getPackEndpoints,
  parsePackSelector,
  type EndpointCatalogEntry,
  type PackId,
} from "../config/catalog";
import { prefersHtml } from "../lib/contentNegotiation";
import {
  encodeBase64Json,
  extractPaymentRequired,
  extractPaymentResponse,
} from "../lib/headers";
import {
  buildMcpInstructions,
  buildMcpTools,
  resolveMcpToolEndpoint,
} from "../lib/mcpTools";
import {
  applyHtmlSecurityHeaders,
  readJsonBodyWithLimit,
  resolveBaseUrl,
} from "../lib/securityHeaders";
import { markMcpInternalRequest } from "../lib/transport";
import type { AppBindings, Env } from "../types";
import { renderMcpGuideHtml } from "./landingHtml";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep free MCP calls near 0ms cold start.

const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_NAME = "io.github.exactjsondev/exactjson";
const MCP_SERVER_TITLE = "ExactJSON — Live, deterministic x402 APIs for AI agents";

export type InternalRequestDispatcher = (
  req: Request,
  env: Env,
  ctx?: Context["executionCtx"]
) => Response | Promise<Response>;

export interface McpHandlerOptions {
  catalogEntries?: readonly EndpointCatalogEntry[];
}

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

function resolveProtocolVersion(c: Context<AppBindings>, requestedVersion?: unknown): string {
  if (
    typeof requestedVersion === "string" &&
    SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
  ) {
    return requestedVersion;
  }
  const headerVersion = c.req.header("mcp-protocol-version")?.trim();
  if (headerVersion && SUPPORTED_PROTOCOL_VERSIONS.has(headerVersion)) {
    return headerVersion;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

const MAX_MCP_BODY_BYTES = 16_384;

function applyMcpHeaders(c: Context<AppBindings>, protocolVersion: string): void {
  c.header("Cache-Control", "no-store");
  c.header("Mcp-Protocol-Version", protocolVersion);
}

function jsonRpcErrorResponse(
  c: Context<AppBindings>,
  httpStatus: 400 | 404 | 200,
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

type ResolvedPackContext =
  | {
      ok: true;
      packs: readonly PackId[];
      isAll: boolean;
      canonical: string;
      mcpPath: string;
    }
  | {
      ok: false;
      status: 400 | 404;
      message: string;
    };

function resolveRequestPackContext(
  c: Context<AppBindings>,
  catalogEntries: readonly EndpointCatalogEntry[]
): ResolvedPackContext {
  const pathPack = c.req.param("pack");
  const queryPack = c.req.query("pack");

  if (
    pathPack !== undefined &&
    pathPack.trim().length > 0 &&
    queryPack !== undefined &&
    queryPack.trim().length > 0
  ) {
    return {
      ok: false,
      status: 400,
      message:
        "Conflicting pack selectors: specify either /mcp/<pack> in the URL path or ?pack=<packs> in the query string, not both.",
    };
  }

  const activePacks = getActivePacks(catalogEntries);
  const activeLabels = [...activePacks.map((p) => p.id), "all"].join(", ");
  const rawSelector = pathPack !== undefined ? pathPack : queryPack;
  const parsed = parsePackSelector(rawSelector);

  if (!parsed.ok) {
    return {
      ok: false,
      status: 404,
      message: `Unknown MCP pack '${parsed.invalid}'. Valid packs: ${PACK_IDS.join(", ")}, all (active: ${activeLabels}).`,
    };
  }

  if (parsed.isAll) {
    const activeIds = activePacks.map((p) => p.id);
    return {
      ok: true,
      packs: activeIds.length > 0 ? activeIds : ["markets"],
      isAll: true,
      canonical: "all",
      mcpPath: pathPack !== undefined ? "/mcp/all" : "/mcp?pack=all",
    };
  }

  for (const packId of parsed.packs) {
    if (getPackEndpoints([packId], catalogEntries).length === 0) {
      return {
        ok: false,
        status: 404,
        message: `MCP pack '${packId}' currently has 0 active endpoints. Active packs: ${activeLabels}.`,
      };
    }
  }

  const mcpPath =
    pathPack !== undefined
      ? `/mcp/${parsed.canonical}`
      : queryPack !== undefined
        ? `/mcp?pack=${parsed.canonical}`
        : "/mcp";

  return {
    ok: true,
    packs: parsed.packs,
    isAll: false,
    canonical: parsed.canonical,
    mcpPath,
  };
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
  const origin = resolveBaseUrl(c);
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
  const origin = resolveBaseUrl(c);
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
    const paymentRequired = extractPaymentRequired(res.headers);
    const paymentResponse = extractPaymentResponse(res.headers);

    if (!paymentRequired && paymentResponse !== null) {
      const settlementError = {
        x402Version: 2,
        error: paymentResponse.errorReason || "Payment settlement failed",
        payment_response: paymentResponse,
      };
      return {
        isError: true,
        structuredContent: settlementError,
        content: [{ type: "text", text: JSON.stringify(settlementError) }],
        _meta: { "x402/payment-response": paymentResponse },
      };
    }

    const parsedBody = safeParseJsonObject(bodyText);
    const nonEmptyBody =
      parsedBody && Object.keys(parsedBody).length > 0 ? parsedBody : null;
    const challengePayload =
      paymentRequired ??
      nonEmptyBody ?? {
        x402Version: 2,
        error: "Payment required",
      };
    return {
      isError: true,
      structuredContent: challengePayload,
      content: [{ type: "text", text: JSON.stringify(challengePayload) }],
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

  const parsedObj = safeParseJsonObject(bodyText);
  return {
    isError: true,
    content: [{ type: "text", text: bodyText }],
    ...(parsedObj ? { structuredContent: parsedObj } : {}),
  };
}

export function createMcpHandler(
  dispatchInternal: InternalRequestDispatcher,
  options: McpHandlerOptions = {}
) {
  const catalogEntries = options.catalogEntries ?? CATALOG;

  const mcpPostHandler = async (c: Context<AppBindings>) => {
    const defaultVersion = resolveProtocolVersion(c);
    const packCtx = resolveRequestPackContext(c, catalogEntries);
    if (!packCtx.ok) {
      return jsonRpcErrorResponse(
        c,
        packCtx.status,
        null,
        -32602,
        packCtx.message,
        defaultVersion
      );
    }

    const parsedBody = await readJsonBodyWithLimit(c.req.raw, MAX_MCP_BODY_BYTES);
    if (!parsedBody.ok) {
      if (parsedBody.reason === "too_large") {
        applyMcpHeaders(c, defaultVersion);
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32600,
              message: `Request body exceeds ${MAX_MCP_BODY_BYTES} byte limit.`,
            },
          },
          413
        );
      }
      return jsonRpcErrorResponse(c, 400, null, -32700, "Parse error", defaultVersion);
    }
    const payload = parsedBody.data;

    if (
      !isPlainObject(payload) ||
      payload.jsonrpc !== "2.0" ||
      typeof payload.method !== "string" ||
      payload.method.trim().length === 0
    ) {
      return jsonRpcErrorResponse(c, 400, null, -32600, "Invalid Request", defaultVersion);
    }

    const req = payload as unknown as JsonRpcRequest;
    const hasId = Object.hasOwn(payload, "id") && req.id !== undefined;

    if (hasId && req.id !== null && typeof req.id !== "string" && typeof req.id !== "number") {
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
          instructions: buildMcpInstructions(packCtx.packs, packCtx.isAll, catalogEntries),
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
        {
          tools: buildMcpTools({
            packs: packCtx.packs,
            catalogEntries,
          }),
        },
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

      const target = resolveMcpToolEndpoint(req.params.name, {
        packs: packCtx.packs,
        catalogEntries,
      });

      if (target.kind === "unknown") {
        return jsonRpcErrorResponse(
          c,
          200,
          rpcId,
          -32602,
          `Unknown tool: ${req.params.name}`,
          defaultVersion
        );
      }

      if (target.kind === "other_pack") {
        const origin = resolveBaseUrl(c);
        return jsonRpcErrorResponse(
          c,
          200,
          rpcId,
          -32602,
          `Tool '${req.params.name}' belongs to pack '${target.entry.pack}' (active scope: '${packCtx.canonical}'). Connect to ${origin}/mcp/${target.entry.pack} or ${origin}/mcp/all (stdio: --pack ${target.entry.pack} or --pack all).`,
          defaultVersion
        );
      }

      const result =
        target.kind === "health"
          ? await handleHealthToolCall(c, dispatchInternal)
          : await handlePaidToolCall(c, target.entry, rawArgs ?? {}, rawMeta, dispatchInternal);

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
    const packCtx = resolveRequestPackContext(c, catalogEntries);
    if (!packCtx.ok) {
      return jsonRpcErrorResponse(
        c,
        packCtx.status,
        null,
        -32602,
        packCtx.message,
        resolveProtocolVersion(c)
      );
    }

    c.header("Allow", "POST, OPTIONS");
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept");
    c.header("X-Content-Type-Options", "nosniff");

    if (c.req.method === "GET" && prefersHtml(c.req.header("accept"))) {
      applyHtmlSecurityHeaders(c);
      const toolCount = 1 + getPackEndpoints(packCtx.packs, catalogEntries).length;
      return c.html(renderMcpGuideHtml(resolveBaseUrl(c), packCtx.mcpPath, toolCount), 405);
    }

    return c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: `Method not allowed. Send JSON-RPC 2.0 requests via POST ${packCtx.mcpPath}.`,
        },
      },
      405
    );
  };

  return { mcpPostHandler, mcpMethodNotAllowedHandler };
}
