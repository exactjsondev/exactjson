// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

export const SWISS_CSS = `
  @layer reset, tokens, grid, components, utilities;

  @font-face {
    font-family: "Inter";
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url("/fonts/inter-latin.woff2") format("woff2");
  }

  @font-face {
    font-family: "JetBrains Mono";
    font-style: normal;
    font-weight: 100 800;
    font-display: swap;
    src: url("/fonts/jetbrains-mono-latin.woff2") format("woff2");
  }

  @layer reset {
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html {
      overflow-x: clip;
      interpolate-size: allow-keywords;
      scroll-behavior: smooth;
    }
    body {
      margin: 0;
      padding: 0;
    }
    h1, h2, h3, h4 {
      margin: 0;
      text-wrap: balance;
    }
    p, li {
      margin: 0;
      text-wrap: pretty;
    }
  }

  @layer tokens {
    /* Default polarity: Stark Paper (Light) for calm, high-contrast human readability */
    :root {
      color-scheme: light;
      --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

      --bg-canvas: #f6f5f0;
      --bg-surface: #ffffff;
      --bg-elevated: #eceae2;
      --bg-recessed: #0b0d11;
      --bg-invert: #0b0c0e;

      --grid-line: #d4d0c5;
      --grid-line-strong: #1f2329;

      --ink-primary: #0b0c0e;
      --ink-secondary: #2c3138;
      --ink-muted: #4b505a;
      --ink-on-invert: #f6f5f0;
      --ink-on-recessed: #f4f3ee;
      --ink-on-signal: #ffffff;

      --signal-ok: #047857;
      --signal-ok-subtle: rgba(4, 120, 87, 0.09);
      --signal-warn: #b92d00;
      --signal-warn-subtle: rgba(185, 45, 0, 0.09);

      --tok-key: #e5e7eb;
      --tok-str: #34d399;
      --tok-num: #ff8a5c;
      --tok-kw: #93c5fd;
      --tok-punc: #9aa3b2;
      --tok-muted: #9aa3b2;

      --scrollbar-track: #eceae2;
      --scrollbar-thumb: #8d939e;

      accent-color: var(--signal-ok);
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    /* Optional Carbon Dark polarity (toggled via footer switch) */
    :root[data-theme="carbon"],
    :root:has(#polarity-toggle:checked) {
      color-scheme: dark;
      --bg-canvas: #070708;
      --bg-surface: #0e1014;
      --bg-elevated: #15181e;
      --bg-recessed: #040507;
      --bg-invert: #f4f3ee;

      --grid-line: #232730;
      --grid-line-strong: #3c4250;

      --ink-primary: #f4f3ee;
      --ink-secondary: #c8ced8;
      --ink-muted: #9aa3b2;
      --ink-on-invert: #070708;
      --ink-on-recessed: #f4f3ee;
      --ink-on-signal: #04130d;

      --signal-ok: #10b981;
      --signal-ok-subtle: rgba(16, 185, 129, 0.12);
      --signal-warn: #ff622e;
      --signal-warn-subtle: rgba(255, 98, 46, 0.13);

      --scrollbar-track: #0e1014;
      --scrollbar-thumb: #3c4250;
    }
  }

  @layer grid {
    body {
      background: var(--bg-canvas);
      color: var(--ink-primary);
      font-family: var(--font-sans);
      font-size-adjust: from-font;
      font-size: 1rem;
      line-height: 1.62;
      -webkit-font-smoothing: antialiased;
    }

    code, pre, .mono {
      font-family: var(--font-mono);
      font-size-adjust: ch-width from-font;
      font-variant-numeric: tabular-nums;
    }

    p code, li code, td code, .desc code {
      font-size: 0.88em;
      padding: 0.08rem 0.3rem;
      background: var(--bg-elevated);
      border: 1px solid var(--grid-line);
    }

    a {
      color: var(--ink-primary);
      text-decoration: underline;
      text-decoration-color: var(--grid-line-strong);
      text-underline-offset: 3px;
    }
    a:hover {
      color: var(--signal-ok);
      text-decoration-color: var(--signal-ok);
    }

    :where(a:any-link, button, summary, input, [tabindex="0"]):focus-visible,
    .polarity-switch:has(#polarity-toggle:focus-visible),
    .hero-inspector:has(#hero-mode-payload:focus-visible) label[for="hero-mode-payload"],
    .hero-inspector:has(#hero-mode-prompt:focus-visible) label[for="hero-mode-prompt"],
    .hero-inspector:has(#hero-mode-mcp:focus-visible) label[for="hero-mode-mcp"],
    .setup-generator:has([data-gen-radio="prompt"]:focus-visible) label[for$="-mode-prompt"],
    .setup-generator:has([data-gen-radio="mcp"]:focus-visible) label[for$="-mode-mcp"],
    .setup-generator:has([data-gen-radio="sdk"]:focus-visible) label[for$="-mode-sdk"],
    #endpoints:has(#pack-tab-popular:focus-visible) label[for="pack-tab-popular"],
    #endpoints:has(#pack-tab-all:focus-visible) label[for="pack-tab-all"],
    #endpoints:has(#pack-tab-markets:focus-visible) label[for="pack-tab-markets"],
    #endpoints:has(#pack-tab-security:focus-visible) label[for="pack-tab-security"],
    #endpoints:has(#pack-tab-world:focus-visible) label[for="pack-tab-world"],
    #endpoints:has(#pack-tab-commerce:focus-visible) label[for="pack-tab-commerce"],
    #endpoints:has(#pack-tab-research:focus-visible) label[for="pack-tab-research"] {
      outline: 2px solid var(--signal-ok);
      outline-offset: -2px;
    }

    .header-band {
      border-bottom: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }

    .header-inner {
      max-width: 1344px;
      margin: 0 auto;
      min-block-size: 68px;
      padding: 0.75rem 1.5rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      border-inline: 1px solid var(--grid-line);
    }

    .brand-cluster {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }

    .brand-link {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.025em;
      color: var(--ink-primary);
      text-decoration: none;
    }
    .brand-link:hover {
      color: var(--ink-primary);
    }

    .brand-mark {
      inline-size: 32px;
      block-size: 32px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #0b0c0e;
      border: 1px solid var(--grid-line-strong);
      color: #10b981;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      font-weight: 700;
    }

    .meta-tag {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--ink-muted);
      font-variant-numeric: tabular-nums;
    }

    .nav-cluster {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.25rem;
    }

    .nav-cluster a {
      min-block-size: 32px;
      display: inline-flex;
      align-items: center;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--ink-secondary);
      text-decoration: none;
    }
    .nav-cluster a:hover,
    .nav-cluster a[aria-current="page"] {
      color: var(--ink-primary);
      text-decoration: underline;
      text-decoration-color: var(--signal-ok);
      text-underline-offset: 6px;
      text-decoration-thickness: 2px;
    }

    @media (max-width: 560px) {
      .header-inner {
        padding: 0.65rem 1rem;
        gap: 0.55rem;
      }
      .nav-cluster {
        gap: 0.35rem 0.8rem;
      }
      .nav-cluster a {
        font-size: 0.84rem;
        min-block-size: 28px;
      }
    }

    .polarity-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-block-size: 36px;
      padding: 0.35rem 0.85rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    .polarity-switch:hover {
      border-color: var(--signal-ok);
      color: var(--signal-ok);
    }
    .pol-light { display: none; }
    :root[data-theme="carbon"] .pol-dark,
    :root:has(#polarity-toggle:checked) .pol-dark { display: none; }
    :root[data-theme="carbon"] .pol-light,
    :root:has(#polarity-toggle:checked) .pol-light { display: inline; }

    #main-content,
    .swiss-grid {
      max-width: 1344px;
      margin: 0 auto;
      border-inline: 1px solid var(--grid-line);
      background: var(--bg-canvas);
    }

    .swiss-section {
      border-bottom: 1px solid var(--grid-line);
    }

    .section-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 1.05rem 1.5rem;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
    }

    .section-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink-primary);
    }

    .coord {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--ink-muted);
      font-variant-numeric: tabular-nums;
    }
    .coord.ok { color: var(--signal-ok); }
    .coord.warn { color: var(--signal-warn); }

    .hero-split {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
      border-bottom: 1px solid var(--grid-line);
    }
    .hero-split > * { min-width: 0; }
    .hero-narrative {
      padding: 2.35rem 2.25rem;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 1.35rem;
      border-inline-end: 1px solid var(--grid-line);
      background: var(--bg-canvas);
    }
    .hero-narrative .kpi-strip {
      margin-top: auto;
    }
    .hero-inspector {
      display: flex;
      flex-direction: column;
      background: var(--bg-surface);
    }

    @media (max-width: 980px) {
      .hero-split {
        grid-template-columns: minmax(0, 1fr);
      }
      .hero-narrative {
        border-inline-end: none;
        border-bottom: 1px solid var(--grid-line);
        padding: 2rem 1.25rem;
      }
    }

    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pack-matrix {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    .pack-matrix > :nth-child(-n+2) {
      grid-column: span 3;
    }
    .pack-matrix > :nth-child(n+3) {
      grid-column: span 2;
    }
    .status-matrix {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .pipeline-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border-bottom: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }
    .discovery-matrix {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .grid-3 > *, .grid-2 > *, .pack-matrix > *, .status-matrix > *, .pipeline-strip > *, .discovery-matrix > * {
      min-width: 0;
      border-inline-end: 1px solid var(--grid-line);
      border-bottom: 1px solid var(--grid-line);
    }
    .grid-3 > :nth-child(3n),
    .grid-2 > :nth-child(2n),
    .pack-matrix > :nth-child(2),
    .pack-matrix > :nth-child(5),
    .status-matrix > :nth-child(5n),
    .pipeline-strip > :nth-child(4n),
    .discovery-matrix > :nth-child(3n) {
      border-inline-end: none;
    }
    .pipeline-strip > * {
      border-bottom: none;
    }

    @media (max-width: 960px) {
      .pack-matrix,
      .status-matrix,
      .pipeline-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .pack-matrix > * {
        grid-column: span 1 !important;
        border-inline-end: 1px solid var(--grid-line);
      }
      .pack-matrix > :nth-child(2n) { border-inline-end: none; }
      .status-matrix > *, .pipeline-strip > * {
        border-inline-end: 1px solid var(--grid-line);
        border-bottom: 1px solid var(--grid-line);
      }
      .status-matrix > :nth-child(2n),
      .pipeline-strip > :nth-child(2n) { border-inline-end: none; }
    }

    @media (max-width: 820px) {
      .grid-3, .grid-2, .pack-matrix, .discovery-matrix, .status-matrix, .pipeline-strip {
        grid-template-columns: minmax(0, 1fr);
      }
      .grid-3 > *, .grid-2 > *, .pack-matrix > *, .discovery-matrix > *, .status-matrix > *, .pipeline-strip > * {
        border-inline-end: none;
      }
    }

    .docs-layout {
      display: grid;
      grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
    }
    .docs-rail {
      padding: 1.75rem 1.25rem;
      border-inline-end: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }
    .docs-rail-sticky {
      position: sticky;
      inset-block-start: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .docs-main {
      min-width: 0;
    }
    @media (max-width: 900px) {
      .docs-layout {
        grid-template-columns: minmax(0, 1fr);
      }
      .docs-rail {
        border-inline-end: none;
        border-bottom: 1px solid var(--grid-line);
      }
      .docs-rail-sticky {
        position: static;
        flex-direction: row;
        flex-wrap: wrap;
      }
    }
  }

  @layer components {
    .eyebrow-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.65rem;
    }

    .sig-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.25rem 0.7rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--ink-secondary);
      font-variant-numeric: tabular-nums;
    }
    .sig-badge.ok {
      border-color: var(--signal-ok);
      background: var(--signal-ok-subtle);
      color: var(--signal-ok);
    }
    .sig-badge.warn {
      border-color: var(--signal-warn);
      background: var(--signal-warn-subtle);
      color: var(--signal-warn);
    }

    .sig-dot {
      inline-size: 7px;
      block-size: 7px;
      flex-shrink: 0;
      background: currentColor;
    }
    .sig-dot.ok { background: var(--signal-ok); }
    .sig-dot.warn { background: var(--signal-warn); }

    h1.display-title {
      font-size: clamp(2.15rem, 3.8vw, 3.25rem);
      font-weight: 700;
      line-height: 1.08;
      letter-spacing: -0.035em;
      color: var(--ink-primary);
    }

    h1.page-title {
      font-size: clamp(1.85rem, 3vw, 2.55rem);
      font-weight: 700;
      line-height: 1.12;
      letter-spacing: -0.03em;
      color: var(--ink-primary);
    }

    .lead {
      font-size: 1.0625rem;
      line-height: 1.62;
      color: var(--ink-secondary);
      max-width: 60ch;
    }

    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.7rem;
      align-items: center;
    }

    .swiss-btn {
      appearance: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      min-block-size: 42px;
      padding: 0.55rem 1.15rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      font-family: var(--font-sans);
      font-size: 0.875rem;
      font-weight: 600;
      text-decoration: none;
    }
    .swiss-btn:hover {
      border-color: var(--signal-ok);
      color: var(--signal-ok);
      text-decoration: none;
    }
    .swiss-btn.primary {
      background: var(--bg-invert);
      color: var(--ink-on-invert);
      border-color: var(--bg-invert);
    }
    .swiss-btn.primary:hover {
      background: var(--signal-ok);
      border-color: var(--signal-ok);
      color: var(--ink-on-signal);
    }

    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }
    .kpi-cell {
      padding: 0.85rem 0.9rem;
      border-inline-end: 1px solid var(--grid-line);
    }
    .kpi-cell:last-child {
      border-inline-end: none;
    }
    .kpi-val {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      color: var(--ink-primary);
    }
    .kpi-lbl {
      margin-top: 0.2rem;
      font-size: 0.8125rem;
      color: var(--ink-muted);
    }
    @media (max-width: 620px) {
      .kpi-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .kpi-cell:nth-child(2) { border-inline-end: none; }
      .kpi-cell:nth-child(1), .kpi-cell:nth-child(2) { border-bottom: 1px solid var(--grid-line); }
    }

    /* Visual Payload Compression Comparison Bar */
    .compare-visual {
      padding: 1rem 1.25rem;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--grid-line);
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .compare-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.4rem 0.75rem;
      align-items: center;
    }
    .compare-label {
      font-size: 0.84rem;
      font-weight: 600;
      color: var(--ink-secondary);
    }
    .compare-metric {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--ink-muted);
    }
    .compare-metric.ok {
      color: var(--signal-ok);
    }
    .compare-track {
      grid-column: 1 / -1;
      block-size: 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--grid-line);
      overflow: hidden;
    }
    .compare-bar-raw {
      block-size: 100%;
      inline-size: 100%;
      background: var(--ink-muted);
      opacity: 0.55;
    }
    .compare-bar-exact {
      block-size: 100%;
      inline-size: 4%;
      min-inline-size: 12px;
      background: var(--signal-ok);
    }

    /* 4-Step Visual Pipeline Strip (/setup) */
    .pipeline-step {
      padding: 1.25rem 1.35rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .pipeline-num {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--signal-ok);
    }
    .pipeline-step strong {
      font-size: 0.98rem;
      color: var(--ink-primary);
    }
    .pipeline-step span {
      font-size: 0.875rem;
      color: var(--ink-muted);
    }

    /* 3-Mode Pure-CSS Inspector & Setup Generator Tabs */
    .inspector-tabs,
    .gen-tabs {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
    }
    .tab-trigger {
      display: inline-flex;
      align-items: center;
      min-block-size: 44px;
      padding: 0.55rem 1.05rem;
      border-inline-end: 1px solid var(--grid-line);
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--ink-secondary);
      cursor: pointer;
      user-select: none;
    }
    .tab-trigger:hover {
      color: var(--ink-primary);
    }

    .inspector-pane,
    .gen-pane {
      display: none;
      flex: 1;
      flex-direction: column;
    }
    .gen-pane {
      padding: 1.25rem 1.5rem 1.5rem;
      gap: 0.85rem;
      background: var(--bg-surface);
    }
    .gen-note {
      font-size: 0.9375rem;
      color: var(--ink-secondary);
    }

    .hero-inspector:has(#hero-mode-payload:checked) label[for="hero-mode-payload"],
    .hero-inspector:has(#hero-mode-prompt:checked) label[for="hero-mode-prompt"],
    .hero-inspector:has(#hero-mode-mcp:checked) label[for="hero-mode-mcp"],
    .setup-generator:has([data-gen-radio="prompt"]:checked) label[for$="-mode-prompt"],
    .setup-generator:has([data-gen-radio="mcp"]:checked) label[for$="-mode-mcp"],
    .setup-generator:has([data-gen-radio="sdk"]:checked) label[for$="-mode-sdk"] {
      background: var(--bg-invert);
      color: var(--ink-on-invert);
    }

    .hero-inspector:has(#hero-mode-payload:checked) .inspector-pane[data-pane="payload"],
    .hero-inspector:has(#hero-mode-prompt:checked) .inspector-pane[data-pane="prompt"],
    .hero-inspector:has(#hero-mode-mcp:checked) .inspector-pane[data-pane="mcp"],
    .setup-generator:has([data-gen-radio="prompt"]:checked) .gen-pane[data-gen-pane="prompt"],
    .setup-generator:has([data-gen-radio="mcp"]:checked) .gen-pane[data-gen-pane="mcp"],
    .setup-generator:has([data-gen-radio="sdk"]:checked) .gen-pane[data-gen-pane="sdk"] {
      display: flex;
    }

    .gen-pack-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      background: var(--bg-canvas);
      border-bottom: 1px solid var(--grid-line);
    }
    .gen-pack-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
    }
    .gen-pack-label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--ink-secondary);
      margin-inline-end: 0.25rem;
    }
    .gen-status {
      font-size: 0.84rem;
      color: var(--ink-muted);
    }

    .compression-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.7rem 1.25rem;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--grid-line);
      font-size: 0.84rem;
      color: var(--ink-secondary);
    }

    /* Recessed Dark JSON / Code Art Well (high-contrast syntax in both Paper and Carbon) */
    .code-well {
      color-scheme: only dark;
      background: var(--bg-recessed);
      color: var(--ink-on-recessed);
      accent-color: #10b981;
      border: 1px solid var(--grid-line-strong);
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .hero-inspector .code-well {
      border: none;
    }
    .hero-inspector .code-well pre {
      max-block-size: 380px;
      overflow: auto;
    }

    .code-well-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid #232730;
      background: #11141a;
    }

    .code-well-label {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      color: #c8ced8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .copy-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex-shrink: 0;
    }

    .copy-btn {
      appearance: none;
      cursor: pointer;
      min-inline-size: 68px;
      min-block-size: 30px;
      padding: 0.25rem 0.65rem;
      border: 1px solid #485060;
      background: #1a1e26;
      color: #f4f3ee;
      font-family: var(--font-sans);
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .copy-btn:hover {
      border-color: #34d399;
      color: #34d399;
    }
    .copy-btn .copy-text-done,
    .copy-btn .copy-text-fail { display: none; }
    .copy-btn[data-copied] {
      border-color: #34d399;
      color: #34d399;
    }
    .copy-btn[data-copied] .copy-text-idle { display: none; }
    .copy-btn[data-copied] .copy-text-done { display: inline; }
    .copy-btn[data-failed] {
      border-color: #ff622e;
      color: #ff622e;
    }
    .copy-btn[data-failed] .copy-text-idle { display: none; }
    .copy-btn[data-failed] .copy-text-fail { display: inline; }

    .copy-tip {
      position: absolute;
      inset-inline-end: 100%;
      margin-inline-end: 0.4rem;
      font-size: 0.8125rem;
      color: #34d399;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
    }

    .code-well pre {
      margin: 0;
      padding: 1.05rem 1.2rem;
      overflow-x: auto;
      max-inline-size: 100%;
      flex: 1;
      font-size: 0.84rem;
      line-height: 1.58;
      color: #f4f3ee;
    }

    .code-receipt {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.65rem 1.15rem;
      border-top: 1px solid #232730;
      background: rgba(16, 185, 129, 0.14);
      font-size: 0.8125rem;
    }
    .receipt-ok {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      color: #34d399;
      font-weight: 600;
    }
    .receipt-ok .sig-dot.ok {
      background: #34d399;
    }
    .receipt-meta {
      color: #c8ced8;
      font-family: var(--font-mono);
    }

    .tok-key { color: var(--tok-key); }
    .tok-str { color: var(--tok-str); }
    .tok-num { color: var(--tok-num); }
    .tok-kw  { color: var(--tok-kw); }
    .tok-punc { color: var(--tok-punc); }
    .tok-muted { color: var(--tok-muted); }

    .spec-cell {
      padding: 1.75rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      background: var(--bg-canvas);
    }
    .spec-cell.surface {
      background: var(--bg-surface);
    }
    .spec-cell.ok-tint {
      background: var(--signal-ok-subtle);
    }

    .spec-cell h2, .spec-cell h3 {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink-primary);
    }
    .spec-cell p {
      font-size: 0.95rem;
      color: var(--ink-secondary);
    }

    .pack-example-q {
      font-size: 0.9rem;
      color: var(--ink-primary);
      padding: 0.65rem 0.85rem;
      background: var(--bg-elevated);
      border-inline-start: 3px solid var(--signal-ok);
    }

    .pack-card-foot {
      margin-top: auto;
      padding-top: 0.5rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.85rem;
      color: var(--ink-muted);
    }

    .callout-box {
      padding: 0.95rem 1.15rem;
      border: 1px solid var(--grid-line);
      border-inline-start-width: 4px;
      background: var(--bg-surface);
      font-size: 0.9375rem;
      color: var(--ink-secondary);
    }
    .callout-box.ok {
      border-inline-start-color: var(--signal-ok);
      background: var(--signal-ok-subtle);
    }
    .callout-box.warn {
      border-inline-start-color: var(--signal-warn);
      background: var(--signal-warn-subtle);
    }

    .step-list {
      margin: 0;
      padding-inline-start: 1.35rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      font-size: 0.95rem;
      color: var(--ink-secondary);
    }
    .step-list li strong {
      color: var(--ink-primary);
    }

    .clean-list {
      margin: 0;
      padding-inline-start: 1.2rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.95rem;
      color: var(--ink-secondary);
    }

    /* Pack-Tabbed Endpoint Explorer */
    .catalog-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
      padding: 1rem 1.5rem;
      background: var(--bg-canvas);
      border-bottom: 1px solid var(--grid-line);
    }

    .pack-tabs {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
    }

    .pack-pill {
      appearance: none;
      display: inline-flex;
      align-items: center;
      min-block-size: 36px;
      padding: 0.35rem 0.8rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      font-family: var(--font-sans);
      font-size: 0.84rem;
      font-weight: 600;
      color: var(--ink-secondary);
      cursor: pointer;
      user-select: none;
    }
    .pack-pill:hover {
      color: var(--ink-primary);
      border-color: var(--signal-ok);
    }
    .pack-pill[aria-pressed="true"] {
      background: var(--bg-invert);
      color: var(--ink-on-invert);
      border-color: var(--bg-invert);
    }

    #endpoints:has(#pack-tab-popular:checked) label[for="pack-tab-popular"],
    #endpoints:has(#pack-tab-all:checked) label[for="pack-tab-all"],
    #endpoints:has(#pack-tab-markets:checked) label[for="pack-tab-markets"],
    #endpoints:has(#pack-tab-security:checked) label[for="pack-tab-security"],
    #endpoints:has(#pack-tab-world:checked) label[for="pack-tab-world"],
    #endpoints:has(#pack-tab-commerce:checked) label[for="pack-tab-commerce"],
    #endpoints:has(#pack-tab-research:checked) label[for="pack-tab-research"] {
      background: var(--bg-invert);
      color: var(--ink-on-invert);
      border-color: var(--bg-invert);
    }

    #endpoints:has(#pack-tab-popular:checked) tr[data-endpoint-row]:not([data-popular="true"]),
    #endpoints:has(#pack-tab-markets:checked) tr[data-endpoint-row]:not([data-pack="markets"]),
    #endpoints:has(#pack-tab-security:checked) tr[data-endpoint-row]:not([data-pack="security"]),
    #endpoints:has(#pack-tab-world:checked) tr[data-endpoint-row]:not([data-pack="world"]),
    #endpoints:has(#pack-tab-commerce:checked) tr[data-endpoint-row]:not([data-pack="commerce"]),
    #endpoints:has(#pack-tab-research:checked) tr[data-endpoint-row]:not([data-pack="research"]) {
      display: none;
    }

    [data-pack-section][data-empty-filter],
    .pack-subgroup[data-empty-filter] {
      display: none;
    }

    .search-cluster {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }

    .search-input {
      min-block-size: 38px;
      inline-size: min(330px, 85vw);
      padding: 0.4rem 0.8rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      font-family: var(--font-sans);
      font-size: 0.875rem;
    }
    .search-input::placeholder {
      color: var(--ink-muted);
    }

    .subgroup-bar {
      padding: 0.85rem 1.5rem;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .subgroup-bar h2,
    .subgroup-bar h3 {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--ink-primary);
    }
    .subgroup-bar p {
      font-size: 0.875rem;
      color: var(--ink-muted);
    }

    /* Responsive Container-Query Tables */
    .table-wrap {
      overflow-x: auto;
      max-inline-size: 100%;
      container-type: inline-size;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--grid-line);
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.9375rem;
      --label-2: "Price";
    }
    table.param-table {
      --label-2: "Required";
    }

    thead {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      background: var(--bg-elevated);
    }

    th, td {
      text-align: left;
      padding: 0.95rem 1.25rem;
      border-bottom: 1px solid var(--grid-line);
      vertical-align: middle;
    }
    .docs-main th,
    .docs-main td {
      vertical-align: top;
    }

    thead th {
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--ink-secondary);
    }

    tbody th.ep-cell {
      font-weight: 600;
      white-space: nowrap;
      background: var(--bg-surface);
    }
    tbody th.ep-cell a {
      text-decoration: none;
    }
    tbody th.ep-cell a:hover {
      text-decoration: underline;
    }

    tbody tr:last-child th,
    tbody tr:last-child td {
      border-bottom: none;
    }

    .price {
      font-family: var(--font-mono);
      font-weight: 700;
      color: var(--signal-ok);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .action-cell {
      white-space: nowrap;
      text-align: right;
    }

    .preview-btn {
      appearance: none;
      cursor: pointer;
      min-block-size: 34px;
      padding: 0.3rem 0.75rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-canvas);
      color: var(--ink-primary);
      font-family: var(--font-sans);
      font-size: 0.84rem;
      font-weight: 600;
    }
    .preview-btn:hover {
      border-color: var(--signal-ok);
      color: var(--signal-ok);
    }

    .pack-chip {
      display: inline-block;
      margin-inline-start: 0.45rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--grid-line);
      background: var(--bg-elevated);
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--ink-muted);
      vertical-align: middle;
    }

    .desc {
      color: var(--ink-secondary);
      font-size: 0.9rem;
      margin-top: 0.3rem;
    }

    .sample {
      margin-top: 0.4rem;
      font-size: 0.84rem;
      word-break: break-all;
    }
    .sample a {
      color: var(--ink-muted);
      text-decoration: none;
    }
    .sample a:hover {
      color: var(--signal-ok);
      text-decoration: underline;
    }

    .sample-details,
    .faq-item {
      border: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }
    .sample-details {
      margin-top: 0.65rem;
    }

    .faq-list {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      background: var(--bg-canvas);
    }

    .sample-details > summary,
    .faq-item > summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.7rem 1rem;
      min-block-size: 42px;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--ink-primary);
      user-select: none;
    }
    .sample-details > summary::-webkit-details-marker,
    .faq-item > summary::-webkit-details-marker {
      display: none;
    }
    .sample-details > summary::before,
    .faq-item > summary::before {
      content: "▸";
      display: inline-block;
      flex-shrink: 0;
      color: var(--signal-ok);
      transform: rotate(0deg);
    }
    .sample-details[open] > summary::before,
    .faq-item[open] > summary::before {
      transform: rotate(90deg);
    }
    .sample-details[open] > summary,
    .faq-item[open] > summary {
      border-bottom: 1px solid var(--grid-line);
    }
    .faq-answer {
      padding: 0.9rem 1.15rem 1.05rem;
      font-size: 0.95rem;
      color: var(--ink-secondary);
    }

    .sample-json-wrap {
      color-scheme: only dark;
      background: #0b0d11;
      color: #f4f3ee;
      accent-color: #10b981;
    }

    .sample-json {
      margin: 0;
      padding: 0.9rem 1rem;
      font-size: 0.82rem;
      line-height: 1.55;
      max-block-size: 340px;
      overflow: auto;
      color: #f4f3ee;
    }

    .sample-details::details-content,
    .faq-item::details-content {
      overflow: clip;
      contain: layout;
      transition: block-size 0.2s ease-out, content-visibility 0.2s allow-discrete;
    }
    .sample-details:not([open])::details-content,
    .faq-item:not([open])::details-content {
      block-size: 0;
    }

    /* Native Floating <dialog> Modal Windows */
    .modal-dialog {
      padding: 0;
      margin: auto;
      inline-size: min(680px, calc(100vw - 2rem));
      max-block-size: calc(100dvh - 3rem);
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
      overflow: hidden;
    }
    .modal-dialog[open] {
      display: flex;
      flex-direction: column;
    }
    .modal-dialog::backdrop {
      background: rgba(7, 7, 8, 0.62);
      backdrop-filter: blur(2px);
    }
    .modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.15rem 1.35rem;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
    }
    .modal-head-copy {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
    }
    .modal-eyebrow {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--signal-ok);
    }
    .modal-title {
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink-primary);
    }
    .modal-close {
      appearance: none;
      cursor: pointer;
      flex-shrink: 0;
      min-block-size: 36px;
      padding: 0.3rem 0.75rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      font-family: var(--font-sans);
      font-size: 0.84rem;
      font-weight: 600;
    }
    .modal-close:hover {
      border-color: var(--signal-warn);
      color: var(--signal-warn);
    }
    .modal-body {
      padding: 1.35rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .modal-dialog .sample-json {
      max-block-size: 260px;
    }
    @media (max-width: 560px) {
      .modal-head,
      .modal-body,
      .modal-foot {
        padding: 0.95rem 1rem;
      }
      .modal-dialog .sample-json {
        max-block-size: 210px;
      }
    }
    .modal-lead {
      font-size: 0.98rem;
      color: var(--ink-secondary);
    }
    .modal-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 1rem 1.35rem;
      background: var(--bg-elevated);
      border-top: 1px solid var(--grid-line);
    }

    @media (prefers-reduced-motion: reduce) {
      html {
        scroll-behavior: auto;
      }
      .sample-details > summary::before,
      .sample-details::details-content,
      .faq-item > summary::before,
      .faq-item::details-content {
        transition: none !important;
      }
    }

    @container (width < 680px) {
      table, thead, tbody, tr, th, td {
        display: block;
      }
      thead {
        display: none;
      }
      tbody tr {
        margin: 0.75rem;
        border: 1px solid var(--grid-line);
        background: var(--bg-surface);
      }
      tbody th.ep-cell {
        position: sticky;
        inset-block-start: 0;
        z-index: 2;
        white-space: normal;
        word-break: break-word;
        background: var(--bg-elevated);
        border-bottom: 1px solid var(--grid-line);
      }
      tbody td {
        border-bottom: 1px solid var(--grid-line);
      }
      tbody tr td:last-child {
        border-bottom: none;
      }
      .action-cell {
        text-align: left;
      }
      tbody td.price::before,
      tbody td.req-cell::before {
        content: var(--label-2) ": ";
        color: var(--ink-muted);
        font-weight: 500;
      }
    }

    .disc-cell {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 1.05rem 1.25rem;
      background: var(--bg-surface);
      text-decoration: none;
    }
    .disc-cell:hover {
      background: var(--bg-elevated);
      text-decoration: none;
    }
    .disc-path {
      font-family: var(--font-mono);
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--ink-primary);
    }
    .disc-cell:hover .disc-path {
      color: var(--signal-ok);
    }
    .disc-note {
      font-size: 0.84rem;
      color: var(--ink-muted);
    }

    .toc-link {
      display: block;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--grid-line);
      background: var(--bg-canvas);
      font-size: 0.84rem;
      font-weight: 600;
      color: var(--ink-secondary);
      text-decoration: none;
    }
    .toc-link:hover {
      border-color: var(--signal-ok);
      color: var(--ink-primary);
      text-decoration: none;
    }

    /* Structured 3-Column Footer with Theme Toggle in Bottom Bar */
    .footer-band {
      border-top: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }
    .footer-inner {
      max-width: 1344px;
      margin: 0 auto;
      border-inline: 1px solid var(--grid-line);
    }
    .footer-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      border-bottom: 1px solid var(--grid-line);
    }
    .footer-col {
      padding: 1.5rem;
      border-inline-end: 1px solid var(--grid-line);
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .footer-col:last-child {
      border-inline-end: none;
    }
    .footer-col-title {
      font-size: 0.84rem;
      font-weight: 700;
      color: var(--ink-primary);
    }
    .footer-links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem 1.05rem;
      align-items: center;
    }
    .footer-links a,
    .footer-link-btn {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--ink-secondary);
      text-decoration: none;
    }
    .footer-link-btn {
      appearance: none;
      border: 0;
      padding: 0;
      background: transparent;
      font-family: inherit;
      cursor: pointer;
    }
    .footer-links a:hover,
    .footer-links a[aria-current="page"],
    .footer-link-btn:hover {
      color: var(--signal-ok);
      text-decoration: underline;
    }
    .footer-bottom {
      padding: 1.15rem 1.5rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      background: var(--bg-elevated);
    }
    .footer-disclaimer {
      font-size: 0.84rem;
      color: var(--ink-muted);
      max-width: 78ch;
    }
    @media (max-width: 820px) {
      .footer-grid {
        grid-template-columns: minmax(0, 1fr);
      }
      .footer-col {
        border-inline-end: none;
        border-bottom: 1px solid var(--grid-line);
      }
      .footer-col:last-child {
        border-bottom: none;
      }
    }
  }

  @layer utilities {
    [hidden] {
      display: none !important;
    }
    .visually-hidden:where(:not(:focus-within, :active)),
    .sr-control {
      position: absolute !important;
      clip-path: inset(50%) !important;
      overflow: hidden !important;
      width: 1px !important;
      height: 1px !important;
      margin: -1px !important;
      padding: 0 !important;
      border: 0 !important;
      white-space: nowrap !important;
    }
    .sr-control {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    .skip-link:focus-visible {
      position: fixed;
      inset-block-start: 0.75rem;
      inset-inline-start: 0.75rem;
      z-index: 100;
      padding: 0.55rem 0.95rem;
      background: var(--signal-ok);
      color: var(--ink-on-signal);
      font-size: 0.875rem;
      font-weight: 700;
      text-decoration: none;
    }
  }
`;
