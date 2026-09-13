/**
 * POST /api/admin/orders/bulk-status
 *
 * Update status for multiple orders in one call. Used by the admin
 * orders list for "mark these 5 as shipped" workflows.
 *
 * Body: { tokens: string[], status: string, note?: string }
 *
 * Each token gets the same status update + note. We rewrite the orders
 * index ONCE after all per-order writes finish, so the dashboard
 * reflects everything in one read. Each order's statusHistory gets
 * its own entry.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthed } from '@/lib/admin-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = new Set([
  'submitted',
  'in_progress',
  'pending_payment',
  'in_design',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
]);

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
}

const ORDERS_INDEX_KEY = '_orders_index_v1';
const TTL = 365 * 24 * 60 * 60;

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) {
    return err(401, 'unauthorized');
  }
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');

  let body: { tokens?: unknown; status?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err(400, 'invalid body');
  }
  const tokens = Array.isArray(body.tokens)
    ? (body.tokens.filter((t) => typeof t === 'string' && /^[a-f0-9]{8,64}$/i.test(t)) as string[])
    : [];
  const status = typeof body.status === 'string' ? body.status : '';
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined;
  if (tokens.length === 0) return err(400, 'no tokens');
  if (tokens.length > 100) return err(400, 'too many tokens (max 100 per call)');
  if (!ALLOWED_STATUSES.has(status)) return err(400, 'invalid status');

  // Process each order. Don't bail on individual failures — return a
  // per-token result map so the UI can show which succeeded.
  const at = new Date().toISOString();
  const results: Record<string, { ok: boolean; error?: string }> = {};
  for (const token of tokens) {
    try {
      const raw = await env.DESIGN_DRAFTS.get(token);
      if (!raw) {
        results[token] = { ok: false, error: 'not found' };
        continue;
      }
      let design: {
        status?: string;
        statusHistory?: Array<{ status: string; at: string; by: string; note?: string }>;
        [k: string]: unknown;
      };
      try {
        design = JSON.parse(raw);
      } catch {
        results[token] = { ok: false, error: 'corrupt' };
        continue;
      }
      // Bulk path refuses the locked-after-paid transitions outright
      // (no force flag here — bulk forcing is dangerous).
      if (design.status === 'paid' && (status === 'pending_payment' || status === 'cancelled')) {
        results[token] = { ok: false, error: 'locked (use single-order endpoint with force)' };
        continue;
      }
      design.status = status;
      const history = Array.isArray(design.statusHistory) ? design.statusHistory : [];
      history.push({ status, at, by: 'admin', note });
      design.statusHistory = history;
      await env.DESIGN_DRAFTS.put(token, JSON.stringify(design), { expirationTtl: TTL });
      results[token] = { ok: true };
    } catch (e) {
      results[token] = { ok: false, error: String(e) };
    }
  }

  // Rewrite the orders index once
  try {
    const indexRaw = await env.DESIGN_DRAFTS.get(ORDERS_INDEX_KEY);
    if (indexRaw) {
      const index = JSON.parse(indexRaw) as Array<Record<string, unknown>>;
      const succeeded = new Set(Object.entries(results).filter(([, r]) => r.ok).map(([t]) => t));
      for (let i = 0; i < index.length; i++) {
        const tok = index[i].token;
        if (typeof tok === 'string' && succeeded.has(tok)) {
          index[i] = { ...index[i], status };
        }
      }
      await env.DESIGN_DRAFTS.put(ORDERS_INDEX_KEY, JSON.stringify(index));
    }
  } catch (e) {
    console.warn('[bulk-status] index update failed', e);
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
