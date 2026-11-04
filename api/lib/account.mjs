// Account management for a signed-in user: unlink a login method, change email, consents, export, delete.
import {sha256Hex, randomToken, verifyPassword, PBKDF2_ITERATIONS} from './crypto.mjs';
import {json, readJson} from './http.mjs';
import {existsMail, sendMail, verifyMail} from './mail.mjs';
import {deleteSession, deleteUserSessions} from './session.mjs';
import {audit, iso, webUrl} from './util.mjs';

const iterationsOf = env => Number(env.PBKDF2_ITERATIONS) || PBKDF2_ITERATIONS;
export const CONSENT_KINDS = new Set(['terms', 'privacy', 'save_history', 'line_notify']);

export async function unlinkIdentity(req, env, _ctx, s, params) {
  const provider = params.provider;
  const have = await env.DB.prepare('SELECT 1 AS x FROM identities WHERE user_id = ? AND provider = ?').bind(s.user.id, provider).first();
  if (!have) return json(404, {error: 'not_linked'});
  const ids = (await env.DB.prepare('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?').bind(s.user.id).first()).n;
  const pw = await env.DB.prepare('SELECT 1 AS x FROM credentials WHERE user_id = ?').bind(s.user.id).first();
  if (ids + (pw ? 1 : 0) < 2) return json(409, {error: 'last_login_method'});   // never lock the user out of their own account
  await env.DB.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').bind(s.user.id, provider).run();
  if (provider === 'line') await env.DB.prepare('DELETE FROM line_subscriptions WHERE user_id = ?').bind(s.user.id).run();   // reminders need the LINE id
  await audit(env, 'unlink', {userId: s.user.id, provider});
  return json(204);
}

// Add or change the sign-in email. The new address only becomes users.email after its owner opens the emailed link.
export async function requestEmailChange(req, env, ctx, s) {
  const b = await readJson(req);
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, {error: 'invalid_email'});
  const cred = await env.DB.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').bind(s.user.id).first();
  if (cred) {
    const ok = typeof b.password === 'string' && (await verifyPassword(b.password, cred.password_hash, iterationsOf(env))).ok;
    if (!ok) return json(403, {error: 'wrong_password'});
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(email, s.user.id).first();
  if (taken) {   // same answer as success, so this cannot be used to probe which addresses have accounts
    ctx.waitUntil(sendMail(env, {to: email, ...existsMail(`${webUrl(env)}/account.html`)}));
    return json(202, {ok: true});
  }
  await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'change_email' AND used_at IS NULL").bind(iso(), s.user.id).run();
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO email_tokens (id, user_id, purpose, new_email, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), s.user.id, 'change_email', email, iso(Date.now() + 24 * 3_600_000)).run();
  ctx.waitUntil(sendMail(env, {to: email, ...verifyMail(`${webUrl(env)}/account.html#verify=${token}`)}));
  return json(202, {ok: true});
}

export async function getConsents(req, env, _ctx, s) {
  const rows = await env.DB.prepare(
    `SELECT c.kind, c.version, c.granted, c.at FROM consents c
     WHERE c.user_id = ? AND c.id = (SELECT MAX(id) FROM consents WHERE user_id = c.user_id AND kind = c.kind)`).bind(s.user.id).all();
  return json(200, {consents: (rows.results ?? rows).map(r => ({kind: r.kind, version: r.version, granted: !!r.granted, at: r.at}))});
}

export async function setConsent(req, env, _ctx, s) {
  const b = await readJson(req);
  if (!b || !CONSENT_KINDS.has(b.kind) || typeof b.granted !== 'boolean' || typeof b.version !== 'string' || !/^[\w.-]{1,20}$/.test(b.version)) return json(400, {error: 'invalid_request'});
  await env.DB.prepare('INSERT INTO consents (user_id, kind, version, granted, at) VALUES (?, ?, ?, ?, ?)').bind(s.user.id, b.kind, b.version, b.granted ? 1 : 0, iso()).run();
  if (b.kind === 'line_notify' && !b.granted) await env.DB.prepare('UPDATE line_subscriptions SET enabled = 0 WHERE user_id = ?').bind(s.user.id).run();   // withdrawing stops the reminders at once
  return json(204);
}
export const hasConsent = async (env, userId, kind) =>
  !!(await env.DB.prepare('SELECT granted FROM consents WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 1').bind(userId, kind).first())?.granted;

// Everything stored about the user, as one JSON download (PDPA access/portability).
export async function exportData(req, env, _ctx, s) {
  const id = s.user.id, q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results ?? [];
  const readings = await q('SELECT id, spread_id, question, reversed_enabled, deck_version, created_at FROM readings WHERE user_id = ? ORDER BY created_at', id);
  const cards = await q('SELECT rc.reading_id, rc.position_index, rc.position_id, rc.card_id, rc.reversed FROM reading_cards rc JOIN readings r ON r.id = rc.reading_id WHERE r.user_id = ? ORDER BY rc.reading_id, rc.position_index', id);
  const notes = await q('SELECT n.reading_id, n.body, n.updated_at FROM reading_notes n JOIN readings r ON r.id = n.reading_id WHERE r.user_id = ?', id);
  const data = {
    exported_at: iso(),
    user: await env.DB.prepare('SELECT id, email, email_verified, display_name, avatar_url, created_at, last_login_at FROM users WHERE id = ?').bind(id).first(),
    login_methods: {password: !!(await env.DB.prepare('SELECT 1 AS x FROM credentials WHERE user_id = ?').bind(id).first()),
      social: await q('SELECT provider, email, created_at FROM identities WHERE user_id = ?', id)},
    consents: await q('SELECT kind, version, granted, at FROM consents WHERE user_id = ? ORDER BY id', id),
    readings: readings.map(r => ({...r, reversed_enabled: !!r.reversed_enabled,
      cards: cards.filter(c => c.reading_id === r.id).map(c => ({position_id: c.position_id, card_id: c.card_id, reversed: !!c.reversed})),
      note: notes.find(n => n.reading_id === r.id)?.body ?? null})),
    favorites: await q('SELECT card_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at', id),
    line_reminder: await env.DB.prepare('SELECT enabled, friend, schedule, hour, weekday, last_sent_at FROM line_subscriptions WHERE user_id = ?').bind(id).first(),
    security_events: await q('SELECT event, provider, at FROM audit_log WHERE user_id = ? ORDER BY id', id)
  };
  return new Response(JSON.stringify(data, null, 2), {status: 200, headers: {'content-type': 'application/json', 'content-disposition': 'attachment; filename="taro-my-data.json"', 'cache-control': 'no-store'}});
}

// Account deletion: sign out everywhere now; rows are purged after 30 days by the nightly job (see maintain).
export async function deleteAccount(req, env, _ctx, s) {
  const b = await readJson(req);
  if (b?.confirm !== 'DELETE') return json(400, {error: 'confirmation_required'});
  const cred = await env.DB.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').bind(s.user.id).first();
  if (cred && !(typeof b.password === 'string' && (await verifyPassword(b.password, cred.password_hash, iterationsOf(env))).ok)) return json(403, {error: 'wrong_password'});
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').bind(iso(), s.user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(s.user.id),
    env.DB.prepare('DELETE FROM email_tokens WHERE user_id = ?').bind(s.user.id),
    env.DB.prepare('DELETE FROM line_subscriptions WHERE user_id = ?').bind(s.user.id)
  ]);
  await audit(env, 'delete_account', {userId: s.user.id});
  return json(204, undefined, {'set-cookie': '__Host-taro_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'});
}
