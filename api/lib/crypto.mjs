// WebCrypto helpers (work in Workers and Node 22).
const enc = new TextEncoder();

export const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(text) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

export async function hmac(secret, data) {   // HMAC-SHA256 -> bytes; `data` may be a string or bytes
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// 600,000 SHA-256 rounds is the OWASP recommendation. Checked in local workerd (wrangler dev), which accepts it in about 0.1 s.
// Older Workers runtimes refused PBKDF2 counts above 100,000, so if the platform ever rejects the high count we settle at the
// fallback (and remember it) instead of failing every sign-up and login. The count is stored in each hash, so hashes made
// either way keep verifying and are upgraded at the next sign-in once the platform allows it.
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_FALLBACK = 100_000;
let ceiling = Infinity;   // lowered at run time if the platform refuses a high count
export const resetCeiling = () => { ceiling = Infinity; };   // test hook: forget what was learned

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, key, 256));
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const n = Math.min(iterations, ceiling);
  try {
    return `pbkdf2-sha256$${n}$${b64u(salt)}$${b64u(await derive(password, salt, n))}`;
  } catch (e) {
    if (n <= PBKDF2_FALLBACK) throw e;
    ceiling = PBKDF2_FALLBACK;   // the platform refused the high count: use the fallback from now on
    console.warn('PBKDF2 count refused, using fallback', {wanted: n, name: e?.name});
    return hashPassword(password, PBKDF2_FALLBACK);
  }
}

// Returns {ok, needsRehash}; a malformed stored value never verifies.
export async function verifyPassword(password, stored, wantIterations = PBKDF2_ITERATIONS) {
  const [alg, it, salt, hash] = String(stored).split('$');
  const iterations = Number(it);
  if (alg !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000 || !salt || !hash) return {ok: false, needsRehash: false};
  const got = await derive(password, fromB64u(salt), iterations);
  return {ok: timingSafeEqual(got, fromB64u(hash)), needsRehash: iterations < Math.min(wantIterations, ceiling)};   // not endlessly re-hashed while the platform refuses the high count
}
