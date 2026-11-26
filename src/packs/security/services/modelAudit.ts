import { SECURITY_DISCLAIMER } from "../../../config/catalog/security";
import type { HfModelRawInfo } from "../providers/huggingface";

export type CommercialLicenseStatus =
  | "COMMERCIAL_SAFE"
  | "RESTRICTED_COMMERCIAL"
  | "NON_COMMERCIAL"
  | "UNKNOWN";

export type WeightsFormatVerdict =
  | "SAFE_SAFETENSORS"
  | "SAFE_GGUF"
  | "MIXED_PREFER_SAFETENSORS"
  | "UNSAFE_PICKLE_ONLY"
  | "NO_WEIGHTS_DETECTED";

const COMMERCIAL_SAFE_LICENSES = new Set([
  "mit",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "bsd",
  "isc",
  "cc0-1.0",
  "cc-by-4.0",
  "cc-by-sa-4.0",
  "mpl-2.0",
  "unlicense",
  "zlib",
  "0bsd",
  "openrail",
  "creativeml-openrail-m",
  "bigscience-bloom-rail-1.0",
]);

const PICKLE_EXT_RE = /\.(?:bin|pt|pth|pkl|pickle|ckpt)$/i;

function classifyLicense(license: string | null): CommercialLicenseStatus {
  if (!license) return "UNKNOWN";
  const norm = license.trim().toLowerCase();
  if (COMMERCIAL_SAFE_LICENSES.has(norm)) {
    return "COMMERCIAL_SAFE";
  }
  if (
    norm.includes("-nc") ||
    norm.includes("non-commercial") ||
    norm.includes("noncommercial") ||
    norm.endsWith("-research") ||
    norm === "research-only"
  ) {
    return "NON_COMMERCIAL";
  }
  return "RESTRICTED_COMMERCIAL";
}

export function computeModelAudit(info: HfModelRawInfo, nowMs: number) {
  const flags: string[] = [];

  const commercialStatus = classifyLicense(info.license);
  if (commercialStatus === "NON_COMMERCIAL") {
    flags.push("NON_COMMERCIAL_LICENSE");
  } else if (commercialStatus === "RESTRICTED_COMMERCIAL") {
    flags.push("CUSTOM_OR_RESTRICTED_LICENSE");
  } else if (commercialStatus === "UNKNOWN") {
    flags.push("MISSING_LICENSE");
  }

  if (info.gated !== false) {
    flags.push("GATED_MODEL");
  }

  let hasSafetensors = false;
  let hasGguf = false;
  const pickleFiles: string[] = [];

  for (const filename of info.filenames) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".safetensors")) {
      hasSafetensors = true;
    } else if (lower.endsWith(".gguf")) {
      hasGguf = true;
    } else if (PICKLE_EXT_RE.test(lower)) {
      if (pickleFiles.length < 10) {
        pickleFiles.push(filename);
      }
    }
  }

  const hasPickleWeights = pickleFiles.length > 0;
  let formatVerdict: WeightsFormatVerdict;
  if (hasSafetensors && !hasPickleWeights) {
    formatVerdict = "SAFE_SAFETENSORS";
  } else if (hasSafetensors && hasPickleWeights) {
    formatVerdict = "MIXED_PREFER_SAFETENSORS";
    flags.push("PICKLE_CODE_EXEC_RISK");
  } else if (!hasSafetensors && hasPickleWeights) {
    formatVerdict = "UNSAFE_PICKLE_ONLY";
    flags.push("PICKLE_CODE_EXEC_RISK");
  } else if (hasGguf) {
    formatVerdict = "SAFE_GGUF";
  } else {
    formatVerdict = "NO_WEIGHTS_DETECTED";
    flags.push("NO_MODEL_WEIGHTS_FOUND");
  }

  const paramCount = info.parameterCount;
  const sizing =
    paramCount !== null && paramCount > 0
      ? {
          parameter_count: paramCount,
          parameters_billions: Math.round((paramCount / 1e9) * 100) / 100,
          estimated_vram_gb: {
            fp16_bf16: Math.round(((paramCount * 2 * 1.18) / 1e9) * 10) / 10,
            int8: Math.round(((paramCount * 1 * 1.18) / 1e9) * 10) / 10,
            int4: Math.round(((paramCount * 0.5 * 1.18) / 1e9) * 10) / 10,
          },
        }
      : {
          parameter_count: null,
          parameters_billions: null,
          estimated_vram_gb: null,
        };

  const deploymentReady =
    commercialStatus === "COMMERCIAL_SAFE" &&
    info.gated === false &&
    !hasPickleWeights &&
    (hasSafetensors || hasGguf);

  return {
    model: info.id,
    author: info.author,
    pipeline_tag: info.pipelineTag,
    library_name: info.libraryName,
    deployment_ready: deploymentReady,
    flags,
    licensing: {
      license: info.license,
      commercial_status: commercialStatus,
      gated: info.gated,
    },
    weights_security: {
      has_safetensors: hasSafetensors,
      has_pickle_weights: hasPickleWeights,
      pickle_files: pickleFiles,
      has_gguf: hasGguf,
      format_verdict: formatVerdict,
    },
    sizing,
    popularity: {
      downloads_30d: info.downloads,
      likes: info.likes,
    },
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: ["huggingface_hub"],
      disclaimer: SECURITY_DISCLAIMER,
    },
  };
}
