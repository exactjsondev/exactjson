import { type BoundedTtlCache, TTL_MS, isolateCache, withTwoTierCache } from "../../../lib/cache";
import { UpstreamError, fetchJsonWithTimeout } from "../../../lib/http";
import { toFiniteNumber } from "../../../lib/numbers";

export interface HfModelRawInfo {
  id: string;
  author: string | null;
  pipelineTag: string | null;
  libraryName: string | null;
  gated: boolean | string;
  license: string | null;
  downloads: number;
  likes: number;
  filenames: string[];
  parameterCount: number | null;
}

function extractLicense(raw: Record<string, unknown>): string | null {
  const cardData =
    raw.cardData && typeof raw.cardData === "object"
      ? (raw.cardData as Record<string, unknown>)
      : null;
  if (cardData) {
    if (typeof cardData.license === "string" && cardData.license.trim()) {
      return cardData.license.trim().toLowerCase();
    }
    if (Array.isArray(cardData.license)) {
      const first = cardData.license.find((l): l is string => typeof l === "string" && l.trim().length > 0);
      if (first) return first.trim().toLowerCase();
    }
  }

  if (Array.isArray(raw.tags)) {
    for (const tag of raw.tags) {
      if (typeof tag === "string" && tag.toLowerCase().startsWith("license:")) {
        const val = tag.slice("license:".length).trim().toLowerCase();
        if (val) return val;
      }
    }
  }
  return null;
}

function extractParameterCount(raw: Record<string, unknown>): number | null {
  const st =
    raw.safetensors && typeof raw.safetensors === "object"
      ? (raw.safetensors as Record<string, unknown>)
      : null;
  if (!st) return null;

  const total = toFiniteNumber(st.total);
  if (total !== null && total > 0) {
    return Math.round(total);
  }

  if (st.parameters && typeof st.parameters === "object") {
    let sum = 0;
    for (const val of Object.values(st.parameters as Record<string, unknown>)) {
      const n = toFiniteNumber(val);
      if (n !== null && n > 0) sum += n;
    }
    if (sum > 0) return Math.round(sum);
  }
  return null;
}

export async function fetchHfModelMetadata(
  modelId: string,
  cache: BoundedTtlCache = isolateCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<{ status: "not_found"; cacheHit: boolean } | { status: "ok"; data: HfModelRawInfo; cacheHit: boolean }> {
  const encodedPath = modelId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const { value, cacheHit } = await withTwoTierCache<
    { status: "not_found" } | { status: "ok"; data: HfModelRawInfo }
  >({
    key: `hf:model:${modelId.toLowerCase()}`,
    ttlMs: TTL_MS.AI_MODEL_AUDIT,
    cache,
    waitUntil,
    shouldCache: (v) => v.status === "ok",
    fetcher: async () => {
      let res: { status: "ok"; data: Record<string, unknown> } | { status: "not_found" };
      try {
        res = await fetchJsonWithTimeout<Record<string, unknown>>(
          `https://huggingface.co/api/models/${encodedPath}`,
          {
            provider: "HF_HUB",
            allow404: true,
            fetchImpl,
          }
        );
      } catch (err) {
        // Hugging Face Hub returns 401 for non-existent or private repos when unauthenticated
        if (err instanceof UpstreamError && err.httpStatus === 401) {
          return { status: "not_found" };
        }
        throw err;
      }

      if (res.status === "not_found") {
        return { status: "not_found" };
      }

      const raw = res.data;
      if (!raw || typeof raw.id !== "string") {
        throw new UpstreamError("HF_HUB", "HF_HUB_BAD_SCHEMA", "Invalid Hugging Face model response");
      }

      const siblings = Array.isArray(raw.siblings)
        ? (raw.siblings as Array<{ rfilename?: unknown }>)
        : [];
      const filenames: string[] = [];
      for (const sib of siblings) {
        if (typeof sib?.rfilename === "string" && sib.rfilename.trim()) {
          filenames.push(sib.rfilename.trim());
        }
      }

      const gatedRaw = raw.gated;
      const gated =
        gatedRaw === true || (typeof gatedRaw === "string" && gatedRaw.trim().length > 0)
          ? gatedRaw
          : false;

      const defaultAuthor = raw.id.includes("/") ? raw.id.split("/")[0]! : null;

      return {
        status: "ok",
        data: {
          id: raw.id,
          author: typeof raw.author === "string" ? raw.author : defaultAuthor,
          pipelineTag: typeof raw.pipeline_tag === "string" ? raw.pipeline_tag : null,
          libraryName: typeof raw.library_name === "string" ? raw.library_name : null,
          gated,
          license: extractLicense(raw),
          downloads: Math.max(0, Math.round(toFiniteNumber(raw.downloads) ?? 0)),
          likes: Math.max(0, Math.round(toFiniteNumber(raw.likes) ?? 0)),
          filenames,
          parameterCount: extractParameterCount(raw),
        },
      };
    },
  });

  if (value.status === "not_found") {
    return { status: "not_found", cacheHit };
  }
  return { status: "ok", data: value.data, cacheHit };
}
