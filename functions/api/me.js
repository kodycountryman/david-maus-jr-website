import { requireAuth, json } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const auth = await requireAuth(context);
  if (auth.unauthorized) return auth.response;
  return json({ user: { id: auth.user.sub, username: auth.user.username } });
}
