import assert from 'node:assert/strict';
import {ORIGIN, client, makeEnv, tokenFrom} from './helpers.mjs';
import {hashPassword, verifyPassword} from '../lib/crypto.mjs';
import {maintain} from '../index.js';

const EMAIL = 'Ann@Example.com', PW = 'correct horse battery';
const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const count = (env, t) => row(env, `SELECT COUNT(*) n FROM ${t}`).n;

/* ---- password hashing ---- */
{
  const h = await hashPassword('s3cret-pass', 1000);
  assert.match(h, /^pbkdf2-sha256\$1000\$/);
  assert.deepEqual(await verifyPassword('s3cret-pass', h, 1000), {ok: true, needsRehash: false});
  assert.equal((await verifyPassword('wrong', h, 1000)).ok, false);
  assert.equal((await verifyPassword('s3cret-pass', h, 5000)).needsRehash, true);       // old count is flagged for upgrade
  assert.equal((await verifyPassword('x', 'garbage')).ok, false);
  assert.equal((await verifyPassword('x', 'pbkdf2-sha256$99999999999$a$b')).ok, false);   // absurd cost never runs
  assert.notEqual(h, await hashPassword('s3cret-pass', 1000));                           // salted
}

/* ---- register -> verify -> login -> me -> logout ---- */
const env = makeEnv();
const web = client(env);

let r = await web.post('/auth/register', {email: EMAIL, password: PW, display_name: ' Ann\n'});
assert.equal(r.status, 201); assert.deepEqual(r.data, {ok: true, message: 'check_email'});
assert.equal(web.cookie, '', 'register must not sign anyone in');
assert.equal(row(env, 'SELECT email, email_verified, display_name FROM users').email, 'ann@example.com');   // lowercased
assert.equal(row(env, 'SELECT display_name FROM users').display_name, 'Ann');
assert.ok(!JSON.stringify(row(env, 'SELECT * FROM credentials')).includes(PW), 'password stored in clear');
assert.equal(env.mails.length, 1); assert.equal(env.mails[0].to, 'ann@example.com');
const verifyToken = tokenFrom(env.mails, 'verify');
assert.ok(verifyToken && verifyToken.length >= 40);
assert.equal(row(env, 'SELECT COUNT(*) n FROM email_tokens WHERE id = ?', verifyToken).n, 0, 'raw token must not be stored (only its hash)');

r = await web.post('/auth/login', {email: 'ann@example.com', password: 'wrong password!!'});
assert.equal(r.status, 401); assert.deepEqual(r.data, {error: 'invalid_credentials'});
assert.equal((await web.get('/me')).status, 401);

r = await web.post('/auth/login', {email: ' ANN@example.com ', password: PW});
assert.equal(r.status, 200); assert.equal(r.data.user.email, 'ann@example.com'); assert.equal(r.data.user.email_verified, false);
const setCookie = r.headers.get('set-cookie');
assert.match(setCookie, /^__Host-taro_session=[\w-]{40,};/);
for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(setCookie.includes(flag), flag);
assert.ok(!/Domain=/i.test(setCookie), '__Host- cookies must not set Domain');
const token = web.cookie.split('=')[1];
assert.equal(row(env, 'SELECT COUNT(*) n FROM sessions WHERE id = ?', token).n, 0, 'session token stored in clear');
assert.equal(count(env, 'sessions'), 1);

r = await web.get('/me');
assert.equal(r.status, 200); assert.equal(r.data.user.email, 'ann@example.com'); assert.equal(r.data.has_password, true); assert.deepEqual(r.data.identities, []);

r = await web.post('/auth/verify-email', {token: verifyToken});
assert.equal(r.status, 204); assert.equal((await web.get('/me')).data.user.email_verified, true);
assert.equal((await web.post('/auth/verify-email', {token: verifyToken})).status, 400, 'a token works once');
assert.equal((await web.post('/auth/verify-email', {token: 'nope'})).status, 400);

r = await web.post('/auth/logout', {});
assert.equal(r.status, 204); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
assert.equal(count(env, 'sessions'), 0); assert.equal((await web.get('/me')).status, 401);

/* ---- no account enumeration ---- */
{
  const before = env.mails.length;
  const dup = await web.post('/auth/register', {email: 'ann@example.com', password: 'another long password'});
  assert.equal(dup.status, 201); assert.deepEqual(dup.data, {ok: true, message: 'check_email'});   // identical to a fresh signup
  assert.equal(count(env, 'users'), 1);
  assert.equal(env.mails.length, before + 1); assert.match(env.mails.at(-1).subject, /มีบัญชีนี้อยู่แล้ว/);
  assert.ok(tokenFrom(env.mails, 'reset'), 'the "already exists" mail offers a reset link');
  assert.equal((await web.post('/auth/login', {email: 'ann@example.com', password: 'another long password'})).status, 401, 'a second signup must not overwrite the password');
  const f1 = await web.post('/auth/forgot-password', {email: 'nobody@example.com'});
  const f2 = await web.post('/auth/forgot-password', {email: 'ann@example.com'});
  assert.equal(f1.status, 202); assert.equal(f2.status, 202); assert.deepEqual(f1.data, f2.data);
  assert.equal(env.mails.filter(m => m.to === 'nobody@example.com').length, 0);
}

/* ---- forgot / reset password ---- */
{
  const t1 = tokenFrom(env.mails, 'reset');
  const w2 = client(env), w3 = client(env);
  await w2.post('/auth/login', {email: 'ann@example.com', password: PW});
  await w3.post('/auth/login', {email: 'ann@example.com', password: PW});
  assert.equal(count(env, 'sessions'), 2);

  assert.equal((await web.post('/auth/reset-password', {token: t1, password: 'short'})).status, 400);
  assert.equal(row(env, 'SELECT used_at FROM email_tokens WHERE purpose = ? ORDER BY rowid DESC', 'reset_password').used_at, null, 'a rejected password must not burn the token');
  r = await web.post('/auth/reset-password', {token: t1, password: 'brand new passphrase'});
  assert.equal(r.status, 204);
  assert.equal(count(env, 'sessions'), 0, 'reset signs out every device');
  assert.equal((await w2.get('/me')).status, 401);
  assert.equal((await web.post('/auth/reset-password', {token: t1, password: 'yet another passphrase'})).status, 400, 'token is single use');
  assert.equal((await web.post('/auth/login', {email: 'ann@example.com', password: PW})).status, 401);
  assert.equal((await web.post('/auth/login', {email: 'ann@example.com', password: 'brand new passphrase'})).status, 200);

  // a newer request invalidates older links
  await web.post('/auth/forgot-password', {email: 'ann@example.com'}); const a = tokenFrom(env.mails, 'reset');
  await web.post('/auth/forgot-password', {email: 'ann@example.com'}); const b = tokenFrom(env.mails, 'reset');
  assert.notEqual(a, b);
  assert.equal((await web.post('/auth/reset-password', {token: a, password: 'old link passphrase'})).status, 400);
  // per-address hourly cap: the 4th request in an hour sends nothing
  const sent = env.mails.length;
  await web.post('/auth/forgot-password', {email: 'ann@example.com'});
  await web.post('/auth/forgot-password', {email: 'ann@example.com'});
  assert.equal(env.mails.length - sent, 0, 'reset mails are capped per address');

  // expired token
  env.db.prepare("UPDATE email_tokens SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await web.post('/auth/reset-password', {token: b, password: 'late passphrase ok'})).status, 400);
}

/* ---- change password (signed in) ---- */
{
  const a = client(env), b = client(env);
  await a.post('/auth/login', {email: 'ann@example.com', password: 'brand new passphrase'});
  await b.post('/auth/login', {email: 'ann@example.com', password: 'brand new passphrase'});
  assert.equal((await client(env).post('/me/password', {password: 'whatever long pass'})).status, 401);
  assert.equal((await a.post('/me/password', {current: 'wrong', password: 'next level passphrase'})).status, 403);
  assert.equal((await a.post('/me/password', {current: 'brand new passphrase', password: 'tiny'})).status, 400);
  assert.equal((await a.post('/me/password', {current: 'brand new passphrase', password: 'next level passphrase'})).status, 204);
  assert.equal((await a.get('/me')).status, 200, 'this device stays signed in');
  assert.equal((await b.get('/me')).status, 401, 'other devices are signed out');
}

/* ---- terms acceptance is recorded at sign-up ---- */
{
  const e = makeEnv(), c = client(e);
  for (const bad of [undefined, '', 'has space', 'x'.repeat(30), 5, null]) {
    const r = await c.post('/auth/register', {email: 't@example.com', password: 'a long test passphrase', terms_version: bad});
    assert.equal(r.status, 400, String(bad)); assert.equal(r.data.error, 'terms_required');
  }
  assert.equal(count(e, 'users'), 0, 'nothing is created without acceptance');
  assert.equal((await c.post('/auth/register', {email: 't@example.com', password: 'a long test passphrase', terms_version: '2026-11'})).status, 201);
  const rows = e.db.prepare('SELECT kind, version, granted FROM consents ORDER BY kind').all();
  assert.deepEqual(rows.map(r => [r.kind, r.version, r.granted]), [['privacy', '2026-11', 1], ['terms', '2026-11', 1]]);
  // signing up again with an existing address records nothing for the account that already exists
  await c.post('/auth/register', {email: 't@example.com', password: 'a long test passphrase', terms_version: '2027-01'});
  assert.equal(count(e, 'consents'), 2);

  // old feedback is purged after a year
  e.db.prepare("INSERT INTO feedback (id, kind, body, created_at) VALUES ('old', 'bug', 'old report', '2020-01-01T00:00:00.000Z'), ('new', 'bug', 'new report', ?)").run(new Date().toISOString());
  await maintain(e);
  assert.deepEqual(e.db.prepare('SELECT id FROM feedback').all().map(r => r.id), ['new']);
}

/* ---- resend verification + provider list ---- */
{
  const e = makeEnv({GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', COOKIE_SECRET: 'c'.repeat(32)}), c = client(e);
  const pr = await c.get('/auth/providers', {withOrigin: false});
  assert.deepEqual(pr.data, {providers: ['google']}); assert.match(pr.headers.get('cache-control'), /public/);
  assert.deepEqual((await client(makeEnv()).get('/auth/providers')).data, {providers: []});

  assert.equal((await client(e).post('/me/resend-verification', {})).status, 401);
  await c.post('/auth/register', {email: 'rv@example.com', password: 'resend long password'});
  await c.post('/auth/login', {email: 'rv@example.com', password: 'resend long password'});
  const first = tokenFrom(e.mails, 'verify');
  assert.equal((await c.post('/me/resend-verification', {})).status, 202);
  const second = tokenFrom(e.mails, 'verify');
  assert.notEqual(first, second); assert.equal(e.mails.at(-1).to, 'rv@example.com');
  assert.equal((await c.post('/auth/verify-email', {token: first})).status, 400, 'the older link stops working');
  assert.equal((await c.post('/me/resend-verification', {})).status, 202);
  assert.equal((await c.post('/me/resend-verification', {})).status, 202);
  assert.equal((await c.post('/me/resend-verification', {})).status, 429, 'at most 3 per hour');
  e.db.prepare("UPDATE audit_log SET at = '2000-01-01T00:00:00.000Z' WHERE event = 'verify_request'").run();
  assert.equal((await c.post('/auth/verify-email', {token: tokenFrom(e.mails, 'verify')})).status, 204);
  assert.equal((await c.post('/me/resend-verification', {})).data.error, 'already_verified');
  e.db.prepare('UPDATE users SET email = NULL, email_verified = 0').run();
  assert.equal((await c.post('/me/resend-verification', {})).data.error, 'no_email');
}

/* ---- throttling ---- */
{
  const e2 = makeEnv(), c = client(e2);
  await c.post('/auth/register', {email: 'bob@example.com', password: 'bobs long password'});
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/auth/login', {email: 'bob@example.com', password: 'nope nope nope'})).status, 401);
  assert.equal((await c.post('/auth/login', {email: 'bob@example.com', password: 'bobs long password'})).status, 429, 'locked even for the right password');
  assert.equal((await c.post('/auth/login', {email: 'bob@example.com', password: 'bobs long password'})).data.error, 'too_many_attempts');
  assert.equal((await c.post('/auth/login', {email: 'unknown@example.com', password: 'nope nope nope'})).status, 401);   // other addresses unaffected
  assert.ok(row(e2, 'SELECT subject FROM audit_log WHERE event = ? LIMIT 1', 'login_fail').subject.length === 64, 'audit stores a hash, not the address');

  let n = 0;
  const e3 = makeEnv({AUTH_LIMITER: {limit: async () => ({success: ++n <= 1})}}), c3 = client(e3);
  assert.equal((await c3.post('/auth/register', {email: 'c@example.com', password: 'carols long password'})).status, 201);
  assert.equal((await c3.post('/auth/register', {email: 'd@example.com', password: 'daves long password'})).status, 429);
}

/* ---- input validation ---- */
{
  const c = client(makeEnv());
  assert.equal((await c.post('/auth/register', {email: 'not-an-email', password: PW})).data.error, 'invalid_email');
  assert.equal((await c.post('/auth/register', {email: 'a@b.co', password: 'short'})).data.error, 'password_too_short');
  assert.equal((await c.post('/auth/register', {email: 'a@b.co', password: 'x'.repeat(129)})).data.error, 'password_too_long');
  assert.equal((await c.post('/auth/register', {email: 'longer@b.co', password: 'LONGER@B.CO'})).data.error, 'password_is_email');
  assert.equal((await c.post('/auth/register', {email: 'a@b.co', password: ['x']})).status, 400);
  assert.equal((await c.post('/auth/register', undefined, {rawBody: '{bad', contentType: 'application/json'})).status, 400);
  assert.equal((await c.post('/auth/register', undefined, {rawBody: '[1]', contentType: 'application/json'})).status, 400);
  assert.equal((await c.post('/auth/register', undefined, {rawBody: JSON.stringify({email: 'a@b.co', password: 'y'.repeat(20000)}), contentType: 'application/json'})).status, 400);   // oversize body
  assert.equal((await c.post('/auth/login', {email: 'a@b.co', password: {$ne: 1}})).status, 400);
}

/* ---- CSRF / CORS ---- */
{
  const e = makeEnv(), c = client(e);
  const evil = client(e, {origin: 'https://evil.test'});
  assert.equal((await evil.post('/auth/register', {email: 'x@example.com', password: PW})).status, 403);
  assert.equal((await c.post('/auth/register', {email: 'x@example.com', password: PW}, {withOrigin: false})).status, 403);
  assert.equal((await c.post('/auth/register', undefined, {rawBody: 'email=x', contentType: 'text/plain'})).status, 403, 'form-style posts are refused');
  assert.equal(count(e, 'users'), 0);

  await c.post('/auth/register', {email: 'x@example.com', password: PW});
  await c.post('/auth/login', {email: 'x@example.com', password: PW});
  assert.equal((await evil.post('/auth/logout', {})).status, 403);
  assert.equal(count(e, 'sessions'), 1, 'a cross-site logout must not work');
  evil.cookie = c.cookie;
  const read = await evil.get('/me');   // the request itself is served, but the browser withholds the response from evil.test
  assert.equal(read.headers.get('access-control-allow-origin'), null);

  const pre = await worker_fetch(e, 'OPTIONS', ORIGIN);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal((await worker_fetch(e, 'OPTIONS', 'https://evil.test')).status, 403);
  const ok = await c.get('/me');
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await c.get('/nope')).status, 404);
}
async function worker_fetch(env, method, origin) {
  const {default: w} = await import('../index.js');
  return w.fetch(new Request('https://api.test/auth/login', {method, headers: {origin, 'access-control-request-method': 'POST'}}), env, {waitUntil() {}});
}

/* ---- sessions: expiry, deleted users, sliding renewal, rehash, maintenance ---- */
{
  const e = makeEnv(), c = client(e);
  await c.post('/auth/register', {email: 'eve@example.com', password: 'eves long password'});
  await c.post('/auth/login', {email: 'eve@example.com', password: 'eves long password'});
  assert.equal((await c.get('/me')).status, 200);

  e.db.prepare("UPDATE sessions SET last_seen_at = '2000-01-01T00:00:00.000Z'").run();
  await c.get('/me');
  assert.ok(row(e, 'SELECT last_seen_at FROM sessions').last_seen_at > '2020', 'activity renews the session');

  e.db.prepare("UPDATE users SET deleted_at = '2026-01-01T00:00:00.000Z'").run();
  assert.equal((await c.get('/me')).status, 401, 'deleted users cannot use an old session');
  assert.equal((await c.post('/auth/login', {email: 'eve@example.com', password: 'wrong wrong wrong'})).status, 401, 'a wrong password does not restore anything');
  assert.ok(row(e, 'SELECT deleted_at FROM users').deleted_at);
  e.db.prepare('UPDATE users SET deleted_at = NULL').run();

  e.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await c.get('/me')).status, 401, 'expired sessions are refused');
  await maintain(e);
  assert.equal(count(e, 'sessions'), 0);

  // weaker stored hash is upgraded on the next successful login
  const old = await hashPassword('eves long password', 10);
  e.db.prepare('UPDATE credentials SET password_hash = ?').run(old);
  await c.post('/auth/login', {email: 'eve@example.com', password: 'eves long password'});
  assert.match(row(e, 'SELECT password_hash h FROM credentials').h, /^pbkdf2-sha256\$1000\$/);

  // used and expired tokens, and old audit rows, are purged
  e.db.prepare("UPDATE email_tokens SET used_at = '2000-01-01T00:00:00.000Z'").run();
  e.db.prepare("UPDATE audit_log SET at = '2000-01-01T00:00:00.000Z'").run();
  await maintain(e);
  assert.equal(count(e, 'email_tokens'), 0); assert.equal(count(e, 'audit_log'), 0);
}

console.log('PASS: register/verify/login/logout/reset/change-password, no enumeration, throttling, CSRF+CORS, sessions');
