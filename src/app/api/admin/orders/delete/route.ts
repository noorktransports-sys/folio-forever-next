/**
 * POST /api/admin/orders/delete — PERMANENTLY delete orders that are in Junk.
 * Body: { tokens?: string[], all?: boolean, confirm: 'DELETE' }
 *
 * Deletes the order record, its files in R2 and its index entry; leaves a
 * `deleted_order:{orderId}` audit record. Orders not in Junk are skipped.
 * Works in batches — returns { remaining } and the admin UI repeats the
 * call until it reaches 0.
 */

import { getRequestContext } from '@cloudflare/next-on-pages'
import { isAuthed } from '@/lib/admin-auth'
import { deleteJunkOrders, type JunkKV, type JunkR2 } from '@/lib/order-junk'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface Env {
  DESIGN_DRAFTS?: JunkKV
  PHOTOS?: JunkR2
  ADMIN_PASSWORD?: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env }
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) return json(401, { error: 'unauthorized' })
  if (!env.DESIGN_DRAFTS) return json(503, { error: 'storage unavailable' })
  let body: { tokens?: unknown; all?: unknown; confirm?: unknown }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid body' })
  }
  if (body.confirm !== 'DELETE') return json(400, { error: 'Type DELETE to confirm' })
  const tokens =
    body.all === true
      ? ('all' as const)
      : (Array.isArray(body.tokens) ? body.tokens : [])
          .filter((t): t is string => typeof t === 'string' && /^[a-f0-9]{8,64}$/i.test(t))
          .slice(0, 500)
  if (tokens !== 'all' && !tokens.length) return json(400, { error: 'no orders selected' })
  try {
    const r = await deleteJunkOrders(env.DESIGN_DRAFTS, env.PHOTOS, tokens)
    return json(200, { ok: true, ...r, filesSkipped: !env.PHOTOS })
  } catch (e) {
    console.warn('[admin/delete] failed', e)
    return json(500, { error: 'Delete failed part-way — press again to continue' })
  }
}
