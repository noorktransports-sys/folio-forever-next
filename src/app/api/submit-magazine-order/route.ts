/**
 * POST /api/submit-magazine-order
 *
 * Saves a PENDING_PAYMENT magazine order (the 20 print pages are already
 * uploaded to R2 by the browser). The PRICE IS DECIDED HERE, not by the
 * client: MAG_PRICE ($70) + the chosen delivery option from lib/shipping.ts
 * (unset / 0 = shipping arranged separately).
 *
 * Body: {
 *   albumId, styleId, meta:{bride,groom,date},
 *   customer:{name,email},
 *   shipping:{recipientName,phone,line1,line2?,city,region,postalCode,country,notes?},
 *   pages:[{n, key, url}] (exactly 20, R2 keys under designs/),
 *   photoCount, emptyFrames,
 *   proofApproval:{acceptedAt,clauseVersion,clauseText},
 *   contentRights:{acceptedAt,clauseVersion,copyrightClause,policyClause}
 * }
 * Returns: { ok, orderId, token, total }
 */

import { getRequestContext } from '@cloudflare/next-on-pages'
import { sendResendEmail, customerOrderReceivedEmailHtml } from '@/lib/smart-order-emails'
import { MAG_PAGE_COUNT, MAG_PRICE, getMagStyle, MAG_STYLES } from '@/lib/magazine/pages'
import { ownerMagazineEmailHtml, type MagazineOrderEmail } from '@/lib/magazine/emails'
import { getShipping, shippingText } from '@/lib/shipping'

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
  OWNER_EMAIL?: string
  MAGAZINE_SHIPPING_USD?: string
}

const DEFAULT_FROM = 'Folio Forever <orders@folioforever.com>'
const DEFAULT_OWNER = 'noorktransports@gmail.com'
const ORDERS_INDEX_KEY = '_orders_index_v1'
const TTL = 365 * 24 * 60 * 60

type Payload = {
  albumId?: string
  styleId?: string
  meta?: { bride?: string; groom?: string; date?: string }
  customer?: { name?: string; email?: string }
  shipping?: Record<string, string | undefined>
  pages?: { n: number; key: string; url: string }[]
  shippingMethod?: string
  demoPhotos?: number
  photoCount?: number
  emptyFrames?: number
  proofApproval?: { acceptedAt?: string; clauseVersion?: string; clauseText?: string }
  contentRights?: { acceptedAt?: string; clauseVersion?: string; copyrightClause?: string; policyClause?: string }
}

function err(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })
}
function mintToken(): string {
  const arr = new Uint8Array(6)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(request: Request) {
  let p: Payload
  try {
    p = (await request.json()) as Payload
  } catch {
    return err(400, 'Invalid JSON')
  }
  const { env } = getRequestContext() as { env: Env }
  if (!env.DESIGN_DRAFTS) return err(500, 'Storage not configured')

  const name = str(p.customer?.name, 120)
  const email = str(p.customer?.email, 200).toLowerCase()
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(400, 'Name and a valid email are required')
  const sh = p.shipping ?? {}
  const shipping = {
    recipientName: str(sh.recipientName, 120) || name,
    phone: str(sh.phone, 40),
    line1: str(sh.line1),
    line2: str(sh.line2),
    city: str(sh.city, 100),
    region: str(sh.region, 100),
    postalCode: str(sh.postalCode, 20),
    country: str(sh.country, 60) || 'United States',
    notes: str(sh.notes, 500),
    method: getShipping(p.shippingMethod).id as string,
    methodLabel: shippingText(getShipping(p.shippingMethod)),
  }
  if (!shipping.line1 || !shipping.city || !shipping.postalCode) return err(400, 'Shipping address is incomplete')
  if (!p.proofApproval?.acceptedAt || !p.contentRights?.acceptedAt) return err(400, 'Proof approval and content rights are required')
  if (Number(p.demoPhotos ?? 0) > 0) return err(400, 'Demo photos can’t be ordered — please upload your own photos')
  if (!p.styleId || !MAG_STYLES.some((s) => s.id === p.styleId)) return err(400, 'Unknown magazine style')
  const style = getMagStyle(p.styleId)

  const pages = Array.isArray(p.pages) ? p.pages : []
  if (pages.length !== MAG_PAGE_COUNT) return err(400, `Expected ${MAG_PAGE_COUNT} pages`)
  for (const pg of pages) {
    if (typeof pg.key !== 'string' || !pg.key.startsWith('designs/') || typeof pg.url !== 'string' || !pg.url.startsWith('/api/photo/designs/')) {
      return err(400, 'Invalid page file')
    }
  }
  pages.sort((a, b) => a.n - b.n)

  const price = MAG_PRICE
  // Delivery speed chosen by the client; the PRICE comes from lib/shipping.
  const ship = getShipping(p.shippingMethod)
  const shippingUsd = ship.usd
  const total = price + shippingUsd
  const token = mintToken()
  const orderId = `FF-M${token.slice(0, 5).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
  const submittedAt = new Date().toISOString()
  const names = [str(p.meta?.bride, 40), str(p.meta?.groom, 40)].filter(Boolean).join(' & ')
  const date = str(p.meta?.date, 40)
  const albumName = `Magazine · ${style.name}${names ? ` · ${names}` : ''}`
  const clientIp = request.headers.get('cf-connecting-ip')
  const userAgent = request.headers.get('user-agent')

  const record = {
    mode: 'magazine' as const,
    token,
    orderId,
    status: 'pending_payment',
    submittedAt,
    albumId: str(p.albumId, 64),
    albumName,
    customer: { name, email },
    shipping,
    // `album` keeps admin + shared code happy (size/pageCount/total).
    album: { size: '8.5x11', type: 'magazine', pageCount: MAG_PAGE_COUNT, totalPrice: total },
    magazine: { styleId: style.id, styleName: style.name, names, date, price, shippingUsd, shippingLabel: shippingText(ship), photoCount: p.photoCount ?? 0, emptyFrames: p.emptyFrames ?? 0 },
    photos: [],
    spreads: [],
    spreadComposites: pages.map((pg) => ({ spreadId: `page-${String(pg.n).padStart(2, '0')}`, key: pg.key, url: pg.url })),
    proofApproval: p.proofApproval,
    contentRights: p.contentRights,
    auditClientIp: clientIp,
    auditUserAgent: userAgent,
  }

  try {
    await env.DESIGN_DRAFTS.put(token, JSON.stringify(record), { expirationTtl: TTL })
    await env.DESIGN_DRAFTS.put(
      `proof_approval:${orderId}`,
      JSON.stringify({ orderId, token, customer: record.customer, proofApproval: p.proofApproval, pages: record.spreadComposites, clientIp, userAgent, serverReceivedAt: submittedAt }),
      { expirationTtl: TTL },
    )
    await env.DESIGN_DRAFTS.put(
      `content_rights:${orderId}`,
      JSON.stringify({ orderId, token, customer: record.customer, contentRights: p.contentRights, photoCount: p.photoCount ?? 0, clientIp, userAgent, serverReceivedAt: submittedAt }),
      { expirationTtl: TTL },
    )
    const indexRaw = await env.DESIGN_DRAFTS.get(ORDERS_INDEX_KEY)
    const index: Array<Record<string, unknown>> = indexRaw ? JSON.parse(indexRaw) : []
    index.unshift({
      token,
      orderId,
      mode: 'magazine',
      submittedAt,
      customerName: name,
      customerEmail: email,
      albumName,
      size: `Magazine · ${style.name}`,
      spreads: MAG_PAGE_COUNT,
      photoCount: p.photoCount ?? 0,
      totalPrice: total,
      status: 'pending_payment',
      proofApprovedAt: p.proofApproval.acceptedAt,
      rightsAcceptedAt: p.contentRights.acceptedAt,
      clauseVersion: p.proofApproval.clauseVersion ?? null,
    })
    await env.DESIGN_DRAFTS.put(ORDERS_INDEX_KEY, JSON.stringify(index))
  } catch (e) {
    console.warn('[submit-magazine-order] KV failed', e)
    return err(503, 'Could not save the order — please try again')
  }

  if (env.RESEND_API_KEY) {
    const siteUrl = (env.SITE_URL || 'https://folioforever.com').replace(/\/$/, '')
    const data: MagazineOrderEmail = {
      orderId,
      styleName: style.name,
      names,
      date,
      customer: record.customer,
      shipping,
      price,
      shippingUsd,
      shippingLabel: shippingText(ship),
      pages: record.spreadComposites,
    }
    await sendResendEmail(env.RESEND_API_KEY, {
      from: env.ORDER_FROM_EMAIL || DEFAULT_FROM,
      to: [env.OWNER_EMAIL || DEFAULT_OWNER],
      subject: `[PENDING] ${orderId} — ${name} · Magazine ${style.name} · $${total}`,
      html: ownerMagazineEmailHtml(data, siteUrl, 'pending'),
    }).catch(() => undefined)
    // Client gets their order number right away (payment confirmation follows).
    await sendResendEmail(env.RESEND_API_KEY, {
      from: env.ORDER_FROM_EMAIL || DEFAULT_FROM,
      to: [email],
      subject: `Order received — ${orderId} · your wedding magazine`,
      html: customerOrderReceivedEmailHtml(
        {
          orderId,
          customerName: name,
          product: `Wedding magazine · ${style.name}`,
          rows: [
            ['Pages', '20 pages · 8.5 × 11 in'],
            ...(names ? ([['Names', names]] as Array<[string, string]>) : []),
            ['Shipping', `${shippingText(ship)} · $${shippingUsd.toFixed(2)}`],
          ],
          totalDue: total,
          payUrl: `${siteUrl}/api/square-checkout?token=${token}`,
          images: record.spreadComposites.map((c, i) => ({ url: c.url, label: i === 0 ? 'Cover' : String(i + 1) })),
          imageCols: 5,
        },
        siteUrl,
      ),
    }).catch(() => undefined)
  }

  return new Response(JSON.stringify({ ok: true, orderId, token, total }), { headers: { 'Content-Type': 'application/json' } })
}

/** GET → current price + delivery options (for the checkout screen). */
export async function GET() {
  const { SHIPPING_OPTIONS } = await import('@/lib/shipping')
  return new Response(JSON.stringify({ price: MAG_PRICE, shipping: SHIPPING_OPTIONS }), { headers: { 'Content-Type': 'application/json' } })
}
