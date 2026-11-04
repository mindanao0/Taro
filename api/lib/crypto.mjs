// WebCrypto helpers (work in Workers and Node 22).
const enc = new TextEncoder();

export const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// Default is the highest iteration count Workers' WebCrypto is documented to accept for PBKDF2 (verify with `wrangler dev`).
// The count is stored in each hash, so it can be raised later (or the algorithm swapped) and old hashes upgraded at login.
export const PBKDF2_ITERATIONS = 100_000;

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, key, 256));
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64u(salt)}$${b64u(await derive(password, salt, iterations))}`;
}

// Returns {ok, needsRehash}; a malformed stored value never verifies.
export async function verifyPassword(password, stored, wantIterations = PBKDF2_ITERATIONS) {
  const [alg, it, salt, hash] = String(stored).split('$');
  const iterations = Number(it);
  if (alg !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000 || !salt || !hash) return {ok: false, needsRehash: false};
  const got = await derive(password, fromB64u(salt), iterations);
  return {ok: timingSafeEqual(got, fromB64u(hash)), needsRehash: iterations < wantIterations};
}
