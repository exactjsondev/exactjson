-- Track direct HTTP (/v1/*) vs Remote Streamable HTTP MCP (/mcp) without adding an extra write-amplifying index
ALTER TABLE api_requests ADD COLUMN transport TEXT NOT NULL DEFAULT 'http';
