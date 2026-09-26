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
import { patchIndexEntry, type IndexKV } from '@/lib/order-index';
import { customerMagazineEmailHtml, ownerMagazineEmailHtml, type MagazineOrderEmail } from '@/lib/magazine/emails';
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

const DEFAULT_FROM = 'Folio Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';

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

  // FAILED / CANCELED attempts: the order stays "payment not clear"; we
  // just record the attempt so the admin can see what happened.
  if ((payment.status === 'FAILED' || payment.status === 'CANCELED') && payment.order_id && env.SQUARE_ACCESS_TOKEN && env.DESIGN_DRAFTS) {
    try {
      const envName0: 'production' | 'sandbox' = env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';
      const tok = await lookupOrderToken(env.SQUARE_ACCESS_TOKEN, envName0, payment.order_id);
      const raw0 = tok ? await env.DESIGN_DRAFTS.get(tok) : null;
      if (tok && raw0) {
        const rec = JSON.parse(raw0) as Record<string, unknown> & { status?: string };
        if (rec.status === 'pending_payment') {
          const issue = { status: payment.status, at: new Date().toISOString() };
          await env.DESIGN_DRAFTS.put(tok, JSON.stringify({ ...rec, paymentIssue: issue }));
          await patchIndexEntry(env.DESIGN_DRAFTS as unknown as IndexKV, tok, { paymentIssue: issue });
        }
      }
    } catch (e) {
      console.warn('[square-webhook] could not record failed payment', e);
    }
    return new Response(JSON.stringify({ ok: true, recorded: payment.status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  const ownerEmail = env.OWNER_EMAIL || DEFAULT_OWNER;
  const fromEmail = env.ORDER_FROM_EMAIL || DEFAULT_FROM;
  const kvIdx = env.DESIGN_DRAFTS as unknown as IndexKV;
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
  const alertOwner = async (subject: string, lines: string[]) => {
    if (!env.RESEND_API_KEY) return;
    await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [ownerEmail],
      subject,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${lines.map((l) => `<p>${l}</p>`).join('')}<p><a href="${siteUrl}/admin/orders/${token}">Open the order in admin →</a></p></div>`,
    }).catch(() => undefined);
  };
  const amountCents = typeof payment.amount_money?.amount === 'number' ? payment.amount_money.amount : null;
  const currency = payment.amount_money?.currency ?? null;

  // Idempotent: this exact payment was already handled (Square retries,
  // and a REFUND re-sends payment.updated with status still COMPLETED).
  // Never flip the order back to "paid" or re-send emails.
  if (payment.id && order.squarePaymentId === payment.id) {
    return json({ ok: true, alreadyHandled: true, orderId: order.orderId });
  }

  // A DIFFERENT completed payment for an order that isn't waiting for
  // payment (already paid, cancelled, refunded…): keep the status, record
  // it and alert the owner so the extra charge can be refunded.
  if (order.status !== 'pending_payment') {
    const extra = Array.isArray(order.extraPayments) ? (order.extraPayments as Array<{ id?: string }>) : [];
    if (!extra.some((x) => x.id === payment.id)) {
      extra.push({ id: payment.id, amountCents, currency, at: new Date().toISOString() } as { id?: string });
      await env.DESIGN_DRAFTS.put(token, JSON.stringify({ ...order, extraPayments: extra }));
      await alertOwner(`[CHECK] Extra payment on ${order.orderId} — order status is "${order.status}"`, [
        `Square received another payment of <b>$${((amountCents ?? 0) / 100).toFixed(2)}</b> (payment ${payment.id}) for order <b>${order.orderId}</b>, which is already <b>${order.status}</b>.`,
        'The order was NOT changed. If this is a duplicate charge, refund it in Square.',
      ]);
    }
    return json({ ok: true, extraPayment: true, orderId: order.orderId });
  }

  // ── Amount check: the charge must equal the server-computed total ──
  const pricing = (order.pricing ?? {}) as { expectedCents?: number };
  const expected = Number.isInteger(pricing.expectedCents) ? (pricing.expectedCents as number) : null;
  if (expected === null || amountCents !== expected || (currency && currency !== 'USD')) {
    const at = new Date().toISOString();
    await env.DESIGN_DRAFTS.put(
      token,
      JSON.stringify({
        ...order,
        status: 'payment_mismatch',
        squarePaymentId: payment.id ?? null,
        squareAmountTotalCents: amountCents,
        paymentMismatch: { expectedCents: expected, amountCents, currency, at },
        junk: false,
      }),
    );
    await patchIndexEntry(kvIdx, token, { status: 'payment_mismatch', squarePaymentId: payment.id, junk: false, junkAt: undefined });
    await alertOwner(`[CHECK] Payment amount mismatch — ${order.orderId}`, [
      `Square charged <b>${amountCents === null ? 'an unknown amount' : '$' + (amountCents / 100).toFixed(2)}</b>${currency ? ' ' + currency : ''} for order <b>${order.orderId}</b>, but the order total is <b>${expected === null ? 'unknown (older order)' : '$' + (expected / 100).toFixed(2)}</b>.`,
      'The order is marked "Payment check needed" and was NOT sent to production. Check it in Square before printing.',
    ]);
    return json({ ok: true, mismatch: true, orderId: order.orderId });
  }

  const paidAt = new Date().toISOString();
  const updated = {
    ...order,
    status: 'paid' as const,
    paidAt,
    squarePaymentId: payment.id ?? null,
    squareReceiptUrl: payment.receipt_url ?? null,
    squareAmountTotalCents: amountCents,
    // A late payment brings an auto-junked (stale unpaid) order back.
    junk: false,
    junkAt: undefined,
  };
  await env.DESIGN_DRAFTS.put(token, JSON.stringify(updated));
  try {
    await patchIndexEntry(kvIdx, token, { status: 'paid', paidAt, squarePaymentId: payment.id, amountPaidCents: amountCents, junk: false, junkAt: undefined });
  } catch (e) {
    console.warn('[square-webhook] index update failed', e);
  }

  // Confirmation emails (best-effort)
  let ownerEmailSent = false;
  let customerEmailSent = false;

  // ── Magazine orders have their own (simpler) emails ──
  if (env.RESEND_API_KEY && order.mode === 'magazine' && order.customer) {
    const mag = (order.magazine ?? {}) as { styleName?: string; names?: string; date?: string; price?: number; shippingUsd?: number; shippingLabel?: string };
    const data: MagazineOrderEmail = {
      orderId: order.orderId ?? token,
      styleName: mag.styleName ?? 'Magazine',
      names: mag.names ?? '',
      date: mag.date ?? '',
      customer: order.customer,
      shipping: order.shipping as MagazineOrderEmail['shipping'],
      price: mag.price ?? 70,
      shippingUsd: mag.shippingUsd ?? 0,
      shippingLabel: mag.shippingLabel,
      pages: (order.spreadComposites ?? []).map((c) => ({ url: c.url })),
    };
    const o = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [ownerEmail],
      subject: `[PAID] ${data.orderId} — ${data.customer.name} · Magazine ${data.styleName}`,
      html: ownerMagazineEmailHtml(data, siteUrl, 'paid'),
    });
    ownerEmailSent = o.ok;
    const c = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [data.customer.email],
      subject: `Your wedding magazine order ${data.orderId} is confirmed`,
      html: customerMagazineEmailHtml(data, siteUrl),
    });
    customerEmailSent = c.ok;
  }

  if (env.RESEND_API_KEY && order.mode !== 'magazine' && order.customer && order.album && order.photos && order.spreads) {
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

  // Remember whether the emails went out (shown in admin; lets you resend).
  try {
    await env.DESIGN_DRAFTS.put(token, JSON.stringify({ ...updated, paidEmails: { ownerEmailSent, customerEmailSent, at: new Date().toISOString() } }));
  } catch {
    /* non-fatal */
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
