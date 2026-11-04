// Click-sequence tracker (docs/08 §4.2). Pure logic, no DOM: the page wires it up in index.html.
// Nothing is buffered or sent unless a url is configured AND consent() is true when each event happens.
export const TYPES = new Set([
  'view_enter', 'home', 'spread_select', 'reversed_toggle', 'start_pick', 'wheel_spin', 'pick', 'unpick', 'pick_kept',
  'miss_tap', 'blocked_tap', 'pick_cancel', 'auto_open', 'card_open', 'open_all', 'jump_to_reading',
  'catalog_search', 'catalog_filter', 'dialog_open', 'dialog_close']);
export const OUTCOMES = new Set(['ok', 'kept', 'undone', 'miss', 'blocked']);

const int = (v, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
const short = (v, n = 40) => typeof v === 'string' && v ? v.slice(0, n) : undefined;

// Position of a pointer event: viewport pixels plus 0-1000 inside `el` (so "left edge of fan card 12" is comparable across screens).
export function pointOf(e, el) {
  if (!e || !Number.isFinite(e.clientX)) return {};
  const p = {x: int(e.clientX, 0, 20000), y: int(e.clientY, 0, 20000)};
  const r = el?.getBoundingClientRect?.();
  if (r && r.width > 0 && r.height > 0) {
    p.rx = int(((e.clientX - r.left) / r.width) * 1000, 0, 1000);
    p.ry = int(((e.clientY - r.top) / r.height) * 1000, 0, 1000);
  }
  return p;
}

export const CONSENT_VERSION = 'analytics-1';

export function createTracker({url, consent, send, now = () => performance.now(), sid, meta = {},
  flushMs = 10000, maxEvents = 500, batch = 100, setTimer = setInterval}) {
  const enabled = Boolean(url) && typeof send === 'function';
  const buf = []; let seq = 0, t0 = now(), metaSent = false, timer = null;

  function flush() {
    if (!enabled) return;
    if (!consent()) { buf.length = 0; return; }
    while (buf.length) {
      const events = buf.splice(0, batch);
      send(url, JSON.stringify(metaSent ? {sid, consent: CONSENT_VERSION, events} : {sid, consent: CONSENT_VERSION, meta, events}));
      metaSent = true;
    }
  }
  function track(type, {view, target, outcome = 'ok', point = {}, data} = {}) {
    if (!enabled || !consent() || seq >= maxEvents || !TYPES.has(type) || !OUTCOMES.has(outcome)) return;
    const ev = {type, seq: ++seq, t_ms: Math.round(now() - t0), outcome};
    if (short(view, 12)) ev.view = view;
    if (short(target)) ev.target = target.slice(0, 40);
    for (const k of ['x', 'y']) if (point[k] !== undefined) ev[k] = int(point[k], 0, 20000);
    for (const k of ['rx', 'ry']) if (point[k] !== undefined) ev[k] = int(point[k], 0, 1000);
    if (data && typeof data === 'object') {
      const d = {};
      for (const [k, v] of Object.entries(data)) if (typeof v === 'number' || typeof v === 'boolean') d[k.slice(0, 16)] = v;   // numbers and flags only, never text
      if (Object.keys(d).length) ev.data = d;
    }
    buf.push(ev);
    if (!timer && flushMs) timer = setTimer(flush, flushMs);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; buf.length = 0; }
  return {track, flush, stop, get size() { return buf.length; }};
}
