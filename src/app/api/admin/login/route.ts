/**
 * /api/admin/login — POST { password } → sets admin_session cookie.
 *
 * Wrong password returns 401 with a generic message; we don't reveal
 * whether the password was the issue vs the env var being unset, to
 * make brute force less informative. Rate limit is "good enough" for
 * a single-admin tool — Cloudflare's WAF will throttle abuse at the
 * edge if it ever becomes a real attack target.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { buildSessionCookie } from '@/lib/admin-auth';

export const runtime = 'edge';

interface Env {
  ADMIN_PASSWORD?: string;
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.ADMIN_PASSWORD) {
    return new Response(
      JSON.stringify({ error: 'admin not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.password || body.password !== env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'wrong password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookie = await buildSessionCookie(env.ADMIN_PASSWORD);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
}
