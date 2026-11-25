import {
  BoundedTtlCache,
  TTL_MS,
  isolateCache,
  readEdgeCache,
  writeEdgeCache,
} from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import type { RawPredictionMarket } from "../types";

const KALSHI_CACHE_KEY = "kalshi:active:top200";
const KALSHI_PRIMARY_URL =
  "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&mve_filter=exclude&limit=200";
const KALSHI_FALLBACK_URL =
  "https://external-api.kalshi.com/trade-api/v2/markets?status=open&mve_filter=exclude&limit=200";

interface RawKalshiMarket {
  ticker?: unknown;
  event_ticker?: unknown;
  title?: unknown;
  subtitle?: unknown;
  yes_sub_title?: unknown;
  category?: unknown;
  status?: unknown;
  yes_bid?: unknown;
  yes_ask?: unknown;
  last_price?: unknown;
  yes_bid_dollars?: unknown;
  yes_ask_dollars?: unknown;
  last_price_dollars?: unknown;
  volume_24h?: unknown;
  volume_24h_fp?: unknown;
  liquidity?: unknown;
  liquidity_dollars?: unknown;
  open_interest?: unknown;
  open_interest_fp?: unknown;
  close_time?: unknown;
  expiration_time?: unknown;
}

interface RawKalshiResponse {
  markets?: RawKalshiMarket[];
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === "string" && val.trim().length > 0) {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseKalshiProb(dollarsVal: unknown, legacyVal: unknown): number | null {
  const fromDollars = toFiniteNumber(dollarsVal);
  if (fromDollars !== null && fromDollars >= 0 && fromDollars <= 1) {
    return fromDollars;
  }

  const fromLegacy = toFiniteNumber(legacyVal);
  if (fromLegacy === null || fromLegacy < 0) return null;
  if (fromLegacy === 0) return 0;
  // Legacy Kalshi API uses integer cents (1..100); fixed-point floats live in (0, 1).
  if (fromLegacy > 1 && fromLegacy <= 100) {
    return fromLegacy / 100;
  }
  if (typeof legacyVal === "number" && Number.isInteger(fromLegacy) && fromLegacy === 1) {
    return 0.01;
  }
  if (fromLegacy > 0 && fromLegacy <= 1) {
    return fromLegacy;
  }
  return null;
}

function parseKalshiLiquidityUsd(dollarsVal: unknown, legacyCentsVal: unknown): number | null {
  const fromDollars = toFiniteNumber(dollarsVal);
  if (fromDollars !== null && fromDollars >= 0) {
    return fromDollars;
  }
  const fromLegacy = toFiniteNumber(legacyCentsVal);
  if (fromLegacy !== null && fromLegacy >= 0) {
    // Legacy Kalshi liquidity is reported in cents
    return fromLegacy / 100;
  }
  return null;
}

export function parseKalshiMarkets(raw: unknown): RawPredictionMarket[] {
  const obj = raw as RawKalshiResponse | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.markets)) {
    throw new UpstreamError(
      "KALSHI",
      "KALSHI_BAD_SCHEMA",
      "Kalshi returned unexpected markets payload"
    );
  }

  const out: RawPredictionMarket[] = [];

  for (const m of obj.markets) {
    if (!m || typeof m !== "object") continue;
    const status = typeof m.status === "string" ? m.status.toLowerCase() : "open";
    if (status !== "open" && status !== "active") continue;

    const ticker = typeof m.ticker === "string" ? m.ticker.trim() : "";
    if (!ticker) continue;

    const baseTitle = typeof m.title === "string" ? m.title.trim() : "";
    const sub =
      typeof m.yes_sub_title === "string" && m.yes_sub_title.trim().length > 0
        ? m.yes_sub_title.trim()
        : typeof m.subtitle === "string" && m.subtitle.trim().length > 0
          ? m.subtitle.trim()
          : "";
    const title = baseTitle
      ? sub && !baseTitle.toLowerCase().includes(sub.toLowerCase())
        ? `${baseTitle} (${sub})`
        : baseTitle
      : ticker;

    const yesBid = parseKalshiProb(m.yes_bid_dollars, m.yes_bid);
    const yesAsk = parseKalshiProb(m.yes_ask_dollars, m.yes_ask);
    const lastPrice = parseKalshiProb(m.last_price_dollars, m.last_price);

    let yesProb: number | null = null;
    let spreadBps: number | null = null;

    if (yesBid !== null && yesAsk !== null && yesAsk >= yesBid && yesAsk > 0) {
      yesProb = yesBid > 0 ? (yesBid + yesAsk) / 2 : lastPrice ?? yesAsk;
      spreadBps = (yesAsk - yesBid) * 10_000;
    } else if (lastPrice !== null) {
      yesProb = lastPrice;
    } else if (yesAsk !== null && yesAsk > 0) {
      yesProb = yesAsk;
    } else if (yesBid !== null && yesBid > 0) {
      yesProb = yesBid;
    }

    const noProb = yesProb !== null ? Math.max(0, Math.min(1, 1 - yesProb)) : null;

    // Each Kalshi binary contract has $1 settlement face value
    const volume24hUsd =
      toFiniteNumber(m.volume_24h_fp) ?? toFiniteNumber(m.volume_24h) ?? 0;
    const openInterestUsd =
      toFiniteNumber(m.open_interest_fp) ?? toFiniteNumber(m.open_interest);
    const liquidityUsd = parseKalshiLiquidityUsd(m.liquidity_dollars, m.liquidity);

    const expiresAt =
      typeof m.close_time === "string" && m.close_time.trim().length > 0
        ? m.close_time.trim()
        : typeof m.expiration_time === "string" && m.expiration_time.trim().length > 0
          ? m.expiration_time.trim()
          : null;

    const eventTicker =
      typeof m.event_ticker === "string" && m.event_ticker.trim().length > 0
        ? m.event_ticker.trim()
        : ticker;

    const category =
      typeof m.category === "string" && m.category.trim().length > 0 ? m.category.trim() : null;

    out.push({
      venue: "kalshi",
      id: ticker,
      title,
      category,
      yesProb,
      noProb,
      yesBid,
      yesAsk,
      spreadBps,
      volume24hUsd: Math.max(0, volume24hUsd),
      liquidityUsd,
      openInterestUsd: openInterestUsd !== null ? Math.max(0, openInterestUsd) : null,
      expiresAt,
      url: `https://kalshi.com/markets/${encodeURIComponent(eventTicker.toLowerCase())}`,
    });
  }

  return out;
}

export async function fetchKalshiMarkets(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ markets: RawPredictionMarket[]; cacheHit: boolean }> {
  const useEdgeCache = cache === isolateCache;
  const cached = cache.get<RawPredictionMarket[]>(KALSHI_CACHE_KEY);
  if (cached.hit) {
    return { markets: cached.value, cacheHit: true };
  }

  if (useEdgeCache) {
    const edgeCached = await readEdgeCache<RawPredictionMarket[]>(KALSHI_CACHE_KEY);
    if (edgeCached.hit) {
      cache.set(KALSHI_CACHE_KEY, edgeCached.value, TTL_MS.KALSHI_MARKETS);
      return { markets: edgeCached.value, cacheHit: true };
    }
  }

  let data: unknown;
  try {
    const primaryRes = await fetchJsonWithTimeout<unknown>(KALSHI_PRIMARY_URL, {
      provider: "KALSHI",
      fetchImpl,
    });
    if (primaryRes.status !== "ok") {
      throw new UpstreamError("KALSHI", "KALSHI_UNAVAILABLE", "Kalshi primary unavailable");
    }
    data = primaryRes.data;
  } catch (primaryErr) {
    const fallbackRes = await fetchJsonWithTimeout<unknown>(KALSHI_FALLBACK_URL, {
      provider: "KALSHI",
      fetchImpl,
    }).catch(() => {
      throw primaryErr;
    });
    if (fallbackRes.status !== "ok") {
      throw primaryErr;
    }
    data = fallbackRes.data;
  }

  const markets = parseKalshiMarkets(data);
  cache.set(KALSHI_CACHE_KEY, markets, TTL_MS.KALSHI_MARKETS);
  if (useEdgeCache) {
    await writeEdgeCache(KALSHI_CACHE_KEY, markets, TTL_MS.KALSHI_MARKETS);
  }
  return { markets, cacheHit: false };
}
