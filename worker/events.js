// Optional anonymous aggregate counts; never accepts personal data.
const allowed = new Set(['reading_start', 'reading_complete', 'share', 'download', 'interest_deep', 'interest_club']);
const origins = new Set(['https://ivoryrosetarot.online', 'https://www.ivoryrosetarot.online']);
export default { async fetch(req, env) {
  if (req.method !== 'POST') return new Response(null, {status:405});
  if (!origins.has(req.headers.get('origin'))) return new Response(null, {status:403});
  let data; try { data = JSON.parse(await req.text()); } catch { return new Response(null, {status:400}); }
  if (!data || Object.keys(data).length !== 1 || !allowed.has(data.event)) return new Response(null, {status:400});
  const day = new Date().toISOString().slice(0,10);
  await env.DB.prepare('INSERT INTO event_counts (day, event, count) VALUES (?, ?, 1) ON CONFLICT(day, event) DO UPDATE SET count = count + 1').bind(day,data.event).run();
  return new Response(null,{status:204});
}};
