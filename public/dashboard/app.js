const TOKEN_KEY = "exactjson_dashboard_token";
const VALID_OUTCOMES = new Set([
  "SETTLED",
  "CHALLENGED_402",
  "VERIFY_FAILED",
  "UNSETTLED_ERROR",
]);
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

let lastControlState = { paused: false, updated_at: null };
let loadEpoch = 0;
let requestsEpoch = 0;
let currentPayTo = "";

const el = (id) => document.getElementById(id);

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setToken(tok) {
  sessionStorage.setItem(TOKEN_KEY, tok);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function shortAddr(val) {
  if (!val || val.length < 12) return val || "-";
  return `${val.slice(0, 6)}...${val.slice(-4)}`;
}

function fmtUsd(n) {
  const num = Number(n || 0);
  return `$${num.toFixed(4)}`;
}

function explorerUrl(network, txHash) {
  if (!txHash) return null;
  if (network === "eip155:8453") {
    return `https://basescan.org/tx/${encodeURIComponent(txHash)}`;
  }
  return `https://sepolia.basescan.org/tx/${encodeURIComponent(txHash)}`;
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    showAuth("Invalid or expired DASHBOARD_TOKEN.");
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson && typeof errJson.message === "string" && errJson.message.trim()) {
        detail = `${errJson.message} (${res.status})`;
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(detail);
  }
  return res.json();
}

function showAuth(errorMessage) {
  loadEpoch += 1;
  requestsEpoch += 1;
  el("dashboard-main").classList.add("hidden");
  el("header-actions").classList.add("hidden");
  el("network-pill").classList.add("hidden");
  el("status-pill").classList.add("hidden");
  el("auth-section").classList.remove("hidden");
  if (errorMessage) {
    el("auth-error").textContent = errorMessage;
    el("auth-error").classList.remove("hidden");
  } else {
    el("auth-error").classList.add("hidden");
  }
}

function showDashboard() {
  el("auth-section").classList.add("hidden");
  el("auth-error").classList.add("hidden");
  el("dashboard-main").classList.remove("hidden");
  el("header-actions").classList.remove("hidden");
  el("network-pill").classList.remove("hidden");
  el("status-pill").classList.remove("hidden");
}

function renderControlState(control) {
  const normalized = {
    paused: Boolean(control?.paused),
    updated_at: control?.updated_at || null,
  };
  lastControlState = normalized;
  const paused = normalized.paused;
  const pill = el("status-pill");
  pill.classList.remove("live", "paused");
  pill.classList.add(paused ? "paused" : "live");
  el("status-pill-text").textContent = paused ? "PAUSED (503)" : "LIVE";
  el("start-api-btn").disabled = !paused;
  el("stop-api-btn").disabled = paused;
  el("control-updated").textContent = paused
    ? `Paused — /v1/* returns 503 uncharged (updated: ${normalized.updated_at || "now"})`
    : `Active — /v1/* accepting x402 V2 payments (updated: ${normalized.updated_at || "default"})`;
}

function walletExplorerUrl(network, addr) {
  if (!addr) return "#";
  const host = network === "eip155:8453" ? "basescan.org" : "sepolia.basescan.org";
  return `https://${host}/address/${encodeURIComponent(addr)}#tokentxns`;
}

function renderOverview(data) {
  el("version-pill").textContent = data.version || "v1";
  el("network-pill").textContent = `${data.env || "testnet"} · ${data.network || ""}`;
  currentPayTo = data.pay_to || "";
  const walletLink = el("wallet-link");
  if (currentPayTo) {
    walletLink.textContent = `PayTo: ${shortAddr(currentPayTo)}`;
    walletLink.href = walletExplorerUrl(data.network, currentPayTo);
    walletLink.title = `${currentPayTo} (open BaseScan token transfers)`;
  } else {
    walletLink.textContent = "";
    walletLink.removeAttribute("href");
  }
  el("last-updated").textContent = `Updated ${new Date().toISOString().slice(11, 19)}Z`;

  renderControlState(data.control || { paused: false, updated_at: null });

  const all = data.all_time || {};
  const d24 = data.last_24h || {};

  el("kpi-rev-all").textContent = fmtUsd(all.revenue_usd);
  el("kpi-rev-24h").textContent = `24h: ${fmtUsd(d24.revenue_usd)}`;
  el("kpi-settled").textContent = String(all.settled_count || 0);
  el("kpi-settled-24h").textContent = `24h: ${d24.settled_count || 0}`;
  el("kpi-challenged").textContent = String(all.challenged_count || 0);
  el("kpi-challenged-24h").textContent = `24h: ${d24.challenged_count || 0}`;
  el("kpi-errors").textContent = `${all.verify_failed_count || 0} / ${all.error_count || 0}`;
  el("kpi-errors-24h").textContent = `24h: ${d24.verify_failed_count || 0} / ${d24.error_count || 0}`;
  const byTransport = data.by_transport || {};
  const httpT = byTransport.http || {};
  const mcpT = byTransport.mcp || {};
  el("kpi-latency").textContent = `${all.avg_latency_ms || 0} ms`;
  el("kpi-total").textContent = `Total: ${all.total_requests || 0} (HTTP ${httpT.total_requests || 0} · MCP ${mcpT.total_requests || 0})`;

  const tbody = el("endpoints-tbody");
  tbody.replaceChildren();
  const rows = Array.isArray(data.by_endpoint) ? data.by_endpoint : [];
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "muted";
    td.textContent = "No paid endpoint traffic logged yet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const cells = [
      { text: row.endpoint, cls: "mono" },
      { text: String(row.total_requests || 0) },
      { text: String(row.settled_count || 0) },
      { text: fmtUsd(row.revenue_usd), cls: "mono" },
      { text: String(row.challenged_count || 0) },
      { text: String(row.verify_failed_count || 0) },
      { text: String(row.error_count || 0) },
      { text: `${row.avg_latency_ms || 0} ms` },
    ];
    for (const cell of cells) {
      const td = document.createElement("td");
      if (cell.cls) td.className = cell.cls;
      td.textContent = cell.text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function renderRequests(data) {
  const tbody = el("requests-tbody");
  tbody.replaceChildren();
  const rows = Array.isArray(data.requests) ? data.requests : [];

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 13;
    td.className = "muted";
    td.textContent = "No requests match the selected filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");

    const thTime = document.createElement("th");
    thTime.scope = "row";
    thTime.className = "mono";
    thTime.textContent = (r.created_at || "").replace("T", " ").replace(/\.\d+Z$/, "Z");
    tr.appendChild(thTime);

    const tdEndpoint = document.createElement("td");
    tdEndpoint.className = "mono";
    tdEndpoint.textContent = r.endpoint || "-";
    tr.appendChild(tdEndpoint);

    const tdTransport = document.createElement("td");
    const transportVal = r.transport === "mcp" ? "mcp" : "http";
    const tBadge = document.createElement("span");
    tBadge.className = `badge transport-${transportVal}`;
    tBadge.textContent = transportVal.toUpperCase();
    tdTransport.appendChild(tBadge);
    tr.appendChild(tdTransport);

    const tdTarget = document.createElement("td");
    tdTarget.className = "mono";
    tdTarget.textContent = r.query_target ? shortAddr(r.query_target) : "-";
    if (r.query_target) tdTarget.title = r.query_target;
    tr.appendChild(tdTarget);

    const tdStatus = document.createElement("td");
    tdStatus.className = "mono";
    tdStatus.textContent = String(r.http_status ?? "-");
    tr.appendChild(tdStatus);

    const tdOutcome = document.createElement("td");
    const badge = document.createElement("span");
    const safeOutcome = VALID_OUTCOMES.has(r.outcome) ? r.outcome : "";
    badge.className = safeOutcome ? `badge ${safeOutcome}` : "badge";
    badge.textContent = r.outcome || "-";
    tdOutcome.appendChild(badge);
    tr.appendChild(tdOutcome);

    const tdPrice = document.createElement("td");
    tdPrice.className = "mono";
    tdPrice.textContent = r.price_usd ? fmtUsd(r.price_usd) : "-";
    tr.appendChild(tdPrice);

    const tdPayer = document.createElement("td");
    tdPayer.className = "mono";
    tdPayer.textContent = shortAddr(r.payer_address);
    if (r.payer_address) tdPayer.title = r.payer_address;
    tr.appendChild(tdPayer);

    const tdTx = document.createElement("td");
    tdTx.className = "mono";
    if (typeof r.tx_hash === "string" && TX_HASH_RE.test(r.tx_hash)) {
      const link = document.createElement("a");
      link.href = explorerUrl(r.network, r.tx_hash);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = shortAddr(r.tx_hash);
      link.title = r.tx_hash;
      tdTx.appendChild(link);
    } else {
      tdTx.textContent = r.tx_hash ? shortAddr(String(r.tx_hash)) : "-";
    }
    tr.appendChild(tdTx);

    const tdCache = document.createElement("td");
    tdCache.textContent = r.cache_status || "-";
    tr.appendChild(tdCache);

    const tdUp = document.createElement("td");
    tdUp.className = "mono";
    tdUp.textContent = r.upstream_error || r.upstream_source || "-";
    tr.appendChild(tdUp);

    const tdExt = document.createElement("td");
    tdExt.className = r.extension_responses ? "mono" : "muted";
    tdExt.textContent = r.extension_responses
      ? `${r.extension_responses.slice(0, 28)}...`
      : "-";
    if (r.extension_responses) tdExt.title = r.extension_responses;
    tr.appendChild(tdExt);

    const tdLat = document.createElement("td");
    tdLat.className = "mono";
    tdLat.textContent = `${r.latency_ms ?? 0} ms`;
    tr.appendChild(tdLat);

    tbody.appendChild(tr);
  }
}

function buildRequestsParams(forceRefresh = false) {
  const endpoint = el("filter-endpoint").value;
  const outcome = el("filter-outcome").value;
  const network = el("filter-network").value;
  const transport = el("filter-transport").value;
  const limit = el("filter-limit").value;
  const params = new URLSearchParams({ limit });
  if (endpoint) params.set("endpoint", endpoint);
  if (outcome) params.set("outcome", outcome);
  if (network) params.set("network", network);
  if (transport) params.set("transport", transport);
  if (forceRefresh) params.set("refresh", "1");
  return params;
}

async function loadDashboard(forceRefresh = false) {
  const myEpoch = ++loadEpoch;
  const myReqEpoch = ++requestsEpoch;
  const network = el("filter-network").value;
  const params = buildRequestsParams(forceRefresh);

  const overviewParams = new URLSearchParams();
  if (network) overviewParams.set("network", network);
  if (forceRefresh) overviewParams.set("refresh", "1");
  const overviewQs = overviewParams.toString();
  const overviewPath = overviewQs
    ? `/dashboard/api/overview?${overviewQs}`
    : "/dashboard/api/overview";

  try {
    const [overview, requests] = await Promise.all([
      apiFetch(overviewPath),
      apiFetch(`/dashboard/api/requests?${params.toString()}`),
    ]);
    if (myEpoch !== loadEpoch) return;
    showDashboard();
    el("dash-error").classList.add("hidden");
    el("auth-error").classList.add("hidden");
    renderOverview(overview);
    if (myReqEpoch === requestsEpoch) {
      renderRequests(requests);
    }
  } catch (err) {
    if (myEpoch !== loadEpoch) return;
    if (err && err.message !== "Unauthorized") {
      const msg = err.message || "Failed to load dashboard data.";
      if (el("dashboard-main").classList.contains("hidden")) {
        el("auth-error").textContent = msg;
        el("auth-error").classList.remove("hidden");
      } else {
        el("dash-error").textContent = msg;
        el("dash-error").classList.remove("hidden");
      }
    }
  }
}

async function loadRequestsOnly() {
  const myReqEpoch = ++requestsEpoch;
  const params = buildRequestsParams(false);

  try {
    const requests = await apiFetch(`/dashboard/api/requests?${params.toString()}`);
    if (myReqEpoch !== requestsEpoch || el("dashboard-main").classList.contains("hidden")) return;
    el("dash-error").classList.add("hidden");
    renderRequests(requests);
  } catch (err) {
    if (myReqEpoch !== requestsEpoch || el("dashboard-main").classList.contains("hidden")) return;
    if (err && err.message !== "Unauthorized") {
      el("dash-error").textContent = err.message || "Failed to load requests.";
      el("dash-error").classList.remove("hidden");
    }
  }
}

async function toggleService(paused) {
  el("start-api-btn").disabled = true;
  el("stop-api-btn").disabled = true;
  try {
    const state = await apiFetch("/dashboard/api/control", {
      method: "POST",
      body: JSON.stringify({ paused }),
    });
    renderControlState(state);
    await loadDashboard(true);
  } catch (err) {
    renderControlState(lastControlState);
    if (err && err.message !== "Unauthorized") {
      el("dash-error").textContent = err.message || "Failed to update service control.";
      el("dash-error").classList.remove("hidden");
    }
  }
}

el("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const val = el("token-input").value.trim();
  if (!val) return;
  setToken(val);
  el("token-input").value = "";
  await loadDashboard(false);
});

el("signout-btn").addEventListener("click", () => {
  clearToken();
  showAuth();
});

el("copy-wallet-btn").addEventListener("click", async () => {
  if (!currentPayTo) return;
  try {
    await navigator.clipboard.writeText(currentPayTo);
    const btn = el("copy-wallet-btn");
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = "Copy";
    }, 1500);
  } catch {
    // clipboard unavailable
  }
});

el("refresh-btn").addEventListener("click", () => void loadDashboard(true));
el("start-api-btn").addEventListener("click", () => toggleService(false));
el("stop-api-btn").addEventListener("click", () => toggleService(true));
el("filter-endpoint").addEventListener("change", () => void loadRequestsOnly());
el("filter-outcome").addEventListener("change", () => void loadRequestsOnly());
el("filter-network").addEventListener("change", () => void loadDashboard(false));
el("filter-transport").addEventListener("change", () => void loadRequestsOnly());
el("filter-limit").addEventListener("change", () => void loadRequestsOnly());

if (getToken()) {
  void loadDashboard(false);
} else {
  showAuth();
}
