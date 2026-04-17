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
// Analytics: helpers
// ===========================================================================

// Classify a referrer URL + UTM params into a fixed set of source labels
function parseSource(referrerRaw, utmSource) {
  if (utmSource) {
    const u = utmSource.toLowerCase().trim();
    // Normalize common aliases
    if (u === 'ig' || u === 'insta') return 'instagram';
    if (u === 'yt') return 'youtube';
    if (u === 'tt') return 'tiktok';
    if (u === 'x' || u === 'twitter.com') return 'twitter';
    if (u === 'fb' || u === 'meta') return 'facebook';
    return u.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'other';
  }
  if (!referrerRaw) return 'direct';
  let host;
  try { host = new URL(referrerRaw).hostname.toLowerCase(); }
  catch { return 'other'; }
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('twitter.com') || host === 'x.com' || host.endsWith('.x.com')) return 'twitter';
  if (host.includes('facebook.com') || host.includes('fb.com')) return 'facebook';
  if (host.includes('google.')) return 'google';
  if (host.includes('bing.com')) return 'bing';
  if (host.includes('duckduckgo.com')) return 'duckduckgo';
  if (host.includes('beehiiv.com')) return 'beehiiv';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('pinterest.com')) return 'pinterest';
  return 'other';
}

function parseDevice(ua) {
  if (!ua) return 'desktop';
  if (/bot|crawl|spider|slurp|curl|wget|python-requests|preview/i.test(ua)) return 'bot';
  if (/iPad|Tablet|PlayBook|Kindle|Silk|Nexus 7|Nexus 10|SM-T/i.test(ua)) return 'tablet';
  if (/Android.*Mobile|Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  if (/Android/i.test(ua)) return 'tablet';
  return 'desktop';
}

// Maps range param → SQLite datetime filter + strftime bucket format
// Returns { since, bucketFmt, bucketFill } where bucketFill is the JS fn that
// generates expected bucket labels so empty buckets render as zero.
function rangeToSql(range) {
  switch (range) {
    case 'day':
      return {
        since: "datetime('now','-24 hours')",
        bucketFmt: "strftime('%Y-%m-%dT%H:00', created_at)",
        buckets: 24,
        bucketUnit: 'hour',
      };
    case 'week':
      return {
        since: "datetime('now','-7 days')",
        bucketFmt: "strftime('%Y-%m-%d', created_at)",
        buckets: 7,
        bucketUnit: 'day',
      };
    case 'year':
      return {
        since: "datetime('now','-365 days')",
        bucketFmt: "strftime('%Y-%m', created_at)",
        buckets: 12,
        bucketUnit: 'month',
      };
    case 'month':
    default:
      return {
        since: "datetime('now','-30 days')",
        bucketFmt: "strftime('%Y-%m-%d', created_at)",
        buckets: 30,
        bucketUnit: 'day',
      };
  }
}

// Previous period for delta comparison (uses same span, shifted back)
function rangeToPrevSql(range) {
  switch (range) {
    case 'day':
      return {
        since: "datetime('now','-48 hours')",
        until: "datetime('now','-24 hours')",
      };
    case 'week':
      return {
        since: "datetime('now','-14 days')",
        until: "datetime('now','-7 days')",
      };
    case 'year':
      return {
        since: "datetime('now','-730 days')",
        until: "datetime('now','-365 days')",
      };
    case 'month':
    default:
      return {
        since: "datetime('now','-60 days')",
        until: "datetime('now','-30 days')",
      };
  }
}

// Zero-fill a sparse series keyed by bucket label
function fillBuckets(rows, range) {
  const { buckets, bucketUnit } = rangeToSql(range);
  const map = new Map();
  for (const r of rows) map.set(r.bucket, r.count);
  const out = [];
  const now = new Date();
  for (let i = buckets - 1; i >= 0; i--) {
    const d = new Date(now);
    let label;
    if (bucketUnit === 'hour') {
      d.setHours(d.getHours() - i, 0, 0, 0);
      label = d.toISOString().slice(0, 13) + ':00';
    } else if (bucketUnit === 'day') {
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      label = d.toISOString().slice(0, 10);
    } else {
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      label = d.toISOString().slice(0, 7);
    }
    out.push({ bucket: label, count: Number(map.get(label) || 0) });
  }
  return out;
}

// ===========================================================================
// Analytics: public tracking POSTs (no auth, use ctx.waitUntil to not block)
// ===========================================================================

async function handleTrackPageview(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const { path, referrer, session_id, visitor_id } = body || {};
  if (!path || !session_id) return json({ ok: false }, 400);
  // Don't track admin
  if (typeof path === 'string' && path.startsWith('/admin')) return json({ ok: true, skipped: 'admin' });

  const ua = request.headers.get('User-Agent') || '';
  const device = parseDevice(ua);
  // Don't persist bots
  if (device === 'bot') return json({ ok: true, skipped: 'bot' });

  // Pull UTM if present in the tracked URL
  let utmSource = null;
  try {
    const parsed = new URL(path, 'https://x.invalid');
    utmSource = parsed.searchParams.get('utm_source');
  } catch {}
  const source = parseSource(referrer, utmSource);
  const country = request.headers.get('CF-IPCountry') || null;
  const cleanPath = typeof path === 'string'
    ? path.split('?')[0].slice(0, 255)
    : '/';
  const refFull = typeof referrer === 'string' ? referrer.slice(0, 512) : null;
  const sid = String(session_id).slice(0, 64);
  const vid = visitor_id ? String(visitor_id).slice(0, 64) : null;

  const writePromise = env.DB
    .prepare(`INSERT INTO pageviews (path, referrer_source, referrer_full, device, country, session_id, visitor_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(cleanPath, source, refFull, device, country, sid, vid)
    .run()
    .catch(() => {});

  if (ctx && ctx.waitUntil) ctx.waitUntil(writePromise);
  return json({ ok: true });
}

async function handleTrackClick(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const { product_id, referrer, session_id, visitor_id } = body || {};
  const pid = parseInt(product_id, 10);
  if (!pid || !session_id) return json({ ok: false }, 400);

  const ua = request.headers.get('User-Agent') || '';
  const device = parseDevice(ua);
  if (device === 'bot') return json({ ok: true, skipped: 'bot' });

  const source = parseSource(referrer, null);
  const country = request.headers.get('CF-IPCountry') || null;
  const sid = String(session_id).slice(0, 64);
  const vid = visitor_id ? String(visitor_id).slice(0, 64) : null;

  const writePromise = env.DB
    .prepare(`INSERT INTO product_clicks (product_id, referrer_source, device, country, session_id, visitor_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(pid, source, device, country, sid, vid)
    .run()
    .catch(() => {});

  if (ctx && ctx.waitUntil) ctx.waitUntil(writePromise);
  return json({ ok: true });
}

// ===========================================================================
// Analytics: authenticated reads
// ===========================================================================

async function handleAnalyticsOverview(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const prev = rangeToPrevSql(range);

  // Conversion rate: of sessions that viewed /product-picks.html in this range,
  // what % also had at least one product click (anytime)?
  const conversionSql = `
    SELECT
      COUNT(DISTINCT pv.session_id) AS picks_sessions,
      COUNT(DISTINCT CASE WHEN pc.session_id IS NOT NULL THEN pv.session_id END) AS converted
    FROM pageviews pv
    LEFT JOIN product_clicks pc ON pc.session_id = pv.session_id
    WHERE pv.path = '/product-picks.html'
      AND pv.device != 'bot'
      AND pv.created_at >= ${since}
  `;

  // New vs returning: a visitor counts as "new" if their earliest pageview
  // anywhere in DB falls inside this range; else "returning".
  const newReturningSql = `
    WITH vids AS (
      SELECT DISTINCT visitor_id
      FROM pageviews
      WHERE device != 'bot' AND created_at >= ${since} AND visitor_id IS NOT NULL
    ),
    firsts AS (
      SELECT visitor_id, MIN(created_at) AS first_seen
      FROM pageviews
      WHERE visitor_id IN (SELECT visitor_id FROM vids)
      GROUP BY visitor_id
    )
    SELECT
      SUM(CASE WHEN first_seen >= ${since} THEN 1 ELSE 0 END) AS new_visitors,
      SUM(CASE WHEN first_seen < ${since} THEN 1 ELSE 0 END) AS returning_visitors
    FROM firsts
  `;

  const [pv, uv, pvPrev, clicks, clicksPrev, active, conv, nr] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) c FROM pageviews WHERE device != 'bot' AND created_at >= ${since}`).first(),
    env.DB.prepare(`SELECT COUNT(DISTINCT session_id) c FROM pageviews WHERE device != 'bot' AND created_at >= ${since}`).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM pageviews WHERE device != 'bot' AND created_at >= ${prev.since} AND created_at < ${prev.until}`).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM product_clicks WHERE device != 'bot' AND created_at >= ${since}`).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM product_clicks WHERE device != 'bot' AND created_at >= ${prev.since} AND created_at < ${prev.until}`).first(),
    env.DB.prepare(`SELECT COUNT(DISTINCT session_id) c FROM pageviews WHERE device != 'bot' AND created_at > datetime('now','-5 minutes')`).first(),
    env.DB.prepare(conversionSql).first(),
    env.DB.prepare(newReturningSql).first(),
  ]);

  const pct = (curr, prev) => {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const picksSessions = conv?.picks_sessions || 0;
  const converted = conv?.converted || 0;
  const conversionRate = picksSessions > 0
    ? Math.round((converted / picksSessions) * 1000) / 10
    : 0;

  return json({
    pageviews: pv?.c || 0,
    uniqueVisitors: uv?.c || 0,
    clicks: clicks?.c || 0,
    activeNow: active?.c || 0,
    deltaPageviewsPct: pct(pv?.c || 0, pvPrev?.c || 0),
    deltaClicksPct: pct(clicks?.c || 0, clicksPrev?.c || 0),
    ctr: (pv?.c || 0) > 0 ? Math.round(((clicks?.c || 0) / (pv?.c || 0)) * 1000) / 10 : 0,
    conversionRate,
    picksVisitors: picksSessions,
    picksConverted: converted,
    newVisitors: nr?.new_visitors || 0,
    returningVisitors: nr?.returning_visitors || 0,
  });
}

async function handleAnalyticsTimeseries(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const metric = url.searchParams.get('metric') === 'clicks' ? 'clicks' : 'pageviews';
  const { since, bucketFmt } = rangeToSql(range);

  const table = metric === 'clicks' ? 'product_clicks' : 'pageviews';
  const q = `
    SELECT ${bucketFmt} AS bucket, COUNT(*) AS count
    FROM ${table}
    WHERE device != 'bot' AND created_at >= ${since}
    GROUP BY bucket
    ORDER BY bucket
  `;
  const { results } = await env.DB.prepare(q).all();
  return json({ series: fillBuckets(results || [], range), range, metric });
}

async function handleAnalyticsSources(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const q = `
    SELECT referrer_source AS source,
           COUNT(*) AS views,
           COUNT(DISTINCT session_id) AS uniqueVisitors
    FROM pageviews
    WHERE device != 'bot' AND created_at >= ${since}
    GROUP BY referrer_source
    ORDER BY views DESC
    LIMIT 12
  `;
  const { results } = await env.DB.prepare(q).all();
  return json({ sources: results || [] });
}

async function handleAnalyticsPages(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const q = `
    SELECT path, COUNT(*) AS views, COUNT(DISTINCT session_id) AS uniqueVisitors
    FROM pageviews
    WHERE device != 'bot' AND created_at >= ${since}
    GROUP BY path
    ORDER BY views DESC
    LIMIT 10
  `;
  const { results } = await env.DB.prepare(q).all();
  return json({ pages: results || [] });
}

async function handleAnalyticsProducts(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const q = `
    SELECT p.id AS product_id,
           p.title AS title,
           p.category AS category,
           p.code AS code,
           COALESCE(period.c, 0) AS clicks,
           COALESCE(total.c, 0) AS allTimeClicks,
           top_src.src AS top_source
    FROM products p
    LEFT JOIN (
      SELECT product_id, COUNT(*) AS c
      FROM product_clicks
      WHERE device != 'bot' AND created_at >= ${since}
      GROUP BY product_id
    ) period ON period.product_id = p.id
    LEFT JOIN (
      SELECT product_id, COUNT(*) AS c
      FROM product_clicks
      WHERE device != 'bot'
      GROUP BY product_id
    ) total ON total.product_id = p.id
    LEFT JOIN (
      -- Top referrer source per product in range
      SELECT product_id, referrer_source AS src
      FROM (
        SELECT product_id, referrer_source, COUNT(*) AS c,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY COUNT(*) DESC) AS rn
        FROM product_clicks
        WHERE device != 'bot' AND created_at >= ${since}
        GROUP BY product_id, referrer_source
      )
      WHERE rn = 1
    ) top_src ON top_src.product_id = p.id
    ORDER BY clicks DESC, allTimeClicks DESC
  `;
  const { results } = await env.DB.prepare(q).all();
  return json({ products: results || [] });
}

async function handleAnalyticsLive(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10), 100);
  // Union of recent pageviews + product clicks, ordered by time
  const q = `
    SELECT 'pageview' AS type, created_at,
           path AS detail, NULL AS product_id, NULL AS product_title,
           referrer_source, referrer_full, device, country, session_id
    FROM pageviews
    WHERE device != 'bot'
    UNION ALL
    SELECT 'click' AS type, pc.created_at,
           p.title AS detail, pc.product_id AS product_id, p.title AS product_title,
           pc.referrer_source, NULL AS referrer_full, pc.device, pc.country, pc.session_id
    FROM product_clicks pc
    LEFT JOIN products p ON p.id = pc.product_id
    WHERE pc.device != 'bot'
    ORDER BY created_at DESC
    LIMIT ?
  `;
  const { results } = await env.DB.prepare(q).bind(limit).all();
  return json({ events: results || [] });
}

async function handleAnalyticsReferrers(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const q = `
    SELECT referrer_full AS url,
           referrer_source AS source,
           COUNT(*) AS views,
           COUNT(DISTINCT session_id) AS uniqueVisitors
    FROM pageviews
    WHERE device != 'bot'
      AND created_at >= ${since}
      AND referrer_full IS NOT NULL
      AND referrer_full != ''
      AND referrer_full NOT LIKE '%dmjr.countrymankody14.workers.dev%'
      AND referrer_full NOT LIKE '%davidmausjr.com%'
    GROUP BY referrer_full
    ORDER BY views DESC
    LIMIT 15
  `;
  const { results } = await env.DB.prepare(q).all();
  return json({ referrers: results || [] });
}

// ===========================================================================
// YouTube stats (public, cached 1hr in D1)
// ===========================================================================

const YT_CHANNEL_ID = 'UCasr6iZBDikSQcmOcI7YZ3g'; // DMJR main health & wellness channel
const YT_CACHE_KEY  = 'yt_stats_cache';
const YT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Formatting: 2.4M, 137K, 842
function formatBigNumber(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return (m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (v >= 1_000) {
    const k = v / 1_000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(v);
}

async function fetchYouTubeStats(env) {
  if (!env.YT_API_KEY) {
    return { ok: false, error: 'YT_API_KEY not configured' };
  }
  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${YT_CHANNEL_ID}&key=${env.YT_API_KEY}`;
  const res = await fetch(url, { cf: { cacheEverything: false } });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `YouTube API ${res.status}: ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  const channel = data.items && data.items[0];
  if (!channel) return { ok: false, error: 'Channel not found' };
  const s = channel.statistics || {};
  return {
    ok: true,
    fetchedAt: Date.now(),
    channelTitle: channel.snippet?.title || 'DavidMausJr',
    subscriberCount:  parseInt(s.subscriberCount  || '0', 10),
    viewCount:        parseInt(s.viewCount        || '0', 10),
    videoCount:       parseInt(s.videoCount       || '0', 10),
    subscribersDisplay: formatBigNumber(parseInt(s.subscriberCount || '0', 10)),
    viewsDisplay:       formatBigNumber(parseInt(s.viewCount       || '0', 10)),
  };
}

async function handleYouTubeStats(request, env, ctx) {
  // 1. Check D1 cache
  const row = await env.DB
    .prepare(`SELECT value FROM content WHERE key = ?`)
    .bind(YT_CACHE_KEY)
    .first()
    .catch(() => null);

  let cached = null;
  if (row && row.value) {
    try { cached = JSON.parse(row.value); } catch {}
  }

  const fresh = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < YT_CACHE_TTL_MS;
  if (fresh) {
    return json({ ...cached, cached: true });
  }

  // 2. Fetch live
  const live = await fetchYouTubeStats(env);

  // 3. If live fetch failed, serve stale cache if we have it
  if (!live.ok) {
    if (cached) return json({ ...cached, stale: true, error: live.error });
    return json({ ok: false, error: live.error }, 503);
  }

  // 4. Persist new cache (upsert). Don't block response.
  const upsert = env.DB.prepare(
    `INSERT INTO content (key, value, kind, label, group_name)
     VALUES (?, ?, 'text', 'YouTube Stats Cache', 'system')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(YT_CACHE_KEY, JSON.stringify(live)).run().catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(upsert); else await upsert;

  return json({ ...live, cached: false });
}

// ===========================================================================
// CSV Export
// ===========================================================================

const csvEscape = (v) => {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

const csvRow = (arr) => arr.map(csvEscape).join(',');

const SOURCE_LABEL_MAP = {
  youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok',
  twitter: 'Twitter / X', facebook: 'Facebook', beehiiv: 'Newsletter',
  google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo',
  reddit: 'Reddit', linkedin: 'LinkedIn', pinterest: 'Pinterest',
  direct: 'Direct', other: 'Other',
};

const PAGE_LABEL_MAP = {
  '/': 'Home', '/index.html': 'Home',
  '/about.html': 'About', '/brand-deals.html': 'Brand Partnerships',
  '/product-picks.html': 'Product Picks', '/newsletter.html': 'Newsletter',
  '/contact.html': 'Contact',
};

const CAT_LABEL_MAP = {
  'diy-kits': 'DIY Kits', 'cold-plunge': 'Cold Plunge', 'saunas': 'Saunas',
  'performance': 'Performance', 'health': 'Health Optimization',
  'gear': 'Gear & Wearables', 'supps': 'Supps & Snacks', 'pets': 'Pets'
};

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

async function handleAnalyticsExport(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const include = (url.searchParams.get('include') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!include.length) return json({ error: 'No sections selected' }, 400);
  const { since } = rangeToSql(range);

  const lines = [];
  lines.push(csvRow(['DMJ Site Analytics Export']));
  lines.push(csvRow(['Range', range]));
  lines.push(csvRow(['Generated', new Date().toISOString()]));
  lines.push(csvRow(['Sections', include.join(', ')]));
  lines.push('');

  // --- Overview ---
  if (include.includes('overview')) {
    const prev = rangeToPrevSql(range);
    const [pv, uv, pvPrev, clicks, clicksPrev, active, conv, nr] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) c FROM pageviews WHERE device != 'bot' AND created_at >= ${since}`).first(),
      env.DB.prepare(`SELECT COUNT(DISTINCT session_id) c FROM pageviews WHERE device != 'bot' AND created_at >= ${since}`).first(),
      env.DB.prepare(`SELECT COUNT(*) c FROM pageviews WHERE device != 'bot' AND created_at >= ${prev.since} AND created_at < ${prev.until}`).first(),
      env.DB.prepare(`SELECT COUNT(*) c FROM product_clicks WHERE device != 'bot' AND created_at >= ${since}`).first(),
      env.DB.prepare(`SELECT COUNT(*) c FROM product_clicks WHERE device != 'bot' AND created_at >= ${prev.since} AND created_at < ${prev.until}`).first(),
      env.DB.prepare(`SELECT COUNT(DISTINCT session_id) c FROM pageviews WHERE device != 'bot' AND created_at > datetime('now','-5 minutes')`).first(),
      env.DB.prepare(`
        SELECT COUNT(DISTINCT pv.session_id) picks,
               COUNT(DISTINCT CASE WHEN pc.session_id IS NOT NULL THEN pv.session_id END) conv
        FROM pageviews pv
        LEFT JOIN product_clicks pc ON pc.session_id = pv.session_id
        WHERE pv.path = '/product-picks.html' AND pv.device != 'bot' AND pv.created_at >= ${since}
      `).first(),
      env.DB.prepare(`
        WITH firsts AS (
          SELECT visitor_id, MIN(created_at) fs FROM pageviews
          WHERE visitor_id IS NOT NULL AND device != 'bot'
            AND visitor_id IN (SELECT DISTINCT visitor_id FROM pageviews WHERE device != 'bot' AND created_at >= ${since} AND visitor_id IS NOT NULL)
          GROUP BY visitor_id
        )
        SELECT SUM(CASE WHEN fs >= ${since} THEN 1 ELSE 0 END) new_v,
               SUM(CASE WHEN fs < ${since} THEN 1 ELSE 0 END) ret_v
        FROM firsts
      `).first(),
    ]);
    const ctr = (pv?.c || 0) > 0 ? ((clicks?.c || 0) / pv.c * 100).toFixed(1) : '0.0';
    const convRate = (conv?.picks || 0) > 0 ? ((conv.conv || 0) / conv.picks * 100).toFixed(1) : '0.0';
    const delta = (c, p) => p ? (((c - p) / p) * 100).toFixed(0) + '%' : (c > 0 ? '+100%' : '0%');

    lines.push(csvRow(['## OVERVIEW']));
    lines.push(csvRow(['Metric', 'Value', 'Delta vs previous period']));
    lines.push(csvRow(['Pageviews', pv?.c || 0, delta(pv?.c || 0, pvPrev?.c || 0)]));
    lines.push(csvRow(['Unique Visitors', uv?.c || 0, '']));
    lines.push(csvRow(['Product Clicks', clicks?.c || 0, delta(clicks?.c || 0, clicksPrev?.c || 0)]));
    lines.push(csvRow(['Click-Through Rate', ctr + '%', '']));
    lines.push(csvRow(['Active Now (last 5 min)', active?.c || 0, '']));
    lines.push(csvRow(['New Visitors', nr?.new_v || 0, '']));
    lines.push(csvRow(['Returning Visitors', nr?.ret_v || 0, '']));
    lines.push(csvRow(['Product-Picks Visitors', conv?.picks || 0, '']));
    lines.push(csvRow(['Product-Picks Conversions', conv?.conv || 0, '']));
    lines.push(csvRow(['Product-Picks Conversion Rate', convRate + '%', '']));
    lines.push('');
  }

  // --- Timeseries ---
  if (include.includes('timeseries')) {
    const { bucketFmt } = rangeToSql(range);
    const [pvRes, clRes] = await Promise.all([
      env.DB.prepare(`SELECT ${bucketFmt} bucket, COUNT(*) c FROM pageviews WHERE device != 'bot' AND created_at >= ${since} GROUP BY bucket ORDER BY bucket`).all(),
      env.DB.prepare(`SELECT ${bucketFmt} bucket, COUNT(*) c FROM product_clicks WHERE device != 'bot' AND created_at >= ${since} GROUP BY bucket ORDER BY bucket`).all(),
    ]);
    const pvMap = new Map((pvRes.results || []).map(r => [r.bucket, r.c]));
    const clMap = new Map((clRes.results || []).map(r => [r.bucket, r.c]));
    const allBuckets = [...new Set([...pvMap.keys(), ...clMap.keys()])].sort();
    lines.push(csvRow(['## PAGEVIEWS OVER TIME']));
    lines.push(csvRow(['Bucket', 'Pageviews', 'Product Clicks']));
    for (const b of allBuckets) {
      lines.push(csvRow([b, pvMap.get(b) || 0, clMap.get(b) || 0]));
    }
    lines.push('');
  }

  // --- Traffic Sources ---
  if (include.includes('sources')) {
    const { results } = await env.DB.prepare(`
      SELECT referrer_source src, COUNT(*) views, COUNT(DISTINCT session_id) uniq
      FROM pageviews WHERE device != 'bot' AND created_at >= ${since}
      GROUP BY referrer_source ORDER BY views DESC
    `).all();
    const total = (results || []).reduce((a, b) => a + b.views, 0);
    lines.push(csvRow(['## TRAFFIC SOURCES']));
    lines.push(csvRow(['Source', 'Views', 'Unique Visitors', 'Percent']));
    for (const r of results || []) {
      const pct = total ? ((r.views / total) * 100).toFixed(1) + '%' : '0%';
      lines.push(csvRow([SOURCE_LABEL_MAP[r.src] || r.src, r.views, r.uniq, pct]));
    }
    lines.push('');
  }

  // --- Top Pages ---
  if (include.includes('pages')) {
    const { results } = await env.DB.prepare(`
      SELECT path, COUNT(*) views, COUNT(DISTINCT session_id) uniq
      FROM pageviews WHERE device != 'bot' AND created_at >= ${since}
      GROUP BY path ORDER BY views DESC LIMIT 50
    `).all();
    lines.push(csvRow(['## TOP PAGES']));
    lines.push(csvRow(['Page', 'Path', 'Views', 'Unique Visitors']));
    for (const r of results || []) {
      lines.push(csvRow([PAGE_LABEL_MAP[r.path] || r.path, r.path, r.views, r.uniq]));
    }
    lines.push('');
  }

  // --- Countries ---
  if (include.includes('countries')) {
    const { results } = await env.DB.prepare(`
      SELECT COALESCE(country, 'Unknown') country, COUNT(*) views
      FROM pageviews WHERE device != 'bot' AND created_at >= ${since}
      GROUP BY country ORDER BY views DESC LIMIT 50
    `).all();
    const total = (results || []).reduce((a, b) => a + b.views, 0);
    lines.push(csvRow(['## TOP COUNTRIES']));
    lines.push(csvRow(['Country Code', 'Views', 'Percent']));
    for (const r of results || []) {
      const pct = total ? ((r.views / total) * 100).toFixed(1) + '%' : '0%';
      lines.push(csvRow([r.country, r.views, pct]));
    }
    lines.push('');
  }

  // --- Devices ---
  if (include.includes('devices')) {
    const { results } = await env.DB.prepare(`
      SELECT device, COUNT(*) views FROM pageviews
      WHERE device != 'bot' AND created_at >= ${since}
      GROUP BY device
    `).all();
    const total = (results || []).reduce((a, b) => a + b.views, 0);
    lines.push(csvRow(['## DEVICE BREAKDOWN']));
    lines.push(csvRow(['Device', 'Views', 'Percent']));
    for (const r of results || []) {
      const pct = total ? ((r.views / total) * 100).toFixed(1) + '%' : '0%';
      lines.push(csvRow([r.device, r.views, pct]));
    }
    lines.push('');
  }

  // --- Products ---
  if (include.includes('products')) {
    const { results } = await env.DB.prepare(`
      SELECT p.id, p.title, p.category, p.code,
             COALESCE(period.c, 0) period_clicks,
             COALESCE(total.c, 0) all_time_clicks,
             top_src.src top_source
      FROM products p
      LEFT JOIN (SELECT product_id, COUNT(*) c FROM product_clicks WHERE device != 'bot' AND created_at >= ${since} GROUP BY product_id) period ON period.product_id = p.id
      LEFT JOIN (SELECT product_id, COUNT(*) c FROM product_clicks WHERE device != 'bot' GROUP BY product_id) total ON total.product_id = p.id
      LEFT JOIN (
        SELECT product_id, referrer_source src FROM (
          SELECT product_id, referrer_source, COUNT(*) c,
            ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY COUNT(*) DESC) rn
          FROM product_clicks WHERE device != 'bot' AND created_at >= ${since}
          GROUP BY product_id, referrer_source
        ) WHERE rn = 1
      ) top_src ON top_src.product_id = p.id
      ORDER BY period_clicks DESC, all_time_clicks DESC
    `).all();
    lines.push(csvRow(['## PRODUCT CLICKS']));
    lines.push(csvRow(['Title', 'Category', 'Discount Code', 'Clicks (period)', 'Clicks (all time)', 'Top Source']));
    for (const r of results || []) {
      lines.push(csvRow([
        r.title,
        CAT_LABEL_MAP[r.category] || r.category,
        r.code || '',
        r.period_clicks,
        r.all_time_clicks,
        r.top_source ? (SOURCE_LABEL_MAP[r.top_source] || r.top_source) : '',
      ]));
    }
    lines.push('');
  }

  // --- Referrers ---
  if (include.includes('referrers')) {
    const { results } = await env.DB.prepare(`
      SELECT referrer_full url, referrer_source source,
             COUNT(*) views, COUNT(DISTINCT session_id) uniq
      FROM pageviews
      WHERE device != 'bot' AND created_at >= ${since}
        AND referrer_full IS NOT NULL AND referrer_full != ''
        AND referrer_full NOT LIKE '%dmjr.countrymankody14.workers.dev%'
        AND referrer_full NOT LIKE '%davidmausjr.com%'
      GROUP BY referrer_full ORDER BY views DESC LIMIT 50
    `).all();
    lines.push(csvRow(['## TOP REFERRING URLs']));
    lines.push(csvRow(['Source', 'URL', 'Views', 'Unique Visitors']));
    for (const r of results || []) {
      lines.push(csvRow([
        SOURCE_LABEL_MAP[r.source] || r.source,
        r.url, r.views, r.uniq,
      ]));
    }
    lines.push('');
  }

  // --- Heatmap ---
  if (include.includes('heatmap')) {
    const { results } = await env.DB.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) dow,
             CAST(strftime('%H', created_at) AS INTEGER) hour,
             COUNT(*) views
      FROM pageviews WHERE device != 'bot' AND created_at >= ${since}
      GROUP BY dow, hour
    `).all();
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of results || []) grid[r.dow][r.hour] = r.views;
    lines.push(csvRow(['## PEAK ACTIVITY BY DAY & HOUR (UTC)']));
    const header = ['Day', ...Array.from({ length: 24 }, (_, h) => `${h}:00`)];
    lines.push(csvRow(header));
    for (let d = 0; d < 7; d++) {
      lines.push(csvRow([DAY_NAMES[d], ...grid[d]]));
    }
    lines.push('');
  }

  const body = lines.join('\r\n');
  const filename = `dmj-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleAnalyticsHeatmap(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  // Day of week: 0=Sunday .. 6=Saturday. Hour: 0..23 in UTC
  // (close enough for pattern detection — not localizing per visitor).
  const q = `
    SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow,
           CAST(strftime('%H', created_at) AS INTEGER) AS hour,
           COUNT(*) AS views
    FROM pageviews
    WHERE device != 'bot' AND created_at >= ${since}
    GROUP BY dow, hour
  `;
  const { results } = await env.DB.prepare(q).all();
  // Build 7 x 24 grid, dense
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const r of results || []) {
    if (r.dow == null || r.hour == null) continue;
    grid[r.dow][r.hour] = r.views;
    if (r.views > max) max = r.views;
  }
  return json({ grid, max });
}

async function handleAnalyticsDevices(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const q = `
    SELECT device, COUNT(*) AS count
    FROM pageviews
    WHERE device != 'bot' AND created_at >= ${since}
    GROUP BY device
  `;
  const { results } = await env.DB.prepare(q).all();
  const counts = { mobile: 0, desktop: 0, tablet: 0 };
  for (const r of results || []) {
    if (counts.hasOwnProperty(r.device)) counts[r.device] = r.count;
  }
  return json(counts);
}

async function handleAnalyticsCountries(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'month';
  const { since } = rangeToSql(range);
  const q = `
    SELECT COALESCE(country, '??') AS country, COUNT(*) AS views
    FROM pageviews
    WHERE device != 'bot' AND created_at >= ${since}
    GROUP BY country
    ORDER BY views DESC
    LIMIT 10
  `;
  const { results } = await env.DB.prepare(q).all();
  return json({ countries: results || [] });
}

// Data retention: purge rows older than 18 months. Called lazily from
// overview endpoint at most once per day (guarded by a flag column in content).
async function retentionCleanup(env, ctx) {
  const row = await env.DB
    .prepare(`SELECT value FROM content WHERE key = 'analytics_last_cleanup'`)
    .first().catch(() => null);
  const now = new Date().toISOString().slice(0, 10);
  if (row && row.value === now) return;

  const job = async () => {
    await env.DB.prepare(`DELETE FROM pageviews WHERE created_at < datetime('now','-18 months')`).run().catch(() => {});
    await env.DB.prepare(`DELETE FROM product_clicks WHERE created_at < datetime('now','-18 months')`).run().catch(() => {});
    // Upsert the flag (content table uses `key` primary)
    await env.DB.prepare(
      `INSERT INTO content (key, value, kind, label, group_name)
       VALUES ('analytics_last_cleanup', ?, 'text', 'Analytics Last Cleanup', 'system')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(now).run().catch(() => {});
  };
  if (ctx && ctx.waitUntil) ctx.waitUntil(job()); else await job();
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

      // YouTube stats (public, cached)
      if (path === '/api/youtube/stats' && request.method === 'GET') {
        return handleYouTubeStats(request, env, ctx);
      }

      // Analytics: public tracking (POST only)
      if (path === '/api/track/pageview' && request.method === 'POST') {
        return handleTrackPageview(request, env, ctx);
      }
      if (path === '/api/track/click' && request.method === 'POST') {
        return handleTrackClick(request, env, ctx);
      }

      // Analytics: authenticated reads
      if (path.startsWith('/api/analytics/')) {
        const user = await requireAuth(request, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        if (path === '/api/analytics/overview') {
          retentionCleanup(env, ctx);
          return handleAnalyticsOverview(request, env);
        }
        if (path === '/api/analytics/timeseries') return handleAnalyticsTimeseries(request, env);
        if (path === '/api/analytics/sources')    return handleAnalyticsSources(request, env);
        if (path === '/api/analytics/pages')      return handleAnalyticsPages(request, env);
        if (path === '/api/analytics/products')   return handleAnalyticsProducts(request, env);
        if (path === '/api/analytics/devices')    return handleAnalyticsDevices(request, env);
        if (path === '/api/analytics/countries')  return handleAnalyticsCountries(request, env);
        if (path === '/api/analytics/live')       return handleAnalyticsLive(request, env);
        if (path === '/api/analytics/referrers')  return handleAnalyticsReferrers(request, env);
        if (path === '/api/analytics/heatmap')    return handleAnalyticsHeatmap(request, env);
        if (path === '/api/analytics/export')     return handleAnalyticsExport(request, env);
      }

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
