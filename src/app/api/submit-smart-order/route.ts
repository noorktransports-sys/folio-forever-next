/**
 * POST /api/submit-smart-order
 *
 * Final submit for albums built in the Smart Auto-Layout wizard
 * (/design/smart). Writes the order to Cloudflare KV (`DESIGN_DRAFTS`)
 * under a fresh token, appends it to the shared `_orders_index_v1` so
 * the admin dashboard can list it next to manual orders, then sends two
 * emails via Resend:
 *
 *   • Owner — full HTML breakdown + LINKS TO HIGH-RES R2 PHOTOS for print
 *   • Customer — thank-you + LINKS TO WATERMARKED PREVIEW R2 PHOTOS
 *
 * The frontend is responsible for uploading both versions (original +
 * watermarked preview) to R2 via /api/upload BEFORE calling this
 * endpoint — see `src/app/design/smart/edit/submit-helpers.ts`. This
 * endpoint never touches R2 or Canvas itself; it just persists metadata
 * and dispatches email.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

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

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';
const ORDERS_INDEX_KEY = '_orders_index_v1';
const SUBMITTED_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

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
}

interface CustomerInfo {
  name: string;
  email: string;
}

interface SubmitPayload {
  albumId: string;
  albumName: string;
  customer: CustomerInfo;
  shipping: ShippingInfo;
  album: {
    size: '17x24' | '20x30';
    type: 'standard' | 'layflat';
    pageCount: number;
    totalPrice: number;
  };
  photos: SmartPhotoUpload[];
  spreads: SmartSpreadSnapshot[];
  customEventNames?: Record<string, string>;
  /** Polish-it upsell — $99 if true */
  polishHandoff?: boolean;
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function err(status: number, message: string, detail?: unknown) {
  return new Response(
    JSON.stringify({ error: message, ...(detail ? { detail } : {}) }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function abs(siteUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return siteUrl.replace(/\/$/, '') + path;
}

async function sendEmail(
  apiKey: string,
  payload: { from: string; to: string[]; subject: string; html: string },
): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const detail = await r.text();
      return { ok: false, detail };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

/* ─── Email templates ──────────────────────────────────────────────── */

function ownerEmailHtml(
  orderId: string,
  payload: SubmitPayload,
  siteUrl: string,
): string {
  const a = payload.album;
  const c = payload.customer;
  const s = payload.shipping;
  const totalPhotos = payload.photos.length;
  const heroes = payload.photos.filter((p) => p.tagged === 'hero').length;
  const favs = payload.photos.filter((p) => p.tagged === 'favorite').length;
  const adminLink = abs(siteUrl, '/admin');

  const photoListHtml = payload.photos
    .map(
      (p) =>
        `<li><a href="${escapeHtml(abs(siteUrl, p.originalUrl))}">${escapeHtml(
          p.photoId,
        )}</a> · ${p.width}×${p.height}px${p.tagged && p.tagged !== 'none' ? ` · <strong>${escapeHtml(p.tagged)}</strong>` : ''}</li>`,
    )
    .join('');

  return `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #2a2218; background: #f5f0e8; padding: 24px;">
  <div style="max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #b8965a; padding: 28px;">
    <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300; color: #b8965a; margin: 0 0 12px;">
      New <em>smart album</em> order
    </h1>
    <p style="font-size: 14px; color: #6b5e4e; margin: 0 0 18px;">
      Order <strong>${escapeHtml(orderId)}</strong> · ${escapeHtml(payload.albumName)}
    </p>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 18px 0 6px;">Customer</h3>
    <table style="font-size: 13px; line-height: 1.7;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Name</td><td>${escapeHtml(c.name)}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Email</td><td><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Phone</td><td>${escapeHtml(s.phone)}</td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 18px 0 6px;">Album</h3>
    <table style="font-size: 13px; line-height: 1.7;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Size</td><td>${escapeHtml(a.size === '17x24' ? '17×24' : '20×30')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Binding</td><td>${escapeHtml(a.type === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Spreads</td><td>${a.pageCount} (${a.pageCount * 2} pages)</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Photos</td><td>${totalPhotos} (${heroes} hero · ${favs} favorite)</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Polish hand-off</td><td>${payload.polishHandoff ? 'Yes (+$99)' : 'No'}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;"><strong>Total</strong></td><td><strong>$${a.totalPrice}${payload.polishHandoff ? ' + $99 design fee = $' + (a.totalPrice + 99) : ''}</strong></td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 18px 0 6px;">Ship to</h3>
    <div style="font-size: 13px; line-height: 1.7; color: #2a2218;">
      ${escapeHtml(s.recipientName)}<br>
      ${escapeHtml(s.line1)}${s.line2 ? '<br>' + escapeHtml(s.line2) : ''}<br>
      ${escapeHtml(s.city)}, ${escapeHtml(s.region)} ${escapeHtml(s.postalCode)}<br>
      ${escapeHtml(s.country)}
      ${s.notes ? `<br><em style="color: #6b5e4e;">Notes: ${escapeHtml(s.notes)}</em>` : ''}
    </div>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 18px 0 6px;">High-resolution photos (for print)</h3>
    <p style="font-size: 12px; color: #6b5e4e; margin: 0 0 8px;">${totalPhotos} originals on R2 · click any to download</p>
    <ul style="font-size: 12px; line-height: 1.8; color: #2a2218; max-height: 320px; overflow-y: auto; padding-left: 18px;">
      ${photoListHtml}
    </ul>

    <p style="margin-top: 28px;">
      <a href="${escapeHtml(adminLink)}" style="display: inline-block; background: #2a2218; color: #b8965a; padding: 12px 24px; text-decoration: none; font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">
        Open Admin →
      </a>
    </p>

    <p style="font-size: 11px; color: #8a7a65; margin-top: 24px; line-height: 1.7;">
      Photo blobs live on R2 with a 1-year retention. Pull them now if you need offline copies for the printer.
    </p>
  </div>
</body></html>`;
}

function customerEmailHtml(
  orderId: string,
  payload: SubmitPayload,
  siteUrl: string,
): string {
  const a = payload.album;
  const previewListHtml = payload.photos
    .map(
      (p) =>
        `<li><a href="${escapeHtml(abs(siteUrl, p.previewUrl))}">Preview ${escapeHtml(p.photoId.slice(0, 8))}</a></li>`,
    )
    .join('');

  return `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #2a2218; background: #f5f0e8; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #b8965a; padding: 32px;">
    <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300; color: #b8965a; margin: 0 0 12px;">
      Your album is <em>in production</em>.
    </h1>
    <p style="font-size: 14px; line-height: 1.7; color: #2a2218;">
      Hi ${escapeHtml(payload.customer.name)},<br><br>
      Thank you for your order. We've received your Smart Auto-Layout album and our design team will hand-finish every spread before printing.
    </p>

    <table style="font-size: 13px; line-height: 1.7; margin: 18px 0;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Order</td><td>${escapeHtml(orderId)}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Album</td><td>${escapeHtml(payload.albumName)}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Size</td><td>${escapeHtml(a.size === '17x24' ? '17×24' : '20×30')} · ${escapeHtml(a.type === 'standard' ? 'Standard' : 'Layflat')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Spreads</td><td>${a.pageCount}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Total</td><td><strong>$${a.totalPrice}${payload.polishHandoff ? ' + $99' : ''}</strong></td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 20px 0 6px;">What happens next</h3>
    <ol style="font-size: 13px; line-height: 1.9; color: #2a2218; padding-left: 18px; margin: 0;">
      <li>Our design team reviews crops &amp; pacing (24 h)</li>
      <li>You'll receive a final PDF proof to approve</li>
      <li>After approval, printing &amp; binding begins (5–7 days)</li>
      <li>We ship to the address on file</li>
    </ol>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 20px 0 6px;">Your photos · preview</h3>
    <p style="font-size: 12px; color: #6b5e4e; margin: 0 0 8px;">
      Compressed, watermarked copies for your records. The print uses your originals at full resolution.
    </p>
    <ul style="font-size: 12px; line-height: 1.8; color: #2a2218; max-height: 260px; overflow-y: auto; padding-left: 18px;">
      ${previewListHtml}
    </ul>

    <p style="font-size: 12px; color: #6b5e4e; margin-top: 28px; line-height: 1.7;">
      Questions? Reply to this email and we'll get back to you within a business day.<br>
      <em>— Folio &amp; Forever</em>
    </p>
  </div>
</body></html>`;
}

/* ─── Handler ──────────────────────────────────────────────────────── */

export async function POST(request: Request) {
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
  if (!payload.shipping?.recipientName || !payload.shipping?.line1) {
    return err(400, 'Missing shipping info');
  }
  if (!payload.album || typeof payload.album.pageCount !== 'number') {
    return err(400, 'Missing album data');
  }
  if (!Array.isArray(payload.photos) || payload.photos.length === 0) {
    return err(400, 'No photos in submission');
  }

  const { env } = getRequestContext() as { env: Env };
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  const ownerEmail = env.OWNER_EMAIL || DEFAULT_OWNER;
  const fromEmail = env.ORDER_FROM_EMAIL || DEFAULT_FROM;

  // Mint identifiers
  const token = mintToken();
  const orderId = mintOrderId(token);
  const submittedAt = new Date().toISOString();

  // Persist the order to KV (DESIGN_DRAFTS namespace; shared with manual)
  if (env.DESIGN_DRAFTS) {
    const record = {
      mode: 'smart' as const,
      orderId,
      token,
      status: 'submitted' as const,
      submittedAt,
      albumId: payload.albumId,
      albumName: payload.albumName,
      customer: payload.customer,
      shipping: payload.shipping,
      album: payload.album,
      polishHandoff: payload.polishHandoff ?? false,
      photos: payload.photos,
      spreads: payload.spreads,
      customEventNames: payload.customEventNames ?? {},
    };
    try {
      await env.DESIGN_DRAFTS.put(token, JSON.stringify(record), {
        expirationTtl: SUBMITTED_TTL_SECONDS,
      });
      // Append to the shared orders index so /admin lists this alongside
      // manual orders. Keep the entry shape consistent with the manual flow.
      const indexRaw = await env.DESIGN_DRAFTS.get(ORDERS_INDEX_KEY);
      const index: Array<Record<string, unknown>> = indexRaw
        ? (JSON.parse(indexRaw) as Array<Record<string, unknown>>)
        : [];
      index.unshift({
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
        status: 'submitted',
      });
      await env.DESIGN_DRAFTS.put(ORDERS_INDEX_KEY, JSON.stringify(index));
    } catch (e) {
      // Continue to email anyway — we'd rather get the lead than lose it
      // because of a transient KV blip.
      console.warn('[submit-smart-order] KV persistence failed', e);
    }
  }

  // Send emails (best-effort)
  let ownerEmailSent = false;
  let customerEmailSent = false;
  if (env.RESEND_API_KEY) {
    const ownerResult = await sendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [ownerEmail],
      subject: `[Smart] New order ${orderId} — ${payload.customer.name} · $${payload.album.totalPrice}`,
      html: ownerEmailHtml(orderId, payload, siteUrl),
    });
    ownerEmailSent = ownerResult.ok;

    const customerResult = await sendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [payload.customer.email],
      subject: `Your album order ${orderId} is in production`,
      html: customerEmailHtml(orderId, payload, siteUrl),
    });
    customerEmailSent = customerResult.ok;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      orderId,
      token,
      submittedAt,
      ownerEmailSent,
      customerEmailSent,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
