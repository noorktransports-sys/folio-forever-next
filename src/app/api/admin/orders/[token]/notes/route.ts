/**
 * /api/admin/orders/[token]/notes — POST { notes } updates the
 * adminNotes field on the design record. Auth-gated.
 *
 * Use case: Jayvee's working memory across days. "Customer wants
 * matte cover", "second photo bleeds, swap with backup", etc.
 * Never shown to the customer.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

const MAX_NOTES_LEN = 8000;

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) {
    return err(401, 'unauthorized');
  }
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');
  const { token } = await params;
  if (!/^[a-f0-9]{8,64}$/i.test(token)) return err(400, 'invalid token');

  let body: { notes?: string };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid body');
  }
  const notes = (body.notes || '').slice(0, MAX_NOTES_LEN);

  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'order not found');
  let design: Record<string, unknown>;
  try {
    design = JSON.parse(json);
  } catch {
    return err(500, 'corrupt design record');
  }
  design.adminNotes = notes;
  design.adminNotesUpdatedAt = new Date().toISOString();
  await env.DESIGN_DRAFTS.put(token, JSON.stringify(design), {
    expirationTtl: 365 * 24 * 60 * 60,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
