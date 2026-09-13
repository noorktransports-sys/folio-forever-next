/**
 * POST /api/square-webhook
 *
 * Square notifications. We act on:
 *   • payment.updated  — when status transitions to COMPLETED on the
 *     payment linked to one of our orders. This is the canonical
 *     "money has cleared" signal for hosted Payment Links.
 *
 * Other event types (refunds, disputes, etc.) are 200-acked but ignored
 * for now — refunds we issue ourselves go through the admin refund
 * endpoint and update the order directly.
 *
 * Configure in Square Dashboard → Developer → Webhooks:
 *   Notification URL: https://folioforever.com/api/square-webhook
 *   Events: payment.updated
 *
 * Env vars:
 *   SQUARE_WEBHOOK_SIGNATURE_KEY  — from the webhook subscription
 *   SQUARE_ACCESS_TOKEN           — to fetch payment details
 *   SQUARE_ENV                    — "production" (default) or "sandbox"
 *   DESIGN_DRAFTS, RESEND_API_KEY, SITE_URL, OWNER_EMAIL, ORDER_FROM_EMAIL
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { verifySquareWebhookSignature } from '@/lib/square';
import {
  customerPaidEmailHtml,
  ownerPaidEmailHtml,
  sendResendEmail,
  type SmartOrderEmailData,
} from '@/lib/smart-order-emails';

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
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  SQUARE_ENV?: string;
  RESEND_API_KEY?: string;
  SITE_URL?: string;
  ORDER_FROM_EMAIL?: string;
  OWNER_EMAIL?: string;
}

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';
const ORDERS_INDEX_KEY = '_orders_index_v1';
const SUBMITTED_TTL_SECONDS = 365 * 24 * 60 * 60;

interface SquareEventEnvelope {
  merchant_id?: string;
  type?: string;
  event_id?: string;
  created_at?: string;
  data?: {
    type?: string;
    id?: string;
    object?: {
      payment?: SquarePayment;
    };
  };
}

interface SquarePayment {
  id?: string;
  status?: string;
  amount_money?: { amount?: number; currency?: string };
  reference_id?: string;
  order_id?: string;
  receipt_url?: string;
}

interface SquareOrderResponse {
  order?: {
    metadata?: { token?: string; orderId?: string };
    reference_id?: string;
  };
}

/** Look up the order token from a payment. The payment carries an
 *  `order_id` (Square's order id, not ours). We resolve that via the
 *  Orders API to read our metadata.token. We DO also persist
 *  squareOrderId on the order record at checkout time, so for new
 *  orders we could match by squareOrderId without a Square API call —
 *  but a small KV scan would cost more, so we just hit Square. */
async function lookupOrderToken(
  accessToken: string,
  envName: 'production' | 'sandbox',
  squareOrderId: string,
): Promise<string | null> {
  const base =
    envName === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';
  const r = await fetch(`${base}/v2/orders/${encodeURIComponent(squareOrderId)}`, {
    headers: {
      'Square-Version': '2024-12-18',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as SquareOrderResponse;
  return (
    j.order?.metadata?.token ??
    j.order?.reference_id ??
    null
  );
}

export async function POST(request: Request) {
  const sig = request.headers.get('x-square-hmacsha256-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const { env } = getRequestContext() as { env: Env };
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    return new Response('Webhook key not configured', { status: 500 });
  }
  if (!env.DESIGN_DRAFTS) {
    return new Response('Storage not configured', { status: 500 });
  }
  if (!env.SQUARE_ACCESS_TOKEN) {
    return new Response('Square access not configured', { status: 500 });
  }

  // Read raw body (signature is over the bytes Square sent + our URL).
  const rawBody = await request.text();
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  const notificationUrl = `${siteUrl}/api/square-webhook`;
  const valid = await verifySquareWebhookSignature(
    rawBody,
    sig,
    notificationUrl,
    env.SQUARE_WEBHOOK_SIGNATURE_KEY,
  );
  if (!valid) {
    return new Response('Signature verification failed', { status: 400 });
  }

  let event: SquareEventEnvelope;
  try {
    event = JSON.parse(rawBody) as SquareEventEnvelope;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Only payment.updated matters for completing orders
  if (event.type !== 'payment.updated') {
    return new Response(
      JSON.stringify({ ok: true, ignored: event.type }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  const payment = event.data?.object?.payment;
  if (!payment) return new Response('No payment in event', { status: 400 });

  // We only act on COMPLETED payments. Square fires payment.updated for
  // many transitions (APPROVED, COMPLETED, FAILED, etc.).
  if (payment.status !== 'COMPLETED') {
    return new Response(
      JSON.stringify({ ok: true, skipped: 'not COMPLETED', actualStatus: payment.status }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  const squareOrderId = payment.order_id;
  if (!squareOrderId) {
    return new Response('Payment missing order_id', { status: 400 });
  }

  // Resolve our token via the Square Orders API
  const envName: 'production' | 'sandbox' =
    env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';
  const token = await lookupOrderToken(env.SQUARE_ACCESS_TOKEN, envName, squareOrderId);
  if (!token) return new Response('Could not resolve order token', { status: 404 });

  const raw = await env.DESIGN_DRAFTS.get(token);
  if (!raw) return new Response('Order not found in KV', { status: 404 });

  let order: Record<string, unknown> & {
    orderId?: string;
    status?: string;
    customer?: { name: string; email: string };
    album?: SmartOrderEmailData['album'];
    albumName?: string;
    shipping?: SmartOrderEmailData['shipping'];
    photos?: SmartOrderEmailData['photos'];
    spreads?: SmartOrderEmailData['spreads'];
    spreadComposites?: SmartOrderEmailData['spreadComposites'];
    polishHandoff?: boolean;
    proofApproval?: SmartOrderEmailData['proofApproval'];
    contentRights?: SmartOrderEmailData['contentRights'];
    lowResPhotos?: SmartOrderEmailData['lowResPhotos'];
    auditClientIp?: string | null;
    auditUserAgent?: string | null;
  };
  try {
    order = JSON.parse(raw);
  } catch {
    return new Response('Order record corrupt', { status: 500 });
  }

  // Idempotent — Square retries on 5xx, so we must not re-fire emails.
  if (order.status === 'paid') {
    return new Response(
      JSON.stringify({ ok: true, alreadyPaid: true, orderId: order.orderId }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  const paidAt = new Date().toISOString();
  const updated = {
    ...order,
    status: 'paid' as const,
    paidAt,
    squarePaymentId: payment.id ?? null,
    squareReceiptUrl: payment.receipt_url ?? null,
    squareAmountTotalCents: payment.amount_money?.amount ?? null,
  };
  await env.DESIGN_DRAFTS.put(token, JSON.stringify(updated), {
    expirationTtl: SUBMITTED_TTL_SECONDS,
  });

  // Patch the orders index entry
  try {
    const indexRaw = await env.DESIGN_DRAFTS.get(ORDERS_INDEX_KEY);
    if (indexRaw) {
      const index = JSON.parse(indexRaw) as Array<Record<string, unknown>>;
      const idx = index.findIndex((e) => e.token === token);
      if (idx >= 0) {
        index[idx] = {
          ...index[idx],
          status: 'paid',
          paidAt,
          squarePaymentId: payment.id,
        };
        await env.DESIGN_DRAFTS.put(ORDERS_INDEX_KEY, JSON.stringify(index));
      }
    }
  } catch (e) {
    console.warn('[square-webhook] index update failed', e);
  }

  // Confirmation emails (best-effort)
  const ownerEmail = env.OWNER_EMAIL || DEFAULT_OWNER;
  const fromEmail = env.ORDER_FROM_EMAIL || DEFAULT_FROM;
  let ownerEmailSent = false;
  let customerEmailSent = false;

  if (env.RESEND_API_KEY && order.customer && order.album && order.photos && order.spreads) {
    const emailData: SmartOrderEmailData = {
      orderId: order.orderId ?? token,
      albumName: order.albumName ?? 'Album',
      customer: order.customer,
      shipping: order.shipping ?? {
        recipientName: '',
        phone: '',
        line1: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
      album: order.album,
      photos: order.photos,
      spreads: order.spreads,
      spreadComposites: order.spreadComposites,
      polishHandoff: order.polishHandoff ?? false,
      proofApproval: order.proofApproval,
      contentRights: order.contentRights,
      lowResPhotos: order.lowResPhotos,
    };
    const auditMeta = {
      clientIp: order.auditClientIp ?? null,
      userAgent: order.auditUserAgent ?? null,
      paidAt,
      stripeSessionId: undefined,
      stripePaymentIntent: payment.id ?? undefined,
    };

    const ownerResult = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [ownerEmail],
      subject: `[PAID] ${emailData.orderId} — ${emailData.customer.name} · $${emailData.album.totalPrice}`,
      html: ownerPaidEmailHtml(emailData, siteUrl, auditMeta),
    });
    ownerEmailSent = ownerResult.ok;

    const customerResult = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [emailData.customer.email],
      subject: `Your album order ${emailData.orderId} is confirmed`,
      html: customerPaidEmailHtml(emailData, siteUrl),
    });
    customerEmailSent = customerResult.ok;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      orderId: order.orderId,
      paid: true,
      ownerEmailSent,
      customerEmailSent,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
