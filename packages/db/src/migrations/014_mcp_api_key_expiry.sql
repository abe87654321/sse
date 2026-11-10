-- Optional expiry for MCP API keys. Keys with expires_at in the past are
-- rejected by both /auth/api-key-login and the MCP server's key refresh.
ALTER TABLE mcp_api_keys
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_expires_at
  ON mcp_api_keys (expires_at);
