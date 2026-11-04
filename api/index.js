// Cloudflare Worker `taro-api`: accounts, email/password and social login, per-user data (docs/07, docs/08). Routing and request guards live here.
import {json, originsOf} from './lib/http.mjs';
import {authed} from './lib/util.mjs';
import {providerList, socialCallback, socialStart} from './lib/social.mjs';
import {changePassword, forgotPassword, ipLimited, login, logout, me, register, resendVerification, resetPassword, verifyEmail} from './lib/auth.mjs';
import {deleteAccount, exportData, getConsents, listSessions, requestEmailChange, revokeOtherSessions, revokeSession, setConsent, unlinkIdentity, updateProfile} from './lib/account.mjs';
import {addFavorite, deleteReading, getReading, listFavorites, listReadings, removeFavorite, saveReading, setNote} from './lib/readings.mjs';
import {dailyCard} from './lib/daily.mjs';
import {HOURLY_CRON, deleteLineNotify, getLineNotify, lineWebhook, putLineNotify, sendDue} from './lib/line.mjs';
import {postFeedback} from './lib/feedback.mjs';

// [method, path pattern, handler, options]  options: limit = per-IP auth limiter, csrf = false for non-browser callers
const ROUTES = [
  ['POST', '/auth/register', register, {limit: true}], ['POST', '/auth/login', login, {limit: true}], ['POST', '/auth/logout', logout],
  ['POST', '/auth/verify-email', verifyEmail, {limit: true}], ['POST', '/auth/forgot-password', forgotPassword, {limit: true}], ['POST', '/auth/reset-password', resetPassword, {limit: true}],
  ['GET', '/auth/:provider/start', socialStart, {limit: true, csrf: false}], ['GET', '/auth/:provider/callback', socialCallback, {csrf: false}],
  ['GET', '/auth/providers', async (req, env) => json(200, {providers: providerList(env)}, {'cache-control': 'public, max-age=300'})],
  ['POST', '/me/resend-verification', authed(resendVerification), {limit: true}],
  ['GET', '/me', me], ['POST', '/me/password', changePassword], ['POST', '/me/email', authed(requestEmailChange), {limit: true}],
  ['DELETE', '/me/identities/:provider', authed(unlinkIdentity)],
  ['POST', '/me/profile', authed(updateProfile)],
  ['GET', '/me/sessions', authed(listSessions)], ['POST', '/me/sessions/revoke-others', authed(revokeOtherSessions)], ['DELETE', '/me/sessions/:id', authed(revokeSession)],
  ['GET', '/me/consents', authed(getConsents)], ['POST', '/me/consents', authed(setConsent)],
  ['GET', '/me/export', authed(exportData)], ['POST', '/me/delete', authed(deleteAccount)],
  ['GET', '/content/daily', dailyCard],
  ['POST', '/me/readings', authed(saveReading)], ['GET', '/me/readings', authed(listReadings)], ['GET', '/me/readings/:id', authed(getReading)],
  ['PUT', '/me/readings/:id/note', authed(setNote)], ['DELETE', '/me/readings/:id', authed(deleteReading)],
  ['GET', '/me/line-notify', authed(getLineNotify)], ['PUT', '/me/line-notify', authed(putLineNotify)], ['DELETE', '/me/line-notify', authed(deleteLineNotify)],
  ['POST', '/line/webhook', lineWebhook, {csrf: false}], ['POST', '/feedback', postFeedback, {limit: true}],
  ['GET', '/me/favorites', authed(listFavorites)], ['PUT', '/me/favorites/:card_id', authed(addFavorite)], ['DELETE', '/me/favorites/:card_id', authed(removeFavorite)]
];

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
    env.DB.prepare('DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(new Date(now.getTime() - 30 * 86_400_000).toISOString()),   // cascades to every row of that user
    env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(new Date(now.getTime() - 365 * 86_400_000).toISOString())
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
  async scheduled(event, env, ctx) { ctx.waitUntil(event.cron === HOURLY_CRON ? sendDue(env) : maintain(env)); }
};
