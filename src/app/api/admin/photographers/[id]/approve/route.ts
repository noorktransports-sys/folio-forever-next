/**
 * /api/admin/photographers/[id]/approve — POST { decision: 'approve' | 'reject' }
 *
 * Auth-gated by admin cookie. Updates the photographer's status both in
 * the per-photographer record AND the lookup index (so the admin list
 * and the login flow see the same value).
 *
 * Approval also sends a "you're in" email to the photographer with a
 * one-time login link so they can land in the dashboard without a
 * second magic-link round trip.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';
import { newMagicToken } from '@/lib/photographer-auth';

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
  ADMIN_PASSWORD?: string;
  RESEND_API_KEY?: string;
  SITE_URL?: string;
  ORDER_FROM_EMAIL?: string;
}

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) {
    return err(401, 'unauthorized');
  }
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');

  const { id } = await params;
  if (!/^[a-f0-9]{8,32}$/i.test(id)) return err(400, 'invalid id');

  let body: { decision?: string };
  try {
    body = await request.json();
  } catch {
    return err(400, 'invalid body');
  }
  const decision = body.decision === 'reject' ? 'rejected' : 'approved';

  const recordRaw = await env.DESIGN_DRAFTS.get(`_photographer_${id}`);
  if (!recordRaw) return err(404, 'photographer not found');
  const record = JSON.parse(recordRaw) as PhotographerRecord;
  record.status = decision;
  if (decision === 'approved' && !record.approvedAt) {
    record.approvedAt = new Date().toISOString();
  }
  await env.DESIGN_DRAFTS.put(`_photographer_${id}`, JSON.stringify(record));

  // Patch the lookup index so the email→accountId map reflects new status.
  try {
    const indexRaw = await env.DESIGN_DRAFTS.get('_photographers_v1');
    if (indexRaw) {
      const idx = JSON.parse(indexRaw) as Record<string, IndexEntry>;
      if (idx[record.email]) {
        idx[record.email].status = decision;
        await env.DESIGN_DRAFTS.put('_photographers_v1', JSON.stringify(idx));
      }
    }
  } catch (e) {
    console.warn('Folio admin/approve: index patch failed', e);
  }

  // Email the photographer — only on approval (rejection notice is
  // intentionally omitted; if you need it, do it manually).
  if (decision === 'approved' && env.RESEND_API_KEY) {
    const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
    const fromAddr = env.ORDER_FROM_EMAIL || DEFAULT_FROM;
    const { token: magicToken, expiresAt } = newMagicToken();
    await env.DESIGN_DRAFTS.put(
      `_pro_magic_${magicToken}`,
      JSON.stringify({ accountId: id, email: record.email, expiresAt }),
      { expirationTtl: 60 * 60 * 24 }, // 24h for the welcome link
    );
    const verifyUrl = `${siteUrl}/api/pro/verify?token=${magicToken}`;
    const html = `
<!doctype html><html><body style="margin:0;padding:0;background:#f6f1e8;font-family:Georgia,serif;color:#2a2419">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b8965a;margin-bottom:8px">Folio &amp; Forever Pro</div>
    <h1 style="font-size:24px;margin:0 0 14px;font-weight:400">You&rsquo;re in.</h1>
    <p style="font-size:14px;line-height:1.7">Hi ${escapeHtml(record.name)}, your photographer account at Folio &amp; Forever has been approved. Click below to sign into your dashboard and start designing albums for your clients.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#b8965a;color:#0e0c09;padding:14px 28px;text-decoration:none;border-radius:4px;font-size:11px;letter-spacing:2px;text-transform:uppercase">Open my dashboard</a>
    </p>
    <p style="font-size:12px;color:#8a7d68">This sign-in link is good for 24 hours. After that, request a new one from <a href="${siteUrl}/pro/login">${siteUrl}/pro/login</a>.</p>
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
          to: [record.email],
          subject: 'Welcome to Folio & Forever Pro',
          html,
        }),
      });
    } catch (e) {
      console.warn('Folio admin/approve: welcome email failed', e);
    }
  }

  return new Response(JSON.stringify({ ok: true, status: decision }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
