import { CATALOG, getActivePacks, getPackEndpoints, SERVICE_NAME } from "../config/catalog";
import { escapeHtml, formatHumanNetwork, formatNetworkLabel, renderCodeWell } from "./escape";
import {
  buildMcpConfigSnippet,
  buildSdkSnippet,
  buildVibePrompt,
  HUMAN_PACK_META,
  renderDialog,
  renderPackSetupWidget,
  WALLET_LINKS,
} from "./humanCopy";
import { renderBrandJsonLd, renderSwissShell } from "./shell";

// IMPORTANT: Never import @x402/* or @coinbase/x402 in src/ui/* to keep GET / cold starts < 10ms.

export function renderSetupHtml(baseUrl: string, network: string): string {
  const networkLabel = formatNetworkLabel(network);
  const humanNet = formatHumanNetwork(network);

  const rabbyDialog = renderDialog({
    id: "guide-rabby-dialog",
    eyebrow: "Rabby Wallet · 4 Steps",
    title: "Create a signing address in Rabby",
    bodyHtml: `
      <p class="modal-lead">Set up a dedicated low-balance EVM address for your agent in under two minutes.</p>
      <ol class="step-list">
        <li><strong>Install Rabby:</strong> Get the browser extension from <a href="${WALLET_LINKS.rabby}" target="_blank" rel="noopener noreferrer">rabby.io ↗</a>.</li>
        <li><strong>Add a dedicated address:</strong> Create a fresh address or sub-account strictly for API calls — keep it separate from your main holdings.</li>
        <li><strong>Export the signing key:</strong> Open the address menu, select <strong>Backup / Export Private Key</strong>, and copy the <code>0x...</code> key.</li>
        <li><strong>Configure locally:</strong> Set <code>BUYER_PRIVATE_KEY</code> in your local <code>.env</code> or MCP config alongside <code>MAX_PAYMENT_USD="$0.05"</code>.</li>
      </ol>`,
    footerHtml: `
      <a class="swiss-btn primary" href="${WALLET_LINKS.rabby}" target="_blank" rel="noopener noreferrer">Open rabby.io ↗</a>
      <button type="button" class="swiss-btn" data-close-dialog>Close</button>`,
  });

  const metamaskDialog = renderDialog({
    id: "guide-metamask-dialog",
    eyebrow: "MetaMask · 4 Steps",
    title: "Create a signing address in MetaMask",
    bodyHtml: `
      <p class="modal-lead">Add a dedicated standard account inside MetaMask so your main wallet stays isolated.</p>
      <ol class="step-list">
        <li><strong>Install MetaMask:</strong> Get the official extension from <a href="${WALLET_LINKS.metamask}" target="_blank" rel="noopener noreferrer">metamask.io ↗</a>.</li>
        <li><strong>Add a new account:</strong> Open the account picker and create a fresh standard Ethereum account for API calls.</li>
        <li><strong>Export the signing key:</strong> Open <strong>Account details → Show private key</strong> and copy it (prepend <code>0x</code> if omitted).</li>
        <li><strong>Configure locally:</strong> Set <code>BUYER_PRIVATE_KEY</code> in your local <code>.env</code> or MCP config alongside <code>MAX_PAYMENT_USD="$0.05"</code>.</li>
      </ol>
      <div class="callout-box warn">
        <strong>Standard EOA accounts only:</strong> Passkey-only smart wallets do not export a raw <code>0x...</code> private key.
      </div>`,
    footerHtml: `
      <a class="swiss-btn primary" href="${WALLET_LINKS.metamask}" target="_blank" rel="noopener noreferrer">Open metamask.io ↗</a>
      <button type="button" class="swiss-btn" data-close-dialog>Close</button>`,
  });

  const usdcDialog = renderDialog({
    id: "guide-usdc-dialog",
    eyebrow: "Funding · $0 ETH Gas",
    title: "Fund with native Base USDC",
    bodyHtml: `
      <p class="modal-lead">Funding an operational address with $2–$5 of native USDC on <strong>${escapeHtml(humanNet)}</strong> covers 100 to 1,000 live calls.</p>
      <ol class="step-list">
        <li><strong>Copy your address:</strong> Copy the public <code>0x...</code> address of your dedicated signing account.</li>
        <li><strong>Send USDC on Base:</strong> Withdraw USDC directly to the <strong>Base</strong> network from Coinbase (no bridge needed), or bridge via the <a href="${WALLET_LINKS.baseDocs}" target="_blank" rel="noopener noreferrer">Base official docs ↗</a>.</li>
        <li><strong>Confirm native Base USDC:</strong> Verify your balance uses the official native Base Mainnet USDC contract below (not legacy bridged <code>USDbC</code>).</li>
      </ol>
      ${renderCodeWell({
        id: "setup-base-usdc-contract",
        label: "Official Native Base Mainnet USDC Contract",
        copyLabel: "Copy native Base Mainnet USDC contract address",
        codeHtml: escapeHtml(WALLET_LINKS.baseUsdcContract),
        receiptLeft: "$0 ETH gas · EIP-3009 gasless relay",
        receiptRight: "Base Mainnet",
      })}
      <div class="callout-box ok">
        <strong>Zero ETH needed:</strong> <a href="${WALLET_LINKS.x402}" target="_blank" rel="noopener noreferrer">x402 ↗</a> settles gasless <code>EIP-3009</code> authorizations on <a href="${WALLET_LINKS.baseDocs}" target="_blank" rel="noopener noreferrer">Base ↗</a> automatically.
      </div>`,
    footerHtml: `
      <div class="btn-row">
        <a class="swiss-btn" href="${WALLET_LINKS.baseDocs}" target="_blank" rel="noopener noreferrer">Base Docs ↗</a>
        <a class="swiss-btn" href="${WALLET_LINKS.x402}" target="_blank" rel="noopener noreferrer">x402.org ↗</a>
      </div>
      <button type="button" class="swiss-btn primary" data-close-dialog>Done</button>`,
  });

  const mcpPathsDialog = renderDialog({
    id: "guide-mcp-paths-dialog",
    eyebrow: "Claude Desktop · Cursor · Windsurf",
    title: "MCP config locations",
    bodyHtml: `
      <p class="modal-lead">Open the MCP config directly from Settings in your editor or desktop host:</p>
      <ol class="step-list">
        <li><strong>Claude Desktop:</strong> <strong>Settings → Developer → Edit Config</strong>, paste the JSON from Step 1, save, and restart.</li>
        <li><strong>Cursor:</strong> <strong>Settings → MCP → Add new global MCP server</strong> (or add <code>.cursor/mcp.json</code> in your repo).</li>
        <li><strong>Windsurf:</strong> <strong>Settings → MCP → View raw config</strong>, paste the JSON, save, and refresh tools.</li>
      </ol>
      <div class="callout-box ok">
        <strong>Notes:</strong> Merge the <code>"exactjson": { ... }</code> key into your existing <code>mcpServers</code> object if you already have servers configured. Requires <a href="${WALLET_LINKS.nodejs}" target="_blank" rel="noopener noreferrer">Node.js ↗</a> v18.18+ for <code>npx</code>.
      </div>
      <details class="faq-item">
        <summary>Prefer raw file paths?</summary>
        <div class="faq-answer" style="display: flex; flex-direction: column; gap: 0.75rem;">
          ${renderCodeWell({
            id: "setup-path-claude-mac",
            label: "Claude Desktop (macOS)",
            copyLabel: "Copy Claude Desktop macOS config path",
            codeHtml: escapeHtml("~/Library/Application Support/Claude/claude_desktop_config.json"),
          })}
          ${renderCodeWell({
            id: "setup-path-claude-win",
            label: "Claude Desktop (Windows)",
            copyLabel: "Copy Claude Desktop Windows config path",
            codeHtml: escapeHtml("%APPDATA%\\Claude\\claude_desktop_config.json"),
          })}
          ${renderCodeWell({
            id: "setup-path-cursor",
            label: "Cursor (Project or Global ~/.cursor/mcp.json)",
            copyLabel: "Copy Cursor MCP config path",
            codeHtml: escapeHtml(".cursor/mcp.json"),
          })}
          ${renderCodeWell({
            id: "setup-path-windsurf",
            label: "Windsurf (Global)",
            copyLabel: "Copy Windsurf MCP config path",
            codeHtml: escapeHtml("~/.codeium/windsurf/mcp_config.json"),
          })}
        </div>
      </details>`,
    footerHtml: `<button type="button" class="swiss-btn primary" data-close-dialog>Close</button>`,
  });

  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>Quickstart · ${escapeHtml(humanNet)}</span>
        <span class="sig-badge">Pay only on success · $0 ETH gas</span>
      </div>
      <h1 class="page-title">Connect your agent in minutes.</h1>
      <p class="lead">
        Plug ExactJSON into Claude, Cursor, or your own TypeScript runtime via MCP, <code>@x402/fetch</code>, or any x402 wallet. No accounts, no API keys, and no subscriptions.
      </p>
    </section>

    <section class="pipeline-strip" aria-label="3-Step Quickstart Pipeline">
      <div class="pipeline-step">
        <div class="pipeline-num">Step 01</div>
        <strong>Connect your client</strong>
        <span>Agent Prompt, MCP, or SDK</span>
      </div>
      <div class="pipeline-step">
        <div class="pipeline-num">Step 02</div>
        <strong>Add a Base USDC key</strong>
        <span>$0 ETH gas · $0.05 spend cap</span>
      </div>
      <div class="pipeline-step">
        <div class="pipeline-num">Step 03</div>
        <strong>Verify live</strong>
        <span>Free health check · $0 on errors</span>
      </div>
    </section>

    <section id="step-1" class="swiss-section" aria-labelledby="step-1-heading">
      <div class="section-bar">
        <h2 id="step-1-heading" class="section-title">Step 1 — Connect your client</h2>
        <button type="button" class="swiss-btn" data-open-dialog="guide-mcp-paths-dialog">MCP config file paths</button>
      </div>
      ${renderPackSetupWidget({
        baseUrl,
        idPrefix: "setup-gen",
        defaultPack: "all",
        networkLabel,
      })}
    </section>

    <section id="step-2" class="swiss-section" aria-labelledby="step-2-heading">
      <div class="section-bar">
        <h2 id="step-2-heading" class="section-title">Step 2 — Add a Base USDC signing key</h2>
        <span class="coord ok">Gasless EIP-3009 · $0 ETH needed</span>
      </div>
      <div class="spec-cell surface">
        <p>
          Fund a dedicated low-balance EVM address with <strong>$2–$5 of native ${escapeHtml(humanNet)} USDC</strong> (100–1,000 live calls) and keep <code>MAX_PAYMENT_USD="$0.05"</code> set. Because x402 settles gasless <code>EIP-3009</code> authorizations, <strong>$0 ETH is required for gas</strong>.
        </p>
        ${renderCodeWell({
          id: "setup-inline-usdc-contract",
          label: "Native Base Mainnet USDC Contract (not legacy bridged USDbC)",
          copyLabel: "Copy native Base Mainnet USDC contract address",
          codeHtml: escapeHtml(WALLET_LINKS.baseUsdcContract),
          receiptLeft: "$0 ETH gas · Local EIP-3009 signing",
          receiptRight: "Base Mainnet",
        })}
        <div class="callout-box warn">
          <strong>Key format:</strong> Local signing requires an exportable EOA private key (<code>0x...</code>). Passkey-only smart wallets do not export a raw private key.
        </div>
        <div class="btn-row">
          <button type="button" class="swiss-btn" data-open-dialog="guide-rabby-dialog">Rabby guide</button>
          <button type="button" class="swiss-btn" data-open-dialog="guide-metamask-dialog">MetaMask guide</button>
          <button type="button" class="swiss-btn" data-open-dialog="guide-usdc-dialog">Funding Base USDC</button>
        </div>
      </div>
    </section>

    <section id="step-3" class="swiss-section" style="border-bottom: none;" aria-labelledby="step-3-heading">
      <div class="section-bar">
        <h2 id="step-3-heading" class="section-title">Step 3 — Verify live</h2>
        <span class="coord ok">Pay only on HTTP 200</span>
      </div>
      <div class="grid-2">
        <div class="spec-cell surface">
          <h3>Smoke-test before spending</h3>
          <p>Run <code>exactjson_health</code> ($0.00) in MCP, or run <code>curl -i</code> against any <code>/v1/*</code> route to inspect the live <code>PAYMENT-REQUIRED</code> quote before settling a paid call.</p>
          <div class="callout-box ok">
            <strong>Non-200 never settles:</strong> Invalid inputs (<code>400</code>), missing targets (<code>404</code>), fail-closed outages (<code>502</code>), and pauses (<code>503</code>) always charge <strong>$0.00</strong>.
          </div>
        </div>
        <div class="spec-cell surface">
          <h3>Spend discipline</h3>
          <ul class="clean-list">
            <li>Keep <code>MAX_PAYMENT_USD="$0.05"</code> (or <code>maxAmountPerPayment: "$0.05"</code>) enforced client-side.</li>
            <li>Keep <code>BUYER_PRIVATE_KEY</code> in an ignored <code>.env</code> or local MCP config — ExactJSON never sees your key.</li>
            <li>Fund the signing address with only the operational balance your workflow needs.</li>
          </ul>
        </div>
      </div>
      <div class="faq-list" aria-label="Troubleshooting">
        <details class="faq-item">
          <summary>Payment rejected? Verify native Base USDC vs bridged USDbC</summary>
          <div class="faq-answer">
            Confirm the signing address holds <strong>native Base USDC</strong> (<code>${WALLET_LINKS.baseUsdcContract}</code>), not legacy bridged <code>USDbC</code>.
          </div>
        </details>
        <details class="faq-item">
          <summary>Key parse error? Check 0x prefix</summary>
          <div class="faq-answer">
            <code>BUYER_PRIVATE_KEY</code> must be a 64-character hex string prefixed with <code>0x</code> and no surrounding whitespace.
          </div>
        </details>
        <details class="faq-item">
          <summary>Spend cap exceeded? Check MAX_PAYMENT_USD</summary>
          <div class="faq-answer">
            Keep <code>MAX_PAYMENT_USD="$0.05"</code> in MCP (or <code>maxAmountPerPayment: "$0.05"</code> in the SDK). All ${CATALOG.length} ExactJSON endpoints are $0.005–$0.02.
          </div>
        </details>
      </div>
    </section>

    ${rabbyDialog}
    ${metamaskDialog}
    ${usdcDialog}
    ${mcpPathsDialog}`;

  return renderSwissShell({
    baseUrl,
    title: "Quickstart — ExactJSON (MCP, Agent Prompt & Base USDC)",
    description: `Connect your AI agent to ${SERVICE_NAME}'s ${CATALOG.length} live x402 APIs via MCP, @x402/fetch, or AgentCash on Base USDC ($0 ETH gas, $0 on errors).`,
    canonicalPath: "/setup",
    activeNav: "/setup",
    jsonLd: renderBrandJsonLd(baseUrl, false),
    mainHtml,
  });
}

export function buildSetupMarkdown(baseUrl: string, network: string): string {
  const networkLabel = formatNetworkLabel(network);
  const packLines = getActivePacks().map((pack) => {
    const meta = HUMAN_PACK_META[pack.id];
    const count = getPackEndpoints([pack.id]).length;
    const stdioCmd = `npx ${meta.stdioArgs.join(" ")}`;
    return `- **${meta.label}** (${count} tools — ${meta.plainTitle}): Local \`${stdioCmd}\` | Remote \`${baseUrl}${meta.mcpRemotePath}\``;
  });

  const lines = [
    `# ExactJSON Quickstart (${networkLabel})`,
    "",
    "Connect Claude, Cursor, or your TypeScript runtime via MCP, `@x402/fetch`, or any x402 wallet. No accounts, no API keys, and **$0 ETH needed for gas**.",
    "",
    "## Step 1 — Connect Your Client",
    "",
    "### MCP Packs (Single packs <= 15 tools give sharpest tool selection)",
    ...packLines,
    `- **All packs** (${CATALOG.length} tools): Local \`npx -y exactjson-mcp --pack all\` | Remote \`${baseUrl}/mcp/all\``,
    "",
    "Already using AgentCash or an x402-native MCP client? Point directly to `" +
      baseUrl +
      "` or `" +
      baseUrl +
      "/mcp/<pack>` — no local bridge needed.",
    "",
    "### Option A: Agent Prompt (Cursor, Claude Code, Antigravity, Lovable, Bolt, Replit)",
    "```text",
    buildVibePrompt(baseUrl, "all"),
    "```",
    "",
    "### Option B: Local MCP Config (Claude Desktop, Cursor, Windsurf — requires Node.js v18.18+)",
    "```json",
    buildMcpConfigSnippet(baseUrl, "all"),
    "```",
    "",
    "Config locations:",
    "- Claude Desktop: Settings -> Developer -> Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\\Claude\\claude_desktop_config.json` on Windows)",
    "- Cursor: Settings -> MCP -> Add new global MCP server (or `.cursor/mcp.json`)",
    "- Windsurf: Settings -> MCP -> View raw config (`~/.codeium/windsurf/mcp_config.json`)",
    "",
    "### Option C: TypeScript SDK",
    "```ts",
    buildSdkSnippet(baseUrl, "all"),
    "```",
    "",
    "## Step 2 — Add a Base USDC Signing Key",
    "- **Operational balance:** Fund a dedicated low-balance EVM address with **$2–$5 of native Base USDC** (100–1,000 live calls) via Rabby (`" +
      WALLET_LINKS.rabby +
      "`) or MetaMask (`" +
      WALLET_LINKS.metamask +
      "`). Standard EOA keys (`0x...`) are required; passkey-only smart wallets do not export a raw private key.",
    "- **$0 ETH needed for gas:** x402 settles gasless `EIP-3009` authorizations automatically.",
    `- **Native Base Mainnet USDC Contract:** \`${WALLET_LINKS.baseUsdcContract}\` (not legacy bridged \`USDbC\`).`,
    `- **Funding references:** Base Docs (${WALLET_LINKS.baseDocs}) · x402 (${WALLET_LINKS.x402}).`,
    "",
    "## Step 3 — Verify Live",
    '- Run `exactjson_health` ($0.00) in MCP or probe any `/v1/*` route with `curl -i` to inspect `PAYMENT-REQUIRED`.',
    '- Keep `MAX_PAYMENT_USD="$0.05"` (or `maxAmountPerPayment: "$0.05"`) enforced client-side.',
    "- **Pay-only-on-success:** HTTP `200` with `PAYMENT-RESPONSE` settles $0.005–$0.02; `400`, `404`, `502`, and `503` always cost **$0.00**.",
    `- **Troubleshooting:** Verify native Base USDC (\`${WALLET_LINKS.baseUsdcContract}\`), verify \`BUYER_PRIVATE_KEY\` starts with \`0x\`, and confirm your spend cap is \`$0.05\`.`,
    "",
  ];

  return lines.join("\n");
}
