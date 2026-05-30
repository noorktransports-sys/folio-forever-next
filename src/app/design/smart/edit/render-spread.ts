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
// Output is JPEG at quality 0.85. Default long edge is 2000 px (used
// by on-screen previews like AlbumPreviewModal). Submit-time callers
// pass a higher `outputLongEdgePx` so the print files actually hit
// 200 DPI for the album's physical size (24" → 4800 px, 30" → 6000 px).

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

// MUST mirror page.tsx's bleedFillSlots/renderSlots exactly so the
// printed composite equals the approved on-screen proof (clause 2.3).
// Full-bleed templates are snapped edge-to-edge (no white page gaps);
// mat-* templates keep their intentional negative space.
function bleedFillSlots(slots: Slot[]): Slot[] {
  const overlaps = (a0: number, a1: number, b0: number, b1: number) =>
    Math.min(a1, b1) - Math.max(a0, b0) > 0.5
  return slots.map((s) => {
    const sx0 = s.x
    const sx1 = s.x + s.w
    const sy0 = s.y
    const sy1 = s.y + s.h
    let left = 0
    let right = 100
    let top = 0
    let bottom = 100
    for (const o of slots) {
      if (o === s) continue
      const ox0 = o.x
      const ox1 = o.x + o.w
      const oy0 = o.y
      const oy1 = o.y + o.h
      if (overlaps(sy0, sy1, oy0, oy1)) {
        if (ox1 <= sx0 + 0.5) left = Math.max(left, (sx0 + ox1) / 2)
        if (ox0 >= sx1 - 0.5) right = Math.min(right, (sx1 + ox0) / 2)
      }
      if (overlaps(sx0, sx1, ox0, ox1)) {
        if (oy1 <= sy0 + 0.5) top = Math.max(top, (sy0 + oy1) / 2)
        if (oy0 >= sy1 - 0.5) bottom = Math.min(bottom, (sy1 + oy0) / 2)
      }
    }
    return {
      ...s,
      x: left,
      y: top,
      w: Math.max(1, right - left),
      h: Math.max(1, bottom - top),
    }
  })
}

function renderSlots(t: LayoutTemplate): Slot[] {
  return t.id.startsWith('mat-') ? t.slots : bleedFillSlots(t.slots)
}

// Mirrors page.tsx frameColorForBg so the printed auto-frame matches
// the on-screen proof (clause 2.3).
function frameColorForBgInput(bg: { mode: string; color?: string } | undefined): string {
  if (bg && bg.mode === 'photo') return '#ffffff'
  const hex =
    !bg || bg.mode === 'paper' ? '#ffffff' : bg.color || '#f5f0e8'
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return L > 0.7 ? '#1a1a1a' : '#ffffff'
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
  borderWidth?: number
  borderColor?: string
}

interface SpreadLike {
  id: string
  templateId: string
  photoIds: (string | null)[]
}

/** Per-spread background. Mirrors SpreadBg in page.tsx (duplicated here
 *  the same way Photo/PhotoAdjust are — render-spread is standalone). */
export interface SpreadBgInput {
  mode: 'paper' | 'color' | 'photo'
  color?: string
  photoId?: string
  blur?: number
  dim?: number
  zoom?: number
  panX?: number
  panY?: number
}

const BG_PHOTO_MAX_ZOOM = 2

export interface SpreadTextInput {
  id: string
  text: string
  xPct: number
  yPct: number
  widthPct: number
  sizePct: number
  color: string
  align: 'left' | 'center' | 'right'
  font:
    | 'display'
    | 'serif'
    | 'sans'
    | 'elegant'
    | 'script'
    | 'hand'
    | 'castellar'
    | 'copperplate'
  weight: 400 | 700
}

const TEXT_FONT_CANVAS: Record<SpreadTextInput['font'], string> = {
  display: 'Georgia, "Times New Roman", serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, sans-serif',
  elegant: '"Playfair Display", Georgia, serif',
  script: '"Great Vibes", cursive',
  hand: '"Dancing Script", cursive',
  castellar: 'Castellar, "Cinzel", Georgia, serif',
  copperplate:
    '"Copperplate Gothic Light", "Copperplate Gothic", Copperplate, "Cinzel", serif',
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
  /** Per-spread background — paper (default) / colour / blurred photo.
   *  Must match the editor exactly so proof = print (clause 2.3). */
  bg?: SpreadBgInput
  /** Free text blocks — drawn last, on top, matching the editor. */
  texts?: SpreadTextInput[]
  /** Long-edge target in pixels. Defaults to the small preview value
   *  (2000); submit-time callers should pass the print-quality value
   *  (album_long_edge_inches × 200 DPI). */
  outputLongEdgePx?: number
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
  bg,
  texts,
  outputLongEdgePx,
}: RenderSpreadInput): Promise<Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Canvas unavailable on server')
  }
  // Canvas size: long edge at outputLongEdgePx if provided (submit-time
  // print resolution), otherwise the default preview size. H preserves
  // the spread aspect.
  const W = Math.max(64, Math.round(outputLongEdgePx ?? COMPOSITE_LONG_EDGE))
  const H = Math.round(W / spreadAspectRatio)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context unavailable')

  // ── Background (paper / colour / blurred photo) ──
  // Must match the editor's SpreadView render exactly so the printed
  // album matches the approved proof (clause 2.3).
  const fillHex =
    !bg || bg.mode === 'paper'
      ? '#ffffff'
      : bg.mode === 'color'
      ? bg.color || '#f5f0e8'
      : '#ffffff'
  ctx.fillStyle = fillHex
  ctx.fillRect(0, 0, W, H)

  if (bg && bg.mode === 'photo' && bg.photoId) {
    const bgPhoto = photos.get(bg.photoId)
    if (bgPhoto) {
      try {
        const bgImg = await loadImage(bgPhoto.preview)
        const z = Math.min(BG_PHOTO_MAX_ZOOM, Math.max(1, bg.zoom ?? 1))
        // cover-fit the spread, then apply zoom
        const ir = bgImg.naturalWidth / bgImg.naturalHeight
        const sr = W / H
        let cw: number
        let ch: number
        if (ir > sr) {
          ch = H
          cw = H * ir
        } else {
          cw = W
          ch = W / ir
        }
        cw *= z
        ch *= z
        const overflowX = cw - W
        const overflowY = ch - H
        const offX = -((bg.panX ?? 50) / 100) * overflowX
        const offY = -((bg.panY ?? 50) / 100) * overflowY
        ctx.save()
        // Default must match the editor's DEFAULT_BG_BLUR (9px) so the
        // printed proof equals what the client approved.
        ctx.filter = `blur(${bg.blur ?? 9}px)`
        ctx.drawImage(bgImg, offX, offY, cw, ch)
        ctx.restore()
        // dim overlay
        ctx.save()
        ctx.fillStyle = `rgba(0,0,0,${bg.dim ?? 0.25})`
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
      } catch {
        // bg photo failed to load — fall back to the flat fill already drawn
      }
    }
  }

  const drawSlots = renderSlots(template)
  for (let i = 0; i < drawSlots.length; i++) {
    const slot = drawSlots[i]
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
    // Inflate the clip by 1px on every side so adjacent full-bleed slots
    // overlap a hairline instead of leaving an anti-aliased seam that
    // reveals the white page between photos (matches the editor's +1px).
    ctx.beginPath()
    ctx.rect(sx - 1, sy - 1, sw + 2, sh + 2)
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

    // Photo frame (border) — drawn INSIDE the slot rect as 4 bars so it
    // matches the editor's inset border. Width = 2.2% of slot width at
    // level 10, the same relative weight the editor uses.
    if (adj.borderWidth && adj.borderWidth > 0) {
      const bw = Math.max(1, (adj.borderWidth / 10) * 0.022 * sw)
      ctx.save()
      ctx.fillStyle = adj.borderColor || '#ffffff'
      ctx.fillRect(sx, sy, sw, bw) // top
      ctx.fillRect(sx, sy + sh - bw, sw, bw) // bottom
      ctx.fillRect(sx, sy, bw, sh) // left
      ctx.fillRect(sx + sw - bw, sy, bw, sh) // right
      ctx.restore()
    } else if (template.id.startsWith('mat-')) {
      // Automatic thin contrast frame for matted photos (matches editor).
      const bw = Math.max(1, 0.004 * sw)
      ctx.save()
      ctx.fillStyle = frameColorForBgInput(bg)
      ctx.fillRect(sx, sy, sw, bw)
      ctx.fillRect(sx, sy + sh - bw, sw, bw)
      ctx.fillRect(sx, sy, bw, sh)
      ctx.fillRect(sx + sw - bw, sy, bw, sh)
      ctx.restore()
    }

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

  // ── Free text blocks (drawn last, on top) ──
  // Sizing/positioning mirrors the editor exactly (sizePct% of H,
  // xPct/yPct % of the spread) so proof === print.
  if (texts && texts.length) {
    // Make sure custom (Google) fonts are loaded before we measure/draw,
    // otherwise the canvas silently falls back and proof !== print.
    const docFonts = (document as unknown as { fonts?: FontFaceSet }).fonts
    if (docFonts) {
      try {
        await Promise.all(
          texts.map((t) =>
            docFonts.load(
              `${t.weight} 40px ${TEXT_FONT_CANVAS[t.font]}`,
            ).catch(() => undefined),
          ),
        )
        await docFonts.ready
      } catch {
        /* fall back to system fonts */
      }
    }
    for (const t of texts) {
      if (!t.text) continue
      const fontPx = Math.max(6, (t.sizePct / 100) * H)
      const boxW = (t.widthPct / 100) * W
      const cx = (t.xPct / 100) * W
      const cy = (t.yPct / 100) * H
      ctx.save()
      ctx.font = `${t.weight} ${fontPx}px ${TEXT_FONT_CANVAS[t.font]}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = t.align
      // Word-wrap within boxW, honouring explicit newlines.
      const lines: string[] = []
      for (const para of t.text.split('\n')) {
        const words = para.split(/\s+/)
        let line = ''
        for (const w of words) {
          const test = line ? line + ' ' + w : w
          if (ctx.measureText(test).width > boxW && line) {
            lines.push(line)
            line = w
          } else {
            line = test
          }
        }
        lines.push(line)
      }
      const lh = fontPx * 1.15
      let y = cy - ((lines.length - 1) * lh) / 2
      const x =
        t.align === 'left'
          ? cx - boxW / 2
          : t.align === 'right'
          ? cx + boxW / 2
          : cx
      if (t.color.toLowerCase() === '#ffffff') {
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = fontPx * 0.12
        ctx.shadowOffsetY = fontPx * 0.04
      }
      ctx.fillStyle = t.color
      for (const ln of lines) {
        ctx.fillText(ln, x, y)
        y += lh
      }
      ctx.restore()
    }
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
