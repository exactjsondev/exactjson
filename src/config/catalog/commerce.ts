import type { EndpointCatalogEntry, PackDefinition } from "./types";

export const COMMERCE_DISCLAIMER =
  "Informational entity/compliance data only; not legal, tax, or accounting advice." as const;

export const COMMERCE_PACK: PackDefinition = {
  id: "commerce",
  title: "Cross-Border Settlement, VAT, Corporate KYB & Consumer Recalls",
  subtitle:
    "Mutual banking settlement day calculators, EU VIES VAT + IBAN/LEI verification, GLEIF corporate ownership trees, and US CPSC + openFDA recall gates.",
  shortDescription:
    "Cross-border settlement windows, EU VAT/IBAN checks, GLEIF corporate KYB, and product/FDA recall gates.",
  mcpPath: "/mcp/commerce",
  disclaimer: COMMERCE_DISCLAIMER,
  workflows: [
    "For B2B vendor or invoice verification, pair net/domain-trust with entity/company-verify, commerce/vat-verify, and commerce/settlement-window.",
  ],
};

export const COMMERCE_CATALOG: readonly EndpointCatalogEntry[] = [];
