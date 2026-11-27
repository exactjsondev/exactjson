import { COMMERCE_DISCLAIMER } from "../../../config/catalog/commerce";
import type { NormalizedRecallItem, RecallSeverity } from "../providers/recallFeeds";
import type { ParsedSafetyRecallInput } from "../validation";

const SEVERITY_RANK: Readonly<Record<RecallSeverity, number>> = {
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL_CLASS_I: 4,
};

export interface ComputeSafetyRecallInput {
  query: ParsedSafetyRecallInput;
  cpscItems: NormalizedRecallItem[];
  fdaFoodItems: NormalizedRecallItem[];
  fdaDrugItems: NormalizedRecallItem[];
  fdaDeviceItems: NormalizedRecallItem[];
  sources: string[];
  nowMs: number;
}

export function computeSafetyRecall(input: ComputeSafetyRecallInput) {
  const {
    query,
    cpscItems,
    fdaFoodItems,
    fdaDrugItems,
    fdaDeviceItems,
    sources,
    nowMs,
  } = input;

  const allItems = [
    ...cpscItems,
    ...fdaFoodItems,
    ...fdaDrugItems,
    ...fdaDeviceItems,
  ];

  const queryTokens = query.query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  const cutoff12mDate = new Date(nowMs - 365 * 86_400_000).toISOString().slice(0, 10);
  const cutoff36mDate = new Date(nowMs - 3 * 365 * 86_400_000).toISOString().slice(0, 10);

  const scored = allItems.map((item) => {
    const text = `${item.title} ${item.firm ?? ""} ${item.hazard_or_reason ?? ""}`.toLowerCase();
    let tokenHits = 0;
    for (const tok of queryTokens) {
      if (text.includes(tok)) tokenHits += 1;
    }
    const isRecent12m = Boolean(item.recall_date && item.recall_date >= cutoff12mDate);
    const isRecent36m = Boolean(item.recall_date && item.recall_date >= cutoff36mDate);
    const isOngoingOrRecent =
      (item.agency === "US_FDA" && item.status === "ACTIVE") ||
      (item.agency === "US_CPSC" && (isRecent36m || item.recall_date === null));

    const score =
      SEVERITY_RANK[item.severity] * 25 +
      (isOngoingOrRecent ? 30 : 0) +
      (isRecent12m ? 15 : 0) +
      tokenHits * 8;

    return { item, score, isRecent12m, isOngoingOrRecent };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.item.recall_date ?? "").localeCompare(a.item.recall_date ?? "");
  });

  let highestSeverity: "NONE" | RecallSeverity = "NONE";
  let ongoingOrRecentCount = 0;
  let classIOrSevereCount = 0;
  let anyRecent12m = false;

  for (const s of scored) {
    if (
      highestSeverity === "NONE" ||
      SEVERITY_RANK[s.item.severity] > SEVERITY_RANK[highestSeverity]
    ) {
      highestSeverity = s.item.severity;
    }
    if (s.isOngoingOrRecent) ongoingOrRecentCount += 1;
    if (s.isRecent12m) anyRecent12m = true;
    if (s.item.severity === "CRITICAL_CLASS_I" || s.item.severity === "HIGH") {
      classIOrSevereCount += 1;
    }
  }

  let recallGate: "CLEAR" | "HISTORICAL_RECALLS" | "ACTIVE_RECALL_ALERT" = "CLEAR";
  if (scored.length > 0) {
    recallGate = ongoingOrRecentCount > 0 ? "ACTIVE_RECALL_ALERT" : "HISTORICAL_RECALLS";
  }

  const flags: string[] = [];
  if (highestSeverity === "CRITICAL_CLASS_I") {
    flags.push("FDA_CLASS_I_LIFE_THREATENING_RECALL");
  }
  if (classIOrSevereCount > 0) {
    flags.push("SEVERE_INJURY_OR_DEATH_HAZARD");
  }
  if (anyRecent12m) {
    flags.push("RECENT_12M_RECALL");
  }
  if (ongoingOrRecentCount > 0) {
    flags.push("ONGOING_OR_ACTIVE_ENFORCEMENT");
  }

  const topRecalls = scored.slice(0, 8).map((s) => s.item);

  return {
    query: {
      term: query.query,
      brand: query.brand,
      category: query.category,
    },
    recall_gate: recallGate,
    listing_clear: recallGate === "CLEAR",
    highest_severity: highestSeverity,
    flags,
    counts: {
      total_matched: scored.length,
      returned: topRecalls.length,
      cpsc_consumer: cpscItems.length,
      fda_food: fdaFoodItems.length,
      fda_drug: fdaDrugItems.length,
      fda_device: fdaDeviceItems.length,
      ongoing_or_recent: ongoingOrRecentCount,
      class_i_or_severe_hazard: classIOrSevereCount,
    },
    recalls: topRecalls,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources,
      disclaimer: COMMERCE_DISCLAIMER,
    },
  };
}
