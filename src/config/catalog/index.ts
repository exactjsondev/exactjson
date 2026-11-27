import { COMMERCE_CATALOG, COMMERCE_PACK } from "./commerce";
import { MARKETS_CATALOG, MARKETS_PACK } from "./markets";
import { RESEARCH_CATALOG, RESEARCH_PACK } from "./research";
import { SECURITY_CATALOG, SECURITY_PACK } from "./security";
import {
  DISCLAIMER,
  type EndpointCatalogEntry,
  type EndpointId,
  type EndpointInputSchema,
  type EndpointParamSchema,
  type EndpointPath,
  type EndpointSubgroup,
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_PACK,
  type McpPackSelector,
  PACK_IDS,
  type PackDefinition,
  type PackId,
  SERVICE_NAME,
  SERVICE_VERSION,
  toHttpInputSchema,
  USER_AGENT,
} from "./types";
import { WORLD_CATALOG, WORLD_PACK } from "./world";

export {
  COMMERCE_PACK,
  DISCLAIMER,
  type EndpointCatalogEntry,
  type EndpointId,
  type EndpointInputSchema,
  type EndpointParamSchema,
  type EndpointPath,
  type EndpointSubgroup,
  MARKETS_PACK,
  MAX_BAZAAR_DESCRIPTION_LENGTH,
  MAX_MCP_TOOLS_PER_PACK,
  type McpPackSelector,
  PACK_IDS,
  type PackDefinition,
  type PackId,
  RESEARCH_PACK,
  SECURITY_PACK,
  SERVICE_NAME,
  SERVICE_VERSION,
  toHttpInputSchema,
  USER_AGENT,
  WORLD_PACK,
};

export const PACKS: Readonly<Record<PackId, PackDefinition>> = {
  markets: MARKETS_PACK,
  security: SECURITY_PACK,
  world: WORLD_PACK,
  commerce: COMMERCE_PACK,
  research: RESEARCH_PACK,
};

const PACK_ID_SET: ReadonlySet<string> = new Set(PACK_IDS);

export function isPackId(value: string): value is PackId {
  return PACK_ID_SET.has(value);
}

export const CATALOG: readonly EndpointCatalogEntry[] = [
  ...MARKETS_CATALOG,
  ...SECURITY_CATALOG,
  ...WORLD_CATALOG,
  ...COMMERCE_CATALOG,
  ...RESEARCH_CATALOG,
];

export const CATALOG_BY_PATH: Readonly<Record<string, EndpointCatalogEntry>> = Object.fromEntries(
  CATALOG.map((entry) => [entry.path, entry]),
);

export const CATALOG_BY_ID: Readonly<Record<EndpointId, EndpointCatalogEntry>> = Object.fromEntries(
  CATALOG.map((entry) => [entry.id, entry]),
) as Record<EndpointId, EndpointCatalogEntry>;

export function getEndpointById(id: EndpointId): EndpointCatalogEntry {
  return CATALOG_BY_ID[id];
}

export function getEndpointByPath(path: string): EndpointCatalogEntry | undefined {
  if (/%2f|%5c/i.test(path)) {
    return undefined;
  }
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  const normalized = decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
  return Object.hasOwn(CATALOG_BY_PATH, normalized) ? CATALOG_BY_PATH[normalized] : undefined;
}

export function getPackEndpoints(
  packs: readonly PackId[],
  catalogEntries: readonly EndpointCatalogEntry[] = CATALOG,
): EndpointCatalogEntry[] {
  const wanted = new Set<PackId>(packs);
  return catalogEntries.filter((entry) => wanted.has(entry.pack));
}

export function getActivePacks(
  catalogEntries: readonly EndpointCatalogEntry[] = CATALOG,
): PackDefinition[] {
  const populated = new Set<PackId>(catalogEntries.map((entry) => entry.pack));
  return PACK_IDS.filter((id) => populated.has(id)).map((id) => PACKS[id]);
}

export type PackSelectorResult =
  | {
      ok: true;
      packs: readonly PackId[];
      isAll: boolean;
      canonical: string;
    }
  | {
      ok: false;
      invalid: string;
    };

/**
 * Parses a pack selector (`undefined` -> `["markets"]`, `"all"` -> all `PACK_IDS`,
 * or comma-separated `PackId`s such as `"security,world"`).
 * Rejects unknown names, trailing/empty tokens, prototype keys, or mixing `"all"` with specific packs.
 */
export function parsePackSelector(raw: string | undefined | null): PackSelectorResult {
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return {
      ok: true,
      packs: ["markets"],
      isAll: false,
      canonical: "markets",
    };
  }

  const parts = raw.split(",").map((part) => part.trim().toLowerCase());
  if (parts.length === 1 && parts[0] === "all") {
    return {
      ok: true,
      packs: [...PACK_IDS],
      isAll: true,
      canonical: "all",
    };
  }

  const seen = new Set<PackId>();
  const ordered: PackId[] = [];
  for (const part of parts) {
    if (!isPackId(part)) {
      return { ok: false, invalid: part };
    }
    if (!seen.has(part)) {
      seen.add(part);
      ordered.push(part);
    }
  }

  return {
    ok: true,
    packs: ordered,
    isAll: false,
    canonical: ordered.join(","),
  };
}
