import { DISCLAIMER } from "../config/catalog";
import type {
  DexScreenerAggregated,
  EvmChainConfig,
  EvmEngineStatus,
  EvmSafetyResponse,
  GoPlusTokenSecurity,
  HoneypotIsResult,
} from "../types";
import { classifyRiskTier } from "./safetyScoring";

export interface EvmSafetyScoringOptions {
  fetchedAtIso?: string;
  marketSource?: "dexscreener" | "geckoterminal";
  goplusStatus?: EvmEngineStatus;
  honeypotStatus?: EvmEngineStatus;
}

function safePositiveRatio(numerator: number, denominator: number): number | null {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    numerator < 0
  ) {
    return null;
  }
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

function maxNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  const validA = typeof a === "number" && Number.isFinite(a) ? a : null;
  const validB = typeof b === "number" && Number.isFinite(b) ? b : null;
  if (validA !== null && validB !== null) return Math.max(validA, validB);
  return validA ?? validB;
}

function computePairAgeHours(earliestPairCreatedAt: string | null | undefined, nowIso: string): number | null {
  if (!earliestPairCreatedAt) return null;
  const createdMs = Date.parse(earliestPairCreatedAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs) || createdMs > nowMs) {
    return null;
  }
  const hours = (nowMs - createdMs) / 3_600_000;
  return Math.round(hours * 10) / 10;
}

export function computeEvmSafety(
  address: string,
  chain: EvmChainConfig,
  goplus: GoPlusTokenSecurity | null,
  honeypot: HoneypotIsResult | null,
  dex: DexScreenerAggregated,
  options: EvmSafetyScoringOptions = {}
): EvmSafetyResponse {
  const fetchedAtIso = options.fetchedAtIso ?? new Date().toISOString();
  const marketSource = options.marketSource ?? "dexscreener";
  const goplusStatus: EvmEngineStatus = options.goplusStatus ?? (goplus ? "ok" : "unavailable");
  const honeypotStatus: EvmEngineStatus =
    options.honeypotStatus ??
    (honeypot ? "ok" : chain.honeypotSupported ? "unavailable" : "unsupported_chain");

  const flags: string[] = [];
  let score = 0;

  // 1. Honeypot & simulation consensus
  const goplusHoneypot = goplus?.isHoneypot ?? null;
  const honeypotSimFlag = honeypot?.isHoneypot ?? null;
  const engineDisagreement =
    goplusHoneypot !== null &&
    honeypotSimFlag !== null &&
    goplusHoneypot !== honeypotSimFlag;

  const isHoneypot: boolean | null =
    goplusHoneypot === true || honeypotSimFlag === true
      ? true
      : goplusHoneypot === false || honeypotSimFlag === false
        ? false
        : null;

  if (engineDisagreement) {
    score += 15;
    flags.push("ENGINE_DISAGREEMENT");
  }

  if (isHoneypot === true) {
    score += 75;
    flags.push("HONEYPOT_DETECTED");
  }

  if (honeypot !== null && !honeypot.simulationSuccess) {
    score += 20;
    flags.push("SIMULATION_FAILED");
  }

  if (goplus?.cannotSellAll === true) {
    score += 45;
    flags.push("CANNOT_SELL_ALL");
  }

  if (goplus?.cannotBuy === true) {
    score += 35;
    flags.push("CANNOT_BUY");
  }

  // 2. Effective tax evaluation (conservative max across engines, including transfer tax traps)
  const buyTaxPct = maxNullable(goplus?.buyTaxPct, honeypot?.buyTaxPct);
  const sellTaxPct = maxNullable(goplus?.sellTaxPct, honeypot?.sellTaxPct);
  const transferTaxPct = honeypot?.transferTaxPct ?? null;
  const maxTaxPct = maxNullable(maxNullable(buyTaxPct, sellTaxPct), transferTaxPct);

  if (maxTaxPct !== null) {
    if (maxTaxPct >= 50) {
      score += 45;
      flags.push("EXTREME_TAX");
    } else if (maxTaxPct >= 15) {
      score += 25;
      flags.push("HIGH_TAX");
    } else if (maxTaxPct >= 5) {
      score += 10;
      flags.push("ELEVATED_TAX");
    }
  }

  // 3. Contract privileges & code transparency
  const isOpenSource = goplus?.isOpenSource ?? honeypot?.openSource ?? null;
  const isProxy = goplus?.isProxy ?? honeypot?.isProxy ?? null;

  if (isOpenSource === false) {
    score += 20;
    flags.push("UNVERIFIED_CONTRACT");
  }
  if (goplus?.ownerChangeBalance === true) {
    score += 30;
    flags.push("OWNER_CAN_CHANGE_BALANCE");
  }
  if (goplus?.selfdestruct === true) {
    score += 25;
    flags.push("SELFDESTRUCT_ENABLED");
  }
  if (goplus?.hiddenOwner === true) {
    score += 20;
    flags.push("HIDDEN_OWNER");
  }
  if (goplus?.canTakeBackOwnership === true) {
    score += 20;
    flags.push("RECLAIMABLE_OWNERSHIP");
  }
  if (goplus?.slippageModifiable === true) {
    score += 15;
    flags.push("MODIFIABLE_TAX");
  }
  if (goplus?.isMintable === true) {
    score += 12;
    flags.push("MINTABLE_TOKEN");
  }
  if (goplus?.transferPausable === true) {
    score += 10;
    flags.push("TRANSFER_PAUSABLE");
  }
  if (goplus?.isBlacklisted === true) {
    score += 10;
    flags.push("BLACKLIST_ENABLED");
  }
  if (isProxy === true) {
    score += 8;
    flags.push("PROXY_UPGRADEABLE");
  }

  // 4. Liquidity depth & market anomalies (division guarded)
  const liquidity = Number.isFinite(dex.totalLiquidityUsd)
    ? Math.max(0, dex.totalLiquidityUsd)
    : 0;
  const volume24h = Number.isFinite(dex.volume24hUsd)
    ? Math.max(0, dex.volume24hUsd)
    : 0;

  if (dex.pairCount === 0) {
    score += 25;
    flags.push("NO_DEX_LIQUIDITY");
  } else if (liquidity < 1_000) {
    score += 25;
    flags.push("LOW_OR_NO_LIQUIDITY");
  } else if (liquidity < 10_000) {
    score += 15;
    flags.push("THIN_LIQUIDITY");
  } else if (liquidity < 50_000) {
    score += 5;
    flags.push("MODERATE_LIQUIDITY");
  }

  // 5. Holder concentration & LP lock (preserve nulls; skip deep-pool CLMM LP penalty >= $1M)
  const top10HolderPct = goplus?.top10HolderPct ?? null;
  if (top10HolderPct !== null) {
    if (top10HolderPct >= 50) {
      score += 15;
      flags.push("CONCENTRATED_TOP10_HOLDERS");
    } else if (top10HolderPct >= 30) {
      score += 8;
      flags.push("MODERATE_HOLDER_CONCENTRATION");
    }
  }

  const lpLockedPct =
    goplus?.lpLockedPct !== null &&
    goplus?.lpLockedPct !== undefined &&
    Number.isFinite(goplus.lpLockedPct)
      ? Math.min(100, Math.max(0, goplus.lpLockedPct))
      : null;

  if (liquidity < 1_000_000) {
    if (lpLockedPct === null) {
      score += 5;
      flags.push("LP_LOCK_UNKNOWN");
    } else if (lpLockedPct < 50) {
      score += 12;
      flags.push("LOW_LP_LOCK");
    }
  }

  const volToLiq = safePositiveRatio(volume24h, liquidity);
  const volToLiqRounded = volToLiq !== null ? Math.round(volToLiq * 10_000) / 10_000 : null;
  const fdvToLiq = dex.fdvUsd !== null ? safePositiveRatio(dex.fdvUsd, liquidity) : null;
  const fdvToLiqRounded = fdvToLiq !== null ? Math.round(fdvToLiq * 100) / 100 : null;

  if (volToLiq !== null && volToLiq > 50) {
    score += 8;
    flags.push("EXTREME_VOL_TO_LIQ_RATIO");
  }

  if (
    dex.priceChange24hPct !== null &&
    Number.isFinite(dex.priceChange24hPct) &&
    dex.priceChange24hPct <= -70
  ) {
    score += 10;
    flags.push("SEVERE_24H_DRAWDOWN");
  }

  const pairAgeHours = computePairAgeHours(dex.earliestPairCreatedAt, fetchedAtIso);
  if (pairAgeHours !== null && pairAgeHours < 24) {
    score += 8;
    flags.push("NEW_PAIR_UNDER_24H");
  }

  // 6. Degraded coverage signal on dual-engine chains
  if (chain.honeypotSupported && (goplus === null || honeypot === null)) {
    score += 5;
    flags.push("SINGLE_SECURITY_ENGINE");
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(score)));
  const riskTier = classifyRiskTier(finalScore);

  const sources: string[] = [];
  if (goplus !== null) sources.push("goplus");
  if (honeypot !== null) sources.push("honeypot_is");
  sources.push(marketSource);

  return {
    address: address.toLowerCase(),
    chain: chain.key,
    chain_id: chain.chainId,
    symbol: dex.symbol ?? goplus?.tokenSymbol ?? honeypot?.tokenSymbol ?? null,
    name: dex.name ?? goplus?.tokenName ?? honeypot?.tokenName ?? null,
    risk_score: finalScore,
    risk_tier: riskTier,
    flags,
    security: {
      is_honeypot: isHoneypot,
      engine_disagreement: engineDisagreement,
      simulation_success: honeypot ? honeypot.simulationSuccess : null,
      buy_tax_pct: buyTaxPct,
      sell_tax_pct: sellTaxPct,
      transfer_tax_pct: transferTaxPct,
      is_open_source: isOpenSource,
      is_proxy: isProxy,
      is_mintable: goplus?.isMintable ?? null,
      owner_change_balance: goplus?.ownerChangeBalance ?? null,
      hidden_owner: goplus?.hiddenOwner ?? null,
      can_take_back_ownership: goplus?.canTakeBackOwnership ?? null,
      selfdestruct: goplus?.selfdestruct ?? null,
      cannot_buy: goplus?.cannotBuy ?? null,
      cannot_sell_all: goplus?.cannotSellAll ?? null,
      transfer_pausable: goplus?.transferPausable ?? null,
      is_blacklisted: goplus?.isBlacklisted ?? null,
      slippage_modifiable: goplus?.slippageModifiable ?? null,
      owner_renounced: goplus?.ownerRenounced ?? null,
      holder_count: goplus?.holderCount ?? honeypot?.holderCount ?? null,
      top10_holder_pct: top10HolderPct,
      lp_locked_pct: lpLockedPct,
      engines: {
        goplus: goplusStatus,
        honeypot_is: honeypotStatus,
      },
    },
    market: {
      price_usd: dex.priceUsd,
      liquidity_usd: liquidity,
      volume_24h_usd: volume24h,
      volume_to_liquidity_ratio: volToLiqRounded,
      fdv_usd: dex.fdvUsd,
      fdv_to_liquidity_ratio: fdvToLiqRounded,
      price_change_24h_pct: dex.priceChange24hPct,
      pair_count: dex.pairCount,
      pair_age_hours: pairAgeHours,
      primary_dex: dex.primaryDex,
      primary_pair_address: dex.primaryPairAddress,
    },
    metadata: {
      fetched_at: fetchedAtIso,
      sources,
      disclaimer: DISCLAIMER,
    },
  };
}
