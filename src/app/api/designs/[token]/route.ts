/**
 * /api/designs/[token] — fetch a saved design by its share token.
 *
 * Returns the raw JSON the client POSTed to /api/designs. The schema is
 * opaque to the server — we just hand the bytes back. The /design page
 * is responsible for parsing and rendering.
 *
 * 404 if the token doesn't exist (or expired). Cache headers: short
 * private/max-age so the user sees freshness if they re-save under the
 * same token (which we never do today — every save mints a new token —
 * but reserving the option for later).
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) {
    return new Response('design storage unavailable', { status: 503 });
  }

  const { token } = await params;
  if (!token || !/^[a-f0-9]{8,64}$/i.test(token)) {
    return new Response('invalid token', { status: 400 });
  }

  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) {
    return new Response(JSON.stringify({ error: 'not found or expired' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Real ORDERS: only hand back what the thank-you page needs — never the
  // customer's address, phone, email or audit data (anyone with the link
  // could otherwise read them).
  let body = json;
  try {
    const rec = JSON.parse(json) as Record<string, unknown>;
    if (rec && typeof rec === 'object' && rec.orderId) {
      body = JSON.stringify({
        orderId: rec.orderId,
        status: rec.status,
        mode: rec.mode,
        albumName: rec.albumName,
        sharePack: rec.sharePack ?? null,
      });
    }
  } catch {
    /* not JSON — return as saved */
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=60',
    },
  });
}
