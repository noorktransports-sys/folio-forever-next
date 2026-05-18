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
}

interface StoredOrder {
  mode: 'smart' | 'manual';
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
  const successUrl = `${siteUrl}/design/smart/success?token=${encodeURIComponent(order.token)}&order=${encodeURIComponent(order.orderId)}`;

  // album.totalPrice INCLUDES polish hand-off. Split for line items.
  const polishHandoff = !!order.polishHandoff;
  const baseDollars = order.album.totalPrice - (polishHandoff ? 99 : 0);
  if (baseDollars <= 0 || !Number.isFinite(baseDollars)) {
    return err(500, 'Invalid album price');
  }
  const sizeLabel = order.album.size.replace('x', '×');
  const bindingLabel = order.album.type === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)';

  const lineItems = [
    {
      name: `${sizeLabel} ${bindingLabel} · ${order.album.pageCount} spreads`,
      quantity: 1,
      basePriceAmountCents: baseDollars * 100,
      note: order.albumName,
    },
  ];
  if (polishHandoff) {
    lineItems.push({
      name: 'Polish hand-off — design team finishing',
      quantity: 1,
      basePriceAmountCents: 9900,
      note: 'Hand-finishing by Folio & Forever design team before printing',
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
