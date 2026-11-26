-- Phase 0 tables: the safety backbone every later phase writes through.
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('user','chat','scheduler')),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL CHECK (source IN ('user','chat','scheduler')),
  action TEXT NOT NULL,
  target TEXT,
  result TEXT NOT NULL
);

-- Which connections exist and when they expire. The secrets themselves never live in D1.
CREATE TABLE IF NOT EXISTS secrets_meta (
  name TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  scopes TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
