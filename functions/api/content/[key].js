import { requireAuth, json } from '../../_lib/auth.js';

// PUT /api/content/:key → authenticated — update single content value
export async function onRequestPut(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  const key = context.params.key;
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const value = body?.value ?? '';
  const result = await context.env.DB
    .prepare('UPDATE content SET value = ?, updated_at = datetime(\'now\') WHERE key = ?')
    .bind(value, key)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: 'Content key not found' }, 404);
  }

  return json({ ok: true, key, value });
}
