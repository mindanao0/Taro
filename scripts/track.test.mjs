import assert from 'node:assert/strict';
import {createTracker, pointOf, TYPES} from './track.mjs';

const mk = (o = {}) => {
  const sent = []; let t = 1000, allowed = true;
  const tr = createTracker({url: 'https://x.test/e', consent: () => allowed, send: (u, b) => sent.push(JSON.parse(b)),
    now: () => t, sid: 's1', meta: {viewport_w: 390}, setTimer: () => 1, ...o});
  return {tr, sent, tick: ms => { t += ms; }, consent: v => { allowed = v; }};
};

// no url -> nothing buffered or sent
{ const {tr, sent} = mk({url: ''}); tr.track('pick'); tr.flush(); assert.equal(sent.length, 0); assert.equal(tr.size, 0); }

// no consent -> nothing buffered; withdrawing consent drops what is buffered
{ const {tr, sent, consent} = mk(); consent(false); tr.track('pick'); assert.equal(tr.size, 0);
  consent(true); tr.track('pick'); assert.equal(tr.size, 1); consent(false); tr.flush(); assert.equal(sent.length, 0); assert.equal(tr.size, 0); }

// sequence, timing, meta only on first batch
{ const {tr, sent, tick} = mk({batch: 2});
  tr.track('start_pick', {target: 'spread:three'}); tick(250);
  tr.track('pick', {target: 'fan:12', point: {x: 100.4, y: 200.6, rx: 1500, ry: -5}}); tick(500);
  tr.track('unpick', {target: 'slot:0', outcome: 'undone'});
  tr.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].meta, {viewport_w: 390}); assert.equal(sent[0].consent, 'analytics-1'); assert.equal(sent[1].consent, 'analytics-1'); assert.equal(sent[1].meta, undefined);
  const ev = sent.flatMap(b => b.events);
  assert.deepEqual(ev.map(e => e.seq), [1, 2, 3]);
  assert.deepEqual(ev.map(e => e.t_ms), [0, 250, 750]);
  assert.equal(ev[1].x, 100); assert.equal(ev[1].y, 201); assert.equal(ev[1].rx, 1000); assert.equal(ev[1].ry, 0);   // rounded and clamped
  assert.equal(ev[2].outcome, 'undone');
}

// unknown types/outcomes rejected; data keeps numbers/flags only (no free text); per-session cap
{ const {tr} = mk({maxEvents: 3});
  tr.track('keylog'); tr.track('pick', {outcome: 'weird'}); assert.equal(tr.size, 0);
  const {tr: t2, sent} = mk();
  t2.track('catalog_search', {data: {len: 4, n: 2, q: 'ความรัก', ok: true}}); t2.flush();
  assert.deepEqual(sent[0].events[0].data, {len: 4, n: 2, ok: true});
  for (let i = 0; i < 5; i++) tr.track('pick'); assert.equal(tr.size, 3);
}

// pointOf: relative position inside an element
assert.deepEqual(pointOf({clientX: 150, clientY: 60}, {getBoundingClientRect: () => ({left: 100, top: 10, width: 100, height: 100})}),
  {x: 150, y: 60, rx: 500, ry: 500});
assert.deepEqual(pointOf({}, null), {});
assert.ok(TYPES.has('miss_tap') && TYPES.has('pick_kept'));
console.log('PASS: tracker honours url/consent, orders events, clamps values, drops free text, caps volume');
