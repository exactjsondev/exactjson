-- ExactJSON initial D1 schema (api_requests + 3 indexes + 1-row operator pause control)

CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  query_target TEXT,
  http_status INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  price_usd REAL NOT NULL DEFAULT 0,
  network TEXT NOT NULL,
  payer_address TEXT,
  tx_hash TEXT,
  cache_status TEXT,
  upstream_source TEXT,
  upstream_error TEXT,
  extension_responses TEXT,
  latency_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_requests_created_at
  ON api_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_requests_outcome_created
  ON api_requests (outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_requests_endpoint_created
  ON api_requests (endpoint, created_at DESC);

CREATE TABLE IF NOT EXISTS service_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO service_control (id, paused, updated_at)
VALUES (1, 0, '2026-11-21T00:00:00.000Z');
