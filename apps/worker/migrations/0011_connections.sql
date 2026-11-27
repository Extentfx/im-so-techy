-- Connected accounts (Google, Microsoft) and calendars that come from them.
--
-- calendar_sources must now allow type 'google' / 'microsoft' and a missing feed URL. SQLite cannot alter a
-- CHECK, so the three linked tables are rebuilt together and the data copied. Children are dropped before
-- their parent, so no cascade can touch the copied rows.

CREATE TABLE calendar_sources_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('work','school','family')),
  type TEXT NOT NULL DEFAULT 'ics' CHECK (type IN ('ics','google','microsoft')),
  url_enc TEXT,                     -- encrypted feed URL; null for calendars that come from a connected account
  host TEXT NOT NULL,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  connection_id TEXT,
  remote_id TEXT                    -- the provider's calendar id
);
INSERT INTO calendar_sources_v2 (id, name, kind, type, url_enc, host, last_synced_at, last_error, created_at)
  SELECT id, name, kind, type, url_enc, host, last_synced_at, last_error, created_at FROM calendar_sources;

CREATE TABLE events_v2 (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES calendar_sources_v2(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('work','school','family','dashboard'))
);
INSERT INTO events_v2 (id, source_id, key, title, start, end, all_day, location, kind)
  SELECT id, source_id, key, title, start, end, all_day, location, kind FROM events;

CREATE TABLE shift_changes_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES calendar_sources_v2(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN ('added','removed','changed')),
  title TEXT NOT NULL,
  old_start TEXT, old_end TEXT,
  new_start TEXT, new_end TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shift_changes_v2 (id, source_id, at, type, title, old_start, old_end, new_start, new_end, acknowledged)
  SELECT id, source_id, at, type, title, old_start, old_end, new_start, new_end, acknowledged FROM shift_changes;

DROP TABLE shift_changes;
DROP TABLE events;
DROP TABLE calendar_sources;
ALTER TABLE calendar_sources_v2 RENAME TO calendar_sources;
ALTER TABLE events_v2 RENAME TO events;
ALTER TABLE shift_changes_v2 RENAME TO shift_changes;
CREATE INDEX events_range ON events (start, end);
CREATE INDEX events_source ON events (source_id);
CREATE INDEX shift_changes_open ON shift_changes (acknowledged, at);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  account TEXT NOT NULL,
  features TEXT NOT NULL DEFAULT '[]',   -- JSON: ["mail","calendar"]
  scopes TEXT NOT NULL DEFAULT '',
  access_enc TEXT NOT NULL,              -- AES-GCM encrypted tokens; never returned by the API
  refresh_enc TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','needs_reconnect')),
  last_error TEXT,
  mail_enabled INTEGER NOT NULL DEFAULT 0,
  mail_last_checked TEXT,
  mail_last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, account)
);

-- One row per sign-in attempt: the PKCE verifier and the anti-forgery state. Single use, ten minutes.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  verifier TEXT NOT NULL,
  features TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Message ids already looked at, so each email is read once.
CREATE TABLE email_seen (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, message_id)
);

ALTER TABLE dashboard_events ADD COLUMN remote_id TEXT;
