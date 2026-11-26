-- Phase 2: gym tracker. Weights are always stored in kilograms; the app converts for display.
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL,            -- JSON: [{ exerciseId, sets, reps }]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  template_id TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS workouts_started ON workouts (started_at);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight_kg REAL NOT NULL,
  rpe REAL,
  pr TEXT                          -- null, 'e1rm', 'weight' or 'reps'
);
CREATE INDEX IF NOT EXISTS sets_exercise ON sets (exercise_id, workout_id);

CREATE TABLE IF NOT EXISTS bodyweight (
  date TEXT PRIMARY KEY,
  kg REAL NOT NULL
);
