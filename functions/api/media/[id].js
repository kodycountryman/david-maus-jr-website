import { requireAuth, json } from '../../_lib/auth.js';

// DELETE /api/media/:id → removes R2 object + DB row
export async function onRequestDelete(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  const id = parseInt(context.params.id, 10);
  if (!id) return json({ error: 'Invalid id' }, 400);

  const row = await context.env.DB
    .prepare('SELECT r2_key FROM media WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return json({ error: 'Not found' }, 404);

  if (context.env.MEDIA) {
    await context.env.MEDIA.delete(row.r2_key).catch(() => {});
  }
  await context.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();

  return json({ ok: true });
}
