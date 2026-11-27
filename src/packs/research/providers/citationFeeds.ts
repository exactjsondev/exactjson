import { type BoundedTtlCache, TTL_MS, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

const CROSSREF_BASE = "https://api.crossref.org/works";
const DATACITE_BASE = "https://api.datacite.org/dois";
const POLITE_MAILTO = "hello@exactjson.com";

const DATACITE_PRIMARY_PREFIXES: readonly string[] = [
  "10.48550/", // arXiv
  "10.5281/", // Zenodo
  "10.6084/", // Figshare
  "10.17605/", // OSF
  "10.5061/", // Dryad
  "10.7910/", // Harvard Dataverse
  "10.21227/", // IEEE DataPort
  "10.5438/", // DataCite
];

export type CitationUpdateCategory =
  | "retraction"
  | "retraction_notice"
  | "expression_of_concern"
  | "correction"
  | "other_update";

export interface CitationUpdateNotice {
  type: CitationUpdateCategory;
  raw_type: string;
  label: string;
  source: string;
  notice_doi: string | null;
  date: string | null;
}

const RETRACTED_TITLE_REGEX =
  /^(?:\[\s*(?:retracted|withdrawn)\s*\]|(?:retracted|withdrawn)(?:\s+(?:article|paper|chapter))?\s*[:[-])/i;
const RETRACTION_NOTICE_TITLE_REGEX =
  /^(?:retraction(?:\s+note|\s+notice)?|withdrawal\s+notice)\s*:/i;

export interface NormalizedCitationWork {
  doi: string;
  url: string;
  registry: "crossref" | "datacite";
  title: string;
  workType: string;
  containerTitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  publishedDate: string | null;
  authorCount: number;
  authors: string[];
  allAuthors: string[];
  citationCount: number | null;
  licenseUrl: string | null;
  updates: CitationUpdateNotice[];
  titleIndicatesRetracted: boolean;
  titleIndicatesRetractionNotice: boolean;
}

export interface CitationLookupBundle {
  work: NormalizedCitationWork | null;
  candidates: NormalizedCitationWork[];
  sources: string[];
  degraded?: boolean;
  dataciteErrorCode?: string | null;
}

function prefersDataCite(doi: string): boolean {
  const lower = doi.toLowerCase();
  return DATACITE_PRIMARY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateParts(parts: unknown): { year: number | null; isoDate: string | null } {
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) {
    return { year: null, isoDate: null };
  }
  const first = parts[0] as unknown[];
  const year = toFiniteNumber(first[0]);
  if (year === null || !Number.isInteger(year) || year < 1000 || year > 2200) {
    return { year: null, isoDate: null };
  }
  const month = toFiniteNumber(first[1]);
  const day = toFiniteNumber(first[2]);
  if (month !== null && Number.isInteger(month) && month >= 1 && month <= 12) {
    const mm = String(month).padStart(2, "0");
    if (day !== null && Number.isInteger(day) && day >= 1 && day <= 31) {
      const dd = String(day).padStart(2, "0");
      return { year, isoDate: `${year}-${mm}-${dd}` };
    }
    return { year, isoDate: `${year}-${mm}` };
  }
  return { year, isoDate: String(year) };
}

function classifyUpdateType(
  rawType: string,
  direction: "updated_by" | "update_to"
): CitationUpdateCategory {
  const lower = rawType.toLowerCase();
  if (
    lower.includes("retraction") ||
    lower.includes("withdrawal") ||
    lower.includes("withdrawn") ||
    lower.includes("removal")
  ) {
    return direction === "update_to" ? "retraction_notice" : "retraction";
  }
  if (lower.includes("concern")) {
    return "expression_of_concern";
  }
  if (
    lower.includes("correction") ||
    lower.includes("erratum") ||
    lower.includes("corrigendum") ||
    lower.includes("addendum")
  ) {
    return "correction";
  }
  return "other_update";
}

function extractCrossrefUpdates(
  msg: Record<string, unknown>,
  workDoi: string
): CitationUpdateNotice[] {
  const notices: CitationUpdateNotice[] = [];
  const seen = new Set<string>();

  const pushUpdate = (entry: Record<string, unknown>, direction: "updated_by" | "update_to") => {
    const rawType = typeof entry.type === "string" ? entry.type.trim() : "update";
    const label = typeof entry.label === "string" ? entry.label.trim() : rawType;
    const source = typeof entry.source === "string" ? entry.source.trim() : "publisher";
    const noticeDoi =
      typeof entry.DOI === "string" && entry.DOI.trim().length > 0
        ? entry.DOI.trim().toLowerCase()
        : null;
    const updatedObj = entry.updated as Record<string, unknown> | undefined;
    const dateInfo = formatDateParts(updatedObj?.["date-parts"]);
    // Self-referencing update-to (entry.DOI === workDoi or absent) means this work itself was retracted/updated
    const effectiveDirection =
      direction === "update_to" && (noticeDoi === null || noticeDoi === workDoi)
        ? "updated_by"
        : direction;
    const category = classifyUpdateType(rawType, effectiveDirection);
    const dedupeKey = `${category}|${noticeDoi ?? ""}|${dateInfo.isoDate ?? ""}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    notices.push({
      type: category,
      raw_type: rawType,
      label,
      source,
      notice_doi: noticeDoi,
      date: dateInfo.isoDate,
    });
  };

  if (Array.isArray(msg["updated-by"])) {
    for (const item of msg["updated-by"]) {
      if (item && typeof item === "object") {
        pushUpdate(item as Record<string, unknown>, "updated_by");
      }
    }
  }

  if (Array.isArray(msg["update-to"])) {
    for (const item of msg["update-to"]) {
      if (item && typeof item === "object") {
        pushUpdate(item as Record<string, unknown>, "update_to");
      }
    }
  }

  const relation = msg.relation as Record<string, unknown> | undefined;
  if (relation && typeof relation === "object") {
    const retractedBy = relation["is-retracted-by"];
    if (Array.isArray(retractedBy)) {
      for (const rel of retractedBy) {
        if (!rel || typeof rel !== "object") continue;
        const r = rel as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id.trim().toLowerCase() : null;
        const dedupeKey = `retraction|${id ?? ""}|`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          notices.push({
            type: "retraction",
            raw_type: "is-retracted-by",
            label: "Retracted By",
            source: "crossref-relation",
            notice_doi: id,
            date: null,
          });
        }
      }
    }
  }

  return notices;
}

export function parseCrossrefWork(rawWork: Record<string, unknown>): NormalizedCitationWork | null {
  const doi = typeof rawWork.DOI === "string" ? rawWork.DOI.trim().toLowerCase() : "";
  if (!doi) return null;

  const titles = Array.isArray(rawWork.title) ? rawWork.title : [];
  const rawTitle = typeof titles[0] === "string" ? stripHtmlTags(titles[0]) : "";
  if (!rawTitle) return null;

  const containers = Array.isArray(rawWork["container-title"]) ? rawWork["container-title"] : [];
  const containerTitle =
    typeof containers[0] === "string" && containers[0].trim().length > 0
      ? stripHtmlTags(containers[0])
      : null;

  const publisher =
    typeof rawWork.publisher === "string" && rawWork.publisher.trim().length > 0
      ? rawWork.publisher.trim()
      : null;

  const pubParts =
    (rawWork.published as Record<string, unknown> | undefined)?.["date-parts"] ??
    (rawWork["published-online"] as Record<string, unknown> | undefined)?.["date-parts"] ??
    (rawWork["published-print"] as Record<string, unknown> | undefined)?.["date-parts"] ??
    (rawWork.issued as Record<string, unknown> | undefined)?.["date-parts"];
  const dateInfo = formatDateParts(pubParts);

  const rawAuthors = Array.isArray(rawWork.author) ? rawWork.author : [];
  const allAuthors: string[] = [];
  for (const a of rawAuthors) {
    if (!a || typeof a !== "object") continue;
    const ao = a as Record<string, unknown>;
    const given = typeof ao.given === "string" ? ao.given.trim() : "";
    const family = typeof ao.family === "string" ? ao.family.trim() : "";
    const orgName = typeof ao.name === "string" ? ao.name.trim() : "";
    const full = [given, family].filter(Boolean).join(" ") || orgName;
    if (full) allAuthors.push(full);
  }

  const citationCount = toFiniteNumber(rawWork["is-referenced-by-count"]);
  const licenses = Array.isArray(rawWork.license) ? rawWork.license : [];
  const firstLicense = licenses[0] as Record<string, unknown> | undefined;
  const licenseUrl =
    typeof firstLicense?.URL === "string" && firstLicense.URL.trim().length > 0
      ? firstLicense.URL.trim()
      : null;

  const workType =
    typeof rawWork.type === "string" && rawWork.type.trim().length > 0
      ? rawWork.type.trim()
      : "unknown";

  const titleIndicatesRetractionNotice = RETRACTION_NOTICE_TITLE_REGEX.test(rawTitle);
  const titleIndicatesRetracted =
    !titleIndicatesRetractionNotice && RETRACTED_TITLE_REGEX.test(rawTitle);

  return {
    doi,
    url: `https://doi.org/${doi}`,
    registry: "crossref",
    title: rawTitle,
    workType,
    containerTitle,
    publisher,
    publishedYear: dateInfo.year,
    publishedDate: dateInfo.isoDate,
    authorCount: allAuthors.length,
    authors: allAuthors.slice(0, 8),
    allAuthors: allAuthors.slice(0, 250),
    citationCount: citationCount !== null && citationCount >= 0 ? Math.round(citationCount) : null,
    licenseUrl,
    updates: extractCrossrefUpdates(rawWork, doi),
    titleIndicatesRetracted,
    titleIndicatesRetractionNotice,
  };
}

export function parseDataCiteWork(attrs: Record<string, unknown>): NormalizedCitationWork | null {
  const doi = typeof attrs.doi === "string" ? attrs.doi.trim().toLowerCase() : "";
  if (!doi) return null;

  const titles = Array.isArray(attrs.titles) ? attrs.titles : [];
  const firstTitleObj = titles[0] as Record<string, unknown> | undefined;
  const rawTitle =
    typeof firstTitleObj?.title === "string" ? stripHtmlTags(firstTitleObj.title) : "";
  if (!rawTitle) return null;

  const publisher =
    typeof attrs.publisher === "string" && attrs.publisher.trim().length > 0
      ? attrs.publisher.trim()
      : typeof (attrs.publisher as Record<string, unknown> | undefined)?.name === "string"
        ? String((attrs.publisher as Record<string, unknown>).name).trim()
        : null;

  const pubYear = toFiniteNumber(attrs.publicationYear);
  const publishedYear =
    pubYear !== null && Number.isInteger(pubYear) && pubYear >= 1000 && pubYear <= 2200
      ? pubYear
      : null;

  let publishedDate: string | null = publishedYear !== null ? String(publishedYear) : null;
  if (Array.isArray(attrs.dates)) {
    for (const d of attrs.dates) {
      if (!d || typeof d !== "object") continue;
      const doObj = d as Record<string, unknown>;
      const dateStr = typeof doObj.date === "string" ? doObj.date.trim() : "";
      if (/^\d{4}-\d{2}(?:-\d{2})?/.test(dateStr)) {
        publishedDate = dateStr.slice(0, 10);
        break;
      }
    }
  }

  const rawCreators = Array.isArray(attrs.creators) ? attrs.creators : [];
  const allAuthors: string[] = [];
  for (const c of rawCreators) {
    if (!c || typeof c !== "object") continue;
    const co = c as Record<string, unknown>;
    const given = typeof co.givenName === "string" ? co.givenName.trim() : "";
    const family = typeof co.familyName === "string" ? co.familyName.trim() : "";
    const rawName = typeof co.name === "string" ? co.name.trim() : "";
    const full = [given, family].filter(Boolean).join(" ") || rawName;
    if (full) allAuthors.push(full);
  }

  const typesObj = attrs.types as Record<string, unknown> | undefined;
  const resourceTypeGeneral =
    typeof typesObj?.resourceTypeGeneral === "string"
      ? typesObj.resourceTypeGeneral.trim().toLowerCase()
      : "other";
  const resourceType =
    typeof typesObj?.resourceType === "string" ? typesObj.resourceType.trim().toLowerCase() : "";
  const workType =
    resourceTypeGeneral === "preprint" || doi.startsWith("10.48550/arxiv.")
      ? "preprint"
      : resourceType || resourceTypeGeneral;

  const citationCount = toFiniteNumber(attrs.citationCount);
  const rightsList = Array.isArray(attrs.rightsList) ? attrs.rightsList : [];
  const firstRight = rightsList[0] as Record<string, unknown> | undefined;
  const licenseUrl =
    typeof firstRight?.rightsUri === "string" && firstRight.rightsUri.trim().length > 0
      ? firstRight.rightsUri.trim()
      : null;

  const updates: CitationUpdateNotice[] = [];
  if (Array.isArray(attrs.relatedIdentifiers)) {
    for (const rel of attrs.relatedIdentifiers) {
      if (!rel || typeof rel !== "object") continue;
      const ro = rel as Record<string, unknown>;
      const relType = typeof ro.relationType === "string" ? ro.relationType.trim() : "";
      const relId =
        typeof ro.relatedIdentifier === "string" ? ro.relatedIdentifier.trim().toLowerCase() : null;
      if (relType === "IsRetractedBy" || relType === "IsObsoletedBy") {
        updates.push({
          type: relType === "IsRetractedBy" ? "retraction" : "other_update",
          raw_type: relType,
          label: relType,
          source: "datacite",
          notice_doi: relId,
          date: null,
        });
      } else if (relType === "Retracts") {
        updates.push({
          type: "retraction_notice",
          raw_type: relType,
          label: "Retraction Notice",
          source: "datacite",
          notice_doi: relId,
          date: null,
        });
      }
    }
  }

  const titleIndicatesRetractionNotice = RETRACTION_NOTICE_TITLE_REGEX.test(rawTitle);
  const titleIndicatesRetracted =
    !titleIndicatesRetractionNotice && RETRACTED_TITLE_REGEX.test(rawTitle);

  return {
    doi,
    url: `https://doi.org/${doi}`,
    registry: "datacite",
    title: rawTitle,
    workType,
    containerTitle: publisher === "arXiv" ? "arXiv" : null,
    publisher,
    publishedYear,
    publishedDate,
    authorCount: allAuthors.length,
    authors: allAuthors.slice(0, 8),
    allAuthors: allAuthors.slice(0, 250),
    citationCount: citationCount !== null && citationCount >= 0 ? Math.round(citationCount) : null,
    licenseUrl,
    updates,
    titleIndicatesRetracted,
    titleIndicatesRetractionNotice,
  };
}

async function queryCrossrefByDoi(
  doi: string,
  fetchImpl: typeof fetch
): Promise<NormalizedCitationWork | null> {
  const url = `${CROSSREF_BASE}/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(POLITE_MAILTO)}`;
  const res = await fetchJsonWithTimeout<{ message?: Record<string, unknown> }>(url, {
    provider: "CROSSREF",
    allow404: true,
    timeoutMs: 5000,
    fetchImpl,
  });
  if (res.status === "not_found") return null;
  if (!res.data?.message || typeof res.data.message !== "object") {
    throw new UpstreamError("CROSSREF", "CROSSREF_BAD_SCHEMA", "Invalid Crossref work payload");
  }
  const parsed = parseCrossrefWork(res.data.message);
  if (!parsed) {
    throw new UpstreamError("CROSSREF", "CROSSREF_BAD_SCHEMA", "Missing DOI/title in Crossref work");
  }
  return parsed;
}

async function queryDataCiteByDoi(
  doi: string,
  fetchImpl: typeof fetch
): Promise<NormalizedCitationWork | null> {
  const url = `${DATACITE_BASE}/${encodeURIComponent(doi)}`;
  const res = await fetchJsonWithTimeout<{ data?: { attributes?: Record<string, unknown> } }>(url, {
    provider: "DATACITE",
    allow404: true,
    timeoutMs: 5000,
    fetchImpl,
  });
  if (res.status === "not_found") return null;
  const attrs = res.data?.data?.attributes;
  if (!attrs || typeof attrs !== "object") {
    throw new UpstreamError("DATACITE", "DATACITE_BAD_SCHEMA", "Invalid DataCite DOI payload");
  }
  const parsed = parseDataCiteWork(attrs);
  if (!parsed) {
    throw new UpstreamError("DATACITE", "DATACITE_BAD_SCHEMA", "Missing DOI/title in DataCite work");
  }
  return parsed;
}

export async function fetchCitationByDoi(
  doi: string,
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: CitationLookupBundle; cacheHit: boolean }> {
  const key = `science:citation:doi:${doi.toLowerCase()}`;
  const { value, cacheHit } = await withTwoTierCache<CitationLookupBundle>({
    key,
    ttlMs: TTL_MS.SCIENCE_CITATION_DOI,
    cache,
    waitUntil,
    fetcher: async () => {
      if (prefersDataCite(doi)) {
        const dcWork = await queryDataCiteByDoi(doi, fetchImpl);
        if (dcWork) {
          return { work: dcWork, candidates: [dcWork], sources: ["datacite"] };
        }
        const crWork = await queryCrossrefByDoi(doi, fetchImpl);
        if (crWork) {
          return { work: crWork, candidates: [crWork], sources: ["datacite", "crossref"] };
        }
        return { work: null, candidates: [], sources: ["datacite", "crossref"] };
      }

      const crWork = await queryCrossrefByDoi(doi, fetchImpl);
      if (crWork) {
        return { work: crWork, candidates: [crWork], sources: ["crossref"] };
      }
      const dcWork = await queryDataCiteByDoi(doi, fetchImpl);
      if (dcWork) {
        return { work: dcWork, candidates: [dcWork], sources: ["crossref", "datacite"] };
      }
      return { work: null, candidates: [], sources: ["crossref", "datacite"] };
    },
  });
  return { data: value, cacheHit };
}

export async function fetchCitationByBibliographicQuery(
  query: string,
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ data: CitationLookupBundle; cacheHit: boolean }> {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ").trim();
  const key = `science:citation:query:${normalizedQuery}`;
  const { value, cacheHit } = await withTwoTierCache<CitationLookupBundle>({
    key,
    ttlMs: TTL_MS.SCIENCE_CITATION_QUERY,
    cache,
    waitUntil,
    shouldCache: (b) => !b.degraded,
    fetcher: async () => {
      const crUrl = `${CROSSREF_BASE}?query.bibliographic=${encodeURIComponent(query)}&rows=5&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
      const dcUrl = `${DATACITE_BASE}?query=${encodeURIComponent(query)}&page[size]=3`;

      const [crSettled, dcSettled] = await Promise.allSettled([
        fetchJsonWithTimeout<{ message?: { items?: Array<Record<string, unknown>> } }>(crUrl, {
          provider: "CROSSREF",
          timeoutMs: 5500,
          fetchImpl,
        }),
        fetchJsonWithTimeout<{ data?: Array<{ attributes?: Record<string, unknown> }> }>(dcUrl, {
          provider: "DATACITE",
          timeoutMs: 5000,
          fetchImpl,
        }),
      ]);

      // Fail closed if primary Crossref bibliographic search fails
      if (crSettled.status === "rejected") {
        throw crSettled.reason;
      }
      if (crSettled.value.status !== "ok") {
        throw new UpstreamError("CROSSREF", "CROSSREF_UNAVAILABLE", "Crossref search unavailable");
      }

      const items = crSettled.value.data?.message?.items;
      if (!Array.isArray(items)) {
        throw new UpstreamError("CROSSREF", "CROSSREF_BAD_SCHEMA", "Invalid Crossref items list");
      }

      const candidates: NormalizedCitationWork[] = [];
      const seenDois = new Set<string>();
      const sources: string[] = ["crossref"];
      let degraded = false;
      let dataciteErrorCode: string | null = null;

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const parsed = parseCrossrefWork(item);
        if (parsed && !seenDois.has(parsed.doi)) {
          seenDois.add(parsed.doi);
          candidates.push(parsed);
        }
      }

      if (dcSettled.status === "fulfilled" && dcSettled.value.status === "ok") {
        sources.push("datacite");
        const dcRows = dcSettled.value.data?.data;
        if (Array.isArray(dcRows)) {
          for (const row of dcRows) {
            if (!row?.attributes || typeof row.attributes !== "object") continue;
            const parsed = parseDataCiteWork(row.attributes);
            if (parsed && !seenDois.has(parsed.doi)) {
              seenDois.add(parsed.doi);
              candidates.push(parsed);
            }
          }
        }
      } else if (dcSettled.status === "rejected") {
        degraded = true;
        dataciteErrorCode =
          dcSettled.reason instanceof UpstreamError
            ? dcSettled.reason.code
            : "DATACITE_UNAVAILABLE";
      }

      return {
        work: candidates[0] ?? null,
        candidates,
        sources,
        degraded,
        dataciteErrorCode,
      };
    },
  });
  return { data: value, cacheHit };
}
