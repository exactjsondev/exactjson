import type { EndpointCatalogEntry, PackDefinition } from "./types";

export const RESEARCH_DISCLAIMER =
  "Informational scientific/clinical metadata only; not medical or safety advice." as const;

export const RESEARCH_PACK: PackDefinition = {
  id: "research",
  title: "Scientific Citations, Chemical GHS Hazards & Clinical Trials",
  subtitle:
    "Crossref + DataCite + Retraction Watch citation verification, NIH PubChem GHS toxicity profiles, and ClinicalTrials.gov + RxNorm catalyst briefs.",
  shortDescription:
    "DOI/citation hallucination & retraction checks, PubChem GHS chemical safety, and clinical trial briefs.",
  mcpPath: "/mcp/research",
  disclaimer: RESEARCH_DISCLAIMER,
  workflows: [
    "Before citing academic literature or evaluating clinical/chemical claims, verify DOIs via science/citation-verify and cross-check trials or GHS hazards.",
  ],
};

export const RESEARCH_CATALOG: readonly EndpointCatalogEntry[] = [];
