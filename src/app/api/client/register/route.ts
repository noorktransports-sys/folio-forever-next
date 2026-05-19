/**
 * POST /api/client/register
 *
 * Step 1 of the new-client email gate. Takes name + email + phone,
 * emails a 6-digit verification code (Resend), and parks the pending
 * registration in KV for 10 minutes. No account/password — the code
 * proves the email is real and reachable.
 *
 * Body:   { name, email, phone }
 * Returns:{ ok: true }  (we don't reveal whether the email "exists")
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { sendResendEmail } from '@/lib/smart-order-emails';

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
  CLIENT_FROM_EMAIL?: string;
}

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';
const CODE_TTL_SECONDS = 600; // 10 minutes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
      ? '&lt;'
      : c === '>'
      ? '&gt;'
      : c === '"'
      ? '&quot;'
      : '&#39;',
  );
}

function codeEmailHtml(name: string, code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0e0c09;padding:40px 0;font-family:Georgia,serif;">
  <div style="max-width:480px;margin:0 auto;background:#1a1611;border:1px solid #b8965a33;border-radius:14px;padding:36px;">
    <p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#b8965a;margin:0 0 18px;">Folio &amp; Forever</p>
    <h1 style="font-size:20px;color:#f3ece0;margin:0 0 12px;font-weight:500;">Verify your email</h1>
    <p style="font-size:13px;color:#c9bda9;line-height:1.7;margin:0 0 24px;">
      Hi ${esc(name) || 'there'}, here is your verification code to start designing your album:
    </p>
    <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#b8965a;text-align:center;background:#0e0c09;border:1px solid #b8965a33;border-radius:10px;padding:18px 0;margin:0 0 24px;">
      ${code}
    </div>
    <p style="font-size:12px;color:#8a7c66;line-height:1.7;margin:0;">
      This code expires in 10 minutes. If you didn't request it, you can ignore this email.
    </p>
  </div>
</body></html>`;
}

export async function POST(request: Request) {
  let body: { name?: string; email?: string; phone?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid request' }, 400);
  }

  const name = (body.name || '').trim().slice(0, 80);
  const email = (body.email || '').trim().toLowerCase().slice(0, 160);
  const phone = (body.phone || '').trim().slice(0, 40);

  if (!name) return json({ ok: false, error: 'Please enter your name' }, 400);
  if (!EMAIL_RE.test(email))
    return json({ ok: false, error: 'Please enter a valid email address' }, 400);
  if (phone.replace(/\D/g, '').length < 7)
    return json({ ok: false, error: 'Please enter a valid phone number' }, 400);

  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return json({ ok: false, error: 'Storage unavailable' }, 500);
  if (!env.RESEND_API_KEY)
    return json({ ok: false, error: 'Email service not configured' }, 500);

  // 6-digit numeric code.
  const code = String(Math.floor(100000 + Math.random() * 900000));

  await env.DESIGN_DRAFTS.put(
    `clientcode:${email}`,
    JSON.stringify({ code, name, phone, createdAt: Date.now(), attempts: 0 }),
    { expirationTtl: CODE_TTL_SECONDS },
  );

  const from = env.CLIENT_FROM_EMAIL || DEFAULT_FROM;
  const sent = await sendResendEmail(env.RESEND_API_KEY, {
    from,
    to: [email],
    subject: `Your Folio & Forever verification code: ${code}`,
    html: codeEmailHtml(name, code),
  });

  if (!sent.ok) {
    return json(
      { ok: false, error: 'Could not send the email. Please try again.' },
      502,
    );
  }

  return json({ ok: true });
}
