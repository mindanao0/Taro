// Reminders through a LINE Official Account (Messaging API). LINE Notify has been shut down, so this is the supported route.
// The visitor must have linked LINE login, consented, and added the Official Account as a friend. The login channel and the
// Messaging API channel must sit under the same LINE provider, otherwise the two user ids differ and cannot be matched.
import {hmac, timingSafeEqual} from './crypto.mjs';
import {hasConsent} from './account.mjs';
import {dailyCardId, bangkokDate} from './daily.mjs';
import {CARDS} from './deck.mjs';
import {json, readBody, readJson} from './http.mjs';
import {iso, webUrl} from './util.mjs';

const API = 'https://api.line.me/v2/bot';
export const HOURLY_CRON = '7 * * * *';
const MAX_SENDS_PER_RUN = 40;   // stays inside a Worker's subrequest budget; anything left goes out in the next hourly run
const doFetch = env => env.FETCHER || fetch;
const bearer = env => ({authorization: `Bearer ${env.LINE_MESSAGING_TOKEN}`, 'content-type': 'application/json'});

const view = (env, sub, linked, consent) => ({
  linked, consent,
  subscription: sub ? {enabled: !!sub.enabled, friend: !!sub.friend, blocked: !!sub.blocked_at, schedule: sub.schedule, hour: sub.hour, weekday: sub.weekday} : null,
  add_friend_url: env.LINE_OA_URL || null
});

const lineIdentity = (env, userId) => env.DB.prepare("SELECT provider_user_id AS id FROM identities WHERE user_id = ? AND provider = 'line'").bind(userId).first();

// true / false when LINE answers clearly, null when it cannot be told (outage, rate limit, bad token): then the stored value is kept.
async function isFriend(env, lineUserId) {
  if (!env.LINE_MESSAGING_TOKEN) return false;
  try {
    const r = await doFetch(env)(`${API}/profile/${encodeURIComponent(lineUserId)}`, {headers: bearer(env)});
    return r.status === 200 ? true : r.status === 404 ? false : null;   // 404: the visitor has not added the account (or blocked it)
  } catch { return null; }
}

export async function getLineNotify(req, env, _ctx, s) {
  const [id, sub, consent] = await Promise.all([lineIdentity(env, s.user.id), env.DB.prepare('SELECT * FROM line_subscriptions WHERE user_id = ?').bind(s.user.id).first(), hasConsent(env, s.user.id, 'line_notify')]);
  return json(200, view(env, sub, !!id, consent));
}

export async function putLineNotify(req, env, _ctx, s) {
  const b = await readJson(req);
  const schedule = b?.schedule ?? 'weekly', hour = b?.hour ?? 19, weekday = b?.weekday ?? 0;
  if (typeof b?.enabled !== 'boolean' || !['daily', 'weekly'].includes(schedule) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return json(400, {error: 'invalid_request'});
  const id = await lineIdentity(env, s.user.id);
  if (!id) return json(409, {error: 'line_not_linked'});
  if (b.enabled && !(await hasConsent(env, s.user.id, 'line_notify'))) return json(403, {error: 'consent_required'});   // reminders are opt-in
  const known = await env.DB.prepare('SELECT friend FROM line_subscriptions WHERE user_id = ? AND line_user_id = ?').bind(s.user.id, id.id).first();
  const checked = await isFriend(env, id.id);
  const friend = checked ?? !!known?.friend;   // a failed check must not overwrite what the follow webhook already told us
  await env.DB.prepare(
    `INSERT INTO line_subscriptions (user_id, line_user_id, enabled, friend, schedule, hour, weekday, fail_count, blocked_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT (user_id) DO UPDATE SET line_user_id = excluded.line_user_id, enabled = excluded.enabled, friend = excluded.friend,
       schedule = excluded.schedule, hour = excluded.hour, weekday = excluded.weekday, fail_count = 0, blocked_at = NULL`)
    .bind(s.user.id, id.id, b.enabled ? 1 : 0, friend ? 1 : 0, schedule, hour, weekday).run();
  const sub = await env.DB.prepare('SELECT * FROM line_subscriptions WHERE user_id = ?').bind(s.user.id).first();
  return json(200, view(env, sub, true, true));
}

export async function deleteLineNotify(req, env, _ctx, s) {
  await env.DB.prepare('DELETE FROM line_subscriptions WHERE user_id = ?').bind(s.user.id).run();
  return json(204);
}

// Webhook from LINE: friend added / removed, and "หยุด" typed in the chat.
export async function lineWebhook(req, env) {
  if (!env.LINE_MESSAGING_SECRET) return json(503, {error: 'not_configured'});
  const text = await readBody(req, 65536);   // capped while reading: the body is not trusted until its signature checks out
  if (text === null) return json(413, {error: 'too_large'});
  const sig = req.headers.get('x-line-signature') || '';
  let ok = false;
  try { ok = timingSafeEqual(await hmac(env.LINE_MESSAGING_SECRET, text), Uint8Array.from(atob(sig), c => c.charCodeAt(0))); } catch { ok = false; }
  if (!ok) return json(401, {error: 'bad_signature'});   // only LINE knows the channel secret
  let body;
  try { body = JSON.parse(text); } catch { return json(400, {error: 'bad_json'}); }
  const now = iso();
  for (const ev of Array.isArray(body.events) ? body.events.slice(0, 100) : []) {
    const uid = ev?.source?.userId;
    if (typeof uid !== 'string' || uid.length > 64) continue;
    if (ev.type === 'follow') await env.DB.prepare('UPDATE line_subscriptions SET friend = 1, fail_count = 0, blocked_at = NULL WHERE line_user_id = ?').bind(uid).run();
    else if (ev.type === 'unfollow') await env.DB.prepare('UPDATE line_subscriptions SET friend = 0, blocked_at = ? WHERE line_user_id = ?').bind(now, uid).run();
    else if (ev.type === 'message' && ev.message?.type === 'text' && ['หยุด', 'stop'].includes(String(ev.message.text).trim().toLowerCase())) {
      const sub = await env.DB.prepare('SELECT user_id FROM line_subscriptions WHERE line_user_id = ?').bind(uid).first();
      if (sub) {
        await env.DB.batch([
          env.DB.prepare('UPDATE line_subscriptions SET enabled = 0 WHERE user_id = ?').bind(sub.user_id),
          env.DB.prepare("INSERT INTO consents (user_id, kind, version, granted, at) VALUES (?, 'line_notify', 'chat-stop', 0, ?)").bind(sub.user_id, now)   // withdrawal by chat is recorded like any other
        ]);
        if (env.LINE_MESSAGING_TOKEN && ev.replyToken) {
          try { await doFetch(env)(`${API}/message/reply`, {method: 'POST', headers: bearer(env), body: JSON.stringify({replyToken: ev.replyToken, messages: [{type: 'text', text: 'หยุดการแจ้งเตือนแล้ว เปิดใหม่ได้ที่หน้าตั้งค่าบัญชีบนเว็บ'}]})}); } catch { /* the stop already took effect */ }
        }
      }
    }
  }
  return json(200, {});
}

/* ---------- hourly sender ---------- */
const THAI = 7 * 3_600_000;
const thai = ms => { const d = new Date(ms + THAI); return {date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay()}; };

export function isDue(sub, nowMs) {
  const t = thai(nowMs);
  if (t.hour < sub.hour) return false;
  const last = sub.last_sent_at ? Date.parse(sub.last_sent_at) : null;
  if (sub.schedule === 'daily') return !last || thai(last).date < t.date;
  return t.weekday === sub.weekday && (!last || nowMs - last > 6 * 86_400_000);
}

export async function messageText(env, nowMs) {
  const link = `${webUrl(env)}/`;
  let line = 'ถึงเวลาทบทวนตัวเองกับไพ่แล้ว';
  if (env.DAILY_SECRET) {
    const id = await dailyCardId(env.DAILY_SECRET, bangkokDate(nowMs)), card = CARDS.find(c => c.id === id);
    if (card) line = `ไพ่ประจำวันนี้: ${card.name_th} (${card.name_en})`;   // public, same for everyone: never the visitor's own question or reading
  }
  return `${line}\nเปิดอ่านความหมาย ${link}\n\nไม่อยากรับอีก พิมพ์ "หยุด" ในแชตนี้ได้เลย`;
}

const CHUNK = 5, STRIKES = 3;   // pushes in flight at once; consecutive refusals before a user is switched off

export async function sendDue(env, nowMs = Date.now()) {
  if (!env.LINE_MESSAGING_TOKEN) return {sent: 0, skipped: 'not_configured'};
  // Healthy subscribers first, so people LINE keeps refusing cannot use up the per-run quota. The latest consent comes in the same query.
  const rows = (await env.DB.prepare(
    `SELECT s.*, (SELECT granted FROM consents c WHERE c.user_id = s.user_id AND c.kind = 'line_notify' ORDER BY c.id DESC LIMIT 1) AS consent
     FROM line_subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.enabled = 1 AND s.friend = 1 AND s.blocked_at IS NULL AND u.deleted_at IS NULL
     ORDER BY s.fail_count, s.last_sent_at IS NOT NULL, s.last_sent_at LIMIT 500`).all()).results;
  const noConsent = rows.filter(r => !r.consent);
  if (noConsent.length) await env.DB.batch(noConsent.map(r => env.DB.prepare('UPDATE line_subscriptions SET enabled = 0 WHERE user_id = ?').bind(r.user_id)));
  const due = rows.filter(r => r.consent && isDue(r, nowMs)).slice(0, MAX_SENDS_PER_RUN);
  const text = await messageText(env, nowMs);
  const out = {sent: 0, failed: 0, blocked: 0, aborted: null};
  const push = async sub => {
    try { return (await doFetch(env)(`${API}/message/push`, {method: 'POST', headers: bearer(env), body: JSON.stringify({to: sub.line_user_id, messages: [{type: 'text', text}]})})).status; }
    catch { return 0; }
  };
  for (let i = 0; i < due.length && !out.aborted; i += CHUNK) {
    const chunk = due.slice(i, i + CHUNK), statuses = await Promise.all(chunk.map(push));
    for (const [k, status] of statuses.entries()) {
      const sub = chunk[k];
      if (status === 200) { await env.DB.prepare('UPDATE line_subscriptions SET last_sent_at = ?, fail_count = 0 WHERE user_id = ?').bind(iso(nowMs), sub.user_id).run(); out.sent++; }
      else if (status === 401 || status === 403) out.aborted ||= 'auth';   // our token or channel is wrong: nothing here is the user's fault, so no user is touched
      else if (status === 429) out.aborted ||= 'rate';   // stop now; the rest go out in the next hourly run
      else if (status === 0 || status >= 500) out.failed++;   // outage or network error: left as is, tried again next run
      else {   // the request itself was refused for this user (unknown or invalid id): count it, and stop after repeated refusals
        const strikes = sub.fail_count + 1;
        await env.DB.prepare('UPDATE line_subscriptions SET fail_count = ?, blocked_at = ? WHERE user_id = ?').bind(strikes, strikes >= STRIKES ? iso(nowMs) : null, sub.user_id).run();
        strikes >= STRIKES ? out.blocked++ : out.failed++;
      }
    }
  }
  if (out.failed || out.blocked || out.aborted) console.warn('line reminders', out);   // counts only
  return out;
}
