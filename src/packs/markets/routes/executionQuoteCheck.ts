import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import {
  parseEvmAddress,
  parseEvmChain,
  parsePerpCoin,
  type ValidationResult,
} from "../../../lib/validation";
import { fetchDexScreenerEvmPairs } from "../providers/dexscreener";
import {
  fetchHyperliquidL2Book,
  fetchHyperliquidMetaMap,
} from "../providers/hyperliquid";
import {
  DEFAULT_USDC_BY_CHAIN,
  fetchKyberSwapRoute,
  findKnownQuoteToken,
  usdToRawTokenUnits,
} from "../providers/kyberswap";
import { createWaitUntil } from "../../../middleware/telemetry";
import {
  type EvmTierInput,
  computeEvmQuoteCheck,
  computePerpsQuoteCheck,
} from "../services/executionQuoteCheck";
import type {
  AppBindings,
  CacheStatus,
  DexScreenerAggregated,
  QuoteCheckMode,
  QuoteCheckPerpSide,
} from "../../../types";

export interface ExecutionQuoteCheckDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

const DEFAULT_EVM_SIZES_USD = [1_000, 10_000, 50_000] as const;
const DEFAULT_PERPS_SIZES_USD = [1_000, 10_000, 50_000, 100_000] as const;
const MIN_SIZE_USD = 10;
const MAX_EVM_SIZE_USD = 10_000_000;
const MAX_PERPS_SIZE_USD = 50_000_000;

function parseMode(raw: string | undefined): ValidationResult<QuoteCheckMode> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, error: "Query parameter 'mode' is required ('evm' or 'perps')." };
  }
  const norm = raw.trim().toLowerCase();
  if (norm === "evm" || norm === "perps") {
    return { ok: true, value: norm };
  }
  return { ok: false, error: `Invalid mode '${raw.trim()}'. Expected 'evm' or 'perps'.` };
}

function parsePerpSide(raw: string | undefined): ValidationResult<QuoteCheckPerpSide> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: "both" };
  }
  const norm = raw.trim().toLowerCase();
  if (norm === "buy" || norm === "sell" || norm === "both") {
    return { ok: true, value: norm };
  }
  return { ok: false, error: `Invalid side '${raw.trim()}'. Expected 'buy', 'sell', or 'both'.` };
}

function parseSizesUsd(
  raw: string | undefined,
  defaults: readonly number[],
  maxTiers: number,
  maxSizeUsd: number
): ValidationResult<number[]> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: [...defaults] };
  }
  if (raw.length > 128) {
    return { ok: false, error: "Query parameter 'sizes_usd' is too long." };
  }

  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length === 0 || parts.length > maxTiers) {
    return {
      ok: false,
      error: `Query parameter 'sizes_usd' accepts between 1 and ${maxTiers} comma-separated USD tiers.`,
    };
  }

  const deduped = new Set<number>();
  for (const part of parts) {
    if (part.length === 0) {
      return { ok: false, error: "Empty entry in 'sizes_usd'." };
    }
    const num = Number(part);
    if (!Number.isFinite(num) || Number.isNaN(num) || num < MIN_SIZE_USD || num > maxSizeUsd) {
      return {
        ok: false,
        error: `Each tier in 'sizes_usd' must be between ${MIN_SIZE_USD} and ${maxSizeUsd}.`,
      };
    }
    deduped.add(Math.round(num * 100) / 100);
  }

  return { ok: true, value: Array.from(deduped).sort((a, b) => a - b) };
}

function parseOptionalDecimals(raw: string | undefined): ValidationResult<number | null> {
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: true, value: null };
  }
  if (!/^\d{1,2}$/.test(raw.trim())) {
    return {
      ok: false,
      error: "Query parameter 'token_in_decimals' must be an integer between 0 and 18.",
    };
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (n < 0 || n > 18) {
    return {
      ok: false,
      error: "Query parameter 'token_in_decimals' must be an integer between 0 and 18.",
    };
  }
  return { ok: true, value: n };
}

export function createExecutionQuoteCheckHandler(deps: ExecutionQuoteCheckDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedMode = parseMode(c.req.query("mode"));
    if (!parsedMode.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_MODE");
      return c.json({ error: "INVALID_MODE", message: parsedMode.error }, 400);
    }

    const mode = parsedMode.value;

    const waitUntil = createWaitUntil(c);

    // ===================== MODE: PERPS =====================
    if (mode === "perps") {
      const parsedCoin = parsePerpCoin(c.req.query("coin"));
      if (!parsedCoin.ok) {
        c.set("cache_status", "NONE");
        c.set("upstream_error", "INVALID_COIN");
        return c.json({ error: "INVALID_COIN", message: parsedCoin.error }, 400);
      }

      const parsedSide = parsePerpSide(c.req.query("side"));
      if (!parsedSide.ok) {
        c.set("cache_status", "NONE");
        c.set("upstream_error", "INVALID_SIDE");
        return c.json({ error: "INVALID_SIDE", message: parsedSide.error }, 400);
      }

      const parsedSizes = parseSizesUsd(
        c.req.query("sizes_usd"),
        DEFAULT_PERPS_SIZES_USD,
        4,
        MAX_PERPS_SIZE_USD
      );
      if (!parsedSizes.ok) {
        c.set("cache_status", "NONE");
        c.set("upstream_error", "INVALID_SIZES");
        return c.json({ error: "INVALID_SIZES", message: parsedSizes.error }, 400);
      }

      const { lookupKey, stripped } = parsedCoin.value;
      c.set("query_target", `perps:${stripped}:${parsedSide.value}`);
      c.set("upstream_source", "hyperliquid");

      try {
        const { map, cacheHit: metaHit } = await fetchHyperliquidMetaMap(
          cache,
          fetchImpl,
          waitUntil
        );
        const entry = map.get(lookupKey);

        if (!entry) {
          c.set("cache_status", metaHit ? "HIT" : "MISS");
          c.set("upstream_error", "COIN_NOT_FOUND");
          return c.json(
            {
              error: "COIN_NOT_FOUND",
              message: `Perpetual market '${stripped}' was not found on Hyperliquid. Payment was not settled.`,
            },
            404
          );
        }

        c.set("query_target", `perps:${entry.canonicalName}:${parsedSide.value}`);

        const { book, cacheHit: bookHit } = await fetchHyperliquidL2Book(
          entry.canonicalName,
          cache,
          fetchImpl,
          waitUntil
        );

        const cacheStatus: CacheStatus =
          metaHit && bookHit ? "HIT" : metaHit || bookHit ? "PARTIAL" : "MISS";
        c.set("cache_status", cacheStatus);

        const payload = computePerpsQuoteCheck(entry, book, {
          side: parsedSide.value,
          sizesUsd: parsedSizes.value,
        });
        return c.json(payload, 200);
      } catch (err) {
        const code = err instanceof UpstreamError ? err.code : "HYPERLIQUID_ERROR";
        c.set("cache_status", "MISS");
        c.set("upstream_error", code);
        return c.json(
          {
            error: "UPSTREAM_UNAVAILABLE",
            upstream_error: code,
            message: "Hyperliquid orderbook data is temporarily unavailable. Payment was not settled.",
          },
          502
        );
      }
    }

    // ===================== MODE: EVM =====================
    const parsedChain = parseEvmChain(c.req.query("chain"));
    if (!parsedChain.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_CHAIN");
      return c.json({ error: "INVALID_CHAIN", message: parsedChain.error }, 400);
    }

    const parsedTokenOut = parseEvmAddress(c.req.query("token_out"), "token_out");
    if (!parsedTokenOut.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_TOKEN_OUT");
      return c.json({ error: "INVALID_TOKEN_OUT", message: parsedTokenOut.error }, 400);
    }

    const chain = parsedChain.value;
    const tokenOut = parsedTokenOut.value;
    const rawTokenIn = c.req.query("token_in");
    let tokenIn = DEFAULT_USDC_BY_CHAIN[chain.key].address;

    if (rawTokenIn !== undefined && rawTokenIn.trim().length > 0) {
      const parsedTokenIn = parseEvmAddress(rawTokenIn, "token_in");
      if (!parsedTokenIn.ok) {
        c.set("cache_status", "NONE");
        c.set("upstream_error", "INVALID_TOKEN_IN");
        return c.json({ error: "INVALID_TOKEN_IN", message: parsedTokenIn.error }, 400);
      }
      tokenIn = parsedTokenIn.value;
    }

    if (tokenIn === tokenOut) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_TOKEN_PAIR");
      return c.json(
        {
          error: "INVALID_TOKEN_PAIR",
          message: "Parameters 'token_in' and 'token_out' must be different token addresses.",
        },
        400
      );
    }

    const parsedDecimals = parseOptionalDecimals(c.req.query("token_in_decimals"));
    if (!parsedDecimals.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_TOKEN_IN_DECIMALS");
      return c.json({ error: "INVALID_TOKEN_IN_DECIMALS", message: parsedDecimals.error }, 400);
    }

    const knownIn = findKnownQuoteToken(chain.key, tokenIn);
    const tokenInDecimals = parsedDecimals.value ?? knownIn?.decimals ?? null;
    if (tokenInDecimals === null) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "MISSING_TOKEN_IN_DECIMALS");
      return c.json(
        {
          error: "MISSING_TOKEN_IN_DECIMALS",
          message:
            "Custom 'token_in' is not a built-in quote token; specify 'token_in_decimals' (0-18) or omit 'token_in' to use native USDC.",
        },
        400
      );
    }

    const parsedSizes = parseSizesUsd(
      c.req.query("sizes_usd"),
      DEFAULT_EVM_SIZES_USD,
      3,
      MAX_EVM_SIZE_USD
    );
    if (!parsedSizes.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_SIZES");
      return c.json({ error: "INVALID_SIZES", message: parsedSizes.error }, 400);
    }

    const sizesUsd = parsedSizes.value;
    c.set("query_target", `evm:${chain.key}:${tokenOut}`);
    c.set("upstream_source", "kyberswap,dexscreener");

    const cacheHits: boolean[] = [];
    const activeSources = new Set<string>();

    // Resolve token_in USD price (skip upstream lookup for known $1 stablecoins)
    let tokenInPriceUsd = 1;
    let tokenInSymbol: string | null = knownIn?.symbol ?? null;

    if (!knownIn?.isStablecoin) {
      try {
        const inSpot = await fetchDexScreenerEvmPairs(chain, tokenIn, cache, fetchImpl, waitUntil);
        cacheHits.push(inSpot.cacheHit);
        activeSources.add(inSpot.source);
        if (inSpot.data.priceUsd === null || inSpot.data.priceUsd <= 0) {
          c.set("cache_status", inSpot.cacheHit ? "HIT" : "MISS");
          c.set("upstream_error", "TOKEN_IN_PRICE_NOT_FOUND");
          return c.json(
            {
              error: "TOKEN_NOT_FOUND",
              message: `Could not resolve spot USD price for custom token_in ${tokenIn} on ${chain.key}. Payment was not settled.`,
            },
            404
          );
        }
        tokenInPriceUsd = inSpot.data.priceUsd;
        tokenInSymbol = tokenInSymbol ?? inSpot.data.symbol;
      } catch (err) {
        const code = err instanceof UpstreamError ? err.code : "DEXSCREENER_ERROR";
        c.set("cache_status", "MISS");
        c.set("upstream_error", code);
        return c.json(
          {
            error: "UPSTREAM_UNAVAILABLE",
            upstream_error: code,
            message:
              "DEX spot pricing for custom token_in is temporarily unavailable. Payment was not settled.",
          },
          502
        );
      }
    }

    const rawAmounts = sizesUsd.map((sizeUsd) =>
      usdToRawTokenUnits(sizeUsd, tokenInPriceUsd, tokenInDecimals)
    );

    const [dexOutSettled, ...kyberSettled] = await Promise.allSettled([
      fetchDexScreenerEvmPairs(chain, tokenOut, cache, fetchImpl, waitUntil),
      ...rawAmounts.map((amountInRaw) => {
        if (!amountInRaw) {
          return Promise.resolve({
            status: "no_route" as const,
            reason: "Amount too small for token_in decimals",
            cacheHit: false,
          });
        }
        return fetchKyberSwapRoute({
          chain: chain.key,
          tokenIn,
          tokenOut,
          amountInRaw,
          cache,
          fetchImpl,
          waitUntil,
        });
      }),
    ]);

    let dexOut: DexScreenerAggregated | null = null;
    let dexOutErrCode: string | null = null;
    if (dexOutSettled.status === "fulfilled") {
      dexOut = dexOutSettled.value.data;
      cacheHits.push(dexOutSettled.value.cacheHit);
      activeSources.add(dexOutSettled.value.source);
    } else {
      dexOutErrCode =
        dexOutSettled.reason instanceof UpstreamError
          ? dexOutSettled.reason.code
          : "DEXSCREENER_ERROR";
    }

    let kyberUpstreamErrorCount = 0;
    let firstKyberErrCode: string | null = null;
    let anyExecutableRoute = false;

    const tierInputs: EvmTierInput[] = sizesUsd.map((sizeUsd, idx) => {
      const res = kyberSettled[idx];
      const amountInRaw = rawAmounts[idx] ?? null;
      if (!res || res.status === "rejected") {
        kyberUpstreamErrorCount += 1;
        const errCode =
          res && res.status === "rejected" && res.reason instanceof UpstreamError
            ? res.reason.code
            : "KYBERSWAP_ERROR";
        if (!firstKyberErrCode) {
          firstKyberErrCode = errCode;
        }
        return {
          sizeUsd,
          amountInRaw,
          quote: null,
          failureReason: errCode,
        };
      }

      cacheHits.push(res.value.cacheHit);
      if (res.value.status === "ok") {
        anyExecutableRoute = true;
        return {
          sizeUsd,
          amountInRaw,
          quote: res.value.quote,
          failureReason: null,
        };
      }

      return {
        sizeUsd,
        amountInRaw,
        quote: null,
        failureReason: res.value.reason,
      };
    });

    // Fail closed if ANY KyberSwap quote tier errored upstream (never downgrade/charge on partial outage)
    if (kyberUpstreamErrorCount > 0) {
      const code = firstKyberErrCode ?? "KYBERSWAP_UNAVAILABLE";
      c.set("cache_status", cacheHits.some(Boolean) ? "PARTIAL" : "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "KyberSwap aggregator is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    // If no route exists across any tier:
    // - If DEX Screener failed, fail closed (502) rather than misreporting unknown token as ILLIQUID 200
    // - If DEX Screener confirmed zero pools -> 404 unsettled
    if (!anyExecutableRoute && dexOut === null) {
      const code = dexOutErrCode ?? "DEXSCREENER_UNAVAILABLE";
      c.set("cache_status", cacheHits.some(Boolean) ? "PARTIAL" : "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message:
            "No KyberSwap route found and DEX market data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    if (!anyExecutableRoute && dexOut !== null && dexOut.pairCount === 0) {
      c.set("cache_status", cacheHits.some(Boolean) ? "PARTIAL" : "MISS");
      c.set("upstream_error", "NO_LIQUIDITY_ROUTE");
      return c.json(
        {
          error: "TOKEN_NOT_FOUND",
          message: `No ${chain.key} DEX pools or KyberSwap liquidity routes found for ${tokenOut}. Payment was not settled.`,
        },
        404
      );
    }

    activeSources.add("kyberswap");
    const sourcesList = Array.from(activeSources);
    const allHit = cacheHits.length > 0 && cacheHits.every(Boolean);
    const anyHit = cacheHits.some(Boolean);
    const cacheStatus: CacheStatus = allHit ? "HIT" : anyHit ? "PARTIAL" : "MISS";

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", sourcesList.join(","));

    const payload = computeEvmQuoteCheck(tierInputs, {
      chain,
      tokenIn: {
        address: tokenIn,
        symbol: tokenInSymbol,
        decimals: tokenInDecimals,
        priceUsd: tokenInPriceUsd,
      },
      tokenOutAddress: tokenOut,
      dexOut,
      sources: sourcesList,
    });

    return c.json(payload, 200);
  };
}

export const executionQuoteCheckHandler = createExecutionQuoteCheckHandler();
