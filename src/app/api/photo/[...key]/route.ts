/**
 * /api/photo/[...key] — proxies a photo from R2 back to the browser.
 *
 * The R2 bucket is private (no public URL). Instead of presigning every URL
 * client-side, we serve photos through this edge route. The cover-builder /
 * spread editor can render `<img src="/api/photo/designs/abc/xyz.jpg">` and
 * Cloudflare answers from the nearest edge node.
 *
 * Caching: private/max-age=3600 — photos are wedding photos, treat them as
 * sensitive. CDN doesn't cache them across users; the browser does for an
 * hour. If we later need shareable preview URLs (proofing email links),
 * we'll add a separate `/api/preview/{token}` route that signs a JWT.
 *
 * Auth: not yet enforced. v1 ships with key-knowledge as the only gate
 * (random 12-char nanoid is unguessable). Once Clerk is wired we'll
 * require the request user to own the design referenced in the key.
 *
 * Edge runtime so it sits in front of R2 with no cold-start cost.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

interface Env {
  PHOTOS?: R2Bucket;
}

interface R2Object {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
  etag: string;
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.PHOTOS) {
    return new Response('storage binding unavailable', { status: 503 });
  }

  const { key: keyParts } = await params;
  if (!keyParts || keyParts.length === 0) {
    return new Response('missing key', { status: 400 });
  }
  const key = keyParts.join('/');

  // Defence in depth: only allow paths under designs/.
  if (!key.startsWith('designs/')) {
    return new Response('forbidden', { status: 403 });
  }

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(obj.size),
      'ETag': obj.etag,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
