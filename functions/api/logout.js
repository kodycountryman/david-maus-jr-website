import { clearSessionCookie, isSecureRequest, json } from '../_lib/auth.js';

export async function onRequestPost({ request }) {
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(isSecureRequest(request)) });
}
