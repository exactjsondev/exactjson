#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ENDPOINTS, PACK_IDS, PACKS, SERVICE_VERSION } from "./catalog.generated.mjs";

const BASE_URL = (process.env.EXACTJSON_BASE_URL?.trim() || "https://exactjson.com").replace(
  /\/+$/,
  "",
);
const parsedBaseUrl = new URL(BASE_URL);
const isLocalHost =
  parsedBaseUrl.hostname === "localhost" ||
  parsedBaseUrl.hostname === "127.0.0.1" ||
  parsedBaseUrl.hostname === "::1" ||
  parsedBaseUrl.hostname === "[::1]";
if (parsedBaseUrl.protocol !== "https:" && !(parsedBaseUrl.protocol === "http:" && isLocalHost)) {
  throw new Error(
    `Unsafe EXACTJSON_BASE_URL protocol '${parsedBaseUrl.protocol}': HTTPS is required for non-localhost hosts.`,
  );
}
const MAX_PAYMENT = process.env.MAX_PAYMENT_USD?.trim() || "$0.05";
const REQUEST_TIMEOUT_MS = 20_000;
const VALID_PACK_SET = new Set(PACK_IDS);

function extractCliPackArg(argv) {
  let cliPack;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pack") {
      const next = argv[i + 1];
      if (!next || next.trim().length === 0 || next.startsWith("--")) {
        throw new Error(`Missing value after --pack. Valid packs: ${PACK_IDS.join(", ")}, all.`);
      }
      cliPack = next;
      i += 1;
    } else if (typeof arg === "string" && arg.startsWith("--pack=")) {
      const val = arg.slice("--pack=".length);
      if (val.trim().length === 0) {
        throw new Error(`Missing value in --pack=. Valid packs: ${PACK_IDS.join(", ")}, all.`);
      }
      cliPack = val;
    }
  }
  return cliPack;
}

function resolveActivePackContext(argv, envPack) {
  const cliPack = extractCliPackArg(argv);
  const rawSelector = cliPack !== undefined ? cliPack : envPack;
  const activePackIds = PACK_IDS.filter((id) => ENDPOINTS.some((e) => e.pack === id));
  const activeLabels = [...activePackIds, "all"].join(", ");

  if (rawSelector === undefined || rawSelector.trim().length === 0) {
    return {
      packs: ["markets"],
      isAll: false,
      canonical: "markets",
    };
  }

  const parts = rawSelector.split(",").map((part) => part.trim().toLowerCase());
  if (parts.length === 1 && parts[0] === "all") {
    return {
      packs: activePackIds.length > 0 ? activePackIds : ["markets"],
      isAll: true,
      canonical: "all",
    };
  }

  const seen = new Set();
  const ordered = [];
  for (const part of parts) {
    if (!VALID_PACK_SET.has(part)) {
      throw new Error(
        `Unknown MCP pack '${part}'. Valid packs: ${PACK_IDS.join(", ")}, all (active: ${activeLabels}).`,
      );
    }
    if (!activePackIds.includes(part)) {
      throw new Error(
        `MCP pack '${part}' currently has 0 active endpoints. Active packs: ${activeLabels}.`,
      );
    }
    if (!seen.has(part)) {
      seen.add(part);
      ordered.push(part);
    }
  }

  return {
    packs: ordered,
    isAll: false,
    canonical: ordered.join(","),
  };
}

function buildInstructions(packs, isAll) {
  const workflows = packs.flatMap((id) => PACKS[id]?.workflows ?? []);
  const disclaimers = Array.from(new Set(packs.map((id) => PACKS[id]?.disclaimer).filter(Boolean)));
  const scopeLabel = isAll ? "all" : packs.join(",");

  return [
    "ExactJSON provides live, deterministic x402 V2 APIs for AI agents paid per call in Base USDC ($0.005-$0.02/call; exactjson_health is free) via stdio (npx -y exactjson-mcp) or Remote Streamable HTTP (https://exactjson.com/mcp).",
    `Active MCP pack scope: '${scopeLabel}'. Pass --pack <pack|all> or set EXACTJSON_PACK (HTTP: /mcp/<pack> or /mcp/all) to switch verticals.`,
    "Pay-only-on-success: HTTP 400/404/502/503 responses are never settled. Do not blindly retry invalid inputs or 502 upstream errors.",
    workflows.length > 0
      ? `Recommended workflows: ${workflows.map((w, idx) => `(${idx + 1}) ${w}`).join(" ")}`
      : "",
    disclaimers.join(" "),
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function buildZodShape(inputSchema) {
  const requiredSet = new Set(inputSchema.required ?? []);
  const shape = {};

  for (const [paramName, prop] of Object.entries(inputSchema.properties)) {
    let validator;
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      validator = z.enum(prop.enum);
    } else if (prop.mcpType === "integer") {
      let num = z.number().int();
      if (typeof prop.minimum === "number") num = num.min(prop.minimum);
      if (typeof prop.maximum === "number") num = num.max(prop.maximum);
      validator = num;
    } else if (prop.mcpType === "number") {
      let num = z.number();
      if (typeof prop.minimum === "number") num = num.min(prop.minimum);
      if (typeof prop.maximum === "number") num = num.max(prop.maximum);
      validator = num;
    } else if (prop.mcpType === "boolean") {
      validator = z.boolean();
    } else {
      let str = z.string();
      if (typeof prop.pattern === "string") str = str.regex(new RegExp(prop.pattern));
      if (typeof prop.minLength === "number") str = str.min(prop.minLength);
      if (typeof prop.maxLength === "number") str = str.max(prop.maxLength);
      validator = str;
    }

    if (!requiredSet.has(paramName)) {
      validator = validator.optional();
    }
    if (typeof prop.description === "string") {
      validator = validator.describe(prop.description);
    }
    shape[paramName] = validator;
  }

  return shape;
}

let paidFetchKey = null;
let paidFetchPromise = null;

async function getPaidFetch() {
  const rawKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!rawKey) {
    throw new Error(
      "BUYER_PRIVATE_KEY environment variable is required to call paid ExactJSON endpoints (Base Mainnet USDC). Set BUYER_PRIVATE_KEY to a dedicated low-balance Base wallet key (and MAX_PAYMENT_USD, e.g. $0.05) — or call exactjson_health for free. Docs: https://exactjson.com/#quickstart",
    );
  }
  const normalizedKey = /^0x/i.test(rawKey) ? `0x${rawKey.slice(2)}` : `0x${rawKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    throw new Error(
      "Invalid BUYER_PRIVATE_KEY format: expected a 64-character hex EVM private key (with or without 0x prefix) for a low-balance Base Mainnet USDC wallet. Replace any placeholder value in your MCP config. Docs: https://exactjson.com/#quickstart",
    );
  }

  const cacheIdentity = `${normalizedKey}|${MAX_PAYMENT}`;
  if (paidFetchPromise && paidFetchKey === cacheIdentity) {
    return paidFetchPromise;
  }

  paidFetchKey = cacheIdentity;
  paidFetchPromise = Promise.all([
    import("@x402/evm/exact/client"),
    import("@x402/fetch"),
    import("viem/accounts"),
  ])
    .then(
      ([
        { registerExactEvmScheme },
        { wrapFetchWithPayment, x402Client },
        { privateKeyToAccount },
      ]) => {
        const account = privateKeyToAccount(normalizedKey);
        const client = new x402Client().setSpendControls({ maxAmountPerPayment: MAX_PAYMENT });
        registerExactEvmScheme(client, { signer: account });
        return wrapFetchWithPayment(fetch, client);
      },
    )
    .catch((err) => {
      paidFetchPromise = null;
      paidFetchKey = null;
      throw err;
    });

  return paidFetchPromise;
}

function buildUrl(path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    const str = String(v).trim();
    if (str.length > 0) {
      url.searchParams.set(k, str);
    }
  }
  return url.toString();
}

function decodeBase64JsonHeader(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const normalized = raw.trim().replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function callPaidEndpoint(path, params = {}) {
  try {
    const fetchWithPay = await getPaidFetch();
    const res = await fetchWithPay(buildUrl(path, params), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      if (res.status === 402 && (!detail || detail.trim() === "{}")) {
        const payResp = decodeBase64JsonHeader(
          res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE"),
        );
        if (payResp?.errorReason) {
          detail = JSON.stringify({
            error: payResp.errorReason,
            payment_response: payResp,
          });
        }
      }
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ExactJSON returned HTTP ${res.status} (unsettled): ${detail}`,
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `ExactJSON request failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

let packCtx;
try {
  packCtx = resolveActivePackContext(process.argv.slice(2), process.env.EXACTJSON_PACK);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const server = new McpServer(
  {
    name: "exactjson",
    version: SERVICE_VERSION,
  },
  {
    instructions: buildInstructions(packCtx.packs, packCtx.isAll),
  },
);

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

server.tool(
  "exactjson_health",
  "Free: Check ExactJSON API availability, version, network (Base eip155:8453), and paused status before running paid workflows.",
  {},
  READ_ONLY_ANNOTATIONS,
  async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          isError: true,
          content: [
            { type: "text", text: `ExactJSON /health returned HTTP ${res.status}: ${text}` },
          ],
        };
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ExactJSON /health failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

const allowedPackSet = new Set(packCtx.packs);
for (const entry of ENDPOINTS) {
  if (!allowedPackSet.has(entry.pack)) continue;
  server.tool(
    `exactjson_${entry.id}`,
    `Paid (${entry.priceFormatted} USDC): ${entry.description}`,
    buildZodShape(entry.inputSchema),
    READ_ONLY_ANNOTATIONS,
    async (args) => callPaidEndpoint(entry.path, args),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
