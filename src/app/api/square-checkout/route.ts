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
import { magazineTotal } from '@/lib/magazine/pricing';

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
  magazine?: { styleName: string; names?: string; price: number; shippingUsd: number };
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
  const token = body.token;
  if (!token) return err(400, 'Missing token');

  const { env } = getRequestContext() as { env: Env };
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return err(500, 'Square not configured');
  }
  if (!env.DESIGN_DRAFTS) return err(500, 'Storage not configured');

  const raw = await env.DESIGN_DRAFTS.get(token);
  if (!raw) return err(404, 'Order not found');

  let order: StoredOrder;
  try {
    order = JSON.parse(raw) as StoredOrder;
  } catch {
    return err(500, 'Order record corrupt');
  }

  if (order.status === 'paid') return err(409, 'Order already paid');

  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  // The token is the secret order key; including it in the success URL is
  // equivalent to handing the customer their receipt URL.
  const successUrl = `${siteUrl}/design/${order.mode === 'magazine' ? 'magazine' : 'smart'}/success?token=${encodeURIComponent(order.token)}&order=${encodeURIComponent(order.orderId)}`;

  // ── Magazine: price comes from the SERVER (pricing.ts), never the client.
  let magazineItems: { name: string; quantity: number; basePriceAmountCents: number; note?: string }[] | null = null;
  if (order.mode === 'magazine') {
    const { price, shippingUsd } = magazineTotal(env);
    magazineItems = [
      {
        name: `Wedding magazine · ${order.magazine?.styleName ?? 'Custom'} · 20 pages (8.5×11)`,
        quantity: 1,
        basePriceAmountCents: Math.round(price * 100),
        note: order.magazine?.names || order.albumName,
      },
    ];
    if (shippingUsd > 0) {
      magazineItems.push({ name: 'Shipping', quantity: 1, basePriceAmountCents: Math.round(shippingUsd * 100), note: 'Magazine delivery' });
    }
  }

  // album.totalPrice INCLUDES polish hand-off + cover add-on. Split
  // them out so the customer sees itemised line items at checkout.
  const polishHandoff = !!order.polishHandoff;
  const coverAdd =
    order.cover && Number.isFinite(order.cover.priceAdd)
      ? Math.max(0, Math.round(order.cover.priceAdd))
      : 0;
  const baseDollars =
    order.album.totalPrice - (polishHandoff ? 99 : 0) - coverAdd;
  if (!magazineItems && (baseDollars <= 0 || !Number.isFinite(baseDollars))) {
    return err(500, 'Invalid album price');
  }
  const sizeLabel = order.album.size.replace('x', '×');
  const bindingLabel = order.album.type === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)';

  const lineItems = magazineItems ?? [
    {
      name: `${sizeLabel} ${bindingLabel} · ${order.album.pageCount} spreads`,
      quantity: 1,
      basePriceAmountCents: baseDollars * 100,
      note: order.albumName,
    },
  ];
  if (!magazineItems && coverAdd > 0 && order.cover) {
    const cl =
      order.cover.type === 'leather'
        ? 'Leather cover — premium hide + foil stamp'
        : order.cover.type === 'acrylic'
        ? 'Acrylic cover — photo behind clear acrylic'
        : 'Photo cover';
    lineItems.push({
      name: cl,
      quantity: 1,
      basePriceAmountCents: coverAdd * 100,
      note: 'Album cover upgrade',
    });
  }
  if (!magazineItems && polishHandoff) {
    lineItems.push({
      name: 'Polish hand-off — design team finishing',
      quantity: 1,
      basePriceAmountCents: 9900,
      note: 'Hand-finishing by Folio Forever design team before printing',
    });
  }

  const envName: 'production' | 'sandbox' =
    env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';

  const result = await createSquareCheckoutLink({
    accessToken: env.SQUARE_ACCESS_TOKEN,
    locationId: env.SQUARE_LOCATION_ID,
    envName,
    // Token is already a 12-hex random; collisions impossible at our volume.
    idempotencyKey: `checkout_${order.token}`,
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
    return err(502, `Square error: ${result.error || 'unknown'}`);
  }

  // Annotate the order with the Square IDs so the webhook + admin can
  // correlate (and so the admin can re-link the customer to their
  // payment page if they bail and come back).
  try {
    const updated = {
      ...order,
      squarePaymentLinkId: result.paymentLinkId,
      squareOrderId: result.orderId,
      squareCheckoutUrl: result.url,
      squareCheckoutCreatedAt: new Date().toISOString(),
    };
    await env.DESIGN_DRAFTS.put(token, JSON.stringify(updated), { expirationTtl: 365 * 24 * 60 * 60 });
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
  if (order.squareCheckoutUrl) return Response.redirect(order.squareCheckoutUrl, 302);

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
