/**
 * GET /api/admin/clients
 *
 * Admin-only. Returns every client who registered + verified their
 * email at the designer gate. Backed by KV keys `client:{email}`.
 *
 * Returns: { clients: [{ name, email, phone, verifiedAt }], total }
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVListResult {
  keys: Array<{ name: string }>;
  list_complete: boolean;
  cursor?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<KVListResult>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

interface ClientRecord {
  name: string;
  email: string;
  phone: string;
  verifiedAt: string;
}

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

  // Walk every client:{email} key (paged), then load each record.
  const keys: string[] = [];
  let cursor: string | undefined;
  // Hard cap so a huge list can't run forever / blow the subrequest budget.
  for (let page = 0; page < 40; page++) {
    const listed: KVListResult = await env.DESIGN_DRAFTS.list({
      prefix: 'client:',
      limit: 1000,
      cursor,
    });
    for (const k of listed.keys) keys.push(k.name);
    if (listed.list_complete || !listed.cursor) break;
    cursor = listed.cursor;
  }

  const clients: ClientRecord[] = [];
  for (const key of keys) {
    const raw = await env.DESIGN_DRAFTS.get(key);
    if (!raw) continue;
    try {
      const c = JSON.parse(raw) as Partial<ClientRecord>;
      clients.push({
        name: c.name ?? '',
        email: c.email ?? key.slice('client:'.length),
        phone: c.phone ?? '',
        verifiedAt: c.verifiedAt ?? '',
      });
    } catch {
      /* skip corrupt record */
    }
  }

  // Newest first.
  clients.sort((a, b) => (a.verifiedAt < b.verifiedAt ? 1 : -1));

  return new Response(JSON.stringify({ clients, total: clients.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
