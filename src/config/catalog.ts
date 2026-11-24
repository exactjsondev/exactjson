export const SERVICE_NAME = "ExactJSON" as const;
export const SERVICE_VERSION = "1.0.0" as const;
export const USER_AGENT = "ExactJSON/1.0" as const;
export const DISCLAIMER =
  "Informational market/security data only; not financial advice." as const;

export const MAX_BAZAAR_DESCRIPTION_LENGTH = 500;

export type EndpointId =
  | "solana_safety"
  | "solana_trending"
  | "perps_snapshot"
  | "perps_screener"
  | "perps_funding_arb"
  | "predictions_scanner"
  | "options_surface"
  | "macro_liquidity"
  | "evm_safety"
  | "predictions_arb"
  | "execution_quote_check";

export type EndpointPath =
  | "/v1/solana/safety"
  | "/v1/solana/trending"
  | "/v1/perps/snapshot"
  | "/v1/perps/screener"
  | "/v1/perps/funding-arb"
  | "/v1/predictions/scanner"
  | "/v1/options/surface"
  | "/v1/macro/liquidity"
  | "/v1/evm/safety"
  | "/v1/predictions/arb"
  | "/v1/execution/quote-check";

export interface EndpointCatalogEntry {
  id: EndpointId;
  method: "GET";
  path: EndpointPath;
  routeKey: `GET ${EndpointPath}`;
  summary: string;
  description: string;
  tags: readonly string[];
  priceAmount: string;
  priceFormatted: string;
  priceUsd: number;
  queryParamName: string;
  queryParamDescription: string;
  queryParamExample: string;
  exampleQueryParams: Record<string, string>;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  outputExample: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export const CATALOG: readonly EndpointCatalogEntry[] = [
  {
    id: "solana_safety",
    method: "GET",
    path: "/v1/solana/safety",
    routeKey: "GET /v1/solana/safety",
    summary: "Solana SPL token safety & liquidity snapshot",
    description:
      "Deterministic Solana SPL token safety snapshot combining RugCheck security risks, authority flags, and DEX liquidity/volume/FDV ratios. Informational market/security data only; not financial advice.",
    tags: ["solana", "security", "defi"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "mint",
    queryParamDescription: "Base58 Solana SPL token mint address (32-44 characters).",
    queryParamExample: "So11111111111111111111111111111111111111112",
    exampleQueryParams: {
      mint: "So11111111111111111111111111111111111111112",
    },
    inputSchema: {
      type: "object",
      properties: {
        mint: {
          type: "string",
          description: "Base58 Solana SPL token mint address (32-44 characters).",
          pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
          example: "So11111111111111111111111111111111111111112",
        },
      },
      required: ["mint"],
    },
    outputExample: {
      mint: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      name: "Wrapped SOL",
      risk_score: 5,
      risk_tier: "LOW",
      flags: ["LP_LOCK_UNKNOWN"],
      security: {
        rugcheck_score: 1,
        rugcheck_score_normalized: 1,
        lp_locked_pct: null,
        mint_authority_flagged: false,
        freeze_authority_flagged: false,
        mutable_metadata_flagged: false,
        risk_count: 0,
        danger_count: 0,
        warn_count: 0,
        risks: [],
      },
      market: {
        price_usd: 180.25,
        liquidity_usd: 45000000,
        volume_24h_usd: 125000000,
        volume_to_liquidity_ratio: 2.7778,
        fdv_usd: 98000000000,
        fdv_to_liquidity_ratio: 2177.78,
        price_change_24h_pct: 2.4,
        pair_count: 14,
        primary_dex: "raydium",
        primary_pair_address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
      },
      metadata: {
        fetched_at: "2026-11-21T17:00:00.000Z",
        sources: ["rugcheck", "dexscreener"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["mint", "risk_score", "risk_tier", "flags", "security", "market", "metadata"],
      properties: {
        mint: { type: "string" },
        symbol: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
        risk_score: { type: "integer", minimum: 0, maximum: 100 },
        risk_tier: { type: "string", enum: ["LOW", "MODERATE", "ELEVATED", "CRITICAL"] },
        flags: { type: "array", items: { type: "string" } },
        security: {
          type: "object",
          required: [
            "rugcheck_score",
            "rugcheck_score_normalized",
            "lp_locked_pct",
            "mint_authority_flagged",
            "freeze_authority_flagged",
            "mutable_metadata_flagged",
            "risk_count",
            "danger_count",
            "warn_count",
            "risks",
          ],
          properties: {
            rugcheck_score: { type: ["number", "null"] },
            rugcheck_score_normalized: { type: ["number", "null"] },
            lp_locked_pct: { type: ["number", "null"] },
            mint_authority_flagged: { type: "boolean" },
            freeze_authority_flagged: { type: "boolean" },
            mutable_metadata_flagged: { type: "boolean" },
            risk_count: { type: "integer" },
            danger_count: { type: "integer" },
            warn_count: { type: "integer" },
            risks: { type: "array", items: { type: "object" } },
          },
        },
        market: {
          type: "object",
          required: [
            "price_usd",
            "liquidity_usd",
            "volume_24h_usd",
            "volume_to_liquidity_ratio",
            "fdv_usd",
            "fdv_to_liquidity_ratio",
            "price_change_24h_pct",
            "pair_count",
            "primary_dex",
            "primary_pair_address",
          ],
          properties: {
            price_usd: { type: ["number", "null"] },
            liquidity_usd: { type: "number" },
            volume_24h_usd: { type: "number" },
            volume_to_liquidity_ratio: { type: ["number", "null"] },
            fdv_usd: { type: ["number", "null"] },
            fdv_to_liquidity_ratio: { type: ["number", "null"] },
            price_change_24h_pct: { type: ["number", "null"] },
            pair_count: { type: "integer" },
            primary_dex: { type: ["string", "null"] },
            primary_pair_address: { type: ["string", "null"] },
          },
        },
        metadata: {
          type: "object",
          required: ["fetched_at", "sources", "disclaimer"],
          properties: {
            fetched_at: { type: "string", format: "date-time" },
            sources: { type: "array", items: { type: "string" } },
            disclaimer: { type: "string" },
          },
        },
      },
    },
  },
  {
    id: "solana_trending",
    method: "GET",
    path: "/v1/solana/trending",
    routeKey: "GET /v1/solana/trending",
    summary: "Trending Solana tokens pre-screened with RugCheck safety scores",
    description:
      "Live trending Solana pools combined with parallel RugCheck deterministic risk scores, authority flags, liquidity, and 24h trader flow in one call. Informational market/security data only; not financial advice.",
    tags: ["solana", "trending", "security"],
    priceAmount: "0.015",
    priceFormatted: "$0.015",
    priceUsd: 0.015,
    queryParamName: "limit",
    queryParamDescription: "Optional number of tokens to return (1-8, default 5).",
    queryParamExample: "5",
    exampleQueryParams: {
      limit: "5",
    },
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "string",
          description: "Optional number of trending tokens to return (integer 1-8, default 5).",
          example: "5",
        },
        max_risk_score: {
          type: "string",
          description:
            "Optional ceiling (0-100) to return only RugCheck-verified tokens at or below this risk score.",
          example: "50",
        },
      },
      required: [],
    },
    outputExample: {
      filters: { limit: 5, max_risk_score: null },
      scanned_count: 5,
      returned_count: 1,
      tokens: [
        {
          rank: 1,
          mint: "2j5SaS7xy776qCBpyPQbZjyQSAtKiFgrwjfErthnW2ZM",
          symbol: "CLAUDIA",
          pool_name: "CLAUDIA / SOL",
          dex: "pumpswap",
          pool_address: "Fe7bpDYCs74GqiCUF14HwgUMToPKV1d9mDYVX5BTohFr",
          pool_created_at: "2026-10-07T01:44:30Z",
          safety: {
            verified: true,
            risk_score: 18,
            risk_tier: "LOW",
            flags: [],
            lp_locked_pct: 95,
            mint_authority_flagged: false,
            freeze_authority_flagged: false,
            mutable_metadata_flagged: false,
            danger_count: 0,
            warn_count: 0,
          },
          market: {
            price_usd: 0.0095,
            liquidity_usd: 440581.1,
            volume_24h_usd: 2951408.67,
            volume_to_liquidity_ratio: 6.6989,
            fdv_usd: 8989783.46,
            price_change_24h_pct: 61.21,
            buys_24h: 13786,
            sells_24h: 12501,
            buy_sell_ratio_24h: 1.1028,
            unique_traders_24h: 5012,
          },
        },
      ],
      metadata: {
        fetched_at: "2026-11-21T17:00:00.000Z",
        sources: ["geckoterminal", "rugcheck"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["filters", "scanned_count", "returned_count", "tokens", "metadata"],
      properties: {
        filters: { type: "object" },
        scanned_count: { type: "integer" },
        returned_count: { type: "integer" },
        tokens: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "perps_snapshot",
    method: "GET",
    path: "/v1/perps/snapshot",
    routeKey: "GET /v1/perps/snapshot",
    summary: "Hyperliquid perpetual futures market snapshot",
    description:
      "Deterministic Hyperliquid perpetual futures snapshot with mark/oracle basis, annualized funding rate, open interest, spread, L2 depth imbalance, and $10k VWAP slippage. Informational market/security data only; not financial advice.",
    tags: ["hyperliquid", "perps", "market-data"],
    priceAmount: "0.005",
    priceFormatted: "$0.005",
    priceUsd: 0.005,
    queryParamName: "coin",
    queryParamDescription:
      "Hyperliquid perpetual ticker symbol (e.g., BTC, ETH, SOL, kPEPE; optional -PERP suffix stripped).",
    queryParamExample: "BTC",
    exampleQueryParams: {
      coin: "BTC",
    },
    inputSchema: {
      type: "object",
      properties: {
        coin: {
          type: "string",
          description:
            "Hyperliquid perpetual ticker symbol (e.g., BTC, ETH, SOL, kPEPE; optional -PERP suffix stripped).",
          pattern: "^[A-Za-z0-9]{1,16}(?:-[Pp][Ee][Rr][Pp])?$",
          example: "BTC",
        },
      },
      required: ["coin"],
    },
    outputExample: {
      coin: "BTC",
      market: {
        mark_price: 95000.5,
        oracle_price: 94990.0,
        mid_price: 95000.25,
        mark_oracle_basis_bps: 1.1054,
        prev_day_price: 93200.0,
        price_change_24h_pct: 1.9319,
        volume_24h_usd: 4520000000.0,
        open_interest_base: 25000.0,
        open_interest_usd: 2375012500.0,
        volume_to_oi_ratio: 1.9031,
        max_leverage: 50,
      },
      funding: {
        hourly_rate: 0.0000125,
        annualized_pct: 10.95,
        premium: 0.00011,
        regime: "POSITIVE",
      },
      orderbook: {
        best_bid: 95000.0,
        best_ask: 95000.5,
        spread_bps: 0.0526,
        bid_depth_5_usd: 1250000.0,
        ask_depth_5_usd: 1100000.0,
        imbalance_5: 0.0638,
        slippage_10k_buy_bps: 0.0263,
        slippage_10k_sell_bps: 0.0263,
        levels_sampled: 5,
      },
      metadata: {
        fetched_at: "2026-11-21T17:00:00.000Z",
        sources: ["hyperliquid"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["coin", "market", "funding", "orderbook", "metadata"],
      properties: {
        coin: { type: "string" },
        market: { type: "object" },
        funding: { type: "object" },
        orderbook: { type: "object" },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "perps_screener",
    method: "GET",
    path: "/v1/perps/screener",
    routeKey: "GET /v1/perps/screener",
    summary: "Hyperliquid all-markets perpetual futures screener",
    description:
      "Scans all ~180+ Hyperliquid perpetuals in one call: market breadth, median funding APR, and top leaderboards for extreme funding, mark/oracle basis dislocations, and volume/OI turnover. Informational market/security data only; not financial advice.",
    tags: ["hyperliquid", "screener", "perps"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "limit",
    queryParamDescription: "Optional leaderboard size (1-25, default 10).",
    queryParamExample: "10",
    exampleQueryParams: {
      limit: "10",
      min_oi_usd: "1000000",
    },
    inputSchema: {
      type: "object",
      properties: {
        min_oi_usd: {
          type: "string",
          description: "Optional minimum open interest USD filter (default 1000000).",
          example: "1000000",
        },
        limit: {
          type: "string",
          description: "Optional leaderboard size per category (1-25, default 10).",
          example: "10",
        },
      },
      required: [],
    },
    outputExample: {
      venue: "hyperliquid",
      filters: { min_oi_usd: 1000000, limit: 10 },
      market_summary: {
        total_markets: 185,
        qualifying_markets: 74,
        total_open_interest_usd: 6850000000,
        total_volume_24h_usd: 14200000000,
        median_funding_annualized_pct: 9.85,
        positive_funding_count: 142,
        negative_funding_count: 25,
        neutral_funding_count: 18,
      },
      highest_funding: [],
      lowest_funding: [],
      widest_basis: [],
      highest_turnover: [],
      metadata: {
        fetched_at: "2026-11-21T17:00:00.000Z",
        sources: ["hyperliquid"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "venue",
        "filters",
        "market_summary",
        "highest_funding",
        "lowest_funding",
        "widest_basis",
        "highest_turnover",
        "metadata",
      ],
      properties: {
        venue: { type: "string" },
        filters: { type: "object" },
        market_summary: { type: "object" },
        highest_funding: { type: "array", items: { type: "object" } },
        lowest_funding: { type: "array", items: { type: "object" } },
        widest_basis: { type: "array", items: { type: "object" } },
        highest_turnover: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "perps_funding_arb",
    method: "GET",
    path: "/v1/perps/funding-arb",
    routeKey: "GET /v1/perps/funding-arb",
    summary: "Cross-venue perpetual funding spread scanner (Hyperliquid, dYdX v4, Kraken Futures)",
    description:
      "Compares live hourly & annualized funding rates across Hyperliquid, dYdX v4, and Kraken Futures in one call to surface the widest cross-venue funding spreads and mark-price basis. Informational market/security data only; not financial advice.",
    tags: ["perps", "funding", "arbitrage"],
    priceAmount: "0.015",
    priceFormatted: "$0.015",
    priceUsd: 0.015,
    queryParamName: "limit",
    queryParamDescription: "Optional number of top spreads to return (1-25, default 10).",
    queryParamExample: "10",
    exampleQueryParams: {
      limit: "10",
      min_oi_usd: "100000",
    },
    inputSchema: {
      type: "object",
      properties: {
        min_oi_usd: {
          type: "string",
          description:
            "Optional minimum per-venue open interest USD filter applied to each participating leg (default 100000; ignored when coin is set).",
          example: "100000",
        },
        limit: {
          type: "string",
          description: "Optional number of top cross-venue spreads to return (1-25, default 10).",
          example: "10",
        },
        coin: {
          type: "string",
          description: "Optional base asset symbol filter (e.g., BTC, ETH, SOL).",
          example: "BTC",
        },
      },
      required: [],
    },
    outputExample: {
      filters: { min_oi_usd: 100000, limit: 10, coin: null },
      venues_active: ["hyperliquid", "dydx", "kraken"],
      matched_assets_count: 34,
      opportunities: [
        {
          asset: "SOL",
          venues_compared: 3,
          spread_annualized_pct: 23.74,
          highest_funding_venue: "dydx",
          lowest_funding_venue: "kraken",
          mark_price_spread_bps: 0.49,
          min_open_interest_usd: 8858759,
          max_open_interest_usd: 185000000,
          venues: {
            hyperliquid: {
              symbol: "SOL",
              hourly_rate: 0.000012,
              annualized_pct: 10.512,
              mark_price: 70.23,
              open_interest_usd: 185000000,
              volume_24h_usd: 420000000,
            },
            dydx: {
              symbol: "SOL-USD",
              hourly_rate: 0.00003214,
              annualized_pct: 28.1546,
              mark_price: 70.2257,
              open_interest_usd: 8858759,
              volume_24h_usd: 354042,
            },
            kraken: {
              symbol: "PF_SOLUSD",
              hourly_rate: 0.00000504,
              annualized_pct: 4.415,
              mark_price: 70.2223,
              open_interest_usd: 14620286,
              volume_24h_usd: 49212396,
            },
          },
        },
      ],
      metadata: {
        fetched_at: "2026-11-21T17:00:00.000Z",
        sources: ["hyperliquid", "dydx", "kraken"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["filters", "venues_active", "matched_assets_count", "opportunities", "metadata"],
      properties: {
        filters: { type: "object" },
        venues_active: { type: "array", items: { type: "string" } },
        matched_assets_count: { type: "integer" },
        opportunities: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "predictions_scanner",
    method: "GET",
    path: "/v1/predictions/scanner",
    routeKey: "GET /v1/predictions/scanner",
    summary: "Polymarket + Kalshi live prediction markets scanner & carry finder",
    description:
      "Scans live Polymarket and Kalshi prediction markets in one call with implied probabilities, bid-ask spreads, 24h volume/liquidity ratios, keyword search, and high-conviction annualized carry to expiry. Informational market/security data only; not financial advice.",
    tags: ["predictions", "polymarket", "kalshi"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "venue",
    queryParamDescription: "Optional venue filter: all (default), polymarket, or kalshi.",
    queryParamExample: "all",
    exampleQueryParams: {
      venue: "all",
      limit: "10",
    },
    inputSchema: {
      type: "object",
      properties: {
        venue: {
          type: "string",
          description: "Optional venue filter: all (default), polymarket, or kalshi.",
          enum: ["all", "polymarket", "kalshi"],
          example: "all",
        },
        query: {
          type: "string",
          description: "Optional keyword search across market titles, tickers, and categories (1-64 chars).",
          example: "bitcoin",
        },
        min_volume_24h_usd: {
          type: "string",
          description: "Optional minimum 24h USD volume filter (default 1000; default 0 when query is set).",
          example: "1000",
        },
        limit: {
          type: "string",
          description: "Optional leaderboard size per category (1-25, default 10).",
          example: "10",
        },
      },
      required: [],
    },
    outputExample: {
      filters: { venue: "all", query: null, min_volume_24h_usd: 1000, limit: 10 },
      venues_active: ["polymarket", "kalshi"],
      market_summary: {
        scanned_count: 250,
        matching_count: 148,
        polymarket_count: 92,
        kalshi_count: 56,
        total_volume_24h_usd: 48250000,
      },
      top_by_volume: [
        {
          venue: "polymarket",
          id: "517310",
          title: "Will BTC trade above $100k before December 31?",
          category: "Crypto",
          yes_prob: 0.88,
          no_prob: 0.12,
          bid_ask_spread_bps: 100,
          volume_24h_usd: 4250000,
          liquidity_usd: 1850000,
          volume_to_liquidity_ratio: 2.2973,
          expires_at: "2026-12-31T23:59:00Z",
          hours_to_expiry: 946,
          dominant_side: "YES",
          dominant_prob: 0.88,
          implied_annualized_carry_pct: 126.25,
          url: "https://polymarket.com/market/btc-above-100k-dec-31",
        },
      ],
      high_conviction_carry: [],
      widest_spreads: [],
      metadata: {
        fetched_at: "2026-11-22T12:00:00.000Z",
        sources: ["polymarket", "kalshi"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "filters",
        "venues_active",
        "market_summary",
        "top_by_volume",
        "high_conviction_carry",
        "widest_spreads",
        "metadata",
      ],
      properties: {
        filters: { type: "object" },
        venues_active: { type: "array", items: { type: "string" } },
        market_summary: { type: "object" },
        top_by_volume: { type: "array", items: { type: "object" } },
        high_conviction_carry: { type: "array", items: { type: "object" } },
        widest_spreads: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "options_surface",
    method: "GET",
    path: "/v1/options/surface",
    routeKey: "GET /v1/options/surface",
    summary: "Deribit BTC/ETH options volatility surface, skew, max pain & OI walls",
    description:
      "Distills hundreds of live Deribit BTC or ETH option contracts into one deterministic brief: ATM IV term structure, contango/backwardation slope, OTM put-call skew, put/call OI ratios, exact max pain strike, and top call/put OI walls. Informational market/security data only; not financial advice.",
    tags: ["options", "deribit", "volatility"],
    priceAmount: "0.015",
    priceFormatted: "$0.015",
    priceUsd: 0.015,
    queryParamName: "currency",
    queryParamDescription: "Underlying asset symbol: BTC (default) or ETH.",
    queryParamExample: "BTC",
    exampleQueryParams: {
      currency: "BTC",
    },
    inputSchema: {
      type: "object",
      properties: {
        currency: {
          type: "string",
          description: "Underlying asset symbol: BTC (default) or ETH.",
          enum: ["BTC", "ETH"],
          example: "BTC",
        },
      },
      required: [],
    },
    outputExample: {
      venue: "deribit",
      currency: "BTC",
      spot_index_price: 95000,
      summary: {
        total_contracts: 612,
        total_open_interest_contracts: 185400,
        total_open_interest_usd: 17613000000,
        call_open_interest_contracts: 121200,
        put_open_interest_contracts: 64200,
        put_call_oi_ratio: 0.5297,
        volume_24h_contracts: 24500,
        volume_24h_usd: 2327500000,
        put_call_volume_ratio: 0.612,
      },
      vol_regime: {
        front_atm_iv_pct: 52.4,
        mid_30d_atm_iv_pct: 57.1,
        term_slope_iv_pts: 4.7,
        structure: "CONTANGO",
        front_skew_iv_pts: 3.2,
        skew_regime: "PUT_PREMIUM",
      },
      nearest_major_expiry: {
        expiry_code: "27NOV26",
        expiry_iso: "2026-11-27T08:00:00.000Z",
        dte_days: 4.83,
        max_pain_strike: 94000,
        max_pain_distance_pct: -1.05,
        top_call_walls: [
          { strike: 100000, open_interest: 12500, open_interest_usd: 1187500000, distance_from_spot_pct: 5.26 },
        ],
        top_put_walls: [
          { strike: 90000, open_interest: 8900, open_interest_usd: 845500000, distance_from_spot_pct: -5.26 },
        ],
      },
      term_structure: [],
      metadata: {
        fetched_at: "2026-11-22T12:00:00.000Z",
        sources: ["deribit"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "venue",
        "currency",
        "spot_index_price",
        "summary",
        "vol_regime",
        "nearest_major_expiry",
        "term_structure",
        "metadata",
      ],
      properties: {
        venue: { type: "string" },
        currency: { type: "string" },
        spot_index_price: { type: "number" },
        summary: { type: "object" },
        vol_regime: { type: "object" },
        nearest_major_expiry: { type: ["object", "null"] },
        term_structure: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "macro_liquidity",
    method: "GET",
    path: "/v1/macro/liquidity",
    routeKey: "GET /v1/macro/liquidity",
    summary: "Official US Treasury debt, TGA cash, NY Fed ON RRP, SOFR/EFFR & net liquidity impulse",
    description:
      "Combines 5 official US Treasury Fiscal Data and NY Fed feeds in one call: exact US public debt, Treasury General Account (TGA) balance & flows, ON RRP balance, EFFR/SOFR funding spread (bps), and deterministic net USD liquidity impulse. Informational market/security data only; not financial advice.",
    tags: ["macro", "treasury", "liquidity"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "lookback_obs",
    queryParamDescription: "Optional number of recent business-day observations for liquidity delta (2-20, default 5).",
    queryParamExample: "5",
    exampleQueryParams: {
      lookback_obs: "5",
    },
    inputSchema: {
      type: "object",
      properties: {
        lookback_obs: {
          type: "string",
          description: "Optional number of recent business-day observations for liquidity delta (integer 2-20, default 5).",
          example: "5",
        },
      },
      required: [],
    },
    outputExample: {
      lookback_obs: 5,
      us_debt: {
        record_date: "2026-11-20",
        total_public_debt_usd: 36542100000000,
        debt_held_public_usd: 29120000000000,
        intragov_holdings_usd: 7422100000000,
        daily_change_usd: 14500000000,
        period_change_usd: 68200000000,
      },
      tga: {
        record_date: "2026-11-20",
        closing_balance_usd: 785400000000,
        daily_change_usd: -12300000000,
        period_change_usd: -34500000000,
      },
      on_rrp: {
        operation_date: "2026-11-20",
        accepted_usd: 142000000000,
        award_rate_pct: 4.25,
        counterparties_accepted: 48,
        daily_change_usd: -8500000000,
        period_change_usd: -21000000000,
      },
      rates: {
        effr_date: "2026-11-20",
        effr_pct: 4.33,
        fomc_target_low_pct: 4.25,
        fomc_target_high_pct: 4.5,
        sofr_date: "2026-11-20",
        sofr_pct: 4.35,
        sofr_volume_billions: 2180.5,
        sofr_effr_spread_bps: 2,
        funding_stress_regime: "NORMAL",
      },
      liquidity_impulse: {
        lookback_obs: 5,
        tga_liquidity_effect_usd: 34500000000,
        rrp_liquidity_effect_usd: 21000000000,
        combined_net_impulse_usd: 55500000000,
        regime: "EXPANDING",
      },
      metadata: {
        fetched_at: "2026-11-22T12:00:00.000Z",
        sources: ["treasury_debt", "treasury_tga", "nyfed_rrp", "nyfed_sofr", "nyfed_effr"],
        missing_sources: [],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["lookback_obs", "us_debt", "tga", "on_rrp", "rates", "liquidity_impulse", "metadata"],
      properties: {
        lookback_obs: { type: "integer" },
        us_debt: { type: ["object", "null"] },
        tga: { type: ["object", "null"] },
        on_rrp: { type: ["object", "null"] },
        rates: { type: "object" },
        liquidity_impulse: { type: "object" },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "evm_safety",
    method: "GET",
    path: "/v1/evm/safety",
    routeKey: "GET /v1/evm/safety",
    summary: "Multi-chain EVM token safety, honeypot simulation & DEX liquidity audit",
    description:
      "Deterministic EVM token safety audit across Base, Ethereum, Arbitrum, Optimism, Polygon, and BSC combining GoPlus security, Honeypot.is simulation, engine disagreement flags, and DEX liquidity ratios. Informational market/security data only; not financial advice.",
    tags: ["evm", "base", "security"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "address",
    queryParamDescription: "EVM ERC-20 token contract address (0x followed by 40 hex characters).",
    queryParamExample: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    exampleQueryParams: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      chain: "base",
    },
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "EVM ERC-20 token contract address (0x followed by 40 hex characters).",
          pattern: "^0x[0-9a-fA-F]{40}$",
          example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
        chain: {
          type: "string",
          description: "Optional EVM chain: base (default), ethereum, arbitrum, optimism, polygon, or bsc.",
          enum: ["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc"],
          example: "base",
        },
      },
      required: ["address"],
    },
    outputExample: {
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      chain: "base",
      chain_id: 8453,
      symbol: "USDC",
      name: "USD Coin",
      risk_score: 5,
      risk_tier: "LOW",
      flags: ["PROXY_UPGRADEABLE"],
      security: {
        is_honeypot: false,
        engine_disagreement: false,
        simulation_success: true,
        buy_tax_pct: 0,
        sell_tax_pct: 0,
        transfer_tax_pct: 0,
        is_open_source: true,
        is_proxy: true,
        is_mintable: false,
        owner_change_balance: false,
        hidden_owner: false,
        can_take_back_ownership: false,
        selfdestruct: false,
        cannot_buy: false,
        cannot_sell_all: false,
        transfer_pausable: false,
        is_blacklisted: false,
        slippage_modifiable: false,
        owner_renounced: false,
        holder_count: 1500000,
        top10_holder_pct: 22.5,
        lp_locked_pct: null,
        engines: { goplus: "ok", honeypot_is: "ok" },
      },
      market: {
        price_usd: 1.0,
        liquidity_usd: 420000000,
        volume_24h_usd: 850000000,
        volume_to_liquidity_ratio: 2.0238,
        fdv_usd: 3500000000,
        fdv_to_liquidity_ratio: 8.3333,
        price_change_24h_pct: 0.01,
        pair_count: 25,
        pair_age_hours: 18000,
        primary_dex: "aerodrome",
        primary_pair_address: "0x0000000000000000000000000000000000000001",
      },
      metadata: {
        fetched_at: "2026-11-22T12:00:00.000Z",
        sources: ["goplus", "honeypot_is", "dexscreener"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["address", "chain", "chain_id", "risk_score", "risk_tier", "flags", "security", "market", "metadata"],
      properties: {
        address: { type: "string" },
        chain: { type: "string" },
        chain_id: { type: "integer" },
        symbol: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
        risk_score: { type: "integer", minimum: 0, maximum: 100 },
        risk_tier: { type: "string", enum: ["LOW", "MODERATE", "ELEVATED", "CRITICAL"] },
        flags: { type: "array", items: { type: "string" } },
        security: { type: "object" },
        market: { type: "object" },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "predictions_arb",
    method: "GET",
    path: "/v1/predictions/arb",
    routeKey: "GET /v1/predictions/arb",
    summary: "Polymarket vs Kalshi cross-venue prediction market arbitrage detector",
    description:
      "Matches overlapping Polymarket and Kalshi prediction markets within a 72h expiry window to surface cross-venue arbitrage spreads, fee-adjusted net edge (bps), annualized APY, and resolution-risk warnings. Informational market/security data only; not financial advice.",
    tags: ["predictions", "arbitrage", "polymarket", "kalshi"],
    priceAmount: "0.02",
    priceFormatted: "$0.02",
    priceUsd: 0.02,
    queryParamName: "min_spread_bps",
    queryParamDescription: "Optional minimum fee-adjusted net edge in basis points (0-5000, default 150).",
    queryParamExample: "150",
    exampleQueryParams: {
      min_spread_bps: "150",
      min_liquidity_usd: "5000",
      limit: "15",
    },
    inputSchema: {
      type: "object",
      properties: {
        min_spread_bps: {
          type: "string",
          description: "Optional minimum fee-adjusted net edge in basis points (0-5000, default 150).",
          example: "150",
        },
        min_liquidity_usd: {
          type: "string",
          description: "Optional minimum per-venue liquidity USD filter (default 5000).",
          example: "5000",
        },
        query: {
          type: "string",
          description: "Optional keyword search across matched market titles/categories (1-64 chars).",
          example: "bitcoin",
        },
        limit: {
          type: "string",
          description: "Optional maximum opportunities to return (1-30, default 15).",
          example: "15",
        },
      },
      required: [],
    },
    outputExample: {
      filters: { min_spread_bps: 150, min_liquidity_usd: 5000, query: null, limit: 15 },
      venues_active: ["polymarket", "kalshi"],
      summary: {
        polymarket_scanned: 150,
        kalshi_scanned: 100,
        polymarket_eligible: 80,
        kalshi_eligible: 80,
        matched_pairs_count: 6,
        qualifying_opportunities_count: 2,
        best_net_edge_bps: 420.5,
      },
      opportunities: [],
      metadata: {
        fetched_at: "2026-11-22T12:00:00.000Z",
        sources: ["polymarket", "kalshi"],
        fee_model: "Kalshi parabolic taker fee 0.07*p*(1-p) + 20bps Polymarket execution buffer (+50bps/leg if mid fallback)",
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["filters", "venues_active", "summary", "opportunities", "metadata"],
      properties: {
        filters: { type: "object" },
        venues_active: { type: "array", items: { type: "string" } },
        summary: { type: "object" },
        opportunities: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "execution_quote_check",
    method: "GET",
    path: "/v1/execution/quote-check",
    routeKey: "GET /v1/execution/quote-check",
    summary: "Multi-tier pre-trade slippage & liquidity check for EVM swaps and Hyperliquid perps",
    description:
      "Pre-trade execution and slippage simulator across USD size tiers ($1k/$10k/$50k+) for EVM DEX swaps (KyberSwap Aggregator + DEX Screener) or Hyperliquid perpetual L2 books, returning price impact bps, max size under 100bps, and liquidity grade. Informational market/security data only; not financial advice.",
    tags: ["execution", "slippage", "defi", "perps"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "mode",
    queryParamDescription: "Execution venue mode: 'perps' (Hyperliquid L2) or 'evm' (KyberSwap multi-chain).",
    queryParamExample: "perps",
    exampleQueryParams: {
      mode: "perps",
      coin: "BTC",
    },
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Required mode: 'perps' (Hyperliquid L2 orderbook) or 'evm' (KyberSwap DEX aggregator).",
          enum: ["perps", "evm"],
          example: "perps",
        },
        coin: {
          type: "string",
          description: "Required when mode=perps: Hyperliquid ticker symbol (e.g., BTC, ETH, SOL).",
          example: "BTC",
        },
        side: {
          type: "string",
          description: "Optional when mode=perps: 'buy', 'sell', or 'both' (default 'both').",
          enum: ["buy", "sell", "both"],
          example: "both",
        },
        chain: {
          type: "string",
          description: "Optional when mode=evm: base (default), ethereum, arbitrum, optimism, polygon, or bsc.",
          enum: ["base", "ethereum", "arbitrum", "optimism", "polygon", "bsc"],
          example: "base",
        },
        token_out: {
          type: "string",
          description: "Required when mode=evm: destination ERC-20 token address (0x...).",
          example: "0x4200000000000000000000000000000000000006",
        },
        token_in: {
          type: "string",
          description: "Optional when mode=evm: source ERC-20 token address (defaults to native USDC on chain).",
          example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
        token_in_decimals: {
          type: "string",
          description: "Optional when mode=evm: decimals (0-18) required only for custom non-registry token_in.",
          example: "6",
        },
        sizes_usd: {
          type: "string",
          description: "Optional comma-separated USD tiers (up to 3 for evm, 4 for perps; e.g. '1000,10000,50000').",
          example: "1000,10000,50000",
        },
      },
      required: ["mode"],
    },
    outputExample: {
      mode: "perps",
      venue: "hyperliquid",
      coin: "BTC",
      side: "both",
      market: {
        mid_price: 95000.25,
        mark_price: 95000.5,
        oracle_price: 94990.0,
        best_bid: 95000.0,
        best_ask: 95000.5,
        spread_bps: 0.05,
        open_interest_usd: 2375012500.0,
        volume_24h_usd: 4520000000.0,
        levels_sampled: { bids: 20, asks: 20 },
      },
      summary: {
        executable: true,
        liquidity_grade: "DEEP",
        max_size_under_100bps_usd: 1500000,
        capped_by_visible_book: true,
        flags: ["VISIBLE_BOOK_DEPTH_CAP"],
      },
      buy: {
        side: "buy",
        executable_all_tiers: true,
        visible_depth_usd: 1500000,
        max_size_under_100bps_usd: 1500000,
        capped_by_visible_book: true,
        tiers: [
          {
            size_usd: 10000,
            executable: true,
            fill_pct: 100,
            effective_price: 95000.5,
            worst_fill_price: 95000.5,
            vwap_slippage_bps: 0.03,
            price_impact_bps: 0.03,
          },
        ],
      },
      sell: {
        side: "sell",
        executable_all_tiers: true,
        visible_depth_usd: 1500000,
        max_size_under_100bps_usd: 1500000,
        capped_by_visible_book: true,
        tiers: [
          {
            size_usd: 10000,
            executable: true,
            fill_pct: 100,
            effective_price: 95000.0,
            worst_fill_price: 95000.0,
            vwap_slippage_bps: 0.03,
            price_impact_bps: 0.03,
          },
        ],
      },
      metadata: {
        fetched_at: "2026-11-22T12:00:00.000Z",
        sources: ["hyperliquid"],
        disclaimer: DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["mode", "summary", "metadata"],
      properties: {
        mode: { type: "string", enum: ["perps", "evm"] },
        venue: { type: "string" },
        coin: { type: "string" },
        side: { type: "string", enum: ["buy", "sell", "both"] },
        market: { type: "object" },
        chain: { type: "string" },
        chain_id: { type: "integer" },
        token_in: { type: "object" },
        token_out: { type: "object" },
        summary: {
          type: "object",
          required: ["executable", "liquidity_grade", "max_size_under_100bps_usd", "flags"],
          properties: {
            executable: { type: "boolean" },
            liquidity_grade: { type: "string", enum: ["DEEP", "ADEQUATE", "THIN", "ILLIQUID"] },
            max_size_under_100bps_usd: { type: "number" },
            capped_by_visible_book: { type: "boolean" },
            max_size_is_extrapolated: { type: "boolean" },
            worst_executable_impact_bps: { type: ["number", "null"] },
            flags: { type: "array", items: { type: "string" } },
          },
        },
        buy: { type: ["object", "null"] },
        sell: { type: ["object", "null"] },
        tiers: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
] as const;

export const CATALOG_BY_PATH: Readonly<Record<string, EndpointCatalogEntry>> =
  Object.fromEntries(CATALOG.map((entry) => [entry.path, entry]));

export const CATALOG_BY_ID: Readonly<Record<EndpointId, EndpointCatalogEntry>> =
  Object.fromEntries(CATALOG.map((entry) => [entry.id, entry])) as Record<
    EndpointId,
    EndpointCatalogEntry
  >;

export function getEndpointById(id: EndpointId): EndpointCatalogEntry {
  return CATALOG_BY_ID[id];
}

export function getEndpointByPath(path: string): EndpointCatalogEntry | undefined {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  const normalized = decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
  return CATALOG_BY_PATH[normalized];
}
