// src/app/design/smart/edit/render-share-pack.ts
//
// Renders 1080×1920 "Instagram Story"-sized images at submit time so
// the couple has share-ready content for their social channels right
// after the album is ordered. Every share carries a discrete
// "folioforever.com" footer — every couple who posts becomes a free
// marketing channel.
//
// Two cards in v1:
//   1. cover   — the cover composite as a hero, names overlaid, gold
//                folioforever footer
//   2. montage — two spread composites stacked with a wedding-album
//                caption and footer
//
// Both use the canvas API client-side, mirroring the render-spread /
// render-cover pattern so we share the same drawImage / blob-out flow.

const STORY_W = 1080
const STORY_H = 1920
const JPEG_QUALITY = 0.9
const GOLD = '#b8965a'
const CREAM = '#f5f0e6'
const DARK = '#0e0c09'
const FOOTER_TEXT = 'folioforever.com'
const FONT_DISPLAY = '"Cormorant Garamond", Georgia, serif'
const FONT_BODY = 'Georgia, serif'

/** Load a Blob into an HTMLImageElement we can draw onto canvas. */
function loadBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('share card image load failed'))
    }
    img.src = url
  })
}

/**
 * Paint the gold folioforever.com footer at the bottom of any share
 * card. Identical placement across cards so the brand is consistent.
 */
function paintFooter(ctx: CanvasRenderingContext2D): void {
  const y = STORY_H - 110
  ctx.save()
  // Thin divider line above the footer.
  ctx.strokeStyle = GOLD + '88'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(STORY_W / 2 - 110, y - 28)
  ctx.lineTo(STORY_W / 2 + 110, y - 28)
  ctx.stroke()

  ctx.fillStyle = GOLD
  ctx.font = `36px ${FONT_BODY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(FOOTER_TEXT, STORY_W / 2, y)

  // Small "Made with" prefix in cream, above the URL.
  ctx.fillStyle = CREAM + 'aa'
  ctx.font = `22px ${FONT_BODY}`
  ctx.fillText('Made with', STORY_W / 2, y - 52)
  ctx.restore()
}

/**
 * Draw a Blob inside a rectangle using "contain" semantics (preserves
 * aspect ratio, fits within the rect, centred). Returns the actual
 * drawn rect so callers can place text relative to it.
 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): { x: number; y: number; w: number; h: number } {
  const ir = img.naturalWidth / img.naturalHeight
  const fr = rw / rh
  let dw: number
  let dh: number
  if (ir > fr) {
    dw = rw
    dh = rw / ir
  } else {
    dh = rh
    dw = rh * ir
  }
  const dx = rx + (rw - dw) / 2
  const dy = ry + (rh - dh) / 2
  ctx.drawImage(img, dx, dy, dw, dh)
  return { x: dx, y: dy, w: dw, h: dh }
}

/** Common: build the 1080×1920 canvas with a dark background. */
function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = STORY_W
  canvas.height = STORY_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = DARK
  ctx.fillRect(0, 0, STORY_W, STORY_H)
  return { canvas, ctx }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('share card toBlob null'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Card 1 — COVER HERO
 *
 * The album cover composite, scaled to fit a generous safe-area
 * rectangle, with the couple's primary + subtitle text below and the
 * folioforever footer pinned to the bottom.
 */
export async function renderShareCardCover({
  coverBlob,
  primaryText,
  subtitleText,
}: {
  coverBlob: Blob
  primaryText: string
  subtitleText: string
}): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Canvas unavailable')
  const { canvas, ctx } = newCanvas()
  const cover = await loadBlob(coverBlob)

  // Cover sits in the top ~62% of the canvas with margin.
  const coverRect = drawContain(
    ctx,
    cover,
    72,
    180,
    STORY_W - 144,
    Math.round(STORY_H * 0.62) - 180,
  )

  // Names below the cover.
  const textTop = coverRect.y + coverRect.h + 80
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = CREAM

  if (primaryText) {
    ctx.font = `300 96px ${FONT_DISPLAY}`
    ctx.fillText(primaryText, STORY_W / 2, textTop)
  }
  if (subtitleText) {
    ctx.fillStyle = GOLD
    ctx.font = `italic 44px ${FONT_DISPLAY}`
    ctx.fillText(subtitleText, STORY_W / 2, textTop + (primaryText ? 120 : 0))
  }
  ctx.restore()

  paintFooter(ctx)
  return toBlob(canvas)
}

/**
 * Card 2 — SPREAD MONTAGE
 *
 * Two spread composites stacked with a "Our wedding album" caption
 * between them. If only one spread is available we centre it.
 */
export async function renderShareCardMontage({
  spreadBlobs,
  primaryText,
}: {
  /** Take the first 1-2 from the available spread composites. */
  spreadBlobs: Blob[]
  /** Couple's primary text (used in the caption). */
  primaryText: string
}): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Canvas unavailable')
  if (spreadBlobs.length === 0) {
    throw new Error('renderShareCardMontage needs at least 1 spread')
  }
  const { canvas, ctx } = newCanvas()
  const first = spreadBlobs[0]
  const second = spreadBlobs[1] ?? null

  // Two stacked rects with 40 px gap, both centred horizontally.
  const colX = 72
  const colW = STORY_W - 144

  // Caption at top.
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = CREAM
  ctx.font = `300 64px ${FONT_DISPLAY}`
  const captionTop = 180
  ctx.fillText('Our wedding album', STORY_W / 2, captionTop)

  if (primaryText) {
    ctx.fillStyle = GOLD
    ctx.font = `italic 36px ${FONT_DISPLAY}`
    ctx.fillText(primaryText, STORY_W / 2, captionTop + 92)
  }
  ctx.restore()

  // Stack the spreads in the remaining area down to ~140 px above the footer.
  const stackTop = captionTop + (primaryText ? 180 : 120)
  const stackBottom = STORY_H - 200
  const stackH = stackBottom - stackTop
  const gap = 40
  const slotCount = second ? 2 : 1
  const slotH = (stackH - gap * (slotCount - 1)) / slotCount

  const firstImg = await loadBlob(first)
  drawContain(ctx, firstImg, colX, stackTop, colW, slotH)

  if (second) {
    const secondImg = await loadBlob(second)
    drawContain(ctx, secondImg, colX, stackTop + slotH + gap, colW, slotH)
  }

  paintFooter(ctx)
  return toBlob(canvas)
}
