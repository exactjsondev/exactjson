import type { Context } from "hono";
import { CATALOG, SERVICE_NAME, SERVICE_VERSION } from "../config/catalog";
import { TTL_MS, isolateCache } from "../lib/cache";
import { clampLimit } from "../lib/validation";
import {
  getServiceControlState,
  setServicePaused,
} from "../middleware/serviceControl";
import type { AppBindings } from "../types";

const ALLOWED_OUTCOMES = new Set([
  "CHALLENGED_402",
  "VERIFY_FAILED",
  "SETTLED",
  "UNSETTLED_ERROR",
]);

const ALLOWED_ENDPOINTS = new Set<string>(CATALOG.map((entry) => entry.path));

const ALLOWED_NETWORKS = new Set([
  "eip155:8453",
  "eip155:84532",
]);

const OVERVIEW_CACHE_PREFIX = "dashboard:overview:";

interface EndpointAggregateRow {
  endpoint: string;
  total_requests: number;
  settled_count: number;
  revenue_usd: number;
  challenged_count: number;
  verify_failed_count: number;
  error_count: number;
  sum_latency_ms: number;
  avg_latency_ms: number;
  total_requests_24h: number;
  settled_count_24h: number;
  revenue_usd_24h: number;
  challenged_count_24h: number;
  verify_failed_count_24h: number;
  error_count_24h: number;
}

function isD1QuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /D1_ERROR|row read limit|daily.*limit|exceeded.*limit/i.test(msg);
}

function d1ErrorResponse(c: Context<AppBindings>, err: unknown) {
  if (isD1QuotaError(err)) {
    return c.json(
      {
        error: "D1_QUOTA_EXCEEDED",
        message:
          "Cloudflare D1 free-tier daily read limit reached (resets at 00:00 UTC). Live /v1/* paid API endpoints remain unaffected.",
      },
      503
    );
  }
  const detail = err instanceof Error ? err.message : "Database query failed.";
  console.error("Dashboard D1 error:", detail);
  return c.json(
    {
      error: "DASHBOARD_DB_ERROR",
      message: "Temporary dashboard database error. Please retry shortly.",
    },
    503
  );
}

export async function dashboardOverviewHandler(c: Context<AppBindings>) {
  const db = c.env.DB;
  const networkFilter = c.req.query("network")?.trim();
  const validNetwork = networkFilter && ALLOWED_NETWORKS.has(networkFilter) ? networkFilter : null;
  const forceRefresh = c.req.query("refresh") === "1";

  const cacheKey = `${OVERVIEW_CACHE_PREFIX}${validNetwork ?? "all"}`;
  if (!forceRefresh) {
    const cached = isolateCache.get<Record<string, unknown>>(cacheKey);
    if (cached.hit) {
      return c.json(cached.value);
    }
  }

  try {
    const control = await getServiceControlState(db);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Single-pass aggregate scan (replaces 3 separate full-table scans to stay well within D1 free-tier row reads)
    const aggregateSql = `SELECT
        endpoint,
        COUNT(*) AS total_requests,
        COALESCE(SUM(CASE WHEN outcome = 'SETTLED' THEN 1 ELSE 0 END), 0) AS settled_count,
        COALESCE(SUM(CASE WHEN outcome = 'SETTLED' THEN price_usd ELSE 0 END), 0) AS revenue_usd,
        COALESCE(SUM(CASE WHEN outcome = 'CHALLENGED_402' THEN 1 ELSE 0 END), 0) AS challenged_count,
        COALESCE(SUM(CASE WHEN outcome = 'VERIFY_FAILED' THEN 1 ELSE 0 END), 0) AS verify_failed_count,
        COALESCE(SUM(CASE WHEN outcome = 'UNSETTLED_ERROR' THEN 1 ELSE 0 END), 0) AS error_count,
        COALESCE(SUM(latency_ms), 0) AS sum_latency_ms,
        COALESCE(ROUND(AVG(latency_ms), 1), 0) AS avg_latency_ms,
        COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS total_requests_24h,
        COALESCE(SUM(CASE WHEN created_at >= ? AND outcome = 'SETTLED' THEN 1 ELSE 0 END), 0) AS settled_count_24h,
        COALESCE(SUM(CASE WHEN created_at >= ? AND outcome = 'SETTLED' THEN price_usd ELSE 0 END), 0) AS revenue_usd_24h,
        COALESCE(SUM(CASE WHEN created_at >= ? AND outcome = 'CHALLENGED_402' THEN 1 ELSE 0 END), 0) AS challenged_count_24h,
        COALESCE(SUM(CASE WHEN created_at >= ? AND outcome = 'VERIFY_FAILED' THEN 1 ELSE 0 END), 0) AS verify_failed_count_24h,
        COALESCE(SUM(CASE WHEN created_at >= ? AND outcome = 'UNSETTLED_ERROR' THEN 1 ELSE 0 END), 0) AS error_count_24h
      FROM api_requests${validNetwork ? " WHERE network = ?" : ""}
      GROUP BY endpoint
      ORDER BY endpoint ASC`;

    const bindParams: unknown[] = [since24h, since24h, since24h, since24h, since24h, since24h];
    if (validNetwork) {
      bindParams.push(validNetwork);
    }

    const queryResult = await db
      .prepare(aggregateSql)
      .bind(...bindParams)
      .all<EndpointAggregateRow>();

    const rows = queryResult.results ?? [];

    let totalRequests = 0;
    let settledCount = 0;
    let revenueUsd = 0;
    let challengedCount = 0;
    let verifyFailedCount = 0;
    let errorCount = 0;
    let sumLatencyMs = 0;

    let totalRequests24h = 0;
    let settledCount24h = 0;
    let revenueUsd24h = 0;
    let challengedCount24h = 0;
    let verifyFailedCount24h = 0;
    let errorCount24h = 0;

    const byEndpoint = rows.map((row) => {
      const rTotal = Number(row.total_requests || 0);
      const rSettled = Number(row.settled_count || 0);
      const rRev = Number(row.revenue_usd || 0);
      const rChallenged = Number(row.challenged_count || 0);
      const rVerifyFailed = Number(row.verify_failed_count || 0);
      const rError = Number(row.error_count || 0);

      totalRequests += rTotal;
      settledCount += rSettled;
      revenueUsd += rRev;
      challengedCount += rChallenged;
      verifyFailedCount += rVerifyFailed;
      errorCount += rError;
      sumLatencyMs += Number(row.sum_latency_ms || 0);

      totalRequests24h += Number(row.total_requests_24h || 0);
      settledCount24h += Number(row.settled_count_24h || 0);
      revenueUsd24h += Number(row.revenue_usd_24h || 0);
      challengedCount24h += Number(row.challenged_count_24h || 0);
      verifyFailedCount24h += Number(row.verify_failed_count_24h || 0);
      errorCount24h += Number(row.error_count_24h || 0);

      return {
        endpoint: row.endpoint,
        total_requests: rTotal,
        settled_count: rSettled,
        revenue_usd: Math.round(rRev * 10000) / 10000,
        challenged_count: rChallenged,
        error_count: rError,
        avg_latency_ms: Number(row.avg_latency_ms || 0),
      };
    });

    const payload = {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      env: c.env.APP_ENV || "testnet",
      network: c.env.X402_NETWORK || "eip155:84532",
      pay_to: c.env.X402_PAY_TO || "",
      control,
      all_time: {
        total_requests: totalRequests,
        settled_count: settledCount,
        revenue_usd: Math.round(revenueUsd * 10000) / 10000,
        challenged_count: challengedCount,
        verify_failed_count: verifyFailedCount,
        error_count: errorCount,
        avg_latency_ms:
          totalRequests > 0 ? Math.round((sumLatencyMs / totalRequests) * 10) / 10 : 0,
      },
      last_24h: {
        total_requests: totalRequests24h,
        settled_count: settledCount24h,
        revenue_usd: Math.round(revenueUsd24h * 10000) / 10000,
        challenged_count: challengedCount24h,
        verify_failed_count: verifyFailedCount24h,
        error_count: errorCount24h,
      },
      by_endpoint: byEndpoint,
    };

    isolateCache.set(cacheKey, payload, TTL_MS.DASHBOARD_OVERVIEW);
    return c.json(payload);
  } catch (err) {
    return d1ErrorResponse(c, err);
  }
}

export async function dashboardRequestsHandler(c: Context<AppBindings>) {
  const db = c.env.DB;
  const limit = clampLimit(c.req.query("limit"), 50);
  const outcomeFilter = c.req.query("outcome")?.trim();
  const endpointFilter = c.req.query("endpoint")?.trim();
  const networkFilter = c.req.query("network")?.trim();
  const forceRefresh = c.req.query("refresh") === "1";

  const validOutcome = outcomeFilter && ALLOWED_OUTCOMES.has(outcomeFilter) ? outcomeFilter : null;
  const validEndpoint = endpointFilter && ALLOWED_ENDPOINTS.has(endpointFilter) ? endpointFilter : null;
  const validNetwork = networkFilter && ALLOWED_NETWORKS.has(networkFilter) ? networkFilter : null;

  const cacheKey = `dashboard:requests:${limit}:${validOutcome ?? "all"}:${validEndpoint ?? "all"}:${validNetwork ?? "all"}`;
  if (!forceRefresh) {
    const cached = isolateCache.get<Record<string, unknown>>(cacheKey);
    if (cached.hit) {
      return c.json(cached.value);
    }
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (validOutcome) {
    clauses.push("outcome = ?");
    params.push(validOutcome);
  }
  if (validEndpoint) {
    clauses.push("endpoint = ?");
    params.push(validEndpoint);
  }
  if (validNetwork) {
    clauses.push("network = ?");
    params.push(validNetwork);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);

  const sql = `SELECT
      id, created_at, endpoint, query_target, http_status, outcome,
      price_usd, network, payer_address, tx_hash, cache_status,
      upstream_source, upstream_error, extension_responses, latency_ms
    FROM api_requests
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?`;

  try {
    const result = await db
      .prepare(sql)
      .bind(...params)
      .all();

    const payload = {
      limit,
      count: result.results?.length ?? 0,
      requests: result.results ?? [],
    };
    isolateCache.set(cacheKey, payload, TTL_MS.DASHBOARD_REQUESTS);
    return c.json(payload);
  } catch (err) {
    return d1ErrorResponse(c, err);
  }
}

export async function dashboardGetControlHandler(c: Context<AppBindings>) {
  try {
    const control = await getServiceControlState(c.env.DB);
    return c.json(control);
  } catch (err) {
    return d1ErrorResponse(c, err);
  }
}

export async function dashboardSetControlHandler(c: Context<AppBindings>) {
  let body: { paused?: unknown };
  try {
    body = (await c.req.json()) as { paused?: unknown };
  } catch {
    return c.json({ error: "INVALID_JSON", message: "Expected JSON body { paused: boolean }." }, 400);
  }

  if (typeof body.paused !== "boolean") {
    return c.json(
      { error: "INVALID_PAYLOAD", message: "Field 'paused' must be a boolean." },
      400
    );
  }

  try {
    const state = await setServicePaused(c.env.DB, body.paused);
    // Invalidate all cached overview views so toggle state reflects immediately
    isolateCache.deleteByPrefix(OVERVIEW_CACHE_PREFIX);
    return c.json(state, 200);
  } catch (err) {
    return d1ErrorResponse(c, err);
  }
}
