import {json} from './http.mjs';
import {currentSession} from './session.mjs';

export const iso = (ms = Date.now()) => new Date(ms).toISOString();

export async function audit(env, event, {userId = null, subject = null, provider = null} = {}) {
  await env.DB.prepare('INSERT INTO audit_log (user_id, event, subject, provider, at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, event, subject, provider, iso()).run();
}

export const countEvents = async (env, event, subject, sinceMs) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE event = ? AND subject = ? AND at > ?').bind(event, subject, iso(Date.now() - sinceMs)).first()).n;

// Wraps a handler that needs a signed-in user: handler(req, env, ctx, session, params)
export const authed = handler => async (req, env, ctx, params) => {
  const s = await currentSession(env, req);
  return s ? handler(req, env, ctx, s, params) : json(401, {error: 'not_signed_in'});
};

export const webUrl = env => (env.WEB_URL || 'https://ivoryrosetarot.online').replace(/\/$/, '');
export const apiUrl = env => (env.API_URL || 'https://api.ivoryrosetarot.online').replace(/\/$/, '');

export const cleanText = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
