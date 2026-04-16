import { requireAuth, verifyPassword, json } from '../_lib/auth.js';

// POST /api/change-password — authenticated
// Body: { current, next }
export async function onRequestPost(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { current, next } = body || {};
  if (!current || !next) return json({ error: 'current and next required' }, 400);
  if (next.length < 6) return json({ error: 'New password must be 6+ chars' }, 400);

  const user = await context.env.DB
    .prepare('SELECT password_hash FROM admin_users WHERE id = ?')
    .bind(auth.user.sub)
    .first();
  if (!user) return json({ error: 'User not found' }, 404);

  const valid = await verifyPassword(current, user.password_hash);
  if (!valid) return json({ error: 'Current password incorrect' }, 401);

  // Hash new password: PBKDF2 SHA-256, 100k iterations, 16-byte salt
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(next), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const b64 = (buf) => {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };
  const hashStr = `pbkdf2$${iterations}$${b64(salt)}$${b64(bits)}`;

  await context.env.DB
    .prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
    .bind(hashStr, auth.user.sub)
    .run();

  return json({ ok: true });
}
