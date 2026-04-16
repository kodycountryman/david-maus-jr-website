import { requireAuth, json } from '../_lib/auth.js';

// GET /api/content → public — returns all content keyed by `key`
// Grouped output for easier admin UI consumption
export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare('SELECT key, value, kind, label, group_name, sort_order FROM content ORDER BY group_name, sort_order')
    .all();

  const map = {};
  const groups = {};
  for (const row of results || []) {
    map[row.key] = row.value;
    if (!groups[row.group_name]) groups[row.group_name] = [];
    groups[row.group_name].push(row);
  }

  return json({ map, groups });
}

// POST /api/content → authenticated — batch update multiple keys
// Body: { updates: [{ key, value }, ...] }
export async function onRequestPost(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (!updates.length) return json({ error: 'No updates provided' }, 400);

  const stmt = context.env.DB.prepare(
    'UPDATE content SET value = ?, updated_at = datetime(\'now\') WHERE key = ?'
  );
  const batch = updates.map(u => stmt.bind(u.value ?? '', u.key));
  await context.env.DB.batch(batch);

  return json({ ok: true, count: updates.length });
}
