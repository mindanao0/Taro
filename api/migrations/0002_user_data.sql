-- Consent proofs, reading history, notes, favourites, LINE reminders, feedback (docs/08).
CREATE TABLE consents (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','save_history','line_notify')),
  version TEXT NOT NULL,                         -- version of the text the visitor saw
  granted INTEGER NOT NULL,                      -- 1 gave, 0 withdrew
  at TEXT NOT NULL
);
CREATE INDEX consents_user ON consents(user_id, kind, id DESC);

CREATE TABLE deck_versions (
  version TEXT PRIMARY KEY,                      -- content hash of the deck the API was built with
  first_seen_at TEXT NOT NULL
);

CREATE TABLE readings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spread_id TEXT NOT NULL,
  question TEXT,
  reversed_enabled INTEGER NOT NULL DEFAULT 0,
  deck_version TEXT NOT NULL REFERENCES deck_versions(version),
  created_at TEXT NOT NULL
);
CREATE INDEX readings_user ON readings(user_id, created_at DESC, id);

CREATE TABLE reading_cards (
  reading_id TEXT NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
  position_index INTEGER NOT NULL,
  position_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  reversed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (reading_id, position_index),
  UNIQUE (reading_id, card_id)                   -- a card appears once per reading
);
CREATE INDEX reading_cards_card ON reading_cards(card_id);

CREATE TABLE reading_notes (
  reading_id TEXT PRIMARY KEY REFERENCES readings(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE line_subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  friend INTEGER NOT NULL DEFAULT 0,             -- 1 once the visitor has added the Official Account
  schedule TEXT NOT NULL DEFAULT 'weekly' CHECK (schedule IN ('daily','weekly')),
  hour INTEGER NOT NULL DEFAULT 19 CHECK (hour BETWEEN 0 AND 23),   -- Thai time
  weekday INTEGER NOT NULL DEFAULT 0 CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday, used when weekly
  last_sent_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,         -- consecutive refusals from LINE for this user; 3 in a row stops the reminders
  blocked_at TEXT
);
CREATE INDEX line_due ON line_subscriptions(enabled, friend) WHERE blocked_at IS NULL;

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bug','content','idea')),
  body TEXT NOT NULL,
  page TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','done')),
  created_at TEXT NOT NULL
);
