import assert from 'node:assert/strict';
import {createApi, errorText} from './api-client.mjs';

const seen = [];
const res = (status, body, type = 'application/json') => ({ok: status < 400, status, headers: {get: () => type}, json: async () => { if (body === 'bad') throw new Error('x'); return body; }});
const api = createApi('https://api.test', async (url, init) => { seen.push([url, init]); return seen.length === 99 ? Promise.reject(new Error('offline')) : res(url.endsWith('/401') ? 401 : 200, url.endsWith('/badjson') ? 'bad' : {ok: 1}); });

let r = await api.post('/auth/login', {email: 'a@b.co'});
assert.deepEqual([r.ok, r.status, r.data], [true, 200, {ok: 1}]);
assert.equal(seen[0][0], 'https://api.test/auth/login'); assert.equal(seen[0][1].credentials, 'include'); assert.equal(seen[0][1].headers['content-type'], 'application/json'); assert.equal(seen[0][1].body, '{"email":"a@b.co"}');
await api.get('/me'); assert.equal(seen[1][1].headers, undefined, 'no body, no content-type'); assert.equal(seen[1][1].body, undefined);
await api.del('/me/identities/line'); assert.equal(seen[2][1].method, 'DELETE');
r = await api.get('/401'); assert.deepEqual([r.ok, r.status], [false, 401]);
r = await api.get('/badjson'); assert.equal(r.data, null, 'unparseable body does not throw');
const down = createApi('https://api.test', async () => { throw new Error('offline'); });
r = await down.get('/me'); assert.deepEqual([r.ok, r.status, r.data.error], [false, 0, 'network']);
assert.match(errorText('invalid_credentials'), /ไม่ถูกต้อง/); assert.match(errorText('???'), /ข้อผิดพลาด/);
// every error code the API can return has a Thai message
import {readFileSync, readdirSync} from 'node:fs';
const codes = new Set();
for (const f of readdirSync(new URL('../api/lib/', import.meta.url)).concat('../index.js')) {
  const src = readFileSync(new URL('../api/lib/' + f, import.meta.url), 'utf8');
  for (const m of src.matchAll(/error: '([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of src.matchAll(/return fail\('([a-z_]+)'\)/g)) codes.add(m[1]);
}
const skip = new Set(['forbidden', 'not_found', 'server_error', 'not_linked', 'invalid_request', 'invalid_reading', 'too_long', 'invalid_note', 'invalid_cursor', 'invalid_date', 'not_configured', 'too_large', 'bad_signature', 'bad_json', 'too_short', 'unknown_card', 'provider_unavailable', 'check_email']);
const missing = [...codes].filter(c => !skip.has(c) && errorText(c) === errorText('zzz'));
assert.deepEqual(missing, [], 'API error codes without a Thai message: ' + missing);
console.log('PASS: api client (credentials, no throw on errors, offline) and Thai messages cover the API error codes');
