// Cloudflare Worker `taro-api`: accounts and email/password login (docs/07). Social login arrives in the next phase.
import {PBKDF2_ITERATIONS, hashPassword, randomToken, sha256Hex, verifyPassword} from './lib/crypto.mjs';
import {clearedCookie, json, originsOf, readJson, sessionCookie} from './lib/http.mjs';
import {existsMail, resetMail, sendMail, verifyMail} from './lib/mail.mjs';
import {SESSION_SECONDS, createSession, currentSession, deleteSession, deleteUserSessions} from './lib/session.mjs';

const VERIFY_HOURS = 24, RESET_MINUTES = 30;
const LOGIN_FAILS = 10, LOGIN_WINDOW_MIN = 15;     // per email, on top of the per-IP limiter
const RESETS_PER_HOUR = 3;
const MIN_PASSWORD = 10, MAX_PASSWORD = 128;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const iterationsOf = env => Number(env.PBKDF2_ITERATIONS) || PBKDF2_ITERATIONS;
const webUrl = env => (env.WEB_URL || 'https://ivoryrosetarot.online').replace(/\/$/, '');

const cleanEmail = v => {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};
const passwordError = (pw, email) =>
  typeof pw !== 'string' || pw.length < MIN_PASSWORD ? 'password_too_short'
  : pw.length > MAX_PASSWORD ? 'password_too_long'
  : email && pw.toLowerCase() === email ? 'password_is_email' : null;

async function audit(env, event, {userId = null, subject = null, provider = null} = {}) {
  await env.DB.prepare('INSERT INTO audit_log (user_id, event, subject, provider, at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, event, subject, provider, iso()).run();
}
const countEvents = async (env, event, subject, sinceMs) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE event = ? AND subject = ? AND at > ?').bind(event, subject, iso(Date.now() - sinceMs)).first()).n;

async function ipLimited(env, req) {   // the IP is only a rate-limit key, never stored
  if (!env.AUTH_LIMITER) return false;
  const {success} = await env.AUTH_LIMITER.limit({key: req.headers.get('cf-connecting-ip') || 'unknown'});
  return !success;
}

async function issueToken(env, userId, purpose, ttlMs) {
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO email_tokens (id, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, purpose, iso(Date.now() + ttlMs)).run();
  return token;
}
// Marks a valid, unused, unexpired token as used and returns its user id (single use even under concurrent requests).
async function consumeToken(env, token, purpose) {
  if (typeof token !== 'string' || token.length > 128) return null;
  const id = await sha256Hex(token), now = iso();
  const res = await env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?')
    .bind(now, id, purpose, now).run();
  if (!(res.meta?.changes ?? res.changes)) return null;
  return (await env.DB.prepare('SELECT user_id FROM email_tokens WHERE id = ?').bind(id).first())?.user_id ?? null;
}

let dummyHash;   // verified against when the email is unknown, so unknown and wrong-password take similar time
const dummyFor = async env => (dummyHash ||= await hashPassword('not-a-real-password', iterationsOf(env)));

const publicUser = u => ({id: u.id, email: u.email, email_verified: !!u.email_verified, display_name: u.display_name, avatar_url: u.avatar_url});

/* ---------------- handlers ---------------- */

async function register(req, env, ctx) {
  const b = await readJson(req);
  const email = cleanEmail(b?.email);
  if (!email) return json(400, {error: 'invalid_email'});
  const pwErr = passwordError(b.password, email);
  if (pwErr) return json(400, {error: pwErr});
  const display = typeof b.display_name === 'string' ? b.display_name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 60) || null : null;

  const hash = await hashPassword(b.password, iterationsOf(env));   // computed on both paths so timing does not reveal existing accounts
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    const token = await issueToken(env, existing.id, 'reset_password', RESET_MINUTES * 60_000);
    ctx.waitUntil(sendMail(env, {to: email, ...existsMail(`${webUrl(env)}/account.html#reset=${token}`)}));
  } else {
    const id = crypto.randomUUID(), now = iso();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, email_verified, display_name, created_at) VALUES (?, ?, 0, ?, ?)').bind(id, email, display, now),
      env.DB.prepare('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)').bind(id, hash, now)
    ]);
    await audit(env, 'register', {userId: id});
    const token = await issueToken(env, id, 'verify_email', VERIFY_HOURS * 3_600_000);
    ctx.waitUntil(sendMail(env, {to: email, ...verifyMail(`${webUrl(env)}/account.html#verify=${token}`)}));
  }
  // Same answer either way; the visitor logs in after registering.
  return json(201, {ok: true, message: 'check_email'});
}

async function login(req, env) {
  const b = await readJson(req);
  const email = cleanEmail(b?.email);
  if (!email || typeof b.password !== 'string' || b.password.length > MAX_PASSWORD) return json(400, {error: 'invalid_request'});
  const subject = await sha256Hex(email);
  if (await countEvents(env, 'login_fail', subject, LOGIN_WINDOW_MIN * 60_000) >= LOGIN_FAILS) return json(429, {error: 'too_many_attempts'});

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.email_verified, u.display_name, u.avatar_url, c.password_hash
     FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.email = ? AND u.deleted_at IS NULL`).bind(email).first();
  const {ok, needsRehash} = await verifyPassword(b.password, row?.password_hash ?? await dummyFor(env), iterationsOf(env));
  if (!row || !ok) {
    await audit(env, 'login_fail', {userId: row?.id ?? null, subject});
    return json(401, {error: 'invalid_credentials'});
  }
  if (needsRehash) {
    await env.DB.prepare('UPDATE credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?')
      .bind(await hashPassword(b.password, iterationsOf(env)), iso(), row.id).run();
  }
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(iso(), row.id).run();
  await audit(env, 'login', {userId: row.id});
  const token = await createSession(env, row.id, req.headers.get('user-agent'));
  return json(200, {user: publicUser(row)}, {'set-cookie': sessionCookie(token, SESSION_SECONDS)});
}

async function logout(req, env) {
  const s = await currentSession(env, req);
  if (s) { await deleteSession(env, s.sessionId); await audit(env, 'logout', {userId: s.user.id}); }
  return json(204, undefined, {'set-cookie': clearedCookie()});
}

async function verifyEmail(req, env) {
  const b = await readJson(req);
  const userId = await consumeToken(env, b?.token, 'verify_email');
  if (!userId) return json(400, {error: 'invalid_or_expired_token'});
  await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
  await audit(env, 'verify_email', {userId});
  return json(204);
}

async function forgotPassword(req, env, ctx) {
  const b = await readJson(req);
  const email = cleanEmail(b?.email);
  if (!email) return json(400, {error: 'invalid_email'});
  const subject = await sha256Hex(email);
  // Always the same answer, whether or not the address has an account.
  if (await countEvents(env, 'reset_request', subject, 3_600_000) < RESETS_PER_HOUR) {
    await audit(env, 'reset_request', {subject});
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').bind(email).first();
    if (user) {
      await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset_password' AND used_at IS NULL").bind(iso(), user.id).run();
      const token = await issueToken(env, user.id, 'reset_password', RESET_MINUTES * 60_000);
      ctx.waitUntil(sendMail(env, {to: email, ...resetMail(`${webUrl(env)}/account.html#reset=${token}`)}));
    }
  }
  return json(202, {ok: true});
}

async function resetPassword(req, env) {
  const b = await readJson(req);
  const pwErr = passwordError(b?.password);
  if (pwErr) return json(400, {error: pwErr});
  const userId = await consumeToken(env, b.token, 'reset_password');
  if (!userId) return json(400, {error: 'invalid_or_expired_token'});
  const now = iso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at')
      .bind(userId, await hashPassword(b.password, iterationsOf(env)), now),
    env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId)   // the link went to this address, so it proves control of it
  ]);
  await deleteUserSessions(env, userId);   // every device is signed out
  await audit(env, 'pw_reset', {userId});
  return json(204);
}

async function me(req, env) {
  const s = await currentSession(env, req);
  if (!s) return json(401, {error: 'not_signed_in'});
  const ids = await env.DB.prepare('SELECT provider, created_at FROM identities WHERE user_id = ?').bind(s.user.id).all();
  const cred = await env.DB.prepare('SELECT 1 AS x FROM credentials WHERE user_id = ?').bind(s.user.id).first();
  return json(200, {user: s.user, has_password: !!cred, identities: (ids.results ?? ids).map(r => r.provider)});
}

async function changePassword(req, env) {
  const s = await currentSession(env, req);
  if (!s) return json(401, {error: 'not_signed_in'});
  const b = await readJson(req);
  const pwErr = passwordError(b?.password, s.user.email);
  if (pwErr) return json(400, {error: pwErr});
  const cred = await env.DB.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').bind(s.user.id).first();
  if (cred) {   // a social-only user setting a first password has nothing to confirm
    const {ok} = typeof b.current === 'string' ? await verifyPassword(b.current, cred.password_hash, iterationsOf(env)) : {ok: false};
    if (!ok) return json(403, {error: 'wrong_current_password'});
  }
  await env.DB.prepare('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at')
    .bind(s.user.id, await hashPassword(b.password, iterationsOf(env)), iso()).run();
  await deleteUserSessions(env, s.user.id, s.sessionId);   // other devices are signed out, this one stays
  await audit(env, 'pw_change', {userId: s.user.id});
  return json(204);
}

const ROUTES = {
  'POST /auth/register': [register, true], 'POST /auth/login': [login, true], 'POST /auth/logout': [logout, false],
  'POST /auth/verify-email': [verifyEmail, true], 'POST /auth/forgot-password': [forgotPassword, true], 'POST /auth/reset-password': [resetPassword, true],
  'GET /me': [me, false], 'POST /me/password': [changePassword, false]
};

export async function maintain(env, now = new Date()) {
  const t = now.toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM email_tokens WHERE expires_at < ? OR used_at IS NOT NULL').bind(new Date(now.getTime() - 86_400_000).toISOString()),
    env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(new Date(now.getTime() - 90 * 86_400_000).toISOString())
  ]);
}

export default {
  async fetch(req, env, ctx) {
    const origins = originsOf(env), origin = req.headers.get('origin');
    const allowed = origins.has(origin);
    const cors = allowed ? {'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin'} : {vary: 'Origin'};

    if (req.method === 'OPTIONS') {
      return allowed ? new Response(null, {status: 204, headers: {...cors, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600'}})
        : new Response(null, {status: 403});
    }
    const route = ROUTES[`${req.method} ${new URL(req.url).pathname}`];
    let res;
    try {
      if (!route) res = json(404, {error: 'not_found'});
      else if (req.method === 'POST' && (!allowed || !(req.headers.get('content-type') || '').includes('application/json'))) res = json(403, {error: 'forbidden'});   // CSRF guard: browsers cannot forge Origin or send JSON cross-site without CORS approval
      else if (route[1] && await ipLimited(env, req)) res = json(429, {error: 'rate_limited'});
      else res = await route[0](req, env, ctx);
    } catch (e) {
      console.error('unhandled', e?.message);   // message only: stack and inputs may hold secrets
      res = json(500, {error: 'server_error'});
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(maintain(env)); }
};
