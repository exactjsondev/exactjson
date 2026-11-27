import { RESEARCH_DISCLAIMER } from "../../../config/catalog/research";
import type { PubChemHazardBundle } from "../providers/pubchemFeeds";

const CMR_CODES = new Set([
  "H340",
  "H341",
  "H350",
  "H350I",
  "H351",
  "H360",
  "H360D",
  "H360F",
  "H360FD",
  "H361",
  "H361D",
  "H361F",
  "H361FD",
]);

const ACUTE_FATAL_CODES = new Set(["H300", "H310", "H330", "H301", "H311", "H331"]);
const FLAMMABLE_CODES = new Set([
  "H220",
  "H221",
  "H222",
  "H224",
  "H225",
  "H226",
  "H227",
  "H228",
  "H250",
  "H251",
  "H252",
  "H260",
  "H261",
]);
const OXIDIZER_EXPLOSIVE_CODES = new Set([
  "H200",
  "H201",
  "H202",
  "H203",
  "H204",
  "H205",
  "H240",
  "H241",
  "H242",
  "H270",
  "H271",
  "H272",
]);
const CORROSIVE_CODES = new Set(["H290", "H314", "H318"]);

function baseHCode(code: string): string {
  const m = /^(H\d{3})/.exec(code.toUpperCase());
  return m?.[1] ?? code.toUpperCase();
}

export function computeChemHazardProfile(params: {
  bundle: PubChemHazardBundle;
  nowMs?: number;
}) {
  const { bundle, nowMs = Date.now() } = params;
  if (!bundle.found || !bundle.props) {
    throw new Error("computeChemHazardProfile requires a resolved PubChem compound");
  }

  const { props, synonyms, ghs, nfpa } = bundle;
  const pictogramCodes = new Set(ghs.pictograms.map((p) => p.code));
  const rawCodes = ghs.hazardStatements.map((h) => h.code.toUpperCase());
  const componentCodes = rawCodes.flatMap((c) => c.split("+").filter(Boolean));
  const baseCodes = new Set(componentCodes.map(baseHCode));

  const cmr = componentCodes.some((c) => CMR_CODES.has(c) || CMR_CODES.has(baseHCode(c)));
  const acuteFatal =
    pictogramCodes.has("GHS06") || [...baseCodes].some((c) => ACUTE_FATAL_CODES.has(c));
  const flammable =
    pictogramCodes.has("GHS02") ||
    [...baseCodes].some((c) => FLAMMABLE_CODES.has(c)) ||
    (nfpa?.flammability ?? 0) >= 3;
  const oxidizerOrExplosive =
    pictogramCodes.has("GHS01") ||
    pictogramCodes.has("GHS03") ||
    [...baseCodes].some((c) => OXIDIZER_EXPLOSIVE_CODES.has(c));
  const corrosive =
    pictogramCodes.has("GHS05") || [...baseCodes].some((c) => CORROSIVE_CODES.has(c));
  const environmental =
    pictogramCodes.has("GHS09") || [...baseCodes].some((c) => c.startsWith("H4"));

  const classified =
    ghs.hazardStatements.length > 0 ||
    ghs.pictograms.length > 0 ||
    ghs.signalWord !== "None";
  const flags: string[] = [];

  if (ghs.signalWord === "Danger") flags.push("GHS_DANGER");
  else if (ghs.signalWord === "Warning") flags.push("GHS_WARNING");

  if (cmr) flags.push("CMR_HAZARD_H340_H350_H360");
  if (acuteFatal) flags.push("ACUTE_TOXICITY_HAZARD");
  if (flammable) {
    flags.push(
      baseCodes.has("H224") ||
        baseCodes.has("H225") ||
        baseCodes.has("H220") ||
        (nfpa?.flammability ?? 0) >= 4
        ? "HIGH_FLAMMABILITY"
        : "FLAMMABLE_MATERIAL"
    );
  }
  if (oxidizerOrExplosive) flags.push("OXIDIZER_OR_EXPLOSIVE_HAZARD");
  if (corrosive) flags.push("CORROSIVE_HAZARD");
  if (environmental) flags.push("AQUATIC_ENVIRONMENTAL_HAZARD");

  if (!classified) {
    if (ghs.explicitlyNotClassified) {
      flags.push("GHS_NOT_CLASSIFIED_MAJORITY");
    } else {
      flags.push("UNCLASSIFIED_GHS_CHECK_SDS");
    }
  }

  let hazardTier: "EXTREME" | "HIGH" | "MODERATE" | "LOW" | "UNCLASSIFIED";
  if (
    cmr ||
    baseCodes.has("H300") ||
    baseCodes.has("H310") ||
    baseCodes.has("H330") ||
    baseCodes.has("H200") ||
    baseCodes.has("H201") ||
    baseCodes.has("H250") ||
    (nfpa?.health ?? 0) >= 4 ||
    (nfpa?.flammability ?? 0) >= 4
  ) {
    hazardTier = "EXTREME";
  } else if (
    ghs.signalWord === "Danger" ||
    acuteFatal ||
    corrosive ||
    oxidizerOrExplosive ||
    (nfpa?.health ?? 0) >= 3 ||
    (nfpa?.flammability ?? 0) >= 3
  ) {
    hazardTier = "HIGH";
  } else if (!classified) {
    hazardTier = ghs.explicitlyNotClassified ? "LOW" : "UNCLASSIFIED";
  } else if (ghs.signalWord === "Warning" || ghs.hazardStatements.length > 0) {
    hazardTier = "MODERATE";
  } else {
    hazardTier = "LOW";
  }

  return {
    compound: {
      cid: props.cid,
      name: props.title,
      iupac_name: props.iupacName,
      cas_rn: synonyms.casRn,
      ec_number: synonyms.ecNumber,
      molecular_formula: props.molecularFormula,
      molecular_weight_g_mol: props.molecularWeight,
      smiles: props.smiles,
      inchikey: props.inchikey,
      xlogp: props.xlogp,
      synonyms: synonyms.synonyms,
      pubchem_url: `https://pubchem.ncbi.nlm.nih.gov/compound/${props.cid}`,
    },
    hazard_tier: hazardTier,
    ghs: {
      classified,
      signal_word: ghs.signalWord,
      pictograms: ghs.pictograms,
      hazard_statements: ghs.hazardStatements.slice(0, 18),
      precautionary_codes: ghs.precautionaryCodes,
      echa_report_summary: ghs.echaSummary,
    },
    nfpa_704: nfpa,
    regulatory_flags: {
      cmr_carcinogen_mutagen_reprotoxic: cmr,
      acute_toxic_fatal: acuteFatal,
      flammable,
      oxidizer_or_explosive: oxidizerOrExplosive,
      corrosive,
      environmental_hazard: environmental,
    },
    flags,
    metadata: {
      fetched_at: new Date(nowMs).toISOString(),
      sources: bundle.sources,
      disclaimer: RESEARCH_DISCLAIMER,
    },
  };
}
