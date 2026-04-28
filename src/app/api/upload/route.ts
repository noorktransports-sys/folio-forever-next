/**
 * /api/upload — receives a photo from the album designer and stores it in R2.
 *
 * Runs at the Cloudflare edge. Uses the native R2 binding (env.PHOTOS) so no
 * AWS SDK / signed URLs / token hygiene is needed. Bucket configured in
 * wrangler.toml: bucket_name = "folioforever-photos", binding = "PHOTOS".
 *
 * Storage layout: `designs/{designId}/{nanoid}.{ext}`
 *   designId — supplied by the client; for anonymous (pre-login) designs it's
 *              the cookie-based draft id. Once the user signs up at Submit,
 *              the design is moved under their user id.
 *   nanoid   — collision-free random suffix (12 chars from crypto.randomUUID,
 *              hyphens stripped). No nanoid dep needed at the edge.
 *
 * Validation gates (per locked spec):
 *   - JPG / PNG / WEBP only
 *   - Max 15 MB per photo (also enforced at upstream MAX_UPLOAD_BYTES env var)
 *   - 2-month retention will be applied via a cron job (Task #later); the
 *     route only handles ingest.
 *
 * Response shape: { id, url, key, size, contentType }
 *   id  — short stable handle the client uses for drag/drop and dataset attrs.
 *   url — proxies through /api/photo/* so the bucket can stay private and the
 *         cover-builder / spread editor can render `<img src={url}>` without
 *         dealing with R2 presigning client-side.
 *   key — full R2 storage key (`designs/{designId}/{id}.{ext}`) for any future
 *         server-side ops (move on signup, delete on retention, etc).
 *   The `{id, url}` pair matches what album-builder.js's storePhoto() expects.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB cap; mirrors wrangler [vars].MAX_UPLOAD_BYTES
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface Env {
  PHOTOS?: R2Bucket;
}

// Minimal R2 type — full type lives in @cloudflare/workers-types but we
// only need .put for this route, so keep the surface tight.
interface R2Bucket {
  put(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.PHOTOS) return err(503, 'storage binding unavailable');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err(400, 'expected multipart/form-data');
  }

  const file = form.get('file');
  const designIdRaw = form.get('designId');
  const designId = typeof designIdRaw === 'string' && designIdRaw.length > 0
    ? designIdRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    : 'anonymous';

  if (!(file instanceof File)) return err(400, 'no file field in request');
  if (file.size === 0) return err(400, 'file is empty');
  if (file.size > MAX_BYTES) {
    return err(413, `file too large; max ${MAX_BYTES} bytes (15 MB)`);
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return err(415, `unsupported type ${file.type}; allowed: jpeg/png/webp`);
  }

  // 12-char random id from Web Crypto. Sufficient for 200-300 albums/mo.
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const key = `designs/${designId}/${id}.${ext}`;

  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  return new Response(
    JSON.stringify({
      id,
      url: `/api/photo/${key}`,
      key,
      size: file.size,
      contentType: file.type,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
