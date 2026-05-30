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
 *   - Max 40 MB per photo. Client compresses most uploads to ~5 MB
 *     before sending; the ceiling exists for full-bleed 20×30
 *     spreads where the photographer opts out of optimization.
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

// 40 MB hard cap. Most uploads are pre-compressed to ~5 MB by the
// client; the ceiling exists for the rare full-resolution upload (a
// 20×30 full-bleed where the photographer opts out of optimization).
// 30 MB used to be the cap but real albums hit it; 40 MB gives a
// little headroom without inviting multi-hundred-MB RAW exports.
const MAX_BYTES = 40 * 1024 * 1024;
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
    const nameRaw = file.name || 'photo'
    const safe = nameRaw.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80)
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return err(
      413,
      `${safe} is ${mb} MB; the per-photo limit is 40 MB. Please export at a lower resolution or higher JPEG compression.`,
    );
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
