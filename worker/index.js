// Cloudflare Worker: stores the question text (no IP, no user agent) in D1.
const SPREADS = new Set(['single', 'three', 'relationship-five', 'celtic-cross']);
const ORIGINS = new Set(['https://ivoryrosetarot.online', 'https://www.ivoryrosetarot.online']);
const done = status => new Response(null, {status});

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return done(405);
    if (!ORIGINS.has(req.headers.get('origin'))) return done(403);
    let b;
    try { b = JSON.parse(await req.text()); } catch { return done(400); }
    const q = typeof b?.q === 'string' ? b.q.trim().slice(0, 300) : '';
    if (!q || !SPREADS.has(b.spread)) return done(400);
    await env.DB.prepare('INSERT INTO questions (q, spread, at) VALUES (?, ?, ?)')
      .bind(q, b.spread, new Date().toISOString()).run();
    return done(204);
  }
};
