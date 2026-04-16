import { requireAuth, json } from '../_lib/auth.js';

// GET /api/products → public — returns all active products ordered by category & sort_order
// Query ?all=1 for admin to include inactive
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const includeInactive = url.searchParams.get('all') === '1';

  const sql = includeInactive
    ? 'SELECT * FROM products ORDER BY category, sort_order, id'
    : 'SELECT * FROM products WHERE active = 1 ORDER BY category, sort_order, id';

  const { results } = await env.DB.prepare(sql).all();
  return json({ products: results || [] });
}

// POST /api/products → authenticated — create new product
export async function onRequestPost(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { category, title, description, link, image_url, code, sort_order, active } = body || {};
  if (!category || !title) {
    return json({ error: 'category and title required' }, 400);
  }

  const result = await context.env.DB
    .prepare(`INSERT INTO products (category, title, description, link, image_url, code, sort_order, active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      category,
      title,
      description || null,
      link || null,
      image_url || null,
      code || null,
      sort_order ?? 999,
      active === 0 ? 0 : 1
    )
    .run();

  const created = await context.env.DB
    .prepare('SELECT * FROM products WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first();

  return json({ ok: true, product: created }, 201);
}
