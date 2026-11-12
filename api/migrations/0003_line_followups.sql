-- Follow-up questions in the LINE chat after the daily card: only a per-day counter is kept, never the question or the answer.
ALTER TABLE line_subscriptions ADD COLUMN ask_date TEXT;
ALTER TABLE line_subscriptions ADD COLUMN ask_count INTEGER NOT NULL DEFAULT 0;
