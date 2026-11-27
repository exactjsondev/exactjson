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
    :root {
      color-scheme: dark;
      --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

      --bg-canvas: #070708;
      --bg-surface: #0d0e11;
      --bg-elevated: #14161b;
      --bg-recessed: #040405;
      --bg-invert: #f4f3ee;

      --grid-line: #1f2229;
      --grid-line-strong: #323742;

      --ink-primary: #f4f3ee;
      --ink-secondary: #9ca3af;
      --ink-muted: #7b8494;
      --ink-on-invert: #070708;
      --ink-on-recessed: #f4f3ee;

      --signal-ok: #10b981;
      --signal-ok-subtle: rgba(16, 185, 129, 0.11);
      --signal-warn: #ff5216;
      --signal-warn-subtle: rgba(255, 82, 22, 0.12);

      --tok-key: #e5e7eb;
      --tok-str: #34d399;
      --tok-num: #ff7847;
      --tok-kw: #93c5fd;
      --tok-punc: #7b8494;
      --tok-muted: #7b8494;

      --scrollbar-track: #0d0e11;
      --scrollbar-thumb: #323742;

      accent-color: var(--signal-ok);
      scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    }

    :root[data-theme="paper"],
    :root:has(#polarity-toggle:checked) {
      color-scheme: light;
      --bg-canvas: #f6f5f0;
      --bg-surface: #ffffff;
      --bg-elevated: #eceae2;
      --bg-recessed: #070708;
      --bg-invert: #0b0c0e;

      --grid-line: #d5d2c8;
      --grid-line-strong: #0b0c0e;

      --ink-primary: #0b0c0e;
      --ink-secondary: #3b3f46;
      --ink-muted: #585d67;
      --ink-on-invert: #f6f5f0;
      --ink-on-recessed: #f4f3ee;

      --signal-ok: #047857;
      --signal-ok-subtle: rgba(4, 120, 87, 0.09);
      --signal-warn: #c23000;
      --signal-warn-subtle: rgba(194, 48, 0, 0.09);

      --scrollbar-track: #eceae2;
      --scrollbar-thumb: #9ca3af;
    }
  }

  @layer grid {
    body {
      background: var(--bg-canvas);
      color: var(--ink-primary);
      font-family: var(--font-sans);
      font-size-adjust: from-font;
      font-size: 0.9375rem;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }

    code, pre, .mono {
      font-family: var(--font-mono);
      font-size-adjust: ch-width from-font;
      font-variant-numeric: tabular-nums;
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
    .hero-inspector:has(#hero-mode-mcp:focus-visible) label[for="hero-mode-mcp"],
    .hero-inspector:has(#hero-mode-accept:focus-visible) label[for="hero-mode-accept"],
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
      background: var(--bg-canvas);
    }

    .header-inner {
      max-width: 1344px;
      margin: 0 auto;
      min-block-size: 64px;
      padding: 0.65rem 1.5rem;
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
      font-size: 1.125rem;
      letter-spacing: -0.025em;
      color: var(--ink-primary);
      text-decoration: none;
    }
    .brand-link:hover {
      color: var(--ink-primary);
    }

    .brand-mark {
      inline-size: 30px;
      block-size: 30px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #070708;
      border: 1px solid var(--grid-line-strong);
      color: #10b981;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      font-weight: 700;
    }

    .meta-tag {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--ink-muted);
      font-variant-numeric: tabular-nums;
    }

    .nav-cluster {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.15rem;
    }

    .nav-cluster a {
      min-block-size: 28px;
      display: inline-flex;
      align-items: center;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-secondary);
      text-decoration: none;
    }
    .nav-cluster a:hover,
    .nav-cluster a[aria-current="page"] {
      color: var(--ink-primary);
      text-decoration: underline;
      text-decoration-color: var(--signal-ok);
      text-underline-offset: 5px;
    }

    .polarity-switch {
      display: inline-flex;
      align-items: center;
      min-block-size: 30px;
      padding: 0.25rem 0.65rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-elevated);
      color: var(--ink-primary);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      user-select: none;
    }
    .polarity-switch:hover {
      border-color: var(--signal-ok);
    }
    .pol-paper { display: none; }
    :root[data-theme="paper"] .pol-carbon,
    :root:has(#polarity-toggle:checked) .pol-carbon { display: none; }
    :root[data-theme="paper"] .pol-paper,
    :root:has(#polarity-toggle:checked) .pol-paper { display: inline; }

    #main-content,
    .swiss-grid {
      max-width: 1344px;
      margin: 0 auto;
      border-inline: 1px solid var(--grid-line);
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
      padding: 0.85rem 1.5rem;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
    }

    .coord {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink-muted);
      font-variant-numeric: tabular-nums;
    }
    .coord.ok { color: var(--signal-ok); }
    .coord.warn { color: var(--signal-warn); }

    .hero-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      border-bottom: 1px solid var(--grid-line);
    }
    .hero-split > * { min-width: 0; }
    .hero-narrative {
      padding: 2.75rem 2.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1.5rem;
      border-inline-end: 1px solid var(--grid-line);
      background: var(--bg-canvas);
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
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
    }
    .status-matrix {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .discovery-matrix {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .grid-3 > *, .grid-2 > *, .pack-matrix > *, .status-matrix > *, .discovery-matrix > * {
      min-width: 0;
      border-inline-end: 1px solid var(--grid-line);
      border-bottom: 1px solid var(--grid-line);
    }
    .grid-3 > :nth-child(3n),
    .grid-2 > :nth-child(2n),
    .status-matrix > :nth-child(5n),
    .discovery-matrix > :nth-child(3n) {
      border-inline-end: none;
    }

    @media (max-width: 960px) {
      .status-matrix {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .status-matrix > * { border-inline-end: 1px solid var(--grid-line); }
      .status-matrix > :nth-child(2n) { border-inline-end: none; }
    }

    @media (max-width: 820px) {
      .grid-3, .grid-2, .discovery-matrix {
        grid-template-columns: minmax(0, 1fr);
      }
      .grid-3 > *, .grid-2 > *, .discovery-matrix > *, .status-matrix > * {
        border-inline-end: none;
      }
      .status-matrix {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .docs-layout {
      display: grid;
      grid-template-columns: minmax(0, 272px) minmax(0, 1fr);
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
      gap: 0.75rem;
    }

    .sig-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.22rem 0.65rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-elevated);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
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
      inline-size: 6px;
      block-size: 6px;
      flex-shrink: 0;
      background: currentColor;
    }
    .sig-dot.ok { background: var(--signal-ok); }
    .sig-dot.warn { background: var(--signal-warn); }

    h1.display-title {
      font-size: clamp(2.15rem, 4vw, 3.55rem);
      font-weight: 700;
      line-height: 1.04;
      letter-spacing: -0.04em;
      color: var(--ink-primary);
    }

    h1.page-title {
      font-size: clamp(1.85rem, 3.1vw, 2.65rem);
      font-weight: 700;
      line-height: 1.08;
      letter-spacing: -0.035em;
      color: var(--ink-primary);
    }

    .lead {
      font-size: 1.03rem;
      line-height: 1.58;
      color: var(--ink-secondary);
      max-width: 62ch;
    }

    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
    }

    .swiss-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: 40px;
      padding: 0.55rem 1.15rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
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
      color: #04130d;
    }

    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border: 1px solid var(--grid-line);
      background: var(--bg-surface);
    }
    .kpi-cell {
      padding: 0.75rem 0.85rem;
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
      margin-top: 0.15rem;
      font-family: var(--font-mono);
      font-size: 0.65rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-muted);
    }
    @media (max-width: 620px) {
      .kpi-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .kpi-cell:nth-child(2) { border-inline-end: none; }
      .kpi-cell:nth-child(1), .kpi-cell:nth-child(2) { border-bottom: 1px solid var(--grid-line); }
    }

    /* 3-Mode Swiss Inspector (Pure CSS :has() state machine) */
    .inspector-tabs {
      display: flex;
      flex-wrap: wrap;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
    }
    .tab-trigger {
      display: inline-flex;
      align-items: center;
      min-block-size: 40px;
      padding: 0.55rem 0.95rem;
      border-inline-end: 1px solid var(--grid-line);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-secondary);
      cursor: pointer;
      user-select: none;
    }
    .tab-trigger:hover {
      color: var(--ink-primary);
    }

    .inspector-pane {
      display: none;
      flex: 1;
      flex-direction: column;
    }

    .hero-inspector:has(#hero-mode-payload:checked) label[for="hero-mode-payload"],
    .hero-inspector:has(#hero-mode-mcp:checked) label[for="hero-mode-mcp"],
    .hero-inspector:has(#hero-mode-accept:checked) label[for="hero-mode-accept"] {
      background: var(--bg-invert);
      color: var(--ink-on-invert);
    }

    .hero-inspector:has(#hero-mode-payload:checked) .inspector-pane[data-pane="payload"],
    .hero-inspector:has(#hero-mode-mcp:checked) .inspector-pane[data-pane="mcp"],
    .hero-inspector:has(#hero-mode-accept:checked) .inspector-pane[data-pane="accept"] {
      display: flex;
    }

    .compression-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.65rem 1.25rem;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--grid-line);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    /* Recessed Dark JSON / Code Art Well (component-specific dark color-scheme) */
    .code-well {
      color-scheme: only dark;
      background: var(--bg-recessed);
      color: var(--ink-on-recessed);
      accent-color: #10b981;
      border: 1px solid var(--grid-line);
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .hero-inspector .code-well {
      border: none;
    }

    .code-well-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid #1f2229;
      background: #0a0b0e;
    }

    .code-well-label {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: #9ca3af;
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
      min-inline-size: 64px;
      min-block-size: 26px;
      padding: 0.15rem 0.5rem;
      border: 1px solid #323742;
      background: #14161b;
      color: #f4f3ee;
      font-family: var(--font-mono);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.05em;
    }
    .copy-btn:hover {
      border-color: #10b981;
      color: #10b981;
    }
    .copy-btn .copy-text-done { display: none; }
    .copy-btn[data-copied] {
      border-color: #10b981;
      color: #10b981;
    }
    .copy-btn[data-copied] .copy-text-idle { display: none; }
    .copy-btn[data-copied] .copy-text-done { display: inline; }
    .copy-btn[data-failed] {
      border-color: #ff5216;
      color: #ff5216;
    }

    .copy-tip {
      position: absolute;
      inset-inline-end: 100%;
      margin-inline-end: 0.4rem;
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: #10b981;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
    }

    .code-well pre {
      margin: 0;
      padding: 1rem 1.15rem;
      overflow-x: auto;
      max-inline-size: 100%;
      flex: 1;
      font-size: 0.78rem;
      line-height: 1.56;
      color: #e5e7eb;
    }

    .code-receipt {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.6rem 1.15rem;
      border-top: 1px solid #1f2229;
      background: rgba(16, 185, 129, 0.1);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .receipt-ok {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      color: #10b981;
      font-weight: 600;
    }
    .receipt-meta {
      color: #9ca3af;
    }

    .tok-key { color: var(--tok-key); }
    .tok-str { color: var(--tok-str); }
    .tok-num { color: var(--tok-num); }
    .tok-kw  { color: var(--tok-kw); }
    .tok-punc { color: var(--tok-punc); }
    .tok-muted { color: var(--tok-muted); }

    .spec-cell {
      padding: 1.65rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      background: var(--bg-canvas);
    }
    .spec-cell.surface {
      background: var(--bg-surface);
    }
    .spec-cell.ok-tint {
      background: var(--signal-ok-subtle);
    }

    .spec-cell h2, .spec-cell h3 {
      font-size: 1.08rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--ink-primary);
    }
    .spec-cell p {
      font-size: 0.89rem;
      color: var(--ink-secondary);
    }

    .pack-route-strip {
      margin-top: auto;
      padding: 0.5rem 0.75rem;
      color-scheme: only dark;
      background: var(--bg-recessed);
      color: #34d399;
      border: 1px solid var(--grid-line);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      overflow-x: auto;
      white-space: nowrap;
    }

    /* Pack-Tabbed Endpoint Explorer */
    .catalog-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
      padding: 0.85rem 1.5rem;
      background: var(--bg-canvas);
      border-bottom: 1px solid var(--grid-line);
    }

    .pack-tabs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
    }

    .pack-pill {
      display: inline-flex;
      align-items: center;
      min-block-size: 30px;
      padding: 0.25rem 0.65rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-secondary);
      cursor: pointer;
      user-select: none;
    }
    .pack-pill:hover {
      color: var(--ink-primary);
      border-color: var(--signal-ok);
    }

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

    #endpoints:has(#pack-tab-markets:checked) [data-pack-section]:not([data-pack-section="markets"]),
    #endpoints:has(#pack-tab-security:checked) [data-pack-section]:not([data-pack-section="security"]),
    #endpoints:has(#pack-tab-world:checked) [data-pack-section]:not([data-pack-section="world"]),
    #endpoints:has(#pack-tab-commerce:checked) [data-pack-section]:not([data-pack-section="commerce"]),
    #endpoints:has(#pack-tab-research:checked) [data-pack-section]:not([data-pack-section="research"]) {
      display: none;
    }

    [data-pack-section][data-empty-filter],
    .pack-subgroup[data-empty-filter] {
      display: none;
    }

    .search-cluster {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .search-input {
      min-block-size: 32px;
      inline-size: min(300px, 75vw);
      padding: 0.35rem 0.7rem;
      border: 1px solid var(--grid-line-strong);
      background: var(--bg-surface);
      color: var(--ink-primary);
      font-family: var(--font-mono);
      font-size: 0.76rem;
    }
    .search-input::placeholder {
      color: var(--ink-muted);
    }

    .subgroup-bar {
      padding: 0.7rem 1.5rem;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--grid-line);
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .subgroup-bar h3 {
      font-size: 0.92rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .subgroup-bar p {
      font-size: 0.82rem;
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
      font-size: 0.88rem;
      --label-1: "Endpoint";
      --label-2: "Price (USDC)";
      --label-3: "Specification & Sample";
    }

    thead {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      background: var(--bg-elevated);
    }

    th, td {
      text-align: left;
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--grid-line);
      vertical-align: top;
    }

    thead th {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--ink-muted);
    }

    tbody th.ep-cell {
      font-weight: 600;
      white-space: nowrap;
      background: var(--bg-surface);
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

    .desc {
      color: var(--ink-secondary);
      font-size: 0.84rem;
      margin-top: 0.25rem;
    }

    .sample {
      margin-top: 0.35rem;
      font-size: 0.76rem;
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

    .sample-details {
      margin-top: 0.6rem;
      border: 1px solid var(--grid-line);
      background: var(--bg-canvas);
    }

    .sample-details > summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5ch;
      padding: 0.4rem 0.75rem;
      min-block-size: 30px;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ink-secondary);
      user-select: none;
    }
    .sample-details > summary::-webkit-details-marker {
      display: none;
    }
    .sample-details > summary::before {
      content: "▸";
      display: inline-block;
      flex-shrink: 0;
      color: var(--signal-ok);
      transform: rotate(0deg);
    }
    .sample-details[open] > summary::before {
      transform: rotate(90deg);
    }
    .sample-details[open] > summary {
      color: var(--ink-primary);
      border-bottom: 1px solid var(--grid-line);
    }

    .sample-json-wrap {
      color-scheme: only dark;
      background: #040405;
      color: #e5e7eb;
      accent-color: #10b981;
    }

    .sample-json {
      margin: 0;
      padding: 0.8rem 0.95rem;
      font-size: 0.75rem;
      line-height: 1.5;
      max-block-size: 320px;
      overflow: auto;
      color: #e5e7eb;
    }

    .sample-details::details-content {
      overflow: clip;
      contain: layout;
      transition: block-size 0.2s ease-out, content-visibility 0.2s allow-discrete;
    }
    .sample-details:not([open])::details-content {
      block-size: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      html {
        scroll-behavior: auto;
      }
      .sample-details > summary::before,
      .sample-details::details-content {
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
      tbody td.price::before {
        content: var(--label-2) ": ";
        color: var(--ink-muted);
        font-weight: 500;
      }
    }

    .disc-cell {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: 1rem 1.25rem;
      background: var(--bg-surface);
      text-decoration: none;
    }
    .disc-cell:hover {
      background: var(--bg-elevated);
      text-decoration: none;
    }
    .disc-path {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--ink-primary);
    }
    .disc-cell:hover .disc-path {
      color: var(--signal-ok);
    }
    .disc-note {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--ink-muted);
    }

    .toc-link {
      display: block;
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--grid-line);
      background: var(--bg-canvas);
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ink-secondary);
      text-decoration: none;
    }
    .toc-link:hover {
      border-color: var(--signal-ok);
      color: var(--ink-primary);
      text-decoration: none;
    }

    .footer-band {
      border-top: 1px solid var(--grid-line);
      background: var(--bg-canvas);
    }
    .footer-inner {
      max-width: 1344px;
      margin: 0 auto;
      padding: 1.5rem;
      border-inline: 1px solid var(--grid-line);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--ink-muted);
    }
    .footer-links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.9rem;
    }
    .footer-links a {
      color: var(--ink-secondary);
      text-decoration: none;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .footer-links a:hover {
      color: var(--signal-ok);
    }
  }

  @layer utilities {
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
      color: #04130d;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      text-decoration: none;
    }
  }
`;
