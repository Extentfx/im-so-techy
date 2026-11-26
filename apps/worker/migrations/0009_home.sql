-- Phase 7: smart home. The Home Assistant address and token live encrypted in settings, never here.
CREATE TABLE IF NOT EXISTS devices (
  entity_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,                  -- JSON: [{ entityId, action, value? }]
  routine TEXT CHECK (routine IN ('wind-down','wake')),
  routine_enabled INTEGER NOT NULL DEFAULT 0
);

-- Single-use confirmations for locks, covers and alarms.
CREATE TABLE IF NOT EXISTS confirmations (
  token TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
