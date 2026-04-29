/**
 * /api/submit-order — the commit point for an album order.
 *
 * Flow:
 *   1. Customer designs in /design
 *   2. Cover-step Continue auto-saves to /api/designs and redirects them
 *      to /album/<token> (the viewer = the preview).
 *   3. Customer reviews, clicks Submit album on the end card.
 *   4. That click hits this endpoint, which:
 *        - reads the design from KV
 *        - re-saves it with status='submitted', submittedAt=<iso>
 *          (TTL extended to a year — submitted orders are real records,
 *          not 60-day drafts)
 *        - fires /api/notify-order in 'order' mode → owner inbox + customer
 *          confirmation
 *        - returns { ok, orderId, alreadySubmitted? }
 *
 * Idempotent: a second submit on an already-submitted token does NOT
 * re-fire emails. The viewer locks as soon as status==='submitted', so
 * users shouldn't be able to double-submit, but we belt-and-brace it
 * here in case the lock UI didn't render in time.
 *
 * Stripe wiring lands later: when payment is required, this endpoint
 * will be replaced (or fronted by) /api/checkout that returns a Stripe
 * Checkout URL, and the actual KV write + owner email will move to
 * the stripe-webhook on checkout.session.completed. The contract this
 * route exposes (token in → orderId out + side-effects) is the same.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const SUBMITTED_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

// Special KV key — holds a JSON array of every submitted-order summary
// so the admin dashboard can list them without scanning the whole KV.
// We append on each successful submit. Rare race window if two orders
// land in the same millisecond; acceptable at our volume.
const ORDERS_INDEX_KEY = '_orders_index_v1';
interface IndexEntry {
  token: string;
  orderId: string;
  customerName: string;
  customerEmail: string;
  size: string;
  totalSpreads: number;
  photoCount: number;
  submittedAt: string;
  status?: string;
  paid?: boolean;
  amountPaid?: number;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  SITE_URL?: string;
}

interface SavedDesign {
  status?: string;
  submittedAt?: string;
  orderId?: string;
  customer?: { email?: string; name?: string } | null;
  shipping?: ShippingPayload | null;
  photographerId?: string;
  [k: string]: unknown;
}

// Shipping data captured by the customer-side ShippingForm modal
// before they confirm submit. Stored alongside the design so admin
// can read it without an extra round-trip.
interface ShippingPayload {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes?: string;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'design storage unavailable');

  let body: { token?: string; shipping?: ShippingPayload };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid JSON body');
  }

  const token = (body.token || '').trim();
  const shipping = body.shipping;
  // Shipping is required for new submissions — without an address we
  // can't ship the album. Existing submitted records retain whatever
  // shipping they had; we only enforce on a fresh submit (handled by
  // the idempotency check below).
  if (!/^[a-f0-9]{8,64}$/i.test(token)) {
    return err(400, 'invalid or missing token');
  }

  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'design not found or expired');

  let design: SavedDesign;
  try {
    design = JSON.parse(json) as SavedDesign;
  } catch {
    return err(500, 'saved design is not valid JSON');
  }

  // Idempotency: if already submitted, return the existing orderId
  // without re-firing emails. The viewer should already show the
  // locked state, but guard against double-clicks / network retries.
  if (design.status === 'submitted' && design.orderId) {
    return new Response(
      JSON.stringify({
        ok: true,
        orderId: design.orderId,
        alreadySubmitted: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Mint an order ID. Ties the share token to a human-friendly invoice
  // string the customer and owner can both reference.
  const orderId =
    'FF-' +
    token.slice(0, 6).toUpperCase() +
    '-' +
    Date.now().toString(36).toUpperCase();

  // Validate the shipping payload — basic required fields.
  if (
    !shipping ||
    !shipping.recipientName?.trim() ||
    !shipping.phone?.trim() ||
    !shipping.line1?.trim() ||
    !shipping.city?.trim() ||
    !shipping.region?.trim() ||
    !shipping.postalCode?.trim() ||
    !shipping.country?.trim()
  ) {
    return err(400, 'shipping address required (name/phone/line1/city/region/postalCode/country)');
  }

  const submittedAt = new Date().toISOString();
  design.status = 'submitted';
  design.submittedAt = submittedAt;
  design.orderId = orderId;
  design.shipping = shipping;

  // Re-save with extended TTL (1 year). Submitted designs are real
  // orders, not drafts that should auto-purge in 60 days.
  await env.DESIGN_DRAFTS.put(token, JSON.stringify(design), {
    expirationTtl: SUBMITTED_TTL_SECONDS,
  });

  // Append to the orders index so the admin dashboard can list
  // submissions chronologically. Read-modify-write — two simultaneous
  // submits in the same millisecond could lose one entry, but at this
  // scale that's a non-issue and the underlying design record is still
  // safely written above.
  try {
    const indexJson = await env.DESIGN_DRAFTS.get(ORDERS_INDEX_KEY);
    const index: IndexEntry[] = indexJson ? JSON.parse(indexJson) : [];
    const customerForIndex = (design.customer || {}) as {
      email?: string;
      name?: string;
    };
    const photos =
      design && (design as { uploadedPhotos?: Record<string, string> })
        .uploadedPhotos;
    const photoCount = photos ? Object.keys(photos).length : 0;
    index.unshift({
      token,
      orderId,
      customerName: customerForIndex.name || '',
      customerEmail: customerForIndex.email || '',
      size: (design as { size?: string }).size || '',
      totalSpreads: (design as { totalSpreads?: number }).totalSpreads || 0,
      photoCount,
      submittedAt,
      status: 'submitted',
      // Payment placeholder — populated later by Stripe webhook.
      paid: false,
      amountPaid: 0,
    });
    await env.DESIGN_DRAFTS.put(ORDERS_INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.warn('Folio submit-order: failed to update orders index', e);
  }

  // Once submitted, drop the design from the drafts index — it's no
  // longer a "lead" since the customer crossed the commit line.
  try {
    const draftsJson = await env.DESIGN_DRAFTS.get('_drafts_index_v1');
    if (draftsJson) {
      const drafts = JSON.parse(draftsJson) as Array<{ token: string }>;
      const filtered = drafts.filter((d) => d.token !== token);
      await env.DESIGN_DRAFTS.put(
        '_drafts_index_v1',
        JSON.stringify(filtered),
      );
    }
  } catch (e) {
    console.warn('Folio submit-order: drafts index cleanup failed', e);
  }

  // If the design was placed by a logged-in photographer, update their
  // album index so /pro dashboard shows the new submitted status +
  // orderId without needing to re-fetch each design's record.
  if (design.photographerId) {
    try {
      const indexKey = `_photographer_${design.photographerId}_albums_v1`;
      const raw = await env.DESIGN_DRAFTS.get(indexKey);
      const list: Array<Record<string, unknown>> = raw ? JSON.parse(raw) : [];
      const i = list.findIndex(
        (e) => (e as { token?: string }).token === token,
      );
      if (i >= 0) {
        list[i].status = 'submitted';
        list[i].orderId = orderId;
        list[i].submittedAt = submittedAt;
      } else {
        // First time we see this token (rare — they submit a design
        // saved by another route). Push a fresh entry.
        list.unshift({
          token,
          orderId,
          customerName: customerForIndex.name || '',
          customerEmail: customerForIndex.email || '',
          size: (design as { size?: string }).size || '',
          totalSpreads: (design as { totalSpreads?: number }).totalSpreads || 0,
          photoCount,
          status: 'submitted',
          submittedAt,
        });
      }
      await env.DESIGN_DRAFTS.put(indexKey, JSON.stringify(list));
    } catch (e) {
      console.warn('Folio submit-order: photographer index update failed', e);
    }
  }

  // Fire the owner + customer emails in 'order' mode. Same Resend wiring
  // we already use for save-mode confirmations; this just flips the
  // bit so the owner gets the order record + photo download links.
  const customer = (design.customer || {}) as { email?: string; name?: string };
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  let ownerEmailSent = false;
  let customerEmailSent = false;
  try {
    const notifyRes = await fetch(`${siteUrl}/api/notify-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        customerEmail: customer.email || '',
        customerName: customer.name || '',
        mode: 'order',
      }),
    });
    if (notifyRes.ok) {
      const data = await notifyRes.json().catch(() => ({}));
      ownerEmailSent = !!data.ownerEmailSent;
      customerEmailSent = !!data.customerEmailSent;
    } else {
      console.warn('Folio submit-order: notify-order returned', notifyRes.status);
    }
  } catch (e) {
    // Don't fail the submit if email sending breaks — the order is
    // recorded in KV either way and the owner can find it manually.
    console.warn('Folio submit-order: notify-order threw', e);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      orderId,
      submittedAt,
      ownerEmailSent,
      customerEmailSent,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
