-- Accounts and login methods (docs/07). One user can have several ways to log in.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE,             -- NULL for social-only users who gave no email
  email_verified INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  deleted_at TEXT
);

CREATE TABLE identities (                        -- Google / LINE / Facebook (used from phase 3)
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google','line','facebook')),
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX identities_user ON identities(user_id);

CREATE TABLE credentials (                       -- password login; absent for social-only users
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,                   -- pbkdf2-sha256$iterations$salt$hash
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                           -- sha256 of the cookie token; the token itself is never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_exp ON sessions(expires_at);

CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,                           -- sha256 of the token in the emailed link
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password','change_email')),
  new_email TEXT,                                -- change_email only: the address being proven; users.email changes when the link is used
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL,                           -- register, login, login_fail, logout, verify_email, reset_request, pw_reset, pw_change
  subject TEXT,                                  -- sha256 of the email for events without a user; used for throttling, not reversible
  provider TEXT,
  at TEXT NOT NULL
);
CREATE INDEX audit_subject ON audit_log(event, subject, at);
CREATE INDEX audit_user ON audit_log(user_id, at);
