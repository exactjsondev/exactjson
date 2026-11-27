import type { EndpointCatalogEntry, PackDefinition } from "./types";

export const COMMERCE_DISCLAIMER =
  "Informational entity/compliance data only; not legal, tax, or accounting advice." as const;

export const COMMERCE_PACK: PackDefinition = {
  id: "commerce",
  title: "Cross-Border Settlement, VAT, Corporate KYB & Consumer Recalls",
  subtitle:
    "Mutual banking settlement day calculators with FX VaR buffers, EU VIES VAT + IBAN/BIC/LEI invoice-fraud gates, GLEIF + SEC corporate KYB, and US CPSC + openFDA recall screening.",
  shortDescription:
    "Cross-border settlement windows, EU VAT/IBAN/BIC checks, GLEIF/SEC corporate KYB, and product/FDA recall gates.",
  mcpPath: "/mcp/commerce",
  disclaimer: COMMERCE_DISCLAIMER,
  workflows: [
    "Before paying a B2B supplier invoice or wiring cross-border funds, call exactjson_entity_company_verify ($0.01), exactjson_commerce_vat_verify ($0.01), and exactjson_commerce_settlement_window ($0.01).",
    "Before approving an e-commerce product listing or resale SKU, pair exactjson_consumer_safety_recall ($0.01) with exactjson_net_domain_trust ($0.01).",
  ],
};

export const COMMERCE_CATALOG: readonly EndpointCatalogEntry[] = [
  {
    id: "commerce_settlement_window",
    pack: "commerce",
    method: "GET",
    path: "/v1/commerce/settlement-window",
    routeKey: "GET /v1/commerce/settlement-window",
    summary:
      "Cross-border T+0/T+1/T+2 mutual banking settlement window, rail flags & p95 FX volatility buffer",
    description: `Calculate mutual banking settlement dates (T+0/T+1/T+2), bank holidays, Fri-Sat/Sat-Sun weekends, ISO 4217 minor units, SEPA/CLS rails, and p95 FX volatility buffers across two countries via Nager.Date, Frankfurter ECB, and World Bank. Do NOT use for macro liquidity (use exactjson_macro_liquidity) or travel safety (use exactjson_travel_destination_brief). ${COMMERCE_DISCLAIMER}`,
    tags: ["commerce", "settlement", "fx", "banking", "treasury", "holidays"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "from",
    queryParamDescription:
      "Origin banking jurisdiction (ISO-2/ISO-3 or country name, e.g., US, GB, DE, AE, SA).",
    queryParamExample: "US",
    exampleQueryParams: {
      from: "US",
      to: "JP",
    },
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          minLength: 2,
          maxLength: 64,
          description:
            "Origin country code or name (ISO 3166-1 alpha-2/alpha-3 or English name, e.g., US, GB, DE, AE, SA).",
          example: "US",
        },
        to: {
          type: "string",
          minLength: 2,
          maxLength: 64,
          description:
            "Destination counterparty country code or name (ISO 3166-1 alpha-2/alpha-3 or English name, e.g., JP, IE, SG, SA).",
          example: "JP",
        },
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional trade/initiation date in YYYY-MM-DD UTC (defaults to current UTC date).",
          example: "2026-12-24",
        },
        tenor: {
          type: "string",
          enum: ["T+0", "T+1", "T+2"],
          description:
            "Settlement cycle in mutual banking business days (T+0 same-day, T+1 next-day, or T+2 standard spot FX/wire; defaults to T+2).",
          example: "T+2",
        },
        amount: {
          type: "string",
          mcpType: "number",
          minimum: 0.01,
          maximum: 1_000_000_000,
          description:
            "Optional notional amount in origin currency to convert and compute horizon-scaled 1-sigma / p95 FX slippage buffer.",
          example: "50000",
        },
      },
      required: ["from", "to"],
    },
    outputExample: {
      corridor: {
        from: {
          alpha2: "US",
          alpha3: "USA",
          name: "United States",
          currency: "USD",
          minor_units: 2,
          weekend_days: ["SATURDAY", "SUNDAY"],
          holiday_calendar_supported: true,
          income_level: "High income",
        },
        to: {
          alpha2: "JP",
          alpha3: "JPN",
          name: "Japan",
          currency: "JPY",
          minor_units: 0,
          weekend_days: ["SATURDAY", "SUNDAY"],
          holiday_calendar_supported: true,
          income_level: "High income",
        },
      },
      rails: {
        same_currency: false,
        sepa_corridor: false,
        cls_pvp_eligible: true,
        recommended_rail: "SWIFT_GPI_OR_CLS",
      },
      schedule: {
        initiation_date: "2026-11-27",
        tenor: "T+2",
        t0_first_mutual_open_date: "2026-11-27",
        t1_settlement_date: "2026-11-30",
        t2_settlement_date: "2026-12-01",
        selected_settlement_date: "2026-12-01",
        calendar_lag_days: 4,
        skipped_days: [
          {
            date: "2026-11-28",
            day_of_week: "SATURDAY",
            closed_in: ["US", "JP"],
            reasons: ["WEEKEND"],
          },
          {
            date: "2026-11-29",
            day_of_week: "SUNDAY",
            closed_in: ["US", "JP"],
            reasons: ["WEEKEND"],
          },
        ],
      },
      fx: {
        pair: "USD/JPY",
        rate_source: "frankfurter_ecb",
        as_of_date: "2026-11-26",
        spot_rate: 151.85,
        observations_30d: 22,
        volatility_30d_ann_pct: 9.42,
        horizon_1sigma_move_pct: 1.19,
        horizon_p95_move_pct: 1.95,
        conversion: {
          input_amount: 50000,
          input_currency: "USD",
          converted_mid_amount: 7592500,
          output_currency: "JPY",
          p95_adverse_buffer_output: 148054,
        },
      },
      flags: ["ZERO_DECIMAL_TARGET_CURRENCY"],
      metadata: {
        fetched_at: "2026-11-27T19:30:00.000Z",
        sources: ["nager_date", "frankfurter_ecb", "world_bank"],
        disclaimer: COMMERCE_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: ["corridor", "rails", "schedule", "fx", "flags", "metadata"],
      properties: {
        corridor: { type: "object" },
        rails: { type: "object" },
        schedule: { type: "object" },
        fx: { type: "object" },
        flags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "commerce_vat_verify",
    pack: "commerce",
    method: "GET",
    path: "/v1/commerce/vat-verify",
    routeKey: "GET /v1/commerce/vat-verify",
    summary:
      "Live EU-27 + XI VIES VAT verification, 90-country IBAN/SEPA check, GLEIF BIC lookup & invoice-fraud gate",
    description: `Verify live EU-27 + XI B2B VAT registration via EU Commission VIES, validate 90-country ISO 13616 IBANs (MOD 97-10 + SEPA), resolve SWIFT BIC bank entities via GLEIF, check LEI digits, and flag cross-country invoice bank-swap mismatches. Do NOT use for UK GB HMRC VAT registration or corporate ownership trees (use exactjson_entity_company_verify). ${COMMERCE_DISCLAIMER}`,
    tags: ["commerce", "vat", "vies", "iban", "bic", "lei", "invoice-fraud"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "vat",
    queryParamDescription:
      "EU-27 or Northern Ireland (XI) VAT number (e.g., IE6388047V, DE122268496, EL094019245). Optional when iban, bic, or lei is supplied.",
    queryParamExample: "IE6388047V",
    exampleQueryParams: {
      vat: "IE6388047V",
    },
    inputSchema: {
      type: "object",
      properties: {
        vat: {
          type: "string",
          minLength: 4,
          maxLength: 28,
          description:
            "EU-27 or Northern Ireland (XI) VAT number (e.g., IE6388047V, DE122268496, EL094019245; Greece GR prefix auto-normalizes to VIES EL). Supply at least one of vat, iban, bic, or lei.",
          example: "IE6388047V",
        },
        iban: {
          type: "string",
          minLength: 14,
          maxLength: 42,
          description:
            "Optional ISO 13616 International Bank Account Number across 90 countries for MOD 97-10, length, SEPA, and VAT/BIC country-mismatch verification.",
          example: "IE29AIBK93115212345678",
        },
        bic: {
          type: "string",
          minLength: 8,
          maxLength: 11,
          description:
            "Optional 8- or 11-character ISO 9362 SWIFT/BIC code resolved against GLEIF BIC-to-LEI bank registry.",
          example: "AIBKIE2DXXX",
        },
        lei: {
          type: "string",
          minLength: 20,
          maxLength: 20,
          description:
            "Optional 20-character ISO 17442 Legal Entity Identifier for MOD 97-10 check-digit verification.",
          example: "YYPPRNO5HB304LHFVG31",
        },
        country: {
          type: "string",
          minLength: 2,
          maxLength: 64,
          description:
            "Optional expected vendor ISO country code (e.g., IE, DE, GB, CH) to flag offshore IBAN/BIC bank-redirect mismatches.",
          example: "IE",
        },
      },
      required: [],
    },
    outputExample: {
      invoice_gate: "PASS",
      reverse_charge_eligible: true,
      fraud_flags: [],
      vat: {
        checked: true,
        input: "IE6388047V",
        vies_country_code: "IE",
        iso_country_code: "IE",
        vat_number: "6388047V",
        valid: true,
        vies_status: "VALID",
        registered_name: "GOOGLE IRELAND LIMITED",
        registered_address: "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4",
        checked_at: "2026-11-27T18:59:20.272Z",
      },
      iban: null,
      bic: null,
      lei: null,
      country_consistency: {
        expected_country: null,
        vat_country: "IE",
        iban_country: null,
        bic_country: null,
        all_aligned: true,
      },
      metadata: {
        fetched_at: "2026-11-27T19:30:00.000Z",
        sources: ["eu_vies"],
        disclaimer: COMMERCE_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "invoice_gate",
        "reverse_charge_eligible",
        "fraud_flags",
        "vat",
        "iban",
        "bic",
        "lei",
        "country_consistency",
        "metadata",
      ],
      properties: {
        invoice_gate: { type: "string", enum: ["PASS", "REVIEW", "FAIL"] },
        reverse_charge_eligible: { type: ["boolean", "null"] },
        fraud_flags: { type: "array", items: { type: "string" } },
        vat: { type: ["object", "null"] },
        iban: { type: ["object", "null"] },
        bic: { type: ["object", "null"] },
        lei: { type: ["object", "null"] },
        country_consistency: { type: "object" },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "entity_company_verify",
    pack: "commerce",
    method: "GET",
    path: "/v1/entity/company-verify",
    routeKey: "GET /v1/entity/company-verify",
    summary:
      "Global corporate KYB: GLEIF LEI status & ownership tree, Wikidata domain/ticker, SEC EDGAR & US federal awards",
    description: `Verify global corporate legal status, direct/ultimate parent ownership, ticker/domain, SEC EDGAR filings, and US federal contracts via GLEIF LEI (by name, LEI, BIC, or ISIN), Wikidata, SEC submissions, and USAspending. Do NOT use for OFAC/sanctions screening, EU VAT reverse-charge checks (use exactjson_commerce_vat_verify), or DNS phishing (use exactjson_net_domain_trust). ${COMMERCE_DISCLAIMER}`,
    tags: ["commerce", "kyb", "company", "lei", "gleif", "sec", "edgar", "usaspending"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "query",
    queryParamDescription:
      "Company legal/brand name (e.g., Apple Inc., Google Ireland Limited). Optional when lei, cik, bic, or isin is supplied.",
    queryParamExample: "Apple Inc.",
    exampleQueryParams: {
      query: "Apple Inc.",
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 2,
          maxLength: 120,
          description:
            "Company legal or brand name (e.g., Apple Inc., Google Ireland Limited, Palantir Technologies). Supply at least one of query, lei, cik, bic, or isin.",
          example: "Apple Inc.",
        },
        lei: {
          type: "string",
          pattern: "^[A-Za-z0-9]{20}$",
          minLength: 20,
          maxLength: 20,
          description:
            "Exact 20-character ISO 17442 Legal Entity Identifier (e.g., HWUPKR0MPOU8FGXBT394).",
          example: "HWUPKR0MPOU8FGXBT394",
        },
        cik: {
          type: "string",
          pattern: "^\\d{1,10}$",
          minLength: 1,
          maxLength: 10,
          description: "US SEC EDGAR Central Index Key (1-10 digits, e.g., 320193 or 0000320193).",
          example: "0000320193",
        },
        bic: {
          type: "string",
          minLength: 8,
          maxLength: 11,
          description: "8- or 11-character ISO 9362 SWIFT/BIC code (e.g., DEUTDEFFXXX).",
          example: "DEUTDEFFXXX",
        },
        isin: {
          type: "string",
          minLength: 12,
          maxLength: 12,
          description:
            "12-character ISO 6166 securities ISIN mapped via GLEIF/ANNA (e.g., US0378331005).",
          example: "US0378331005",
        },
        country: {
          type: "string",
          minLength: 2,
          maxLength: 64,
          description:
            "Optional ISO country code filter (e.g., US, IE, DE, GB) to disambiguate subsidiaries.",
          example: "US",
        },
      },
      required: [],
    },
    outputExample: {
      kyb_status: "VERIFIED_ACTIVE",
      risk_flags: [],
      entity: {
        legal_name: "Apple Inc.",
        lei: "HWUPKR0MPOU8FGXBT394",
        entity_status: "ACTIVE",
        lei_registration_status: "ISSUED",
        jurisdiction: "US-CA",
        country: "US",
        registered_as: "C0806592",
        legal_address: {
          city: "Cupertino",
          region: "US-CA",
          country: "US",
          postal_code: "95014",
        },
        headquarters_address: {
          city: "Cupertino",
          region: "US-CA",
          country: "US",
          postal_code: "95014",
        },
        bics: [],
        official_website: "https://www.apple.com",
        official_domain: "apple.com",
        tickers: ["AAPL"],
        wikidata_id: "Q312",
      },
      ownership: {
        is_ultimate_parent: true,
        direct_parent: null,
        ultimate_parent: null,
      },
      sec_edgar: {
        cik: "0000320193",
        sic: "3571",
        sic_description: "Electronic Computers",
        state_of_incorporation: "CA",
        ein: "942404110",
        exchanges: ["Nasdaq"],
        recent_filings: [
          {
            form: "10-K",
            filing_date: "2026-10-30",
            accession_number: "0000320193-26-000106",
          },
        ],
      },
      us_federal_contracts: {
        matched_awards_returned: 0,
        top_awards_total_usd: 0,
        top_awards: [],
      },
      metadata: {
        fetched_at: "2026-11-27T19:30:00.000Z",
        sources: ["gleif_lei", "wikidata", "sec_edgar", "usaspending"],
        disclaimer: COMMERCE_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "kyb_status",
        "risk_flags",
        "entity",
        "ownership",
        "sec_edgar",
        "us_federal_contracts",
        "metadata",
      ],
      properties: {
        kyb_status: {
          type: "string",
          enum: ["VERIFIED_ACTIVE", "ATTENTION_REQUIRED", "INACTIVE_OR_LAPSED"],
        },
        risk_flags: { type: "array", items: { type: "string" } },
        entity: { type: "object" },
        ownership: { type: "object" },
        sec_edgar: { type: ["object", "null"] },
        us_federal_contracts: { type: "object" },
        metadata: { type: "object" },
      },
    },
  },
  {
    id: "consumer_safety_recall",
    pack: "commerce",
    method: "GET",
    path: "/v1/consumer/safety-recall",
    routeKey: "GET /v1/consumer/safety-recall",
    summary:
      "US CPSC + openFDA consumer product, toy, appliance, food, drug & medical device recall gate",
    description: `Screen consumer products, toys, appliances, electronics, foods, drugs, and medical devices against US CPSC Recalls and openFDA Class I-III Enforcement feeds with ongoing-status and injury/severity ranking. Do NOT use for EU RAPEX/Safety Gate alerts, automotive VIN recalls, or clinical drug trials. ${COMMERCE_DISCLAIMER}`,
    tags: ["commerce", "consumer", "recall", "cpsc", "fda", "product-safety"],
    priceAmount: "0.01",
    priceFormatted: "$0.01",
    priceUsd: 0.01,
    queryParamName: "query",
    queryParamDescription:
      "Product, model, food, drug, or medical device keyword (e.g., stroller, lithium power bank, infant formula).",
    queryParamExample: "stroller",
    exampleQueryParams: {
      query: "stroller",
      category: "consumer",
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 3,
          maxLength: 100,
          description:
            "Product, model, ingredient, food, drug, or medical device search phrase (3-100 chars, e.g., stroller, lithium power bank, infant formula).",
          example: "stroller",
        },
        brand: {
          type: "string",
          minLength: 2,
          maxLength: 80,
          description:
            "Optional manufacturer, recalling firm, or brand filter (e.g., Fisher-Price, Anker, Abbott).",
          example: "Mockingbird",
        },
        category: {
          type: "string",
          enum: ["all", "consumer", "food", "drug", "device"],
          description:
            "Agency vertical filter: 'consumer' (US CPSC), 'food'/'drug'/'device' (openFDA Enforcement), or 'all' (default).",
          example: "consumer",
        },
      },
      required: ["query"],
    },
    outputExample: {
      query: {
        term: "stroller",
        brand: null,
        category: "consumer",
      },
      recall_gate: "ACTIVE_RECALL_ALERT",
      listing_clear: false,
      highest_severity: "HIGH",
      flags: ["RECENT_12M_RECALL", "SEVERE_INJURY_OR_DEATH_HAZARD"],
      counts: {
        total_matched: 2,
        returned: 2,
        cpsc_consumer: 2,
        fda_food: 0,
        fda_drug: 0,
        fda_device: 0,
        ongoing_or_recent: 1,
        class_i_or_severe_hazard: 1,
      },
      recalls: [
        {
          agency: "US_CPSC",
          category: "consumer",
          recall_number: "26639",
          recall_date: "2026-07-23",
          status: "ACTIVE",
          severity: "HIGH",
          classification: null,
          firm: "Peony Design",
          title:
            "Peony Design Recalls Personalized Baby Bibs and Stroller Bags Due to Risk of Serious Injury or Death from Choking Hazard",
          hazard_or_reason: "Risk of serious injury or death from choking hazard",
          remedy: "Refund",
          url: "https://www.cpsc.gov/Recalls/2026/Peony-Design-Recalls-Personalized-Baby-Bibs-and-Stroller-Bags-Due-to-Risk-of-Serious-Injury-or-Death-from-Choking-Hazard",
        },
      ],
      metadata: {
        fetched_at: "2026-11-27T19:30:00.000Z",
        sources: ["us_cpsc_recalls"],
        disclaimer: COMMERCE_DISCLAIMER,
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "query",
        "recall_gate",
        "listing_clear",
        "highest_severity",
        "flags",
        "counts",
        "recalls",
        "metadata",
      ],
      properties: {
        query: { type: "object" },
        recall_gate: {
          type: "string",
          enum: ["CLEAR", "HISTORICAL_RECALLS", "ACTIVE_RECALL_ALERT"],
        },
        listing_clear: { type: "boolean" },
        highest_severity: {
          type: "string",
          enum: ["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL_CLASS_I"],
        },
        flags: { type: "array", items: { type: "string" } },
        counts: { type: "object" },
        recalls: { type: "array", items: { type: "object" } },
        metadata: { type: "object" },
      },
    },
  },
];
