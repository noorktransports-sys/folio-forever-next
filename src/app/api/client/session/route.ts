/**
 * GET /api/client/session
 *
 * Returns { ok, email } if the caller holds a valid signed ff_client
 * cookie (verified email, unexpired). Used by the designer to decide
 * whether to show the registration gate or the wizard.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { verifyClientCookie } from '@/lib/client-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface Env {
  TOKEN_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
}

export async function GET(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  const secret =
    env.TOKEN_ENCRYPTION_KEY || env.RESEND_API_KEY || 'ff-client-fallback-secret';
  const email = await verifyClientCookie(request, secret);
  return new Response(JSON.stringify({ ok: !!email, email: email || undefined }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
