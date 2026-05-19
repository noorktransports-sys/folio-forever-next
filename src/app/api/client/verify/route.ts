/**
 * POST /api/client/verify
 *
 * Step 2 of the new-client email gate. Checks the 6-digit code against
 * the pending registration in KV. On success it:
 *   - stores the client in the registry (`client:{email}`) + an index
 *   - clears the one-time code
 *   - sets a signed `ff_client` cookie so they don't re-verify
 *
 * Body:   { email, code }
 * Returns:{ ok: true, name }  + Set-Cookie
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { buildClientCookie } from '@/lib/client-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  TOKEN_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
}

const CLIENTS_INDEX_KEY = '_clients_index_v1';
const MAX_ATTEMPTS = 6;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

interface PendingCode {
  code: string;
  name: string;
  phone: string;
  createdAt: number;
  attempts: number;
}

export async function POST(request: Request) {
  let body: { email?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid request' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase().slice(0, 160);
  const code = (body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return json({ ok: false, error: 'Enter the 6-digit code from your email' }, 400);
  }

  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return json({ ok: false, error: 'Storage unavailable' }, 500);

  const key = `clientcode:${email}`;
  const raw = await env.DESIGN_DRAFTS.get(key);
  if (!raw) {
    return json(
      { ok: false, error: 'Code expired. Please request a new one.' },
      400,
    );
  }

  let pending: PendingCode;
  try {
    pending = JSON.parse(raw) as PendingCode;
  } catch {
    return json({ ok: false, error: 'Code expired. Please request a new one.' }, 400);
  }

  if ((pending.attempts ?? 0) >= MAX_ATTEMPTS) {
    await env.DESIGN_DRAFTS.delete(key);
    return json(
      { ok: false, error: 'Too many tries. Please request a new code.' },
      429,
    );
  }

  if (pending.code !== code) {
    await env.DESIGN_DRAFTS.put(
      key,
      JSON.stringify({ ...pending, attempts: (pending.attempts ?? 0) + 1 }),
      { expirationTtl: 600 },
    );
    return json({ ok: false, error: 'Incorrect code. Try again.' }, 400);
  }

  // Verified — persist the client and clear the code.
  const client = {
    name: pending.name,
    email,
    phone: pending.phone,
    verifiedAt: new Date().toISOString(),
  };
  try {
    await env.DESIGN_DRAFTS.put(`client:${email}`, JSON.stringify(client));
    const idxRaw = await env.DESIGN_DRAFTS.get(CLIENTS_INDEX_KEY);
    const idx: string[] = idxRaw ? (JSON.parse(idxRaw) as string[]) : [];
    if (!idx.includes(email)) {
      idx.push(email);
      await env.DESIGN_DRAFTS.put(CLIENTS_INDEX_KEY, JSON.stringify(idx));
    }
    await env.DESIGN_DRAFTS.delete(key);
  } catch {
    // Non-fatal — verification still succeeds for the session.
  }

  const secret =
    env.TOKEN_ENCRYPTION_KEY || env.RESEND_API_KEY || 'ff-client-fallback-secret';
  const cookie = await buildClientCookie(secret, email);

  return json({ ok: true, name: pending.name }, 200, { 'Set-Cookie': cookie });
}
