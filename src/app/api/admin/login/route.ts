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
import { allowRequest, tooMany, type RateKV } from '@/lib/rate-limit';

export const runtime = 'edge';

interface Env {
  ADMIN_PASSWORD?: string;
  DESIGN_DRAFTS?: RateKV;
}

/** Compare without leaking how many characters matched. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.ADMIN_PASSWORD) {
    return new Response(
      JSON.stringify({ error: 'admin not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 8 attempts per 15 minutes per IP — stops password guessing.
  if (!(await allowRequest(env.DESIGN_DRAFTS, request, 'admin-login', 8, 900))) {
    return tooMany('Too many login attempts — wait 15 minutes and try again');
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

  if (!body.password || !(await sameSecret(String(body.password), env.ADMIN_PASSWORD))) {
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
