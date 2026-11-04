-- Questions typed by visitors (see worker/index.js)
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  q TEXT NOT NULL,
  spread TEXT NOT NULL,
  at TEXT NOT NULL
);
