export const SERVICE_NAME = "ExactJSON" as const;
export const SERVICE_VERSION = "1.2.0" as const;
export const USER_AGENT =
  "ExactJSON/1.2 (+https://exactjson.com; mailto:hello@exactjson.com)" as const;
export const DISCLAIMER =
  "Informational market/security data only; not financial advice." as const;

export const MAX_BAZAAR_DESCRIPTION_LENGTH = 500;
export const MAX_MCP_TOOLS_PER_PACK = 15;

export const PACK_IDS = ["markets", "security", "world", "commerce", "research"] as const;
export type PackId = (typeof PACK_IDS)[number];
export type McpPackSelector = PackId | "all";

export interface EndpointSubgroup {
  id: string;
  title: string;
  subtitle: string;
  ids: readonly EndpointId[];
}

export interface PackDefinition {
  id: PackId;
  title: string;
  subtitle: string;
  shortDescription: string;
  mcpPath: `/mcp/${PackId}`;
  disclaimer: string;
  workflows: readonly string[];
  subgroups?: readonly EndpointSubgroup[];
}

export type EndpointId =
  | "solana_safety"
  | "solana_trending"
  | "perps_snapshot"
  | "perps_screener"
  | "perps_funding_arb"
  | "predictions_scanner"
  | "options_surface"
  | "macro_liquidity"
  | "evm_safety"
  | "predictions_arb"
  | "execution_quote_check"
  | "oss_package_audit"
  | "net_domain_trust"
  | "sec_cve_triage"
  | "ops_cloud_status"
  | "oss_runtime_eol"
  | "ai_model_audit"
  | "net_censorship_check";

export type EndpointPath =
  | "/v1/solana/safety"
  | "/v1/solana/trending"
  | "/v1/perps/snapshot"
  | "/v1/perps/screener"
  | "/v1/perps/funding-arb"
  | "/v1/predictions/scanner"
  | "/v1/options/surface"
  | "/v1/macro/liquidity"
  | "/v1/evm/safety"
  | "/v1/predictions/arb"
  | "/v1/execution/quote-check"
  | "/v1/oss/package-audit"
  | "/v1/net/domain-trust"
  | "/v1/sec/cve-triage"
  | "/v1/ops/cloud-status"
  | "/v1/oss/runtime-eol"
  | "/v1/ai/model-audit"
  | "/v1/net/censorship-check";

export interface EndpointParamSchema {
  type: "string";
  mcpType?: "integer" | "number" | "boolean";
  description: string;
  pattern?: string;
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  example?: string;
}

export interface EndpointInputSchema {
  type: "object";
  properties: Readonly<Record<string, EndpointParamSchema>>;
  required?: readonly string[];
}

export interface EndpointCatalogEntry {
  id: EndpointId;
  pack: PackId;
  method: "GET";
  path: EndpointPath;
  routeKey: `GET ${EndpointPath}`;
  summary: string;
  description: string;
  tags: readonly string[];
  priceAmount: string;
  priceFormatted: string;
  priceUsd: number;
  queryParamName: string;
  queryParamDescription: string;
  queryParamExample: string;
  exampleQueryParams: Record<string, string>;
  inputSchema: EndpointInputSchema;
  outputExample: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

/**
 * Emits pure standard JSON Schema for HTTP query parameters (OpenAPI 3.1 & x402 Bazaar),
 * stripping internal MCP-only hints such as `mcpType`, `minimum`, and `maximum` on string query params.
 */
export function toHttpInputSchema(inputSchema: EndpointInputSchema): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, prop] of Object.entries(inputSchema.properties)) {
    const clean: Record<string, unknown> = {
      type: prop.type,
      description: prop.description,
    };
    if (prop.pattern !== undefined) clean.pattern = prop.pattern;
    if (prop.enum !== undefined) clean.enum = [...prop.enum];
    if (prop.minLength !== undefined) clean.minLength = prop.minLength;
    if (prop.maxLength !== undefined) clean.maxLength = prop.maxLength;
    if (prop.example !== undefined) clean.example = prop.example;
    properties[name] = clean;
  }
  return {
    type: "object",
    properties,
    required: [...(inputSchema.required ?? [])],
  };
}
