// Email/password accounts: register, verify, login, logout, password reset and change. Router and middleware live in ../index.js.
import {PBKDF2_ITERATIONS, hashPassword, randomToken, sha256Hex, verifyPassword} from './crypto.mjs';
import {clearedCookie, json, readJson, sessionCookie} from './http.mjs';
import {existsMail, resetMail, sendMail, verifyMail} from './mail.mjs';
import {SESSION_SECONDS, createSession, currentSession, deleteSession, deleteUserSessions} from './session.mjs';
import {audit, countEvents, iso, webUrl} from './util.mjs';
import {providerList} from './social.mjs';

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

export async function ipLimited(env, req) {   // the IP is only a rate-limit key, never stored
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

export async function register(req, env, ctx) {
  const b = await readJson(req);
  const email = cleanEmail(b?.email);
  if (!email) return json(400, {error: 'invalid_email'});
  const pwErr = passwordError(b.password, email);
  if (pwErr) return json(400, {error: pwErr});
  const termsVersion = typeof b.terms_version === 'string' && /^[\w.-]{1,20}$/.test(b.terms_version) ? b.terms_version : null;
  if (!termsVersion) return json(400, {error: 'terms_required'});   // signing up means accepting the terms and privacy policy, and we keep proof of which version
  const display = typeof b.display_name === 'string' ? b.display_name.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 60) || null : null;

  const hash = await hashPassword(b.password, iterationsOf(env));   // computed on both paths so timing does not reveal existing accounts
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    const token = await issueToken(env, existing.id, 'reset_password', RESET_MINUTES * 60_000);
    ctx.waitUntil(sendMail(env, {to: email, ...existsMail(`${webUrl(env)}/account.html#reset=${token}`)}));
  } else {
    const id = crypto.randomUUID(), now = iso();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, email_verified, display_name, created_at) VALUES (?, ?, 0, ?, ?)').bind(id, email, display, now),
      env.DB.prepare('INSERT INTO credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)').bind(id, hash, now),
      env.DB.prepare("INSERT INTO consents (user_id, kind, version, granted, at) VALUES (?, 'terms', ?, 1, ?), (?, 'privacy', ?, 1, ?)").bind(id, termsVersion, now, id, termsVersion, now)
    ]);
    await audit(env, 'register', {userId: id});
    const token = await issueToken(env, id, 'verify_email', VERIFY_HOURS * 3_600_000);
    ctx.waitUntil(sendMail(env, {to: email, ...verifyMail(`${webUrl(env)}/account.html#verify=${token}`)}));
  }
  // Same answer either way; the visitor logs in after registering.
  return json(201, {ok: true, message: 'check_email'});
}

export async function login(req, env) {
  const b = await readJson(req);
  const email = cleanEmail(b?.email);
  if (!email || typeof b.password !== 'string' || b.password.length > MAX_PASSWORD) return json(400, {error: 'invalid_request'});
  const subject = await sha256Hex(email);
  if (await countEvents(env, 'login_fail', subject, LOGIN_WINDOW_MIN * 60_000) >= LOGIN_FAILS) return json(429, {error: 'too_many_attempts'});

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.email_verified, u.display_name, u.avatar_url, u.deleted_at, c.password_hash
     FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.email = ?`).bind(email).first();
  const {ok, needsRehash} = await verifyPassword(b.password, row?.password_hash ?? await dummyFor(env), iterationsOf(env));
  if (!row || !ok) {
    await audit(env, 'login_fail', {userId: row?.id ?? null, subject});
    return json(401, {error: 'invalid_credentials'});
  }
  if (needsRehash) {
    await env.DB.prepare('UPDATE credentials SET password_hash = ?, updated_at = ? WHERE user_id = ?')
      .bind(await hashPassword(b.password, iterationsOf(env)), iso(), row.id).run();
  }
  const restored = !!row.deleted_at;   // the right password within the 30-day grace period brings a deleted account back
  await env.DB.prepare('UPDATE users SET last_login_at = ?, deleted_at = NULL WHERE id = ?').bind(iso(), row.id).run();
  await audit(env, restored ? 'restore' : 'login', {userId: row.id});
  const token = await createSession(env, row.id, req.headers.get('user-agent'));
  return json(200, {user: publicUser(row), restored}, {'set-cookie': sessionCookie(token, SESSION_SECONDS)});
}

export async function logout(req, env) {
  const s = await currentSession(env, req);
  if (s) { await deleteSession(env, s.sessionId); await audit(env, 'logout', {userId: s.user.id}); }
  return json(204, undefined, {'set-cookie': clearedCookie()});
}

export async function verifyEmail(req, env) {
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

export async function forgotPassword(req, env, ctx) {
  const b = await readJson(req);
  const email = cleanEmail(b?.email);
  if (!email) return json(400, {error: 'invalid_email'});
  const subject = await sha256Hex(email);
  // Always the same answer, whether or not the address has an account.
  if (await countEvents(env, 'reset_request', subject, 3_600_000) < RESETS_PER_HOUR) {
    await audit(env, 'reset_request', {subject});
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();   // deleted accounts too: the reset link also restores them
    if (user) {
      await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset_password' AND used_at IS NULL").bind(iso(), user.id).run();
      const token = await issueToken(env, user.id, 'reset_password', RESET_MINUTES * 60_000);
      ctx.waitUntil(sendMail(env, {to: email, ...resetMail(`${webUrl(env)}/account.html#reset=${token}`)}));
    }
  }
  return json(202, {ok: true});
}

export async function resetPassword(req, env) {
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
    env.DB.prepare('UPDATE users SET email_verified = 1, deleted_at = NULL WHERE id = ?').bind(userId)   // the link went to this address, so it proves control of it (and restores an account deleted within the grace period)
  ]);
  await deleteUserSessions(env, userId);   // every device is signed out
  await audit(env, 'pw_reset', {userId});
  return json(204);
}

// Re-send the verification link to the signed-in user's own address (3 per hour).
export async function resendVerification(req, env, ctx, s) {
  if (!s.user.email) return json(409, {error: 'no_email'});
  if (s.user.email_verified) return json(409, {error: 'already_verified'});
  const subject = await sha256Hex(s.user.id);
  if (await countEvents(env, 'verify_request', subject, 3_600_000) >= 3) return json(429, {error: 'too_many_requests'});
  await audit(env, 'verify_request', {userId: s.user.id, subject});
  await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'verify_email' AND used_at IS NULL").bind(iso(), s.user.id).run();
  const token = await issueToken(env, s.user.id, 'verify_email', VERIFY_HOURS * 3_600_000);
  ctx.waitUntil(sendMail(env, {to: s.user.email, ...verifyMail(`${webUrl(env)}/account.html#verify=${token}`)}));
  return json(202, {ok: true});
}

export async function me(req, env) {
  const s = await currentSession(env, req);
  if (!s) return json(401, {error: 'not_signed_in'});
  const ids = await env.DB.prepare('SELECT provider, created_at FROM identities WHERE user_id = ?').bind(s.user.id).all();
  const cred = await env.DB.prepare('SELECT 1 AS x FROM credentials WHERE user_id = ?').bind(s.user.id).first();
  return json(200, {user: s.user, has_password: !!cred, identities: (ids.results ?? ids).map(r => r.provider), providers_available: providerList(env)});
}

export async function changePassword(req, env) {
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

