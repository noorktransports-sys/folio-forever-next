/**
 * GET /api/admin/audit?type=proof|rights|refund&cursor=&limit=50
 *
 * Returns the legal audit log (PDF clauses 2.2 / 2.3 / 2.4 + refunds).
 * Backed by KV.list against the prefixes the submit endpoint writes:
 *   - proof_approval:{orderId}
 *   - content_rights:{orderId}
 *   - refund:{orderId}:{refundId}
 *
 * Cursor + limit so the admin page can paginate without loading 1000s
 * of records at once.
 *
 * Returns: { type, items: [{ key, summary }], cursor, listComplete }
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVListResult {
  keys: Array<{ name: string; expiration?: number }>;
  list_complete: boolean;
  cursor?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

const VALID_TYPES = new Set(['proof', 'rights', 'refund']);
const PREFIX: Record<string, string> = {
  proof: 'proof_approval:',
  rights: 'content_rights:',
  refund: 'refund:',
};

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) {
    return err(401, 'unauthorized');
  }
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');

  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? 'proof';
  if (!VALID_TYPES.has(type)) return err(400, 'invalid type');
  const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
  const cursor = url.searchParams.get('cursor') ?? undefined;

  const listed = await env.DESIGN_DRAFTS.list({
    prefix: PREFIX[type],
    limit,
    cursor,
  });

  // Fetch each record. Sequential — KV reads are fast; parallel would
  // hit Promise.all overhead with no real win at our scale.
  const items: Array<{ key: string; data: unknown }> = [];
  for (const k of listed.keys) {
    const raw = await env.DESIGN_DRAFTS.get(k.name);
    if (!raw) continue;
    try {
      items.push({ key: k.name, data: JSON.parse(raw) });
    } catch {
      items.push({ key: k.name, data: { _corrupt: true } });
    }
  }

  // Newest-first by serverReceivedAt if present
  items.sort((a, b) => {
    const ta = (a.data as { serverReceivedAt?: string; at?: string })?.serverReceivedAt ??
      (a.data as { at?: string })?.at ?? '';
    const tb = (b.data as { serverReceivedAt?: string; at?: string })?.serverReceivedAt ??
      (b.data as { at?: string })?.at ?? '';
    return tb.localeCompare(ta);
  });

  return new Response(
    JSON.stringify({
      ok: true,
      type,
      items,
      cursor: listed.cursor ?? null,
      listComplete: listed.list_complete,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
