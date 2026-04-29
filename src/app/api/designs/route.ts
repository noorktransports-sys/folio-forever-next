/**
 * /api/designs — POST a design state, get back a shareable token.
 *
 * Storage: Cloudflare Workers KV namespace DESIGN_DRAFTS (configured in
 * wrangler.toml). 60-day TTL via expirationTtl so abandoned drafts auto-purge
 * (matches the photo-retention spec).
 *
 * Token: 12 hex chars from Web Crypto. ~10^14 keyspace — collision-safe
 * for v1 volumes. Future: when login lands we'll prefix with the user id
 * so designs can also be looked up under "my designs".
 *
 * Body shape: any JSON. We don't validate the design schema here because
 * the client controls it; KV stores opaque strings. We do enforce a hard
 * size cap (1 MB) to prevent abuse — a real design with photo URLs is
 * ~10–50 KB.
 *
 * Response: { token, shareUrl }
 *   shareUrl is a fully-qualified link the user can paste into chat / email.
 *   The /design page reads ?d=<token> on load and restores the state.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days
const MAX_BYTES = 1_000_000; // 1 MB hard cap on the saved JSON

interface KVNamespace {
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  get(key: string): Promise<string | null>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  SITE_URL?: string;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) {
    return err(503, 'design storage unavailable');
  }

  const text = await request.text();
  if (!text || text.length === 0) return err(400, 'empty body');
  if (text.length > MAX_BYTES) {
    return err(413, `design too large; max ${MAX_BYTES} bytes`);
  }

  // Validate it's at least parseable JSON. We don't enforce a schema —
  // the client owns that contract — but reject obvious garbage.
  try {
    JSON.parse(text);
  } catch {
    return err(400, 'body is not valid JSON');
  }

  // Generate a 12-hex-char token. Web Crypto is available at the edge.
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  await env.DESIGN_DRAFTS.put(token, text, {
    expirationTtl: TTL_SECONDS,
  });

  const siteUrl = env.SITE_URL || 'https://folioforever.com';
  // Share URL points to the read-only viewer at /album/<token> — NOT
  // the editor at /design?d=<token>. Customers landing in the editor
  // tend to keep tweaking and re-saving, generating duplicate tokens
  // and order-confirmation noise. The viewer is the artifact; the
  // editor is the workshop. The original customer can still reach
  // the editor via the "Edit this design" link inside the viewer.
  const shareUrl = `${siteUrl}/album/${token}`;

  return new Response(
    JSON.stringify({ token, shareUrl, expiresIn: TTL_SECONDS }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
