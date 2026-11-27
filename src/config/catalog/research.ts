import type { EndpointCatalogEntry, PackDefinition } from "./types";

export const RESEARCH_DISCLAIMER =
  "Informational scientific/clinical metadata only; not medical or safety advice." as const;

export const RESEARCH_PACK: PackDefinition = {
  id: "research",
  title: "Scientific Citations, Chemical GHS Hazards & Clinical Trials",
  subtitle:
    "Crossref + DataCite + Retraction Watch citation verification, NIH PubChem GHS toxicity profiles, and ClinicalTrials.gov + RxNorm catalyst briefs.",
  shortDescription:
    "DOI/citation hallucination & retraction checks, PubChem GHS chemical safety, and clinical trial briefs.",
  mcpPath: "/mcp/research",
  disclaimer: RESEARCH_DISCLAIMER,
  workflows: [
    "Before citing academic papers or arXiv preprints, call exactjson_science_citation_verify ($0.005) to catch hallucinated DOIs, Retraction Watch retractions, and swapped-DOI metadata mismatches.",
    "Before evaluating biotech/pharma catalysts or laboratory chemical handling, call exactjson_bio_drug_trial_brief ($0.015) or exactjson_chem_hazard_profile ($0.01).",
  ],
};

export const RESEARCH_CATALOG: readonly EndpointCatalogEntry[] = [
  {
    id: "science_citation_verify",
    pack: "research",
    method: "GET",
    path: "/v1/science/citation-verify",
    routeKey: "GET /v1/science/citation-verify",
    summary:
      "Academic DOI, arXiv preprint & bibliographic citation hallucination, retraction & metadata check",
    description: `Verify academic DOIs, arXiv preprints, and bibliographic citations via Crossref Polite Pool, DataCite, and embedded Retraction Watch updates: existence, retractions, expressions of concern, citation counts, and title/author/year mismatch flags. Do NOT use for full-text paper scraping or clinical trial status (use exactjson_bio_drug_trial_brief). ${RESEARCH_DISCLAIMER}`,
    tags: ["research", "science", "citations", "doi", "arxiv", "retractions"],
    priceAmount: "0.005",
    priceFormatted: "$0.005",
    priceUsd: 0.005,
    queryParamName: "doi",
    queryParamDescription:
      "Academic DOI (10.xxxx/...), https://doi.org/... URL, or arXiv ID (e.g., 10.1038/s41586-021-03819-2 or arXiv:1706.03762); or omit doi and pass query.",
    queryParamExample: "10.1038/s41586-021-03819-2",
    exampleQueryParams: {
      doi: "10.1038/s41586-021-03819-2",
    },
    inputSchema: {
      type: "object",
      properties: {
        doi: {
          type: "string",
          minLength: 7,
          maxLength: 220,
          description:
            "Academic DOI (10.xxxx/...), https://doi.org/... URL, or arXiv ID (e.g., 10.1038/s41586-021-03819-2, 10.48550/arXiv.1706.03762, or arXiv:1706.03762). Provide at least one of doi or query.",
          example: "10.1038/s41586-021-03819-2",
        },
        query: {
          type: "string",
          minLength: 4,
          maxLength: 240,
          description:
            "Optional bibliographic citation string or paper title when DOI is unknown (e.g., 'Attention Is All You Need Vaswani 2017').",
          example: "Highly accurate protein structure prediction with AlphaFold Jumper 2021",
        },
        expected_title: {
          type: "string",
          minLength: 3,
          maxLength: 240,
          description:
            "Optional claimed paper title to cross-check against the registered DOI record (detects swapped-DOI hallucinations).",
          example: "Highly accurate protein structure prediction with AlphaFold",
        },
        expected_author: {
          type: "string",
          minLength: 2,
          maxLength: 80,
          description: "Optional claimed author surname to verify against registered authors.",
          example: "Jumper",
        },
        expected_year: {
          type: "string",
          mcpType: "integer",
          minimum: 1665,
          maximum: 2100,
          description:
            "Optional claimed publication year (integer 1665-2100; +/-1 year print/online tolerance).",
          example: "2021",
        },
      },
      required: [],
    },
    outputExample: {
      query: {
        mode: "doi",
        requested_doi: "10.1038/s41586-021-03819-2",
        query: null,
        expected_title: null,
        expected_author: null,
        expected_year: null,
      },
      exists: true,
      verdict: "VERIFIED",
      integrity: {
        is_retracted: false,
        is_retraction_notice: false,
        has_expression_of_concern: false,
        has_correction: false,
        updates: [],
      },
      metadata_check: {
        checked: false,
        title_match: null,
        title_token_overlap: null,
        author_match: null,
        year_match: null,
        year_delta: null,
      },
      work: {
        doi: "10.1038/s41586-021-03819-2",
        url: "https://doi.org/10.1038/s41586-021-03819-2",
        registry: "crossref",
        title: "Highly accurate protein structure prediction with AlphaFold",
        work_type: "journal-article",
        container_title: "Nature",
        publisher: "Springer Science and Business Media LLC",
        published_year: 2021,
        published_date: "2021-07-15",
        author_count: 34,
        authors: ["John Jumper", "Richard Evans", "Alexander Pritzel", "Tim Green"],
        citation_count: 47809,
        license_url: "https://creativecommons.org/licenses/by/4.0",
      },
      flags: [],
      metadata: {
        fetched_at: "2026-11-27T20:00:00.000Z",
        sources: ["crossref"],
        disclaimer: RESEARCH_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "query",
        "exists",
        "verdict",
        "integrity",
        "metadata_check",
        "work",
        "flags",
        "metadata",
      ],
      properties: {
        query: { type: "object" },
        exists: { type: "boolean" },
        verdict: {
          type: "string",
          enum: [
            "VERIFIED",
            "RETRACTED",
            "EXPRESSION_OF_CONCERN",
            "METADATA_MISMATCH",
            "LOW_CONFIDENCE_QUERY_MATCH",
            "NOT_FOUND",
          ],
        },
        integrity: { type: "object" },
        metadata_check: { type: "object" },
        work: { type: ["object", "null"] },
        flags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "chem_hazard_profile",
    pack: "research",
    method: "GET",
    path: "/v1/chem/hazard-profile",
    routeKey: "GET /v1/chem/hazard-profile",
    summary:
      "NIH PubChem chemical GHS hazard pictograms, H/P-statements, CAS RN, CMR flags & NFPA 704 profile",
    description: `Distill NIH PubChem compound properties, GHS hazard classifications, signal words, H/P-codes, pictograms, CAS Registry Numbers, and NFPA 704 ratings into a compact chemical safety and CMR/flammability/aquatic risk gate. Do NOT use for consumer product recalls (use exactjson_consumer_safety_recall) or clinical drug trials (use exactjson_bio_drug_trial_brief). ${RESEARCH_DISCLAIMER}`,
    tags: ["research", "chemistry", "pubchem", "ghs", "cas", "safety"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "query",
    queryParamDescription:
      "Chemical name, CAS Registry Number (checksum-validated), PubChem CID, or InChIKey (e.g., 71-43-2, benzene, acetone, 241).",
    queryParamExample: "71-43-2",
    exampleQueryParams: {
      query: "71-43-2",
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "Chemical common/IUPAC name, CAS Registry Number (e.g., 71-43-2, 67-64-1), PubChem CID (e.g., 241 or CID:241), or 27-char InChIKey.",
          example: "71-43-2",
        },
      },
      required: ["query"],
    },
    outputExample: {
      compound: {
        cid: 241,
        name: "Benzene",
        iupac_name: "benzene",
        cas_rn: "71-43-2",
        ec_number: "200-753-7",
        molecular_formula: "C6H6",
        molecular_weight_g_mol: 78.11,
        smiles: "C1=CC=CC=C1",
        inchikey: "UHOVQNZJYSORNB-UHFFFAOYSA-N",
        xlogp: 2.1,
        synonyms: ["benzol", "cyclohexatriene"],
        pubchem_url: "https://pubchem.ncbi.nlm.nih.gov/compound/241",
      },
      hazard_tier: "EXTREME",
      ghs: {
        classified: true,
        signal_word: "Danger",
        pictograms: [
          { code: "GHS02", label: "Flammable" },
          { code: "GHS07", label: "Irritant" },
          { code: "GHS08", label: "Health Hazard" },
        ],
        hazard_statements: [
          { code: "H225", statement: "Highly Flammable liquid and vapor" },
          { code: "H340", statement: "May cause genetic defects" },
          { code: "H350", statement: "May cause cancer" },
          {
            code: "H372",
            statement: "Causes damage to organs through prolonged or repeated exposure",
          },
        ],
        precautionary_codes: ["P203", "P210", "P240", "P260", "P280", "P301+P316", "P318"],
        echa_report_summary:
          "Aggregated GHS information provided per 1934 reports by companies from 47 notifications to the ECHA C&L Inventory.",
      },
      nfpa_704: {
        health: 2,
        flammability: 3,
        instability: 0,
        special: null,
      },
      regulatory_flags: {
        cmr_carcinogen_mutagen_reprotoxic: true,
        acute_toxic_fatal: false,
        flammable: true,
        oxidizer_or_explosive: false,
        corrosive: false,
        environmental_hazard: false,
      },
      flags: ["GHS_DANGER", "CMR_HAZARD_H340_H350_H360", "HIGH_FLAMMABILITY"],
      metadata: {
        fetched_at: "2026-11-27T20:00:00.000Z",
        sources: ["nih_pubchem_pug", "nih_pubchem_ghs", "nih_pubchem_nfpa"],
        disclaimer: RESEARCH_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "compound",
        "hazard_tier",
        "ghs",
        "nfpa_704",
        "regulatory_flags",
        "flags",
        "metadata",
      ],
      properties: {
        compound: { type: "object" },
        hazard_tier: {
          type: "string",
          enum: ["EXTREME", "HIGH", "MODERATE", "LOW", "UNCLASSIFIED"],
        },
        ghs: { type: "object" },
        nfpa_704: { type: ["object", "null"] },
        regulatory_flags: { type: "object" },
        flags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "bio_drug_trial_brief",
    pack: "research",
    method: "GET",
    path: "/v1/bio/drug-trial-brief",
    routeKey: "GET /v1/bio/drug-trial-brief",
    summary:
      "ClinicalTrials.gov Phase 2/3 primary completion catalysts & NIH RxNav/RxNorm drug class brief",
    description: `Track active Phase 2/3 clinical trial primary completion catalysts, sponsor classes, enrollment, and endpoints via ClinicalTrials.gov v2 paired with NIH RxNav/RxNorm normalized drug ingredients and ATC/SNOMED classes. Do NOT use for FDA product recalls (use exactjson_consumer_safety_recall) or academic DOI retraction checks (use exactjson_science_citation_verify). ${RESEARCH_DISCLAIMER}`,
    tags: ["research", "biotech", "clinical-trials", "rxnorm", "pharma", "catalysts"],
    priceAmount: "0.015",
    priceFormatted: "$0.015",
    priceUsd: 0.015,
    queryParamName: "drug",
    queryParamDescription:
      "Drug generic/brand/code name or NCT ID (e.g., semaglutide, pembrolizumab, NCT05382286); or pass nct / condition.",
    queryParamExample: "semaglutide",
    exampleQueryParams: {
      drug: "semaglutide",
    },
    inputSchema: {
      type: "object",
      properties: {
        drug: {
          type: "string",
          minLength: 2,
          maxLength: 120,
          description:
            "Drug generic name, brand name, investigational code, or NCT ID (e.g., semaglutide, Ozempic, orforglipron). Provide at least one of drug, nct, or condition.",
          example: "semaglutide",
        },
        nct: {
          type: "string",
          pattern: "^[Nn][Cc][Tt]\\d{8}$",
          description: "Optional exact ClinicalTrials.gov identifier (e.g., NCT05382286).",
          example: "NCT05382286",
        },
        condition: {
          type: "string",
          minLength: 2,
          maxLength: 120,
          description: "Optional disease or indication filter (e.g., obesity, MASH, NSCLC).",
          example: "obesity",
        },
        phase: {
          type: "string",
          enum: ["PHASE2_3", "PHASE3", "PHASE2", "PHASE1", "PHASE4", "ALL"],
          description:
            "Optional trial phase filter (default PHASE2_3 for pivotal/mid-stage catalysts).",
          example: "PHASE2_3",
        },
        limit: {
          type: "string",
          mcpType: "integer",
          minimum: 1,
          maximum: 15,
          description: "Optional max upcoming catalyst trials to return (1-15, default 8).",
          example: "8",
        },
      },
      required: [],
    },
    outputExample: {
      query: {
        drug: "semaglutide",
        nct: null,
        condition: null,
        phase_scope: "PHASE2_3",
        limit: 8,
      },
      drug_normalization: {
        normalized: true,
        rxcui: "1991302",
        preferred_name: "semaglutide",
        tty: "IN",
        brand_names: ["Ozempic", "Rybelsus", "Wegovy"],
        atc_classes: [{ code: "A10BJ", name: "Glucagon-like peptide-1 (GLP-1) analogues" }],
        mechanism_or_pharmacologic_classes: [
          "Glucagon-like peptide 1 receptor agonist-containing product",
        ],
        contraindications: ["Drug Hypersensitivity", "Thyroid Neoplasms"],
      },
      pipeline_summary: {
        total_matching_active_trials: 149,
        sampled_trials: 50,
        phase3_count: 24,
        phase2_count: 26,
        industry_sponsored_count: 29,
        upcoming_catalysts_12m_count: 14,
        overdue_unupdated_count: 5,
        nearest_primary_completion_date: "2026-12",
      },
      upcoming_catalysts: [
        {
          nct_id: "NCT05067621",
          brief_title: "Semaglutide in Metabolic Liver Disease",
          overall_status: "ACTIVE_NOT_RECRUITING",
          phases: ["PHASE2"],
          sponsor_name: "Novo Nordisk A/S",
          sponsor_class: "INDUSTRY",
          enrollment: 240,
          start_date: "2024-03-15",
          primary_completion_date: "2026-12",
          primary_completion_type: "ESTIMATED",
          days_to_primary_completion: 34,
          conditions: ["MASH", "Obesity"],
          interventions: ["Semaglutide"],
          primary_outcome: "Change in liver fat content at Week 52",
          has_results: false,
          last_update_posted: "2026-10-18",
          url: "https://clinicaltrials.gov/study/NCT05067621",
        },
      ],
      flags: ["IMMINENT_PRIMARY_COMPLETION_90D", "ACTIVE_PHASE3_PROGRAM"],
      metadata: {
        fetched_at: "2026-11-27T20:00:00.000Z",
        sources: ["clinicaltrials_gov_v2", "nih_rxnav"],
        disclaimer: RESEARCH_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "query",
        "drug_normalization",
        "pipeline_summary",
        "upcoming_catalysts",
        "flags",
        "metadata",
      ],
      properties: {
        query: { type: "object" },
        drug_normalization: { type: ["object", "null"] },
        pipeline_summary: { type: "object" },
        upcoming_catalysts: { type: "array", items: { type: "object" } },
        flags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
    },
  },
] as const;
