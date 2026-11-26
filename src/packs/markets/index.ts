import type { Hono } from "hono";
import type { AppBindings } from "../../types";
import { evmSafetyHandler } from "./routes/evmSafety";
import { executionQuoteCheckHandler } from "./routes/executionQuoteCheck";
import { fundingArbHandler } from "./routes/fundingArb";
import { macroLiquidityHandler } from "./routes/macroLiquidity";
import { optionsSurfaceHandler } from "./routes/optionsSurface";
import { perpsScreenerHandler } from "./routes/perpsScreener";
import { perpsSnapshotHandler } from "./routes/perpsSnapshot";
import { predictionsArbHandler } from "./routes/predictionsArb";
import { predictionsScannerHandler } from "./routes/predictionsScanner";
import { solanaSafetyHandler } from "./routes/solanaSafety";
import { solanaTrendingHandler } from "./routes/solanaTrending";

export function registerMarketsPackRoutes(app: Hono<AppBindings>): void {
  app.get("/v1/solana/safety", solanaSafetyHandler);
  app.get("/v1/solana/trending", solanaTrendingHandler);
  app.get("/v1/perps/snapshot", perpsSnapshotHandler);
  app.get("/v1/perps/screener", perpsScreenerHandler);
  app.get("/v1/perps/funding-arb", fundingArbHandler);
  app.get("/v1/predictions/scanner", predictionsScannerHandler);
  app.get("/v1/options/surface", optionsSurfaceHandler);
  app.get("/v1/macro/liquidity", macroLiquidityHandler);
  app.get("/v1/evm/safety", evmSafetyHandler);
  app.get("/v1/predictions/arb", predictionsArbHandler);
  app.get("/v1/execution/quote-check", executionQuoteCheckHandler);
}
