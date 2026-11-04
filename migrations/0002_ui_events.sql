-- Opt-in click-sequence log (docs/08 §4.2). Raw rows are kept 30 days, then rolled into ui_daily_stats.
CREATE TABLE IF NOT EXISTS ui_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,          -- proof of what the visitor agreed to; no persistent visitor id is stored
  viewport_w INTEGER, viewport_h INTEGER,
  pointer TEXT CHECK (pointer IN ('touch','mouse')),
  app_version TEXT
);
CREATE INDEX IF NOT EXISTS ui_sessions_started ON ui_sessions(started_at);

CREATE TABLE IF NOT EXISTS ui_events (
  session_id TEXT NOT NULL REFERENCES ui_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  t_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  view TEXT,
  target TEXT,
  x INTEGER, y INTEGER,
  rx INTEGER, ry INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','kept','undone','miss','blocked')),
  data_json TEXT,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ui_events_type ON ui_events(type, outcome);

CREATE TABLE IF NOT EXISTS ui_daily_stats (   -- aggregate only, no identifiers; kept permanently
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  view TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  pointer TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL,
  PRIMARY KEY (day, type, view, outcome, pointer)
);
