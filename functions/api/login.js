import { verifyPassword, createJWT, buildSessionCookie, isSecureRequest, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { username, password } = body || {};
  if (!username || !password) {
    return json({ error: 'Username and password required' }, 400);
  }

  const user = await env.DB
    .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?')
    .bind(username)
    .first();

  if (!user) return json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: 'Invalid credentials' }, 401);

  const token = await createJWT({ sub: user.id, username: user.username }, env.JWT_SECRET);

  return json(
    { ok: true, user: { id: user.id, username: user.username } },
    200,
    { 'Set-Cookie': buildSessionCookie(token, undefined, isSecureRequest(request)) }
  );
}
