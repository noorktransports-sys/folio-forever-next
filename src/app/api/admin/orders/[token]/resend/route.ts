/**
 * POST /api/admin/orders/[token]/resend
 *
 * Re-fires the customer confirmation email for a smart-album order.
 * Useful if the original email landed in spam, the customer lost it, or
 * we changed something post-payment.
 *
 * Body: { audience?: 'customer' | 'owner' | 'both' }  // default 'customer'
 *
 * Only works for orders in 'paid' or later — there's nothing to confirm
 * before payment.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';
import {
  customerPaidEmailHtml,
  ownerPaidEmailHtml,
  sendResendEmail,
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
  ADMIN_PASSWORD?: string;
  RESEND_API_KEY?: string;
  SITE_URL?: string;
  ORDER_FROM_EMAIL?: string;
  OWNER_EMAIL?: string;
}

const DEFAULT_FROM = 'Folio & Forever <orders@folioforever.com>';
const DEFAULT_OWNER = 'noorktransports@gmail.com';

const PAID_OR_LATER = new Set([
  'paid',
  'in_design',
  'in_production',
  'shipped',
  'delivered',
  'refunded',
]);

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) {
    return err(401, 'unauthorized');
  }
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');
  if (!env.RESEND_API_KEY) return err(500, 'Resend not configured');

  const { token } = await params;
  if (!/^[a-f0-9]{8,64}$/i.test(token)) return err(400, 'invalid token');

  let body: { audience?: 'customer' | 'owner' | 'both' };
  try {
    body = (await request.json().catch(() => ({}))) as {
      audience?: 'customer' | 'owner' | 'both';
    };
  } catch {
    body = {};
  }
  const audience = body.audience ?? 'customer';

  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) return err(404, 'order not found');
  let order: Record<string, unknown> & {
    orderId?: string;
    status?: string;
    albumName?: string;
    customer?: { name: string; email: string };
    shipping?: SmartOrderEmailData['shipping'];
    album?: SmartOrderEmailData['album'];
    photos?: SmartOrderEmailData['photos'];
    spreads?: SmartOrderEmailData['spreads'];
    spreadComposites?: SmartOrderEmailData['spreadComposites'];
    polishHandoff?: boolean;
    proofApproval?: SmartOrderEmailData['proofApproval'];
    contentRights?: SmartOrderEmailData['contentRights'];
    lowResPhotos?: SmartOrderEmailData['lowResPhotos'];
    auditClientIp?: string | null;
    auditUserAgent?: string | null;
    paidAt?: string;
    squarePaymentId?: string;
  };
  try {
    order = JSON.parse(json);
  } catch {
    return err(500, 'corrupt order record');
  }

  if (!order.status || !PAID_OR_LATER.has(order.status)) {
    return err(400, `Cannot resend confirmation for order in status '${order.status}'`);
  }
  if (!order.customer?.email || !order.album || !order.photos || !order.spreads) {
    return err(400, 'Order missing data needed to build email');
  }

  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '');
  const ownerEmail = env.OWNER_EMAIL || DEFAULT_OWNER;
  const fromEmail = env.ORDER_FROM_EMAIL || DEFAULT_FROM;

  const emailData: SmartOrderEmailData = {
    orderId: order.orderId ?? token,
    albumName: order.albumName ?? 'Album',
    customer: order.customer,
    shipping: order.shipping ?? {
      recipientName: '',
      phone: '',
      line1: '',
      city: '',
      region: '',
      postalCode: '',
      country: '',
    },
    album: order.album,
    photos: order.photos,
    spreads: order.spreads,
    spreadComposites: order.spreadComposites,
    polishHandoff: order.polishHandoff ?? false,
    proofApproval: order.proofApproval,
    contentRights: order.contentRights,
    lowResPhotos: order.lowResPhotos,
  };
  const auditMeta = {
    clientIp: order.auditClientIp ?? null,
    userAgent: order.auditUserAgent ?? null,
    paidAt: order.paidAt,
    stripeSessionId: undefined,
    stripePaymentIntent: order.squarePaymentId,
  };

  let customerSent = false;
  let ownerSent = false;

  if (audience === 'customer' || audience === 'both') {
    const r = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [emailData.customer.email],
      subject: `[Resent] Your album order ${emailData.orderId} is confirmed`,
      html: customerPaidEmailHtml(emailData, siteUrl),
    });
    customerSent = r.ok;
  }
  if (audience === 'owner' || audience === 'both') {
    const r = await sendResendEmail(env.RESEND_API_KEY, {
      from: fromEmail,
      to: [ownerEmail],
      subject: `[Resent · PAID] ${emailData.orderId} — ${emailData.customer.name}`,
      html: ownerPaidEmailHtml(emailData, siteUrl, auditMeta),
    });
    ownerSent = r.ok;
  }

  return new Response(
    JSON.stringify({ ok: true, customerSent, ownerSent }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
