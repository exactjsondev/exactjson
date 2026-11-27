import { type BoundedTtlCache, TTL_MS, withTwoTierCache } from "../../../lib/cache";
import { fetchJsonWithTimeout, UpstreamError } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";
import type { DrugTrialInput, TrialPhaseScope } from "../validation";

const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";
const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";
const ACTIVE_STATUS_FILTER =
  "RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,NOT_YET_RECRUITING";
const CTGOV_FIELDS = [
  "NCTId",
  "BriefTitle",
  "OverallStatus",
  "Phase",
  "StartDateStruct",
  "PrimaryCompletionDateStruct",
  "LeadSponsorName",
  "LeadSponsorClass",
  "Condition",
  "InterventionName",
  "InterventionType",
  "PrimaryOutcomeMeasure",
  "PrimaryOutcomeTimeFrame",
  "EnrollmentCount",
  "HasResults",
  "LastUpdatePostDateStruct",
].join(",");

export interface SlimClinicalStudy {
  nctId: string;
  briefTitle: string;
  overallStatus: string;
  phases: string[];
  sponsorName: string | null;
  sponsorClass: string | null;
  enrollment: number | null;
  startDate: string | null;
  primaryCompletionDate: string | null;
  primaryCompletionType: string | null;
  conditions: string[];
  interventions: Array<{ name: string; type: string | null }>;
  primaryOutcome: string | null;
  hasResults: boolean;
  lastUpdatePosted: string | null;
}

export interface ClinicalTrialsResult {
  notFound: boolean;
  totalCount: number;
  studies: SlimClinicalStudy[];
}

export interface RxNormDrugSummary {
  normalized: boolean;
  rxcui: string | null;
  preferredName: string | null;
  tty: string | null;
  brandNames: string[];
  atcClasses: Array<{ code: string; name: string }>;
  pharmacologicClasses: string[];
  contraindications: string[];
}

export function parseClinicalStudy(raw: unknown): SlimClinicalStudy | null {
  const ps = (raw as { protocolSection?: Record<string, unknown> } | null)?.protocolSection;
  if (!ps || typeof ps !== "object") return null;

  const idMod = ps.identificationModule as Record<string, unknown> | undefined;
  const statusMod = ps.statusModule as Record<string, unknown> | undefined;
  const sponsorMod = ps.sponsorCollaboratorsModule as Record<string, unknown> | undefined;
  const condMod = ps.conditionsModule as Record<string, unknown> | undefined;
  const designMod = ps.designModule as Record<string, unknown> | undefined;
  const armsMod = ps.armsInterventionsModule as Record<string, unknown> | undefined;
  const outcomesMod = ps.outcomesModule as Record<string, unknown> | undefined;

  const nctId = typeof idMod?.nctId === "string" ? idMod.nctId.trim().toUpperCase() : "";
  const briefTitle = typeof idMod?.briefTitle === "string" ? idMod.briefTitle.trim() : "";
  if (!nctId || !briefTitle) return null;

  const overallStatus =
    typeof statusMod?.overallStatus === "string" ? statusMod.overallStatus.trim() : "UNKNOWN";

  const startStruct = statusMod?.startDateStruct as Record<string, unknown> | undefined;
  const primStruct = statusMod?.primaryCompletionDateStruct as Record<string, unknown> | undefined;
  const updateStruct = statusMod?.lastUpdatePostDateStruct as Record<string, unknown> | undefined;

  const leadSponsor = sponsorMod?.leadSponsor as Record<string, unknown> | undefined;
  const sponsorName =
    typeof leadSponsor?.name === "string" && leadSponsor.name.trim()
      ? leadSponsor.name.trim()
      : null;
  const sponsorClass =
    typeof leadSponsor?.class === "string" && leadSponsor.class.trim()
      ? leadSponsor.class.trim()
      : null;

  const rawPhases = Array.isArray(designMod?.phases) ? designMod.phases : [];
  const phases = rawPhases
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());

  const enrollInfo = designMod?.enrollmentInfo as Record<string, unknown> | undefined;
  const enrollmentNum = toFiniteNumber(enrollInfo?.count);
  const enrollment =
    enrollmentNum !== null && enrollmentNum >= 0 ? Math.round(enrollmentNum) : null;

  const rawConds = Array.isArray(condMod?.conditions) ? condMod.conditions : [];
  const conditions = rawConds
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim())
    .slice(0, 6);

  const rawInterventions = Array.isArray(armsMod?.interventions) ? armsMod.interventions : [];
  const interventions: Array<{ name: string; type: string | null }> = [];
  for (const intr of rawInterventions) {
    if (!intr || typeof intr !== "object") continue;
    const io = intr as Record<string, unknown>;
    const iName = typeof io.name === "string" ? io.name.trim() : "";
    const iType = typeof io.type === "string" && io.type.trim() ? io.type.trim() : null;
    if (iName && interventions.length < 6) {
      interventions.push({ name: iName, type: iType });
    }
  }

  const rawPrimaryOutcomes = Array.isArray(outcomesMod?.primaryOutcomes)
    ? outcomesMod.primaryOutcomes
    : [];
  const firstOutcome = rawPrimaryOutcomes[0] as Record<string, unknown> | undefined;
  const measure = typeof firstOutcome?.measure === "string" ? firstOutcome.measure.trim() : "";
  const timeFrame =
    typeof firstOutcome?.timeFrame === "string" ? firstOutcome.timeFrame.trim() : "";
  const primaryOutcome = measure
    ? timeFrame
      ? `${measure} (${timeFrame})`.slice(0, 220)
      : measure.slice(0, 220)
    : null;

  const hasResults = Boolean((raw as { hasResults?: unknown } | null)?.hasResults);

  return {
    nctId,
    briefTitle,
    overallStatus,
    phases,
    sponsorName,
    sponsorClass,
    enrollment,
    startDate: typeof startStruct?.date === "string" ? startStruct.date.trim() : null,
    primaryCompletionDate: typeof primStruct?.date === "string" ? primStruct.date.trim() : null,
    primaryCompletionType: typeof primStruct?.type === "string" ? primStruct.type.trim() : null,
    conditions,
    interventions,
    primaryOutcome,
    hasResults,
    lastUpdatePosted: typeof updateStruct?.date === "string" ? updateStruct.date.trim() : null,
  };
}

function phaseAggFilter(scope: TrialPhaseScope): string | null {
  switch (scope) {
    case "PHASE2_3":
      return "phase:2 3";
    case "PHASE3":
      return "phase:3";
    case "PHASE2":
      return "phase:2";
    case "PHASE1":
      return "phase:1";
    case "PHASE4":
      return "phase:4";
    case "ALL":
      return null;
  }
}

export async function fetchClinicalTrials(
  input: DrugTrialInput,
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
  nowMs: number = Date.now(),
): Promise<{ data: ClinicalTrialsResult; cacheHit: boolean }> {
  const cutoffIso = new Date(nowMs - 90 * 86_400_000).toISOString().slice(0, 10);
  const key = input.nct
    ? `bio:ctgov:nct:${input.nct}`
    : `bio:ctgov:search:${JSON.stringify([
        (input.drug ?? "").replace(/\s+/g, " ").toLowerCase(),
        (input.condition ?? "").replace(/\s+/g, " ").toLowerCase(),
        input.phaseScope,
        cutoffIso,
      ])}`;

  const { value, cacheHit } = await withTwoTierCache<ClinicalTrialsResult>({
    key,
    ttlMs: TTL_MS.BIO_CLINICAL_TRIALS,
    cache,
    waitUntil,
    fetcher: async () => {
      if (input.nct) {
        const res = await fetchJsonWithTimeout<unknown>(
          `${CTGOV_BASE}/${encodeURIComponent(input.nct)}`,
          {
            provider: "CLINICALTRIALS",
            allow404: true,
            timeoutMs: 5500,
            fetchImpl,
          },
        );
        if (res.status === "not_found") {
          return { notFound: true, totalCount: 0, studies: [] };
        }
        const parsed = parseClinicalStudy(res.data);
        if (!parsed) {
          throw new UpstreamError(
            "CLINICALTRIALS",
            "CLINICALTRIALS_BAD_SCHEMA",
            "Invalid ClinicalTrials.gov single-study payload",
          );
        }
        return { notFound: false, totalCount: 1, studies: [parsed] };
      }

      const buildSearchUrl = (withDateFloor: boolean) => {
        const url = new URL(CTGOV_BASE);
        url.searchParams.set("filter.overallStatus", ACTIVE_STATUS_FILTER);
        if (input.drug) url.searchParams.set("query.intr", input.drug);
        if (input.condition) url.searchParams.set("query.cond", input.condition);
        if (withDateFloor) {
          url.searchParams.set(
            "filter.advanced",
            `AREA[PrimaryCompletionDate]RANGE[${cutoffIso},MAX]`,
          );
        }
        const agg = phaseAggFilter(input.phaseScope);
        if (agg) url.searchParams.set("aggFilters", agg);
        url.searchParams.set("countTotal", "true");
        url.searchParams.set("sort", "PrimaryCompletionDate:asc");
        url.searchParams.set("pageSize", "50");
        url.searchParams.set("fields", CTGOV_FIELDS);
        return url.toString();
      };

      let res = await fetchJsonWithTimeout<{
        totalCount?: unknown;
        studies?: unknown[];
      }>(buildSearchUrl(true), {
        provider: "CLINICALTRIALS",
        timeoutMs: 6000,
        fetchImpl,
      });

      if (res.status !== "ok" || !Array.isArray(res.data?.studies)) {
        throw new UpstreamError(
          "CLINICALTRIALS",
          "CLINICALTRIALS_BAD_SCHEMA",
          "Invalid ClinicalTrials.gov search payload",
        );
      }

      // Fallback without date-range filter only when 0 upcoming studies exist (surfaces active studies lacking structured dates)
      if (res.data.studies.length === 0) {
        res = await fetchJsonWithTimeout<{
          totalCount?: unknown;
          studies?: unknown[];
        }>(buildSearchUrl(false), {
          provider: "CLINICALTRIALS",
          timeoutMs: 6000,
          fetchImpl,
        });
        if (res.status !== "ok" || !Array.isArray(res.data?.studies)) {
          throw new UpstreamError(
            "CLINICALTRIALS",
            "CLINICALTRIALS_BAD_SCHEMA",
            "Invalid ClinicalTrials.gov fallback search payload",
          );
        }
      }

      const studies: SlimClinicalStudy[] = [];
      for (const item of res.data.studies) {
        const parsed = parseClinicalStudy(item);
        if (parsed) studies.push(parsed);
      }
      if (res.data.studies.length > 0 && studies.length === 0) {
        throw new UpstreamError(
          "CLINICALTRIALS",
          "CLINICALTRIALS_BAD_SCHEMA",
          "ClinicalTrials.gov returned non-empty studies list with zero parseable studies",
        );
      }

      const totalCountNum = toFiniteNumber(res.data.totalCount);
      const totalCount =
        totalCountNum !== null && totalCountNum >= studies.length
          ? Math.round(totalCountNum)
          : studies.length;

      return { notFound: false, totalCount, studies };
    },
  });

  return { data: value, cacheHit };
}

export async function fetchRxNormDrugSummary(
  drugName: string,
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<{ data: RxNormDrugSummary; cacheHit: boolean }> {
  const normalizedName = drugName.trim().toLowerCase();
  const key = `bio:rxnav:${normalizedName}`;

  const { value, cacheHit } = await withTwoTierCache<RxNormDrugSummary>({
    key,
    ttlMs: TTL_MS.BIO_RXNAV,
    cache,
    waitUntil,
    fetcher: async () => {
      const idRes = await fetchJsonWithTimeout<{ idGroup?: { rxnormId?: string[] } }>(
        `${RXNAV_BASE}/rxcui.json?name=${encodeURIComponent(drugName)}&search=2`,
        {
          provider: "RXNAV",
          timeoutMs: 5000,
          fetchImpl,
        },
      );

      if (idRes.status !== "ok") {
        throw new UpstreamError("RXNAV", "RXNAV_UNAVAILABLE", "RxNav lookup unavailable");
      }

      const rawRxIds = idRes.data?.idGroup?.rxnormId;
      const firstRxId = Array.isArray(rawRxIds) ? rawRxIds[0] : undefined;
      const rxcui = typeof firstRxId === "string" && firstRxId.trim() ? firstRxId.trim() : null;
      if (!rxcui) {
        return {
          normalized: false,
          rxcui: null,
          preferredName: null,
          tty: null,
          brandNames: [],
          atcClasses: [],
          pharmacologicClasses: [],
          contraindications: [],
        };
      }

      // Fail closed on HTTP 429/5xx/timeouts while tolerating genuine 404 unindexed RxClass records
      const [relatedRes, rxClassRes] = await Promise.all([
        fetchJsonWithTimeout<{
          relatedGroup?: {
            conceptGroup?: Array<{
              tty?: string;
              conceptProperties?: Array<{ rxcui?: string; name?: string; tty?: string }>;
            }>;
          };
        }>(`${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN+PIN+BN`, {
          provider: "RXNAV",
          allow404: true,
          timeoutMs: 4500,
          fetchImpl,
        }),
        fetchJsonWithTimeout<{
          rxclassDrugInfoList?: {
            rxclassDrugInfo?: Array<{
              minConcept?: { rxcui?: string; name?: string; tty?: string };
              rxclassMinConceptItem?: {
                classId?: string;
                className?: string;
                classType?: string;
              };
              rela?: string;
              relaSource?: string;
            }>;
          };
        }>(`${RXNAV_BASE}/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(rxcui)}`, {
          provider: "RXNAV",
          allow404: true,
          timeoutMs: 4500,
          fetchImpl,
        }),
      ]);

      let preferredName: string | null = null;
      let tty: string | null = null;
      let ingredientRxcui = rxcui;
      const brandNames: string[] = [];

      if (relatedRes.status === "ok") {
        const rawGroups = relatedRes.data?.relatedGroup?.conceptGroup;
        const groups = Array.isArray(rawGroups) ? rawGroups : [];
        for (const g of groups) {
          if (!g || typeof g !== "object") continue;
          const props = Array.isArray(g.conceptProperties) ? g.conceptProperties : [];
          const p0 = props[0];
          const p0Name = typeof p0?.name === "string" ? p0.name.trim() : "";
          const p0Rxcui = typeof p0?.rxcui === "string" ? p0.rxcui.trim() : "";
          if (g.tty === "IN" && p0Name) {
            preferredName = p0Name;
            tty = "IN";
            if (p0Rxcui) ingredientRxcui = p0Rxcui;
          } else if (g.tty === "PIN" && !preferredName && p0Name) {
            preferredName = p0Name;
            tty = "PIN";
          } else if (g.tty === "BN") {
            for (const p of props) {
              const bName = typeof p?.name === "string" ? p.name.trim() : "";
              if (bName && brandNames.length < 6) {
                brandNames.push(bName);
              }
            }
          }
        }
      }

      // If input was a brand name (e.g., Ozempic) whose direct rxcui had no rxclass entries, query ingredient rxcui
      const rawInitialClassInfos =
        rxClassRes.status === "ok"
          ? rxClassRes.data?.rxclassDrugInfoList?.rxclassDrugInfo
          : undefined;
      let classInfos = Array.isArray(rawInitialClassInfos) ? rawInitialClassInfos : [];

      if (classInfos.length === 0 && ingredientRxcui !== rxcui) {
        const ingClassRes = await fetchJsonWithTimeout<{
          rxclassDrugInfoList?: {
            rxclassDrugInfo?: typeof classInfos;
          };
        }>(
          `${RXNAV_BASE}/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(ingredientRxcui)}`,
          {
            provider: "RXNAV",
            allow404: true,
            timeoutMs: 4500,
            fetchImpl,
          },
        );
        if (ingClassRes.status === "ok") {
          const rawIngClassInfos = ingClassRes.data?.rxclassDrugInfoList?.rxclassDrugInfo;
          classInfos = Array.isArray(rawIngClassInfos) ? rawIngClassInfos : [];
        }
      }

      const atcMap = new Map<string, string>();
      const pharmSet = new Set<string>();
      const contraSet = new Set<string>();

      for (const item of classInfos) {
        if (!item || typeof item !== "object") continue;
        const mcName = typeof item.minConcept?.name === "string" ? item.minConcept.name.trim() : "";
        const mcTty = typeof item.minConcept?.tty === "string" ? item.minConcept.tty.trim() : "";
        if (!preferredName && mcName) {
          preferredName = mcName;
          if (mcTty) tty = mcTty;
        }
        const cls = item.rxclassMinConceptItem;
        const cId = typeof cls?.classId === "string" ? cls.classId.trim() : "";
        const cName = typeof cls?.className === "string" ? cls.className.trim() : "";
        const cType = typeof cls?.classType === "string" ? cls.classType.trim() : "";
        if (!cName) continue;

        if (cType === "ATC1-4" && cId && atcMap.size < 4 && !atcMap.has(cId)) {
          atcMap.set(cId, cName);
        } else if (
          (cType === "EPC" || cType === "MOA" || cType === "PE" || cType === "DISPOS") &&
          pharmSet.size < 5
        ) {
          pharmSet.add(cName);
        } else if (cType === "DISEASE" && item.rela === "ci_with" && contraSet.size < 6) {
          contraSet.add(cName);
        }
      }

      return {
        normalized: true,
        rxcui: ingredientRxcui || rxcui,
        preferredName: preferredName ?? drugName.trim(),
        tty: tty ?? "RXNORM",
        brandNames: [...new Set(brandNames)].sort(),
        atcClasses: [...atcMap.entries()].map(([code, name]) => ({ code, name })),
        pharmacologicClasses: [...pharmSet],
        contraindications: [...contraSet],
      };
    },
  });

  return { data: value, cacheHit };
}
