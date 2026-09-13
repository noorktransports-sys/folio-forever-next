// src/lib/square.ts
//
// Tiny Square REST client for the operations we need:
//   • createCheckoutLink — hosted payment page (Square's equivalent of
//     Stripe Checkout). Customer pays on squareup.com / our subdomain,
//     redirects back to our success URL on completion.
//   • refundPayment       — full or partial refund of a captured payment
//   • verifyWebhookSignature — Square's HMAC-SHA256 + URL prefix scheme
//
// No SDK — Square's official Node SDK pulls in a bunch of polyfills that
// don't fly on Cloudflare's edge runtime. Raw fetch is portable, the API
// surface is small.
//
// Env vars consumed by the route handlers (not this lib directly):
//   SQUARE_ACCESS_TOKEN         — production or sandbox access token
//   SQUARE_LOCATION_ID          — the location to attribute payments to
//   SQUARE_WEBHOOK_SIGNATURE_KEY — webhook signing key
//   SQUARE_ENV                  — "production" (default) or "sandbox"

const SQUARE_API_VERSION = '2024-12-18';

function squareApiBase(envName: 'production' | 'sandbox' = 'production'): string {
  return envName === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

interface SquareError {
  category?: string;
  code?: string;
  detail?: string;
  field?: string;
}

interface SquareErrorResponse {
  errors?: SquareError[];
}

/** Helper to mint a unique idempotency key. Square requires one on every
 *  mutating call so retries don't double-charge / double-refund. */
function mintIdempotencyKey(prefix: string): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now()}_${hex}`;
}

/* ─── Create Checkout Link ────────────────────────────────────────────
 *
 * Square's "Payment Link" feature (was Checkout API v2 before; same
 * thing under the hood). One call, returns a hosted URL. Customer pays
 * there, gets redirected to our success URL. Cheaper than rolling our
 * own card form. Includes Apple Pay / Google Pay / Cash App where
 * available.
 *
 * https://developer.squareup.com/reference/square/checkout-api/create-payment-link
 */

export interface SquareLineItem {
  name: string;
  quantity: number;
  basePriceAmountCents: number; // integer cents
  note?: string;
}

export interface CreateCheckoutLinkInput {
  accessToken: string;
  locationId: string;
  envName?: 'production' | 'sandbox';
  /** Unique per attempt — the order token works (collisions impossible). */
  idempotencyKey: string;
  /** Goes into the link's `order` object. Customer sees this on the
   *  Square page. */
  lineItems: SquareLineItem[];
  /** Customer's email — pre-fills the checkout form. */
  prePopulatedEmail?: string;
  /** Where Square redirects after success. Include order token in the
   *  query string so our success page knows what to render. */
  redirectUrl: string;
  /** Stored on the Square order; visible in the Square dashboard.
   *  We put the customer name / order id here for human reference. */
  description?: string;
  /** Maps onto Square's `payment_note` and ends up on the receipt + the
   *  webhook event payload. */
  paymentNote?: string;
  /** Optional metadata attached to the order. Limit: 8KB. Each value <255 chars.
   *  We stash our token + orderId here so the webhook can find the order. */
  metadata?: Record<string, string>;
}

export interface CreateCheckoutLinkResult {
  ok: boolean;
  url?: string;
  paymentLinkId?: string;
  orderId?: string;
  error?: string;
}

export async function createSquareCheckoutLink(
  input: CreateCheckoutLinkInput,
): Promise<CreateCheckoutLinkResult> {
  const base = squareApiBase(input.envName ?? 'production');
  const body = {
    idempotency_key: input.idempotencyKey,
    quick_pay: undefined,
    order: {
      location_id: input.locationId,
      line_items: input.lineItems.map((li) => ({
        name: li.name,
        quantity: String(li.quantity),
        base_price_money: { amount: li.basePriceAmountCents, currency: 'USD' },
        note: li.note,
      })),
      // Square requires reference_id <= 40 chars; we'll use the order token.
      reference_id: input.metadata?.token?.slice(0, 40),
      metadata: input.metadata,
    },
    pre_populated_data: input.prePopulatedEmail
      ? { buyer_email: input.prePopulatedEmail }
      : undefined,
    checkout_options: {
      redirect_url: input.redirectUrl,
      ask_for_shipping_address: false,
      accepted_payment_methods: {
        apple_pay: true,
        google_pay: true,
        cash_app: true,
        afterpay_clearpay: false,
      },
      merchant_support_email: 'orders@folioforever.com',
    },
    description: input.description,
    payment_note: input.paymentNote,
  };

  const r = await fetch(`${base}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Square-Version': SQUARE_API_VERSION,
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as {
    payment_link?: {
      id?: string;
      url?: string;
      order_id?: string;
    };
  } & SquareErrorResponse;
  if (!r.ok || !j.payment_link?.url) {
    const detail = j.errors?.map((e) => e.detail || e.code).join('; ') || r.statusText;
    return { ok: false, error: detail };
  }
  return {
    ok: true,
    url: j.payment_link.url,
    paymentLinkId: j.payment_link.id,
    orderId: j.payment_link.order_id,
  };
}

/* ─── Refund a payment ─────────────────────────────────────────────────
 *
 * We capture `payment_id` from the webhook (event payload contains the
 * payment that was created). To refund, POST to /v2/refunds with the
 * payment_id and the amount.
 *
 * For a full refund pass the full amount in cents; for partial pass less.
 *
 * https://developer.squareup.com/reference/square/refunds-api/refund-payment
 */

export interface RefundPaymentInput {
  accessToken: string;
  envName?: 'production' | 'sandbox';
  idempotencyKey: string;
  paymentId: string;
  amountCents: number;
  reason?: string;
}

export interface RefundPaymentResult {
  ok: boolean;
  refundId?: string;
  status?: string;
  error?: string;
}

export async function refundSquarePayment(
  input: RefundPaymentInput,
): Promise<RefundPaymentResult> {
  const base = squareApiBase(input.envName ?? 'production');
  const body = {
    idempotency_key: input.idempotencyKey,
    payment_id: input.paymentId,
    amount_money: { amount: input.amountCents, currency: 'USD' },
    reason: input.reason?.slice(0, 192),
  };
  const r = await fetch(`${base}/v2/refunds`, {
    method: 'POST',
    headers: {
      'Square-Version': SQUARE_API_VERSION,
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as {
    refund?: { id?: string; status?: string };
  } & SquareErrorResponse;
  if (!r.ok || !j.refund?.id) {
    const detail = j.errors?.map((e) => e.detail || e.code).join('; ') || r.statusText;
    return { ok: false, error: detail };
  }
  return { ok: true, refundId: j.refund.id, status: j.refund.status };
}

/* ─── Webhook signature verification ──────────────────────────────────
 *
 * Square's notification signature scheme:
 *   • Header:   `x-square-hmacsha256-signature`
 *   • Algorithm: HMAC-SHA256 of `${notification_url}${request_body}`,
 *                base64 encoded
 *   • Compare base64-decoded sig with our computed HMAC bytes (constant-time)
 *
 * `notification_url` is the EXACT URL Square is configured to POST to —
 * we pass it in as a constant so we don't have to infer it from
 * request.url (which can include the wrong protocol behind a proxy).
 *
 * https://developer.squareup.com/docs/webhooks/step3validate
 */

export async function verifySquareWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  notificationUrl: string,
  signatureKey: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${notificationUrl}${rawBody}`),
  );
  // Convert computed to base64 (Square sends base64)
  const computedBase64 = bufferToBase64(sigBuf);
  // Constant-time compare (the strings are the same length when valid)
  return timingSafeStringEqual(computedBase64, signatureHeader);
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export { mintIdempotencyKey };
