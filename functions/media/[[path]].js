// Serves uploaded files from R2 at /media/<r2-key>
// Public — read-only

export async function onRequestGet({ params, env }) {
  if (!env.MEDIA) return new Response('R2 not configured', { status: 500 });
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  if (!path) return new Response('Not found', { status: 404 });

  const object = await env.MEDIA.get(path);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}
