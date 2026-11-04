export const DEFAULT_ORIGINS = ['https://ivoryrosetarot.online', 'https://www.ivoryrosetarot.online'];
export const originsOf = env => new Set(env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS);

export const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: {'cache-control': 'no-store', ...(body === undefined ? {} : {'content-type': 'application/json'}), ...headers}
});

// Reads a small JSON object body; returns null if missing, too large, malformed, or not an object.
export async function readJson(req, max = 8192) {
  if (Number(req.headers.get('content-length')) > max) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const parts = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  try {
    const b = JSON.parse(new TextDecoder().decode(all));
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch { return null; }
}

export const SESSION_COOKIE = '__Host-taro_session';   // host-only on the API host: Secure, Path=/, no Domain attribute

export function readCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
export const sessionCookie = (token, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
export const clearedCookie = () => sessionCookie('', 0);
