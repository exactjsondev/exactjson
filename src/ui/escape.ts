import { type EndpointCatalogEntry, PACKS } from "../config/catalog";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

export const REPO_URL = "https://github.com/exactjsondev/exactjson";
export const X_URL = "https://x.com/exactjson";
export const X_HANDLE = "@exactjson";
export const NPM_URL = "https://www.npmjs.com/package/exactjson-mcp";
export const GLAMA_URL = "https://glama.ai/mcp/servers/exactjsondev/exactjson";
export const X402SCAN_URL = "https://www.x402scan.com/server/fd682ffe-1911-48a2-9fee-1c7ac6eed7bc";
export const CONTACT_EMAIL = "hello@exactjson.com";
export const SECURITY_EMAIL = "security@exactjson.com";
export const MCP_REGISTRY_ID = "io.github.exactjsondev/exactjson";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatNetworkLabel(network: string): string {
  if (network === "eip155:8453") return "Base Mainnet (eip155:8453)";
  if (network === "eip155:84532") return "Base Sepolia (eip155:84532)";
  return network;
}

export function formatHumanNetwork(network: string): string {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  return network;
}

export function stripPackDisclaimer(entry: EndpointCatalogEntry): string {
  return entry.description.replace(PACKS[entry.pack].disclaimer, "").trim();
}

const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g;

/**
 * Deterministic single-pass JSON syntax highlighter.
 * Every raw substring passes through escapeHtml() exactly once so output is 100% XSS-safe
 * and .innerText / .textContent remains byte-identical to rawJson for clipboard copying.
 */
export function highlightJson(rawJson: string): string {
  let out = "";
  let lastIndex = 0;

  for (const match of rawJson.matchAll(JSON_TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      out += escapeHtml(rawJson.slice(lastIndex, idx));
    }

    const [full, strLiteral, colonPart, boolNull, numLiteral, punc] = match;
    if (strLiteral !== undefined) {
      if (colonPart !== undefined) {
        out += `<span class="tok-key">${escapeHtml(strLiteral)}</span><span class="tok-punc">${escapeHtml(colonPart)}</span>`;
      } else {
        out += `<span class="tok-str">${escapeHtml(strLiteral)}</span>`;
      }
    } else if (boolNull !== undefined || numLiteral !== undefined) {
      out += `<span class="tok-num">${escapeHtml(full)}</span>`;
    } else if (punc !== undefined) {
      out += `<span class="tok-punc">${escapeHtml(punc)}</span>`;
    } else {
      out += escapeHtml(full);
    }

    lastIndex = idx + full.length;
  }

  if (lastIndex < rawJson.length) {
    out += escapeHtml(rawJson.slice(lastIndex));
  }

  return out;
}

const BASH_TOKEN_RE = /(#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|\b(curl|npx)\b/g;
const TS_TOKEN_RE =
  /(\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(import|from|const|await|new|console)\b/g;

export function highlightCode(rawCode: string, lang: "bash" | "ts"): string {
  const regex = lang === "bash" ? BASH_TOKEN_RE : TS_TOKEN_RE;
  let out = "";
  let lastIndex = 0;

  for (const match of rawCode.matchAll(regex)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      out += escapeHtml(rawCode.slice(lastIndex, idx));
    }

    const [full, comment, strLit, keyword] = match;
    if (comment !== undefined) {
      out += `<span class="tok-muted">${escapeHtml(comment)}</span>`;
    } else if (strLit !== undefined) {
      out += `<span class="tok-str">${escapeHtml(strLit)}</span>`;
    } else if (keyword !== undefined) {
      out += `<span class="tok-kw">${escapeHtml(keyword)}</span>`;
    } else {
      out += escapeHtml(full);
    }

    lastIndex = idx + full.length;
  }

  if (lastIndex < rawCode.length) {
    out += escapeHtml(rawCode.slice(lastIndex));
  }

  return out;
}

export interface CodeWellOptions {
  id: string;
  label: string;
  copyLabel: string;
  codeHtml: string;
  receiptLeft?: string;
  receiptRight?: string;
  codeDataAttr?: string;
  labelDataAttr?: string;
}

export function renderCodeWell(opts: CodeWellOptions): string {
  const safeId = escapeHtml(opts.id);
  const codeAttr = opts.codeDataAttr ? ` ${opts.codeDataAttr}` : "";
  const labelAttr = opts.labelDataAttr ? ` ${opts.labelDataAttr}` : "";
  const receiptHtml = opts.receiptLeft
    ? `<div class="code-receipt">
        <span class="receipt-ok"><span class="sig-dot ok" aria-hidden="true"></span>${escapeHtml(opts.receiptLeft)}</span>
        ${opts.receiptRight ? `<span class="receipt-meta">${escapeHtml(opts.receiptRight)}</span>` : ""}
      </div>`
    : "";

  return `<div class="code-well">
    <div class="code-well-bar">
      <span class="code-well-label"${labelAttr}>${escapeHtml(opts.label)}</span>
      <span class="copy-wrap">
        <button type="button" class="copy-btn" command="--copy" commandfor="${safeId}" aria-label="${escapeHtml(opts.copyLabel)}">
          <span class="copy-text-idle" aria-hidden="true">Copy</span>
          <span class="copy-text-done" aria-hidden="true">✓ Copied</span>
          <span class="copy-text-fail" aria-hidden="true">! Failed</span>
        </button>
        <span class="copy-tip" role="status"></span>
      </span>
    </div>
    <pre tabindex="0"><code id="${safeId}"${codeAttr}>${opts.codeHtml}</code></pre>${receiptHtml}
  </div>`;
}
