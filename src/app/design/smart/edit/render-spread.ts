// src/app/design/smart/edit/render-spread.ts
//
// Render a single spread (template + photos + per-slot adjustments) into
// a JPEG blob via the browser Canvas API. Used at submit time so the
// confirmation emails can SHOW the album spreads as composed, not just
// list the photos. Without this the owner sees "30 raw photos" and has
// no idea how the album actually looks.
//
// Fidelity notes:
//   • object-fit: cover behaviour is replicated by drawing a larger
//     dest rect inside a clipped slot. panX/panY of overflow position
//     match the CSS behaviour.
//   • Per-slot zoom, rotation, and flip are applied via canvas
//     transforms (translate + rotate + scale) around the slot centre.
//   • Standard albums get a thin gutter line down the centre.
//   • Hero slots get a small gold "HERO" badge in the corner so the
//     printer / design team can spot which photo was the centrepiece.
//
// Output is JPEG at quality 0.85, capped at 2000 px on the long edge.

const COMPOSITE_LONG_EDGE = 2000
const JPEG_QUALITY = 0.85

interface Slot {
  x: number
  y: number
  w: number
  h: number
  isHero?: boolean
}

interface LayoutTemplate {
  id: string
  name: string
  slots: Slot[]
}

interface Photo {
  id: string
  preview: string
  width: number
  height: number
}

interface PhotoAdjust {
  zoom: number
  panX: number
  panY: number
  flipH: boolean
  flipV: boolean
  rotate: number
  fit: 'fill' | 'contain'
}

interface SpreadLike {
  id: string
  templateId: string
  photoIds: (string | null)[]
}

export interface RenderSpreadInput {
  spread: SpreadLike
  template: LayoutTemplate
  /** Lookup by photoId → full Photo with `preview` URL the canvas can load */
  photos: Map<string, Photo>
  /** Lookup by `${spreadId}::${slotIdx}` → PhotoAdjust (may be undefined → default) */
  adjusts: Record<string, PhotoAdjust>
  /** spread width / height — e.g. 24/17 for 17×24 albums */
  spreadAspectRatio: number
  /** Standard albums show a gutter line; layflat doesn't. */
  showGutter: boolean
}

const DEFAULT_ADJUST: PhotoAdjust = {
  zoom: 1,
  panX: 50,
  panY: 50,
  flipH: false,
  flipV: false,
  rotate: 0,
  fit: 'fill',
}

/**
 * Load an <img> we can draw onto canvas. Source can be a blob: URL,
 * an https:// URL, or a data: URL. crossOrigin is set for https so the
 * canvas isn't tainted (sample picsum photos send CORS headers).
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    if (/^https?:\/\//.test(src)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image load failed: ${src.slice(0, 80)}`))
    img.src = src
  })
}

/**
 * Render one spread to a Blob.
 *
 * Algorithm per slot:
 *   1. Carve out a clip rect at the slot's pixel position.
 *   2. Translate to slot centre, apply rotate/flip transforms.
 *   3. Compute cover dimensions (whichever scale fills both width and
 *      height of the slot). Multiply by adj.zoom.
 *   4. Centre the drawn rect, then shift by the pan-offset times the
 *      overflow on each axis — replicates CSS objectPosition.
 *   5. drawImage, restore.
 */
export async function renderSpreadComposite({
  spread,
  template,
  photos,
  adjusts,
  spreadAspectRatio,
  showGutter,
}: RenderSpreadInput): Promise<Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Canvas unavailable on server')
  }
  // Canvas size: long edge at COMPOSITE_LONG_EDGE, preserves aspect.
  const W = COMPOSITE_LONG_EDGE
  const H = Math.round(W / spreadAspectRatio)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context unavailable')

  // White paper background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  for (let i = 0; i < template.slots.length; i++) {
    const slot = template.slots[i]
    const photoId = spread.photoIds[i]
    if (!photoId) continue
    const photo = photos.get(photoId)
    if (!photo) continue
    const adj = adjusts[`${spread.id}::${i}`] ?? DEFAULT_ADJUST

    const sx = (slot.x / 100) * W
    const sy = (slot.y / 100) * H
    const sw = (slot.w / 100) * W
    const sh = (slot.h / 100) * H

    let img: HTMLImageElement
    try {
      img = await loadImage(photo.preview)
    } catch {
      // Skip slots whose image can't be loaded (broken blob URL, CORS, etc.)
      // The slot will appear as the slot-background grey instead.
      ctx.save()
      ctx.fillStyle = '#f5f0e8'
      ctx.fillRect(sx, sy, sw, sh)
      ctx.restore()
      continue
    }

    ctx.save()

    // Clip to slot rect — anything we draw outside this rect is discarded.
    ctx.beginPath()
    ctx.rect(sx, sy, sw, sh)
    ctx.clip()

    // Cover dims at zoom=1: scale image so smaller dimension fills slot.
    const ir = img.naturalWidth / img.naturalHeight
    const sr = sw / sh
    let coverW: number
    let coverH: number
    if (ir > sr) {
      coverH = sh
      coverW = sh * ir
    } else {
      coverW = sw
      coverH = sw / ir
    }
    coverW *= adj.zoom
    coverH *= adj.zoom

    // Anchor at slot centre so rotate/flip pivot is intuitive.
    const cx = sx + sw / 2
    const cy = sy + sh / 2
    ctx.translate(cx, cy)
    if (adj.rotate) ctx.rotate((adj.rotate * Math.PI) / 180)
    if (adj.flipH || adj.flipV) {
      ctx.scale(adj.flipH ? -1 : 1, adj.flipV ? -1 : 1)
    }

    // Pan: panX/Y in % of OVERFLOW. 50/50 = centred (no shift).
    // overflowX > 0 if coverW > sw; same for Y.
    const overflowX = coverW - sw
    const overflowY = coverH - sh
    // CSS objectPosition X=0 → left edge of image at left of slot → image shifted RIGHT.
    // We're drawing centred, so a negative dx means image shifted left visually.
    // Match CSS: panX=0 → all overflow on the RIGHT → centre of image is to the right of slot centre by overflowX/2.
    // Translate the centred draw by (50 - panX) / 100 * overflowX.
    const offsetX = ((50 - adj.panX) / 100) * overflowX
    const offsetY = ((50 - adj.panY) / 100) * overflowY

    ctx.drawImage(
      img,
      -coverW / 2 + offsetX,
      -coverH / 2 + offsetY,
      coverW,
      coverH,
    )
    ctx.restore()

    // Hero badge — small gold pill in the slot's top-left corner.
    if (slot.isHero) {
      ctx.save()
      const padX = sx + 8
      const padY = sy + 8
      const text = 'HERO'
      ctx.font = `bold ${Math.round(W / 140)}px sans-serif`
      const metrics = ctx.measureText(text)
      const tw = metrics.width + 14
      const th = Math.round(W / 95)
      ctx.fillStyle = '#b8965a'
      // rounded rect badge
      const r = th / 2
      ctx.beginPath()
      ctx.moveTo(padX + r, padY)
      ctx.lineTo(padX + tw - r, padY)
      ctx.arcTo(padX + tw, padY, padX + tw, padY + r, r)
      ctx.lineTo(padX + tw, padY + th - r)
      ctx.arcTo(padX + tw, padY + th, padX + tw - r, padY + th, r)
      ctx.lineTo(padX + r, padY + th)
      ctx.arcTo(padX, padY + th, padX, padY + th - r, r)
      ctx.lineTo(padX, padY + r)
      ctx.arcTo(padX, padY, padX + r, padY, r)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#0e0c09'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, padX + 7, padY + th / 2 + 1)
      ctx.restore()
    }
  }

  // Gutter line for standard albums
  if (showGutter) {
    ctx.save()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(W / 2, 0)
    ctx.lineTo(W / 2, H)
    ctx.stroke()
    ctx.restore()
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error('Canvas toBlob returned null'))
        else resolve(b)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}
