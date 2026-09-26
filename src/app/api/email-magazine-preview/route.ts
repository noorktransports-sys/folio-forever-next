/**
 * POST /api/email-magazine-preview
 *
 * Emails the client their WATERMARKED magazine preview (small JPEGs the
 * browser already rendered + uploaded to R2). Print files are never sent.
 *
 * Body: { email, name?, albumId, styleName, names, pageUrls: string[] (≤ 20) }
 *
 * Abuse limits (KV): 3 sends / hour per IP, 5 / day per recipient.
 */

import { getRequestContext } from '@cloudflare/next-on-pages'
import { sendResendEmail } from '@/lib/smart-order-emails'
import { previewEmailHtml } from '@/lib/magazine/emails'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace
  RESEND_API_KEY?: string
  SITE_URL?: string
  ORDER_FROM_EMAIL?: string
}

const DEFAULT_FROM = 'Folio Forever <orders@folioforever.com>'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function bump(kv: KVNamespace, key: string, limit: number, ttl: number): Promise<boolean> {
  const n = Number((await kv.get(key)) ?? 0)
  if (n >= limit) return false
  await kv.put(key, String(n + 1), { expirationTtl: ttl })
  return true
}

export async function POST(request: Request) {
  let b: { email?: string; name?: string; albumId?: string; styleName?: string; names?: string; pageUrls?: string[]; demoPhotos?: number }
  try {
    b = await request.json()
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }
  if (Number(b.demoPhotos ?? 0) > 0) return json(400, { error: 'Demo photos can’t be emailed — upload your own photos first' })
  const email = (b.email ?? '').trim().toLowerCase().slice(0, 200)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Please enter a valid email address' })
  const pageUrls = (Array.isArray(b.pageUrls) ? b.pageUrls : []).filter(
    (u) => typeof u === 'string' && u.startsWith('/api/photo/designs/') && u.length < 300,
  )
  if (pageUrls.length === 0 || pageUrls.length > 20) return json(400, { error: 'No preview pages' })

  const { env } = getRequestContext() as { env: Env }
  if (!env.RESEND_API_KEY) return json(503, { error: 'Email is not configured yet' })
  if (env.DESIGN_DRAFTS) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const okIp = await bump(env.DESIGN_DRAFTS, `rl:magprev:ip:${ip}`, 3, 3600)
    if (!okIp) return json(429, { error: 'Too many preview emails — please try again in an hour' })
    const okEm = await bump(env.DESIGN_DRAFTS, `rl:magprev:em:${email}`, 5, 86400)
    if (!okEm) return json(429, { error: 'This address has received enough previews today' })
  }

  const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '')
  const albumId = (b.albumId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  const continueUrl = `${siteUrl}/design/magazine${albumId ? `?album=${albumId}` : ''}`
  const names = (b.names ?? '').slice(0, 90) || 'Your wedding magazine'
  const styleName = (b.styleName ?? '').slice(0, 40)

  const res = await sendResendEmail(env.RESEND_API_KEY, {
    from: env.ORDER_FROM_EMAIL || DEFAULT_FROM,
    to: [email],
    subject: `Your wedding magazine preview — ${names}`,
    html: previewEmailHtml({ name: b.name, styleName, names, pages: pageUrls.map((url) => ({ url })), continueUrl, siteUrl }),
  })
  if (!res.ok) return json(502, { error: 'Email could not be sent — please try again' })
  return json(200, { ok: true })
}
