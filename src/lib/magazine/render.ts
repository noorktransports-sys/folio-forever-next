// src/lib/magazine/render.ts
//
// Browser-side renderer for ONE magazine page → JPEG. Mirrors
// MagPageView layer for layer so the print file matches the proof:
//   background (colour / blurred photo + dim + tint) → decor blocks →
//   photos in z-order (cover-fit, pan, zoom, rotate, circle clip, B&W,
//   keyline frame) → overlay (cover shading, barcode) → text.
//
// Print: 3300 px tall (11 in × 300 DPI) → 2550 × 3300, 95% JPEG with a
// 300-DPI header (encodePrintJpeg). Preview: smaller + watermark.

import { effectiveZoom } from '@/lib/smart-layout/rotate-cover'
import { encodePrintJpeg } from '@/app/design/smart/edit/jpeg-print'
import { MAG_ASPECT, drawMagOverlay, type MagPage } from './kit'
import { magSlotBox, MAG_PRINT_LONG_EDGE_PX } from './pages'
import { drawMagTexts, type MagMeta, type MagText } from './text'

export type MagRenderPhoto = { preview: string; width: number; height: number }
export type MagRenderAdjust = { panX: number; panY: number; zoom: number; rotate?: number }

export type MagRenderInput = {
  page: MagPage
  photoIds: (string | null)[]
  photos: Map<string, MagRenderPhoto>
  /** keyed `${page.id}::${slotIdx}` */
  adjusts: Record<string, MagRenderAdjust>
  texts: MagText[]
  meta: MagMeta
  /** Page height in px (default 3300 = print). */
  heightPx?: number
  /** Diagonal "FOLIO FOREVER · PREVIEW" watermark + lighter JPEG. */
  watermark?: boolean
}

const imgCache = new Map<string, Promise<HTMLImageElement>>()
function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imgCache.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image failed to load'))
      img.src = src
    })
    imgCache.set(src, p)
  }
  return p
}

/** Cover-fit an image into a box (object-fit: cover + object-position). */
function coverRect(iw: number, ih: number, bw: number, bh: number, panX: number, panY: number) {
  const s = Math.max(bw / iw, bh / ih)
  const cw = iw * s
  const ch = ih * s
  return { cw, ch, left: ((bw - cw) * panX) / 100, top: ((bh - ch) * panY) / 100 }
}

export async function renderMagPage(input: MagRenderInput): Promise<Blob> {
  const { page } = input
  const H = Math.round(input.heightPx ?? MAG_PRINT_LONG_EDGE_PX)
  const W = Math.round(H * MAG_ASPECT)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  const slots = page.slots.map(magSlotBox)
  const imgs = await Promise.all(
    input.photoIds.map(async (id) => {
      const ph = id ? input.photos.get(id) : undefined
      if (!ph) return null
      try {
        return await loadImage(ph.preview)
      } catch {
        return null
      }
    }),
  )

  // 1 — background
  const bg = page.bg
  ctx.fillStyle = bg.kind === 'color' ? bg.color : '#ffffff'
  ctx.fillRect(0, 0, W, H)
  if (bg.kind === 'blur') {
    const bgImg = imgs[bg.slot]
    if (bgImg) {
      const r = coverRect(bgImg.naturalWidth, bgImg.naturalHeight, W, H, 50, 50)
      ctx.save()
      ctx.filter = `blur(${(bg.blur / 100) * W}px)`
      ctx.drawImage(bgImg, r.left, r.top, r.cw, r.ch)
      ctx.restore()
      ctx.fillStyle = `rgba(0,0,0,${bg.dim})`
      ctx.fillRect(0, 0, W, H)
      if (bg.tint) {
        ctx.fillStyle = bg.tint
        ctx.fillRect(0, 0, W, H)
      }
    }
  }

  // 2 — decor
  for (const d of page.decor ?? []) {
    ctx.fillStyle = d.fill === 'accent' ? page.accent ?? '#000000' : d.fill
    ctx.fillRect((d.x / 100) * W, (d.y / 100) * H, (d.w / 100) * W, (d.h / 100) * H)
  }

  // 3 — photos, in paint order
  const order = slots
    .map((s, i) => ({ i, z: s.z ?? 0 }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((x) => x.i)
  for (const i of order) {
    const s = slots[i]
    const img = imgs[i]
    if (!img) continue
    const bx = (s.x / 100) * W
    const by = (s.y / 100) * H
    const bw = (s.w / 100) * W
    const bh = (s.h / 100) * H
    const circle = s.shape === 'circle'
    const adj = input.adjusts[`${page.id}::${i}`] ?? { panX: 50, panY: 50, zoom: 1, rotate: 0 }
    const rot = adj.rotate ?? 0
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    const z = effectiveZoom(adj.zoom, iw / ih, bw / bh, rot)
    const r = coverRect(iw, ih, bw, bh, adj.panX, adj.panY)
    const dx = ((adj.panX - 50) / 100) * bw
    const dy = ((adj.panY - 50) / 100) * bh

    ctx.save()
    ctx.beginPath()
    if (circle) ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2)
    else ctx.rect(bx, by, bw, bh)
    ctx.clip()
    // Same transform as SlotImage: rotate about the frame centre, then
    // zoom about the pan point.
    ctx.translate(bx + bw / 2, by + bh / 2)
    ctx.rotate((rot * Math.PI) / 180)
    ctx.translate(dx, dy)
    ctx.scale(z, z)
    ctx.translate(-dx, -dy)
    ctx.translate(-(bx + bw / 2), -(by + bh / 2))
    if (s.filter === 'bw') ctx.filter = 'grayscale(1)'
    ctx.drawImage(img, bx + r.left, by + r.top, r.cw, r.ch)
    ctx.restore()

    // keyline frame (drawn inside the box, like the CSS border)
    if (s.frame && s.frame.pct > 0) {
      const lw = Math.max(1, (s.frame.pct / 100) * W)
      ctx.save()
      ctx.strokeStyle = s.frame.color
      ctx.lineWidth = lw
      ctx.beginPath()
      if (circle) ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2 - lw / 2, bh / 2 - lw / 2, 0, 0, Math.PI * 2)
      else ctx.rect(bx + lw / 2, by + lw / 2, bw - lw, bh - lw)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 4 — overlay (cover shading, barcode, rules)
  drawMagOverlay(ctx, page.overlay, W, H)

  // 5 — text
  await drawMagTexts(ctx, input.texts, input.meta, W, H)

  if (input.watermark) {
    const fs = Math.round(W / 16)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate(-Math.PI / 6)
    ctx.font = `600 ${fs}px "Montserrat", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,255,255,0.32)'
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'
    ctx.lineWidth = Math.max(1, fs / 40)
    for (let k = -3; k <= 3; k++) {
      const txt = 'FOLIO FOREVER · PREVIEW'
      ctx.strokeText(txt, 0, k * fs * 3.2)
      ctx.fillText(txt, 0, k * fs * 3.2)
    }
    ctx.restore()
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.72),
    )
  }
  return encodePrintJpeg(canvas, 300)
}
