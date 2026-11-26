import type { Hono } from "hono";
import type { AppBindings } from "../../types";
import { censorshipCheckHandler } from "./routes/censorshipCheck";
import { cloudStatusHandler } from "./routes/cloudStatus";
import { cveTriageHandler } from "./routes/cveTriage";
import { domainTrustHandler } from "./routes/domainTrust";
import { modelAuditHandler } from "./routes/modelAudit";
import { packageAuditHandler } from "./routes/packageAudit";
import { runtimeEolHandler } from "./routes/runtimeEol";

export function registerSecurityPackRoutes(app: Hono<AppBindings>): void {
  app.get("/v1/oss/package-audit", packageAuditHandler);
  app.get("/v1/net/domain-trust", domainTrustHandler);
  app.get("/v1/sec/cve-triage", cveTriageHandler);
  app.get("/v1/ops/cloud-status", cloudStatusHandler);
  app.get("/v1/oss/runtime-eol", runtimeEolHandler);
  app.get("/v1/ai/model-audit", modelAuditHandler);
  app.get("/v1/net/censorship-check", censorshipCheckHandler);
}
