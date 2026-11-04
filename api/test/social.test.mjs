// Social login against mock providers: real flow (start -> callback), real RS256 verification for Google.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ORIGIN, client, makeEnv, tokenFrom} from './helpers.mjs';
import {b64u} from '../lib/crypto.mjs';
import {maintain} from '../index.js';

const enc = new TextEncoder();
const row = (env, sql, ...a) => env.db.prepare(sql).get(...a);
const all = (env, sql, ...a) => env.db.prepare(sql).all(...a);
const count = (env, t) => row(env, `SELECT COUNT(*) n FROM ${t}`).n;

/* ---- a fake Google signing key and a tiny JWT signer ---- */
const gen = async () => {
  const kp = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  return {priv: kp.privateKey, jwk: {...await crypto.subtle.exportKey('jwk', kp.publicKey), kid: 'k1', alg: 'RS256', use: 'sig'}};
};
const goodKey = await gen(), otherKey = await gen();
const jwt = async (claims, {key = goodKey, alg = 'RS256', kid = 'k1'} = {}) => {
  const h = b64u(enc.encode(JSON.stringify({alg, typ: 'JWT', kid}))), p = b64u(enc.encode(JSON.stringify(claims)));
  const sig = alg === 'RS256' ? new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, enc.encode(`${h}.${p}`))) : enc.encode('x');
  return `${h}.${p}.${b64u(sig)}`;
};

/* ---- mock provider network ---- */
const mock = {profile: null, tokenReq: [], tokenStatus: 200, badNonce: false};   // tests set mock.profile before each callback
const CFG = {
  GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret',
  LINE_CHANNEL_ID: 'l-id', LINE_CHANNEL_SECRET: 'l-secret',
  FACEBOOK_APP_ID: 'f-id', FACEBOOK_APP_SECRET: 'f-secret',
  COOKIE_SECRET: 'test-cookie-secret-test-cookie-secret', API_URL: 'https://api.ivoryrosetarot.online'
};
let nonceSeen = null;   // the nonce from the start redirect, which the Google mock must echo inside the id_token
const fetcher = async (url, init = {}) => {
  url = String(url);
  const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
  const ok = o => new Response(JSON.stringify(o), {status: 200, headers: {'content-type': 'application/json'}});
  if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return ok({keys: [goodKey.jwk]});
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    mock.tokenReq.push(body);
    if (mock.tokenStatus !== 200) return new Response('{}', {status: mock.tokenStatus});
    const p = mock.profile;
    return ok({id_token: await jwt({iss: 'https://accounts.google.com', aud: 'g-id', exp: Math.floor(Date.now() / 1000) + 600, nonce: nonceSeen, ...p.claims}, p.jwtOpts)});
  }
  if (url.startsWith('https://api.line.me/oauth2/v2.1/token')) { mock.tokenReq.push(body); return ok({id_token: 'opaque-line-token', access_token: 'x'}); }
  if (url.startsWith('https://api.line.me/oauth2/v2.1/verify')) {
    assert.equal(body.client_id, 'l-id'); assert.equal(body.id_token, 'opaque-line-token');
    return ok({iss: 'https://access.line.me', aud: 'l-id', exp: Math.floor(Date.now() / 1000) + 600, nonce: mock.badNonce ? 'wrong' : body.nonce, ...mock.profile.claims});
  }
  if (url.startsWith('https://graph.facebook.com/v21.0/oauth/access_token')) { mock.tokenReq.push(body); return ok({access_token: 'fb-token'}); }
  if (url.startsWith('https://graph.facebook.com/v21.0/me?')) {
    assert.equal(new URL(url).searchParams.get('access_token'), 'fb-token');
    return ok(mock.profile.fb);
  }
  throw new Error('unexpected fetch ' + url);
};

const fresh = () => makeEnv({...CFG, FETCHER: fetcher});
const qs = location => Object.fromEntries(new URL(location).searchParams);
const hash = location => Object.fromEntries(new URLSearchParams(new URL(location).hash.slice(1)));

// Runs start + callback like a browser would. Returns the callback response and the start parameters.
async function social(c, provider, profile, {mode = 'login', state, mutateCookie, query = ''} = {}) {
  mock.profile = profile; mock.tokenReq = [];
  const start = await c.get(`/auth/${provider}/start?mode=${mode}&return=/account.html`, {withOrigin: false});
  assert.equal(start.status, 302, `start ${provider}`);
  const p = qs(start.location); nonceSeen = p.nonce;
  if (mutateCookie) c.jar.set('__Host-taro_oauth', mutateCookie(c.jar.get('__Host-taro_oauth')));
  const cb = await c.get(`/auth/${provider}/callback?code=abc&state=${encodeURIComponent(state ?? p.state)}${query}`, {withOrigin: false});
  return {cb, start, params: p, result: cb.location ? hash(cb.location) : {}};
}
const G = (sub, extra = {}) => ({claims: {sub, email: `${sub}@gmail.test`, email_verified: true, name: 'Gina Google', picture: 'https://img.test/g.png', ...extra}});
const L = (sub, extra = {}) => ({claims: {sub, name: 'Lek Line', picture: 'https://img.test/l.png', ...extra}});
const F = (id, extra = {}) => ({fb: {id, name: 'Fon Face', picture: {data: {url: 'https://img.test/f.png'}}, ...extra}});

/* ---- start: only configured providers, correct request ---- */
{
  const env = fresh(), c = client(env);
  const none = client(makeEnv({COOKIE_SECRET: 'x'}));
  assert.equal((await none.get('/auth/google/start', {withOrigin: false})).status, 404, 'unconfigured provider');
  assert.equal((await c.get('/auth/nope/start', {withOrigin: false})).status, 404);
  assert.equal((await client(makeEnv({...CFG})).get('/auth/google/start', {withOrigin: false})).status, 302);

  for (const [name, host, scope, pkce] of [['google', 'accounts.google.com', 'openid email profile', true], ['line', 'access.line.me', 'profile openid email', true], ['facebook', 'www.facebook.com', 'public_profile,email', false]]) {
    const r = await c.get(`/auth/${name}/start`, {withOrigin: false});
    const u = new URL(r.location), p = Object.fromEntries(u.searchParams);
    assert.equal(u.host, host); assert.equal(p.response_type, 'code'); assert.equal(p.scope, scope);
    assert.equal(p.redirect_uri, `https://api.ivoryrosetarot.online/auth/${name}/callback`);
    assert.ok(p.state.length >= 30 && p.nonce.length >= 30);
    assert.equal(!!p.code_challenge, pkce); if (pkce) assert.equal(p.code_challenge_method, 'S256');
    const set = r.headers.get('set-cookie');
    for (const f of ['__Host-taro_oauth=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) assert.ok(set.includes(f), f);
  }
  assert.deepEqual((await c.get('/auth/google/start?mode=login&return=//evil.test', {withOrigin: false})).status, 302);   // hostile return is ignored below
  const cbBad = (await social(c, 'google', G('ret1'), {})).cb;
  assert.ok(cbBad.location.startsWith('https://ivoryrosetarot.online/account.html#'));
}

/* ---- Google: new user, repeat login, PKCE binding ---- */
{
  const env = fresh(), c = client(env);
  const {cb, params, result} = await social(c, 'google', G('g-1'));
  assert.equal(cb.status, 302); assert.equal(cb.location, 'https://ivoryrosetarot.online/account.html#login=ok');
  assert.match(cb.headers.getSetCookie().join('\n'), /__Host-taro_session=[\w-]{40,}; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  assert.equal(c.jar.has('__Host-taro_oauth'), false, 'one-time state cookie is cleared');
  const t = mock.tokenReq[0];
  assert.equal(t.client_secret, 'g-secret'); assert.equal(t.redirect_uri, 'https://api.ivoryrosetarot.online/auth/google/callback');
  assert.equal(b64u(createHash('sha256').update(t.code_verifier).digest()), params.code_challenge, 'verifier matches the challenge sent at start');
  const me = (await c.get('/me')).data;
  assert.equal(me.user.email, 'g-1@gmail.test'); assert.equal(me.user.email_verified, true); assert.equal(me.user.display_name, 'Gina Google');
  assert.equal(me.has_password, false); assert.deepEqual(me.identities, ['google']); assert.deepEqual(me.providers_available, ['google', 'line', 'facebook']);
  assert.ok(row(env, 'SELECT last_login_at FROM users').last_login_at);

  await c.post('/auth/logout', {});
  await social(c, 'google', G('g-1', {email: 'changed@gmail.test'}));   // same identity, even if the address changed
  assert.equal(count(env, 'users'), 1); assert.equal(count(env, 'identities'), 1);
  assert.equal((await c.get('/me')).data.user.email, 'g-1@gmail.test');
}

/* ---- callback rejects forged or stale requests ---- */
{
  const env = fresh();
  const reject = async (label, opts, expected, profile = G('x1')) => {
    const c = client(env), before = count(env, 'users');
    const {result} = await social(c, 'google', profile, opts);
    assert.equal(result.error, expected, label);
    assert.equal((await c.get('/me')).status, 401, label + ': no session');
    assert.equal(count(env, 'users'), before, label + ': no user created');
  };
  await reject('wrong state', {state: 'attacker-state'}, 'bad_state');
  await reject('tampered cookie', {mutateCookie: v => v.slice(0, -3) + 'AAA'}, 'session_expired');
  await reject('cookie signed for another payload', {mutateCookie: v => 'e30.' + v.split('.')[1]}, 'session_expired');
  await reject('user cancelled', {query: '&error=access_denied'}, 'cancelled');
  await reject('bad nonce', {}, 'provider_error', G('x2', {nonce: 'replayed'}));   // claims override nonce
  await reject('wrong audience', {}, 'provider_error', G('x3', {aud: 'someone-elses-app'}));
  await reject('wrong issuer', {}, 'provider_error', G('x4', {iss: 'https://evil.test'}));
  await reject('expired token', {}, 'provider_error', G('x5', {exp: Math.floor(Date.now() / 1000) - 3600}));
  await reject('signed by another key', {}, 'provider_error', {...G('x6'), jwtOpts: {key: otherKey}});
  await reject('alg none/HS256', {}, 'provider_error', {...G('x7'), jwtOpts: {alg: 'HS256'}});
  await reject('unknown kid', {}, 'provider_error', {...G('x8'), jwtOpts: {kid: 'nope'}});
  mock.tokenStatus = 400;
  await reject('token exchange fails', {}, 'provider_error');
  mock.tokenStatus = 200;
  // a callback with no prior start (no cookie) is refused
  const c = client(env);
  assert.equal(hash((await c.get('/auth/google/callback?code=a&state=b', {withOrigin: false})).location).error, 'session_expired');
  // the cookie issued for one provider cannot complete another
  const c2 = client(env);
  mock.profile = L('l-x'); await c2.get('/auth/line/start', {withOrigin: false});
  assert.equal(hash((await c2.get('/auth/google/callback?code=a&state=b', {withOrigin: false})).location).error, 'session_expired');
}

/* ---- merging rules ---- */
{
  // verified Google address matches an existing verified password account -> same user, password kept
  const env = fresh(), web = client(env);
  await web.post('/auth/register', {email: 'dana@gmail.test', password: 'danas long password'});
  await web.post('/auth/verify-email', {token: tokenFrom(env.mails, 'verify')});
  const uid = row(env, 'SELECT id FROM users').id;
  const c = client(env);
  assert.equal((await social(c, 'google', G('dana-g', {email: 'dana@gmail.test'}))).result.login, 'ok');
  assert.equal(count(env, 'users'), 1); assert.equal((await c.get('/me')).data.user.id, uid);
  assert.equal((await c.get('/me')).data.has_password, true);
  assert.equal((await client(env).post('/auth/login', {email: 'dana@gmail.test', password: 'danas long password'})).status, 200);
}
{
  // PRE-HIJACKING: attacker registers the victim's address (never verified); the victim then signs in with Google
  const env = fresh(), attacker = client(env);
  await attacker.post('/auth/register', {email: 'victim@gmail.test', password: 'attackers password!'});
  assert.equal((await attacker.post('/auth/login', {email: 'victim@gmail.test', password: 'attackers password!'})).status, 200);
  assert.equal((await attacker.get('/me')).status, 200);
  const victim = client(env);
  assert.equal((await social(victim, 'google', G('victim-g', {email: 'victim@gmail.test'}))).result.login, 'ok');
  assert.equal((await attacker.get('/me')).status, 401, 'attacker session revoked');
  assert.equal((await client(env).post('/auth/login', {email: 'victim@gmail.test', password: 'attackers password!'})).status, 401, 'attacker password revoked');
  assert.equal(count(env, 'credentials'), 0); assert.equal(count(env, 'email_tokens'), 0);
  assert.equal((await victim.get('/me')).data.user.email_verified, true);
}
{
  // LINE / Facebook: an address the provider does not vouch for never reaches users.email and never merges
  const env = fresh();
  const line = client(env);
  const r = await social(line, 'line', L('line-1', {email: 'lek@line.test'}));
  assert.equal(r.result.login, 'ok');
  let me = (await line.get('/me')).data;
  assert.equal(me.user.email, null, 'unverified address stays off the account'); assert.equal(me.user.email_verified, false);
  assert.equal(me.user.display_name, 'Lek Line'); assert.deepEqual(me.identities, ['line']);
  assert.equal(row(env, 'SELECT email FROM identities').email, 'lek@line.test');
  assert.equal(mock.tokenReq[0].code_verifier.length >= 43, true);

  // squatting: the real owner of that address can still register normally
  const owner = client(env);
  const reg = await owner.post('/auth/register', {email: 'lek@line.test', password: 'real owners password'});
  assert.equal(reg.status, 201);
  assert.match(env.mails.at(-1).subject, /ยืนยันอีเมล/, 'a normal verification mail, not the "already exists" one');
  assert.equal(count(env, 'users'), 2);

  // now an existing account owns the address: LINE with the same address is refused, not merged
  const other = client(env);
  const r2 = await social(other, 'line', L('line-2', {email: 'lek@line.test'}));
  assert.equal(r2.result.error, 'email_exists_login_first');
  assert.equal(count(env, 'identities'), 1); assert.equal((await other.get('/me')).status, 401);
  // without an address at all, that is fine
  assert.equal((await social(client(env), 'line', L('line-3'))).result.login, 'ok');
  // LINE nonce mismatch is rejected
  mock.badNonce = true;
  assert.equal((await social(client(env), 'line', L('line-4'))).result.error, 'provider_error');
  mock.badNonce = false;

  const fb = client(env);
  assert.equal((await social(fb, 'facebook', F('fb-1', {email: 'fon@fb.test'}))).result.login, 'ok');
  me = (await fb.get('/me')).data;
  assert.equal(me.user.email, null); assert.equal(me.user.avatar_url, 'https://img.test/f.png'); assert.deepEqual(me.identities, ['facebook']);
  assert.equal(mock.tokenReq[0].code_verifier, undefined, 'no PKCE parameter for Facebook');
  assert.equal((await social(client(env), 'facebook', F('fb-2', {email: 'lek@line.test'}))).result.error, 'email_exists_login_first');
  assert.equal((await social(client(env), 'facebook', F('fb-3', {picture: {data: {url: 'http://insecure.test/x.png'}}}))).result.login, 'ok');
  assert.equal(row(env, "SELECT u.avatar_url a FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider_user_id = 'fb-3'").a, null, 'non-https avatars are dropped');
}

/* ---- linking and unlinking ---- */
{
  const env = fresh(), c = client(env);
  await c.post('/auth/register', {email: 'kim@example.com', password: 'kims long password'});
  const noSession = await client(env).get('/auth/google/start?mode=link', {withOrigin: false});   // link needs a session
  assert.equal(hash(noSession.location).error, 'not_signed_in'); assert.ok(!noSession.headers.get('set-cookie'));
  await c.post('/auth/login', {email: 'kim@example.com', password: 'kims long password'});
  const uid = row(env, 'SELECT id FROM users').id;

  assert.equal((await social(c, 'line', L('line-kim'), {mode: 'link'})).result.linked, 'line');
  assert.deepEqual((await c.get('/me')).data.identities, ['line']);
  assert.equal(row(env, 'SELECT user_id FROM identities').user_id, uid);
  assert.equal(count(env, 'users'), 1, 'linking creates no second user');

  // an identity already used by another account cannot be linked here
  const lee = client(env);
  await social(lee, 'google', G('lee-g'));
  const leeId = (await lee.get('/me')).data.user.id;
  assert.equal((await social(c, 'google', G('lee-g'), {mode: 'link'})).result.error, 'identity_in_use');
  assert.equal(row(env, "SELECT user_id u FROM identities WHERE provider_user_id = 'lee-g'").u, leeId);

  // a link started by one session cannot be finished by another
  mock.profile = L('line-sneaky');
  const start = await c.get('/auth/line/start?mode=link', {withOrigin: false});
  const other = client(env); other.jar.set('__Host-taro_oauth', c.jar.get('__Host-taro_oauth'));
  nonceSeen = qs(start.location).nonce;
  assert.equal(hash((await other.get(`/auth/line/callback?code=a&state=${qs(start.location).state}`, {withOrigin: false})).location).error, 'not_signed_in');

  // unlink: allowed while another way to sign in remains; refused for the last one
  assert.equal((await c.del('/me/identities/facebook')).status, 404);
  assert.equal((await client(env, {origin: 'https://evil.test'}).del('/me/identities/line')).status, 403);
  assert.equal((await c.del('/me/identities/line')).status, 204);
  assert.deepEqual((await c.get('/me')).data.identities, []);
  assert.equal((await lee.del('/me/identities/google')).status, 409, 'social-only user keeps their only login');
  assert.equal((await lee.del('/me/identities/google')).data.error, 'last_login_method');
  assert.equal((await lee.post('/me/password', {password: 'lees new password!'})).status, 204);   // social-only user adds a password...
  assert.equal((await lee.del('/me/identities/google')).status, 204);                               // ...and can then drop Google
}

/* ---- add an email to an email-less account ---- */
{
  const env = fresh(), c = client(env);
  await social(c, 'line', L('line-noemail'));
  assert.equal((await c.post('/me/email', {email: 'bad'})).status, 400);
  assert.equal((await c.post('/me/email', {email: 'New@Example.com'})).status, 202);
  assert.equal(row(env, 'SELECT email FROM users').email, null, 'not changed until the link is opened');
  const mail = env.mails.at(-1); assert.equal(mail.to, 'new@example.com');
  const tok = tokenFrom(env.mails, 'verify');
  assert.equal((await client(env).post('/auth/verify-email', {token: tok})).status, 204);   // the link works without being signed in (it proves the mailbox)
  const u = row(env, 'SELECT email, email_verified v FROM users'); assert.equal(u.email, 'new@example.com'); assert.equal(u.v, 1);
  assert.equal((await client(env).post('/auth/verify-email', {token: tok})).status, 400, 'single use');

  // an address owned by someone else: same 202, an "already exists" mail, and no token
  const reg = client(env);
  await reg.post('/auth/register', {email: 'taken@example.com', password: 'takens long password'});
  const tokens = count(env, 'email_tokens'), mails = env.mails.length;
  assert.equal((await c.post('/me/email', {email: 'taken@example.com'})).status, 202);
  assert.equal(count(env, 'email_tokens'), tokens); assert.match(env.mails.at(-1).subject, /มีบัญชีนี้อยู่แล้ว/); assert.equal(env.mails.length, mails + 1);

  // someone claims the address while a change is pending -> the link is refused
  assert.equal((await c.post('/me/email', {email: 'race@example.com'})).status, 202);
  const raceTok = tokenFrom(env.mails, 'verify');
  const racer = client(env);
  await racer.post('/auth/register', {email: 'race@example.com', password: 'racers long password'});
  assert.equal((await client(env).post('/auth/verify-email', {token: raceTok})).status, 409);
  assert.equal(row(env, "SELECT email FROM users WHERE id = (SELECT user_id FROM identities LIMIT 1)").email, 'new@example.com');

  // a user with a password must confirm it
  await reg.post('/auth/login', {email: 'taken@example.com', password: 'takens long password'});
  assert.equal((await reg.post('/me/email', {email: 'moved@example.com'})).data.error, 'wrong_password');
  assert.equal((await reg.post('/me/email', {email: 'moved@example.com', password: 'takens long password'})).status, 202);
  assert.equal((await client(env).post('/me/email', {email: 'x@example.com'})).status, 401);
}

/* ---- consents, export, deletion ---- */
{
  const env = fresh(), c = client(env);
  await c.post('/auth/register', {email: 'zoe@example.com', password: 'zoes long password'});
  await c.post('/auth/login', {email: 'zoe@example.com', password: 'zoes long password'});
  assert.equal((await client(env).get('/me/consents')).status, 401);
  assert.deepEqual((await c.get('/me/consents')).data.consents.map(x => x.kind).sort(), ['privacy', 'terms'], 'sign-up recorded the terms and privacy acceptance');
  assert.equal((await c.post('/me/consents', {kind: 'save_history', version: '1', granted: true})).status, 204);
  assert.equal((await c.post('/me/consents', {kind: 'privacy', version: '2026-11', granted: true})).status, 204);
  assert.equal((await c.post('/me/consents', {kind: 'save_history', version: '1', granted: false})).status, 204);
  for (const bad of [{kind: 'ads', version: '1', granted: true}, {kind: 'privacy', version: '1', granted: 'yes'}, {kind: 'privacy', version: '', granted: true}, {kind: 'privacy', version: 'a b', granted: true}])
    assert.equal((await c.post('/me/consents', bad)).status, 400);
  const got = (await c.get('/me/consents')).data.consents;
  assert.equal(got.find(x => x.kind === 'save_history').granted, false, 'latest answer wins');
  assert.equal(got.find(x => x.kind === 'privacy').version, '2026-11'); assert.equal(count(env, 'consents'), 5, 'history kept as proof (2 from sign-up + 3 here)');

  await social(c, 'line', L('line-zoe'), {mode: 'link'});
  env.db.prepare("INSERT INTO line_subscriptions (user_id, line_user_id, enabled, friend) SELECT id, 'U-zoe', 1, 1 FROM users").run();
  await c.post('/me/consents', {kind: 'line_notify', version: '1', granted: false});
  assert.equal(row(env, 'SELECT enabled FROM line_subscriptions').enabled, 0, 'withdrawing consent stops reminders');
  env.db.prepare('UPDATE line_subscriptions SET enabled = 1').run();
  await c.del('/me/identities/line');
  assert.equal(count(env, 'line_subscriptions'), 0, 'unlinking LINE removes the reminder');

  const ex = await c.get('/me/export');
  assert.equal(ex.status, 200);
  const dump = JSON.stringify(await (async () => { const r = await (await import('../index.js')).default.fetch(new Request('https://api.test/me/export', {headers: {cookie: c.cookie, origin: ORIGIN}}), env, {waitUntil() {}}); assert.match(r.headers.get('content-disposition'), /attachment/); return r.json(); })());
  assert.ok(dump.includes('zoe@example.com') && dump.includes('save_history'));
  assert.ok(!/pbkdf2|password_hash/.test(dump), 'no password hash in the export');
  assert.equal((await client(env).get('/me/export')).status, 401);

  // delete account
  assert.equal((await c.post('/me/delete', {})).data.error, 'confirmation_required');
  assert.equal((await c.post('/me/delete', {confirm: 'DELETE'})).data.error, 'wrong_password');
  assert.equal((await c.post('/me/delete', {confirm: 'DELETE', password: 'wrong wrong wrong'})).status, 403);
  assert.equal((await client(env, {origin: 'https://evil.test'}).post('/me/delete', {confirm: 'DELETE'})).status, 403);
  assert.equal((await c.post('/me/delete', {confirm: 'DELETE', password: 'zoes long password'})).status, 204);
  assert.equal((await c.get('/me')).status, 401);
  assert.equal((await client(env).post('/auth/login', {email: 'zoe@example.com', password: 'zoes long password'})).status, 401, 'deleted accounts cannot sign in');
  assert.equal(count(env, 'sessions'), 0);
  assert.equal(count(env, 'users'), 1, 'kept for the 30-day grace period');
  env.db.prepare("UPDATE users SET deleted_at = '2000-01-01T00:00:00.000Z'").run();
  await maintain(env);
  for (const t of ['users', 'identities', 'consents', 'credentials']) assert.equal(count(env, t), 0, t + ' purged');

  // a deleted account's social identity can't be used to sign back in during the grace period
  const e2 = fresh(), s1 = client(e2);
  await social(s1, 'google', G('del-g'));
  assert.equal((await s1.post('/me/delete', {confirm: 'DELETE'})).status, 204);
  assert.equal((await social(client(e2), 'google', G('del-g'))).result.error, 'account_deleted');
}

console.log('PASS: Google/LINE/Facebook login (RS256, PKCE, state, nonce), merge rules incl. pre-hijacking, link/unlink, email change, consents, export, deletion');
