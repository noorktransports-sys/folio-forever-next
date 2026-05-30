// src/app/design/smart/edit/render-cover.ts
//
// Flat 2D render of the album cover (front, and back for photo covers)
// to a JPEG Blob via Canvas — so the proof + confirmation emails SHOW
// the cover, not just describe it. Mirrors cover-builder's CSS preview
// (object-fit cover + translate/scale crop around COVER_REF) so the
// proof matches the printed cover.

// Default long edge for on-screen previews. Submit-time callers
// pass a higher `outputLongEdgePx` so the print files hit 200 DPI
// for the cover's physical height (17" → 3400 px, 20" → 4000 px).
const LONG_EDGE = 1600
const JPEG_QUALITY = 0.86
// Must match cover-builder.tsx COVER_REF_PX — the crop reference width
// the photoX/photoY/photoScale transforms were authored against.
const COVER_REF_PX = 480

// Minimal copies of cover-builder's palettes (kept here so this module
// is standalone, like render-spread). IDs must stay in sync.
const LEATHER_HEX: Record<string, string> = {
  black: '#1a1816',
  brown: '#5a3a1a',
  ivory: '#f0e6d2',
  burgundy: '#5e1014',
}
const FOIL_HEX: Record<string, string> = {
  gold: '#d4b07a',
  silver: '#c8c8cc',
  'rose-gold': '#b76e79',
  black: '#0e0c09',
}
const FONT_FAMILY: Record<string, string> = {
  cormorant: '"Cormorant Garamond", Georgia, serif',
  'cormorant-italic': 'italic "Cormorant Garamond", Georgia, serif',
  playfair: '"Playfair Display", Georgia, serif',
  cinzel: '"Cinzel", Georgia, serif',
  italianno: '"Italianno", cursive',
  'great-vibes': '"Great Vibes", cursive',
  allura: '"Allura", cursive',
  'dancing-script': '"Dancing Script", cursive',
  'bebas-neue': '"Bebas Neue", system-ui, sans-serif',
  'old-standard': '"Old Standard TT", Georgia, serif',
}

export interface CoverRenderInput {
  type: 'leather' | 'acrylic' | 'photo'
  side: 'front' | 'back'
  leatherColor: string // id
  foilColor: string // id
  customTextHex: string // #rrggbb (acrylic/photo text)
  fontId: string
  fontSize: number // px at COVER_REF scale
  primaryText: string
  subtitleText: string
  position: string // 'top' | 'center' | 'lower'
  photoSrc: string | null
  backPhotoSrc: string | null
  photoScale: number
  photoX: number
  photoY: number
  /** Free title X / Y (0..1 of face). Photo + acrylic covers only;
   *  undefined falls back to the position enum. */
  titleX?: number
  titleY?: number
  /** cover face width / height (portrait). Default 0.8 (4:5-ish). */
  faceAspect?: number
  /** Long-edge (height) target in pixels. Defaults to the preview
   *  size (1600). Submit-time callers pass the print-quality value
   *  (cover_face_height_inches × 200 DPI). */
  outputLongEdgePx?: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    if (/^https?:\/\//.test(src)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('cover image load failed'))
    img.src = src
  })
}

export async function renderCoverComposite(
  input: CoverRenderInput,
): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Canvas unavailable')
  const aspect = input.faceAspect && input.faceAspect > 0 ? input.faceAspect : 0.8
  // Portrait: height is the long edge. Use the print-resolution target
  // when the submit pipeline passes one; default to the preview size.
  const H = Math.max(64, Math.round(input.outputLongEdgePx ?? LONG_EDGE))
  const W = Math.round(H * aspect)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  const isPhotoSide =
    (input.type === 'acrylic' && input.side === 'front') ||
    input.type === 'photo'
  const leatherHex = LEATHER_HEX[input.leatherColor] ?? '#1a1816'

  // Base fill.
  ctx.fillStyle = isPhotoSide ? '#0e0c09' : leatherHex
  ctx.fillRect(0, 0, W, H)

  // Photo (front acrylic, or photo cover either side).
  const photoUrl =
    input.side === 'back'
      ? input.backPhotoSrc || input.photoSrc
      : input.photoSrc
  if (isPhotoSide && photoUrl) {
    try {
      const img = await loadImage(photoUrl)
      // object-fit: cover baseline.
      const ir = img.naturalWidth / img.naturalHeight
      const fr = W / H
      let cw: number
      let ch: number
      if (ir > fr) {
        ch = H
        cw = H * ir
      } else {
        cw = W
        ch = W / ir
      }
      // The crop transforms were authored at COVER_REF_PX face width.
      const k = W / COVER_REF_PX
      const scale = Math.max(1, input.photoScale || 1)
      cw *= scale
      ch *= scale
      const dx = (W - cw) / 2 + (input.photoX || 0) * k
      const dy = (H - ch) / 2 + (input.photoY || 0) * k
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.clip()
      ctx.drawImage(img, dx, dy, cw, ch)
      ctx.restore()
    } catch {
      /* keep dark fallback */
    }
  }

  // Acrylic: leather binding strip on the spine side. The cover photo
  // is left alone — earlier versions painted a white sheen over the
  // whole face which washed colours out. Real acrylic prints render
  // the photo at full saturation; the binding strip is enough to read
  // the cover as acrylic without faking a gloss.
  if (input.type === 'acrylic' && input.side === 'front') {
    ctx.save()
    ctx.fillStyle = leatherHex
    ctx.fillRect(0, 0, W * 0.12, H)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(W * 0.12 - 3, 0, 3, H)
    ctx.restore()
  }

  // Text (skip on photo-cover back unless it has its own — keep clean).
  const showText =
    input.side === 'front' || input.type !== 'photo'
  if (showText && (input.primaryText || input.subtitleText)) {
    const textHex = isPhotoSide
      ? /^#[0-9a-fA-F]{6}$/.test(input.customTextHex)
        ? input.customTextHex
        : '#ffffff'
      : FOIL_HEX[input.foilColor] ?? '#d4b07a'
    const fam = FONT_FAMILY[input.fontId] ?? FONT_FAMILY.cormorant
    const k = W / COVER_REF_PX
    const primaryPx = Math.max(14, (input.fontSize || 52) * k)
    const subPx = Math.max(10, primaryPx * 0.28)
    // Free title position wins on photo / acrylic; leather falls back
    // to the top/center/lower presets (foil press has fixed anchors).
    // titleX is in VISIBLE-area space (after the acrylic binding strip);
    // we project onto the whole face here so "centre" on the pad lands
    // on the visible centre.
    const hasBinding = input.type === 'acrylic'
    const bindingFrac = hasBinding ? 0.12 : 0
    let cy =
      typeof input.titleY === 'number'
        ? H * Math.min(1, Math.max(0, input.titleY))
        : input.position === 'top'
        ? H * 0.16
        : input.position === 'lower'
        ? H * 0.84
        : H * 0.5
    const tx =
      typeof input.titleX === 'number'
        ? Math.min(1, Math.max(0, input.titleX))
        : 0.5
    const cx = W * (bindingFrac + tx * (1 - bindingFrac))

    if (isPhotoSide) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = primaryPx * 0.12
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = textHex
    if (input.primaryText) {
      ctx.font = `${fam.startsWith('italic') ? '' : ''}${primaryPx}px ${fam.replace(/^italic /, '')}`
      if (fam.startsWith('italic')) ctx.font = `italic ${primaryPx}px ${fam.replace(/^italic /, '')}`
      ctx.fillText(input.primaryText, cx, cy)
      cy += primaryPx * 0.9
    }
    if (input.subtitleText) {
      ctx.font = `${subPx}px ${fam.replace(/^italic /, '')}`
      ctx.globalAlpha = 0.85
      ctx.fillText(input.subtitleText, cx, cy)
      ctx.globalAlpha = 1
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('cover toBlob null'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}
