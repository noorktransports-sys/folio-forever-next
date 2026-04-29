/**
 * /api/pro/login — POST { email } sends a magic-link email if the
 * photographer is approved. Always returns 200 (even if not approved
 * or unknown email) so the response can't be used to enumerate accounts.
 *
 * Magic link: 32-hex token, 15-min TTL, single-use (consumed on /verify).
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
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
  RESEND_API_KEY?: string;
  SITE_URL?: string;
  ORDER_FROM_EMAIL?: string;
}

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';

interface IndexEntry {
  email: string;
  accountId: string;
  status: 'pending' | 'approved' | 'rejected';
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
  if (!env.DESIGN_DRAFTS) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Look up photographer by email. If missing or not approved, silently
  // succeed (response gives no info to attackers).
  let entry: IndexEntry | null = null;
  try {
    const raw = await env.DESIGN_DRAFTS.get('_photographers_v1');
    if (raw) {
      const idx = JSON.parse(raw) as Record<string, IndexEntry>;
      entry = idx[email] || null;
    }
  } catch { /* ignore */ }

  if (!entry || entry.status !== 'approved') {
    // Tell the user "we sent a link if your account is ready" — same
    // message regardless, prevents account enumeration.
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mint and store the magic token. KV TTL handles automatic expiry.
  const { token, expiresAt } = newMagicToken();
  await env.DESIGN_DRAFTS.put(
    `_pro_magic_${token}`,
    JSON.stringify({ accountId: entry.accountId, email, expiresAt }),
    { expirationTtl: 60 * 16 }, // 16-min TTL > 15-min code TTL
  );

  // Send the magic link.
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  const fromAddr = env.ORDER_FROM_EMAIL || DEFAULT_FROM;
  const verifyUrl = `${siteUrl}/api/pro/verify?token=${token}`;
  if (env.RESEND_API_KEY) {
    const html = `
<!doctype html><html><body style="margin:0;padding:0;background:#f6f1e8;font-family:Georgia,serif;color:#2a2419">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b8965a;margin-bottom:8px">Folio &amp; Forever Pro</div>
    <h1 style="font-size:24px;margin:0 0 14px;font-weight:400">Sign in link</h1>
    <p style="font-size:14px;line-height:1.7">Click the button below to sign into your photographer dashboard. The link is good for 15 minutes.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;background:#b8965a;color:#0e0c09;padding:14px 28px;text-decoration:none;border-radius:4px;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sign in to dashboard</a>
    </p>
    <p style="font-size:12px;color:#8a7d68">Didn&rsquo;t request this? Ignore the email — the link expires on its own.</p>
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
          to: [email],
          subject: 'Your Folio & Forever sign-in link',
          html,
        }),
      });
    } catch (e) {
      console.warn('Folio pro/login: magic email failed', e);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
