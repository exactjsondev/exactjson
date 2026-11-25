import { DISCLAIMER } from "../config/catalog";
import type {
  PredictionVenueName,
  PredictionsArbConfidence,
  PredictionsArbLeg,
  PredictionsArbOpportunity,
  PredictionsArbQuoteQuality,
  PredictionsArbResponse,
  PredictionsArbStrategy,
  RawPredictionMarket,
} from "../types";

export const MAX_MARKETS_PER_VENUE = 80;
export const EXPIRY_WINDOW_HOURS = 72;
const EXPIRY_WINDOW_MS = EXPIRY_WINDOW_HOURS * 3_600_000;

const MIN_MATCH_SCORE = 0.55;
const HIGH_CONFIDENCE_SCORE = 0.75;
const HOURS_PER_YEAR = 8760;
const MIN_APY_HOURS = 12;
const MAX_APY_PCT = 5000;

// Conservative fee & execution assumptions
const POLYMARKET_BUFFER_USD = 0.002; // 20 bps execution/slippage buffer
const MID_FALLBACK_SLIPPAGE_USD = 0.005; // 50 bps extra penalty per leg without orderbook bid/ask
const FEE_MODEL_DESCRIPTION =
  "Kalshi parabolic taker fee 0.07*p*(1-p) + 20bps Polymarket execution buffer (+50bps/leg if mid fallback)";

const MONTHS = new Set([
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]);

const NUMERIC_UNITS = new Set(["bp", "pct", "usd", "k", "m", "b"]);

const TOKEN_ALIASES: Record<string, string> = {
  bitcoin: "btc",
  ethereum: "eth",
  ether: "eth",
  solana: "sol",
  dogecoin: "doge",
  ripple: "xrp",
  cardano: "ada",
  federal: "fed",
  fomc: "fed",
  cuts: "cut",
  cutting: "cut",
  hikes: "hike",
  hiking: "hike",
  raises: "hike",
  raise: "hike",
  rates: "rate",
  bps: "bp",
  basis: "bp",
  percent: "pct",
  percentage: "pct",
  inflation: "cpi",
  january: "jan",
  february: "feb",
  march: "mar",
  april: "apr",
  june: "jun",
  july: "jul",
  august: "aug",
  september: "sep",
  sept: "sep",
  october: "oct",
  november: "nov",
  december: "dec",
  over: "above",
  exceed: "above",
  exceeds: "above",
  greater: "above",
  higher: "above",
  under: "below",
  less: "below",
  lower: "below",
  wins: "win",
  winning: "win",
  loses: "lose",
  losing: "lose",
  increases: "increase",
  decreases: "decrease",
  approves: "approve",
  approved: "approve",
  rejects: "reject",
  rejected: "reject",
  passes: "pass",
  passed: "pass",
  fails: "fail",
  failed: "fail",
};

const STOPWORDS = new Set([
  "will",
  "the",
  "a",
  "an",
  "be",
  "is",
  "are",
  "was",
  "were",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "before",
  "after",
  "during",
  "or",
  "and",
  "if",
  "as",
  "than",
  "that",
  "this",
  "it",
  "its",
  "their",
  "any",
  "end",
  "trade",
  "trading",
  "price",
  "reach",
  "hit",
  "close",
  "settle",
  "market",
  "event",
  "contract",
  "yes",
  "no",
  "interest",
  "reserve",
  "points",
  "point",
  "us",
  "u",
  "s",
  "united",
  "states",
]);

const ANTONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["above", "below"],
  ["cut", "hike"],
  ["win", "lose"],
  ["increase", "decrease"],
  ["approve", "reject"],
  ["pass", "fail"],
];

const NEGATION_TOKENS = new Set([
  "no",
  "not",
  "never",
  "without",
  "cannot",
  "neither",
  "nor",
]);

const NEGATIVE_CONTRACTION_RE =
  /\b(?:won|don|doesn|didn|isn|aren|wasn|weren|can|couldn|wouldn|shouldn|haven|hasn|hadn)['’]t\b/g;

export function resolveTokenAlias(token: string): string {
  return Object.prototype.hasOwnProperty.call(TOKEN_ALIASES, token)
    ? TOKEN_ALIASES[token]!
    : token;
}

const ORDINAL_DAY_RE = /^([1-9]|[12]\d|3[01])(?:st|nd|rd|th)$/;

function stripAdjacentOrdinalDay(parts: string[]): string[] {
  const canonical = parts.map((p) => resolveTokenAlias(p));
  return parts.map((part, i) => {
    const match = ORDINAL_DAY_RE.exec(part);
    if (!match) return part;
    const prev = i > 0 ? canonical[i - 1]! : "";
    const next = i + 1 < canonical.length ? canonical[i + 1]! : "";
    const next2 = i + 2 < canonical.length ? canonical[i + 2]! : "";
    if (MONTHS.has(prev) || MONTHS.has(next) || (next === "of" && MONTHS.has(next2))) {
      return match[1]!;
    }
    return part;
  });
}

function round(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function normalizeNumberLiteral(numStr: string, suffix: string): string {
  const base = Number(numStr);
  if (!Number.isFinite(base)) return numStr;
  let scaled = base;
  if (suffix === "k") scaled = base * 1_000;
  else if (suffix === "m") scaled = base * 1_000_000;
  else if (suffix === "b") scaled = base * 1_000_000_000;
  if (scaled === 0) return "0";
  return String(Number(scaled.toPrecision(10)));
}

function isPlainNumberToken(tok: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(tok);
}

function isYearToken(tok: string): boolean {
  if (!/^\d{4}$/.test(tok)) return false;
  const n = Number(tok);
  return n >= 2020 && n <= 2039;
}

function isDayOfMonthNumber(tok: string): boolean {
  if (!/^\d{1,2}$/.test(tok)) return false;
  const n = Number(tok);
  return n >= 1 && n <= 31;
}

export interface NormalizedTitle {
  tokens: Set<string>;
  thresholdNumbers: Set<string>;
  hasBetween: boolean;
  hasNegation: boolean;
  hasAfter: boolean;
}

export function normalizeMarketTitle(title: string): NormalizedTitle {
  let cleaned = title.toLowerCase();

  // Strip benign "yes/no" or "yes or no" binary labels and ordinal "no. 1" before negation detection
  cleaned = cleaned.replace(/\byes\s*(?:\/|\bor\b)\s*no\b/g, " ");
  cleaned = cleaned.replace(/\bno\.\s*(?=\d)/g, "number ");

  // Normalize negative contractions (won't, doesn't, can't, etc.) into explicit 'not' token before punctuation stripping
  cleaned = cleaned.replace(NEGATIVE_CONTRACTION_RE, " not ");

  // Preserve leading negative signs on currency values (-$100k, $-100k) and plain numbers (-0.5%, -25bps)
  // while leaving internal hyphens (GPT-5, 2026-12-31, non-farm) untouched as separators.
  cleaned = cleaned.replace(
    /(^|[\s([{(])(?:-\s*\$|\$\s*-)(\d[\d,]*(?:\.\d+)?)/g,
    (_m, lead: string, n: string) => `${lead}neg_cur_${n.replace(/,/g, "")}`
  );

  // Preserve positive currency marker briefly so "$25" is never mistaken for a calendar day
  cleaned = cleaned.replace(/\$(\d[\d,]*(?:\.\d+)?)/g, (_m, n: string) => {
    return ` cur_${n.replace(/,/g, "")}`;
  });

  // Preserve negative sign on standalone numbers (e.g. "-0.5%", "-25bps", "-1.5")
  cleaned = cleaned.replace(
    /(^|[\s([{(])-(\d[\d,]*(?:\.\d+)?)/g,
    (_m, lead: string, n: string) => `${lead}neg_${n.replace(/,/g, "")}`
  );

  // Remove commas inside remaining numbers (e.g. 100,000 -> 100000)
  cleaned = cleaned.replace(/(\d),(\d)/g, "$1$2");
  cleaned = cleaned.replace(/(\d),(\d)/g, "$1$2");

  // Expand multiplier suffixes attached to numbers (e.g. 100k -> 100000, neg_cur_100k -> neg_cur_100000)
  cleaned = cleaned.replace(
    /\b(neg_)?(cur_)?(\d+(?:\.\d+)?)([kmb])\b/g,
    (_m, neg: string | undefined, cur: string | undefined, num: string, suffix: string) => {
      return `${neg ?? ""}${cur ?? ""}${normalizeNumberLiteral(num, suffix)}`;
    }
  );

  // Split glued units: 25bps -> 25 bp, -0.5% -> neg_0.5 pct
  cleaned = cleaned.replace(
    /\b(neg_)?(cur_)?(\d+(?:\.\d+)?)(?:(bps?)\b|%)/g,
    (_m, neg: string | undefined, cur: string | undefined, num: string, bpsUnit: string | undefined) => {
      const normUnit = bpsUnit ? "bp" : "pct";
      return `${neg ?? ""}${cur ?? ""}${normalizeNumberLiteral(num, "")} ${normUnit}`;
    }
  );

  // Normalize standalone % signs
  cleaned = cleaned.replace(/%/g, " pct ");

  // Replace non-alphanumeric separators (keep underscores for neg_/cur_ markers and decimal dots inside numbers)
  cleaned = cleaned.replace(/[^a-z0-9_.]+/g, " ");
  // Remove leading/trailing dots not surrounded by digits
  cleaned = cleaned.replace(/(^|\s)\.+|\.+(\s|$)/g, " ");

  const rawParts = stripAdjacentOrdinalDay(
    cleaned
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  );

  interface TaggedToken {
    token: string;
    isCurrency: boolean;
  }

  const tagged: TaggedToken[] = [];
  let negationCount = 0;
  for (const part of rawParts) {
    let working = part;
    let isNegative = false;
    let isCurrency = false;

    if (working.startsWith("neg_")) {
      isNegative = true;
      working = working.slice(4);
    }
    if (working.startsWith("cur_")) {
      isCurrency = true;
      working = working.slice(4);
    }
    if (!working) continue;

    let canonical = resolveTokenAlias(working);
    if (NEGATION_TOKENS.has(canonical)) {
      negationCount += 1;
    }
    if (isPlainNumberToken(canonical)) {
      canonical = normalizeNumberLiteral(isNegative ? `-${canonical}` : canonical, "");
    }
    tagged.push({ token: canonical, isCurrency });
  }

  const tokens = new Set<string>();
  const thresholdNumbers = new Set<string>();
  let hasBetween = false;
  let hasAfter = false;
  const hasNegation = negationCount % 2 === 1;

  for (let i = 0; i < tagged.length; i += 1) {
    const entry = tagged[i]!;
    const tok = entry.token;

    if (tok === "between") {
      hasBetween = true;
    }
    if (tok === "after") {
      hasAfter = true;
    }

    if (STOPWORDS.has(tok)) continue;

    tokens.add(tok);

    if (isPlainNumberToken(tok) && !isYearToken(tok)) {
      const prev = i > 0 ? tagged[i - 1]!.token : "";
      const next = i + 1 < tagged.length ? tagged[i + 1]!.token : "";
      const next2 = i + 2 < tagged.length ? tagged[i + 2]!.token : "";
      const hasUnitAfter = NUMERIC_UNITS.has(next);
      const isCalendarDay =
        !entry.isCurrency &&
        !hasUnitAfter &&
        isDayOfMonthNumber(tok) &&
        (MONTHS.has(prev) || MONTHS.has(next) || (next === "of" && MONTHS.has(next2)));

      if (!isCalendarDay) {
        thresholdNumbers.add(tok);
      }
    }
  }

  return { tokens, thresholdNumbers, hasBetween, hasNegation, hasAfter };
}

export interface TitleSimilarityResult {
  score: number;
  confidence: PredictionsArbConfidence | null;
  matchedTokens: string[];
}

export function computeTitleSimilarity(
  a: NormalizedTitle,
  b: NormalizedTitle
): TitleSimilarityResult {
  if (a.tokens.size < 2 || b.tokens.size < 2) {
    return { score: 0, confidence: null, matchedTokens: [] };
  }

  // Range contract ("between X and Y") cannot match a single-sided threshold contract
  if (a.hasBetween !== b.hasBetween) {
    return { score: 0, confidence: null, matchedTokens: [] };
  }

  // Reject logical negation mismatches (e.g. "will reach" vs "will not reach" / "no rate cut")
  if (a.hasNegation !== b.hasNegation) {
    return { score: 0, confidence: null, matchedTokens: [] };
  }

  // Reject opposite temporal direction ("after Dec 31" vs "before/by/on Dec 31")
  if (a.hasAfter !== b.hasAfter) {
    return { score: 0, confidence: null, matchedTokens: [] };
  }

  // Reject antonym direction mismatches (e.g. above vs below, cut vs hike)
  for (const [left, right] of ANTONYM_PAIRS) {
    const aHasLeft = a.tokens.has(left);
    const aHasRight = a.tokens.has(right);
    const bHasLeft = b.tokens.has(left);
    const bHasRight = b.tokens.has(right);

    if ((aHasLeft && !aHasRight && bHasRight && !bHasLeft) || (aHasRight && !aHasLeft && bHasLeft && !bHasRight)) {
      return { score: 0, confidence: null, matchedTokens: [] };
    }
  }

  // Strict strike/threshold number parity whenever EITHER title specifies numeric thresholds
  let hasExactNumericMatch = false;
  if (a.thresholdNumbers.size > 0 || b.thresholdNumbers.size > 0) {
    if (a.thresholdNumbers.size !== b.thresholdNumbers.size) {
      return { score: 0, confidence: null, matchedTokens: [] };
    }
    for (const num of a.thresholdNumbers) {
      if (!b.thresholdNumbers.has(num)) {
        return { score: 0, confidence: null, matchedTokens: [] };
      }
    }
    hasExactNumericMatch = true;
  }

  const matchedTokens: string[] = [];
  for (const tok of a.tokens) {
    if (b.tokens.has(tok)) {
      matchedTokens.push(tok);
    }
  }

  if (matchedTokens.length < 2) {
    return { score: 0, confidence: null, matchedTokens: [] };
  }

  const unionSize = a.tokens.size + b.tokens.size - matchedTokens.length;
  const jaccard = unionSize > 0 ? matchedTokens.length / unionSize : 0;

  // Small deterministic boost when both markets share identical numeric thresholds (e.g. $100k / 25bp)
  let score = jaccard;
  if (hasExactNumericMatch && jaccard >= 0.48) {
    score = Math.min(1, jaccard + 0.08);
  }

  score = round(score, 4);
  if (score < MIN_MATCH_SCORE) {
    return { score, confidence: null, matchedTokens: [] };
  }

  matchedTokens.sort();
  const confidence: PredictionsArbConfidence =
    score >= HIGH_CONFIDENCE_SCORE ? "HIGH" : "MEDIUM";

  return { score, confidence, matchedTokens };
}

/**
 * Kalshi standard parabolic taker fee formula per $1 contract: 0.07 * p * (1 - p)
 */
export function estimateKalshiTakerFeeUsd(priceUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd >= 1) return 0;
  return 0.07 * priceUsd * (1 - priceUsd);
}

interface LegQuote {
  priceUsd: number;
  isBookQuote: boolean;
}

function resolveBuyYesQuote(m: RawPredictionMarket): LegQuote | null {
  if (m.yesAsk !== null) {
    // Reject empty ask book ($1.00) or invalid 0 quote
    if (m.yesAsk > 0 && m.yesAsk < 1) {
      return { priceUsd: m.yesAsk, isBookQuote: true };
    }
    return null;
  }
  if (m.yesProb !== null && m.yesProb > 0 && m.yesProb < 1) {
    return { priceUsd: m.yesProb, isBookQuote: false };
  }
  return null;
}

function resolveBuyNoQuote(m: RawPredictionMarket): LegQuote | null {
  if (m.yesBid !== null) {
    // Buying NO lifts NO ask = 1 - yesBid; reject yesBid <= 0 (NO costs $1.00) or >= 1
    if (m.yesBid > 0 && m.yesBid < 1) {
      return { priceUsd: 1 - m.yesBid, isBookQuote: true };
    }
    return null;
  }
  if (m.noProb !== null && m.noProb > 0 && m.noProb < 1) {
    return { priceUsd: m.noProb, isBookQuote: false };
  }
  return null;
}

function effectiveLiquidityUsd(m: RawPredictionMarket): number {
  if (m.liquidityUsd !== null && Number.isFinite(m.liquidityUsd)) {
    return Math.max(0, m.liquidityUsd);
  }
  if (m.openInterestUsd !== null && Number.isFinite(m.openInterestUsd)) {
    return Math.max(0, m.openInterestUsd);
  }
  return 0;
}

interface IndexedMarket {
  raw: RawPredictionMarket;
  expiryMs: number;
  expiresAtIso: string;
  liquidityUsd: number;
  normalized: NormalizedTitle;
  buyYes: LegQuote | null;
  buyNo: LegQuote | null;
}

function matchesQuery(
  raw: RawPredictionMarket,
  normalized: NormalizedTitle,
  queryTokens: string[]
): boolean {
  if (queryTokens.length === 0) return true;
  const haystack = `${raw.title} ${raw.id} ${raw.category ?? ""}`.toLowerCase();
  return queryTokens.every((tok) => {
    if (haystack.includes(tok)) return true;
    const alias = resolveTokenAlias(tok);
    return normalized.tokens.has(alias);
  });
}

function prepareVenueMarkets(
  markets: RawPredictionMarket[],
  nowMs: number,
  minLiquidityUsd: number,
  queryTokens: string[]
): IndexedMarket[] {
  const eligible: IndexedMarket[] = [];

  for (const raw of markets) {
    if (raw.isBinaryYesNo === false) continue;
    if (!raw.expiresAt) continue;
    const expiryMs = Date.parse(raw.expiresAt);
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) continue;

    const liq = effectiveLiquidityUsd(raw);
    if (minLiquidityUsd > 0 && liq < minLiquidityUsd) continue;

    const buyYes = resolveBuyYesQuote(raw);
    const buyNo = resolveBuyNoQuote(raw);
    if (!buyYes && !buyNo) continue;

    const normalized = normalizeMarketTitle(raw.title);
    if (!matchesQuery(raw, normalized, queryTokens)) continue;

    eligible.push({
      raw,
      expiryMs,
      expiresAtIso: raw.expiresAt,
      liquidityUsd: liq,
      normalized,
      buyYes,
      buyNo,
    });
  }

  // Keep top MAX_MARKETS_PER_VENUE markets by activity/liquidity to guarantee < 2ms CPU
  eligible.sort((a, b) => {
    const scoreA = Math.max(a.liquidityUsd, a.raw.volume24hUsd);
    const scoreB = Math.max(b.liquidityUsd, b.raw.volume24hUsd);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (b.raw.volume24hUsd !== a.raw.volume24hUsd) return b.raw.volume24hUsd - a.raw.volume24hUsd;
    return a.raw.id.localeCompare(b.raw.id);
  });

  return eligible.slice(0, MAX_MARKETS_PER_VENUE);
}

function buildLeg(
  m: IndexedMarket,
  action: "BUY_YES" | "BUY_NO",
  entryPriceUsd: number
): PredictionsArbLeg {
  return {
    venue: m.raw.venue,
    id: m.raw.id,
    title: m.raw.title,
    category: m.raw.category,
    action,
    entry_price_usd: round(entryPriceUsd, 4),
    yes_prob: m.raw.yesProb !== null ? round(m.raw.yesProb, 4) : null,
    no_prob: m.raw.noProb !== null ? round(m.raw.noProb, 4) : null,
    bid_ask_spread_bps: m.raw.spreadBps !== null ? round(m.raw.spreadBps, 2) : null,
    volume_24h_usd: round(m.raw.volume24hUsd, 2),
    liquidity_usd: m.raw.liquidityUsd !== null ? round(m.raw.liquidityUsd, 2) : null,
    expires_at: m.expiresAtIso,
    url: m.raw.url,
  };
}

interface CandidatePair {
  poly: IndexedMarket;
  kalshi: IndexedMarket;
  score: number;
  confidence: PredictionsArbConfidence;
  matchedTokens: string[];
  expiryDiffMs: number;
}

interface EvaluatedStrategy {
  strategy: PredictionsArbStrategy;
  polyAction: "BUY_YES" | "BUY_NO";
  kalshiAction: "BUY_YES" | "BUY_NO";
  polyQuote: LegQuote;
  kalshiQuote: LegQuote;
  combinedCostUsd: number;
  estimatedFeesUsd: number;
  netCombinedCostUsd: number;
}

function evaluateBestStrategy(poly: IndexedMarket, kalshi: IndexedMarket): EvaluatedStrategy | null {
  const candidates: EvaluatedStrategy[] = [];

  if (poly.buyYes && kalshi.buyNo) {
    const combined = poly.buyYes.priceUsd + kalshi.buyNo.priceUsd;
    const kalshiFee = estimateKalshiTakerFeeUsd(kalshi.buyNo.priceUsd);
    const fallbackPenalty =
      (poly.buyYes.isBookQuote ? 0 : MID_FALLBACK_SLIPPAGE_USD) +
      (kalshi.buyNo.isBookQuote ? 0 : MID_FALLBACK_SLIPPAGE_USD);
    const fees = kalshiFee + POLYMARKET_BUFFER_USD + fallbackPenalty;
    candidates.push({
      strategy: "BUY_YES_POLYMARKET_BUY_NO_KALSHI",
      polyAction: "BUY_YES",
      kalshiAction: "BUY_NO",
      polyQuote: poly.buyYes,
      kalshiQuote: kalshi.buyNo,
      combinedCostUsd: combined,
      estimatedFeesUsd: fees,
      netCombinedCostUsd: combined + fees,
    });
  }

  if (kalshi.buyYes && poly.buyNo) {
    const combined = kalshi.buyYes.priceUsd + poly.buyNo.priceUsd;
    const kalshiFee = estimateKalshiTakerFeeUsd(kalshi.buyYes.priceUsd);
    const fallbackPenalty =
      (kalshi.buyYes.isBookQuote ? 0 : MID_FALLBACK_SLIPPAGE_USD) +
      (poly.buyNo.isBookQuote ? 0 : MID_FALLBACK_SLIPPAGE_USD);
    const fees = kalshiFee + POLYMARKET_BUFFER_USD + fallbackPenalty;
    candidates.push({
      strategy: "BUY_YES_KALSHI_BUY_NO_POLYMARKET",
      polyAction: "BUY_NO",
      kalshiAction: "BUY_YES",
      polyQuote: poly.buyNo,
      kalshiQuote: kalshi.buyYes,
      combinedCostUsd: combined,
      estimatedFeesUsd: fees,
      netCombinedCostUsd: combined + fees,
    });
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  return candidates[0]!.netCombinedCostUsd <= candidates[1]!.netCombinedCostUsd
    ? candidates[0]!
    : candidates[1]!;
}

export interface PredictionsArbOptions {
  minSpreadBps: number;
  minLiquidityUsd: number;
  query: string | null;
  limit: number;
  nowMs?: number;
  fetchedAt?: string;
}

export function computePredictionsArb(
  polymarketMarkets: RawPredictionMarket[],
  kalshiMarkets: RawPredictionMarket[],
  options: PredictionsArbOptions
): PredictionsArbResponse {
  const nowMs = options.nowMs ?? Date.now();
  const fetchedAt = options.fetchedAt ?? new Date(nowMs).toISOString();
  const minSpreadBps = Math.max(0, options.minSpreadBps);
  const minLiquidityUsd = Math.max(0, options.minLiquidityUsd);
  const limit = Math.min(30, Math.max(1, Math.floor(options.limit)));

  const queryTokens = options.query
    ? options.query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0)
    : [];

  const polyEligible = prepareVenueMarkets(polymarketMarkets, nowMs, minLiquidityUsd, queryTokens);
  const kalshiEligible = prepareVenueMarkets(kalshiMarkets, nowMs, minLiquidityUsd, queryTokens);

  // Collect all valid cross-venue candidate matches within the 72h expiry window
  const candidatePairs: CandidatePair[] = [];
  for (const poly of polyEligible) {
    for (const kalshi of kalshiEligible) {
      const expiryDiffMs = Math.abs(poly.expiryMs - kalshi.expiryMs);
      if (expiryDiffMs > EXPIRY_WINDOW_MS) continue;

      const sim = computeTitleSimilarity(poly.normalized, kalshi.normalized);
      if (!sim.confidence) continue;

      candidatePairs.push({
        poly,
        kalshi,
        score: sim.score,
        confidence: sim.confidence,
        matchedTokens: sim.matchedTokens,
        expiryDiffMs,
      });
    }
  }

  // Greedy 1-to-1 assignment so no contract is paired more than once
  candidatePairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.expiryDiffMs !== b.expiryDiffMs) return a.expiryDiffMs - b.expiryDiffMs;
    const minLiqA = Math.min(a.poly.liquidityUsd, a.kalshi.liquidityUsd);
    const minLiqB = Math.min(b.poly.liquidityUsd, b.kalshi.liquidityUsd);
    if (minLiqB !== minLiqA) return minLiqB - minLiqA;
    return `${a.poly.raw.id}:${a.kalshi.raw.id}`.localeCompare(
      `${b.poly.raw.id}:${b.kalshi.raw.id}`
    );
  });

  const usedPoly = new Set<string>();
  const usedKalshi = new Set<string>();
  const matchedPairs: CandidatePair[] = [];

  for (const pair of candidatePairs) {
    if (usedPoly.has(pair.poly.raw.id) || usedKalshi.has(pair.kalshi.raw.id)) continue;
    usedPoly.add(pair.poly.raw.id);
    usedKalshi.add(pair.kalshi.raw.id);
    matchedPairs.push(pair);
  }

  const qualifying: PredictionsArbOpportunity[] = [];

  for (const pair of matchedPairs) {
    const best = evaluateBestStrategy(pair.poly, pair.kalshi);
    if (!best) continue;

    const grossEdgeBps = round((1 - best.combinedCostUsd) * 10_000, 2);
    const estimatedFeesBps = round(best.estimatedFeesUsd * 10_000, 2);
    const netEdgeBps = round((1 - best.netCombinedCostUsd) * 10_000, 2);

    if (netEdgeBps < minSpreadBps) continue;

    const maxExpiryMs = Math.max(pair.poly.expiryMs, pair.kalshi.expiryMs);
    const hoursToResolution = round(Math.max(0, (maxExpiryMs - nowMs) / 3_600_000), 2);
    const expiryDiffHours = round(pair.expiryDiffMs / 3_600_000, 2);

    let annualizedArbApyPct: number | null = null;
    if (
      best.netCombinedCostUsd > 0 &&
      best.netCombinedCostUsd < 1 &&
      hoursToResolution >= MIN_APY_HOURS
    ) {
      const simpleNetReturn = (1 - best.netCombinedCostUsd) / best.netCombinedCostUsd;
      const apy = simpleNetReturn * (HOURS_PER_YEAR / hoursToResolution) * 100;
      if (Number.isFinite(apy) && apy > 0) {
        annualizedArbApyPct = round(Math.min(apy, MAX_APY_PCT), 2);
      }
    }

    const impliedProbGapBps =
      pair.poly.raw.yesProb !== null && pair.kalshi.raw.yesProb !== null
        ? round(Math.abs(pair.poly.raw.yesProb - pair.kalshi.raw.yesProb) * 10_000, 2)
        : null;

    const quoteQuality: PredictionsArbQuoteQuality =
      best.polyQuote.isBookQuote && best.kalshiQuote.isBookQuote
        ? "EXECUTABLE_BOOK"
        : "MID_FALLBACK";

    const minPairLiquidityUsd = round(Math.min(pair.poly.liquidityUsd, pair.kalshi.liquidityUsd), 2);

    qualifying.push({
      match_confidence: pair.confidence,
      match_score: pair.score,
      matched_tokens: pair.matchedTokens,
      strategy: best.strategy,
      quote_quality: quoteQuality,
      combined_cost_usd: round(best.combinedCostUsd, 4),
      net_combined_cost_usd: round(best.netCombinedCostUsd, 4),
      gross_edge_bps: grossEdgeBps,
      estimated_fees_bps: estimatedFeesBps,
      net_edge_bps: netEdgeBps,
      implied_prob_gap_bps: impliedProbGapBps,
      annualized_arb_apy_pct: annualizedArbApyPct,
      hours_to_resolution: hoursToResolution,
      expiry_diff_hours: expiryDiffHours,
      min_liquidity_usd: minPairLiquidityUsd,
      resolution_risk_warning: true,
      polymarket: buildLeg(pair.poly, best.polyAction, best.polyQuote.priceUsd),
      kalshi: buildLeg(pair.kalshi, best.kalshiAction, best.kalshiQuote.priceUsd),
    });
  }

  qualifying.sort((a, b) => {
    if (b.net_edge_bps !== a.net_edge_bps) return b.net_edge_bps - a.net_edge_bps;
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;
    if (b.min_liquidity_usd !== a.min_liquidity_usd) return b.min_liquidity_usd - a.min_liquidity_usd;
    return `${a.polymarket.id}:${a.kalshi.id}`.localeCompare(`${b.polymarket.id}:${b.kalshi.id}`);
  });

  const sliced = qualifying.slice(0, limit);
  const venuesActive: PredictionVenueName[] = ["polymarket", "kalshi"];

  return {
    filters: {
      min_spread_bps: minSpreadBps,
      min_liquidity_usd: minLiquidityUsd,
      query: options.query,
      limit,
    },
    venues_active: venuesActive,
    summary: {
      polymarket_scanned: polymarketMarkets.length,
      kalshi_scanned: kalshiMarkets.length,
      polymarket_eligible: polyEligible.length,
      kalshi_eligible: kalshiEligible.length,
      matched_pairs_count: matchedPairs.length,
      qualifying_opportunities_count: qualifying.length,
      best_net_edge_bps: qualifying.length > 0 ? qualifying[0]!.net_edge_bps : null,
    },
    opportunities: sliced,
    metadata: {
      fetched_at: fetchedAt,
      sources: venuesActive,
      fee_model: FEE_MODEL_DESCRIPTION,
      disclaimer: DISCLAIMER,
    },
  };
}
