/**
 * GET /api/admin/square-health   (admin login required)
 *
 * One-click check of the Square setup, read at RUNTIME from the Cloudflare
 * request context — exactly what checkout and the webhook will use:
 *   • which mode SQUARE_ENV resolves to (sandbox / production) and the API host
 *   • which Square settings are present (never their values)
 *   • whether the access token works in that mode (calls Square's Locations API)
 *   • whether SQUARE_LOCATION_ID belongs to that token
 *   • the exact webhook URL the signature check expects
 */

import { getRequestContext } from '@cloudflare/next-on-pages'
import { isAuthed } from '@/lib/admin-auth'
import { squareApiBase, squareEnvName } from '@/lib/square'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface Env {
  DESIGN_DRAFTS?: { get(key: string): Promise<string | null> }
  ADMIN_PASSWORD?: string
  SQUARE_ENV?: string
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_LOCATION_ID?: string
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string
  SITE_URL?: string
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const mask = (v: string) => (v.length <= 6 ? '•••' : `${v.slice(0, 3)}…${v.slice(-3)}`)

export async function GET(request: Request) {
  const { env } = getRequestContext() as { env: Env }
  if (!(await isAuthed(request, env.ADMIN_PASSWORD))) return json({ error: 'unauthorized — log in at /admin first' }, 401)

  const mode = squareEnvName(env.SQUARE_ENV)
  const apiHost = squareApiBase(mode)
  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '')
  const token = (env.SQUARE_ACCESS_TOKEN ?? '').trim()
  const locationId = (env.SQUARE_LOCATION_ID ?? '').trim()

  // Safe fingerprint of what's stored (never the value): lets the owner
  // compare it with the token on Square's page without sharing it.
  const raw = env.SQUARE_ACCESS_TOKEN ?? ''
  const kind = token.startsWith('sandbox-sq0idb')
    ? 'WRONG VALUE: this is the Sandbox APPLICATION ID, not the access token'
    : token.startsWith('sandbox-sq0csb')
      ? 'WRONG VALUE: this is the Sandbox APPLICATION SECRET, not the access token'
      : token.startsWith('sq0idp')
        ? 'WRONG VALUE: this is the Production APPLICATION ID'
        : token.startsWith('sq0csp')
          ? 'WRONG VALUE: this is the Production APPLICATION SECRET'
          : token.startsWith('EAAA')
            ? 'looks like an access token (sandbox and production look alike)'
            : token
              ? 'does not look like a Square access token (should start with EAAA)'
              : 'empty'
  const tokenFingerprint = {
    length: token.length,
    startsWith: token.slice(0, 4),
    endsWith: token.slice(-4),
    kind,
    hadExtraSpacesOrQuotes: raw !== token || /["'\s]/.test(token),
  }

  const out: Record<string, unknown> = {
    tokenFingerprint,
    mode,
    squareEnvRaw: env.SQUARE_ENV === undefined ? '(not set → production)' : JSON.stringify(env.SQUARE_ENV),
    apiHost,
    present: {
      SQUARE_ACCESS_TOKEN: !!token,
      SQUARE_LOCATION_ID: !!locationId,
      SQUARE_WEBHOOK_SIGNATURE_KEY: !!(env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? '').trim(),
    },
    webhookUrlExpected: `${siteUrl}/api/square-webhook`,
  }

  if (token) {
    try {
      const r = await fetch(`${apiHost}/v2/locations`, {
        headers: { 'Square-Version': '2024-12-18', Authorization: `Bearer ${token}` },
      })
      if (r.status === 401) {
        out.token = `REJECTED by ${mode} Square — this token is probably from the other mode (sandbox vs production), or was pasted wrong`
      } else if (!r.ok) {
        out.token = `Square returned HTTP ${r.status}`
      } else {
        const j = (await r.json()) as { locations?: { id: string; name?: string; status?: string }[] }
        const locs = j.locations ?? []
        out.token = `OK — accepted by ${mode} Square`
        out.locations = locs.map((l) => ({ id: mask(l.id), name: l.name, status: l.status, matchesSetting: l.id === locationId }))
        out.locationId = !locationId
          ? 'SQUARE_LOCATION_ID not set'
          : locs.some((l) => l.id === locationId)
            ? 'OK — belongs to this token'
            : `MISMATCH — ${mask(locationId)} is not one of this token's locations (wrong mode or wrong account)`
      }
    } catch (e) {
      out.token = `Could not reach Square: ${e instanceof Error ? e.message : 'error'}`
    }
  }
  // Square's exact reason for the most recent failed checkout, if any.
  try {
    const last = await env.DESIGN_DRAFTS?.get('square:last-checkout-error')
    out.lastCheckoutError = last ? JSON.parse(last) : null
  } catch {
    out.lastCheckoutError = null
  }
  out.ready =
    out.token === `OK — accepted by ${mode} Square` && out.locationId === 'OK — belongs to this token' && (out.present as Record<string, boolean>).SQUARE_WEBHOOK_SIGNATURE_KEY
  return json(out)
}
