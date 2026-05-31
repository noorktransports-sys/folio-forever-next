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
 *   - Max 35 MB per photo. Covers full-resolution 20×30 full-bleed
 *     exports (typically 20–32 MB) with a tight margin. Anything
 *     bigger is almost always an unoptimized RAW export that won't
 *     gain print quality over a high-quality 25 MB JPEG.
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

// 35 MB hard per-photo cap. Covers full-resolution 20×30 full-bleed
// JPEG exports (typically 20–32 MB) with a tight margin. Anything
// above 35 MB is almost always an unoptimized RAW export — those
// don't gain print quality over a high-quality 25 MB JPEG and
// would balloon R2 storage costs for no end-user benefit.
const MAX_BYTES = 35 * 1024 * 1024;
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
      `${safe} is ${mb} MB; the per-photo limit is 35 MB. Please export at a lower resolution or higher JPEG compression (sRGB JPEG quality 90 from a 6000 px long-edge source is the sweet spot).`,
    );
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return err(415, `unsupported type ${file.type}; allowed: jpeg/png/webp`);
  }

  // 12-char random id from Web Crypto. Sufficient for 200-300 albums/mo.
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const key = `designs/${designId}/${id}.${ext}`;

  // Wrap the arrayBuffer read AND R2 put in try/catch — without this
  // any failure (transient R2 outage, memory pressure on a huge file,
  // network timeout to the bucket) bubbles up as an uncaught worker
  // exception. Cloudflare then returns a bare 5xx with no JSON body,
  // which the client surfaces as "Upload failed (503)" — no clue
  // which photo or why. Now we always respond JSON.
  try {
    const buf = await file.arrayBuffer();
    await env.PHOTOS.put(key, buf, {
      httpMetadata: { contentType: file.type },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
    const nameRaw = file.name || 'photo';
    const safe = nameRaw.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
    return err(
      502,
      `Couldn't save ${safe} to storage: ${detail}. Try again in a moment.`,
    );
  }

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
