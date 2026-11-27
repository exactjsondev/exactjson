import type { Hono } from "hono";
import type { AppBindings } from "../../types";
import { companyVerifyHandler } from "./routes/companyVerify";
import { safetyRecallHandler } from "./routes/safetyRecall";
import { settlementWindowHandler } from "./routes/settlementWindow";
import { vatVerifyHandler } from "./routes/vatVerify";

export function registerCommercePackRoutes(app: Hono<AppBindings>): void {
  app.get("/v1/commerce/settlement-window", settlementWindowHandler);
  app.get("/v1/commerce/vat-verify", vatVerifyHandler);
  app.get("/v1/entity/company-verify", companyVerifyHandler);
  app.get("/v1/consumer/safety-recall", safetyRecallHandler);
}
