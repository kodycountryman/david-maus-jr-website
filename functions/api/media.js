import { requireAuth, json } from '../_lib/auth.js';

// GET /api/media → list all media (authenticated — admin only)
export async function onRequestGet(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  const { results } = await context.env.DB
    .prepare('SELECT * FROM media ORDER BY uploaded_at DESC')
    .all();
  return json({ media: results || [] });
}

// POST /api/media → upload new file (multipart form-data)
// field: file (required), alt (optional)
export async function onRequestPost(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;

  const { env, request } = context;
  if (!env.MEDIA) {
    return json({ error: 'R2 binding not configured' }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Invalid form data' }, 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'file field required' }, 400);
  }

  const alt = formData.get('alt') || '';
  const filename = file.name || 'upload.bin';
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'bin';
  const safeName = filename.replace(/[^a-z0-9._-]/gi, '_');
  const r2Key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  // Upload to R2
  await env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' }
  });

  // Public URL (served through Pages via /media/[...path].js)
  const url = `/media/${r2Key}`;

  const result = await env.DB
    .prepare(`INSERT INTO media (r2_key, url, filename, size, mime_type, alt_text)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(r2Key, url, filename, file.size || 0, file.type || '', alt)
    .run();

  const created = await env.DB
    .prepare('SELECT * FROM media WHERE id = ?')
    .bind(result.meta.last_row_id)
    .first();

  return json({ ok: true, media: created }, 201);
}
