// Feedback / bug reports. Open to everyone; attached to the account when the visitor is signed in.
import {json, readJson} from './http.mjs';
import {currentSession} from './session.mjs';
import {cleanText, iso} from './util.mjs';

export async function postFeedback(req, env) {
  const b = await readJson(req, 4096);
  if (!b || !['bug', 'content', 'idea'].includes(b.kind) || typeof b.body !== 'string') return json(400, {error: 'invalid_request'});
  const body = cleanText(b.body, 1000);
  if (body.length < 3) return json(400, {error: 'too_short'});
  const page = typeof b.page === 'string' && /^\/[\w\-./?=&%]{0,99}$/.test(b.page) ? b.page : null;
  const s = await currentSession(env, req);
  await env.DB.prepare('INSERT INTO feedback (id, user_id, kind, body, page, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), s?.user.id ?? null, b.kind, body, page, iso()).run();
  return json(204);
}
