import type { Context } from "hono";
import { BoundedTtlCache, isolateCache } from "../../../lib/cache";
import { UpstreamError } from "../../../lib/http";
import { parseEvmAddress, parseEvmChain } from "../../../lib/validation";
import { fetchDexScreenerEvmPairs } from "../providers/dexscreener";
import { fetchGoPlusTokenSecurity } from "../providers/goplus";
import {
  type HoneypotIsProviderResult,
  fetchHoneypotIsResult,
} from "../providers/honeypotIs";
import { createWaitUntil } from "../../../middleware/telemetry";
import { computeEvmSafety } from "../services/evmSafetyScoring";
import type {
  AppBindings,
  CacheStatus,
  EvmEngineStatus,
  GoPlusTokenSecurity,
  HoneypotIsResult,
} from "../../../types";

export interface EvmSafetyDeps {
  cache?: BoundedTtlCache;
  fetchImpl?: typeof fetch;
}

export function createEvmSafetyHandler(deps: EvmSafetyDeps = {}) {
  const cache = deps.cache ?? isolateCache;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (c: Context<AppBindings>) => {
    const parsedAddress = parseEvmAddress(c.req.query("address"));
    if (!parsedAddress.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_ADDRESS");
      return c.json(
        {
          error: "INVALID_ADDRESS",
          message: parsedAddress.error,
        },
        400
      );
    }

    const parsedChain = parseEvmChain(c.req.query("chain"));
    if (!parsedChain.ok) {
      c.set("cache_status", "NONE");
      c.set("upstream_error", "INVALID_CHAIN");
      return c.json(
        {
          error: "INVALID_CHAIN",
          message: parsedChain.error,
        },
        400
      );
    }

    const address = parsedAddress.value;
    const chain = parsedChain.value;
    c.set("query_target", `${chain.key}:${address}`);
    c.set(
      "upstream_source",
      chain.honeypotSupported ? "goplus,honeypot_is,dexscreener" : "goplus,dexscreener"
    );

    const waitUntil = createWaitUntil(c);
    const [goplusSettled, honeypotSettled, dexSettled] = await Promise.allSettled([
      fetchGoPlusTokenSecurity(chain.chainId, address, cache, fetchImpl, waitUntil),
      chain.honeypotSupported
        ? fetchHoneypotIsResult(chain.chainId, address, cache, fetchImpl, waitUntil)
        : Promise.resolve<HoneypotIsProviderResult | null>(null),
      fetchDexScreenerEvmPairs(chain, address, cache, fetchImpl, waitUntil),
    ]);

    if (dexSettled.status === "rejected") {
      const code =
        dexSettled.reason instanceof UpstreamError
          ? dexSettled.reason.code
          : "DEXSCREENER_ERROR";
      c.set("cache_status", "MISS");
      c.set("upstream_error", code);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: code,
          message: "EVM DEX market data is temporarily unavailable. Payment was not settled.",
        },
        502
      );
    }

    const dex = dexSettled.value;
    const cacheHits: boolean[] = [dex.cacheHit];

    let goplusData: GoPlusTokenSecurity | null = null;
    let goplusStatus: EvmEngineStatus = "unavailable";
    let goplusErrCode: string | null = null;

    if (goplusSettled.status === "fulfilled") {
      if (goplusSettled.value.status === "ok") {
        goplusData = goplusSettled.value.data;
        goplusStatus = "ok";
        cacheHits.push(goplusSettled.value.cacheHit);
      } else {
        goplusStatus = "not_found";
      }
    } else {
      goplusErrCode =
        goplusSettled.reason instanceof UpstreamError
          ? goplusSettled.reason.code
          : "GOPLUS_ERROR";
    }

    let honeypotData: HoneypotIsResult | null = null;
    let honeypotStatus: EvmEngineStatus = chain.honeypotSupported
      ? "unavailable"
      : "unsupported_chain";
    let honeypotErrCode: string | null = null;

    if (chain.honeypotSupported) {
      if (honeypotSettled.status === "fulfilled" && honeypotSettled.value !== null) {
        if (honeypotSettled.value.status === "ok") {
          honeypotData = honeypotSettled.value.data;
          honeypotStatus = "ok";
          cacheHits.push(honeypotSettled.value.cacheHit);
        } else {
          honeypotStatus = "not_found";
        }
      } else if (honeypotSettled.status === "rejected") {
        honeypotErrCode =
          honeypotSettled.reason instanceof UpstreamError
            ? honeypotSettled.reason.code
            : "HONEYPOT_IS_ERROR";
      }
    }

    // Fail-closed invariant: never score or settle without at least one security engine
    if (goplusData === null && honeypotData === null) {
      const anyUpstreamError = goplusErrCode !== null || honeypotErrCode !== null;
      c.set("cache_status", dex.cacheHit ? "PARTIAL" : "MISS");

      if (!anyUpstreamError && dex.data.pairCount === 0) {
        c.set("upstream_error", "TOKEN_NOT_FOUND");
        return c.json(
          {
            error: "TOKEN_NOT_FOUND",
            message: `No security report or ${chain.key} DEX pairs found for ${address}. Payment was not settled.`,
          },
          404
        );
      }

      const errorCode =
        goplusErrCode ??
        honeypotErrCode ??
        (chain.honeypotSupported ? "EVM_SECURITY_NOT_FOUND" : "GOPLUS_NOT_FOUND");

      c.set("upstream_error", errorCode);
      return c.json(
        {
          error: "UPSTREAM_UNAVAILABLE",
          upstream_error: errorCode,
          message:
            "EVM security engines are unavailable for this token; refusing to score without risk data. Payment was not settled.",
        },
        502
      );
    }

    const allHit = cacheHits.every(Boolean);
    const anyHit = cacheHits.some(Boolean);
    const cacheStatus: CacheStatus = allHit ? "HIT" : anyHit ? "PARTIAL" : "MISS";

    const activeSources: string[] = [];
    if (goplusData !== null) activeSources.push("goplus");
    if (honeypotData !== null) activeSources.push("honeypot_is");
    activeSources.push(dex.source);

    c.set("cache_status", cacheStatus);
    c.set("upstream_source", activeSources.join(","));

    const payload = computeEvmSafety(address, chain, goplusData, honeypotData, dex.data, {
      fetchedAtIso: new Date().toISOString(),
      marketSource: dex.source,
      goplusStatus,
      honeypotStatus,
    });

    return c.json(payload, 200);
  };
}

export const evmSafetyHandler = createEvmSafetyHandler();
