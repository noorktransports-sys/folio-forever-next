/**
 * POST /api/admin/orders/junk — move orders to / out of the Junk folder.
 * Body: { tokens: string[], junk: boolean }
 * Status is not changed; only the junk flag (record + orders index).
 */

import { getRequestContext } from '@cloudflare/next-on-pages'
import { isAuthed } from '@/lib/admin-auth'
import { setJunk, type JunkKV } from '@/lib/order-junk'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface Env {
  DESIGN_DRAFTS?: JunkKV
  ADMIN_PASSWORD?: string
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(request: Request) {
  const { env } = getRequestContext() as { env: Env }
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) return json(401, { error: 'unauthorized' })
  if (!env.DESIGN_DRAFTS) return json(503, { error: 'storage unavailable' })
  let body: { tokens?: unknown; junk?: unknown }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid body' })
  }
  const tokens = (Array.isArray(body.tokens) ? body.tokens : [])
    .filter((t): t is string => typeof t === 'string' && /^[a-f0-9]{8,64}$/i.test(t))
    .slice(0, 200)
  if (!tokens.length) return json(400, { error: 'no orders selected' })
  const junk = body.junk !== false
  const n = await setJunk(env.DESIGN_DRAFTS, tokens, junk)
  return json(200, { ok: true, updated: n })
}
