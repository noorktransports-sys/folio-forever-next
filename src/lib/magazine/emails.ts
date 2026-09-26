// src/lib/magazine/emails.ts
//
// Email HTML for magazine orders + the watermarked "email me my design"
// preview. Sent with sendResendEmail (src/lib/smart-order-emails.ts).

import { abs, escapeHtml } from '@/lib/smart-order-emails'

export type MagazineOrderEmail = {
  orderId: string
  styleName: string
  names: string
  date: string
  customer: { name: string; email: string }
  shipping?: {
    recipientName?: string
    phone?: string
    line1?: string
    line2?: string
    city?: string
    region?: string
    postalCode?: string
    country?: string
    notes?: string
  }
  price: number
  shippingUsd: number
  pages: { url: string }[]
}

const wrap = (inner: string) => `<!doctype html><html><body style="margin:0;background:#f6f2ec;font-family:Georgia,'Times New Roman',serif;color:#2a1a12">
<div style="max-width:640px;margin:0 auto;padding:32px 20px">
<div style="text-align:center;letter-spacing:6px;font-size:14px;color:#8a6d3b;margin-bottom:24px">FOLIO FOREVER</div>
${inner}
<div style="text-align:center;font-size:11px;color:#9a8f82;margin-top:32px;font-family:Arial,sans-serif">Folio Forever · Heirloom wedding albums & magazines</div>
</div></body></html>`

function pageGrid(pages: { url: string }[], siteUrl: string, cols = 4): string {
  const cells = pages
    .map(
      (p, i) =>
        `<td style="padding:4px;width:${Math.floor(100 / cols)}%;vertical-align:top"><img src="${escapeHtml(abs(siteUrl, p.url))}" alt="Page ${i + 1}" style="width:100%;display:block;border:1px solid #e3dccf"/><div style="font:10px Arial,sans-serif;color:#9a8f82;text-align:center;padding-top:2px">${i + 1}</div></td>`,
    )
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += cols) rows.push(`<tr>${cells.slice(i, i + cols).join('')}</tr>`)
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table>`
}

function shipBlock(o: MagazineOrderEmail): string {
  const s = o.shipping ?? {}
  const lines = [s.recipientName, s.phone, s.line1, s.line2, [s.city, s.region, s.postalCode].filter(Boolean).join(', '), s.country]
    .filter(Boolean)
    .map((l) => escapeHtml(String(l)))
  return lines.join('<br/>') + (s.notes ? `<br/><em>Notes: ${escapeHtml(s.notes)}</em>` : '')
}

function totals(o: MagazineOrderEmail, paid: boolean): string {
  const ship = o.shippingUsd > 0 ? `$${o.shippingUsd.toFixed(2)}` : 'arranged separately'
  const total = `$${(o.price + o.shippingUsd).toFixed(2)}`
  const line = paid
    ? `<strong>Total paid: ${total}</strong>`
    : `<strong>Total due: ${total}</strong> <span style="color:#b0413e">— NOT PAID YET</span>`
  return `Magazine (20 pages, 8.5×11): $${o.price.toFixed(2)}<br/>Shipping: ${ship}<br/>${line}`
}

export function ownerMagazineEmailHtml(o: MagazineOrderEmail, siteUrl: string, stage: 'pending' | 'paid'): string {
  return wrap(`
<h1 style="font-weight:400;font-size:24px;margin:0 0 6px">${stage === 'paid' ? 'Magazine order PAID' : 'Magazine order started (awaiting payment)'}</h1>
<p style="font:13px Arial,sans-serif;color:#6b5f52;margin:0 0 18px">${escapeHtml(o.orderId)} · ${escapeHtml(o.styleName)} · ${escapeHtml(o.names)} · ${escapeHtml(o.date)}</p>
<p style="font:14px Arial,sans-serif;line-height:1.6"><strong>${escapeHtml(o.customer.name)}</strong> &lt;${escapeHtml(o.customer.email)}&gt;<br/>${shipBlock(o)}</p>
<p style="font:14px Arial,sans-serif;line-height:1.6">${totals(o, stage === 'paid')}</p>
${stage === 'pending' ? '<p style="font:13px Arial,sans-serif;color:#6b5f52">The client was sent to Square to pay. You will get a second “PAID” email when payment goes through — do not print before that.</p>' : ''}
<p style="font:13px Arial,sans-serif">Print files (300 DPI, 2550×3300) are in the admin order page — use “Download print package”.</p>
${pageGrid(o.pages, siteUrl, 5)}`)
}

export function customerMagazineEmailHtml(o: MagazineOrderEmail, siteUrl: string): string {
  return wrap(`
<h1 style="font-weight:400;font-size:28px;text-align:center;margin:0 0 8px">Thank you, ${escapeHtml(o.customer.name.split(' ')[0] || o.customer.name)}</h1>
<p style="text-align:center;font-size:16px;font-style:italic;margin:0 0 20px">Your wedding magazine is on its way to print.</p>
<p style="font:14px Arial,sans-serif;line-height:1.7">Order <strong>${escapeHtml(o.orderId)}</strong><br/>Style: ${escapeHtml(o.styleName)}<br/>${totals(o, true)}</p>
<p style="font:14px Arial,sans-serif;line-height:1.7"><strong>Shipping to</strong><br/>${shipBlock(o)}</p>
<p style="font:13px Arial,sans-serif;color:#6b5f52">These are the pages you approved:</p>
${pageGrid(o.pages, siteUrl, 4)}
<p style="font:13px Arial,sans-serif;color:#6b5f52;margin-top:18px">Questions? Just reply to this email.</p>`)
}

export function previewEmailHtml(opts: {
  name?: string
  styleName: string
  names: string
  pages: { url: string }[]
  continueUrl: string
  siteUrl: string
}): string {
  return wrap(`
<h1 style="font-weight:400;font-size:28px;text-align:center;margin:0 0 6px">${escapeHtml(opts.names)}</h1>
<p style="text-align:center;font-style:italic;font-size:15px;margin:0 0 4px">Your wedding magazine preview · ${escapeHtml(opts.styleName)}</p>
<p style="text-align:center;font:12px Arial,sans-serif;color:#9a8f82;margin:0 0 20px">Preview images are watermarked. Your printed magazine will not be.</p>
${pageGrid(opts.pages, opts.siteUrl, 4)}
<div style="text-align:center;margin:26px 0 8px">
<a href="${escapeHtml(opts.continueUrl)}" style="display:inline-block;background:#b8965a;color:#1a120b;text-decoration:none;font:bold 12px Arial,sans-serif;letter-spacing:2px;padding:14px 26px;border-radius:30px">COME BACK &amp; ORDER · $70</a>
</div>
<p style="text-align:center;font:11px Arial,sans-serif;color:#9a8f82">Open the link on the same device and browser you designed on — your design is saved there.</p>`)
}
