-- Phase 6: spend tracking only. Chat messages themselves are never stored.
CREATE TABLE IF NOT EXISTS chat_usage (
  date TEXT PRIMARY KEY,          -- UTC date
  micro_usd INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0
);
