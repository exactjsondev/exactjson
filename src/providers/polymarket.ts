import { BoundedTtlCache, TTL_MS, readEdgeCache, writeEdgeCache } from "../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../lib/http";
import type { RawPredictionMarket } from "../types";

const POLYMARKET_CACHE_KEY = "polymarket:active:top100";
const POLYMARKET_MARKETS_URL =
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false";

interface RawGammaMarket {
  id?: unknown;
  conditionId?: unknown;
  slug?: unknown;
  question?: unknown;
  category?: unknown;
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
  spread?: unknown;
  volume24hr?: unknown;
  volume24hrClob?: unknown;
  liquidityClob?: unknown;
  liquidityNum?: unknown;
  liquidity?: unknown;
  endDate?: unknown;
  endDateIso?: unknown;
  events?: Array<{ slug?: unknown; category?: unknown; title?: unknown }>;
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

function parseJsonStringOrArray(val: unknown): unknown[] | null {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function clampProb(val: number | null): number | null {
  if (val === null || !Number.isFinite(val)) return null;
  if (val < 0 || val > 1) return null;
  return val;
}

export function parsePolymarketMarkets(rawList: unknown): RawPredictionMarket[] {
  if (!Array.isArray(rawList)) {
    throw new UpstreamError(
      "POLYMARKET",
      "POLYMARKET_BAD_SCHEMA",
      "Polymarket returned unexpected markets payload"
    );
  }

  const out: RawPredictionMarket[] = [];

  for (const item of rawList as RawGammaMarket[]) {
    if (!item || typeof item !== "object") continue;
    if (item.closed === true || item.archived === true || item.active === false) continue;

    const title = typeof item.question === "string" ? item.question.trim() : "";
    if (!title) continue;

    const idRaw = item.id ?? item.conditionId ?? item.slug;
    const id = typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw) : "";
    if (!id) continue;

    const pricesArr = parseJsonStringOrArray(item.outcomePrices);
    const outcomesArr = parseJsonStringOrArray(item.outcomes);

    let yesProb: number | null = null;
    let noProb: number | null = null;

    if (pricesArr && pricesArr.length >= 2) {
      let yesIdx = 0;
      let noIdx = 1;
      if (outcomesArr && outcomesArr.length === pricesArr.length) {
        const lower = outcomesArr.map((o) => (typeof o === "string" ? o.trim().toLowerCase() : ""));
        const foundYes = lower.indexOf("yes");
        const foundNo = lower.indexOf("no");
        if (foundYes >= 0 && foundNo >= 0) {
          yesIdx = foundYes;
          noIdx = foundNo;
        }
      }
      yesProb = clampProb(toFiniteNumber(pricesArr[yesIdx]));
      noProb = clampProb(toFiniteNumber(pricesArr[noIdx]));
    }

    const bestBid = clampProb(toFiniteNumber(item.bestBid));
    const bestAsk = clampProb(toFiniteNumber(item.bestAsk));
    const rawSpread = toFiniteNumber(item.spread);

    let spreadBps: number | null = null;
    if (bestBid !== null && bestAsk !== null && bestAsk >= bestBid) {
      spreadBps = (bestAsk - bestBid) * 10_000;
    } else if (rawSpread !== null && rawSpread >= 0 && rawSpread <= 1) {
      spreadBps = rawSpread * 10_000;
    }

    if (yesProb === null && bestBid !== null && bestAsk !== null && bestAsk >= bestBid) {
      yesProb = (bestBid + bestAsk) / 2;
      noProb = 1 - yesProb;
    }

    const volume24hUsd =
      toFiniteNumber(item.volume24hr) ?? toFiniteNumber(item.volume24hrClob) ?? 0;
    const liquidityUsd =
      toFiniteNumber(item.liquidityClob) ??
      toFiniteNumber(item.liquidityNum) ??
      toFiniteNumber(item.liquidity);

    const expiresAt =
      typeof item.endDate === "string" && item.endDate.trim().length > 0
        ? item.endDate.trim()
        : typeof item.endDateIso === "string" && item.endDateIso.trim().length > 0
          ? item.endDateIso.trim()
          : null;

    const category =
      typeof item.category === "string" && item.category.trim().length > 0
        ? item.category.trim()
        : typeof item.events?.[0]?.category === "string" && item.events[0].category.trim().length > 0
          ? item.events[0].category.trim()
          : null;

    const slug =
      typeof item.slug === "string" && item.slug.trim().length > 0
        ? item.slug.trim()
        : typeof item.events?.[0]?.slug === "string" && item.events[0].slug.trim().length > 0
          ? item.events[0].slug.trim()
          : null;

    out.push({
      venue: "polymarket",
      id,
      title,
      category,
      yesProb,
      noProb,
      yesBid: bestBid,
      yesAsk: bestAsk,
      spreadBps,
      volume24hUsd: Math.max(0, volume24hUsd),
      liquidityUsd: liquidityUsd !== null ? Math.max(0, liquidityUsd) : null,
      openInterestUsd: null,
      expiresAt,
      url: slug ? `https://polymarket.com/market/${slug}` : null,
    });
  }

  return out;
}

export async function fetchPolymarketMarkets(
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch
): Promise<{ markets: RawPredictionMarket[]; cacheHit: boolean }> {
  const cached = cache.get<RawPredictionMarket[]>(POLYMARKET_CACHE_KEY);
  if (cached.hit) {
    return { markets: cached.value, cacheHit: true };
  }

  const edgeCached = await readEdgeCache<RawPredictionMarket[]>(POLYMARKET_CACHE_KEY);
  if (edgeCached.hit) {
    cache.set(POLYMARKET_CACHE_KEY, edgeCached.value, TTL_MS.POLYMARKET_MARKETS);
    return { markets: edgeCached.value, cacheHit: true };
  }

  const res = await fetchJsonWithTimeout<unknown>(POLYMARKET_MARKETS_URL, {
    provider: "POLYMARKET",
    fetchImpl,
  });

  if (res.status !== "ok") {
    throw new UpstreamError("POLYMARKET", "POLYMARKET_UNAVAILABLE", "Polymarket markets unavailable");
  }

  const markets = parsePolymarketMarkets(res.data);
  cache.set(POLYMARKET_CACHE_KEY, markets, TTL_MS.POLYMARKET_MARKETS);
  await writeEdgeCache(POLYMARKET_CACHE_KEY, markets, TTL_MS.POLYMARKET_MARKETS);
  return { markets, cacheHit: false };
}
