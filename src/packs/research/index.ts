import type { Hono } from "hono";
import type { AppBindings } from "../../types";
import { chemHazardProfileHandler } from "./routes/chemHazardProfile";
import { citationVerifyHandler } from "./routes/citationVerify";
import { drugTrialBriefHandler } from "./routes/drugTrialBrief";

export function registerResearchPackRoutes(app: Hono<AppBindings>): void {
  app.get("/v1/science/citation-verify", citationVerifyHandler);
  app.get("/v1/chem/hazard-profile", chemHazardProfileHandler);
  app.get("/v1/bio/drug-trial-brief", drugTrialBriefHandler);
}
