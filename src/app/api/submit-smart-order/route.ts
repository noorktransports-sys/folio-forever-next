/**
 * POST /api/submit-smart-order
 *
 * Persists a wizard submission as a PENDING_PAYMENT order. Does NOT
 * complete the order — that happens later via Stripe Checkout +
 * /api/stripe-webhook.
 *
 * Flow:
 *   1. Wizard uploads photos to R2 (via /api/upload)
 *   2. POST here — we mint orderId + token, write to KV with
 *      status='pending_payment', persist audit records, and send the
 *      OWNER a "PENDING PAYMENT" heads-up email + CUSTOMER "order received"
 *      email (order number + pay link). Payment confirmation follows later.
 *   3. Client takes the returned token to /api/stripe-checkout to build
 *      a Checkout Session and redirects the customer to Stripe.
 *   4. On payment success, /api/stripe-webhook flips status='paid' and
 *      sends both the customer confirmation + the owner "PAID" follow-up.
 *
 * If the customer never pays, the order stays at pending_payment in KV.
 * Admin can chase up via the customer's email or just let the 1-year TTL
 * sweep it.
 *
 * Legal audit (clauses 2.2 / 2.3 / 2.4):
 *   The endpoint REJECTS any submission missing `proofApproval` or
 *   `contentRights` records. Both are persisted under their own KV keys
 *   (`proof_approval:{orderId}` and `content_rights:{orderId}`) so a
 *   future legal review can pull the evidence without scanning every
 *   order. Each record stores the EXACT clause text the customer saw,
 *   their timestamp, plus the server-captured IP + User-Agent.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { getShipping, shippingText } from '@/lib/shipping';
import { quoteSmartOrder, ORDER_SOURCE } from '@/lib/pricing';
import { putIndexEntry, type IndexKV } from '@/lib/order-index';
import { allowRequest, tooMany } from '@/lib/rate-limit';
import {
  ownerPendingPaymentEmailHtml,
  sendResendEmail,
  customerOrderReceivedEmailHtml,
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
  RESEND_API_KEY?: string;
  SITE_URL?: string;
  ORDER_FROM_EMAIL?: string;
  OWNER_EMAIL?: string;
}

const DEFAULT_FROM = 'Folio Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';

/* ─── Types ────────────────────────────────────────────────────────── */

interface SmartPhotoUpload {
  photoId: string;
  originalKey: string;
  originalUrl: string;
  previewKey: string;
  previewUrl: string;
  width: number;
  height: number;
  tagged?: 'hero' | 'favorite' | 'none';
  eventId?: string;
}

interface SmartSpreadSnapshot {
  id: string;
  templateId: string;
  photoIds: (string | null)[];
  eventId: string;
}

interface SpreadCompositeUpload {
  spreadId: string;
  key: string;
  url: string;
}

interface ShippingInfo {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes?: string;
  method?: string;
  methodLabel?: string;
  shippingUsd?: number;
}

interface CustomerInfo {
  name: string;
  email: string;
}

/* ── Legal audit payloads (clauses 2.2 / 2.3 / 2.4) ──
 * These records back our defence if a customer ever disputes the order.
 * Each one captures the EXACT clause text that was on screen plus a
 * timestamp the client recorded. The server adds IP + user-agent on its
 * side from request headers before persisting to KV. */
interface ProofApprovalRecord {
  acceptedAt: string;
  clauseVersion: string;
  clauseText: string;
  reviewedSpreadIds: string[];
}

interface ContentRightsRecord {
  acceptedAt: string;
  clauseVersion: string;
  copyrightClause: string;
  policyClause: string;
}

interface LowResPhoto {
  id: string;
  width: number;
  height: number;
}

interface SubmitPayload {
  albumId: string;
  albumName: string;
  customer: CustomerInfo;
  shipping: ShippingInfo;
  album: {
    size: string;
    type: 'standard' | 'layflat';
    pageCount: number;
    totalPrice: number;
  };
  /** Delivery option id (lib/shipping.ts). Price is decided HERE. */
  shippingMethod?: string;
  termsAccepted?: { acceptedAt?: string; version?: string };
  photos: SmartPhotoUpload[];
  spreads: SmartSpreadSnapshot[];
  /** Composite JPEGs of each spread, uploaded by the client at submit
   *  time so the emails can SHOW the album layout, not just list photos. */
  spreadComposites?: SpreadCompositeUpload[];
  /** Share-ready 1080×1920 Instagram-Story cards rendered at submit so
   *  the success page can offer downloads + share buttons. Best-effort:
   *  either field may be null when the render failed. */
  sharePack?: {
    coverUrl?: string | null;
    montageUrl?: string | null;
  } | null;
  customEventNames?: Record<string, string>;
  /** Album cover (leather / acrylic / photo). Required from the client. */
  cover?: {
    type: 'leather' | 'acrylic' | 'photo';
    leatherColor: string;
    photoSrc: string | null;
    backPhotoSrc: string | null;
    photoScale: number;
    photoX: number;
    photoY: number;
    primaryText: string;
    subtitleText: string;
    fontId: string;
    fontSize: number;
    foilColor: string;
    customTextHex: string;
    position: string;
    /** Cover add-on price ($0 photo / $25 leather / $39 acrylic). */
    priceAdd: number;
    /** Flat rendered cover JPEG(s) on R2 for proof / production. */
    renderedFrontUrl?: string | null;
    renderedBackUrl?: string | null;
  } | null;
  /** Polish-it upsell — $99 if true */
  polishHandoff?: boolean;
  /** Phase 1 — proof approval (clause 2.3). Required. */
  proofApproval?: ProofApprovalRecord;
  /** Phase 2 — content rights acknowledgement (clauses 2.2 + 2.4). Required. */
  contentRights?: ContentRightsRecord;
  /** Photos whose shortest edge is below 1500 px — surfaced for the printer
   *  (clause 2.2). */
  lowResPhotos?: LowResPhoto[];
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function err(status: number, message: string, detail?: unknown) {
  return new Response(
    JSON.stringify({ error: message, ...(detail ? { detail } : {}) }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function mintToken(): string {
  // 12-hex, matches the manual builder's token format.
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function mintOrderId(token: string): string {
  return `FF-${token.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
}

/* ─── Handler ──────────────────────────────────────────────────────── */

export async function POST(request: Request) {
  {
    const { env } = getRequestContext() as { env: Env };
    // 6 order submits per 10 minutes per IP is plenty for a real couple.
    if (!(await allowRequest(env.DESIGN_DRAFTS, request, 'submit-smart', 6, 600))) return tooMany();
  }
  // Validate payload
  let payload: SubmitPayload;
  try {
    payload = (await request.json()) as SubmitPayload;
  } catch {
    return err(400, 'Invalid JSON');
  }
  if (!payload.customer?.email || !payload.customer?.name) {
    return err(400, 'Missing customer info');
  }
  // Demo ("Use sample wedding photos") pictures are for trying the
  // builder only — never orderable.
  if ((payload.photos ?? []).some((ph) => String(ph.photoId ?? '').startsWith('sample-'))) {
    return err(400, 'Sample photos can’t be ordered — please upload your own photos');
  }
  if (!payload.shipping?.recipientName || !payload.shipping?.line1) {
    return err(400, 'Missing shipping info');
  }
  if (!payload.album || typeof payload.album.pageCount !== 'number') {
    return err(400, 'Missing album data');
  }
  if (!Array.isArray(payload.photos) || payload.photos.length === 0) {
    return err(400, 'No photos in submission');
  }
  // Legal gates — refuse to persist an order without both records. The
  // client UI prevents this from happening, but defence-in-depth: if a
  // malicious client posted directly we'd still reject.
  if (!payload.proofApproval || !payload.proofApproval.acceptedAt) {
    return err(400, 'Missing proof approval (clause 2.3)');
  }
  if (!payload.contentRights || !payload.contentRights.acceptedAt) {
    return err(400, 'Missing content rights acceptance (clauses 2.2 / 2.4)');
  }
  if (!payload.termsAccepted?.acceptedAt) {
    return err(400, 'Please accept the Terms of Service and Refund Policy');
  }

  const { env } = getRequestContext() as { env: Env };
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  const ownerEmail = env.OWNER_EMAIL || DEFAULT_OWNER;
  const fromEmail = env.ORDER_FROM_EMAIL || DEFAULT_FROM;

  // Capture the IP + user-agent for the audit trail. cf-connecting-ip is
  // Cloudflare's canonical client-IP header (always present at the edge).
  const clientIp =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    null;
  const userAgent = request.headers.get('user-agent') || null;

  // ── PRICE IS DECIDED HERE ──
  // Recomputed from lib/pricing (the same table the builder shows). The
  // browser's totalPrice / cover priceAdd are ignored, so a tampered
  // request can't lower the amount.
  let quote;
  try {
    quote = quoteSmartOrder({
      size: payload.album.size,
      type: payload.album.type,
      spreads: Array.isArray(payload.spreads) && payload.spreads.length > 0 ? payload.spreads.length : payload.album.pageCount,
      coverType: payload.cover?.type,
      polish: !!payload.polishHandoff,
      shippingId: payload.shippingMethod,
    });
  } catch (e) {
    return err(400, e instanceof Error ? e.message : 'Invalid album');
  }
  const ship = getShipping(quote.shippingId);
  payload.shipping = { ...payload.shipping, method: ship.id, methodLabel: shippingText(ship), shippingUsd: ship.usd };
  payload.album = {
    ...payload.album,
    pageCount: Array.isArray(payload.spreads) && payload.spreads.length > 0 ? payload.spreads.length : payload.album.pageCount,
    totalPrice: quote.totalUsd,
  };
  if (payload.cover) payload.cover = { ...payload.cover, priceAdd: quote.coverUsd };

  // Only accept files that were uploaded for THIS album (keys under
  // designs/<albumId>/) and site-relative photo URLs — never outside links.
  const albumPrefix = `designs/${String(payload.albumId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)}/`;
  const ownKey = (k: unknown) => typeof k === 'string' && k.startsWith(albumPrefix);
  const ownUrl = (u: unknown) => typeof u === 'string' && u.startsWith(`/api/photo/${albumPrefix}`);
  payload.spreadComposites = (payload.spreadComposites ?? []).filter((c) => ownKey(c.key) && ownUrl(c.url));
  if (payload.photos.some((ph) => (ph.originalKey && !ownKey(ph.originalKey)) || (ph.previewKey && !ownKey(ph.previewKey)))) {
    return err(400, 'Photo files do not belong to this album');
  }

  // Mint identifiers
  const token = mintToken();
  const orderId = mintOrderId(token);
  const submittedAt = new Date().toISOString();

  // Persist the order to KV (DESIGN_DRAFTS namespace; shared with manual).
  // Status starts at pending_payment — the stripe-webhook flips it to
  // 'paid' once Stripe confirms payment success.
  if (env.DESIGN_DRAFTS) {
    const record = {
      mode: 'smart' as const,
      orderId,
      token,
      status: 'pending_payment' as const,
      submittedAt,
      albumId: payload.albumId,
      albumName: payload.albumName,
      customer: payload.customer,
      shipping: payload.shipping,
      album: payload.album,
      shippingMethod: ship.id,
      shippingUsd: ship.usd,
      cover: payload.cover ?? null,
      polishHandoff: payload.polishHandoff ?? false,
      photos: payload.photos,
      spreads: payload.spreads,
      spreadComposites: payload.spreadComposites ?? [],
      // Server-computed price (the ONLY amount checkout will charge) and
      // the marker that proves this record came from this route.
      pricing: quote,
      orderSource: ORDER_SOURCE,
      // Share-ready Instagram-Story-sized cards. Surfaced on the
      // /design/smart/success page so the couple can post immediately
      // — each carries a folioforever footer for organic acquisition.
      sharePack: payload.sharePack ?? null,
      customEventNames: payload.customEventNames ?? {},
      // Legal records embedded in the order so admin views can show them
      // without a separate KV read. The standalone audit keys below are
      // the canonical evidence record.
      proofApproval: payload.proofApproval,
      contentRights: payload.contentRights,
      termsAccepted: {
        acceptedAt: String(payload.termsAccepted.acceptedAt).slice(0, 40),
        version: String(payload.termsAccepted.version ?? '').slice(0, 40),
      },
      lowResPhotos: payload.lowResPhotos ?? [],
      auditClientIp: clientIp,
      auditUserAgent: userAgent,
    };
    try {
      // No expiry: orders and their legal records are kept.
      await env.DESIGN_DRAFTS.put(token, JSON.stringify(record));
      // ── Standalone audit records (clauses 2.2 / 2.3 / 2.4) ──
      // Stored under their own keys so a future legal review can pull
      // them without scanning every order. Same 1-year TTL.
      const proofKey = `proof_approval:${orderId}`;
      const proofAudit = {
        orderId,
        token,
        customer: payload.customer,
        proofApproval: payload.proofApproval,
        spreadIds: payload.spreads.map((s) => s.id),
        spreadComposites: payload.spreadComposites ?? [],
        clientIp,
        userAgent,
        serverReceivedAt: submittedAt,
      };
      await env.DESIGN_DRAFTS.put(proofKey, JSON.stringify(proofAudit));
      const rightsKey = `content_rights:${orderId}`;
      const rightsAudit = {
        orderId,
        token,
        customer: payload.customer,
        contentRights: payload.contentRights,
        lowResPhotos: payload.lowResPhotos ?? [],
        photoCount: payload.photos.length,
        clientIp,
        userAgent,
        serverReceivedAt: submittedAt,
      };
      await env.DESIGN_DRAFTS.put(rightsKey, JSON.stringify(rightsAudit));
      // Admin list entry — one key per order (no shared-array races).
      await putIndexEntry(env.DESIGN_DRAFTS as unknown as IndexKV, {
        token,
        orderId,
        mode: 'smart',
        submittedAt,
        customerName: payload.customer.name,
        customerEmail: payload.customer.email,
        albumName: payload.albumName,
        size: payload.album.size,
        spreads: payload.album.pageCount,
        photoCount: payload.photos.length,
        totalPrice: payload.album.totalPrice,
        status: 'pending_payment',
        proofApprovedAt: payload.proofApproval?.acceptedAt ?? null,
        rightsAcceptedAt: payload.contentRights?.acceptedAt ?? null,
        clauseVersion: payload.proofApproval?.clauseVersion ?? null,
      });
    } catch (e) {
      // Never tell the customer "order received" when it wasn't saved —
      // the payment link would then point at nothing.
      console.warn('[submit-smart-order] KV persistence failed', e);
      return err(503, 'We could not save your order — please try again in a minute');
    }
  } else {
    return err(503, 'Order storage is not available right now — please try again later');
  }

  // Owner heads-up: someone got to checkout. No customer email yet — that
  // fires from the webhook once they actually pay.
  let ownerEmailSent = false;
  if (env.RESEND_API_KEY) {
    const emailData: SmartOrderEmailData = {
      orderId,
      albumName: payload.albumName,
      customer: payload.customer,
      shipping: payload.shipping,
      album: payload.album,
      cover: payload.cover ?? null,
      photos: payload.photos,
      spreads: payload.spreads,
      spreadComposites: payload.spreadComposites,
      polishHandoff: payload.polishHandoff ?? false,
      proofApproval: payload.proofApproval,
      contentRights: payload.contentRights,
      lowResPhotos: payload.lowResPhotos,
    };
    const ownerResult = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [ownerEmail],
      subject: `[PENDING] ${orderId} — ${payload.customer.name} · $${payload.album.totalPrice}`,
      html: ownerPendingPaymentEmailHtml(emailData, siteUrl, { clientIp, userAgent }),
    });
    ownerEmailSent = ownerResult.ok;
    // Client gets their order number right away (payment confirmation
    // follows from the webhook once they pay).
    await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [payload.customer.email],
      subject: `Order received — ${orderId} · your wedding album`,
      html: customerOrderReceivedEmailHtml(
        {
          orderId,
          customerName: payload.customer.name,
          product: `${payload.albumName || 'Wedding album'}`,
          rows: [
            ['Album', `${payload.album.size.replace('x', '×')} · ${payload.album.type === 'standard' ? 'Standard' : 'Layflat'}`],
            ['Spreads', String(payload.album.pageCount)],
            ['Shipping', `${shippingText(ship)} · $${ship.usd}`],
          ],
          totalDue: payload.album.totalPrice,
          payUrl: `${siteUrl}/api/square-checkout?token=${token}`,
          images: (payload.spreadComposites ?? []).map((c, i) => ({ url: c.url, label: `Spread ${i + 1}` })),
          imageCols: 2,
        },
        siteUrl,
      ),
    }).catch(() => undefined);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      orderId,
      token,
      submittedAt,
      status: 'pending_payment',
      ownerEmailSent,
      // No customerEmailSent here — that's the webhook's job after payment.
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
