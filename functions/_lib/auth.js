// Shared auth helpers — JWT signing/verification + password hashing
// Uses Web Crypto API (available in Workers/Pages Functions runtime)

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

export async function createJWT(payload, secret, expiresInSec = 60 * 60 * 24 * 14) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const h = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const p = base64UrlEncode(encoder.encode(JSON.stringify(body)));
  const sig = await hmacSign(secret, `${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

export async function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = await hmacSign(secret, `${h}.${p}`);
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(p)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Password hashing: format `pbkdf2$<iterations>$<saltBase64>$<hashBase64>`
export async function verifyPassword(password, storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
  const expected = parts[3];

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const actual = base64Encode(new Uint8Array(bits));
  // Constant-time-ish comparison
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function base64Encode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

// Read the "session" cookie out of the incoming request
export function getSessionCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildSessionCookie(token, maxAgeSec = 60 * 60 * 24 * 14, isSecure = true) {
  const attrs = [
    `session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  if (isSecure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(isSecure = true) {
  const base = 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  return isSecure ? `${base}; Secure` : base;
}

// Detect whether this request is over HTTPS (so we know whether to set Secure)
export function isSecureRequest(request) {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return true;
  // Workers runtime — hostname of localhost = allow plain cookies for dev
  const host = url.hostname;
  return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'));
}

// Helper: require auth, return user or send 401 response
export async function requireAuth(context) {
  const token = getSessionCookie(context.request);
  const payload = await verifyJWT(token, context.env.JWT_SECRET);
  if (!payload) {
    return { unauthorized: true, response: json({ error: 'Unauthorized' }, 401) };
  }
  return { unauthorized: false, user: payload };
}

// Handy JSON response helper
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}
