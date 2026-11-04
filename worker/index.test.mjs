import assert from 'node:assert/strict';
import worker from './index.js';

const rows = [];
const env = {DB: {prepare: () => ({bind: (...a) => ({run: async () => { rows.push(a); }})})}};
const call = (body, {origin = 'https://ivoryrosetarot.online', method = 'POST', e = env} = {}) =>
  worker.fetch(new Request('https://x.test/', {method, headers: origin ? {origin} : {}, body: method === 'POST' ? body : undefined}), e);

assert.equal((await call('{"q":"  รักไหม  ","spread":"three"}')).status, 204);
assert.deepEqual(rows[0].slice(0, 2), ['รักไหม', 'three']);
assert.equal((await call('{"q":"a","spread":"three"}', {origin: 'https://evil.test'})).status, 403);
assert.equal((await call('{"q":"a","spread":"three"}', {origin: null})).status, 403);
assert.equal((await call('', {method: 'GET'})).status, 405);
assert.equal((await call('not json')).status, 400);
assert.equal((await call('{"q":"   ","spread":"three"}')).status, 400);
assert.equal((await call('{"q":"a","spread":"nope"}')).status, 400);
await call(JSON.stringify({q: 'ก'.repeat(1000), spread: 'single'}));
assert.equal(rows.at(-1)[0].length, 300);
assert.equal(rows.length, 2);
assert.equal((await call('x'.repeat(5000))).status, 413);
assert.equal((await call('[1]')).status, 400);
assert.equal((await call('{"q":["a"],"spread":"three"}')).status, 400);
await call('{"q":"a\\nb\\u0000c","spread":"three"}');
assert.equal(rows.at(-1)[0], 'a b c');
let n = 0;
const limited = {...env, LIMITER: {limit: async () => ({success: ++n <= 1})}};
assert.equal((await call('{"q":"a","spread":"three"}', {e: limited})).status, 204);
assert.equal((await call('{"q":"a","spread":"three"}', {e: limited})).status, 429);
console.log('PASS: worker stores trimmed questions, rejects bad origin/method/body/size, rate limits');
