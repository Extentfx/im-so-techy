-- Phase 1: calendar sources, unified events and shift-change alerts.
CREATE TABLE IF NOT EXISTS calendar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('work','school','family')),
  type TEXT NOT NULL DEFAULT 'ics' CHECK (type IN ('ics')),
  url_enc TEXT NOT NULL,           -- AES-GCM encrypted feed URL; feed URLs often embed a secret token
  host TEXT NOT NULL,              -- for display only
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,             -- source_id:key
  source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('work','school','family','dashboard'))
);
CREATE INDEX IF NOT EXISTS events_range ON events (start, end);
CREATE INDEX IF NOT EXISTS events_source ON events (source_id);

-- Diffs of work calendars, shown as alerts until acknowledged.
CREATE TABLE IF NOT EXISTS shift_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN ('added','removed','changed')),
  title TEXT NOT NULL,
  old_start TEXT, old_end TEXT,
  new_start TEXT, new_end TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shift_changes_open ON shift_changes (acknowledged, at);
