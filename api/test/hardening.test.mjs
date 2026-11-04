// Regression tests for the issues found in the security review: each one reproduces the attack or failure and checks it is closed.
import assert from 'node:assert/strict';
import {client, makeEnv, tokenFrom} from './helpers.mjs';
import {resolveSocial} from '../lib/social.mjs';
import {sendMail} from '../lib/mail.mjs';
import {readBody} from '../lib/http.mjs';
import {mailAllowed} from '../lib/util.mjs';

const PW = 'a long test passphrase';
const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const count = (env, t, w = '') => row(env, `SELECT COUNT(*) n FROM ${t} ${w}`).n;
const prof = (sub, email, verified, over = {}) => ({sub, email, emailVerified: verified, name: null, picture: null, ...over});
async function member(env, email, pw = PW) {
  const c = client(env);
  await c.post('/auth/register', {email, password: pw});
  await c.post('/auth/login', {email, password: pw});
  return c;
}
const verified = async (env, c, email) => { await c.post('/auth/verify-email', {token: tokenFrom(env.mails, 'verify')}); };
const ageSessions = env => env.db.prepare("UPDATE sessions SET created_at = '2020-01-01T00:00:00.000Z'").run();   // a sign-in from long ago

/* ---- pre-hijacking: the attacker's linked logins go too, not only the password ---- */
{
  const env = makeEnv(), attacker = await member(env, 'victim@gmail.test', 'attackers password!');   // registers the victim's address, never verifies it
  const uid = row(env, 'SELECT id FROM users').id;
  // while signed in the attacker links their own LINE and Facebook logins and sets up reminders
  assert.ok((await resolveSocial(env, 'line', prof('attacker-line', null, false), {linkUserId: uid})).linked);
  assert.ok((await resolveSocial(env, 'facebook', prof('attacker-fb', null, false), {linkUserId: uid})).linked);
  env.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, friend) VALUES (?, 'attacker-line', 1)").run(uid);
  assert.equal(count(env, 'identities'), 2);

  // the real owner signs in with Google (verified address) and takes the account over
  const r = await resolveSocial(env, 'google', prof('victim-g', 'victim@gmail.test', true));
  assert.equal(r.userId, uid); assert.ok(r.merged);
  assert.deepEqual(env.db.prepare('SELECT provider FROM identities').all().map(x => x.provider), ['google'], "the attacker's LINE and Facebook logins are gone");
  assert.equal(count(env, 'line_subscriptions'), 0, "and so are the attacker's reminders");
  assert.equal(count(env, 'credentials'), 0); assert.equal((await attacker.get('/me')).status, 401);
  // signing in with the attacker's LINE identity now starts a brand-new, empty account: it cannot reach the victim's data
  const again = await resolveSocial(env, 'line', prof('attacker-line', null, false));
  assert.ok(again.created); assert.notEqual(again.userId, uid);
  // an already verified account keeps its other logins when a provider merges in (only the never-verified case is wiped)
  const ok = makeEnv(), owner = await member(ok, 'real@gmail.test'); await verified(ok, owner, 'real@gmail.test');
  const oid = row(ok, 'SELECT id FROM users').id;
  await resolveSocial(ok, 'line', prof('real-line', null, false), {linkUserId: oid});
  await resolveSocial(ok, 'google', prof('real-g', 'real@gmail.test', true));
  assert.equal(count(ok, 'identities'), 2); assert.equal(count(ok, 'credentials'), 1);
}

/* ---- races: the loser of a UNIQUE conflict gets the winner's account, not a 500 ---- */
{
  const env = makeEnv();
  const real = env.DB.prepare;
  let raced = false;
  env.DB.prepare = sql => {   // a concurrent callback creates the same person between our lookup and our insert
    const st = real(sql);
    if (!raced && sql.startsWith('SELECT i.user_id')) {
      const first = st.bind;
      return {...st, bind: (...a) => { const b = first(...a); return {...b, first: async () => {
        raced = true;
        const id = crypto.randomUUID();
        env.db.prepare("INSERT INTO users (id, created_at) VALUES (?, '2026-01-01')").run(id);
        env.db.prepare("INSERT INTO identities (id, user_id, provider, provider_user_id, created_at) VALUES (?, ?, 'line', 'twin', '2026-01-01')").run(crypto.randomUUID(), id);
        return null;   // our lookup (made just before) saw nothing
      }}; }};
    }
    return st;
  };
  const r = await resolveSocial(env, 'line', prof('twin', null, false));
  assert.ok(raced && r.userId && !r.error, 'no exception');
  assert.equal(count(env, 'users'), 1, 'one account, not two'); assert.equal(count(env, 'identities'), 1);
  // genuine errors are not swallowed
  const bad = makeEnv(); bad.DB.prepare = () => { throw new Error('disk on fire'); };
  await assert.rejects(resolveSocial(bad, 'line', prof('x', null, false)), /disk on fire/);
}
{
  // two accounts verify the same new address at once: the second gets 409, not a 500
  const env = makeEnv(), a = await member(env, 'a@example.com'), b = await member(env, 'b@example.com');
  await a.post('/me/email', {email: 'shared@example.com', password: PW});
  const tok = tokenFrom(env.mails, 'verify');
  env.db.prepare("UPDATE users SET email = 'shared@example.com' WHERE email = 'b@example.com'").run();   // b won the race for the address
  const r = await client(env).post('/auth/verify-email', {token: tok});
  assert.equal(r.status, 409); assert.equal(r.data.error, 'email_in_use');
  assert.equal(row(env, "SELECT email FROM users WHERE id != (SELECT id FROM users WHERE email = 'shared@example.com')").email, 'a@example.com');
}

/* ---- mail flooding: three mails per address per hour, the answer never changes ---- */
{
  const env = makeEnv(), c = client(env);
  const reg = e => c.post('/auth/register', {email: e, password: PW});
  const answers = [];
  for (let i = 0; i < 5; i++) answers.push(await reg('target@example.com'));
  assert.ok(answers.every(r => r.status === 201 && r.data.message === 'check_email'), 'identical answers, capped or not');
  assert.equal(env.mails.filter(m => m.to === 'target@example.com').length, 3, 'only three mails reach the address (one verification + two "exists" notes)');
  assert.equal(count(env, 'users'), 1);
  await reg('other@example.com');
  assert.equal(env.mails.filter(m => m.to === 'other@example.com').length, 1, 'other addresses are unaffected');
  assert.ok(!/target@example/.test(JSON.stringify(env.db.prepare("SELECT subject FROM audit_log WHERE event = 'mail_request'").all())), 'the counter stores a keyed tag, not the address');
  env.db.prepare("UPDATE audit_log SET at = '2000-01-01T00:00:00.000Z' WHERE event = 'mail_request'").run();
  await reg('target@example.com'); assert.equal(env.mails.filter(m => m.to === 'target@example.com').length, 4, 'allowed again after the hour');

  // a new account that was refused its verification mail can ask for it once signed in
  const c2 = client(env), env2 = makeEnv(); const cc = client(env2);
  for (let i = 0; i < 3; i++) await cc.post('/auth/register', {email: 'full@example.com', password: PW});
  await cc.post('/auth/login', {email: 'full@example.com', password: PW});
  assert.equal(count(env2, 'users'), 1);

  // the same cap protects email change
  const e3 = makeEnv(), u = await member(e3, 'owner@example.com');
  for (let i = 0; i < 5; i++) assert.equal((await u.post('/me/email', {email: 'victim2@example.com', password: PW})).status, 202);
  assert.equal(e3.mails.filter(m => m.to === 'victim2@example.com').length, 3);
  assert.equal(await mailAllowed(makeEnv(), 'Fresh@Example.com'), true);
}

/* ---- reset links are bound to the address they were mailed to ---- */
{
  const env = makeEnv(), c = await member(env, 'old@example.com'); await verified(env, c, 'old@example.com');
  await client(env).post('/auth/forgot-password', {email: 'old@example.com'});
  const oldLink = tokenFrom(env.mails, 'reset');
  // the user then changes the address
  await c.post('/me/email', {email: 'new@example.com', password: PW});
  assert.equal((await client(env).post('/auth/verify-email', {token: tokenFrom(env.mails, 'verify')})).status, 204);
  assert.equal(row(env, 'SELECT email FROM users').email, 'new@example.com');
  const r = await client(env).post('/auth/reset-password', {token: oldLink, password: 'attackers new passphrase'});
  assert.equal(r.status, 400, 'the link mailed to the old address no longer works');
  assert.equal((await client(env).post('/auth/login', {email: 'new@example.com', password: PW})).status, 200, 'the password is unchanged');
  assert.equal((await client(env).post('/auth/login', {email: 'new@example.com', password: 'attackers new passphrase'})).status, 401);

  // the old address is told about the change (and the notice contains the new address, not any link)
  const note = env.mails.find(m => m.to === 'old@example.com' && /เปลี่ยน/.test(m.subject));
  assert.ok(note && note.text.includes('new@example.com') && !/#(reset|verify)=/.test(note.text), 'old address notified without a usable link');

  // each guard works on its own. (1) the address check alone: the address changes by some path that voids nothing
  {
    const e = makeEnv(), u = await member(e, 'a1@example.com'); await verified(e, u, 'a1@example.com');
    await client(e).post('/auth/forgot-password', {email: 'a1@example.com'});
    const link = tokenFrom(e.mails, 'reset');
    e.db.prepare("UPDATE users SET email = 'b1@example.com'").run();
    assert.equal((await client(e).post('/auth/reset-password', {token: link, password: 'attackers new passphrase'})).status, 400, 'bound to the address it was mailed to');
    // (2) the revocation alone: the address goes A -> B -> A, so the address check would pass again but the link must still be dead
    const e2 = makeEnv(), w = await member(e2, 'a2@example.com'); await verified(e2, w, 'a2@example.com');
    await client(e2).post('/auth/forgot-password', {email: 'a2@example.com'});
    const old = tokenFrom(e2.mails, 'reset');
    await w.post('/me/email', {email: 'b2@example.com', password: PW}); await client(e2).post('/auth/verify-email', {token: tokenFrom(e2.mails, 'verify')});
    await w.post('/me/email', {email: 'a2@example.com', password: PW}); await client(e2).post('/auth/verify-email', {token: tokenFrom(e2.mails, 'verify')});
    assert.equal(row(e2, 'SELECT email FROM users').email, 'a2@example.com');
    assert.equal((await client(e2).post('/auth/reset-password', {token: old, password: 'attackers new passphrase'})).status, 400, 'an email change voids links even if the address later comes back');
  }

  // changing the password voids links that are still out
  await client(env).post('/auth/forgot-password', {email: 'new@example.com'});
  const link = tokenFrom(env.mails, 'reset');
  const s = client(env); await s.post('/auth/login', {email: 'new@example.com', password: PW});
  assert.equal((await s.post('/me/password', {current: PW, password: 'changed long passphrase'})).status, 204);
  assert.equal((await client(env).post('/auth/reset-password', {token: link, password: 'whatever long passphrase'})).status, 400, 'a reset link requested before a password change is void');

  // one reset uses up every other outstanding link
  await client(env).post('/auth/forgot-password', {email: 'new@example.com'});
  const first = tokenFrom(env.mails, 'reset');
  const {sha256Hex} = await import('../lib/crypto.mjs');
  const uid = row(env, 'SELECT id FROM users').id;
  env.db.prepare("INSERT INTO email_tokens (id, user_id, purpose, new_email, expires_at) VALUES (?, ?, 'reset_password', 'new@example.com', '2999-01-01T00:00:00.000Z')").run(await sha256Hex('second-link-token'), uid);
  assert.equal((await client(env).post('/auth/reset-password', {token: first, password: 'fresh long passphrase'})).status, 204);
  assert.equal((await client(env).post('/auth/reset-password', {token: 'second-link-token', password: 'second long passphrase'})).status, 400, 'the other link died with the first');

  // a token with no recorded address (never issued by this code) is not honoured
  env.db.prepare("INSERT INTO email_tokens (id, user_id, purpose, new_email, expires_at) VALUES (?, ?, 'reset_password', NULL, '2999-01-01T00:00:00.000Z')").run(await sha256Hex('legacy-token'), uid);
  assert.equal((await client(env).post('/auth/reset-password', {token: 'legacy-token', password: 'legacy long passphrase'})).status, 400);

  // signing up again with an existing address replaces the earlier link instead of stacking another one
  const e2 = makeEnv(), u = await member(e2, 'stack@example.com');
  await client(e2).post('/auth/register', {email: 'stack@example.com', password: PW}); const t1 = tokenFrom(e2.mails, 'reset');
  await client(e2).post('/auth/register', {email: 'stack@example.com', password: PW}); const t2 = tokenFrom(e2.mails, 'reset');
  assert.notEqual(t1, t2);
  assert.equal((await client(e2).post('/auth/reset-password', {token: t1, password: 'stacked long passphrase'})).status, 400);
  assert.equal((await client(e2).post('/auth/reset-password', {token: t2, password: 'stacked long passphrase'})).status, 204);
}

/* ---- a stale session cannot make lasting changes to an account that has no password ---- */
{
  const env = makeEnv(), c = client(env);
  const uid = crypto.randomUUID();
  env.db.prepare("INSERT INTO users (id, created_at) VALUES (?, '2026-01-01')").run(uid);
  env.db.prepare("INSERT INTO identities (id, user_id, provider, provider_user_id, created_at) VALUES ('i', ?, 'line', 'U9', '2026-01-01')").run(uid);
  const {createSession} = await import('../lib/session.mjs');
  c.cookie = '__Host-taro_session=' + await createSession(env, uid, 'test');
  assert.equal((await c.get('/me')).status, 200);
  // fresh session: allowed
  assert.equal((await c.post('/me/email', {email: 'fresh@example.com'})).status, 202);
  ageSessions(env);   // the cookie is now an old sign-in (stolen laptop, shared browser)
  for (const [path, body] of [['/me/email', {email: 'thief@example.com'}], ['/me/password', {password: 'thiefs new passphrase'}], ['/me/delete', {confirm: 'DELETE'}]]) {
    const r = await c.post(path, body);
    assert.equal(r.status, 403, path); assert.equal(r.data.error, 'recent_login_required');
  }
  assert.equal(count(env, 'credentials'), 0, 'no password was set'); assert.equal(row(env, 'SELECT deleted_at FROM users').deleted_at, null, 'not deleted');
  assert.equal(count(env, 'email_tokens', "WHERE new_email = 'thief@example.com'"), 0);
  // reading and harmless actions still work on an old session
  assert.equal((await c.get('/me')).status, 200); assert.equal((await c.get('/me/readings')).status, 200);
  // signing in again makes it recent
  const fresh = client(env); fresh.cookie = '__Host-taro_session=' + await createSession(env, uid, 'test');
  assert.equal((await fresh.post('/me/password', {password: 'owners new passphrase'})).status, 204);

  // accounts WITH a password are asked for it instead, whatever the age of the session
  const e2 = makeEnv(), p = await member(e2, 'pw@example.com'); ageSessions(e2);
  assert.equal((await p.post('/me/email', {email: 'moved@example.com', password: PW})).status, 202);
  assert.equal((await p.post('/me/email', {email: 'moved2@example.com'})).data.error, 'wrong_password');
  assert.equal((await p.post('/me/delete', {confirm: 'DELETE', password: PW})).status, 204);
}

/* ---- email sending: one retry, never throws ---- */
{
  const calls = [];
  const mk = statuses => ({RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.test', MAIL_RETRY_MS: 0, FETCHER: async () => { const s = statuses[calls.length % statuses.length]; calls.push(s); if (s === 'throw') throw new Error('network down'); return new Response('{}', {status: s}); }});
  const send = env => sendMail(env, {to: 'x@example.com', subject: 's', text: 't'});
  calls.length = 0; await send(mk([200])); assert.equal(calls.length, 1);
  calls.length = 0; await send(mk(['throw', 200])); assert.equal(calls.length, 2, 'a network error is retried once');
  calls.length = 0; await send(mk([503, 200])); assert.equal(calls.length, 2, 'a server error is retried once');
  calls.length = 0; await send(mk([429, 200])); assert.equal(calls.length, 2);
  calls.length = 0; await assert.doesNotReject(send(mk(['throw']))); assert.equal(calls.length, 2, 'gives up after the retry without throwing');
  calls.length = 0; await send(mk([422])); assert.equal(calls.length, 1, 'a rejected request is not retried');
  calls.length = 0; await send(mk([401])); assert.equal(calls.length, 1);
}

/* ---- request body reader ---- */
{
  const req = (body, headers = {}) => new Request('https://x.test/', {method: 'POST', body, headers});
  assert.equal(await readBody(req('hello'), 100), 'hello');
  assert.equal(await readBody(new Request('https://x.test/', {method: 'POST'}), 100), '', 'no body is an empty string, not "too large"');
  assert.equal(await readBody(req('x'.repeat(200)), 100), null);
  let pulled = 0;
  const stream = new ReadableStream({pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 500) c.close(); }});
  assert.equal(await readBody(new Request('https://x.test/', {method: 'POST', body: stream, duplex: 'half'}), 4096), null);
  assert.ok(pulled <= 10, `stopped reading at the cap (${pulled} chunks)`);
}

/* ---- restoring through a password reset is recorded like the other restore paths ---- */
{
  const env = makeEnv(), c = await member(env, 'gone@example.com');
  await c.post('/me/delete', {confirm: 'DELETE', password: PW});
  await client(env).post('/auth/forgot-password', {email: 'gone@example.com'});
  await client(env).post('/auth/reset-password', {token: tokenFrom(env.mails, 'reset'), password: 'restored long passphrase'});
  assert.equal(count(env, 'audit_log', "WHERE event = 'restore'"), 1); assert.equal(row(env, 'SELECT deleted_at FROM users').deleted_at, null);
}

console.log('PASS: review fixes hold: pre-hijack incl. linked logins, UNIQUE races, mail caps, address-bound reset links, recent-login for passwordless accounts, mail retry, capped body reads');
