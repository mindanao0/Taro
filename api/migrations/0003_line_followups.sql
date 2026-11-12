-- Follow-up chat in LINE after the daily card: only a per-day counter and the topic of the thread are kept, never the question or the answer.
ALTER TABLE line_subscriptions ADD COLUMN ask_date TEXT;
ALTER TABLE line_subscriptions ADD COLUMN ask_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE line_subscriptions ADD COLUMN ask_topic TEXT;   -- topic of the day's thread: one of love, work, money, health, advice
