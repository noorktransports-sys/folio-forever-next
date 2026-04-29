/**
 * /api/pro/verify?token=<x> — consumes a magic-link token, sets the
 * pro_session cookie (HMAC-signed, 30-day TTL), and 302-redirects to
 * /pro. Single-use: the token is deleted from KV after consumption so
 * a leaked link can't be replayed.
 *
 * If the token is missing / expired / already used, redirects to
 * /pro/login?error=expired so the photographer can request a fresh link.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { buildProSessionCookie } from '@/lib/photographer-auth';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

export async function GET(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();

  if (!token || !/^[a-f0-9]{32}$/i.test(token)) {
    return Response.redirect(`${url.origin}/pro/login?error=invalid`, 302);
  }
  if (!env.DESIGN_DRAFTS || !env.ADMIN_PASSWORD) {
    return Response.redirect(`${url.origin}/pro/login?error=unavailable`, 302);
  }

  const recordRaw = await env.DESIGN_DRAFTS.get(`_pro_magic_${token}`);
  if (!recordRaw) {
    return Response.redirect(`${url.origin}/pro/login?error=expired`, 302);
  }
  const record = JSON.parse(recordRaw) as {
    accountId: string;
    email: string;
    expiresAt: number;
  };
  if (record.expiresAt < Date.now()) {
    await env.DESIGN_DRAFTS.delete(`_pro_magic_${token}`);
    return Response.redirect(`${url.origin}/pro/login?error=expired`, 302);
  }

  // Single-use: drop the token immediately so a re-click of the same
  // link can't generate a second session.
  await env.DESIGN_DRAFTS.delete(`_pro_magic_${token}`);

  const cookie = await buildProSessionCookie(
    record.accountId,
    env.ADMIN_PASSWORD,
  );
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/pro`,
      'Set-Cookie': cookie,
    },
  });
}
