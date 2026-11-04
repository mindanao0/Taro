// Restoring a deleted account, listing and revoking signed-in devices, and the display name.
import assert from 'node:assert/strict';
import {client, makeEnv, tokenFrom} from './helpers.mjs';
import {resolveSocial} from '../lib/social.mjs';
import {maintain} from '../index.js';

const PW = 'a long test passphrase';
const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const count = (env, t, w = '') => row(env, `SELECT COUNT(*) n FROM ${t} ${w}`).n;
const login = (c, email, pw = PW) => c.post('/auth/login', {email, password: pw});
async function member(env, email) {
  const c = client(env);
  await c.post('/auth/register', {email, password: PW});
  await login(c, email);
  return c;
}

/* ---- restore by password ---- */
{
  const env = makeEnv(), c = await member(env, 'back@example.com');
  await c.post('/me/consents', {kind: 'save_history', version: '1', granted: true});
  await c.post('/me/readings', {spread_id: 'single', reversed_enabled: false, cards: [{position_id: 'p1', card_id: 'major-18', orientation: 'upright'}]});
  await c.put('/me/favorites/cups-ace', {});
  env.db.prepare("INSERT INTO identities (id, user_id, provider, provider_user_id, created_at) VALUES ('i1', (SELECT id FROM users), 'line', 'U1', '2026-01-01')").run();
  env.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, friend) SELECT id, 'U1', 1 FROM users").run();
  assert.equal((await c.post('/me/delete', {confirm: 'DELETE', password: PW})).status, 204);
  assert.equal((await c.get('/me')).status, 401);
  assert.equal(count(env, 'line_subscriptions'), 0, 'reminders stop when the account is deleted');

  const other = client(env);
  assert.equal((await login(other, 'back@example.com', 'not the password')).status, 401, 'a wrong password restores nothing');
  assert.ok(row(env, 'SELECT deleted_at FROM users').deleted_at);

  const r = await login(other, 'back@example.com');
  assert.equal(r.status, 200); assert.equal(r.data.restored, true);
  assert.equal(row(env, 'SELECT deleted_at FROM users').deleted_at, null);
  assert.equal((await other.get('/me')).status, 200);
  assert.equal((await other.get('/me/readings')).data.readings.length, 1, 'the history came back with the account');
  assert.equal((await other.get('/me/favorites')).data.favorites.length, 1);
  assert.equal(count(env, 'line_subscriptions'), 0, 'reminders stay off until the user turns them on again');
  assert.equal(row(env, "SELECT COUNT(*) n FROM audit_log WHERE event = 'restore'").n, 1);
  assert.equal((await login(client(env), 'back@example.com')).data.restored, false, 'a normal login says so');

  // too late: after the 30 days everything is gone and the address can be used again
  await other.post('/me/delete', {confirm: 'DELETE', password: PW});
  env.db.prepare("UPDATE users SET deleted_at = '2000-01-01T00:00:00.000Z'").run();
  await maintain(env);
  assert.equal(count(env, 'users'), 0); assert.equal(count(env, 'readings'), 0);
  assert.equal((await login(client(env), 'back@example.com')).status, 401);
  assert.equal((await client(env).post('/auth/register', {email: 'back@example.com', password: PW})).status, 201);
  assert.match(env.mails.at(-1).subject, /ยืนยันอีเมล/, 'a fresh sign-up, not an "already exists" mail');
}

/* ---- restore by password reset (proves the mailbox) ---- */
{
  const env = makeEnv(), c = await member(env, 'reset@example.com');
  await c.post('/me/delete', {confirm: 'DELETE', password: PW});
  assert.equal((await client(env).post('/auth/forgot-password', {email: 'reset@example.com'})).status, 202);
  const tok = tokenFrom(env.mails, 'reset');
  assert.ok(tok, 'a deleted account can still ask for a reset link');
  assert.equal((await client(env).post('/auth/reset-password', {token: tok, password: 'brand new passphrase'})).status, 204);
  assert.equal(row(env, 'SELECT deleted_at FROM users').deleted_at, null);
  assert.equal((await login(client(env), 'reset@example.com', 'brand new passphrase')).data.restored, false);

  // signing up again with the address of a deleted account mails the "already exists" note with a link, and says restoring is possible
  const c2 = await member(env, 'again@example.com');
  await c2.post('/me/delete', {confirm: 'DELETE', password: PW});
  await client(env).post('/auth/register', {email: 'again@example.com', password: PW});
  assert.match(env.mails.at(-1).text, /30 วัน/); assert.equal(count(env, 'users'), 2, 'no duplicate account');
}

/* ---- restore through a social login ---- */
{
  const env = makeEnv();
  const uid = crypto.randomUUID();
  env.db.prepare("INSERT INTO users (id, email, email_verified, created_at, deleted_at) VALUES (?, 'gone@example.com', 1, '2026-01-01', '2026-11-01T00:00:00.000Z')").run(uid);
  env.db.prepare("INSERT INTO identities (id, user_id, provider, provider_user_id, created_at) VALUES ('i2', ?, 'google', 'g-old', '2026-01-01')").run(uid);

  // the same Google identity signs in again
  let r = await resolveSocial(env, 'google', {sub: 'g-old', email: 'gone@example.com', emailVerified: true, name: null, picture: null});
  assert.deepEqual([r.userId, r.restored], [uid, true]);
  assert.equal(row(env, 'SELECT deleted_at FROM users').deleted_at, null);

  // a link attempt must not restore someone else's deleted account
  env.db.prepare("UPDATE users SET deleted_at = '2026-11-01T00:00:00.000Z'").run();
  const other = crypto.randomUUID();
  env.db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'other@example.com', '2026-01-01')").run(other);
  r = await resolveSocial(env, 'google', {sub: 'g-old', email: null, emailVerified: false, name: null, picture: null}, {linkUserId: other});
  assert.equal(r.error, 'identity_in_use'); assert.ok(row(env, 'SELECT deleted_at FROM users WHERE id = ?', uid).deleted_at, 'still deleted');

  // BUG GUARD: a verified address belonging to a deleted account used to crash on the UNIQUE email constraint
  r = await resolveSocial(env, 'google', {sub: 'g-new', email: 'gone@example.com', emailVerified: true, name: null, picture: null});
  assert.deepEqual([r.userId, r.restored], [uid, true], 'merged into and restored the deleted account');
  assert.equal(count(env, 'users'), 2); assert.equal(count(env, 'identities', "WHERE user_id = '" + uid + "'"), 2);

  // an unverified address (LINE/Facebook) never restores or merges
  env.db.prepare("UPDATE users SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?").run(uid);
  r = await resolveSocial(env, 'line', {sub: 'l-x', email: 'gone@example.com', emailVerified: false, name: null, picture: null});
  assert.equal(r.error, 'email_exists_login_first'); assert.ok(row(env, 'SELECT deleted_at FROM users WHERE id = ?', uid).deleted_at);
}

/* ---- devices ---- */
{
  const env = makeEnv();
  const laptop = await member(env, 'dev@example.com');
  const phone = client(env), tablet = client(env);
  await phone.call('POST', '/auth/login', {email: 'dev@example.com', password: PW}, {headers: {'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1'}});
  await tablet.call('POST', '/auth/login', {email: 'dev@example.com', password: PW}, {headers: {'user-agent': 'x'.repeat(500)}});
  const list = (await laptop.get('/me/sessions')).data.sessions;
  assert.equal(list.length, 3); assert.equal(list.filter(s => s.current).length, 1);
  assert.ok(list.every(s => /^[0-9a-f]{64}$/.test(s.id) && s.created_at && s.last_seen_at));
  assert.ok(list.some(s => /iPhone/.test(s.user_agent)));
  assert.ok(list.every(s => (s.user_agent ?? '').length <= 200), 'user agents are stored shortened');
  assert.equal((await client(env).get('/me/sessions')).status, 401);

  // someone else's session cannot be listed or revoked
  const stranger = await member(env, 'stranger@example.com');
  assert.equal((await stranger.get('/me/sessions')).data.sessions.length, 1);
  const target = list.find(s => /iPhone/.test(s.user_agent)).id;
  assert.equal((await stranger.del('/me/sessions/' + target)).status, 404);
  assert.equal((await phone.get('/me')).status, 200, "the stranger's attempt changed nothing");
  assert.equal((await client(env, {origin: 'https://evil.test'}).del('/me/sessions/' + target)).status, 403);

  // revoke one device
  assert.equal((await laptop.del('/me/sessions/' + target)).status, 204);
  assert.equal((await phone.get('/me')).status, 401); assert.equal((await tablet.get('/me')).status, 200); assert.equal((await laptop.get('/me')).status, 200);
  assert.equal((await laptop.del('/me/sessions/' + target)).status, 404);

  // sign out all other devices
  assert.equal((await laptop.post('/me/sessions/revoke-others', {})).status, 204);
  assert.equal((await tablet.get('/me')).status, 401); assert.equal((await laptop.get('/me')).status, 200);
  assert.equal((await stranger.get('/me')).status, 200, 'other users are untouched');
  assert.equal((await laptop.get('/me/sessions')).data.sessions.length, 1);

  // revoking the current one signs this browser out
  const cur = (await laptop.get('/me/sessions')).data.sessions[0].id;
  const res = await laptop.del('/me/sessions/' + cur);
  assert.equal(res.status, 204); assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await laptop.get('/me')).status, 401);

  // expired sessions are not listed
  const again = await member(env, 'dev@example.com');
  env.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = 'dev@example.com')").run();
  assert.equal((await again.get('/me/sessions')).status, 401);
}

/* ---- display name ---- */
{
  const env = makeEnv(), c = await member(env, 'name@example.com');
  assert.equal((await client(env).post('/me/profile', {display_name: 'x'})).status, 401);
  assert.equal((await c.post('/me/profile', {display_name: '  Ann\u0000 Rose  '})).status, 204);
  assert.equal((await c.get('/me')).data.user.display_name, 'Ann Rose');
  assert.equal((await c.post('/me/profile', {display_name: 'ก'.repeat(100)})).status, 204);
  assert.equal((await c.get('/me')).data.user.display_name.length, 60);
  assert.equal((await c.post('/me/profile', {display_name: '   '})).status, 204);
  assert.equal((await c.get('/me')).data.user.display_name, null, 'blank clears it');
  for (const bad of [{}, {display_name: 5}, {display_name: ['a']}, {display_name: 'x'.repeat(500)}]) assert.equal((await c.post('/me/profile', bad)).status, 400);
  assert.equal((await client(env, {origin: 'https://evil.test'}).post('/me/profile', {display_name: 'x'})).status, 403);
}

console.log('PASS: restore (password, reset, social, grace period end), the deleted-account email crash is fixed, devices list/revoke, display name');
