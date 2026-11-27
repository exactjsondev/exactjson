import { RESEARCH_DISCLAIMER } from "../../../config/catalog/research";
import type {
  ClinicalTrialsResult,
  RxNormDrugSummary,
  SlimClinicalStudy,
} from "../providers/trialFeeds";
import type { DrugTrialInput } from "../validation";

const MS_PER_DAY = 86_400_000;
const ACTIVE_STATUS_SET: ReadonlySet<string> = new Set([
  "RECRUITING",
  "ACTIVE_NOT_RECRUITING",
  "ENROLLING_BY_INVITATION",
  "NOT_YET_RECRUITING",
]);

export function parseStudyDateUtcMs(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const fullMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (fullMatch) {
    const ms = Date.UTC(Number(fullMatch[1]), Number(fullMatch[2]) - 1, Number(fullMatch[3]));
    return Number.isFinite(ms) ? ms : null;
  }
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(dateStr);
  if (ymMatch) {
    // Use last day of the month so YYYY-MM completion dates stay upcoming throughout that month
    const ms = Date.UTC(Number(ymMatch[1]), Number(ymMatch[2]), 0);
    return Number.isFinite(ms) ? ms : null;
  }
  const yMatch = /^(\d{4})$/.exec(dateStr);
  if (yMatch) {
    const ms = Date.UTC(Number(yMatch[1]), 11, 31);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function highestPhaseRank(phases: readonly string[]): number {
  if (phases.includes("PHASE3")) return 3;
  if (phases.includes("PHASE2")) return 2;
  if (phases.includes("PHASE4")) return 1;
  return 0;
}

export function computeDrugTrialBrief(params: {
  input: DrugTrialInput;
  trials: ClinicalTrialsResult;
  rxnorm: RxNormDrugSummary | null;
  sources: string[];
  nowMs?: number;
}) {
  const { input, trials, rxnorm, sources, nowMs = Date.now() } = params;
  const todayUtcMs = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate()
  );

  interface EnrichedStudy {
    study: SlimClinicalStudy;
    isActive: boolean;
    daysToPrimaryCompletion: number | null;
    isOverdueStale: boolean;
    rankBucket: 0 | 1 | 2 | 3;
  }

  const enriched: EnrichedStudy[] = trials.studies.map((study) => {
    const isActive = ACTIVE_STATUS_SET.has(study.overallStatus);
    const compMs = parseStudyDateUtcMs(study.primaryCompletionDate);
    const days = compMs !== null ? Math.round((compMs - todayUtcMs) / MS_PER_DAY) : null;
    const isOverdueStale = isActive && days !== null && days < -90;
    const rankBucket: 0 | 1 | 2 | 3 =
      !isActive || isOverdueStale
        ? 3
        : days !== null && days >= 0
          ? 0
          : days !== null
            ? 1
            : 2;
    return { study, isActive, daysToPrimaryCompletion: days, isOverdueStale, rankBucket };
  });

  const activeSampledCount = enriched.filter((e) => e.isActive).length;
  const effectiveTotalActive = input.nct ? activeSampledCount : trials.totalCount;
  const phase3Count = enriched.filter((e) => e.isActive && e.study.phases.includes("PHASE3")).length;
  const phase2Count = enriched.filter(
    (e) =>
      e.isActive &&
      e.study.phases.includes("PHASE2") &&
      !e.study.phases.includes("PHASE3")
  ).length;
  const industryCount = enriched.filter(
    (e) => e.isActive && e.study.sponsorClass === "INDUSTRY"
  ).length;
  const overdueCount = enriched.filter((e) => e.isOverdueStale).length;
  const upcoming12mCount = enriched.filter(
    (e) =>
      e.isActive &&
      e.daysToPrimaryCompletion !== null &&
      e.daysToPrimaryCompletion >= 0 &&
      e.daysToPrimaryCompletion <= 365
  ).length;

  // Bucket 0: future upcoming (days >= 0, earliest first) -> Bucket 1: recently passed readout (-90..-1, most recent first) -> Bucket 2: active undated -> Bucket 3: overdue/inactive
  const ranked = [...enriched].sort((a, b) => {
    if (a.rankBucket !== b.rankBucket) {
      return a.rankBucket - b.rankBucket;
    }
    if (a.daysToPrimaryCompletion !== null && b.daysToPrimaryCompletion !== null) {
      if (a.daysToPrimaryCompletion !== b.daysToPrimaryCompletion) {
        return a.rankBucket === 1
          ? b.daysToPrimaryCompletion - a.daysToPrimaryCompletion
          : a.daysToPrimaryCompletion - b.daysToPrimaryCompletion;
      }
    }
    const phaseDiff = highestPhaseRank(b.study.phases) - highestPhaseRank(a.study.phases);
    if (phaseDiff !== 0) return phaseDiff;
    const aInd = a.study.sponsorClass === "INDUSTRY" ? 1 : 0;
    const bInd = b.study.sponsorClass === "INDUSTRY" ? 1 : 0;
    return bInd - aInd;
  });

  const nearestUpcoming = ranked.find((e) => e.rankBucket === 0 && e.study.primaryCompletionDate);
  const selectedCatalysts = ranked.slice(0, input.limit).map(({ study, daysToPrimaryCompletion }) => ({
    nct_id: study.nctId,
    brief_title: study.briefTitle,
    overall_status: study.overallStatus,
    phases: study.phases,
    sponsor_name: study.sponsorName,
    sponsor_class: study.sponsorClass,
    enrollment: study.enrollment,
    start_date: study.startDate,
    primary_completion_date: study.primaryCompletionDate,
    primary_completion_type: study.primaryCompletionType,
    days_to_primary_completion: daysToPrimaryCompletion,
    conditions: study.conditions,
    interventions: study.interventions.map((i) => i.name),
    primary_outcome: study.primaryOutcome,
    has_results: study.hasResults,
    last_update_posted: study.lastUpdatePosted,
    url: `https://clinicaltrials.gov/study/${study.nctId}`,
  }));

  const flags: string[] = [];
  if (
    enriched.some(
      (e) =>
        e.rankBucket === 0 &&
        e.daysToPrimaryCompletion !== null &&
        e.daysToPrimaryCompletion <= 90
    )
  ) {
    flags.push("IMMINENT_PRIMARY_COMPLETION_90D");
  }
  if (phase3Count > 0) {
    flags.push("ACTIVE_PHASE3_PROGRAM");
  }
  if (rxnorm && !rxnorm.normalized) {
    flags.push("UNMAPPED_RXNORM_INVESTIGATIONAL");
  }
  if (overdueCount > 0) {
    flags.push("OVERDUE_REGISTRY_ENTRIES_FILTERED");
  }
  if (effectiveTotalActive === 0) {
    flags.push("ZERO_ACTIVE_MATCHING_TRIALS");
  }

  return {
    query: {
      drug: input.drug,
      nct: input.nct,
      condition: input.condition,
      phase_scope: input.phaseScope,
      limit: input.limit,
    },
    drug_normalization: rxnorm
      ? {
          normalized: rxnorm.normalized,
          rxcui: rxnorm.rxcui,
          preferred_name: rxnorm.preferredName,
          tty: rxnorm.tty,
          brand_names: rxnorm.brandNames,
          atc_classes: rxnorm.atcClasses,
          mechanism_or_pharmacologic_classes: rxnorm.pharmacologicClasses,
          contraindications: rxnorm.contraindications,
        }
      : null,
    pipeline_summary: {
      total_matching_active_trials: effectiveTotalActive,
      sampled_trials: trials.studies.length,
      phase3_count: phase3Count,
      phase2_count: phase2Count,
      industry_sponsored_count: industryCount,
      upcoming_catalysts_12m_count: upcoming12mCount,
      overdue_unupdated_count: overdueCount,
      nearest_primary_completion_date: nearestUpcoming?.study.primaryCompletionDate ?? null,
    },
    upcoming_catalysts: selectedCatalysts,
    flags,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: RESEARCH_DISCLAIMER,
    },
  };
}
