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
import { readProSession } from '@/lib/photographer-auth';

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

// Drafts index — every successful save appends a summary so the admin
// dashboard can show "leads" (customers who designed but haven't
// submitted). Capped to the most recent 200 entries to bound size.
const DRAFTS_INDEX_KEY = '_drafts_index_v1';
const DRAFTS_INDEX_MAX = 200;
interface DraftEntry {
  token: string;
  customerName: string;
  customerEmail: string;
  size: string;
  totalSpreads: number;
  photoCount: number;
  savedAt: string;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  SITE_URL?: string;
  ADMIN_PASSWORD?: string;
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

  // Detect logged-in photographer (cookie). If present, the design
  // gets tagged with their accountId so the /pro dashboard can list
  // it. Anonymous (couple-direct) saves stay un-tagged.
  const photographerId = await readProSession(request, env.ADMIN_PASSWORD);

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

  // If a photographer is signed in, splice their accountId into the
  // saved design JSON before persisting so /album and admin views can
  // attribute the order. We do a parse/stringify round trip here only
  // when needed — most saves just write `text` straight through.
  let bodyToWrite = text;
  if (photographerId) {
    try {
      const parsed = JSON.parse(text);
      parsed.photographerId = photographerId;
      bodyToWrite = JSON.stringify(parsed);
    } catch { /* validated above; defensive */ }
  }
  await env.DESIGN_DRAFTS.put(token, bodyToWrite, {
    expirationTtl: TTL_SECONDS,
  });

  // Append to the photographer's album index so /pro dashboard lists it.
  if (photographerId) {
    try {
      const indexKey = `_photographer_${photographerId}_albums_v1`;
      const existing = await env.DESIGN_DRAFTS.get(indexKey);
      const list: Array<Record<string, unknown>> = existing
        ? JSON.parse(existing)
        : [];
      // Avoid duplicates if the same token was saved before.
      if (!list.find((e) => (e as { token?: string }).token === token)) {
        const parsed = JSON.parse(text) as {
          customer?: { name?: string; email?: string };
          size?: string;
          totalSpreads?: number;
          uploadedPhotos?: Record<string, unknown>;
        };
        const photoCount = parsed.uploadedPhotos
          ? Object.keys(parsed.uploadedPhotos).length
          : 0;
        list.unshift({
          token,
          customerName: parsed.customer?.name || '',
          customerEmail: parsed.customer?.email || '',
          size: parsed.size || '',
          totalSpreads: parsed.totalSpreads || 0,
          photoCount,
          status: 'draft',
          savedAt: new Date().toISOString(),
        });
        if (list.length > 200) list.length = 200;
        await env.DESIGN_DRAFTS.put(indexKey, JSON.stringify(list));
      }
    } catch (e) {
      console.warn('Folio designs: photographer index update failed', e);
    }
  }

  // Append to drafts index for the admin dashboard. Best-effort —
  // failures here mustn't break the save itself.
  try {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* shouldn't happen — already validated above */
    }
    const d = parsed as {
      customer?: { name?: string; email?: string };
      size?: string;
      totalSpreads?: number;
      uploadedPhotos?: Record<string, unknown>;
    };
    const entry: DraftEntry = {
      token,
      customerName: d.customer?.name || '',
      customerEmail: d.customer?.email || '',
      size: d.size || '',
      totalSpreads: d.totalSpreads || 0,
      photoCount: d.uploadedPhotos ? Object.keys(d.uploadedPhotos).length : 0,
      savedAt: new Date().toISOString(),
    };
    const indexJson = await env.DESIGN_DRAFTS.get(DRAFTS_INDEX_KEY);
    let list: DraftEntry[] = indexJson ? JSON.parse(indexJson) : [];
    list.unshift(entry);
    // Cap so the JSON stays under KV's value-size limit even if a
    // burst of saves lands.
    if (list.length > DRAFTS_INDEX_MAX) list = list.slice(0, DRAFTS_INDEX_MAX);
    await env.DESIGN_DRAFTS.put(DRAFTS_INDEX_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Folio designs: drafts index update failed', e);
  }

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
