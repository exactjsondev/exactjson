import {
  CATALOG,
  PACKS,
  getPackEndpoints,
  type EndpointCatalogEntry,
  type EndpointInputSchema,
  type PackId,
} from "../config/catalog";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in this file to keep discovery & free MCP calls near 0ms cold start.

export function buildMcpInstructions(
  packs: readonly PackId[] = ["markets"],
  isAll = false,
  catalogEntries: readonly EndpointCatalogEntry[] = CATALOG
): string {
  const activeSet = new Set<PackId>(catalogEntries.map((e) => e.pack));
  const effectivePacks = packs.filter((id) => activeSet.has(id));
  const selectedPacks = effectivePacks.length > 0 ? effectivePacks : (["markets"] as const);

  const workflows = selectedPacks.flatMap((id) => PACKS[id].workflows);
  const disclaimers = Array.from(new Set(selectedPacks.map((id) => PACKS[id].disclaimer)));
  const scopeLabel = isAll ? "all" : selectedPacks.join(",");

  return [
    "ExactJSON provides live, deterministic x402 V2 APIs for AI agents paid per call in Base USDC ($0.005-$0.02/call; exactjson_health is free) via Remote Streamable HTTP (https://exactjson.com/mcp) or stdio (npx -y exactjson-mcp).",
    `Active MCP pack scope: '${scopeLabel}'. Other vertical packs are available at https://exactjson.com/mcp/<pack>, ?pack=<a,b>, or /mcp/all (stdio: --pack <pack|all> or EXACTJSON_PACK).`,
    "Pay-only-on-success: HTTP 400/404/502/503 responses are never settled. Do not blindly retry invalid inputs or 502 upstream errors.",
    workflows.length > 0
      ? `Recommended workflows: ${workflows.map((w, idx) => `(${idx + 1}) ${w}`).join(" ")}`
      : "",
    disclaimers.join(" "),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

export const MCP_INSTRUCTIONS = buildMcpInstructions(["markets"], false);

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

export function toMcpToolInputSchema(inputSchema: EndpointInputSchema): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [paramName, rawProp] of Object.entries(inputSchema.properties)) {
    const resolvedType = rawProp.mcpType ?? rawProp.type;
    const nextProp: Record<string, unknown> = {
      type: resolvedType,
      description: rawProp.description,
    };

    if (rawProp.pattern !== undefined) nextProp.pattern = rawProp.pattern;
    if (rawProp.enum !== undefined) nextProp.enum = [...rawProp.enum];
    if (rawProp.minLength !== undefined) nextProp.minLength = rawProp.minLength;
    if (rawProp.maxLength !== undefined) nextProp.maxLength = rawProp.maxLength;
    if (rawProp.minimum !== undefined) nextProp.minimum = rawProp.minimum;
    if (rawProp.maximum !== undefined) nextProp.maximum = rawProp.maximum;

    if (rawProp.example !== undefined) {
      if (resolvedType === "integer" && Number.isFinite(Number(rawProp.example))) {
        nextProp.example = Math.trunc(Number(rawProp.example));
      } else if (resolvedType === "number" && Number.isFinite(Number(rawProp.example))) {
        nextProp.example = Number(rawProp.example);
      } else if (resolvedType === "boolean") {
        nextProp.example = rawProp.example === "true";
      } else {
        nextProp.example = rawProp.example;
      }
    }

    properties[paramName] = nextProp;
  }
  return {
    type: inputSchema.type,
    properties,
    required: [...(inputSchema.required ?? [])],
  };
}

export interface McpToolScopeOptions {
  packs?: readonly PackId[];
  catalogEntries?: readonly EndpointCatalogEntry[];
}

export function buildMcpTools(options: McpToolScopeOptions = {}): McpToolDescriptor[] {
  const packs = options.packs ?? ["markets"];
  const catalogEntries = options.catalogEntries ?? CATALOG;
  const scopedEntries = getPackEndpoints(packs, catalogEntries);

  return [
    {
      name: "exactjson_health",
      description:
        "Free: Check ExactJSON API availability, version, network (Base eip155:8453), and paused status before running paid workflows.",
      inputSchema: { type: "object", properties: {}, required: [] },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    ...scopedEntries.map((entry) => ({
      name: `exactjson_${entry.id}`,
      description: `Paid (${entry.priceFormatted} USDC): ${entry.description}`,
      inputSchema: toMcpToolInputSchema(entry.inputSchema),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    })),
  ];
}

export type ResolvedMcpTool =
  | { kind: "health" }
  | { kind: "allowed"; entry: EndpointCatalogEntry }
  | { kind: "other_pack"; entry: EndpointCatalogEntry }
  | { kind: "unknown" };

export function resolveMcpToolEndpoint(
  toolName: string,
  options: McpToolScopeOptions = {}
): ResolvedMcpTool {
  if (toolName === "exactjson_health") {
    return { kind: "health" };
  }

  const packs = options.packs ?? ["markets"];
  const catalogEntries = options.catalogEntries ?? CATALOG;
  const matched = catalogEntries.find((entry) => `exactjson_${entry.id}` === toolName);
  if (!matched) {
    return { kind: "unknown" };
  }

  const allowedSet = new Set<PackId>(packs);
  if (!allowedSet.has(matched.pack)) {
    return { kind: "other_pack", entry: matched };
  }

  return { kind: "allowed", entry: matched };
}
