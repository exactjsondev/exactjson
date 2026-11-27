const THEME_KEY = "exactjson_theme";
const SAFE_HTTP_URL_RE = /^https?:\/\//i;
const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g;

const PACK_SPECS = {
  all: {
    label: "All packs",
    plainTitle: "All 31 live tools",
    samplePathWithQuery:
      "/v1/evm/safety?address=0x4200000000000000000000000000000000000006&chain=base",
    mcpRemotePath: "/mcp/all",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "all"],
  },
  markets: {
    label: "Markets",
    plainTitle: "Crypto, Trading & Macro",
    samplePathWithQuery:
      "/v1/evm/safety?address=0x4200000000000000000000000000000000000006&chain=base",
    mcpRemotePath: "/mcp",
    stdioArgs: ["-y", "exactjson-mcp"],
  },
  security: {
    label: "Security",
    plainTitle: "Code, Domain & Cloud Safety",
    samplePathWithQuery: "/v1/oss/package-audit?package=lodash&ecosystem=npm",
    mcpRemotePath: "/mcp/security",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "security"],
  },
  world: {
    label: "World",
    plainTitle: "Flights, Weather, Travel & Hazards",
    samplePathWithQuery: "/v1/aviation/airport-delays?airport=JFK",
    mcpRemotePath: "/mcp/world",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "world"],
  },
  commerce: {
    label: "Commerce",
    plainTitle: "Invoices, Companies & Recalls",
    samplePathWithQuery: "/v1/commerce/vat-verify?vat=IE6388047V",
    mcpRemotePath: "/mcp/commerce",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "commerce"],
  },
  research: {
    label: "Research",
    plainTitle: "Papers, Chemistry & Clinical Trials",
    samplePathWithQuery: "/v1/science/citation-verify?doi=10.1038/s41586-021-03819-2",
    mcpRemotePath: "/mcp/research",
    stdioArgs: ["-y", "exactjson-mcp", "--pack", "research"],
  },
};

const timers = new WeakMap();
let lastStatusMessage = "";

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function readStoredTheme() {
  try {
    const val = localStorage.getItem(THEME_KEY);
    return val === "carbon" || val === "paper" ? val : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme) {
  try {
    if (theme === "carbon") {
      localStorage.setItem(THEME_KEY, "carbon");
    } else {
      localStorage.removeItem(THEME_KEY);
    }
  } catch {
    // Storage blocked in strict browser modes; theme still applies to current document
  }
}

function applyPolarity(theme) {
  const isCarbon = theme === "carbon";
  const root = document.documentElement;
  if (isCarbon) {
    root.dataset.theme = "carbon";
  } else {
    delete root.dataset.theme;
  }

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", isCarbon ? "dark" : "light");
  }

  const toggle = document.getElementById("polarity-toggle");
  if (toggle instanceof HTMLInputElement) {
    toggle.checked = isCarbon;
  }
}

function initPolarity() {
  const stored = readStoredTheme();
  if (stored === "carbon") {
    applyPolarity("carbon");
  } else {
    applyPolarity("paper");
    if (stored === "paper") {
      writeStoredTheme("paper");
    }
  }

  const toggle = document.getElementById("polarity-toggle");
  if (toggle instanceof HTMLInputElement) {
    toggle.addEventListener("change", () => {
      const next = toggle.checked ? "carbon" : "paper";
      applyPolarity(next);
      writeStoredTheme(next);
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY || event.key === null) {
      applyPolarity(event.newValue === "carbon" ? "carbon" : "paper");
    }
  });
}

function legacyCopy(text) {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = Object.assign(document.createElement("textarea"), { value: text });
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

function reportCopy(button, ok) {
  const tip = button.nextElementSibling;
  const existingTimer = timers.get(button);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  button.removeAttribute("data-copied");
  button.removeAttribute("data-failed");

  let message = ok ? "Copied" : "Copy failed";
  if (message === lastStatusMessage) {
    message += "\u00A0";
  }
  lastStatusMessage = message;

  if (tip) {
    tip.textContent = "";
  }
  void button.offsetWidth;
  button.setAttribute(ok ? "data-copied" : "data-failed", "");
  if (tip) {
    requestAnimationFrame(() => {
      tip.textContent = message;
    });
  }

  timers.set(
    button,
    setTimeout(() => {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      if (tip) {
        tip.textContent = "";
      }
    }, 2000),
  );
}

async function copyTarget(button, target) {
  const text = target.matches("input, textarea") ? target.value : (target.textContent || "").trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    reportCopy(button, true);
  } catch {
    try {
      if (!legacyCopy(text)) {
        throw new Error("Copy failed");
      }
      reportCopy(button, true);
    } catch {
      reportCopy(button, false);
    }
  }
}

function initCopyButtons() {
  if ("CommandEvent" in window) {
    document.addEventListener(
      "command",
      (event) => {
        if (
          typeof event.command === "string" &&
          event.command.startsWith("--copy") &&
          event.source instanceof HTMLElement &&
          event.target instanceof HTMLElement
        ) {
          void copyTarget(event.source, event.target);
        }
      },
      true,
    );
    return;
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const button = event.target.closest('button[command^="--copy"]');
    if (!(button instanceof HTMLButtonElement)) return;
    const targetId = button.getAttribute("commandfor");
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (target instanceof HTMLElement) {
      void copyTarget(button, target);
    }
  });
}

function makeTokenSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function renderJsonTokens(codeEl, rawJson) {
  const frag = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of rawJson.matchAll(JSON_TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      frag.append(document.createTextNode(rawJson.slice(lastIndex, idx)));
    }

    const [full, strLiteral, colonPart, boolNull, numLiteral, punc] = match;
    if (strLiteral !== undefined) {
      if (colonPart !== undefined) {
        frag.append(makeTokenSpan("tok-key", strLiteral));
        frag.append(makeTokenSpan("tok-punc", colonPart));
      } else {
        frag.append(makeTokenSpan("tok-str", strLiteral));
      }
    } else if (boolNull !== undefined || numLiteral !== undefined) {
      frag.append(makeTokenSpan("tok-num", full));
    } else if (punc !== undefined) {
      frag.append(makeTokenSpan("tok-punc", punc));
    } else {
      frag.append(document.createTextNode(full));
    }

    lastIndex = idx + full.length;
  }

  if (lastIndex < rawJson.length) {
    frag.append(document.createTextNode(rawJson.slice(lastIndex)));
  }

  codeEl.replaceChildren(frag);
}

function initDialogs() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;

    const openTrigger = event.target.closest("[data-open-dialog]");
    if (openTrigger instanceof HTMLElement) {
      const dialogId = openTrigger.dataset.openDialog;
      const dialog = dialogId ? document.getElementById(dialogId) : null;
      if (dialog instanceof HTMLDialogElement && !dialog.open) {
        dialog.showModal();
      }
      return;
    }

    const closeTrigger = event.target.closest("[data-close-dialog]");
    if (closeTrigger instanceof HTMLElement) {
      const dialog = closeTrigger.closest("dialog");
      if (dialog instanceof HTMLDialogElement && dialog.open) {
        dialog.close();
      }
      return;
    }

    if (
      event.target instanceof HTMLDialogElement &&
      event.target.classList.contains("modal-dialog") &&
      event.target.open
    ) {
      event.target.close();
    }
  });
}

function initToolPreviewDialog() {
  const dialog = document.getElementById("tool-preview-dialog");
  const titleEl = document.getElementById("tool-preview-dialog-title");
  const eyebrowEl = dialog instanceof HTMLElement ? dialog.querySelector(".modal-eyebrow") : null;
  const summaryEl = document.getElementById("preview-dialog-summary");
  const urlCodeEl = document.getElementById("preview-dialog-url");
  const urlLinkEl = document.getElementById("preview-dialog-url-link");
  const codeLabelEl = document.getElementById("preview-dialog-code-label");
  const jsonEl = document.getElementById("preview-dialog-json");
  const connectBtn = document.getElementById("preview-dialog-connect");

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;

    const previewBtn = event.target.closest("[data-preview-tool]");
    if (previewBtn instanceof HTMLElement && dialog instanceof HTMLDialogElement) {
      const toolId = previewBtn.dataset.previewTool || "";
      const path = previewBtn.dataset.previewPath || "";
      const price = previewBtn.dataset.previewPrice || "";
      const summary = previewBtn.dataset.previewSummary || "";
      const sampleUrl = previewBtn.dataset.sampleUrl || "";
      const rawPack = previewBtn.dataset.previewPack || "all";
      const pack = Object.hasOwn(PACK_SPECS, rawPack) ? rawPack : "all";
      const packLabel = PACK_SPECS[pack].label;

      if (titleEl) {
        titleEl.textContent = path;
      }
      if (eyebrowEl) {
        eyebrowEl.textContent = `${price} · ${packLabel}`;
      }
      if (summaryEl) {
        summaryEl.textContent = summary;
      }
      if (urlCodeEl) {
        urlCodeEl.textContent = sampleUrl;
      }
      if (urlLinkEl instanceof HTMLAnchorElement) {
        urlLinkEl.href = SAFE_HTTP_URL_RE.test(sampleUrl) ? sampleUrl : "#";
      }
      if (codeLabelEl) {
        codeLabelEl.textContent = `${path} · HTTP 200 OK`;
      }
      if (jsonEl instanceof HTMLElement) {
        const tpl = document.getElementById(`tpl-json-${toolId}`);
        const rawJson =
          tpl instanceof HTMLTemplateElement ? (tpl.content.textContent || "").trim() : "";
        renderJsonTokens(jsonEl, rawJson);
      }
      if (connectBtn instanceof HTMLElement) {
        connectBtn.dataset.connectPack = pack;
        connectBtn.textContent = `Connect ${packLabel} pack →`;
      }

      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    const jumpLink = event.target.closest("[data-jump-pack]");
    if (jumpLink instanceof HTMLElement) {
      const pack = jumpLink.dataset.jumpPack || "";
      if (!Object.hasOwn(PACK_SPECS, pack) || pack === "all") return;
      event.preventDefault();

      const searchInput = document.getElementById("endpoint-search");
      if (searchInput instanceof HTMLInputElement) {
        searchInput.value = "";
      }

      const radio = document.getElementById(`pack-tab-${pack}`);
      if (radio instanceof HTMLInputElement) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const endpoints = document.getElementById("endpoints");
      endpoints?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  });

  if (connectBtn instanceof HTMLButtonElement && dialog instanceof HTMLDialogElement) {
    connectBtn.addEventListener("click", () => {
      const rawPack = connectBtn.dataset.connectPack || "all";
      const pack = Object.hasOwn(PACK_SPECS, rawPack) ? rawPack : "all";
      dialog.close();

      const quickstart = document.getElementById("quickstart");
      if (quickstart instanceof HTMLElement) {
        quickstart.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
        const packBtn = quickstart.querySelector(`[data-gen-pack="${pack}"]`);
        if (packBtn instanceof HTMLButtonElement) {
          packBtn.click();
        }
      }
    });
  }
}

function buildVibePrompt(baseUrl, packId) {
  const spec = PACK_SPECS[packId];
  const scopeNote =
    packId === "all"
      ? `all 5 ExactJSON packs (${baseUrl}/mcp/all or any /v1/* endpoint)`
      : `the ExactJSON ${spec.label} pack (${spec.plainTitle} — ${baseUrl}${spec.mcpRemotePath})`;

  return `Read ${baseUrl}/llms.txt and connect my app to ${scopeNote}.

Requirements:
1. Use @x402/fetch with @x402/evm/exact/client (or exactjson-mcp if wiring an MCP client).
2. Read BUYER_PRIVATE_KEY from process.env (.env only, add .env to .gitignore, never hardcode keys).
3. Enforce a hard spend limit of maxAmountPerPayment: "$0.05".
4. Handle non-200 responses cleanly (400/404/502/503 cost $0.00 — never treat 502 as safe).
5. Start by testing ${baseUrl}${spec.samplePathWithQuery} and show me the parsed JSON result.`;
}

function buildMcpConfig(packId) {
  const spec = PACK_SPECS[packId];
  const serverKey = packId === "all" ? "exactjson" : `exactjson-${packId}`;
  return JSON.stringify(
    {
      mcpServers: {
        [serverKey]: {
          command: "npx",
          args: [...spec.stdioArgs],
          env: {
            BUYER_PRIVATE_KEY: "0xYOUR_POCKET_WALLET_PRIVATE_KEY",
            MAX_PAYMENT_USD: "$0.05",
          },
        },
      },
    },
    null,
    2,
  );
}

function buildSdkSnippet(baseUrl, packId) {
  const spec = PACK_SPECS[packId];
  return `import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client()
  .setSpendControls({ maxAmountPerPayment: "$0.05" });
registerExactEvmScheme(client, {
  signer: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY),
});

const payFetch = wrapFetchWithPayment(fetch, client);
const res = await payFetch("${baseUrl}${spec.samplePathWithQuery}");
console.log(await res.json());`;
}

function initSetupGenerator() {
  const generators = Array.from(document.querySelectorAll("[data-setup-generator]"));

  for (const gen of generators) {
    if (!(gen instanceof HTMLElement)) continue;

    const rawBaseUrl = (gen.dataset.baseUrl || "").trim().replace(/\/+$/, "");
    const baseUrl = SAFE_HTTP_URL_RE.test(rawBaseUrl) ? rawBaseUrl : window.location.origin;
    const packButtons = Array.from(gen.querySelectorAll("[data-gen-pack]"));
    const statusEl = gen.querySelector("[data-gen-status]");
    const promptLabelEl = gen.querySelector('[data-gen-label="prompt"]');
    const mcpLabelEl = gen.querySelector('[data-gen-label="mcp"]');
    const sdkLabelEl = gen.querySelector('[data-gen-label="sdk"]');
    const promptCodeEl = gen.querySelector('[data-gen-code="prompt"]');
    const mcpCodeEl = gen.querySelector('[data-gen-code="mcp"]');
    const sdkCodeEl = gen.querySelector('[data-gen-code="sdk"]');
    const remoteUrlEl = gen.querySelector("[data-gen-remote-url]");

    const selectPack = (packId) => {
      if (!Object.hasOwn(PACK_SPECS, packId)) return;
      const spec = PACK_SPECS[packId];

      for (const btn of packButtons) {
        if (!(btn instanceof HTMLElement)) continue;
        btn.setAttribute("aria-pressed", btn.dataset.genPack === packId ? "true" : "false");
      }

      if (statusEl) {
        statusEl.textContent =
          packId === "all"
            ? `Selected: ${spec.plainTitle} · Tip: single packs (<=15 tools) give sharpest MCP accuracy`
            : `Selected: ${spec.label} (${spec.plainTitle}) · Remote MCP: ${spec.mcpRemotePath}`;
      }
      if (promptLabelEl) {
        promptLabelEl.textContent = `Prompt · ${spec.plainTitle}`;
      }
      if (mcpLabelEl) {
        mcpLabelEl.textContent = `Local MCP · npx ${spec.stdioArgs.join(" ")}`;
      }
      if (sdkLabelEl) {
        sdkLabelEl.textContent = `TypeScript · ${spec.plainTitle}`;
      }
      if (promptCodeEl) {
        promptCodeEl.textContent = buildVibePrompt(baseUrl, packId);
      }
      if (mcpCodeEl instanceof HTMLElement) {
        renderJsonTokens(mcpCodeEl, buildMcpConfig(packId));
      }
      if (sdkCodeEl) {
        sdkCodeEl.textContent = buildSdkSnippet(baseUrl, packId);
      }
      if (remoteUrlEl) {
        remoteUrlEl.textContent = `${baseUrl}${spec.mcpRemotePath}`;
      }
    };

    for (const btn of packButtons) {
      if (!(btn instanceof HTMLButtonElement)) continue;
      btn.addEventListener("click", () => {
        const packId = btn.dataset.genPack || "";
        selectPack(packId);
      });
    }
  }
}

function initEndpointSearch() {
  const input = document.getElementById("endpoint-search");
  if (!(input instanceof HTMLInputElement)) return;

  const rows = Array.from(document.querySelectorAll("[data-endpoint-row]"));
  const subgroups = Array.from(document.querySelectorAll(".pack-subgroup"));
  const sections = Array.from(document.querySelectorAll("[data-pack-section]"));
  const liveStatus = document.getElementById("endpoint-count-live");
  const allTabRadio = document.getElementById("pack-tab-all");
  const allTabLabel = document.querySelector('label[for="pack-tab-all"]');
  const packRadios = Array.from(document.querySelectorAll('input[name="pack-tab"]'));
  const docTocLinks = Array.from(document.querySelectorAll('.toc-link[href^="#docs-pack-"]'));

  const updatePackCounter = () => {
    if (!liveStatus) return;
    const checkedRadio = packRadios.find((r) => r instanceof HTMLInputElement && r.checked);

    if (checkedRadio instanceof HTMLInputElement && checkedRadio.id === "pack-tab-popular") {
      const popularCount = rows.filter(
        (r) => r instanceof HTMLElement && r.dataset.popular === "true",
      ).length;
      liveStatus.textContent = `${popularCount} popular tools (${rows.length} total)`;
    } else if (checkedRadio instanceof HTMLInputElement && checkedRadio.id !== "pack-tab-all") {
      const packId = checkedRadio.id.replace("pack-tab-", "");
      const packCount = rows.filter(
        (r) => r instanceof HTMLElement && r.dataset.pack === packId,
      ).length;
      const packLabel = Object.hasOwn(PACK_SPECS, packId) ? PACK_SPECS[packId].label : packId;
      liveStatus.textContent = `${packCount} ${packLabel} tools`;
    } else {
      liveStatus.textContent = `${rows.length} live tools`;
    }
  };

  const applyFilter = () => {
    const query = input.value.trim().toLowerCase();
    if (query.length > 0 && allTabRadio instanceof HTMLInputElement && !allTabRadio.checked) {
      allTabRadio.checked = true;
    }

    let visibleCount = 0;
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      const haystack = (row.dataset.searchText || "").toLowerCase();
      const matched = query.length === 0 || haystack.includes(query);
      row.hidden = !matched;
      if (matched) visibleCount += 1;
    }

    for (const subgroup of subgroups) {
      if (!(subgroup instanceof HTMLElement)) continue;
      const hasVisibleRow = subgroup.querySelector("[data-endpoint-row]:not([hidden])") !== null;
      subgroup.toggleAttribute("data-empty-filter", !hasVisibleRow);
    }

    for (const section of sections) {
      if (!(section instanceof HTMLElement)) continue;
      const hasVisibleRow = section.querySelector("[data-endpoint-row]:not([hidden])") !== null;
      section.toggleAttribute("data-empty-filter", !hasVisibleRow);
    }

    if (liveStatus) {
      if (query.length === 0) {
        updatePackCounter();
      } else {
        liveStatus.textContent = `${visibleCount} of ${rows.length} matching`;
      }
    }
  };

  input.addEventListener("input", applyFilter);

  if (allTabLabel instanceof HTMLElement) {
    allTabLabel.addEventListener("click", () => {
      if (input.value.length > 0) {
        input.value = "";
        applyFilter();
      }
    });
  }

  for (const radio of packRadios) {
    if (!(radio instanceof HTMLInputElement)) continue;
    radio.addEventListener("change", () => {
      if (input.value.length > 0) {
        input.value = "";
      }
      applyFilter();
    });
  }

  for (const link of docTocLinks) {
    if (!(link instanceof HTMLElement)) continue;
    link.addEventListener("click", () => {
      if (input.value.length > 0) {
        input.value = "";
        applyFilter();
      }
    });
  }
}

initPolarity();
initCopyButtons();
initDialogs();
initToolPreviewDialog();
initSetupGenerator();
initEndpointSearch();
