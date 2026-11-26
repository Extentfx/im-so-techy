-- Phase 8: the optional read-only family link. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS family_links (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
