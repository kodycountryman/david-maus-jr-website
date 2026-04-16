import { requireAuth, json } from '../../_lib/auth.js';

// PUT /api/products/:id → authenticated — update
export async function onRequestPut(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  const id = parseInt(context.params.id, 10);
  if (!id) return json({ error: 'Invalid id' }, 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Build dynamic update — only set provided fields
  const allowed = ['category', 'title', 'description', 'link', 'image_url', 'code', 'sort_order', 'active'];
  const sets = [];
  const values = [];
  for (const field of allowed) {
    if (field in body) {
      sets.push(`${field} = ?`);
      values.push(body[field]);
    }
  }
  if (!sets.length) return json({ error: 'No fields to update' }, 400);

  sets.push(`updated_at = datetime('now')`);
  values.push(id);

  await context.env.DB
    .prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await context.env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(id)
    .first();

  return json({ ok: true, product: updated });
}

// DELETE /api/products/:id → authenticated
export async function onRequestDelete(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  const id = parseInt(context.params.id, 10);
  if (!id) return json({ error: 'Invalid id' }, 400);

  await context.env.DB
    .prepare('DELETE FROM products WHERE id = ?')
    .bind(id)
    .run();

  return json({ ok: true });
}
