import { z } from "zod";
import type { EvmChainConfig, EvmChainKey } from "../types";

const SOLANA_MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PERP_COIN_REGEX = /^[A-Za-z0-9]{1,16}(?:-[Pp][Ee][Rr][Pp])?$/;
const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export const EVM_CHAINS: Record<EvmChainKey, EvmChainConfig> = {
  base: {
    key: "base",
    chainId: 8453,
    dexScreenerId: "base",
    geckoTerminalId: "base",
    honeypotSupported: true,
  },
  ethereum: {
    key: "ethereum",
    chainId: 1,
    dexScreenerId: "ethereum",
    geckoTerminalId: "eth",
    honeypotSupported: true,
  },
  arbitrum: {
    key: "arbitrum",
    chainId: 42161,
    dexScreenerId: "arbitrum",
    geckoTerminalId: "arbitrum",
    honeypotSupported: false,
  },
  optimism: {
    key: "optimism",
    chainId: 10,
    dexScreenerId: "optimism",
    geckoTerminalId: "optimism",
    honeypotSupported: false,
  },
  polygon: {
    key: "polygon",
    chainId: 137,
    dexScreenerId: "polygon",
    geckoTerminalId: "polygon_pos",
    honeypotSupported: false,
  },
  bsc: {
    key: "bsc",
    chainId: 56,
    dexScreenerId: "bsc",
    geckoTerminalId: "bsc",
    honeypotSupported: true,
  },
};

const EVM_CHAIN_ALIASES: Record<string, EvmChainKey> = {
  base: "base",
  "8453": "base",
  ethereum: "ethereum",
  eth: "ethereum",
  mainnet: "ethereum",
  "1": "ethereum",
  arbitrum: "arbitrum",
  arb: "arbitrum",
  "42161": "arbitrum",
  optimism: "optimism",
  op: "optimism",
  "10": "optimism",
  polygon: "polygon",
  matic: "polygon",
  pol: "polygon",
  "137": "polygon",
  bsc: "bsc",
  bnb: "bsc",
  "56": "bsc",
};

export const solanaMintSchema = z
  .string()
  .trim()
  .regex(SOLANA_MINT_REGEX, "Invalid Solana SPL mint address (expected 32-44 Base58 characters).");

export const perpCoinSchema = z
  .string()
  .trim()
  .regex(
    PERP_COIN_REGEX,
    "Invalid coin symbol (expected 1-16 alphanumeric characters, optional -PERP suffix)."
  );

export const evmAddressSchema = z
  .string()
  .trim()
  .regex(EVM_ADDRESS_REGEX, "Invalid EVM token address (expected 0x followed by 40 hex characters).");

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseSolanaMint(raw: string | undefined): ValidationResult<string> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, error: "Query parameter 'mint' is required." };
  }
  if (raw.length > 128) {
    return { ok: false, error: "Invalid Solana SPL mint address (input too long)." };
  }
  const result = solanaMintSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Invalid Solana SPL mint address.",
    };
  }
  return { ok: true, value: result.data };
}

export function parseEvmAddress(
  raw: string | undefined,
  paramName: string = "address"
): ValidationResult<string> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, error: `Query parameter '${paramName}' is required.` };
  }
  if (raw.length > 128) {
    return { ok: false, error: "Invalid EVM token address (input too long)." };
  }
  const result = evmAddressSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Invalid EVM token address.",
    };
  }
  return { ok: true, value: result.data.toLowerCase() };
}

export function parseEvmChain(raw: string | undefined): ValidationResult<EvmChainConfig> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: EVM_CHAINS.base };
  }
  if (raw.length > 32) {
    return {
      ok: false,
      error: "Invalid chain parameter (input too long). Supported chains: base, ethereum, arbitrum, optimism, polygon, bsc.",
    };
  }
  const normalized = raw.trim().toLowerCase();
  const key = Object.prototype.hasOwnProperty.call(EVM_CHAIN_ALIASES, normalized)
    ? EVM_CHAIN_ALIASES[normalized]
    : undefined;
  if (!key) {
    return {
      ok: false,
      error: `Unsupported EVM chain '${raw.trim()}'. Supported chains: base, ethereum, arbitrum, optimism, polygon, bsc.`,
    };
  }
  return { ok: true, value: EVM_CHAINS[key] };
}

export interface ParsedPerpCoin {
  raw: string;
  stripped: string;
  lookupKey: string;
}

export function parsePerpCoin(raw: string | undefined): ValidationResult<ParsedPerpCoin> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, error: "Query parameter 'coin' is required." };
  }
  if (raw.length > 64) {
    return { ok: false, error: "Invalid coin symbol (input too long)." };
  }
  const result = perpCoinSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Invalid coin symbol.",
    };
  }
  const stripped = result.data.replace(/-perp$/i, "");
  return {
    ok: true,
    value: {
      raw: result.data,
      stripped,
      lookupKey: stripped.toLowerCase(),
    },
  };
}

export function clampLimit(raw: string | undefined, defaultVal = 50): number {
  if (!raw) return defaultVal;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return defaultVal;
  return Math.min(100, Math.max(1, parsed));
}
