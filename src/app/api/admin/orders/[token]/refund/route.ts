/**
 * POST /api/admin/orders/[token]/refund
 *
 * Issues a Square refund against the captured payment for this order.
 * Owner-only (admin cookie). Supports full and partial refunds.
 *
 * Body:
 *   {
 *     amountCents?: number,   // optional — defaults to full refund
 *     reason?: string,         // optional, shown on the Square refund record
 *   }
 *
 * Side effects:
 *   - Calls Square /v2/refunds
 *   - On success, sets order.status='refunded', appends to statusHistory,
 *     stores refund record at `refund:{orderId}:{refundId}` for audit
 *   - Patches the orders index entry
 *   - Does NOT send a customer email automatically — owner can use the
 *     /resend or /send-email endpoints if they want.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';
import { mintIdempotencyKey, refundSquarePayment } from '@/lib/square';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

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
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_ENV?: string;
}

interface OrderRecord {
  orderId?: string;
  status?: string;
  squarePaymentId?: string;
  squareAmountTotalCents?: number;
  album?: { totalPrice?: number };
  statusHistory?: Array<{ status: string; at: string; by: string; note?: string }>;
  refunds?: Array<{
    refundId: string;
    amountCents: number;
    reason?: string;
    at: string;
    squareStatus?: string;
  }>;
  [k: string]: unknown;
}

const ORDERS_INDEX_KEY = '_orders_index_v1';

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
  if (!env.SQUARE_ACCESS_TOKEN) return err(500, 'Square not configured');

  const { token } = await params;
  if (!/^[a-f0-9]{8,64}$/i.test(token)) return err(400, 'invalid token');

  let body: { amountCents?: number; reason?: string };
  try {
    body = (await request.json()) as { amountCents?: number; reason?: string };
  } catch {
    return err(400, 'invalid body');
  }
  const reason = body.reason?.toString().slice(0, 192);

  // Read the order
  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'order not found');
  let order: OrderRecord;
  try {
    order = JSON.parse(json) as OrderRecord;
  } catch {
    return err(500, 'corrupt order record');
  }

  if (!order.squarePaymentId) {
    return err(400, 'No Square payment recorded for this order; cannot refund');
  }
  if (order.status !== 'paid' && order.status !== 'in_design' && order.status !== 'in_production' && order.status !== 'shipped' && order.status !== 'delivered') {
    return err(400, `Cannot refund order in status '${order.status}'`);
  }

  // Default to full refund. Square enforces "no refund exceeds payment".
  const fullCents = order.squareAmountTotalCents ?? (order.album?.totalPrice ?? 0) * 100;
  const amountCents =
    typeof body.amountCents === 'number' && body.amountCents > 0
      ? Math.floor(body.amountCents)
      : fullCents;
  if (amountCents <= 0 || amountCents > fullCents) {
    return err(400, `Refund amount must be 1..${fullCents} cents`);
  }

  const envName: 'production' | 'sandbox' =
    env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';
  const idempotencyKey = mintIdempotencyKey(`refund_${token}`);
  const result = await refundSquarePayment({
    accessToken: env.SQUARE_ACCESS_TOKEN,
    envName,
    idempotencyKey,
    paymentId: order.squarePaymentId,
    amountCents,
    reason,
  });

  if (!result.ok || !result.refundId) {
    return err(502, `Square refund failed: ${result.error || 'unknown'}`);
  }

  // Persist the refund on the order record + flip status to refunded
  const refundEntry = {
    refundId: result.refundId,
    amountCents,
    reason,
    at: new Date().toISOString(),
    squareStatus: result.status,
  };
  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  refunds.push(refundEntry);

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  history.push({
    status: 'refunded',
    at: refundEntry.at,
    by: 'admin',
    note: `Refunded $${(amountCents / 100).toFixed(2)}${reason ? ' — ' + reason : ''}`,
  });

  const updated = {
    ...order,
    status: 'refunded' as const,
    refunds,
    statusHistory: history,
    lastRefundAt: refundEntry.at,
  };
  await env.DESIGN_DRAFTS.put(token, JSON.stringify(updated), {
    expirationTtl: 365 * 24 * 60 * 60,
  });

  // Store a standalone refund audit record for legal review
  try {
    const auditKey = `refund:${order.orderId ?? token}:${result.refundId}`;
    await env.DESIGN_DRAFTS.put(
      auditKey,
      JSON.stringify({
        ...refundEntry,
        token,
        orderId: order.orderId,
        squarePaymentId: order.squarePaymentId,
      }),
      { expirationTtl: 365 * 24 * 60 * 60 },
    );
  } catch (e) {
    console.warn('[refund] audit write failed', e);
  }

  // Patch the orders index
  try {
    const indexRaw = await env.DESIGN_DRAFTS.get(ORDERS_INDEX_KEY);
    if (indexRaw) {
      const index = JSON.parse(indexRaw) as Array<Record<string, unknown>>;
      const idx = index.findIndex((e) => e.token === token);
      if (idx >= 0) {
        index[idx] = { ...index[idx], status: 'refunded', refundedAt: refundEntry.at };
        await env.DESIGN_DRAFTS.put(ORDERS_INDEX_KEY, JSON.stringify(index));
      }
    }
  } catch (e) {
    console.warn('[refund] index update failed', e);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      refundId: result.refundId,
      amountCents,
      squareStatus: result.status,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
