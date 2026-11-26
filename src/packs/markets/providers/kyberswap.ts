import {
  type BoundedTtlCache,
  TTL_MS,
  isolateCache,
  withTwoTierCache,
} from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";
import type { EvmChainKey, KyberSwapRouteQuote } from "../../../types";

const KYBERSWAP_API_BASE = "https://aggregator-api.kyberswap.com";
export const KYBERSWAP_CLIENT_ID = "exactjson";

export interface KnownEvmQuoteToken {
  address: string;
  symbol: string;
  decimals: number;
  isStablecoin: boolean;
}

export const DEFAULT_USDC_BY_CHAIN: Record<EvmChainKey, KnownEvmQuoteToken> = {
  base: {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: 6,
    isStablecoin: true,
  },
  ethereum: {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    decimals: 6,
    isStablecoin: true,
  },
  arbitrum: {
    address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    symbol: "USDC",
    decimals: 6,
    isStablecoin: true,
  },
  optimism: {
    address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    symbol: "USDC",
    decimals: 6,
    isStablecoin: true,
  },
  polygon: {
    address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    symbol: "USDC",
    decimals: 6,
    isStablecoin: true,
  },
  bsc: {
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    symbol: "USDC",
    decimals: 18,
    isStablecoin: true,
  },
};

const KNOWN_QUOTE_TOKENS: Record<EvmChainKey, readonly KnownEvmQuoteToken[]> = {
  base: [
    DEFAULT_USDC_BY_CHAIN.base,
    {
      address: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      symbol: "USDbC",
      decimals: 6,
      isStablecoin: true,
    },
    {
      address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
      symbol: "DAI",
      decimals: 18,
      isStablecoin: true,
    },
    {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
      isStablecoin: false,
    },
  ],
  ethereum: [
    DEFAULT_USDC_BY_CHAIN.ethereum,
    {
      address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      symbol: "USDT",
      decimals: 6,
      isStablecoin: true,
    },
    {
      address: "0x6b175474e89094c44da98b954eedeac495271d0f",
      symbol: "DAI",
      decimals: 18,
      isStablecoin: true,
    },
    {
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      symbol: "WETH",
      decimals: 18,
      isStablecoin: false,
    },
  ],
  arbitrum: [
    DEFAULT_USDC_BY_CHAIN.arbitrum,
    {
      address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
      symbol: "USDT",
      decimals: 6,
      isStablecoin: true,
    },
    {
      address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
      symbol: "DAI",
      decimals: 18,
      isStablecoin: true,
    },
    {
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      symbol: "WETH",
      decimals: 18,
      isStablecoin: false,
    },
  ],
  optimism: [
    DEFAULT_USDC_BY_CHAIN.optimism,
    {
      address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
      symbol: "USDT",
      decimals: 6,
      isStablecoin: true,
    },
    {
      address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
      symbol: "DAI",
      decimals: 18,
      isStablecoin: true,
    },
    {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
      isStablecoin: false,
    },
  ],
  polygon: [
    DEFAULT_USDC_BY_CHAIN.polygon,
    {
      address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      symbol: "USDT",
      decimals: 6,
      isStablecoin: true,
    },
    {
      address: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
      symbol: "DAI",
      decimals: 18,
      isStablecoin: true,
    },
    {
      address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
      symbol: "WPOL",
      decimals: 18,
      isStablecoin: false,
    },
  ],
  bsc: [
    DEFAULT_USDC_BY_CHAIN.bsc,
    {
      address: "0x55d398326f99059ff775485246999027b3197955",
      symbol: "USDT",
      decimals: 18,
      isStablecoin: true,
    },
    {
      address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      symbol: "WBNB",
      decimals: 18,
      isStablecoin: false,
    },
  ],
};

export function findKnownQuoteToken(
  chain: EvmChainKey,
  address: string
): KnownEvmQuoteToken | null {
  const lower = address.toLowerCase();
  const list = KNOWN_QUOTE_TOKENS[chain];
  for (const item of list) {
    if (item.address === lower) return item;
  }
  return null;
}

/**
 * Converts a USD notional amount into raw integer token units string without
 * floating-point scientific notation or 53-bit integer overflow.
 */
function parsePositiveDecimal(value: number): { digits: bigint; scale: number } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const [mantissaPart, expPart] = value.toString().toLowerCase().split("e");
  if (!mantissaPart) return null;
  const exp = expPart ? Number.parseInt(expPart, 10) : 0;
  if (!Number.isFinite(exp)) return null;

  const [intPart = "0", fracPart = ""] = mantissaPart.split(".");
  const combined = `${intPart}${fracPart}`.replace(/^0+/, "");
  if (!combined || !/^\d+$/.test(combined)) return null;

  return { digits: BigInt(combined), scale: fracPart.length - exp };
}

export function usdToRawTokenUnits(
  usdAmount: number,
  tokenPriceUsd: number,
  decimals: number
): string | null {
  if (
    !Number.isFinite(usdAmount) ||
    usdAmount <= 0 ||
    !Number.isFinite(tokenPriceUsd) ||
    tokenPriceUsd <= 0 ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    return null;
  }

  const tokenUnits = usdAmount / tokenPriceUsd;
  if (!Number.isFinite(tokenUnits) || tokenUnits <= 0 || tokenUnits >= 1e20) {
    return null;
  }

  const u = parsePositiveDecimal(usdAmount);
  const p = parsePositiveDecimal(tokenPriceUsd);
  if (!u || !p) return null;

  const totalExp = decimals + p.scale - u.scale;
  if (totalExp < -60 || totalExp > 60) return null;

  const raw =
    totalExp >= 0
      ? (u.digits * BigInt("1" + "0".repeat(totalExp))) / p.digits
      : u.digits / (p.digits * BigInt("1" + "0".repeat(-totalExp)));

  return raw > BigInt(0) ? raw.toString() : null;
}

interface RawKyberHop {
  exchange?: unknown;
}

interface RawKyberRouteSummary {
  tokenIn?: unknown;
  amountIn?: unknown;
  amountInUsd?: unknown;
  tokenOut?: unknown;
  amountOut?: unknown;
  amountOutUsd?: unknown;
  gas?: unknown;
  gasUsd?: unknown;
  route?: unknown;
}

interface RawKyberResponse {
  code?: unknown;
  message?: unknown;
  data?: {
    routeSummary?: RawKyberRouteSummary;
    routerAddress?: unknown;
  };
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value.trim());
}

export type KyberSwapParsedOutcome =
  | { status: "ok"; quote: KyberSwapRouteQuote }
  | { status: "no_route"; reason: string };

export function parseKyberSwapResponse(
  chain: EvmChainKey,
  tokenIn: string,
  tokenOut: string,
  amountInRaw: string,
  raw: unknown
): KyberSwapParsedOutcome {
  if (raw === null || typeof raw !== "object") {
    throw new UpstreamError(
      "KYBERSWAP",
      "KYBERSWAP_BAD_PAYLOAD",
      "Unexpected KyberSwap payload shape"
    );
  }

  const payload = raw as RawKyberResponse;
  const code = toFiniteNumber(payload.code);
  const message =
    typeof payload.message === "string" && payload.message.trim().length > 0
      ? payload.message.trim()
      : "No executable swap route found";

  const summary = payload.data?.routeSummary;
  if (code !== null && code !== 0) {
    const isRateLimit = code === 429 || /rate\s*limit|too\s*many/i.test(message);
    const isServerErr =
      (code >= 500 && code < 600) ||
      code >= 5000 ||
      /internal\s*server|service\s*unavailable|timed?\s*out|bad\s*gateway/i.test(message);
    if (isRateLimit) {
      throw new UpstreamError("KYBERSWAP", "KYBERSWAP_429", `KyberSwap rate limited: ${message}`, 429);
    }
    if (isServerErr) {
      throw new UpstreamError("KYBERSWAP", "KYBERSWAP_5XX", `KyberSwap error (${code}): ${message}`, 502);
    }
    return { status: "no_route", reason: message };
  }
  if (!summary || !isPositiveIntegerString(summary.amountOut)) {
    return { status: "no_route", reason: message };
  }

  const dexSet = new Set<string>();
  let routeHops = 0;

  if (Array.isArray(summary.route)) {
    for (const splitPath of summary.route) {
      if (!Array.isArray(splitPath)) continue;
      for (const hop of splitPath as RawKyberHop[]) {
        routeHops += 1;
        if (hop && typeof hop.exchange === "string" && hop.exchange.trim().length > 0) {
          dexSet.add(hop.exchange.trim());
        }
      }
    }
  }

  const amountInUsd = toFiniteNumber(summary.amountInUsd);
  const amountOutUsd = toFiniteNumber(summary.amountOutUsd);
  const gasUnits = toFiniteNumber(summary.gas);
  const gasUsd = toFiniteNumber(summary.gasUsd);

  return {
    status: "ok",
    quote: {
      chain,
      tokenIn: tokenIn.toLowerCase(),
      tokenOut: tokenOut.toLowerCase(),
      amountInRaw: isPositiveIntegerString(summary.amountIn)
        ? summary.amountIn.trim()
        : amountInRaw,
      amountOutRaw: summary.amountOut.trim(),
      amountInUsd: amountInUsd !== null && amountInUsd > 0 ? amountInUsd : null,
      amountOutUsd: amountOutUsd !== null && amountOutUsd > 0 ? amountOutUsd : null,
      gasUnits: gasUnits !== null && gasUnits >= 0 ? Math.round(gasUnits) : null,
      gasUsd: gasUsd !== null && gasUsd >= 0 ? gasUsd : null,
      dexesUsed: Array.from(dexSet).sort(),
      routeHops,
      routerAddress:
        typeof payload.data?.routerAddress === "string"
          ? payload.data.routerAddress.toLowerCase()
          : null,
    },
  };
}

export type KyberSwapProviderResult =
  | { status: "ok"; quote: KyberSwapRouteQuote; cacheHit: boolean }
  | { status: "no_route"; reason: string; cacheHit: boolean };

interface CachedKyberEntry {
  status: "ok" | "no_route";
  quote?: KyberSwapRouteQuote;
  reason?: string;
}

export async function fetchKyberSwapRoute(params: {
  chain: EvmChainKey;
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<KyberSwapProviderResult> {
  const {
    chain,
    tokenIn,
    tokenOut,
    amountInRaw,
    cache = isolateCache,
    fetchImpl = fetch,
    waitUntil,
  } = params;

  const normIn = tokenIn.toLowerCase();
  const normOut = tokenOut.toLowerCase();
  const cacheKey = `kyberswap:route:${chain}:${normIn}:${normOut}:${amountInRaw}`;

  const { value, cacheHit } = await withTwoTierCache<CachedKyberEntry>({
    key: cacheKey,
    ttlMs: TTL_MS.KYBERSWAP_QUOTE,
    cache,
    waitUntil,
    fetcher: async () => {
      const url =
        `${KYBERSWAP_API_BASE}/${encodeURIComponent(chain)}/api/v1/routes` +
        `?tokenIn=${encodeURIComponent(normIn)}` +
        `&tokenOut=${encodeURIComponent(normOut)}` +
        `&amountIn=${encodeURIComponent(amountInRaw)}`;

      let parsed: KyberSwapParsedOutcome;
      try {
        const res = await fetchJsonWithTimeout<unknown>(url, {
          provider: "KYBERSWAP",
          method: "GET",
          headers: {
            "x-client-id": KYBERSWAP_CLIENT_ID,
          },
          allow404: true,
          fetchImpl,
        });

        if (res.status === "not_found") {
          parsed = { status: "no_route", reason: "KyberSwap route not found (404)" };
        } else {
          parsed = parseKyberSwapResponse(chain, normIn, normOut, amountInRaw, res.data);
        }
      } catch (err) {
        if (err instanceof UpstreamError && err.httpStatus === 422) {
          parsed = { status: "no_route", reason: "KyberSwap route unexecutable (422)" };
        } else {
          throw err;
        }
      }

      return parsed.status === "ok"
        ? { status: "ok", quote: parsed.quote }
        : { status: "no_route", reason: parsed.reason };
    },
  });

  if (value.status === "ok" && value.quote) {
    return { status: "ok", quote: value.quote, cacheHit };
  }
  return {
    status: "no_route",
    reason: value.reason ?? "No executable swap route found",
    cacheHit,
  };
}
