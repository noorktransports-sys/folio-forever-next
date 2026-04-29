/**
 * /api/admin/orders/[token]/status — POST { status } updates the order
 * workflow state. Auth-gated by the admin cookie.
 *
 * Status flow:
 *   submitted → in_progress → shipped → delivered
 *   any of the above → cancelled
 *
 * Updating status:
 *   1. Reads + rewrites the design KV record with the new status.
 *   2. Patches the entry in `_orders_index_v1` so the dashboard list
 *      reflects the new state without a re-fetch dance.
 *
 * Idempotent: setting the same status twice is fine. No notifications
 * fire from here yet — when Stripe + customer status emails are added,
 * this is where they'll plug in.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';

export const runtime = 'edge';

const ALLOWED_STATUSES = [
  'submitted',
  'in_progress',
  'shipped',
  'delivered',
  'cancelled',
] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

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

interface IndexEntry {
  token: string;
  status?: string;
  [k: string]: unknown;
}

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

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid body');
  }
  const newStatus = body.status as Status | undefined;
  if (!newStatus || !ALLOWED_STATUSES.includes(newStatus)) {
    return err(400, 'invalid status');
  }

  // Update the design record itself.
  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'order not found');
  let design: { status?: string; [k: string]: unknown };
  try {
    design = JSON.parse(json);
  } catch {
    return err(500, 'corrupt design record');
  }
  design.status = newStatus;
  // Year-long TTL for tracked orders.
  await env.DESIGN_DRAFTS.put(token, JSON.stringify(design), {
    expirationTtl: 365 * 24 * 60 * 60,
  });

  // Patch the orders index so the dashboard reflects the change.
  try {
    const indexJson = await env.DESIGN_DRAFTS.get('_orders_index_v1');
    if (indexJson) {
      const list = JSON.parse(indexJson) as IndexEntry[];
      const i = list.findIndex((e) => e.token === token);
      if (i >= 0) {
        list[i].status = newStatus;
        await env.DESIGN_DRAFTS.put(
          '_orders_index_v1',
          JSON.stringify(list),
        );
      }
    }
  } catch (e) {
    console.warn('Folio admin: orders index patch failed', e);
  }

  return new Response(JSON.stringify({ ok: true, status: newStatus }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
