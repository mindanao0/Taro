import {randomToken, sha256Hex} from './crypto.mjs';
import {SESSION_COOKIE, readCookie} from './http.mjs';

export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 86400;
const RENEW_AFTER_MS = 86_400_000;   // slide the expiry at most once a day to avoid a write on every request

const iso = (ms = Date.now()) => new Date(ms).toISOString();

export async function createSession(env, userId, userAgent) {
  const token = randomToken(32);
  const now = iso();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, iso(Date.now() + SESSION_SECONDS * 1000), now, (userAgent || '').slice(0, 200) || null).run();
  return token;
}

// Returns {user, sessionId} for a valid cookie, else null. Deleted users and expired sessions never match.
export async function currentSession(env, req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.email, u.email_verified, u.display_name, u.avatar_url
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.deleted_at IS NULL`).bind(id, iso()).first();
  if (!row) return null;
  if (Date.now() - Date.parse(row.last_seen_at) > RENEW_AFTER_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(iso(), iso(Date.now() + SESSION_SECONDS * 1000), id).run();
  }
  return {sessionId: id, user: {id: row.id, email: row.email, email_verified: !!row.email_verified, display_name: row.display_name, avatar_url: row.avatar_url}};
}

export const deleteSession = (env, id) => env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
export const deleteUserSessions = (env, userId, exceptId = '') =>
  env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(userId, exceptId).run();
