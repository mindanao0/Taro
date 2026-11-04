// Cloudflare Worker `taro-api`: accounts, email/password and social login, per-user data (docs/07, docs/08).
import {PBKDF2_ITERATIONS, hashPassword, randomToken, sha256Hex, verifyPassword} from './lib/crypto.mjs';
import {clearedCookie, json, originsOf, readJson, sessionCookie} from './lib/http.mjs';
import {existsMail, resetMail, sendMail, verifyMail} from './lib/mail.mjs';
import {SESSION_SECONDS, createSession, currentSession, deleteSession, deleteUserSessions} from './lib/session.mjs';
import {audit, countEvents, iso, webUrl} from './lib/util.mjs';
import {providerList, socialCallback, socialStart} from './lib/social.mjs';
import {deleteAccount, exportData, getConsents, requestEmailChange, setConsent, unlinkIdentity} from './lib/account.mjs';
import {authed} from './lib/util.mjs';
import {addFavorite, deleteReading, getReading, listFavorites, listReadings, removeFavorite, saveReading, setNote} from './lib/readings.mjs';
import {dailyCard} from './lib/daily.mjs';

const VERIFY_HOURS = 24, RESET_MINUTES = 30;
const LOGIN_FAILS = 10, LOGIN_WINDOW_MIN = 15;     // per email, on top of the per-IP limiter
const RESETS_PER_HOUR = 3;
const MIN_PASSWORD = 10, MAX_PASSWORD = 128;

const iterationsOf = env => Number(env.PBKDF2_ITERATIONS) || PBKDF2_ITERATIONS;

const cleanEmail = v => {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};
const passwordError = (pw, email) =>
  typeof pw !== 'string' || pw.length < MIN_PASSWORD ? 'password_too_short'
  : pw.length > MAX_PASSWORD ? 'password_too_long'
  : email && pw.toLowerCase() === email ? 'password_is_email' : null;

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
// Marks a valid, unused, unexpired token as used and returns {user_id, purpose, new_email} (single use even under concurrent requests).
async function consumeToken(env, token, purposes) {
  if (typeof token !== 'string' || token.length > 128) return null;
  const now = iso();
  const marks = purposes.map(() => '?').join(', ');
  return await env.DB.prepare(`UPDATE email_tokens SET used_at = ? WHERE id = ? AND purpose IN (${marks}) AND used_at IS NULL AND expires_at > ? RETURNING user_id, purpose, new_email`)
    .bind(now, await sha256Hex(token), ...purposes, now).first();
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
  const t = await consumeToken(env, b?.token, ['verify_email', 'change_email']);
  if (!t) return json(400, {error: 'invalid_or_expired_token'});
  if (t.purpose === 'change_email') {
    const taken = await env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ? AND id != ?').bind(t.new_email, t.user_id).first();
    if (taken) return json(409, {error: 'email_in_use'});   // someone else claimed it while the link was pending
    await env.DB.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?').bind(t.new_email, t.user_id).run();
  } else {
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(t.user_id).run();
  }
  await audit(env, 'verify_email', {userId: t.user_id});
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
  const used = await consumeToken(env, b.token, ['reset_password']);
  if (!used) return json(400, {error: 'invalid_or_expired_token'});
  const userId = used.user_id;
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
  return json(200, {user: s.user, has_password: !!cred, identities: (ids.results ?? ids).map(r => r.provider), providers_available: providerList(env)});
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

// [method, path pattern, handler, options]  options: limit = per-IP auth limiter, csrf = false for non-browser callers
const ROUTES = [
  ['POST', '/auth/register', register, {limit: true}], ['POST', '/auth/login', login, {limit: true}], ['POST', '/auth/logout', logout],
  ['POST', '/auth/verify-email', verifyEmail, {limit: true}], ['POST', '/auth/forgot-password', forgotPassword, {limit: true}], ['POST', '/auth/reset-password', resetPassword, {limit: true}],
  ['GET', '/auth/:provider/start', socialStart, {limit: true, csrf: false}], ['GET', '/auth/:provider/callback', socialCallback, {csrf: false}],
  ['GET', '/me', me], ['POST', '/me/password', changePassword], ['POST', '/me/email', authed(requestEmailChange), {limit: true}],
  ['DELETE', '/me/identities/:provider', authed(unlinkIdentity)],
  ['GET', '/me/consents', authed(getConsents)], ['POST', '/me/consents', authed(setConsent)],
  ['GET', '/me/export', authed(exportData)], ['POST', '/me/delete', authed(deleteAccount)],
  ['GET', '/content/daily', dailyCard],
  ['POST', '/me/readings', authed(saveReading)], ['GET', '/me/readings', authed(listReadings)], ['GET', '/me/readings/:id', authed(getReading)],
  ['PUT', '/me/readings/:id/note', authed(setNote)], ['DELETE', '/me/readings/:id', authed(deleteReading)],
  ['GET', '/me/favorites', authed(listFavorites)], ['PUT', '/me/favorites/:card_id', authed(addFavorite)], ['DELETE', '/me/favorites/:card_id', authed(removeFavorite)]
];
export const addRoutes = list => ROUTES.push(...list);

function match(method, path) {
  for (const [m, pattern, handler, opts = {}] of ROUTES) {
    if (m !== method) continue;
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    const hit = re.exec(path);
    if (hit) return {handler, opts, params: {...hit.groups}};
  }
  return null;
}

export async function maintain(env, now = new Date()) {
  const t = now.toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM email_tokens WHERE expires_at < ? OR used_at IS NOT NULL').bind(new Date(now.getTime() - 86_400_000).toISOString()),
    env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(new Date(now.getTime() - 90 * 86_400_000).toISOString()),
    env.DB.prepare('DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(new Date(now.getTime() - 30 * 86_400_000).toISOString())   // cascades to every row of that user
  ]);
}

export default {
  async fetch(req, env, ctx) {
    const origins = originsOf(env), origin = req.headers.get('origin');
    const allowed = origins.has(origin);
    const cors = allowed ? {'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin'} : {vary: 'Origin'};

    if (req.method === 'OPTIONS') {
      return allowed ? new Response(null, {status: 204, headers: {...cors, 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600'}})
        : new Response(null, {status: 403});
    }
    const hit = match(req.method, new URL(req.url).pathname);
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    let res;
    try {
      if (!hit) res = json(404, {error: 'not_found'});
      // CSRF guard: a browser cannot forge Origin, and cannot send JSON cross-site without CORS approval. Calls from other servers (LINE) opt out and prove themselves another way.
      else if (mutating && hit.opts.csrf !== false && (!allowed || (req.method !== 'DELETE' && !(req.headers.get('content-type') || '').includes('application/json')))) res = json(403, {error: 'forbidden'});
      else if (hit.opts.limit && await ipLimited(env, req)) res = json(429, {error: 'rate_limited'});
      else res = await hit.handler(req, env, ctx, hit.params);
    } catch (e) {
      console.error('unhandled', e?.message);   // message only: stack and inputs may hold secrets
      res = json(500, {error: 'server_error'});
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(maintain(env)); }
};
