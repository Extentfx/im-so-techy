-- Phase 3: calories, saved foods and meals, school lunch.
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  serving TEXT NOT NULL DEFAULT '1 serving',
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  barcode TEXT,
  source TEXT NOT NULL DEFAULT 'custom'
);

CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL           -- JSON snapshot: [{ name, kcal, protein, carbs, fat, qty }]
);

CREATE TABLE IF NOT EXISTS food_log (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,           -- local date
  slot TEXT NOT NULL CHECK (slot IN ('breakfast','lunch','dinner','snack')),
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  kcal REAL NOT NULL,           -- already multiplied by qty
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS food_log_date ON food_log (date);

-- Weekday (1 = Monday ... 5 = Friday) to school-lunch mapping.
CREATE TABLE IF NOT EXISTS lunch_rules (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),
  name TEXT NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lunch_status (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ate','skipped','other'))
);
