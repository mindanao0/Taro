// Cloudflare Worker: stores the question text (no IP, no user agent) in D1.
// The page posts with mode:'no-cors' (text/plain), so there is no preflight and no CORS headers are needed.
const SPREADS = new Set(['single', 'three', 'relationship-five', 'celtic-cross']);
const ORIGINS = new Set(['https://ivoryrosetarot.online', 'https://www.ivoryrosetarot.online']);
const MAX_BODY = 4096;           // bytes; a 1000-char Thai question is ~3 KB of UTF-8, anything longer is junk
const MAX_Q = 300;
const done = status => new Response(null, {status, headers: {'cache-control': 'no-store'}});

// Reads at most MAX_BODY bytes; returns null if the body is larger.
async function readCapped(stream) {
  if (!stream) return '';
  const reader = stream.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const {done: end, value} = await reader.read();
    if (end) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return done(405);
    // Origin is only a browser-side guard (non-browser clients can forge it), so the rate limit below is the real abuse control.
    if (!ORIGINS.has(req.headers.get('origin'))) return done(403);
    if (Number(req.headers.get('content-length')) > MAX_BODY) return done(413);

    // Optional rate limit (binding LIMITER in wrangler.toml). The IP is used as a key only, never stored.
    if (env.LIMITER) {
      const {success} = await env.LIMITER.limit({key: req.headers.get('cf-connecting-ip') || 'unknown'});
      if (!success) return done(429);
    }

    const text = await readCapped(req.body);   // also covers chunked bodies that send no content-length
    if (text === null) return done(413);
    let b;
    try { b = JSON.parse(text); } catch { return done(400); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return done(400);
    const q = typeof b.q === 'string'
      ? b.q.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_Q)
      : '';
    if (!q || typeof b.spread !== 'string' || !SPREADS.has(b.spread)) return done(400);
    await env.DB.prepare('INSERT INTO questions (q, spread, at) VALUES (?, ?, ?)')
      .bind(q, b.spread, new Date().toISOString()).run();
    return done(204);
  }
};
