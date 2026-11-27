import { type BoundedTtlCache, TTL_MS, withTwoTierCache } from "../../../lib/cache";
import { fetchJsonWithTimeout, UpstreamError } from "../../../lib/http";
import { roundToOrNull, toFiniteNumber } from "../../../lib/numbers";
import { type ChemHazardInput, isValidCasRegistryNumber } from "../validation";

const PUBCHEM_PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUBCHEM_PUG_VIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound";
const PROPERTY_LIST =
  "Title,MolecularFormula,MolecularWeight,IUPACName,ConnectivitySMILES,SMILES,InChIKey,XLogP";

const EC_NUMBER_REGEX = /^\d{3}-\d{3}-\d$/;
const CAS_CANDIDATE_REGEX = /^[1-9]\d{1,6}-\d{2}-\d$/;

const PICTOGRAM_LABELS: Readonly<Record<string, string>> = {
  GHS01: "Explosive",
  GHS02: "Flammable",
  GHS03: "Oxidizer",
  GHS04: "Compressed Gas",
  GHS05: "Corrosive",
  GHS06: "Acute Toxic",
  GHS07: "Irritant",
  GHS08: "Health Hazard",
  GHS09: "Environmental Hazard",
};

export interface PubChemCompoundProps {
  cid: number;
  title: string;
  iupacName: string | null;
  molecularFormula: string | null;
  molecularWeight: number | null;
  smiles: string | null;
  inchikey: string | null;
  xlogp: number | null;
}

export interface PubChemSynonymsSummary {
  casRn: string | null;
  ecNumber: string | null;
  synonyms: string[];
}

export interface GhsPictogram {
  code: string;
  label: string;
}

export interface GhsHazardStatement {
  code: string;
  statement: string;
}

export interface ParsedGhsClassification {
  sectionFound: boolean;
  explicitlyNotClassified: boolean;
  signalWord: "Danger" | "Warning" | "None";
  pictograms: GhsPictogram[];
  hazardStatements: GhsHazardStatement[];
  precautionaryCodes: string[];
  echaSummary: string | null;
}

export interface Nfpa704Diamond {
  health: number | null;
  flammability: number | null;
  instability: number | null;
  special: string | null;
}

export interface PubChemHazardBundle {
  found: boolean;
  props: PubChemCompoundProps | null;
  synonyms: PubChemSynonymsSummary;
  ghs: ParsedGhsClassification;
  nfpa: Nfpa704Diamond | null;
  sources: string[];
  degraded?: boolean;
}

function collectInfoItems(
  node: unknown,
  out: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  if (!node || typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.Information)) {
    for (const info of obj.Information) {
      if (info && typeof info === "object") {
        out.push(info as Record<string, unknown>);
      }
    }
  }
  if (Array.isArray(obj.Section)) {
    for (const sec of obj.Section) {
      collectInfoItems(sec, out);
    }
  }
  return out;
}

export function parsePubChemGhsView(raw: unknown): ParsedGhsClassification {
  const record = (raw as { Record?: unknown } | null)?.Record;
  if (!record || typeof record !== "object") {
    throw new UpstreamError("PUBCHEM", "PUBCHEM_BAD_GHS_SCHEMA", "Invalid PubChem GHS payload");
  }

  const infos = collectInfoItems(record);
  const pictogramMap = new Map<string, string>();
  const hazardMap = new Map<string, string>();
  const pCodeSet = new Set<string>();
  let signalWord: "Danger" | "Warning" | "None" = "None";
  let explicitlyNotClassified = false;
  let echaSummary: string | null = null;

  for (const info of infos) {
    const name = typeof info.Name === "string" ? info.Name.trim() : "";
    const valObj = info.Value as { StringWithMarkup?: Array<Record<string, unknown>> } | undefined;
    const swm = Array.isArray(valObj?.StringWithMarkup) ? valObj.StringWithMarkup : [];

    if (name === "Pictogram(s)") {
      for (const item of swm) {
        if (!item || typeof item !== "object") continue;
        const markups = Array.isArray(item.Markup) ? item.Markup : [];
        for (const m of markups) {
          if (!m || typeof m !== "object") continue;
          const mo = m as Record<string, unknown>;
          const url = typeof mo.URL === "string" ? mo.URL : "";
          const ghsMatch = /(GHS0[1-9])\.svg/i.exec(url);
          if (ghsMatch?.[1]) {
            const code = ghsMatch[1].toUpperCase();
            const extra = typeof mo.Extra === "string" && mo.Extra.trim() ? mo.Extra.trim() : null;
            if (!pictogramMap.has(code)) {
              pictogramMap.set(code, extra ?? PICTOGRAM_LABELS[code] ?? code);
            }
          }
        }
      }
    } else if (name === "Signal") {
      for (const item of swm) {
        if (!item || typeof item !== "object") continue;
        const s = typeof item.String === "string" ? item.String.trim().toLowerCase() : "";
        if (s.includes("danger")) {
          signalWord = "Danger";
        } else if (s.includes("warning") && signalWord !== "Danger") {
          signalWord = "Warning";
        }
      }
    } else if (name === "GHS Hazard Statements") {
      for (const item of swm) {
        if (!item || typeof item !== "object") continue;
        const rawStr = typeof item.String === "string" ? item.String.trim() : "";
        if (/^not\s+classified$/i.test(rawStr)) {
          explicitlyNotClassified = true;
          continue;
        }
        const hMatch = /^(H\d{3}[A-Za-z0-9+\s]*?)\s*(?:\([^)]*\))?\s*:\s*(.+)$/.exec(rawStr);
        if (hMatch?.[1] && hMatch[2]) {
          const code = hMatch[1].replace(/\s+/g, "").toUpperCase();
          const cleaned = hMatch[2]
            .replace(/\s*\[[^\]]*\]\s*$/, "")
            .replace(/\s+/g, " ")
            .trim();
          if (!hazardMap.has(code) && cleaned.length > 0) {
            hazardMap.set(code, cleaned);
          }
        }
      }
    } else if (name === "Precautionary Statement Codes") {
      for (const item of swm) {
        if (!item || typeof item !== "object") continue;
        const rawStr = typeof item.String === "string" ? item.String : "";
        const matches = rawStr.match(/P\d{3}(?:\+P\d{3})*/g);
        if (matches) {
          for (const p of matches) {
            pCodeSet.add(p);
          }
        }
      }
    } else if (name === "ECHA C&L Notifications Summary" || name === "Note") {
      for (const item of swm) {
        if (!item || typeof item !== "object") continue;
        const s = typeof item.String === "string" ? item.String.trim() : "";
        if (name === "ECHA C&L Notifications Summary" && !echaSummary && s.length > 0) {
          echaSummary = s.split(/(?<=\.)\s+/)[0] ?? s;
        }
        if (/does not meet GHS hazard criteria for (?:9\d|100)(?:\.\d+)?%/i.test(s)) {
          explicitlyNotClassified = true;
          if (!echaSummary) echaSummary = s;
        }
      }
    }
  }

  const pictograms = [...pictogramMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, label]) => ({ code, label }));
  const hazardStatements = [...hazardMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, statement]) => ({ code, statement }));
  const precautionaryCodes = [...pCodeSet].sort().slice(0, 20);

  return {
    sectionFound: true,
    explicitlyNotClassified,
    signalWord,
    pictograms,
    hazardStatements,
    precautionaryCodes,
    echaSummary,
  };
}

export function parsePubChemNfpaView(raw: unknown): Nfpa704Diamond | null {
  const record = (raw as { Record?: unknown } | null)?.Record;
  if (!record || typeof record !== "object") return null;

  const infos = collectInfoItems(record);
  let health: number | null = null;
  let flammability: number | null = null;
  let instability: number | null = null;
  let special: string | null = null;

  for (const info of infos) {
    const name = typeof info.Name === "string" ? info.Name.trim() : "";
    const valObj = info.Value as
      | {
          StringWithMarkup?: Array<Record<string, unknown>>;
          Number?: unknown[];
        }
      | undefined;
    const swm = Array.isArray(valObj?.StringWithMarkup) ? valObj.StringWithMarkup : [];
    const firstStr = typeof swm[0]?.String === "string" ? swm[0].String.trim() : "";
    const firstNum = Array.isArray(valObj?.Number) ? toFiniteNumber(valObj?.Number[0]) : null;

    const parseRating = (s: string, n: number | null): number | null => {
      if (n !== null && Number.isInteger(n) && n >= 0 && n <= 4) return n;
      const m = /^([0-4])\b/.exec(s);
      return m ? Number(m[1]) : null;
    };

    if (name === "NFPA 704 Diamond") {
      for (const item of swm) {
        if (!item || typeof item !== "object") continue;
        const markups = Array.isArray(item.Markup) ? item.Markup : [];
        for (const m of markups) {
          const extra =
            typeof (m as Record<string, unknown>)?.Extra === "string"
              ? String((m as Record<string, unknown>).Extra)
              : "";
          const parts = extra.split("-");
          if (parts.length >= 3) {
            const h = toFiniteNumber(parts[0]);
            const f = toFiniteNumber(parts[1]);
            const r = toFiniteNumber(parts[2]);
            if (h !== null && h >= 0 && h <= 4) health = h;
            if (f !== null && f >= 0 && f <= 4) flammability = f;
            if (r !== null && r >= 0 && r <= 4) instability = r;
            if (parts[3]?.trim()) special = parts[3].trim();
          }
        }
      }
    } else if (/NFPA\s+Health/i.test(name) && health === null) {
      health = parseRating(firstStr, firstNum);
    } else if (/NFPA\s+Fire|NFPA\s+Flammab/i.test(name) && flammability === null) {
      flammability = parseRating(firstStr, firstNum);
    } else if (/NFPA\s+Instability|NFPA\s+Reactivity/i.test(name) && instability === null) {
      instability = parseRating(firstStr, firstNum);
    } else if (/NFPA\s+Special/i.test(name) && !special && firstStr) {
      special = firstStr.slice(0, 16);
    }
  }

  if (health === null && flammability === null && instability === null) {
    return null;
  }
  return { health, flammability, instability, special };
}

export function parsePubChemSynonyms(raw: unknown, title: string): PubChemSynonymsSummary {
  const list = (
    raw as { InformationList?: { Information?: Array<{ Synonym?: unknown[] }> } } | null
  )?.InformationList?.Information?.[0]?.Synonym;

  if (!Array.isArray(list)) {
    return { casRn: null, ecNumber: null, synonyms: [] };
  }

  let casRn: string | null = null;
  let ecNumber: string | null = null;
  const synonyms: string[] = [];
  const lowerTitle = title.toLowerCase();

  for (const rawItem of list) {
    if (typeof rawItem !== "string") continue;
    const s = rawItem.trim();
    if (!s) continue;

    if (casRn === null && CAS_CANDIDATE_REGEX.test(s) && isValidCasRegistryNumber(s)) {
      casRn = s;
      continue;
    }
    if (ecNumber === null && EC_NUMBER_REGEX.test(s)) {
      ecNumber = s;
      continue;
    }

    if (
      synonyms.length < 5 &&
      s.length >= 3 &&
      s.length <= 48 &&
      s.toLowerCase() !== lowerTitle &&
      !/^(?:DTXSID|CHEMBL|CHEBI|UNII|EINECS|NSC|HSDB|MFCD|AKOS|ZINC|EC\s)/i.test(s) &&
      !/^\d+-\d+-\d+$/.test(s) &&
      /^[A-Za-z0-9][A-Za-z0-9\s,()\-']+$/.test(s)
    ) {
      if (!synonyms.some((existing) => existing.toLowerCase() === s.toLowerCase())) {
        synonyms.push(s);
      }
    }
  }

  return { casRn, ecNumber, synonyms };
}

function buildPropsUrl(input: ChemHazardInput): string {
  if (input.kind === "cid") {
    return `${PUBCHEM_PUG}/compound/cid/${encodeURIComponent(input.normalizedValue)}/property/${PROPERTY_LIST}/JSON`;
  }
  if (input.kind === "inchikey") {
    return `${PUBCHEM_PUG}/compound/inchikey/${encodeURIComponent(input.normalizedValue)}/property/${PROPERTY_LIST}/JSON`;
  }
  return `${PUBCHEM_PUG}/compound/name/${encodeURIComponent(input.rawQuery)}/property/${PROPERTY_LIST}/JSON`;
}

export async function fetchPubChemHazardBundle(
  input: ChemHazardInput,
  cache: BoundedTtlCache,
  fetchImpl: typeof fetch = fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<{ data: PubChemHazardBundle; cacheHit: boolean }> {
  const queryCacheKey = `chem:pubchem:${input.kind}:${input.normalizedValue}`;

  const { value, cacheHit } = await withTwoTierCache<PubChemHazardBundle>({
    key: queryCacheKey,
    ttlMs: TTL_MS.CHEM_PUBCHEM,
    cache,
    waitUntil,
    shouldCache: (b) => !b.degraded,
    fetcher: async () => {
      const propsRes = await fetchJsonWithTimeout<{
        PropertyTable?: { Properties?: Array<Record<string, unknown>> };
      }>(buildPropsUrl(input), {
        provider: "PUBCHEM",
        allow404: true,
        timeoutMs: 5500,
        fetchImpl,
      });

      if (propsRes.status === "not_found") {
        return {
          found: false,
          props: null,
          synonyms: { casRn: null, ecNumber: null, synonyms: [] },
          ghs: {
            sectionFound: false,
            explicitlyNotClassified: false,
            signalWord: "None",
            pictograms: [],
            hazardStatements: [],
            precautionaryCodes: [],
            echaSummary: null,
          },
          nfpa: null,
          sources: ["nih_pubchem_pug"],
        };
      }

      const firstProp = propsRes.data?.PropertyTable?.Properties?.[0];
      const cidNum = toFiniteNumber(firstProp?.CID);
      if (!firstProp || cidNum === null || !Number.isInteger(cidNum) || cidNum <= 0) {
        throw new UpstreamError(
          "PUBCHEM",
          "PUBCHEM_BAD_PROPS_SCHEMA",
          "Invalid PubChem PropertyTable response",
        );
      }

      const title =
        typeof firstProp.Title === "string" && firstProp.Title.trim().length > 0
          ? firstProp.Title.trim()
          : input.rawQuery;
      const props: PubChemCompoundProps = {
        cid: cidNum,
        title,
        iupacName: typeof firstProp.IUPACName === "string" ? firstProp.IUPACName.trim() : null,
        molecularFormula:
          typeof firstProp.MolecularFormula === "string" ? firstProp.MolecularFormula.trim() : null,
        molecularWeight: roundToOrNull(toFiniteNumber(firstProp.MolecularWeight) ?? Number.NaN, 4),
        smiles:
          typeof firstProp.ConnectivitySMILES === "string"
            ? firstProp.ConnectivitySMILES.trim()
            : typeof firstProp.SMILES === "string"
              ? firstProp.SMILES.trim()
              : typeof firstProp.CanonicalSMILES === "string"
                ? firstProp.CanonicalSMILES.trim()
                : null,
        inchikey: typeof firstProp.InChIKey === "string" ? firstProp.InChIKey.trim() : null,
        xlogp: roundToOrNull(toFiniteNumber(firstProp.XLogP) ?? Number.NaN, 3),
      };

      let degraded = false;
      let nfpaError: unknown = null;
      // Fetch GHS (primary safety gate), synonyms (CAS/EC), and NFPA 704 (optional) in parallel
      const [ghsRes, synSettled, nfpaSettled] = await Promise.all([
        fetchJsonWithTimeout<unknown>(
          `${PUBCHEM_PUG_VIEW}/${cidNum}/JSON?heading=GHS+Classification`,
          {
            provider: "PUBCHEM",
            allow404: true,
            timeoutMs: 6000,
            fetchImpl,
          },
        ),
        fetchJsonWithTimeout<unknown>(`${PUBCHEM_PUG}/compound/cid/${cidNum}/synonyms/JSON`, {
          provider: "PUBCHEM",
          allow404: true,
          timeoutMs: 4500,
          fetchImpl,
        }).catch(() => {
          degraded = true;
          return { status: "not_found" as const };
        }),
        fetchJsonWithTimeout<unknown>(
          `${PUBCHEM_PUG_VIEW}/${cidNum}/JSON?heading=NFPA+Hazard+Classification`,
          {
            provider: "PUBCHEM",
            allow404: true,
            timeoutMs: 4500,
            fetchImpl,
          },
        ).catch((err) => {
          degraded = true;
          nfpaError = err;
          return { status: "not_found" as const };
        }),
      ]);

      const sources = ["nih_pubchem_pug"];
      let ghs: ParsedGhsClassification;
      if (ghsRes.status === "ok") {
        sources.push("nih_pubchem_ghs");
        ghs = parsePubChemGhsView(ghsRes.data);
      } else {
        if (nfpaError !== null) {
          throw nfpaError instanceof UpstreamError
            ? nfpaError
            : new UpstreamError(
                "PUBCHEM",
                "PUBCHEM_UNAVAILABLE",
                "PubChem safety views unavailable",
              );
        }
        ghs = {
          sectionFound: false,
          explicitlyNotClassified: false,
          signalWord: "None",
          pictograms: [],
          hazardStatements: [],
          precautionaryCodes: [],
          echaSummary: null,
        };
      }

      const synonyms: PubChemSynonymsSummary =
        synSettled.status === "ok"
          ? parsePubChemSynonyms(synSettled.data, title)
          : {
              casRn: input.kind === "cas" ? input.normalizedValue : null,
              ecNumber: null,
              synonyms: [],
            };

      if (synonyms.casRn === null && input.kind === "cas") {
        synonyms.casRn = input.normalizedValue;
      }

      const nfpa = nfpaSettled.status === "ok" ? parsePubChemNfpaView(nfpaSettled.data) : null;
      if (nfpa !== null) {
        sources.push("nih_pubchem_nfpa");
      }

      return {
        found: true,
        props,
        synonyms,
        ghs,
        nfpa,
        sources,
        degraded,
      };
    },
  });

  return { data: value, cacheHit };
}
