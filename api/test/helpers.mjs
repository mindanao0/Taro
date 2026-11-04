// Test harness: real migrations on SQLite (node:sqlite), a D1 look-alike, a capturing mailer and a cookie jar.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../index.js';

export const ORIGIN = 'https://ivoryrosetarot.online';

export function makeEnv(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const mails = [];
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => { assert.ok(a.every(v => v !== undefined), 'undefined bound in: ' + sql); return stmt(sql, a); },
    run: async () => { const r = db.prepare(sql).run(...args); return {meta: {changes: Number(r.changes)}}; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({results: db.prepare(sql).all(...args)})
  });
  const env = {
    db,
    mails,
    DB: {prepare: sql => stmt(sql), batch: async list => {
      db.exec('BEGIN');
      try { for (const s of list) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    }},
    MAILER: async m => { mails.push(m); },
    PBKDF2_ITERATIONS: '1000',   // fast in tests; production uses the default in lib/crypto.mjs
    WEB_URL: 'https://ivoryrosetarot.online',
    ...extra
  };
  return env;
}

// A browser-like client: keeps cookies (session + oauth state) and sends the same-site Origin.
export function client(env, {origin = ORIGIN} = {}) {
  const pending = [];
  const ctx = {waitUntil: p => pending.push(p)};
  const jar = new Map();
  const SESSION = '__Host-taro_session';
  const call = async (method, path, body, {headers = {}, withOrigin = true, rawBody, contentType = 'application/json', host = 'https://api.test'} = {}) => {
    const h = {...headers};
    if (withOrigin && origin) h.origin = origin;
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined || rawBody !== undefined) h['content-type'] = contentType;
    const res = await worker.fetch(new Request(host + path, {method, redirect: 'manual', headers: h, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body))}), env, ctx);
    await Promise.all(pending.splice(0));   // let background mail sends finish
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';'), i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      value ? jar.set(name, value) : jar.delete(name);
    }
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = await res.json();
    return {status: res.status, data, headers: res.headers, location: res.headers.get('location')};
  };
  return {call, post: (p, b, o) => call('POST', p, b, o), get: (p, o) => call('GET', p, undefined, o),
    put: (p, b, o) => call('PUT', p, b, o), del: (p, o) => call('DELETE', p, undefined, o),
    jar,
    get cookie() { return jar.has(SESSION) ? `${SESSION}=${jar.get(SESSION)}` : ''; },
    set cookie(v) { const i = v.indexOf('='); v ? jar.set(v.slice(0, i), v.slice(i + 1)) : jar.delete(SESSION); }};
}

// Pulls the token out of the newest email's link (#verify=... or #reset=...)
export const tokenFrom = (mails, kind) => {
  for (let i = mails.length - 1; i >= 0; i--) {
    const m = mails[i].text.match(new RegExp(`#${kind}=([\\w-]+)`));
    if (m) return m[1];
  }
  return null;
};
