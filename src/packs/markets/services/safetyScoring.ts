import { DISCLAIMER } from "../../../config/catalog";
import type {
  DexScreenerAggregated,
  RiskTier,
  RugCheckSummary,
  SolanaSafetyResponse,
} from "../../../types";

export function classifyRiskTier(score: number): RiskTier {
  if (score <= 24) return "LOW";
  if (score <= 49) return "MODERATE";
  if (score <= 74) return "ELEVATED";
  return "CRITICAL";
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

export function computeSolanaSafety(
  mint: string,
  rugcheck: RugCheckSummary,
  dex: DexScreenerAggregated,
  fetchedAtIso: string = new Date().toISOString(),
  marketSource: "dexscreener" | "geckoterminal" = "dexscreener"
): SolanaSafetyResponse {
  const flags: string[] = [];
  let score = 0;

  // 1. Base score from RugCheck (contributes up to 50 points)
  if (
    rugcheck.scoreNormalised !== null &&
    Number.isFinite(rugcheck.scoreNormalised) &&
    rugcheck.scoreNormalised >= 0
  ) {
    const clampedNorm = Math.min(100, Math.max(0, rugcheck.scoreNormalised));
    score += Math.round(clampedNorm * 0.5);
  } else if (
    rugcheck.rawScore !== null &&
    Number.isFinite(rugcheck.rawScore) &&
    rugcheck.rawScore >= 0
  ) {
    score += Math.min(50, Math.round(rugcheck.rawScore / 100));
  }

  // 2. Risk item severity counts & key authority flags from RugCheck
  let dangerCount = 0;
  let warnCount = 0;
  let mintAuthorityFlagged = false;
  let freezeAuthorityFlagged = false;
  let mutableMetadataFlagged = false;
  for (const risk of rugcheck.risks) {
    const level = risk.level.toLowerCase();
    const label = `${risk.name} ${risk.description}`.toLowerCase();
    if (level === "danger" || level === "error" || level === "critical") {
      dangerCount += 1;
    } else if (level === "warn" || level === "warning") {
      warnCount += 1;
    }
    if (label.includes("mint authority")) mintAuthorityFlagged = true;
    if (label.includes("freeze authority")) freezeAuthorityFlagged = true;
    if (label.includes("mutable metadata")) mutableMetadataFlagged = true;
  }

  if (dangerCount > 0) {
    score += Math.min(40, dangerCount * 20);
    flags.push("RUGCHECK_DANGER_RISKS");
  }
  if (warnCount > 0) {
    score += Math.min(24, warnCount * 8);
    flags.push("RUGCHECK_WARN_RISKS");
  }

  // 3. Liquidity depth assessment
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

  // 4. LP lock coverage (strictly preserves null; skips CLMM blue-chip penalty >= $1M liquidity)
  const lpLockedPct =
    rugcheck.lpLockedPct !== null && Number.isFinite(rugcheck.lpLockedPct)
      ? Math.min(100, Math.max(0, rugcheck.lpLockedPct))
      : null;

  if (lpLockedPct === null) {
    score += 5;
    flags.push("LP_LOCK_UNKNOWN");
  } else if (lpLockedPct < 50 && liquidity < 1_000_000) {
    score += 12;
    flags.push("LOW_LP_LOCK");
  }

  // 5. Market structural anomaly checks (division guarded)
  const volToLiq = safePositiveRatio(volume24h, liquidity);
  const volToLiqRounded = volToLiq !== null ? Math.round(volToLiq * 10_000) / 10_000 : null;
  const fdvToLiq =
    dex.fdvUsd !== null ? safePositiveRatio(dex.fdvUsd, liquidity) : null;
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

  const finalScore = Math.min(100, Math.max(0, Math.round(score)));
  const riskTier = classifyRiskTier(finalScore);

  return {
    mint,
    symbol: dex.symbol,
    name: dex.name,
    risk_score: finalScore,
    risk_tier: riskTier,
    flags,
    security: {
      rugcheck_score: rugcheck.rawScore,
      rugcheck_score_normalized: rugcheck.scoreNormalised,
      lp_locked_pct: lpLockedPct,
      mint_authority_flagged: mintAuthorityFlagged,
      freeze_authority_flagged: freezeAuthorityFlagged,
      mutable_metadata_flagged: mutableMetadataFlagged,
      risk_count: rugcheck.risks.length,
      danger_count: dangerCount,
      warn_count: warnCount,
      risks: rugcheck.risks,
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
      primary_dex: dex.primaryDex,
      primary_pair_address: dex.primaryPairAddress,
    },
    metadata: {
      fetched_at: fetchedAtIso,
      sources: ["rugcheck", marketSource],
      disclaimer: DISCLAIMER,
    },
  };
}
