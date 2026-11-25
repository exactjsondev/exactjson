import {
  CATALOG,
  type EndpointCatalogEntry,
} from "../config/catalog";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep discovery & free MCP calls near 0ms cold start.

const MCP_INTEGER_PARAMS = new Set([
  "limit",
  "max_risk_score",
  "lookback_obs",
  "token_in_decimals",
]);

const MCP_NUMBER_PARAMS = new Set([
  "min_oi_usd",
  "min_spread_bps",
  "min_liquidity_usd",
  "min_volume_24h_usd",
]);

export const MCP_INSTRUCTIONS = [
  "ExactJSON provides live, deterministic x402 V2 APIs for AI agents paid per call in Base USDC ($0.005-$0.02/call; exactjson_health is free) via Remote Streamable HTTP (https://exactjson.com/mcp) or stdio (npx -y exactjson-mcp).",
  "Pay-only-on-success: HTTP 400/404/502/503 responses are never settled. Do not blindly retry invalid inputs or 502 upstream errors.",
  "Recommended workflows: (1) Before swapping an unfamiliar EVM/Base token, call exactjson_evm_safety ($0.01) and exactjson_execution_quote_check with mode='evm' ($0.01). (2) Before buying a Solana SPL token, call exactjson_solana_safety ($0.01). (3) For Hyperliquid perps, use exactjson_perps_snapshot ($0.005) for a fast check or exactjson_execution_quote_check with mode='perps' ($0.01) for multi-tier slippage. (4) When using exactjson_predictions_arb ($0.02), always verify Polymarket vs Kalshi settlement rules whenever resolution_risk_warning is true.",
  "Informational market/security data only; not financial advice.",
].join(" ");

export interface McpToolAnnotations {
  readOnlyHint: true;
  destructiveHint: false;
  idempotentHint: true;
  openWorldHint: true;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
}

const READ_ONLY_TOOL_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function toMcpToolInputSchema(
  inputSchema: EndpointCatalogEntry["inputSchema"]
): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [paramName, rawProp] of Object.entries(inputSchema.properties)) {
    const nextProp: Record<string, unknown> = { ...rawProp };
    if (MCP_INTEGER_PARAMS.has(paramName)) {
      nextProp.type = "integer";
      if (typeof nextProp.example === "string" && Number.isFinite(Number(nextProp.example))) {
        nextProp.example = Number.parseInt(nextProp.example, 10);
      }
    } else if (MCP_NUMBER_PARAMS.has(paramName)) {
      nextProp.type = "number";
      if (typeof nextProp.example === "string" && Number.isFinite(Number(nextProp.example))) {
        nextProp.example = Number(nextProp.example);
      }
    }
    properties[paramName] = nextProp;
  }
  return {
    type: inputSchema.type,
    properties,
    required: inputSchema.required ?? [],
  };
}

export function buildMcpTools(): McpToolDescriptor[] {
  return [
    {
      name: "exactjson_health",
      description:
        "Free: Check ExactJSON API availability, version, network (Base eip155:8453), and paused status before running paid workflows.",
      inputSchema: { type: "object", properties: {}, required: [] },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    ...CATALOG.map((entry) => ({
      name: `exactjson_${entry.id}`,
      description: `Paid (${entry.priceFormatted} USDC): ${entry.description}`,
      inputSchema: toMcpToolInputSchema(entry.inputSchema),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    })),
  ];
}

const TOOL_BY_NAME = new Map<string, EndpointCatalogEntry>(
  CATALOG.map((entry) => [`exactjson_${entry.id}`, entry])
);

export function resolveMcpToolEndpoint(
  toolName: string
): "health" | EndpointCatalogEntry | null {
  if (toolName === "exactjson_health") {
    return "health";
  }
  return TOOL_BY_NAME.get(toolName) ?? null;
}
