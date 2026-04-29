/**
 * /api/pro/signup — POST { email, name, studioName, phone, message? }
 *
 * Creates a pending photographer record. Owner (Jayvee) is notified via
 * email; the photographer can't log in until the owner approves them in
 * /admin/photographers.
 *
 * Idempotent on email: re-signup with the same email returns the
 * existing accountId without creating a duplicate. Status doesn't get
 * downgraded — already-approved photographers stay approved.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { newAccountId } from '@/lib/photographer-auth';

export const runtime = 'edge';

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

const PHOTOGRAPHER_INDEX_KEY = '_photographers_v1';
const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';

interface IndexEntry {
  email: string;
  accountId: string;
  status: 'pending' | 'approved' | 'rejected';
  joinedAt: string;
  name: string;
  studioName: string;
}

interface PhotographerRecord {
  email: string;
  name: string;
  studioName: string;
  phone: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  joinedAt: string;
  approvedAt?: string;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');

  let body: {
    email?: string;
    name?: string;
    studioName?: string;
    phone?: string;
    message?: string;
  };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid body');
  }
  const email = (body.email || '').trim().toLowerCase();
  const name = (body.name || '').trim();
  const studioName = (body.studioName || '').trim();
  const phone = (body.phone || '').trim();
  const message = (body.message || '').trim().slice(0, 1000);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return err(400, 'valid email required');
  }
  if (!name) return err(400, 'name required');
  if (!studioName) return err(400, 'studio name required');
  if (!phone) return err(400, 'phone required');

  // Idempotency check — read the index, look up by email.
  let index: Record<string, IndexEntry> = {};
  try {
    const raw = await env.DESIGN_DRAFTS.get(PHOTOGRAPHER_INDEX_KEY);
    if (raw) index = JSON.parse(raw);
  } catch { /* fresh index */ }

  let accountId: string;
  let isNew = false;
  if (index[email]) {
    accountId = index[email].accountId;
  } else {
    accountId = newAccountId();
    isNew = true;
  }

  const now = new Date().toISOString();
  const recordKey = `_photographer_${accountId}`;
  let record: PhotographerRecord;
  if (isNew) {
    record = {
      email,
      name,
      studioName,
      phone,
      message,
      status: 'pending',
      joinedAt: now,
    };
  } else {
    // Existing record — refresh the contact fields but DON'T downgrade status.
    const existingRaw = await env.DESIGN_DRAFTS.get(recordKey);
    const existing = existingRaw ? (JSON.parse(existingRaw) as PhotographerRecord) : null;
    record = {
      email,
      name,
      studioName,
      phone,
      message,
      status: existing?.status || 'pending',
      joinedAt: existing?.joinedAt || now,
      approvedAt: existing?.approvedAt,
    };
  }

  await env.DESIGN_DRAFTS.put(recordKey, JSON.stringify(record));

  index[email] = {
    email,
    accountId,
    status: record.status,
    joinedAt: record.joinedAt,
    name,
    studioName,
  };
  await env.DESIGN_DRAFTS.put(PHOTOGRAPHER_INDEX_KEY, JSON.stringify(index));

  // Notify owner. Best-effort — failure here doesn't fail the signup.
  if (isNew && env.RESEND_API_KEY) {
    const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
    const fromAddr = env.ORDER_FROM_EMAIL || DEFAULT_FROM;
    const ownerAddr = env.OWNER_EMAIL || DEFAULT_OWNER;
    const html = `
<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#222;background:#fafafa;margin:0;padding:0">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:11px;letter-spacing:2px;color:#b8965a;text-transform:uppercase;margin-bottom:6px">Folio &amp; Forever — pro signup</div>
    <h1 style="font-size:20px;margin:0 0 14px">New photographer pending approval</h1>
    <table style="font-size:13px;line-height:1.7;border-collapse:collapse;width:100%">
      <tr><td style="color:#666;width:120px">Studio</td><td><strong>${escapeHtml(studioName)}</strong></td></tr>
      <tr><td style="color:#666">Name</td><td>${escapeHtml(name)}</td></tr>
      <tr><td style="color:#666">Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
      <tr><td style="color:#666">Phone</td><td><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></td></tr>
      ${message ? `<tr><td style="color:#666;vertical-align:top">Message</td><td>${escapeHtml(message)}</td></tr>` : ''}
    </table>
    <p style="margin-top:24px"><a href="${siteUrl}/admin/photographers" style="background:#0e0c09;color:#fff;padding:12px 22px;text-decoration:none;border-radius:6px;font-size:12px;letter-spacing:2px;text-transform:uppercase">Review &amp; approve</a></p>
    <p style="font-size:11px;color:#999;margin-top:24px">They can&rsquo;t log in until you click Approve in the admin.</p>
  </div>
</body></html>`;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [ownerAddr],
          subject: `New photographer signup — ${studioName}`,
          html,
        }),
      });
    } catch (e) {
      console.warn('Folio pro/signup: owner email failed', e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, accountId, status: record.status, isNew }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
