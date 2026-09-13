/**
 * /api/pro/cover-templates/[id]
 *
 *   GET    → load one template (returns the full CoverState)
 *   DELETE → remove a template
 *
 * Both require a valid pro_session cookie AND that the {id} belongs to
 * the logged-in photographer's account — we never let one photographer
 * read or delete another's templates.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { readProSession } from '@/lib/photographer-auth';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

interface IndexEntry {
  id: string;
  name: string;
  savedAt: number;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function indexKey(accountId: string) {
  return `pro_cover_template_index:${accountId}`;
}
function templateKey(accountId: string, templateId: string) {
  return `pro_cover_template:${accountId}:${templateId}`;
}

function validId(id: string): boolean {
  return /^[a-f0-9]{8,40}$/i.test(id);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');
  const accountId = await readProSession(request, env.ADMIN_PASSWORD);
  if (!accountId) return err(401, 'not logged in');

  const { id } = await params;
  if (!validId(id)) return err(400, 'invalid template id');

  const raw = await env.DESIGN_DRAFTS.get(templateKey(accountId, id));
  if (!raw) return err(404, 'template not found');

  // We hand the saved record back verbatim — { id, name, savedAt, state }.
  return new Response(raw, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');
  const accountId = await readProSession(request, env.ADMIN_PASSWORD);
  if (!accountId) return err(401, 'not logged in');

  const { id } = await params;
  if (!validId(id)) return err(400, 'invalid template id');

  await env.DESIGN_DRAFTS.delete(templateKey(accountId, id));

  // Also update the listing index so this template stops appearing
  // in the photographer's gallery on next list.
  const idxRaw = await env.DESIGN_DRAFTS.get(indexKey(accountId));
  if (idxRaw) {
    try {
      const parsed = JSON.parse(idxRaw) as IndexEntry[];
      if (Array.isArray(parsed)) {
        const next = parsed.filter((e) => e.id !== id);
        await env.DESIGN_DRAFTS.put(indexKey(accountId), JSON.stringify(next));
      }
    } catch {
      /* leave the index alone if it's malformed — list will heal it */
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
