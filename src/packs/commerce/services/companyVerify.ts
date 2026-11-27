import { COMMERCE_DISCLAIMER } from "../../../config/catalog/commerce";
import type {
  SlimSecEdgarProfile,
  UsaSpendingBrief,
  WikidataCorporateMeta,
} from "../providers/companyFeeds";
import type { SlimGleifEntity } from "../providers/viesAndGleif";

const US_STATE_CODES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "VI", "WA",
  "WV", "WI", "WY",
]);

export interface ComputeCompanyVerifyInput {
  gleifEntity: SlimGleifEntity | null;
  directParent: SlimGleifEntity | null;
  ultimateParent: SlimGleifEntity | null;
  wikidataMeta: WikidataCorporateMeta | null;
  secProfile: SlimSecEdgarProfile | null;
  usaSpending: UsaSpendingBrief;
  usaSpendingSucceeded: boolean;
  partialEnrichment: boolean;
  nowMs: number;
}

function summarizeParent(parent: SlimGleifEntity | null, selfLei: string | null) {
  if (!parent || (selfLei && parent.lei === selfLei)) return null;
  return {
    lei: parent.lei,
    legal_name: parent.legalName,
    entity_status: parent.entityStatus,
    country: parent.country,
    jurisdiction: parent.jurisdiction,
  };
}

export function computeCompanyVerify(input: ComputeCompanyVerifyInput) {
  const {
    gleifEntity,
    directParent,
    ultimateParent,
    wikidataMeta,
    secProfile,
    usaSpending,
    usaSpendingSucceeded,
    partialEnrichment,
    nowMs,
  } = input;

  const legalName =
    gleifEntity?.legalName ?? secProfile?.name ?? wikidataMeta?.label ?? "Unknown Entity";
  const lei = gleifEntity?.lei ?? wikidataMeta?.lei ?? null;
  const entityStatus = gleifEntity?.entityStatus ?? (secProfile ? "SEC_REGISTERED" : "UNVERIFIED_REGISTRY");
  const leiRegStatus = gleifEntity?.registrationStatus ?? null;

  const tickersSet = new Set<string>([
    ...(secProfile?.tickers ?? []),
    ...(wikidataMeta?.tickers ?? []),
  ]);

  const riskFlags: string[] = [];
  if (gleifEntity) {
    if (gleifEntity.entityStatus !== "ACTIVE") {
      riskFlags.push(`ENTITY_STATUS_${gleifEntity.entityStatus}`);
    }
    if (
      gleifEntity.registrationStatus === "LAPSED" ||
      gleifEntity.registrationStatus === "RETIRED" ||
      gleifEntity.registrationStatus === "ANNULLED"
    ) {
      riskFlags.push(`LEI_REGISTRATION_${gleifEntity.registrationStatus}`);
    }
  } else {
    riskFlags.push("NO_GLEIF_LEI_RECORD");
  }

  if (partialEnrichment) {
    riskFlags.push("PARTIAL_ENRICHMENT_UNAVAILABLE");
  }

  let kybStatus: "VERIFIED_ACTIVE" | "ATTENTION_REQUIRED" | "INACTIVE_OR_LAPSED" =
    "VERIFIED_ACTIVE";
  if (
    gleifEntity &&
    (gleifEntity.entityStatus === "INACTIVE" ||
      gleifEntity.registrationStatus === "RETIRED" ||
      gleifEntity.registrationStatus === "ANNULLED")
  ) {
    kybStatus = "INACTIVE_OR_LAPSED";
  } else if (
    !gleifEntity ||
    gleifEntity.registrationStatus === "LAPSED" ||
    gleifEntity.entityStatus !== "ACTIVE"
  ) {
    kybStatus = secProfile ? "VERIFIED_ACTIVE" : "ATTENTION_REQUIRED";
  }

  const directSummary = summarizeParent(directParent, lei);
  const ultimateSummary = summarizeParent(ultimateParent, lei);
  const isUltimateParent = Boolean(
    gleifEntity && !directSummary && !ultimateSummary && !gleifEntity.hasParentException
  );

  const secIncorp = secProfile?.state_of_incorporation?.toUpperCase() ?? null;
  const inferredSecCountry = secIncorp && US_STATE_CODES.has(secIncorp) ? "US" : null;

  const sources: string[] = [];
  if (gleifEntity) sources.push("gleif_lei");
  if (wikidataMeta) sources.push("wikidata");
  if (secProfile) sources.push("sec_edgar");
  if (usaSpendingSucceeded) sources.push("usaspending");

  return {
    kyb_status: kybStatus,
    risk_flags: riskFlags,
    entity: {
      legal_name: legalName,
      lei,
      entity_status: entityStatus,
      lei_registration_status: leiRegStatus,
      jurisdiction: gleifEntity?.jurisdiction ?? secProfile?.state_of_incorporation ?? null,
      country: gleifEntity?.country ?? inferredSecCountry,
      registered_as: gleifEntity?.registeredAs ?? null,
      legal_address: gleifEntity?.legalAddress ?? null,
      headquarters_address: gleifEntity?.headquartersAddress ?? null,
      bics: gleifEntity?.bics ?? [],
      official_website: wikidataMeta?.officialWebsite ?? null,
      official_domain: wikidataMeta?.officialDomain ?? null,
      tickers: [...tickersSet],
      wikidata_id: wikidataMeta?.wikidataId ?? null,
    },
    ownership: {
      is_ultimate_parent: isUltimateParent,
      direct_parent: directSummary,
      ultimate_parent: ultimateSummary,
    },
    sec_edgar: secProfile
      ? {
          cik: secProfile.cik,
          sic: secProfile.sic,
          sic_description: secProfile.sic_description,
          state_of_incorporation: secProfile.state_of_incorporation,
          ein: secProfile.ein,
          exchanges: secProfile.exchanges,
          recent_filings: secProfile.recent_filings,
        }
      : null,
    us_federal_contracts: usaSpending,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: COMMERCE_DISCLAIMER,
    },
  };
}
