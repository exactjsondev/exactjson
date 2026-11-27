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
    eyebrow: "Wallet Walkthrough · 4 Steps",
    title: "Create a pocket wallet in Rabby",
    bodyHtml: `
      <p class="modal-lead">Set up a separate low-balance address just for your AI in under two minutes.</p>
      <ol class="step-list">
        <li><strong>Install Rabby Wallet:</strong> Get the browser extension from <a href="${WALLET_LINKS.rabby}" target="_blank" rel="noopener noreferrer">rabby.io ↗</a>.</li>
        <li><strong>Add a fresh address:</strong> Create a new wallet or sub-account and name it <strong>AI Pocket</strong>. Never reuse your main holdings wallet.</li>
        <li><strong>Export that pocket key:</strong> Open your <strong>AI Pocket</strong> address menu, choose <strong>Backup / Export Private Key</strong>, enter your password, and copy the <code>0x...</code> key.</li>
        <li><strong>Save locally only:</strong> Paste the key into your local <code>.env</code> or MCP config as <code>BUYER_PRIVATE_KEY</code> with <code>MAX_PAYMENT_USD="$0.05"</code>.</li>
      </ol>
      <div class="callout-box warn">
        <strong>Keep it small:</strong> Fund this address with only <strong>$2–$5 of Base USDC</strong> and never paste your private key in chat prompts or GitHub.
      </div>`,
    footerHtml: `
      <a class="swiss-btn primary" href="${WALLET_LINKS.rabby}" target="_blank" rel="noopener noreferrer">Open rabby.io ↗</a>
      <button type="button" class="swiss-btn" data-close-dialog>Close</button>`,
  });

  const metamaskDialog = renderDialog({
    id: "guide-metamask-dialog",
    eyebrow: "Wallet Walkthrough · 4 Steps",
    title: "Create a pocket wallet in MetaMask",
    bodyHtml: `
      <p class="modal-lead">Add a separate account inside MetaMask so your main wallet stays untouched.</p>
      <ol class="step-list">
        <li><strong>Install MetaMask:</strong> Get the official extension from <a href="${WALLET_LINKS.metamask}" target="_blank" rel="noopener noreferrer">metamask.io ↗</a>.</li>
        <li><strong>Add a new account:</strong> Open the account picker, create a new standard Ethereum account, and name it <strong>AI Pocket</strong>.</li>
        <li><strong>Export that account's key:</strong> Open <strong>Account details → Show private key</strong>, confirm your password, and copy it (prepend <code>0x</code> if missing).</li>
        <li><strong>Save locally only:</strong> Add it to your local <code>.env</code> or MCP config as <code>BUYER_PRIVATE_KEY</code> with <code>MAX_PAYMENT_USD="$0.05"</code>.</li>
      </ol>
      <div class="callout-box warn">
        <strong>Standard accounts only:</strong> Exportable <code>0x...</code> private keys come from standard self-custody accounts, not passkey-only smart wallets.
      </div>`,
    footerHtml: `
      <a class="swiss-btn primary" href="${WALLET_LINKS.metamask}" target="_blank" rel="noopener noreferrer">Open metamask.io ↗</a>
      <button type="button" class="swiss-btn" data-close-dialog>Close</button>`,
  });

  const usdcDialog = renderDialog({
    id: "guide-usdc-dialog",
    eyebrow: "Funding Guide · $0 ETH Gas Needed",
    title: "Add $2–$5 of native USDC on Base",
    bodyHtml: `
      <p class="modal-lead">1 USDC always equals $1.00. Even $5 covers 250 to 1,000 live calls on <strong>${escapeHtml(humanNet)}</strong>.</p>
      <ol class="step-list">
        <li><strong>Copy your pocket address:</strong> Copy the public <code>0x...</code> address of your new <strong>AI Pocket</strong> wallet.</li>
        <li><strong>Send $2–$5 USDC on Base:</strong> Withdraw USDC directly to the <strong>Base</strong> network from Coinbase (no bridge needed), or bridge via the <a href="${WALLET_LINKS.baseDocs}" target="_blank" rel="noopener noreferrer">Base official docs ↗</a>.</li>
        <li><strong>Check native Base USDC:</strong> Confirm your balance uses the official native Base Mainnet USDC contract below (not legacy bridged <code>USDbC</code>).</li>
      </ol>
      ${renderCodeWell({
        id: "setup-base-usdc-contract",
        label: "Official Native Base Mainnet USDC Contract",
        copyLabel: "Copy native Base Mainnet USDC contract address",
        codeHtml: escapeHtml(WALLET_LINKS.baseUsdcContract),
        receiptLeft: "$0 ETH gas needed · EIP-3009 gasless relay",
        receiptRight: "Base Mainnet",
      })}
      <div class="callout-box ok">
        <strong>Zero ETH needed for gas:</strong> <a href="${WALLET_LINKS.x402}" target="_blank" rel="noopener noreferrer">x402 ↗</a> uses gasless USDC authorizations on <a href="${WALLET_LINKS.baseDocs}" target="_blank" rel="noopener noreferrer">Base ↗</a>, so your pocket wallet does not need any ETH.
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
    title: "Where do I paste MCP config?",
    bodyHtml: `
      <p class="modal-lead">Each app has a built-in Settings button that opens the exact MCP config file for you:</p>
      <ol class="step-list">
        <li><strong>Claude Desktop:</strong> Open <strong>Settings → Developer → Edit Config</strong>, paste the JSON from Step 2, save, and restart Claude.</li>
        <li><strong>Cursor:</strong> Open <strong>Settings → MCP → Add new global MCP server</strong> (or add <code>.cursor/mcp.json</code> inside your project).</li>
        <li><strong>Windsurf:</strong> Open <strong>Settings → MCP → View raw config</strong>, paste the JSON, save, and refresh tools.</li>
      </ol>
      <div class="callout-box ok">
        <strong>Quick tips:</strong> If your config file already lists other tools inside <code>mcpServers</code>, paste just the <code>"exactjson": { ... }</code> entry inside it. Make sure <a href="${WALLET_LINKS.nodejs}" target="_blank" rel="noopener noreferrer">Node.js ↗</a> (v18+) is installed so <code>npx</code> works, then ask your AI to run <code>exactjson_health</code> ($0.00 free).
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
    footerHtml: `<button type="button" class="swiss-btn primary" data-close-dialog>Got it</button>`,
  });

  const mainHtml = `
    <section class="spec-cell swiss-section" style="padding: 2.5rem 2rem;">
      <div class="eyebrow-row">
        <span class="sig-badge ok"><span class="sig-dot ok" aria-hidden="true"></span>5-Minute Setup · ${escapeHtml(humanNet)}</span>
        <span class="sig-badge">Pay only on success · $0 ETH gas</span>
      </div>
      <h1 class="page-title">Get your AI connected in 3 simple steps.</h1>
      <p class="lead">
        No account signup, no API-key pile, and no monthly subscriptions. Just a $5 USDC pocket wallet on ${escapeHtml(humanNet)} and one copy-paste into your AI tool.
      </p>
    </section>

    <section class="pipeline-strip" aria-label="3-Step Setup Pipeline">
      <div class="pipeline-step">
        <div class="pipeline-num">Step 01</div>
        <strong>Make a $5 pocket wallet</strong>
        <span>USDC on ${escapeHtml(humanNet)} ($0 ETH gas)</span>
      </div>
      <div class="pipeline-step">
        <div class="pipeline-num">Step 02</div>
        <strong>Connect your AI</strong>
        <span>Vibe-code prompt, MCP, or SDK</span>
      </div>
      <div class="pipeline-step">
        <div class="pipeline-num">Step 03</div>
        <strong>Stay safe &amp; verify</strong>
        <span>$0.05 cap &amp; $0 on errors</span>
      </div>
    </section>

    <section id="step-1" class="swiss-section" aria-labelledby="step-1-heading">
      <div class="section-bar">
        <h2 id="step-1-heading" class="section-title">Step 1 — Make a $5 AI pocket wallet</h2>
        <span class="coord ok">Base USDC · $0 ETH gas</span>
      </div>
      <div class="grid-3">
        <div class="spec-cell surface">
          <span class="coord ok">Stable currency</span>
          <h3>1 USDC = $1.00</h3>
          <p>USDC is digital US dollars, not a volatile coin. Even $5 covers 250 to 1,000 live calls.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord ok">Gasless payments</span>
          <h3>$0 ETH needed for gas</h3>
          <p>x402 uses gasless USDC approvals, so the payment relay pays Base network fees automatically.</p>
        </div>
        <div class="spec-cell surface">
          <span class="coord warn">Safety rule</span>
          <h3>Use a separate wallet</h3>
          <p>Create a fresh low-balance address just for your AI. Never paste your main wallet's private key.</p>
        </div>
      </div>
      <div class="spec-cell">
        <div class="callout-box warn">
          <strong>Smart-wallet note:</strong> Passkey-only smart wallets don't export a <code>0x...</code> private key for <code>.env</code> or <code>exactjson-mcp</code>. Use a standard self-custody sub-account in <strong>Rabby</strong> or <strong>MetaMask</strong> instead.
        </div>
        <div class="btn-row">
          <button type="button" class="swiss-btn primary" data-open-dialog="guide-rabby-dialog">Rabby Wallet (4 steps)</button>
          <button type="button" class="swiss-btn" data-open-dialog="guide-metamask-dialog">MetaMask (4 steps)</button>
          <button type="button" class="swiss-btn" data-open-dialog="guide-usdc-dialog">How to add $5 USDC on Base</button>
        </div>
      </div>
    </section>

    <section id="step-2" class="swiss-section" aria-labelledby="step-2-heading">
      <div class="section-bar">
        <h2 id="step-2-heading" class="section-title">Step 2 — Plug into your AI tool</h2>
        <button type="button" class="swiss-btn" data-open-dialog="guide-mcp-paths-dialog">Where do I paste MCP config?</button>
      </div>
      ${renderPackSetupWidget({
        baseUrl,
        idPrefix: "setup-gen",
        defaultPack: "all",
        networkLabel,
      })}
    </section>

    <section id="step-3" class="swiss-section" style="border-bottom: none;" aria-labelledby="step-3-heading">
      <div class="section-bar">
        <h2 id="step-3-heading" class="section-title">Step 3 — Stay safe &amp; verify it works</h2>
        <span class="coord ok">Pay only on success</span>
      </div>
      <div class="grid-2">
        <div class="spec-cell surface">
          <h3>Safety checklist</h3>
          <ul class="clean-list">
            <li>Keep <code>MAX_PAYMENT_USD="$0.05"</code> so no single call can ever exceed a few cents.</li>
            <li>Add <code>.env</code> to <code>.gitignore</code> before saving your pocket wallet key.</li>
            <li>Never share private keys in chat prompts, screenshots, or GitHub issues.</li>
          </ul>
        </div>
        <div class="spec-cell surface">
          <h3>How to verify your connection</h3>
          <p>In MCP, ask your AI to run <code>exactjson_health</code> ($0.00 free). When you run a paid tool, successful calls settle between $0.005–$0.02 and return a receipt header.</p>
          <div class="callout-box ok">
            <strong>Pay only when it works:</strong> Invalid inputs, missing targets, or source outages always charge <strong>$0.00</strong>.
          </div>
        </div>
      </div>
      <div class="faq-list" aria-label="Quick Troubleshooting">
        <details class="faq-item">
          <summary>Payment rejected? Check native Base USDC vs bridged USDbC</summary>
          <div class="faq-answer">
            Confirm your pocket wallet holds <strong>native Base USDC</strong> (contract <code>${WALLET_LINKS.baseUsdcContract}</code>), not legacy bridged <code>USDbC</code>.
          </div>
        </details>
        <details class="faq-item">
          <summary>Private key error? Make sure it starts with 0x</summary>
          <div class="faq-answer">
            <code>BUYER_PRIVATE_KEY</code> must start with <code>0x</code> followed by 64 hex characters (no extra spaces).
          </div>
        </details>
        <details class="faq-item">
          <summary>Spend cap exceeded? Check MAX_PAYMENT_USD</summary>
          <div class="faq-answer">
            Keep <code>MAX_PAYMENT_USD="$0.05"</code> in MCP (or <code>maxAmountPerPayment: "$0.05"</code> in the SDK). All ${CATALOG.length} ExactJSON endpoints are between $0.005–$0.02.
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
    title: "Setup Guide — ExactJSON (Wallet, Vibe Coding & MCP in 5 Minutes)",
    description: `Connect your AI to ${SERVICE_NAME}'s ${CATALOG.length} live x402 APIs in 3 steps: fund a $5 Base USDC pocket wallet ($0 ETH gas), paste a Vibe-Code prompt or MCP config, and lock in a $0.05 spend cap.`,
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
    `# ExactJSON Setup Guide (${networkLabel})`,
    "",
    "Get your AI connected in 3 simple steps — no account signup, no API keys, no monthly subscriptions, and **$0 ETH needed for gas**.",
    "",
    "## Step 1 — Make a $5 AI Pocket Wallet",
    "- **USDC = digital US dollars:** 1 USDC = $1.00.",
    "- **$0 ETH needed for gas:** x402 uses gasless USDC authorizations (`EIP-3009`), so the relay pays Base network gas automatically.",
    "- **Dedicated pocket wallet rule:** Create a brand-new standard self-custody address in Rabby (`" +
      WALLET_LINKS.rabby +
      "`) or MetaMask (`" +
      WALLET_LINKS.metamask +
      "`) and fund it with **$2–$5 of native Base USDC** (100–1,000 calls). Never paste your main wallet's private key, and avoid passkey-only smart wallets that do not export a `0x...` key.",
    `- **Official Native Base Mainnet USDC Contract:** \`${WALLET_LINKS.baseUsdcContract}\` (do not use bridged \`USDbC\`).`,
    `- **Funding links:** Send USDC directly to Base from Coinbase (zero bridge) or follow Base Docs (${WALLET_LINKS.baseDocs}) · x402 (${WALLET_LINKS.x402}).`,
    "",
    "## Step 2 — Connect Your AI Tool",
    "",
    "### MCP Packs (Single packs <= 15 tools give sharpest agent accuracy)",
    ...packLines,
    `- **All packs** (${CATALOG.length} tools): Local \`npx -y exactjson-mcp --pack all\` | Remote \`${baseUrl}/mcp/all\``,
    "",
    "### Option A: Vibe-Code Prompt (Cursor, Claude Code, Antigravity, Lovable, Bolt, Replit)",
    "```text",
    buildVibePrompt(baseUrl, "all"),
    "```",
    "",
    "### Option B: Local MCP Config (Claude Desktop, Cursor, Windsurf — requires Node.js v18+)",
    "```json",
    buildMcpConfigSnippet(baseUrl, "all"),
    "```",
    "",
    "Where to paste it:",
    "- Claude Desktop: Settings -> Developer -> Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\\Claude\\claude_desktop_config.json` on Windows)",
    "- Cursor: Settings -> MCP -> Add new global MCP server (or `.cursor/mcp.json`)",
    "- Windsurf: Settings -> MCP -> View raw config (`~/.codeium/windsurf/mcp_config.json`)",
    "",
    "### Option C: TypeScript SDK",
    "```ts",
    buildSdkSnippet(baseUrl, "all"),
    "```",
    "",
    "## Step 3 — Stay Safe & Verify",
    '- Keep `MAX_PAYMENT_USD="$0.05"` (or `maxAmountPerPayment: "$0.05"`).',
    "- Add `.env` to `.gitignore` and never share private keys in chat or GitHub.",
    "- **Pay-only-on-success:** HTTP `200` with `PAYMENT-RESPONSE` settles between $0.005–$0.02; `400`, `404`, `502`, and `503` are always **$0.00 charged**.",
    `- **Troubleshooting:** Verify native Base USDC (\`${WALLET_LINKS.baseUsdcContract}\`), verify \`BUYER_PRIVATE_KEY\` starts with \`0x\`, and confirm your spend cap is \`$0.05\`.`,
    "",
  ];

  return lines.join("\n");
}
