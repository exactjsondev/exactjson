const THEME_KEY = "exactjson_theme";
const timers = new WeakMap();
let lastStatusMessage = "";

function readStoredTheme() {
  try {
    const val = localStorage.getItem(THEME_KEY);
    return val === "paper" || val === "carbon" ? val : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme) {
  try {
    if (theme === "paper") {
      localStorage.setItem(THEME_KEY, "paper");
    } else {
      localStorage.removeItem(THEME_KEY);
    }
  } catch {
    // Storage blocked in strict browser modes; theme still applies to current document
  }
}

function applyPolarity(theme) {
  const isPaper = theme === "paper";
  const root = document.documentElement;
  if (isPaper) {
    root.dataset.theme = "paper";
  } else {
    delete root.dataset.theme;
  }

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", isPaper ? "light" : "dark");
  }

  const toggle = document.getElementById("polarity-toggle");
  if (toggle instanceof HTMLInputElement) {
    toggle.checked = isPaper;
  }
}

function initPolarity() {
  const stored = readStoredTheme();
  if (stored) {
    applyPolarity(stored);
  }

  const toggle = document.getElementById("polarity-toggle");
  if (toggle instanceof HTMLInputElement) {
    toggle.addEventListener("change", () => {
      const next = toggle.checked ? "paper" : "carbon";
      applyPolarity(next);
      writeStoredTheme(next);
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY) {
      applyPolarity(event.newValue === "paper" ? "paper" : "carbon");
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

function initEndpointSearch() {
  const input = document.getElementById("endpoint-search");
  if (!(input instanceof HTMLInputElement)) return;

  const rows = Array.from(document.querySelectorAll("[data-endpoint-row]"));
  const subgroups = Array.from(document.querySelectorAll(".pack-subgroup"));
  const sections = Array.from(document.querySelectorAll("[data-pack-section]"));
  const liveStatus = document.getElementById("endpoint-count-live");
  const allTabRadio = document.getElementById("pack-tab-all");
  const packRadios = Array.from(document.querySelectorAll('input[name="pack-tab"]'));

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
      liveStatus.textContent =
        query.length === 0
          ? `${rows.length} LIVE ENDPOINTS`
          : `${visibleCount} OF ${rows.length} MATCHING`;
    }
  };

  input.addEventListener("input", applyFilter);

  for (const radio of packRadios) {
    if (!(radio instanceof HTMLInputElement)) continue;
    radio.addEventListener("change", () => {
      if (radio.id !== "pack-tab-all" && input.value.length > 0) {
        input.value = "";
        applyFilter();
      }
    });
  }
}

initPolarity();
initCopyButtons();
initEndpointSearch();
