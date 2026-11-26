-- Phase 4: sleep. One row per night, keyed by the local date you woke up.
CREATE TABLE IF NOT EXISTS sleep_log (
  date TEXT PRIMARY KEY,
  bed_at TEXT NOT NULL,
  wake_at TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);
