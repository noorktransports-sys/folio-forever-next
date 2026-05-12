// src/lib/smart-order-emails.ts
//
// HTML email templates for smart-album orders. Shared between:
//   • /api/submit-smart-order — sends the OWNER a "PENDING PAYMENT" heads-up
//     immediately after the wizard's submit (we want to know someone got
//     all the way through, even if they bail at Stripe)
//   • /api/stripe-webhook    — on payment success, sends the CUSTOMER
//     confirmation + the OWNER a "PAID — start production" follow-up
//
// Side-effect free. Pure string builders. No fetch, no KV, no env.

export interface SmartPhotoUpload {
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

export interface SmartSpreadSnapshot {
  id: string;
  templateId: string;
  photoIds: (string | null)[];
  eventId: string;
}

export interface SpreadCompositeUpload {
  spreadId: string;
  /** Customer preview composite — embedded in email thumbnails. */
  key: string;
  url: string;
  /** Print master (300 DPI). Not embedded in customer emails; surfaced
   *  only on the admin order page for the printer hand-off. */
  printKey?: string;
  printUrl?: string;
}

export interface ShippingInfo {
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

export interface CustomerInfo {
  name: string;
  email: string;
}

export interface ProofApprovalRecord {
  acceptedAt: string;
  clauseVersion: string;
  clauseText: string;
  reviewedSpreadIds: string[];
}

export interface ContentRightsRecord {
  acceptedAt: string;
  clauseVersion: string;
  copyrightClause: string;
  policyClause: string;
}

export interface LowResPhoto {
  id: string;
  width: number;
  height: number;
}

export interface SmartOrderEmailData {
  orderId: string;
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
  spreadComposites?: SpreadCompositeUpload[];
  polishHandoff?: boolean;
  proofApproval?: ProofApprovalRecord;
  contentRights?: ContentRightsRecord;
  lowResPhotos?: LowResPhoto[];
}

export interface EmailAuditMeta {
  clientIp: string | null;
  userAgent: string | null;
  paidAt?: string;
  stripeSessionId?: string;
  stripePaymentIntent?: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function abs(siteUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return siteUrl.replace(/\/$/, '') + path;
}

/* ── Owner email: PENDING PAYMENT (sent at wizard submit) ──
 *
 * Short and informational. The customer hasn't paid yet — we just want to
 * know someone got far enough to hit Stripe. If they bail, we know to chase
 * up. If they pay, the webhook fires the "PAID" follow-up below. */
export function ownerPendingPaymentEmailHtml(
  data: SmartOrderEmailData,
  siteUrl: string,
  audit: EmailAuditMeta,
): string {
  const a = data.album;
  const c = data.customer;
  const s = data.shipping;
  const totalPhotos = data.photos.length;
  const adminLink = abs(siteUrl, '/admin');
  const lowRes = data.lowResPhotos ?? [];

  return `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #2a2218; background: #f5f0e8; padding: 24px;">
  <div style="max-width: 620px; margin: 0 auto; background: #fff; border: 1px solid #b8965a; padding: 28px;">
    <div style="background: #fff3cd; border: 1px solid #d4a843; padding: 10px 14px; margin: 0 0 18px; border-radius: 4px;">
      <strong style="color: #8a6800;">PENDING PAYMENT</strong> — the customer was redirected to Stripe. They have not paid yet.
      You'll get a separate "PAID" email when payment lands.
    </div>

    <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300; color: #b8965a; margin: 0 0 12px;">
      New smart album in <em>checkout</em>
    </h1>
    <p style="font-size: 13px; color: #6b5e4e; margin: 0 0 18px;">
      Order <strong>${escapeHtml(data.orderId)}</strong> · ${escapeHtml(data.albumName)} · <strong>$${a.totalPrice}</strong>
    </p>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 14px 0 6px;">Customer</h3>
    <table style="font-size: 13px; line-height: 1.7;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Name</td><td>${escapeHtml(c.name)}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Email</td><td><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Phone</td><td>${escapeHtml(s.phone)}</td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 14px 0 6px;">Album</h3>
    <table style="font-size: 13px; line-height: 1.7;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Size · binding</td><td>${escapeHtml(a.size === '17x24' ? '17×24' : '20×30')} · ${escapeHtml(a.type === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Spreads · photos</td><td>${a.pageCount} · ${totalPhotos}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Polish hand-off</td><td>${data.polishHandoff ? 'Yes (+$99)' : 'No'}</td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 14px 0 6px;">Legal audit</h3>
    <table style="font-size: 12px; line-height: 1.7; background: #faf6ed; border: 1px solid #b8965a; padding: 8px 12px; width: 100%;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Proof approved at</td><td>${escapeHtml(data.proofApproval?.acceptedAt ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Rights accepted at</td><td>${escapeHtml(data.contentRights?.acceptedAt ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Clause version</td><td>${escapeHtml(data.proofApproval?.clauseVersion ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Client IP</td><td>${escapeHtml(audit.clientIp ?? 'unknown')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Low-res photos</td><td>${lowRes.length}</td></tr>
    </table>

    <p style="margin-top: 22px;">
      <a href="${escapeHtml(adminLink)}" style="display: inline-block; background: #2a2218; color: #b8965a; padding: 12px 20px; text-decoration: none; font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">
        Open Admin →
      </a>
    </p>

    <p style="font-size: 11px; color: #8a7a65; margin-top: 18px; line-height: 1.6;">
      Photos are already on R2; if payment doesn't land within a day the order will sit at pending_payment in the admin list.
    </p>
  </div>
</body></html>`;
}

/* ── Owner email: PAID (sent by stripe-webhook) ──
 *
 * Full breakdown — this is the version you actually act on. Links to
 * high-res originals, composite previews, the legal audit, and the admin
 * deep-link. */
export function ownerPaidEmailHtml(
  data: SmartOrderEmailData,
  siteUrl: string,
  audit: EmailAuditMeta,
): string {
  const a = data.album;
  const c = data.customer;
  const s = data.shipping;
  const totalPhotos = data.photos.length;
  const heroes = data.photos.filter((p) => p.tagged === 'hero').length;
  const favs = data.photos.filter((p) => p.tagged === 'favorite').length;
  const adminLink = abs(siteUrl, '/admin');
  const lowRes = data.lowResPhotos ?? [];

  const photoListHtml = data.photos
    .map(
      (p) =>
        `<li><a href="${escapeHtml(abs(siteUrl, p.originalUrl))}">${escapeHtml(
          p.photoId,
        )}</a> · ${p.width}×${p.height}px${p.tagged && p.tagged !== 'none' ? ` · <strong>${escapeHtml(p.tagged)}</strong>` : ''}</li>`,
    )
    .join('');
  // Skip composites whose preview URL didn't make it — e.g. the render
  // failed on a constrained device. We'd rather omit the thumbnail than
  // ship a broken <img src="">.
  const compositesHtml = (data.spreadComposites ?? [])
    .filter((cmp) => cmp.url)
    .map(
      (cmp, i) =>
        `<div style="margin-bottom: 18px; padding: 8px; background: #faf6ed; border: 1px solid #b8965a;">
           <div style="font-size: 11px; letter-spacing: 2px; color: #b8965a; text-transform: uppercase; margin-bottom: 6px;">Spread ${i + 1}</div>
           <a href="${escapeHtml(abs(siteUrl, cmp.url))}">
             <img src="${escapeHtml(abs(siteUrl, cmp.url))}" alt="Spread ${i + 1}" style="width: 100%; max-width: 560px; height: auto; display: block; border: 0.5px solid #d4b07a;" />
           </a>
         </div>`,
    )
    .join('');

  return `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #2a2218; background: #f5f0e8; padding: 24px;">
  <div style="max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #b8965a; padding: 28px;">
    <div style="background: #d1f0c5; border: 1px solid #5fa54a; padding: 10px 14px; margin: 0 0 18px; border-radius: 4px;">
      <strong style="color: #2c5a1c;">PAID · START PRODUCTION</strong>
      ${audit.paidAt ? ` — Paid at ${escapeHtml(audit.paidAt)}` : ''}
    </div>

    <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300; color: #b8965a; margin: 0 0 12px;">
      Paid <em>smart album</em> order
    </h1>
    <p style="font-size: 14px; color: #6b5e4e; margin: 0 0 18px;">
      Order <strong>${escapeHtml(data.orderId)}</strong> · ${escapeHtml(data.albumName)}
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
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Polish hand-off</td><td>${data.polishHandoff ? 'Yes (+$99)' : 'No'}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;"><strong>Total paid</strong></td><td><strong>$${a.totalPrice}</strong></td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 18px 0 6px;">Ship to</h3>
    <div style="font-size: 13px; line-height: 1.7; color: #2a2218;">
      ${escapeHtml(s.recipientName)}<br>
      ${escapeHtml(s.line1)}${s.line2 ? '<br>' + escapeHtml(s.line2) : ''}<br>
      ${escapeHtml(s.city)}, ${escapeHtml(s.region)} ${escapeHtml(s.postalCode)}<br>
      ${escapeHtml(s.country)}
      ${s.notes ? `<br><em style="color: #6b5e4e;">Notes: ${escapeHtml(s.notes)}</em>` : ''}
    </div>

    ${compositesHtml ? `<h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 22px 0 8px;">Album spreads — as designed</h3>
    <p style="font-size: 11px; color: #6b5e4e; margin: 0 0 12px;">${(data.spreadComposites ?? []).length} composite previews · click any to open full size</p>
    ${compositesHtml}` : ''}

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 22px 0 6px;">Legal audit</h3>
    <table style="font-size: 12px; line-height: 1.7; background: #faf6ed; border: 1px solid #b8965a; padding: 8px 12px; width: 100%;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Proof approved at</td><td>${escapeHtml(data.proofApproval?.acceptedAt ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Rights accepted at</td><td>${escapeHtml(data.contentRights?.acceptedAt ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Clause version</td><td>${escapeHtml(data.proofApproval?.clauseVersion ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Client IP</td><td>${escapeHtml(audit.clientIp ?? 'unknown')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">User-Agent</td><td style="font-family: monospace; font-size: 11px;">${escapeHtml(audit.userAgent ?? 'unknown')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Stripe session</td><td>${escapeHtml(audit.stripeSessionId ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Payment intent</td><td>${escapeHtml(audit.stripePaymentIntent ?? '—')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Low-res photos</td><td>${lowRes.length} ${lowRes.length > 0 ? `<em style="color: #b8965a;">(printer should review — clause 2.2)</em>` : ''}</td></tr>
    </table>
    ${lowRes.length > 0 ? `<p style="font-size: 11px; color: #6b5e4e; margin: 6px 0 0;">${lowRes.map((p) => `<code>${escapeHtml(p.id)}</code> (${p.width}×${p.height})`).join(', ')}</p>` : ''}

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 22px 0 6px;">High-resolution photos (for print)</h3>
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

/* ── Customer email: confirmation (sent by stripe-webhook after payment) ── */
export function customerPaidEmailHtml(
  data: SmartOrderEmailData,
  siteUrl: string,
): string {
  const a = data.album;
  const previewListHtml = data.photos
    .map(
      (p) =>
        `<li><a href="${escapeHtml(abs(siteUrl, p.previewUrl))}">Preview ${escapeHtml(p.photoId.slice(0, 8))}</a></li>`,
    )
    .join('');
  const compositesHtml = (data.spreadComposites ?? [])
    .filter((cmp) => cmp.url)
    .map(
      (cmp, i) =>
        `<div style="margin-bottom: 16px; padding: 6px; background: #faf6ed; border: 1px solid #b8965a;">
           <div style="font-size: 11px; letter-spacing: 2px; color: #b8965a; text-transform: uppercase; margin-bottom: 4px;">Spread ${i + 1}</div>
           <a href="${escapeHtml(abs(siteUrl, cmp.url))}">
             <img src="${escapeHtml(abs(siteUrl, cmp.url))}" alt="Spread ${i + 1}" style="width: 100%; max-width: 480px; height: auto; display: block;" />
           </a>
         </div>`,
    )
    .join('');

  return `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #2a2218; background: #f5f0e8; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #b8965a; padding: 32px;">
    <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300; color: #b8965a; margin: 0 0 12px;">
      Payment received — your album is <em>in production</em>.
    </h1>
    <p style="font-size: 14px; line-height: 1.7; color: #2a2218;">
      Hi ${escapeHtml(data.customer.name)},<br><br>
      Thank you for your payment. We've received your Smart Auto-Layout album order and our design team will hand-finish every spread before printing.
    </p>

    <table style="font-size: 13px; line-height: 1.7; margin: 18px 0;">
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Order</td><td>${escapeHtml(data.orderId)}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Album</td><td>${escapeHtml(data.albumName)}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Size</td><td>${escapeHtml(a.size === '17x24' ? '17×24' : '20×30')} · ${escapeHtml(a.type === 'standard' ? 'Standard' : 'Layflat')}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Spreads</td><td>${a.pageCount}</td></tr>
      <tr><td style="padding-right: 12px; color: #6b5e4e;">Total paid</td><td><strong>$${a.totalPrice}</strong></td></tr>
    </table>

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 20px 0 6px;">What happens next</h3>
    <ol style="font-size: 13px; line-height: 1.9; color: #2a2218; padding-left: 18px; margin: 0;">
      <li>Our design team reviews crops &amp; pacing (24 h)</li>
      <li>Printing &amp; binding begins (5–7 days)</li>
      <li>We ship to the address on file with tracking</li>
    </ol>

    ${compositesHtml ? `<h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 22px 0 8px;">Your album · spread previews</h3>
    <p style="font-size: 12px; color: #6b5e4e; margin: 0 0 12px;">Here's how each spread will look. The actual print uses your originals at full resolution.</p>
    ${compositesHtml}` : ''}

    <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; color: #2a2218; margin: 22px 0 6px;">Your photos · preview links</h3>
    <p style="font-size: 12px; color: #6b5e4e; margin: 0 0 8px;">
      Compressed, watermarked copies for your records. The print uses your originals at full resolution.
    </p>
    <ul style="font-size: 12px; line-height: 1.8; color: #2a2218; max-height: 260px; overflow-y: auto; padding-left: 18px;">
      ${previewListHtml}
    </ul>

    <p style="font-size: 11px; color: #6b5e4e; margin-top: 24px; line-height: 1.7;">
      You approved the proof at ${escapeHtml(data.proofApproval?.acceptedAt ?? 'submission')}. Per clause 2.3 of our Terms of Service, the order is now locked for production and cannot be cancelled or modified except for manufacturing defects.
    </p>

    <p style="font-size: 12px; color: #6b5e4e; margin-top: 20px; line-height: 1.7;">
      Questions? Reply to this email and we'll get back to you within a business day.<br>
      <em>— Folio &amp; Forever</em>
    </p>
  </div>
</body></html>`;
}

/* ── Resend wrapper ── */

export async function sendResendEmail(
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
