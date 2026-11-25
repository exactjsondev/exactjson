export type AppEnvironment = "testnet" | "mainnet";

export type CacheStatus = "HIT" | "MISS" | "PARTIAL" | "NONE";

export type RequestOutcome =
  | "CHALLENGED_402"
  | "VERIFY_FAILED"
  | "SETTLED"
  | "UNSETTLED_ERROR";

export type RequestTransport = "http" | "mcp";

export type RiskTier = "LOW" | "MODERATE" | "ELEVATED" | "CRITICAL";

export type FundingRegime = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface Env {
  APP_ENV: AppEnvironment | string;
  X402_NETWORK: string;
  X402_PAY_TO: string;
  PUBLIC_BASE_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  DASHBOARD_TOKEN?: string;
  DB: D1Database;
}

export interface AppVariables {
  cache_status?: CacheStatus;
  upstream_source?: string;
  upstream_error?: string;
  query_target?: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: AppVariables;
};

export interface RugCheckRiskItem {
  name: string;
  description: string;
  level: string;
  score: number;
  value?: string;
}

export interface RugCheckSummary {
  mint: string;
  rawScore: number | null;
  scoreNormalised: number | null;
  lpLockedPct: number | null;
  tokenProgram: string | null;
  tokenType: string | null;
  risks: RugCheckRiskItem[];
}

export interface DexScreenerAggregated {
  pairCount: number;
  totalLiquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  fdvUsd: number | null;
  primaryDex: string | null;
  primaryPairAddress: string | null;
  symbol: string | null;
  name: string | null;
  earliestPairCreatedAt?: string | null;
}

export interface SolanaSafetyResponse {
  mint: string;
  symbol: string | null;
  name: string | null;
  risk_score: number;
  risk_tier: RiskTier;
  flags: string[];
  security: {
    rugcheck_score: number | null;
    rugcheck_score_normalized: number | null;
    lp_locked_pct: number | null;
    mint_authority_flagged: boolean;
    freeze_authority_flagged: boolean;
    mutable_metadata_flagged: boolean;
    risk_count: number;
    danger_count: number;
    warn_count: number;
    risks: RugCheckRiskItem[];
  };
  market: {
    price_usd: number | null;
    liquidity_usd: number;
    volume_24h_usd: number;
    volume_to_liquidity_ratio: number | null;
    fdv_usd: number | null;
    fdv_to_liquidity_ratio: number | null;
    price_change_24h_pct: number | null;
    pair_count: number;
    primary_dex: string | null;
    primary_pair_address: string | null;
  };
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

export interface HyperliquidAssetCtx {
  funding: number | null;
  openInterest: number | null;
  prevDayPx: number | null;
  dayNtlVlm: number | null;
  premium: number | null;
  oraclePx: number | null;
  markPx: number | null;
  midPx: number | null;
}

export interface HyperliquidAssetEntry {
  canonicalName: string;
  maxLeverage: number | null;
  szDecimals: number | null;
  ctx: HyperliquidAssetCtx;
}

export interface HyperliquidBookLevel {
  px: number;
  sz: number;
  n: number;
}

export interface HyperliquidL2Book {
  coin: string;
  time: number | null;
  bids: HyperliquidBookLevel[];
  asks: HyperliquidBookLevel[];
}

export interface PerpsSnapshotResponse {
  coin: string;
  market: {
    mark_price: number | null;
    oracle_price: number | null;
    mid_price: number | null;
    mark_oracle_basis_bps: number | null;
    prev_day_price: number | null;
    price_change_24h_pct: number | null;
    volume_24h_usd: number | null;
    open_interest_base: number | null;
    open_interest_usd: number | null;
    volume_to_oi_ratio: number | null;
    max_leverage: number | null;
  };
  funding: {
    hourly_rate: number | null;
    annualized_pct: number | null;
    premium: number | null;
    regime: FundingRegime;
  };
  orderbook: {
    best_bid: number | null;
    best_ask: number | null;
    spread_bps: number | null;
    bid_depth_5_usd: number | null;
    ask_depth_5_usd: number | null;
    imbalance_5: number | null;
    slippage_10k_buy_bps: number | null;
    slippage_10k_sell_bps: number | null;
    levels_sampled: number;
  };
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

export interface ScreenerMarketItem {
  coin: string;
  mark_price: number | null;
  oracle_price: number | null;
  mark_oracle_basis_bps: number | null;
  funding_hourly_rate: number | null;
  funding_annualized_pct: number | null;
  funding_regime: FundingRegime;
  open_interest_usd: number | null;
  volume_24h_usd: number | null;
  volume_to_oi_ratio: number | null;
  price_change_24h_pct: number | null;
  max_leverage: number | null;
}

export interface PerpsScreenerResponse {
  venue: "hyperliquid";
  filters: {
    min_oi_usd: number;
    limit: number;
  };
  market_summary: {
    total_markets: number;
    qualifying_markets: number;
    total_open_interest_usd: number;
    total_volume_24h_usd: number;
    median_funding_annualized_pct: number | null;
    positive_funding_count: number;
    negative_funding_count: number;
    neutral_funding_count: number;
  };
  highest_funding: ScreenerMarketItem[];
  lowest_funding: ScreenerMarketItem[];
  widest_basis: ScreenerMarketItem[];
  highest_turnover: ScreenerMarketItem[];
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

export type PerpVenueName = "hyperliquid" | "dydx" | "kraken";

export interface VenuePerpMarket {
  venue: PerpVenueName;
  symbol: string;
  baseAsset: string;
  scaledUnit: boolean;
  markPrice: number | null;
  hourlyFundingRate: number | null;
  openInterestUsd: number | null;
  volume24hUsd: number | null;
}

export interface FundingArbVenueQuote {
  symbol: string;
  hourly_rate: number;
  annualized_pct: number;
  mark_price: number | null;
  open_interest_usd: number | null;
  volume_24h_usd: number | null;
}

export interface FundingArbOpportunity {
  asset: string;
  venues_compared: number;
  spread_annualized_pct: number;
  highest_funding_venue: PerpVenueName;
  lowest_funding_venue: PerpVenueName;
  mark_price_spread_bps: number | null;
  min_open_interest_usd: number | null;
  max_open_interest_usd: number | null;
  venues: Partial<Record<PerpVenueName, FundingArbVenueQuote>>;
}

export interface FundingArbResponse {
  filters: {
    min_oi_usd: number;
    limit: number;
    coin: string | null;
  };
  venues_active: PerpVenueName[];
  matched_assets_count: number;
  opportunities: FundingArbOpportunity[];
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

export interface TrendingSolanaPool {
  mint: string;
  symbol: string | null;
  poolName: string;
  poolAddress: string | null;
  dex: string | null;
  priceUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  uniqueTraders24h: number | null;
  poolCreatedAt: string | null;
}

export interface SolanaTrendingItem {
  rank: number;
  mint: string;
  symbol: string | null;
  pool_name: string;
  dex: string | null;
  pool_address: string | null;
  pool_created_at: string | null;
  safety: {
    verified: boolean;
    risk_score: number | null;
    risk_tier: RiskTier | "UNVERIFIED";
    flags: string[];
    lp_locked_pct: number | null;
    mint_authority_flagged: boolean | null;
    freeze_authority_flagged: boolean | null;
    mutable_metadata_flagged: boolean | null;
    danger_count: number | null;
    warn_count: number | null;
  };
  market: {
    price_usd: number | null;
    liquidity_usd: number;
    volume_24h_usd: number;
    volume_to_liquidity_ratio: number | null;
    fdv_usd: number | null;
    price_change_24h_pct: number | null;
    buys_24h: number | null;
    sells_24h: number | null;
    buy_sell_ratio_24h: number | null;
    unique_traders_24h: number | null;
  };
}

export interface SolanaTrendingResponse {
  filters: {
    limit: number;
    max_risk_score: number | null;
  };
  scanned_count: number;
  returned_count: number;
  tokens: SolanaTrendingItem[];
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

// --- Prediction Markets Scanner (/v1/predictions/scanner) ---

export type PredictionVenueName = "polymarket" | "kalshi";

export interface RawPredictionMarket {
  venue: PredictionVenueName;
  id: string;
  title: string;
  category: string | null;
  isBinaryYesNo?: boolean;
  yesProb: number | null;
  noProb: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  spreadBps: number | null;
  volume24hUsd: number;
  liquidityUsd: number | null;
  openInterestUsd: number | null;
  expiresAt: string | null;
  url: string | null;
}

export interface PredictionMarketItem {
  venue: PredictionVenueName;
  id: string;
  title: string;
  category: string | null;
  yes_prob: number | null;
  no_prob: number | null;
  bid_ask_spread_bps: number | null;
  volume_24h_usd: number;
  liquidity_usd: number | null;
  volume_to_liquidity_ratio: number | null;
  expires_at: string | null;
  hours_to_expiry: number | null;
  dominant_side: "YES" | "NO" | null;
  dominant_prob: number | null;
  implied_annualized_carry_pct: number | null;
  url: string | null;
}

export interface PredictionsScannerResponse {
  filters: {
    venue: "all" | PredictionVenueName;
    query: string | null;
    min_volume_24h_usd: number;
    limit: number;
  };
  venues_active: PredictionVenueName[];
  market_summary: {
    scanned_count: number;
    matching_count: number;
    polymarket_count: number;
    kalshi_count: number;
    total_volume_24h_usd: number;
  };
  top_by_volume: PredictionMarketItem[];
  high_conviction_carry: PredictionMarketItem[];
  widest_spreads: PredictionMarketItem[];
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

// --- Crypto Options Volatility Surface (/v1/options/surface) ---

export type OptionsCurrency = "BTC" | "ETH";
export type VolTermStructure = "CONTANGO" | "BACKWARDATION" | "FLAT";
export type SkewRegime = "PUT_PREMIUM" | "CALL_PREMIUM" | "BALANCED";

export interface DeribitOptionContract {
  instrumentName: string;
  currency: OptionsCurrency;
  expiryCode: string;
  expiryMs: number;
  expiryIso: string;
  strike: number;
  optionType: "C" | "P";
  markIvPct: number | null;
  openInterest: number;
  volume24h: number;
  volume24hUsd: number | null;
  underlyingPrice: number | null;
}

export interface OptionsExpirySlice {
  expiry_code: string;
  expiry_iso: string;
  dte_days: number;
  contract_count: number;
  atm_strike: number | null;
  atm_iv_pct: number | null;
  call_oi: number;
  put_oi: number;
  put_call_oi_ratio: number | null;
  otm_skew_iv_pts: number | null;
}

export interface OptionsStrikeWall {
  strike: number;
  open_interest: number;
  open_interest_usd: number | null;
  distance_from_spot_pct: number | null;
}

export interface OptionsSurfaceResponse {
  venue: "deribit";
  currency: OptionsCurrency;
  spot_index_price: number;
  summary: {
    total_contracts: number;
    total_open_interest_contracts: number;
    total_open_interest_usd: number;
    call_open_interest_contracts: number;
    put_open_interest_contracts: number;
    put_call_oi_ratio: number | null;
    volume_24h_contracts: number;
    volume_24h_usd: number;
    put_call_volume_ratio: number | null;
  };
  vol_regime: {
    front_atm_iv_pct: number | null;
    mid_30d_atm_iv_pct: number | null;
    term_slope_iv_pts: number | null;
    structure: VolTermStructure;
    front_skew_iv_pts: number | null;
    skew_regime: SkewRegime;
  };
  nearest_major_expiry: {
    expiry_code: string;
    expiry_iso: string;
    dte_days: number;
    max_pain_strike: number | null;
    max_pain_distance_pct: number | null;
    top_call_walls: OptionsStrikeWall[];
    top_put_walls: OptionsStrikeWall[];
  } | null;
  term_structure: OptionsExpirySlice[];
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

// --- US Macro Liquidity & Treasury Pulse (/v1/macro/liquidity) ---

export type FundingStressRegime = "TIGHT" | "NORMAL" | "LOOSE";
export type LiquidityImpulseRegime = "EXPANDING" | "CONTRACTING" | "NEUTRAL";

export interface TreasuryDebtObservation {
  recordDate: string;
  totalPublicDebtUsd: number;
  debtHeldPublicUsd: number | null;
  intragovHoldingsUsd: number | null;
}

export interface TreasuryTgaObservation {
  recordDate: string;
  closingBalanceUsd: number;
}

export interface NyFedRateObservation {
  effectiveDate: string;
  percentRate: number;
  volumeInBillions: number | null;
  targetRateFrom: number | null;
  targetRateTo: number | null;
}

export interface NyFedRrpObservation {
  operationDate: string;
  acceptedUsd: number;
  awardRatePct: number | null;
  counterpartiesAccepted: number | null;
}

export interface MacroLiquidityResponse {
  lookback_obs: number;
  us_debt: {
    record_date: string;
    total_public_debt_usd: number;
    debt_held_public_usd: number | null;
    intragov_holdings_usd: number | null;
    daily_change_usd: number | null;
    period_change_usd: number | null;
  } | null;
  tga: {
    record_date: string;
    closing_balance_usd: number;
    daily_change_usd: number | null;
    period_change_usd: number | null;
  } | null;
  on_rrp: {
    operation_date: string;
    accepted_usd: number;
    award_rate_pct: number | null;
    counterparties_accepted: number | null;
    daily_change_usd: number | null;
    period_change_usd: number | null;
  } | null;
  rates: {
    effr_date: string | null;
    effr_pct: number | null;
    fomc_target_low_pct: number | null;
    fomc_target_high_pct: number | null;
    sofr_date: string | null;
    sofr_pct: number | null;
    sofr_volume_billions: number | null;
    sofr_effr_spread_bps: number | null;
    funding_stress_regime: FundingStressRegime | null;
  };
  liquidity_impulse: {
    lookback_obs: number;
    tga_liquidity_effect_usd: number | null;
    rrp_liquidity_effect_usd: number | null;
    combined_net_impulse_usd: number | null;
    regime: LiquidityImpulseRegime;
  };
  metadata: {
    fetched_at: string;
    sources: string[];
    missing_sources: string[];
    disclaimer: string;
  };
}

// --- EVM Token Safety (/v1/evm/safety) ---

export type EvmChainKey =
  | "base"
  | "ethereum"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bsc";

export interface EvmChainConfig {
  key: EvmChainKey;
  chainId: number;
  dexScreenerId: string;
  geckoTerminalId: string;
  honeypotSupported: boolean;
}

export type EvmEngineStatus =
  | "ok"
  | "not_found"
  | "unavailable"
  | "unsupported_chain";

export interface GoPlusTokenSecurity {
  address: string;
  chainId: number;
  tokenName: string | null;
  tokenSymbol: string | null;
  isHoneypot: boolean | null;
  isOpenSource: boolean | null;
  isProxy: boolean | null;
  isMintable: boolean | null;
  ownerChangeBalance: boolean | null;
  hiddenOwner: boolean | null;
  canTakeBackOwnership: boolean | null;
  selfdestruct: boolean | null;
  cannotBuy: boolean | null;
  cannotSellAll: boolean | null;
  transferPausable: boolean | null;
  isBlacklisted: boolean | null;
  slippageModifiable: boolean | null;
  ownerRenounced: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  holderCount: number | null;
  top10HolderPct: number | null;
  lpLockedPct: number | null;
}

export interface HoneypotIsResult {
  address: string;
  chainId: number;
  tokenName: string | null;
  tokenSymbol: string | null;
  simulationSuccess: boolean;
  simulationError: string | null;
  isHoneypot: boolean | null;
  honeypotReason: string | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  transferTaxPct: number | null;
  openSource: boolean | null;
  isProxy: boolean | null;
  holderCount: number | null;
}

export interface EvmSafetyResponse {
  address: string;
  chain: EvmChainKey;
  chain_id: number;
  symbol: string | null;
  name: string | null;
  risk_score: number;
  risk_tier: RiskTier;
  flags: string[];
  security: {
    is_honeypot: boolean | null;
    engine_disagreement: boolean;
    simulation_success: boolean | null;
    buy_tax_pct: number | null;
    sell_tax_pct: number | null;
    transfer_tax_pct: number | null;
    is_open_source: boolean | null;
    is_proxy: boolean | null;
    is_mintable: boolean | null;
    owner_change_balance: boolean | null;
    hidden_owner: boolean | null;
    can_take_back_ownership: boolean | null;
    selfdestruct: boolean | null;
    cannot_buy: boolean | null;
    cannot_sell_all: boolean | null;
    transfer_pausable: boolean | null;
    is_blacklisted: boolean | null;
    slippage_modifiable: boolean | null;
    owner_renounced: boolean | null;
    holder_count: number | null;
    top10_holder_pct: number | null;
    lp_locked_pct: number | null;
    engines: {
      goplus: EvmEngineStatus;
      honeypot_is: EvmEngineStatus;
    };
  };
  market: {
    price_usd: number | null;
    liquidity_usd: number;
    volume_24h_usd: number;
    volume_to_liquidity_ratio: number | null;
    fdv_usd: number | null;
    fdv_to_liquidity_ratio: number | null;
    price_change_24h_pct: number | null;
    pair_count: number;
    pair_age_hours: number | null;
    primary_dex: string | null;
    primary_pair_address: string | null;
  };
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}
// --- Prediction Markets Cross-Venue Arbitrage (/v1/predictions/arb) ---

export type PredictionsArbConfidence = "HIGH" | "MEDIUM";

export type PredictionsArbStrategy =
  | "BUY_YES_POLYMARKET_BUY_NO_KALSHI"
  | "BUY_YES_KALSHI_BUY_NO_POLYMARKET";

export type PredictionsArbQuoteQuality = "EXECUTABLE_BOOK" | "MID_FALLBACK";

export interface PredictionsArbLeg {
  venue: PredictionVenueName;
  id: string;
  title: string;
  category: string | null;
  action: "BUY_YES" | "BUY_NO";
  entry_price_usd: number;
  yes_prob: number | null;
  no_prob: number | null;
  bid_ask_spread_bps: number | null;
  volume_24h_usd: number;
  liquidity_usd: number | null;
  expires_at: string;
  url: string | null;
}

export interface PredictionsArbOpportunity {
  match_confidence: PredictionsArbConfidence;
  match_score: number;
  matched_tokens: string[];
  strategy: PredictionsArbStrategy;
  quote_quality: PredictionsArbQuoteQuality;
  combined_cost_usd: number;
  net_combined_cost_usd: number;
  gross_edge_bps: number;
  estimated_fees_bps: number;
  net_edge_bps: number;
  implied_prob_gap_bps: number | null;
  annualized_arb_apy_pct: number | null;
  hours_to_resolution: number;
  expiry_diff_hours: number;
  min_liquidity_usd: number;
  resolution_risk_warning: true;
  polymarket: PredictionsArbLeg;
  kalshi: PredictionsArbLeg;
}

export interface PredictionsArbResponse {
  filters: {
    min_spread_bps: number;
    min_liquidity_usd: number;
    query: string | null;
    limit: number;
  };
  venues_active: PredictionVenueName[];
  summary: {
    polymarket_scanned: number;
    kalshi_scanned: number;
    polymarket_eligible: number;
    kalshi_eligible: number;
    matched_pairs_count: number;
    qualifying_opportunities_count: number;
    best_net_edge_bps: number | null;
  };
  opportunities: PredictionsArbOpportunity[];
  metadata: {
    fetched_at: string;
    sources: PredictionVenueName[];
    fee_model: string;
    disclaimer: string;
  };
}
// --- Execution Pre-Trade Quote Check (/v1/execution/quote-check) ---

export type QuoteCheckMode = "evm" | "perps";
export type QuoteCheckPerpSide = "buy" | "sell" | "both";
export type LiquidityGrade = "DEEP" | "ADEQUATE" | "THIN" | "ILLIQUID";

export interface KyberSwapRouteQuote {
  chain: EvmChainKey;
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  amountOutRaw: string;
  amountInUsd: number | null;
  amountOutUsd: number | null;
  gasUnits: number | null;
  gasUsd: number | null;
  dexesUsed: string[];
  routeHops: number;
  routerAddress: string | null;
}

export interface EvmQuoteTierResult {
  size_usd: number;
  executable: boolean;
  amount_in_raw: string | null;
  amount_out_raw: string | null;
  amount_in_usd: number | null;
  amount_out_usd: number | null;
  effective_price_usd: number | null;
  price_impact_bps: number | null;
  estimated_gas_usd: number | null;
  all_in_cost_bps: number | null;
  dexes_used: string[];
  route_hops: number;
  failure_reason: string | null;
}

export interface ExecutionQuoteCheckEvmResponse {
  mode: "evm";
  chain: EvmChainKey;
  chain_id: number;
  token_in: {
    address: string;
    symbol: string | null;
    decimals: number;
    price_usd: number;
  };
  token_out: {
    address: string;
    symbol: string | null;
    name: string | null;
    spot_price_usd: number | null;
    dex_liquidity_usd: number | null;
    dex_volume_24h_usd: number | null;
    primary_dex: string | null;
  };
  summary: {
    executable: boolean;
    liquidity_grade: LiquidityGrade;
    max_size_under_100bps_usd: number;
    max_size_is_extrapolated: boolean;
    worst_executable_impact_bps: number | null;
    flags: string[];
  };
  tiers: EvmQuoteTierResult[];
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

export interface PerpQuoteTierResult {
  size_usd: number;
  executable: boolean;
  fill_pct: number;
  effective_price: number | null;
  worst_fill_price: number | null;
  vwap_slippage_bps: number | null;
  price_impact_bps: number | null;
}

export interface PerpQuoteSideSummary {
  side: "buy" | "sell";
  executable_all_tiers: boolean;
  visible_depth_usd: number;
  max_size_under_100bps_usd: number;
  capped_by_visible_book: boolean;
  tiers: PerpQuoteTierResult[];
}

export interface ExecutionQuoteCheckPerpsResponse {
  mode: "perps";
  venue: "hyperliquid";
  coin: string;
  side: QuoteCheckPerpSide;
  market: {
    mid_price: number | null;
    mark_price: number | null;
    oracle_price: number | null;
    best_bid: number | null;
    best_ask: number | null;
    spread_bps: number | null;
    open_interest_usd: number | null;
    volume_24h_usd: number | null;
    levels_sampled: {
      bids: number;
      asks: number;
    };
  };
  summary: {
    executable: boolean;
    liquidity_grade: LiquidityGrade;
    max_size_under_100bps_usd: number;
    capped_by_visible_book: boolean;
    flags: string[];
  };
  buy: PerpQuoteSideSummary | null;
  sell: PerpQuoteSideSummary | null;
  metadata: {
    fetched_at: string;
    sources: string[];
    disclaimer: string;
  };
}

export type ExecutionQuoteCheckResponse =
  | ExecutionQuoteCheckEvmResponse
  | ExecutionQuoteCheckPerpsResponse;
