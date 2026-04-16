// Cloudflare Worker with Static Assets — serves the site + admin backend
// Routes: /api/* → handled by backend; /media/<key> → R2; else → static assets

// ===========================================================================
// Auth helpers — Web Crypto API (Workers runtime)
// ===========================================================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const b64urlEncode = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlDecode = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64Encode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

async function createJWT(payload, secret, ttl = 60 * 60 * 24 * 14) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttl };
  const h = b64urlEncode(encoder.encode(JSON.stringify(header)));
  const p = b64urlEncode(encoder.encode(JSON.stringify(body)));
  const sig = await hmacSign(secret, `${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

async function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = await hmacSign(secret, `${h}.${p}`);
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(decoder.decode(b64urlDecode(p)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyPassword(password, storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
  const expected = parts[3];
  const km = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, 256
  );
  const actual = b64Encode(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const km = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, 256
  );
  return `pbkdf2$${iterations}$${b64Encode(salt)}$${b64Encode(new Uint8Array(bits))}`;
}

function getSessionCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isSecureRequest(request) {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return true;
  const host = url.hostname;
  return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'));
}

function buildSessionCookie(token, ttl = 60 * 60 * 24 * 14, secure = true) {
  const parts = [
    `session=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${ttl}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(secure = true) {
  return `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

async function requireAuth(request, env) {
  const token = getSessionCookie(request);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  return payload;
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }
  });

// ===========================================================================
// API Route Handlers
// ===========================================================================

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { username, password } = body || {};
  if (!username || !password) return json({ error: 'Username and password required' }, 400);

  const user = await env.DB
    .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?')
    .bind(username).first();
  if (!user) return json({ error: 'Invalid credentials' }, 401);

  if (!await verifyPassword(password, user.password_hash)) {
    return json({ error: 'Invalid credentials' }, 401);
  }
  const token = await createJWT({ sub: user.id, username: user.username }, env.JWT_SECRET);
  return json(
    { ok: true, user: { id: user.id, username: user.username } },
    200,
    { 'Set-Cookie': buildSessionCookie(token, undefined, isSecureRequest(request)) }
  );
}

async function handleLogout(request) {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(isSecureRequest(request)) });
}

async function handleMe(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return json({ user: { id: user.sub, username: user.username } });
}

async function handleChangePassword(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { current, next } = body || {};
  if (!current || !next) return json({ error: 'current and next required' }, 400);
  if (next.length < 6) return json({ error: 'New password must be 6+ chars' }, 400);
  const row = await env.DB
    .prepare('SELECT password_hash FROM admin_users WHERE id = ?').bind(user.sub).first();
  if (!row || !await verifyPassword(current, row.password_hash)) {
    return json({ error: 'Current password incorrect' }, 401);
  }
  const newHash = await hashPassword(next);
  await env.DB
    .prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
    .bind(newHash, user.sub).run();
  return json({ ok: true });
}

async function handleContent(request, env) {
  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT key, value, kind, label, group_name, sort_order FROM content ORDER BY group_name, sort_order')
      .all();
    const map = {};
    for (const row of results || []) map[row.key] = row.value;
    return json({ map, groups: results || [] });
  }
  if (request.method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (!updates.length) return json({ error: 'No updates' }, 400);
    const stmt = env.DB.prepare(
      "UPDATE content SET value = ?, updated_at = datetime('now') WHERE key = ?"
    );
    await env.DB.batch(updates.map(u => stmt.bind(u.value ?? '', u.key)));
    return json({ ok: true, count: updates.length });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function handleContentKey(request, env, key) {
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const result = await env.DB
    .prepare("UPDATE content SET value = ?, updated_at = datetime('now') WHERE key = ?")
    .bind(body?.value ?? '', key).run();
  if (result.meta.changes === 0) return json({ error: 'Not found' }, 404);
  return json({ ok: true, key, value: body?.value });
}

async function handleProducts(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const all = url.searchParams.get('all') === '1';
    const sql = all
      ? 'SELECT * FROM products ORDER BY category, sort_order, id'
      : 'SELECT * FROM products WHERE active = 1 ORDER BY category, sort_order, id';
    const { results } = await env.DB.prepare(sql).all();
    return json({ products: results || [] });
  }
  if (request.method === 'POST') {
    const user = await requireAuth(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const { category, title, description, link, image_url, code, sort_order, active } = body || {};
    if (!category || !title) return json({ error: 'category and title required' }, 400);
    const r = await env.DB.prepare(
      `INSERT INTO products (category, title, description, link, image_url, code, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      category, title, description || null, link || null, image_url || null,
      code || null, sort_order ?? 999, active === 0 ? 0 : 1
    ).run();
    const created = await env.DB
      .prepare('SELECT * FROM products WHERE id = ?').bind(r.meta.last_row_id).first();
    return json({ ok: true, product: created }, 201);
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function handleProductId(request, env, id) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const pid = parseInt(id, 10);
  if (!pid) return json({ error: 'Invalid id' }, 400);

  if (request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const allowed = ['category', 'title', 'description', 'link', 'image_url', 'code', 'sort_order', 'active'];
    const sets = [], values = [];
    for (const f of allowed) {
      if (f in body) { sets.push(`${f} = ?`); values.push(body[f]); }
    }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    sets.push("updated_at = datetime('now')");
    values.push(pid);
    await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
    const updated = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(pid).first();
    return json({ ok: true, product: updated });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(pid).run();
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function handleMedia(request, env) {
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (request.method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT * FROM media ORDER BY uploaded_at DESC').all();
    return json({ media: results || [] });
  }
  if (request.method === 'POST') {
    if (!env.MEDIA) return json({ error: 'R2 not configured' }, 500);
    let formData;
    try { formData = await request.formData(); } catch { return json({ error: 'Invalid form data' }, 400); }
    const file = formData.get('file');
    if (!file || typeof file === 'string') return json({ error: 'file required' }, 400);
    const alt = formData.get('alt') || '';
    const filename = file.name || 'upload.bin';
    const safe = filename.replace(/[^a-z0-9._-]/gi, '_');
    const r2Key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    await env.MEDIA.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });
    const url = `/media/${r2Key}`;
    const r = await env.DB.prepare(
      `INSERT INTO media (r2_key, url, filename, size, mime_type, alt_text)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(r2Key, url, filename, file.size || 0, file.type || '', alt).run();
    const created = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(r.meta.last_row_id).first();
    return json({ ok: true, media: created }, 201);
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function handleMediaId(request, env, id) {
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405);
  const user = await requireAuth(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const mid = parseInt(id, 10);
  if (!mid) return json({ error: 'Invalid id' }, 400);
  const row = await env.DB.prepare('SELECT r2_key FROM media WHERE id = ?').bind(mid).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (env.MEDIA) await env.MEDIA.delete(row.r2_key).catch(() => {});
  await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mid).run();
  return json({ ok: true });
}

async function handleMediaServe(request, env, path) {
  if (!env.MEDIA) return new Response('R2 not configured', { status: 500 });
  if (!path) return new Response('Not found', { status: 404 });
  const object = await env.MEDIA.get(path);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

// ===========================================================================
// Router
// ===========================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // API routes
      if (path === '/api/login') return handleLogin(request, env);
      if (path === '/api/logout') return handleLogout(request);
      if (path === '/api/me') return handleMe(request, env);
      if (path === '/api/change-password') return handleChangePassword(request, env);
      if (path === '/api/content') return handleContent(request, env);
      if (path === '/api/products') return handleProducts(request, env);
      if (path === '/api/media') return handleMedia(request, env);

      // /api/content/:key
      let m = path.match(/^\/api\/content\/(.+)$/);
      if (m) return handleContentKey(request, env, decodeURIComponent(m[1]));

      // /api/products/:id
      m = path.match(/^\/api\/products\/(\d+)$/);
      if (m) return handleProductId(request, env, m[1]);

      // /api/media/:id
      m = path.match(/^\/api\/media\/(\d+)$/);
      if (m) return handleMediaId(request, env, m[1]);

      // /media/* → R2
      if (path.startsWith('/media/')) {
        return handleMediaServe(request, env, path.slice('/media/'.length));
      }

      // /api/* that didn't match
      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

      // Everything else → static assets
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: 'Internal error', detail: err.message }, 500);
    }
  }
};
