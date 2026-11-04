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

// A browser-like client: keeps the session cookie and sends the same-site Origin.
export function client(env, {origin = ORIGIN} = {}) {
  const pending = [];
  const ctx = {waitUntil: p => pending.push(p)};
  let cookie = '';
  const call = async (method, path, body, {headers = {}, withOrigin = true, rawBody, contentType = 'application/json'} = {}) => {
    const h = {...headers};
    if (withOrigin && origin) h.origin = origin;
    if (cookie) h.cookie = cookie;
    if (body !== undefined || rawBody !== undefined) h['content-type'] = contentType;
    const res = await worker.fetch(new Request('https://api.test' + path, {method, headers: h, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body))}), env, ctx);
    await Promise.all(pending.splice(0));   // let background mail sends finish
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = await res.json();
    return {status: res.status, data, headers: res.headers};
  };
  return {call, post: (p, b, o) => call('POST', p, b, o), get: (p, o) => call('GET', p, undefined, o), get cookie() { return cookie; }, set cookie(v) { cookie = v; }};
}

// Pulls the token out of the newest email's link (#verify=... or #reset=...)
export const tokenFrom = (mails, kind) => {
  for (let i = mails.length - 1; i >= 0; i--) {
    const m = mails[i].text.match(new RegExp(`#${kind}=([\\w-]+)`));
    if (m) return m[1];
  }
  return null;
};
