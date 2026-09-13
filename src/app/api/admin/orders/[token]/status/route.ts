/**
 * /api/admin/orders/[token]/status — POST { status, note? } updates the
 * order workflow state with an optional admin note. Auth-gated.
 *
 * Status flow (smart album orders):
 *   pending_payment ─┬─→ cancelled         (manual; before payment lands)
 *                    └─→ paid              (webhook only — not via this endpoint)
 *   paid → in_design → in_production → shipped → delivered
 *   paid → refunded   (only via /refund endpoint — sets up Square refund call)
 *
 * Status flow (manual album orders — legacy):
 *   submitted → in_progress → shipped → delivered
 *   any → cancelled
 *
 * The endpoint accepts the union of both enums so legacy orders keep
 * working. We refuse the 'paid' transition here — the only path to
 * 'paid' is the Square webhook, which also captures the payment id.
 *
 * Every transition writes an entry into `statusHistory`: who did it
 * (currently always 'admin', since there's one admin), when, and any
 * note. The history is what the order-detail page renders as the
 * timeline.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';

export const runtime = 'edge';

const ALLOWED_STATUSES = [
  // Manual flow (legacy)
  'submitted',
  'in_progress',
  // Smart flow + extended
  'pending_payment',
  // 'paid' intentionally omitted — set ONLY by Square webhook
  'in_design',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
  // 'refunded' intentionally omitted — set ONLY by /refund endpoint
] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

const STATUSES_REJECTED_AFTER_PAID = new Set<Status>(['pending_payment', 'cancelled']);

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

interface StatusHistoryEntry {
  status: string;
  at: string;
  by: 'admin' | 'system';
  note?: string;
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

  let body: { status?: string; note?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid body');
  }
  const newStatus = body.status as Status | undefined;
  if (!newStatus || !ALLOWED_STATUSES.includes(newStatus)) {
    return err(400, 'invalid status');
  }
  const note = body.note?.toString().slice(0, 500);
  const force = !!body.force;

  // Read the design record
  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'order not found');
  let design: { status?: string; statusHistory?: StatusHistoryEntry[]; [k: string]: unknown };
  try {
    design = JSON.parse(json);
  } catch {
    return err(500, 'corrupt design record');
  }

  // Lock enforcement — once paid, the order is locked per clause 2.3.
  // Admin can override with `force: true` (the order detail UI surfaces
  // this as a "force unlock" button so accidental backward transitions
  // are hard to do).
  if (design.status === 'paid' && STATUSES_REJECTED_AFTER_PAID.has(newStatus) && !force) {
    return err(
      409,
      'Order is paid and locked. Re-open with force=true if you really mean it.',
    );
  }
  if (design.status === 'refunded' && !force) {
    return err(409, 'Order is refunded. Use force=true to override.');
  }

  // Apply the transition
  design.status = newStatus;
  const history: StatusHistoryEntry[] = Array.isArray(design.statusHistory)
    ? design.statusHistory
    : [];
  history.push({
    status: newStatus,
    at: new Date().toISOString(),
    by: 'admin',
    note,
  });
  design.statusHistory = history;

  await env.DESIGN_DRAFTS.put(token, JSON.stringify(design), {
    expirationTtl: 365 * 24 * 60 * 60,
  });

  // Patch the orders index
  try {
    const indexJson = await env.DESIGN_DRAFTS.get('_orders_index_v1');
    if (indexJson) {
      const list = JSON.parse(indexJson) as IndexEntry[];
      const i = list.findIndex((e) => e.token === token);
      if (i >= 0) {
        list[i].status = newStatus;
        await env.DESIGN_DRAFTS.put('_orders_index_v1', JSON.stringify(list));
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
