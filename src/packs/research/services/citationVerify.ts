import { RESEARCH_DISCLAIMER } from "../../../config/catalog/research";
import { UpstreamError } from "../../../lib/http";
import { roundTo } from "../../../lib/numbers";
import type { CitationLookupBundle, NormalizedCitationWork } from "../providers/citationFeeds";
import type { CitationVerifyInput } from "../validation";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "using",
  "via",
  "with",
]);

function normalizeTextTokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length >= 2 && !STOPWORDS.has(tok));
}

function normalizeAsciiFold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function computeTitleOverlap(expected: string, actual: string): number {
  const expTokens = normalizeTextTokens(expected);
  const actSet = new Set(normalizeTextTokens(actual));
  if (expTokens.length === 0) return actSet.size === 0 ? 1 : 0;
  let hits = 0;
  for (const tok of expTokens) {
    if (actSet.has(tok)) hits += 1;
  }
  return roundTo(hits / expTokens.length, 4);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractExpectedSurname(rawAuthor: string): { fullClean: string; surname: string } {
  const folded = normalizeAsciiFold(rawAuthor)
    .replace(/\b(?:et\s+al\.?|jr\.?|sr\.?|ii|iii|iv)\b/g, " ")
    .trim();
  const commaParts = folded.split(",");
  const surnameSegment =
    commaParts.length >= 2 && commaParts[0]?.trim() ? commaParts[0].trim() : folded;
  const tokens = surnameSegment
    .replace(/[^a-z0-9\s'-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const surname = tokens[tokens.length - 1] ?? "";
  const fullClean = folded.replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
  return { fullClean, surname };
}

export function matchesRegisteredAuthor(
  expectedAuthor: string,
  registeredAuthors: readonly string[]
): boolean {
  const { fullClean, surname } = extractExpectedSurname(expectedAuthor);
  if (!surname && !fullClean) return false;

  const surnameWordRegex = surname
    ? new RegExp(`(?:^|[\\s,'-])${escapeRegExp(surname)}(?:$|[\\s,'-])`)
    : null;
  const fullPhraseRegex = fullClean.includes(" ")
    ? new RegExp(`(?:^|[\\s,'-])${escapeRegExp(fullClean)}(?:$|[\\s,'-])`)
    : null;

  return registeredAuthors.some((a) => {
    const normA = normalizeAsciiFold(a).replace(/\s+/g, " ").trim();
    if (fullPhraseRegex?.test(normA)) return true;
    return surnameWordRegex ? surnameWordRegex.test(normA) : false;
  });
}

function scoreCandidateAgainstQuery(
  candidate: NormalizedCitationWork,
  queryText: string
): number {
  const qTokens = normalizeTextTokens(queryText);
  if (qTokens.length === 0) return 0;

  const haystack = [
    candidate.title,
    ...candidate.allAuthors,
    candidate.publishedYear ? String(candidate.publishedYear) : "",
    candidate.containerTitle ?? "",
  ].join(" ");
  const hayTokens = new Set(normalizeTextTokens(haystack));

  let matched = 0;
  for (const tok of qTokens) {
    if (hayTokens.has(tok)) matched += 1;
  }
  const recall = matched / qTokens.length;
  const titleCoverage = computeTitleOverlap(candidate.title, queryText);
  return roundTo(recall * 0.65 + titleCoverage * 0.35, 4);
}

export function computeCitationVerify(params: {
  input: CitationVerifyInput;
  bundle: CitationLookupBundle;
  nowMs?: number;
}) {
  const { input, bundle, nowMs = Date.now() } = params;
  const flags: string[] = [];

  let selectedWork: NormalizedCitationWork | null = bundle.work;
  let queryMatchConfidence: number | null = null;

  if (input.mode === "bibliographic" && input.query !== null) {
    let best: NormalizedCitationWork | null = null;
    let bestScore = -1;
    for (const cand of bundle.candidates) {
      const score = scoreCandidateAgainstQuery(cand, input.query);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (best && bestScore >= 0.35) {
      if (bestScore < 0.6 && bundle.dataciteErrorCode) {
        // Fail closed rather than returning low-confidence/false match when DataCite (arXiv/Zenodo) failed
        throw new UpstreamError(
          "DATACITE",
          bundle.dataciteErrorCode,
          "DataCite search unavailable during bibliographic verification"
        );
      }
      selectedWork = best;
      queryMatchConfidence = bestScore;
    } else {
      if (bundle.dataciteErrorCode) {
        throw new UpstreamError(
          "DATACITE",
          bundle.dataciteErrorCode,
          "DataCite search unavailable; refusing to mark preprint/citation as NOT_FOUND"
        );
      }
      selectedWork = null;
    }
  }

  if (!selectedWork) {
    flags.push(
      input.mode === "doi"
        ? "UNREGISTERED_OR_HALLUCINATED_DOI"
        : "NO_CONFIDENT_BIBLIOGRAPHIC_MATCH"
    );
    return {
      query: {
        mode: input.mode,
        requested_doi: input.doi,
        query: input.query,
        expected_title: input.expectedTitle,
        expected_author: input.expectedAuthor,
        expected_year: input.expectedYear,
      },
      exists: false,
      verdict: "NOT_FOUND" as const,
      integrity: {
        is_retracted: false,
        is_retraction_notice: false,
        has_expression_of_concern: false,
        has_correction: false,
        updates: [],
      },
      metadata_check: {
        checked:
          input.expectedTitle !== null ||
          input.expectedAuthor !== null ||
          input.expectedYear !== null,
        title_match: null,
        title_token_overlap: null,
        author_match: null,
        year_match: null,
        year_delta: null,
      },
      work: null,
      flags,
      metadata: {
        fetched_at: new Date(nowMs).toISOString(),
        sources: bundle.sources,
        disclaimer: RESEARCH_DISCLAIMER,
      },
    };
  }

  const isRetracted =
    selectedWork.titleIndicatesRetracted ||
    selectedWork.updates.some((u) => u.type === "retraction");
  const isRetractionNotice =
    selectedWork.titleIndicatesRetractionNotice ||
    selectedWork.updates.some((u) => u.type === "retraction_notice");
  const hasExpressionOfConcern = selectedWork.updates.some(
    (u) => u.type === "expression_of_concern"
  );
  const hasCorrection = selectedWork.updates.some((u) => u.type === "correction");

  if (isRetracted) flags.push("RETRACTED_WORK");
  if (isRetractionNotice) flags.push("IS_RETRACTION_NOTICE");
  if (hasExpressionOfConcern) flags.push("EXPRESSION_OF_CONCERN");
  if (hasCorrection) flags.push("HAS_PUBLISHED_CORRECTION");
  if (selectedWork.updates.some((u) => u.source === "retraction-watch")) {
    flags.push("RETRACTION_WATCH_RECORD");
  }
  if (
    selectedWork.workType === "posted-content" ||
    selectedWork.workType === "preprint" ||
    selectedWork.doi.startsWith("10.48550/arxiv.")
  ) {
    flags.push("PREPRINT_NOT_PEER_REVIEWED");
  }

  let titleMatch: boolean | null = null;
  let titleOverlap: number | null = null;
  if (input.expectedTitle !== null) {
    titleOverlap = computeTitleOverlap(input.expectedTitle, selectedWork.title);
    titleMatch = titleOverlap >= 0.6;
    if (!titleMatch) flags.push("TITLE_MISMATCH_SWAPPED_DOI");
  }

  let authorMatch: boolean | null = null;
  if (input.expectedAuthor !== null) {
    const authorPool =
      selectedWork.allAuthors.length > 0 ? selectedWork.allAuthors : selectedWork.authors;
    authorMatch = matchesRegisteredAuthor(input.expectedAuthor, authorPool);
    if (!authorMatch) flags.push("AUTHOR_MISMATCH");
  }

  let yearMatch: boolean | null = null;
  let yearDelta: number | null = null;
  if (input.expectedYear !== null && selectedWork.publishedYear !== null) {
    yearDelta = selectedWork.publishedYear - input.expectedYear;
    yearMatch = Math.abs(yearDelta) <= 1;
    if (!yearMatch) flags.push("YEAR_MISMATCH");
  }

  const metadataChecked =
    input.expectedTitle !== null || input.expectedAuthor !== null || input.expectedYear !== null;
  const hasMetadataMismatch =
    titleMatch === false || authorMatch === false || yearMatch === false;

  const isLowConfidenceQuery =
    input.mode === "bibliographic" &&
    queryMatchConfidence !== null &&
    queryMatchConfidence < 0.6;
  if (isLowConfidenceQuery) {
    flags.push("LOW_CONFIDENCE_QUERY_MATCH");
  }

  const verdict =
    isRetracted || isRetractionNotice
      ? "RETRACTED"
      : hasExpressionOfConcern
        ? "EXPRESSION_OF_CONCERN"
        : hasMetadataMismatch
          ? "METADATA_MISMATCH"
          : isLowConfidenceQuery
            ? "LOW_CONFIDENCE_QUERY_MATCH"
            : "VERIFIED";

  return {
    query: {
      mode: input.mode,
      requested_doi: input.doi,
      query: input.query,
      expected_title: input.expectedTitle,
      expected_author: input.expectedAuthor,
      expected_year: input.expectedYear,
      ...(queryMatchConfidence !== null ? { query_match_score: queryMatchConfidence } : {}),
    },
    exists: true,
    verdict,
    integrity: {
      is_retracted: isRetracted,
      is_retraction_notice: isRetractionNotice,
      has_expression_of_concern: hasExpressionOfConcern,
      has_correction: hasCorrection,
      updates: selectedWork.updates.map((u) => ({
        type: u.type,
        label: u.label,
        source: u.source,
        notice_doi: u.notice_doi,
        date: u.date,
      })),
    },
    metadata_check: {
      checked: metadataChecked,
      title_match: titleMatch,
      title_token_overlap: titleOverlap,
      author_match: authorMatch,
      year_match: yearMatch,
      year_delta: yearDelta,
    },
    work: {
      doi: selectedWork.doi,
      url: selectedWork.url,
      registry: selectedWork.registry,
      title: selectedWork.title,
      work_type: selectedWork.workType,
      container_title: selectedWork.containerTitle,
      publisher: selectedWork.publisher,
      published_year: selectedWork.publishedYear,
      published_date: selectedWork.publishedDate,
      author_count: selectedWork.authorCount,
      authors: selectedWork.authors,
      citation_count: selectedWork.citationCount,
      license_url: selectedWork.licenseUrl,
    },
    flags,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: bundle.sources,
      disclaimer: RESEARCH_DISCLAIMER,
    },
  };
}
