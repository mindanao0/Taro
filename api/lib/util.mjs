import {hmac} from './crypto.mjs';
import {json} from './http.mjs';
import {currentSession} from './session.mjs';

export const iso = (ms = Date.now()) => new Date(ms).toISOString();

export async function audit(env, event, {userId = null, subject = null, provider = null} = {}) {
  await env.DB.prepare('INSERT INTO audit_log (user_id, event, subject, provider, at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, event, subject, provider, iso()).run();
}

export const countEvents = async (env, event, subject, sinceMs) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE event = ? AND subject = ? AND at > ?').bind(event, subject, iso(Date.now() - sinceMs)).first()).n;

// Wraps a handler that needs a signed-in user: handler(req, env, ctx, session, params)
export const authed = handler => async (req, env, ctx, params) => {
  const s = await currentSession(env, req);
  return s ? handler(req, env, ctx, s, params) : json(401, {error: 'not_signed_in'});
};

export const webUrl = env => (env.WEB_URL || 'https://ivoryrosetarot.online').replace(/\/$/, '');
export const apiUrl = env => (env.API_URL || 'https://api.ivoryrosetarot.online').replace(/\/$/, '');

export const cleanText = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';

// Keyed one-way tag for rate-limit counters. Built from values we do not want to store (email, IP): without COOKIE_SECRET
// it cannot be reversed by guessing, even for the small IPv4 space.
export async function pseudonym(env, ...parts) {
  return [...await hmac(env.COOKIE_SECRET || 'unset-cookie-secret', parts.join('\u0000'))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// At most 3 emails per address per hour from flows anyone can trigger for someone else's address (sign-up, email change).
// Returns true when sending is allowed and records the attempt; callers answer the visitor the same way either way.
export async function mailAllowed(env, email) {
  const subject = await pseudonym(env, 'mail', email.toLowerCase());
  if (await countEvents(env, 'mail_request', subject, 3_600_000) >= 3) return false;
  await audit(env, 'mail_request', {subject});
  return true;
}

// Sensitive account changes by a session that has no password to confirm with need a recent sign-in instead.
export const RECENT_LOGIN_MS = 10 * 60_000;
export const isRecentLogin = s => Date.now() - Date.parse(s.startedAt) <= RECENT_LOGIN_MS;

// Brings back an account deleted within the 30-day grace period. Used as a statement so it can join a batch.
export const restoreStatement = (env, userId) => env.DB.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').bind(userId);

// Password-reset links die when the address, the password or the account state changes under them.
export const revokeResetTokens = (env, userId) =>
  env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset_password' AND used_at IS NULL").bind(iso(), userId).run();
