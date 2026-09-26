/**
 * POST /api/square-checkout
 *
 * Builds a Square Payment Link for a PENDING_PAYMENT order written
 * earlier by /api/submit-smart-order. Returns the hosted-checkout URL
 * for the wizard to redirect to.
 *
 * Body: { token: string }
 * Returns: { ok, url, paymentLinkId, squareOrderId }
 *
 * On success the order's KV record is updated with:
 *   - squarePaymentLinkId
 *   - squareOrderId
 *   - squareCheckoutCreatedAt
 *
 * Env vars:
 *   SQUARE_ACCESS_TOKEN
 *   SQUARE_LOCATION_ID
 *   SQUARE_ENV          "production" (default) or "sandbox"
 *   SITE_URL            for success/cancel URLs
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createSquareCheckoutLink } from '@/lib/square';
import { ORDER_SOURCE } from '@/lib/pricing';
import { allowRequest, tooMany } from '@/lib/rate-limit';
import { getShipping, shippingText } from '@/lib/shipping';

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
  SQUARE_LOCATION_ID?: string;
  SQUARE_ENV?: string;
  SITE_URL?: string;
  MAGAZINE_SHIPPING_USD?: string;
}

interface StoredOrder {
  mode: 'smart' | 'manual' | 'magazine';
  magazine?: { styleName: string; names?: string; price: number; shippingUsd: number; shippingLabel?: string };
  /** Albums: delivery option chosen at checkout (price re-derived here). */
  shippingMethod?: string;
  shippingUsd?: number;
  orderId: string;
  token: string;
  status: string;
  albumName: string;
  customer: { name: string; email: string };
  album: {
    size: string;
    type: 'standard' | 'layflat';
    pageCount: number;
    totalPrice: number;
  };
  polishHandoff?: boolean;
  cover?: {
    type: 'leather' | 'acrylic' | 'photo';
    priceAdd: number;
  } | null;
  [key: string]: unknown;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return err(400, 'Invalid JSON');
  }
  const token = String(body.token ?? '');
  if (!/^[a-f0-9]{8,64}$/i.test(token)) return err(400, 'Missing token');

  const { env } = getRequestContext() as { env: Env };
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return err(500, 'Square not configured');
  }
  if (!env.DESIGN_DRAFTS) return err(500, 'Storage not configured');
  if (!(await allowRequest(env.DESIGN_DRAFTS, request, 'checkout', 20, 600))) return tooMany();

  const raw = await env.DESIGN_DRAFTS.get(token);
  if (!raw) return err(404, 'Order not found');

  let order: StoredOrder;
  try {
    order = JSON.parse(raw) as StoredOrder;
  } catch {
    return err(500, 'Order record corrupt');
  }

  // Only REAL orders written by the submit routes can be paid, and only
  // while they're still unpaid. (Saved drafts can never carry this marker.)
  const pricing = order.pricing as
    | { expectedCents?: number; albumUsd?: number; coverUsd?: number; polishUsd?: number; magazineUsd?: number; shippingUsd?: number; shippingId?: string }
    | undefined;
  if (order.orderSource !== ORDER_SOURCE || !pricing || !Number.isInteger(pricing.expectedCents) || (pricing.expectedCents ?? 0) <= 0) {
    return err(404, 'Order not found');
  }
  if (order.status !== 'pending_payment') {
    return err(409, order.status === 'cancelled' ? 'This order was cancelled' : 'Order already paid');
  }
  const expectedCents = pricing.expectedCents as number;

  // Re-use the link we already made for this exact amount (one link per
  // order — no stray payable links floating around).
  if (typeof order.squareCheckoutUrl === 'string' && order.squareCheckoutCents === expectedCents) {
    return new Response(JSON.stringify({ ok: true, url: order.squareCheckoutUrl, reused: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  // The token is the secret order key; including it in the success URL is
  // equivalent to handing the customer their receipt URL.
  const successUrl = `${siteUrl}/design/${order.mode === 'magazine' ? 'magazine' : 'smart'}/success?token=${encodeURIComponent(order.token)}&order=${encodeURIComponent(order.orderId)}`;

  // ── Line items come ONLY from the server-computed pricing on the order.
  const cents = (usd: number | undefined) => Math.round(Number(usd ?? 0) * 100);
  const ship = getShipping(pricing.shippingId);
  const lineItems: { name: string; quantity: number; basePriceAmountCents: number; note?: string }[] = [];
  if (order.mode === 'magazine') {
    lineItems.push({
      name: `Wedding magazine · ${order.magazine?.styleName ?? 'Custom'} · 20 pages (8.5×11)`,
      quantity: 1,
      basePriceAmountCents: cents(pricing.magazineUsd),
      note: order.magazine?.names || order.albumName,
    });
  } else {
    const sizeLabel = String(order.album?.size ?? '').replace('x', '×');
    const bindingLabel = order.album?.type === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)';
    lineItems.push({
      name: `${sizeLabel} ${bindingLabel} · ${order.album?.pageCount ?? ''} spreads`,
      quantity: 1,
      basePriceAmountCents: cents(pricing.albumUsd),
      note: order.albumName,
    });
    if ((pricing.coverUsd ?? 0) > 0 && order.cover) {
      lineItems.push({
        name:
          order.cover.type === 'leather'
            ? 'Leather cover — premium hide + foil stamp'
            : order.cover.type === 'acrylic'
              ? 'Acrylic cover — photo behind clear acrylic'
              : 'Photo cover',
        quantity: 1,
        basePriceAmountCents: cents(pricing.coverUsd),
        note: 'Album cover upgrade',
      });
    }
    if ((pricing.polishUsd ?? 0) > 0) {
      lineItems.push({
        name: 'Polish hand-off — design team finishing',
        quantity: 1,
        basePriceAmountCents: cents(pricing.polishUsd),
        note: 'Hand-finishing by Folio Forever design team before printing',
      });
    }
  }
  if ((pricing.shippingUsd ?? 0) > 0) {
    lineItems.push({
      name: `Shipping · ${shippingText(ship)}`,
      quantity: 1,
      basePriceAmountCents: cents(pricing.shippingUsd),
      note: order.mode === 'magazine' ? 'Magazine delivery' : 'Album delivery',
    });
  }
  const sum = lineItems.reduce((a, li) => a + li.basePriceAmountCents * li.quantity, 0);
  if (sum !== expectedCents || lineItems.some((li) => !Number.isInteger(li.basePriceAmountCents) || li.basePriceAmountCents <= 0)) {
    console.warn('[square-checkout] line items do not add up', { token, sum, expectedCents });
    return err(500, 'Order total could not be verified — please contact us');
  }

  const envName: 'production' | 'sandbox' =
    env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';

  const result = await createSquareCheckoutLink({
    accessToken: env.SQUARE_ACCESS_TOKEN,
    locationId: env.SQUARE_LOCATION_ID,
    envName,
    // Keyed on the amount too, so a changed total can never reuse an old link.
    idempotencyKey: `checkout_${order.token}_${expectedCents}`,
    lineItems,
    prePopulatedEmail: order.customer.email,
    redirectUrl: successUrl,
    description: `${order.orderId} — ${order.customer.name}`,
    paymentNote: order.albumName,
    metadata: {
      token: order.token,
      orderId: order.orderId,
      mode: order.mode,
    },
  });

  if (!result.ok || !result.url) {
    console.warn('[square-checkout] Square error', result.error);
    return err(502, 'Payment could not be started — please try again in a moment');
  }

  // Annotate the order with the Square IDs so the webhook + admin can
  // correlate (and so the customer can be sent back to the same link).
  try {
    const updated = {
      ...order,
      squarePaymentLinkId: result.paymentLinkId,
      squareOrderId: result.orderId,
      squareCheckoutUrl: result.url,
      squareCheckoutCents: expectedCents,
      squareCheckoutCreatedAt: new Date().toISOString(),
    };
    await env.DESIGN_DRAFTS.put(token, JSON.stringify(updated));
  } catch {
    // Non-fatal — the link works regardless.
  }

  return new Response(
    JSON.stringify({
      ok: true,
      url: result.url,
      paymentLinkId: result.paymentLinkId,
      squareOrderId: result.orderId,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * GET /api/square-checkout?token=… — the "Complete payment" button in the
 * client's order-received email. Opens the Square payment page (re-using
 * the existing link when there is one), or shows a friendly page when the
 * order is already paid / payment isn't available yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') ?? '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
  const { env } = getRequestContext() as { env: Env };
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');

  const page = (title: string, body: string, status = 200) =>
    new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
        `<body style="margin:0;background:#0e0c09;color:#f5f0e8;font-family:Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">` +
        `<div style="max-width:520px;text-align:center"><div style="letter-spacing:5px;font-size:11px;color:#b8965a">FOLIO FOREVER</div>` +
        `<h1 style="font-weight:300;font-size:32px;margin:18px 0 10px">${title}</h1><p style="color:#bfb3a0;font:14px/1.7 Arial,sans-serif">${body}</p>` +
        `<p style="margin-top:26px"><a href="${siteUrl}" style="color:#b8965a;font:12px Arial,sans-serif;letter-spacing:2px">FOLIOFOREVER.COM</a></p></div></body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );

  if (!token || !env.DESIGN_DRAFTS) return page('Link not valid', 'This payment link is incomplete. Please reply to your order email and we will help.', 400);
  const raw = await env.DESIGN_DRAFTS.get(token);
  if (!raw) return page('Order not found', 'We could not find this order. Please reply to your order email and we will help.', 404);
  let order: StoredOrder & { squareCheckoutUrl?: string; status?: string };
  try {
    order = JSON.parse(raw);
  } catch {
    return page('Something went wrong', 'Please reply to your order email and we will help.', 500);
  }
  const paidLike = ['paid', 'in_design', 'in_production', 'shipped', 'delivered', 'refunded'];
  if (order.status && paidLike.includes(order.status)) {
    return page('Already paid — thank you!', `Order <strong>${order.orderId}</strong> is paid. We will email you when it ships.`);
  }
  if (order.status === 'cancelled') {
    return page('Order cancelled', `Order <strong>${order.orderId}</strong> was cancelled. Reply to your order email if this is a mistake.`);
  }

  const res = await POST(
    new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  );
  const j = (await res.json().catch(() => ({}))) as { url?: string };
  if (res.ok && j.url) return Response.redirect(j.url, 302);
  return page(
    'Payment isn’t open yet',
    `Your order <strong>${order.orderId}</strong> is saved. Online payment isn’t available right this moment — we will email you a payment link shortly, or just reply to your order email.`,
    503,
  );
}
