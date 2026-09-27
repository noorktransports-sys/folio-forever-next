/**
 * POST /api/giveaway-code   Body: { code }
 *
 * Checks a printed coupon code (50% off the magazine) BEFORE the print files are
 * prepared, so the couple sees right away whether it works. Nothing is
 * reserved here — /api/submit-magazine-order checks again and holds it.
 * Magazine only: album checkouts never call this.
 */

import { getRequestContext } from '@cloudflare/next-on-pages'
import { checkGiveawayCode, GIVEAWAY, type GiveawayKV } from '@/lib/giveaway'
import { allowRequest, tooMany } from '@/lib/rate-limit'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  let body: { code?: unknown }
  try {
    body = (await request.json()) as { code?: unknown }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const { env } = getRequestContext() as { env: { DESIGN_DRAFTS?: GiveawayKV } }
  if (!env.DESIGN_DRAFTS) return json({ error: 'Storage not configured' }, 500)
  // Brake on guessing: 12 tries per 10 minutes per IP.
  if (!(await allowRequest(env.DESIGN_DRAFTS, request, 'giveaway', 12, 600))) return tooMany()

  const r = await checkGiveawayCode(env.DESIGN_DRAFTS, body.code)
  if (!r.ok) return json({ ok: false, error: r.error })
  return json({
    ok: true,
    code: r.display,
    test: r.test,
    magazineUsd: GIVEAWAY.magazineUsd,
    offLabel: GIVEAWAY.offLabel,
    endsLabel: GIVEAWAY.endsLabel,
  })
}
