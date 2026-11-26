-- Allow 'email' as a source of proposals and audit entries (SQLite can't alter a CHECK, so rebuild).
ALTER TABLE proposals RENAME TO proposals_old;
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('user','chat','scheduler','email')),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
INSERT INTO proposals (id, source, kind, summary, payload, status, created_at)
  SELECT id, source, kind, summary, payload, status, created_at FROM proposals_old;
DROP TABLE proposals_old;
CREATE INDEX IF NOT EXISTS proposals_status ON proposals (status, created_at);

ALTER TABLE audit_log RENAME TO audit_log_old;
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL CHECK (source IN ('user','chat','scheduler','email')),
  action TEXT NOT NULL,
  target TEXT,
  result TEXT NOT NULL
);
INSERT INTO audit_log (id, at, source, action, target, result)
  SELECT id, at, source, action, target, result FROM audit_log_old;
DROP TABLE audit_log_old;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The app's own "Dashboard" calendar: everything the app adds after you approve it.
CREATE TABLE IF NOT EXISTS dashboard_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  proposal_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS dashboard_events_range ON dashboard_events (start, end);
