// Google / LINE / Facebook login: Authorization Code flow, with PKCE where the provider supports it (docs/07 §5).
// State, nonce and PKCE verifier travel in a short-lived signed cookie, so no table is needed.
import {b64u, fromB64u, hmac, randomToken, sha256Bytes, timingSafeEqual} from './crypto.mjs';
import {SESSION_SECONDS, createSession, currentSession} from './session.mjs';
import {sessionCookie} from './http.mjs';
import {apiUrl, audit, iso, webUrl} from './util.mjs';

const OAUTH_COOKIE = '__Host-taro_oauth';
const OAUTH_TTL = 600;
const FB_VERSION = 'v21.0';   // Graph API version; check Meta's current supported versions before deploying
const dec = new TextDecoder();

const form = o => new URLSearchParams(o).toString();
const doFetch = env => env.FETCHER || fetch;

/* ---------- signed cookie ---------- */
async function sign(env, obj) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(obj)));
  return `${body}.${b64u(await hmac(env.COOKIE_SECRET, body))}`;
}
async function unsign(env, value) {
  const [body, sig] = String(value || '').split('.');
  if (!body || !sig || !env.COOKIE_SECRET) return null;
  try {
    if (!timingSafeEqual(await hmac(env.COOKIE_SECRET, body), fromB64u(sig))) return null;
    const o = JSON.parse(dec.decode(fromB64u(body)));
    return o.exp > Date.now() ? o : null;
  } catch { return null; }
}
const oauthCookie = (value, maxAge) => `${OAUTH_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
function cookieValue(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* ---------- JWT (Google): RS256 against the provider's published keys ---------- */
const jwksCache = new Map();   // url -> {keys, at}
async function jwks(env, url) {
  const hit = jwksCache.get(url);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.keys;
  const r = await doFetch(env)(url);
  if (!r.ok) throw new Error('jwks_unavailable');
  const keys = (await r.json()).keys || [];
  jwksCache.set(url, {keys, at: Date.now()});
  return keys;
}
async function verifyRs256(env, jwt, jwksUrl) {
  const [h, p, s] = String(jwt).split('.');
  if (!h || !p || !s) throw new Error('bad_token');
  const header = JSON.parse(dec.decode(fromB64u(h)));
  if (header.alg !== 'RS256') throw new Error('bad_alg');   // never trust the token's own choice of algorithm
  let key = (await jwks(env, jwksUrl)).find(k => k.kid === header.kid);
  if (!key) { jwksCache.delete(jwksUrl); key = (await jwks(env, jwksUrl)).find(k => k.kid === header.kid); }   // keys rotate
  if (!key) throw new Error('unknown_key');
  const pub = await crypto.subtle.importKey('jwk', key, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, fromB64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad_signature');
  return JSON.parse(dec.decode(fromB64u(p)));
}
function checkClaims(c, {iss, aud, nonce}) {
  const audOk = Array.isArray(c.aud) ? c.aud.includes(aud) : c.aud === aud;
  if (!iss.includes(c.iss) || !audOk || !(c.exp * 1000 > Date.now() - 60_000) || c.nonce !== nonce || !c.sub) throw new Error('bad_claims');
}
const httpsUrl = u => typeof u === 'string' && /^https:\/\//.test(u) && u.length <= 500 ? u : null;

/* ---------- providers ---------- */
export const PROVIDERS = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email profile', pkce: true,
    creds: env => [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    async profile(env, tokens, {nonce, clientId}) {
      const c = await verifyRs256(env, tokens.id_token, 'https://www.googleapis.com/oauth2/v3/certs');
      checkClaims(c, {iss: ['https://accounts.google.com', 'accounts.google.com'], aud: clientId, nonce});
      return {sub: String(c.sub), email: c.email || null, emailVerified: c.email_verified === true || c.email_verified === 'true', name: c.name || null, picture: httpsUrl(c.picture)};
    }
  },
  line: {
    auth: 'https://access.line.me/oauth2/v2.1/authorize', token: 'https://api.line.me/oauth2/v2.1/token', scope: 'profile openid email', pkce: true,
    creds: env => [env.LINE_CHANNEL_ID, env.LINE_CHANNEL_SECRET],
    async profile(env, tokens, {nonce, clientId}) {
      // LINE verifies its own id_token (signature, expiry, audience) at this endpoint; we still check the claims it returns.
      const r = await doFetch(env)('https://api.line.me/oauth2/v2.1/verify', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: form({id_token: tokens.id_token, client_id: clientId, nonce})});
      if (!r.ok) throw new Error('bad_token');
      const c = await r.json();
      checkClaims(c, {iss: ['https://access.line.me'], aud: clientId, nonce});
      return {sub: String(c.sub), email: c.email || null, emailVerified: false, name: c.name || null, picture: httpsUrl(c.picture)};   // LINE does not vouch for the address
    }
  },
  facebook: {
    auth: `https://www.facebook.com/${FB_VERSION}/dialog/oauth`, token: `https://graph.facebook.com/${FB_VERSION}/oauth/access_token`, scope: 'public_profile,email', pkce: false,
    creds: env => [env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET],
    async profile(env, tokens) {
      const r = await doFetch(env)(`https://graph.facebook.com/${FB_VERSION}/me?` + form({fields: 'id,name,email,picture.type(large)', access_token: tokens.access_token}));
      if (!r.ok) throw new Error('bad_token');
      const c = await r.json();
      if (!c.id) throw new Error('bad_token');
      return {sub: String(c.id), email: c.email || null, emailVerified: false, name: c.name || null, picture: httpsUrl(c.picture?.data?.url)};   // Facebook does not vouch for the address
    }
  }
};
const configured = (env, name) => PROVIDERS[name]?.creds(env).every(Boolean);
export const providerList = env => Object.keys(PROVIDERS).filter(n => configured(env, n));

/* ---------- account resolution (docs/07 §5.3) ---------- */
// Only an address the provider vouches for ever lands in users.email. An unvouched address stays on the identity row,
// so nobody can squat someone else's email by signing up through LINE or Facebook with it.
export async function resolveSocial(env, provider, p, {linkUserId = null} = {}) {
  const db = env.DB, now = iso();
  const found = await db.prepare(
    'SELECT i.user_id, u.deleted_at FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.provider_user_id = ?').bind(provider, p.sub).first();
  if (found) {
    if (linkUserId && found.user_id !== linkUserId) return {error: 'identity_in_use'};
    if (found.deleted_at) {   // deleted within the 30-day grace period: proving control of the login method brings the account back
      await db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').bind(found.user_id).run();
      return {userId: found.user_id, restored: true};
    }
    return {userId: found.user_id};
  }
  const addIdentity = userId => db.prepare('INSERT INTO identities (id, user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, provider, p.sub, p.email, now);
  const fillProfile = userId => db.prepare('UPDATE users SET display_name = COALESCE(display_name, ?), avatar_url = COALESCE(avatar_url, ?) WHERE id = ?').bind(p.name?.slice(0, 60) ?? null, p.picture, userId);

  if (linkUserId) {   // signed in and adding a login method
    await db.batch([addIdentity(linkUserId), fillProfile(linkUserId)]);
    return {userId: linkUserId, linked: true};
  }
  if (p.email && p.emailVerified) {
    const same = await db.prepare('SELECT id, email_verified, deleted_at FROM users WHERE email = ?').bind(p.email.toLowerCase()).first();   // includes accounts deleted within the grace period
    if (same) {
      const stmts = [addIdentity(same.id), fillProfile(same.id), db.prepare('UPDATE users SET email_verified = 1, deleted_at = NULL WHERE id = ?').bind(same.id)];
      if (!same.email_verified) {
        // Whoever set a password on this never-verified address may not be its owner (pre-hijacking), so that password and
        // its sessions and pending links are revoked now that the real owner has proved control through the provider.
        stmts.push(db.prepare('DELETE FROM credentials WHERE user_id = ?').bind(same.id),
          db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(same.id),
          db.prepare('DELETE FROM email_tokens WHERE user_id = ?').bind(same.id));
      }
      await db.batch(stmts);
      return {userId: same.id, merged: true, restored: !!same.deleted_at};
    }
  } else if (p.email) {
    const taken = await db.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(p.email.toLowerCase()).first();
    if (taken) return {error: 'email_exists_login_first'};   // never merge on an address the provider does not vouch for
  }
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO users (id, email, email_verified, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, p.email && p.emailVerified ? p.email.toLowerCase() : null, p.email && p.emailVerified ? 1 : 0, p.name?.slice(0, 60) ?? null, p.picture, now),
    addIdentity(id)
  ]);
  return {userId: id, created: true};
}

/* ---------- endpoints ---------- */
const safeReturn = v => typeof v === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) && v.length <= 200 ? v : '/account.html';
const back = (env, ret, hash, cookies = []) => {
  const res = new Response(null, {status: 302, headers: {location: `${webUrl(env)}${ret}#${hash}`, 'cache-control': 'no-store'}});
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
};

export async function socialStart(req, env, _ctx, params) {
  const name = params.provider, prov = PROVIDERS[name];
  if (!prov || !configured(env, name) || !env.COOKIE_SECRET) return new Response(JSON.stringify({error: 'provider_unavailable'}), {status: 404, headers: {'content-type': 'application/json'}});
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
  const ret = safeReturn(url.searchParams.get('return'));
  let userId = null;
  if (mode === 'link') {
    const s = await currentSession(env, req);
    if (!s) return back(env, ret, 'error=not_signed_in');
    userId = s.user.id;
  }
  const state = randomToken(24), nonce = randomToken(24), verifier = randomToken(48);
  const [clientId] = prov.creds(env);
  const q = {response_type: 'code', client_id: clientId, redirect_uri: `${apiUrl(env)}/auth/${name}/callback`, scope: prov.scope, state, nonce};
  if (prov.pkce) { q.code_challenge = b64u(await sha256Bytes(verifier)); q.code_challenge_method = 'S256'; }
  if (name === 'google') q.prompt = 'select_account';
  const cookie = await sign(env, {provider: name, state, nonce, verifier, mode, userId, ret, exp: Date.now() + OAUTH_TTL * 1000});
  return new Response(null, {status: 302, headers: {location: `${prov.auth}?${form(q)}`, 'set-cookie': oauthCookie(cookie, OAUTH_TTL), 'cache-control': 'no-store'}});
}

export async function socialCallback(req, env, _ctx, params) {
  const name = params.provider, prov = PROVIDERS[name];
  const jar = await unsign(env, cookieValue(req, OAUTH_COOKIE));
  const clear = oauthCookie('', 0);
  if (!prov || !configured(env, name) || !jar || jar.provider !== name) return back(env, '/account.html', 'error=session_expired', [clear]);
  const ret = safeReturn(jar.ret), url = new URL(req.url);
  const fail = code => back(env, ret, `error=${code}`, [clear]);
  if (url.searchParams.get('error')) return fail('cancelled');
  const given = url.searchParams.get('state'), code = url.searchParams.get('code');
  if (!code || !given || !timingSafeEqual(new TextEncoder().encode(given), new TextEncoder().encode(jar.state))) return fail('bad_state');

  const [clientId, clientSecret] = prov.creds(env);
  let profile;
  try {
    const body = {grant_type: 'authorization_code', code, redirect_uri: `${apiUrl(env)}/auth/${name}/callback`, client_id: clientId, client_secret: clientSecret};
    if (prov.pkce) body.code_verifier = jar.verifier;
    const r = await doFetch(env)(prov.token, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded', accept: 'application/json'}, body: form(body)});
    if (!r.ok) throw new Error('token_exchange_failed');
    profile = await prov.profile(env, await r.json(), {nonce: jar.nonce, clientId});
  } catch (e) {
    console.error('social login failed', name, e?.message);   // reason only, never tokens or profile data
    return fail('provider_error');
  }

  // A link started by one signed-in user must finish for that same user.
  let linkUserId = null;
  if (jar.mode === 'link') {
    const s = await currentSession(env, req);
    if (!s || s.user.id !== jar.userId) return fail('not_signed_in');
    linkUserId = s.user.id;
  }
  const res = await resolveSocial(env, name, profile, {linkUserId});
  if (res.error) return fail(res.error);
  await audit(env, jar.mode === 'link' ? 'link' : res.restored ? 'restore' : 'login', {userId: res.userId, provider: name});
  if (jar.mode === 'link') return back(env, ret, `linked=${name}`, [clear]);
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(iso(), res.userId).run();
  const token = await createSession(env, res.userId, req.headers.get('user-agent'));
  return back(env, ret, res.restored ? 'login=restored' : 'login=ok', [clear, sessionCookie(token, SESSION_SECONDS)]);
}
