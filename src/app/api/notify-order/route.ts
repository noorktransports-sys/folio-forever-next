/**
 * /api/notify-order — fires two transactional emails via Resend:
 *   1. Customer → confirmation + share link to their saved design
 *   2. Owner    → order details + photo download links + design link
 *
 * This is the "Place Order" hook. Today it's invoked manually from the
 * Save & Share modal. When Stripe is wired in, the same endpoint will be
 * called from the checkout.session.completed webhook.
 *
 * Body shape:
 *   { token: string, customerEmail?: string, customerName?: string,
 *     mode?: 'save' | 'order' }
 *
 * mode = 'save'  → email the customer only (their share-link receipt).
 *                  Used by Save & Share so iterating doesn't spam the owner.
 * mode = 'order' → email both customer + owner. This is the real "new order"
 *                  notification, fired only on payment success (eventually
 *                  by the Stripe webhook). Default if mode is omitted.
 *
 * The design is fetched from KV (DESIGN_DRAFTS) using the token. We pull
 * size / total spreads / photo URLs directly from the saved JSON instead
 * of trusting the client to send them — single source of truth.
 *
 * Resend is called via REST (no SDK — keeps this edge-runtime-friendly
 * and zero-dependency). RESEND_API_KEY is set as an encrypted secret in
 * Cloudflare Pages.
 *
 * Returns:
 *   200 { ok: true, orderId, customerEmailSent, ownerEmailSent }
 *   4xx { error }
 *   502 { error: 'email provider failed', detail }
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  RESEND_API_KEY?: string;
  SITE_URL?: string;
  ORDER_FROM_EMAIL?: string; // optional override; defaults below
  OWNER_EMAIL?: string; // optional override; defaults below
}

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';

interface DesignPhoto {
  id?: string;
  url?: string;
}
interface DesignCustomer {
  email?: string;
  name?: string;
  deferred?: boolean;
}
interface SavedDesign {
  size?: string;
  totalSpreads?: number;
  spreadData?: unknown;
  uploadedPhotos?: Record<string, string> | DesignPhoto[];
  customer?: DesignCustomer | null;
  savedAt?: string;
}

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

function photoUrls(design: SavedDesign, siteUrl: string): string[] {
  const raw = design.uploadedPhotos;
  if (!raw) return [];
  const list: string[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p && typeof p === 'object' && typeof p.url === 'string') {
        list.push(p.url);
      }
    }
  } else {
    for (const v of Object.values(raw)) {
      if (typeof v === 'string') list.push(v);
    }
  }
  // Promote relative /api/photo/... URLs to absolute so the email client
  // resolves them outside the page context.
  return list.map((u) => (u.startsWith('http') ? u : `${siteUrl}${u}`));
}

async function sendEmail(
  apiKey: string,
  payload: { from: string; to: string[]; subject: string; html: string },
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };

  if (!env.DESIGN_DRAFTS) return err(503, 'design storage unavailable');
  if (!env.RESEND_API_KEY) return err(503, 'email provider not configured');

  let body: {
    token?: string;
    customerEmail?: string;
    customerName?: string;
    mode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid JSON body');
  }

  const mode = body.mode === 'save' ? 'save' : 'order';
  const token = body.token;
  if (!token || !/^[a-f0-9]{8,64}$/i.test(token)) {
    return err(400, 'invalid or missing token');
  }

  // Pull the saved design — single source of truth for what's in the order.
  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'design not found or expired');

  let design: SavedDesign;
  try {
    design = JSON.parse(json) as SavedDesign;
  } catch {
    return err(500, 'saved design is not valid JSON');
  }

  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  const fromAddr = env.ORDER_FROM_EMAIL || DEFAULT_FROM;
  const ownerAddr = env.OWNER_EMAIL || DEFAULT_OWNER;

  const designLink = `${siteUrl}/album/${token}`;
  const photos = photoUrls(design, siteUrl);
  const photoCount = photos.length;
  const size = design.size || '—';
  const spreads = design.totalSpreads ?? '—';

  // Customer details: prefer values posted in the body (so the caller can
  // override / capture at submit time), fall back to whatever was stored
  // alongside the design, then to nothing.
  const stored = design.customer || {};
  const customerEmail = (body.customerEmail || stored.email || '').trim();
  const customerName = (body.customerName || stored.name || '').trim();

  // Order ID — short hex tied to the design token + timestamp. Not
  // cryptographically meaningful; just human-friendly.
  const orderId =
    'FF-' + token.slice(0, 6).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();

  // ---------- Customer email (optional — only if we have one) ----------
  let customerEmailSent = false;
  if (customerEmail) {
    const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : 'Hi,';
    const customerHtml = `
<!doctype html><html><body style="margin:0;padding:0;background:#f6f1e8;font-family:Georgia,serif;color:#2a2419">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b8965a;margin-bottom:8px">Folio &amp; Forever</div>
    <h1 style="font-size:24px;margin:0 0 16px;font-weight:400">Your album design is saved</h1>
    <p style="font-size:14px;line-height:1.7">${greeting}</p>
    <p style="font-size:14px;line-height:1.7">Thank you for using Folio &amp; Forever. Your design is saved and ready when you are.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(designLink)}" style="display:inline-block;background:#b8965a;color:#0e0c09;padding:12px 24px;text-decoration:none;border-radius:4px;font-size:11px;letter-spacing:2px;text-transform:uppercase">View your design</a>
    </p>
    <p style="font-size:13px;line-height:1.7;color:#6b5e4d">
      Order reference: <strong>${escapeHtml(orderId)}</strong><br/>
      Album size: ${escapeHtml(String(size))}<br/>
      Spreads: ${escapeHtml(String(spreads))}<br/>
      Photos uploaded: ${photoCount}
    </p>
    <p style="font-size:12px;line-height:1.7;color:#8a7d68">The link works for 60 days. Reply to this email if you need help.</p>
  </div>
</body></html>`;
    const r = await sendEmail(env.RESEND_API_KEY, {
      from: fromAddr,
      to: [customerEmail],
      subject: `Your Folio & Forever design is saved (${orderId})`,
      html: customerHtml,
    });
    customerEmailSent = r.ok;
    if (!r.ok) {
      // Don't fail the whole request — owner notice is the critical one.
      console.warn('Resend customer email failed', r.status, r.body);
    }
  }

  // ---------- Owner email ----------
  // Save mode skips this — Save & Share fires repeatedly while the
  // customer iterates, and we don't want to spam Jayvee with fake
  // "new order" notices. Real orders fire the route in 'order' mode
  // (later: from the Stripe webhook on payment success).
  if (mode === 'save') {
    return new Response(
      JSON.stringify({
        ok: true,
        orderId,
        customerEmailSent,
        ownerEmailSent: false,
        mode,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const photoListHtml = photos.length
    ? `<ul style="font-size:12px;line-height:1.7;padding-left:18px">${photos
        .map(
          (u, i) =>
            `<li><a href="${escapeHtml(u)}">Photo ${i + 1}</a> — ${escapeHtml(u)}</li>`,
        )
        .join('')}</ul>`
    : '<p style="font-size:12px;color:#888">No photos in this design.</p>';

  const ownerHtml = `
<!doctype html><html><body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,Segoe UI,sans-serif;color:#222">
  <div style="max-width:680px;margin:0 auto;padding:24px">
    <div style="font-size:11px;letter-spacing:2px;color:#b8965a;text-transform:uppercase;margin-bottom:6px">New order — Folio &amp; Forever</div>
    <h1 style="font-size:20px;margin:0 0 16px">Order ${escapeHtml(orderId)}</h1>
    <table style="font-size:13px;line-height:1.8;border-collapse:collapse;width:100%">
      <tr><td style="padding:4px 0;color:#666;width:140px">Customer name</td><td>${escapeHtml(customerName || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Customer email</td><td>${customerEmail ? `<a href="mailto:${escapeHtml(customerEmail)}">${escapeHtml(customerEmail)}</a>` : '—'}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Album size</td><td>${escapeHtml(String(size))}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Spreads</td><td>${escapeHtml(String(spreads))}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Photos</td><td>${photoCount}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Saved at</td><td>${escapeHtml(design.savedAt || '—')}</td></tr>
    </table>
    <h2 style="font-size:14px;margin:24px 0 8px">Open the design</h2>
    <p><a href="${escapeHtml(designLink)}" style="background:#0e0c09;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;font-size:12px">${escapeHtml(designLink)}</a></p>
    <h2 style="font-size:14px;margin:24px 0 8px">Photo files (${photoCount})</h2>
    ${photoListHtml}
    <p style="font-size:11px;color:#999;margin-top:24px">Photos auto-purge from R2 after 60 days. Download anything you need to keep.</p>
  </div>
</body></html>`;

  const ownerRes = await sendEmail(env.RESEND_API_KEY, {
    from: fromAddr,
    to: [ownerAddr],
    subject: `New order ${orderId} — ${customerName || 'unknown'} (${photoCount} photos)`,
    html: ownerHtml,
  });

  if (!ownerRes.ok) {
    return err(502, 'email provider failed', {
      ownerStatus: ownerRes.status,
      ownerBody: ownerRes.body.slice(0, 500),
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      orderId,
      customerEmailSent,
      ownerEmailSent: true,
      mode,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
