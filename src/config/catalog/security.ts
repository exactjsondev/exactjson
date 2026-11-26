import type { EndpointCatalogEntry, PackDefinition } from "./types";

export const SECURITY_DISCLAIMER =
  "Informational security/ops telemetry only; not a substitute for full code review or legal audit." as const;

export const SECURITY_PACK: PackDefinition = {
  id: "security",
  title: "Supply-Chain, Domain, CVE, Cloud & MLOps Security",
  subtitle:
    "Pre-install package audits, domain DNSSEC/DMARC/RDAP trust, active KEV+EPSS CVE triage, cloud outage gates, runtime EOL checks, model license/safetensors audits, and OONI censorship checks.",
  shortDescription:
    "OSS package audits, domain trust, CVE triage, cloud status, runtime EOL, AI model audits, and censorship checks.",
  mcpPath: "/mcp/security",
  disclaimer: SECURITY_DISCLAIMER,
  workflows: [
    "Before installing unfamiliar packages or deploying dependencies, chain package-audit, runtime-eol, cve-triage, and cloud-status.",
  ],
};

export const SECURITY_CATALOG: readonly EndpointCatalogEntry[] = [];
