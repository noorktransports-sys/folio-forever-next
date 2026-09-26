// src/lib/magazine/text.ts
//
// Editorial text for the magazine: fonts, the couple's names / date
// auto-fill, and a canvas renderer that mirrors the on-screen text so
// the print file matches the proof.
//
// Sizes are % of PAGE HEIGHT, positions are the text box CENTRE in % of
// the page, width is % of page width — same convention as photo slots.

import type { CSSProperties } from 'react'

export type MagFont =
  | 'bodoni'
  | 'playfair'
  | 'cormorant'
  | 'italiana'
  | 'cinzel'
  | 'pinyon'
  | 'vibes'
  | 'montserrat'

/** Font stacks — identical for CSS and canvas. */
export const MAG_FONT_FAMILY: Record<MagFont, string> = {
  bodoni: '"Bodoni Moda", "Didot", Georgia, serif',
  playfair: '"Playfair Display", Georgia, serif',
  cormorant: '"Cormorant Garamond", Georgia, serif',
  italiana: '"Italiana", "Didot", Georgia, serif',
  cinzel: '"Cinzel", "Trajan Pro", Georgia, serif',
  pinyon: '"Pinyon Script", "Snell Roundhand", cursive',
  vibes: '"Great Vibes", "Snell Roundhand", cursive',
  montserrat: '"Montserrat", system-ui, sans-serif',
}

/** Menu order + friendly names for the font picker. */
export const MAG_FONTS: { id: MagFont; label: string; note: string }[] = [
  { id: 'bodoni', label: 'Bodoni', note: 'Fashion headline' },
  { id: 'playfair', label: 'Playfair', note: 'Editorial serif' },
  { id: 'cormorant', label: 'Cormorant', note: 'Elegant book' },
  { id: 'italiana', label: 'Italiana', note: 'High fashion' },
  { id: 'cinzel', label: 'Cinzel', note: 'Engraved caps' },
  { id: 'pinyon', label: 'Pinyon', note: 'Calligraphy' },
  { id: 'vibes', label: 'Great Vibes', note: 'Wedding script' },
  { id: 'montserrat', label: 'Montserrat', note: 'Clean caption' },
]

/** Self-hosted magazine fonts (public/fonts/magazine, SIL OFL 1.1).
 *  Loaded only on the magazine page, so the rest of the site stays light,
 *  and never depends on a third-party font service (print must match). */
export const MAG_FONTS_HREF = '/fonts/magazine/fonts.css'

/** A text block as designed (may contain {bride} {groom} {names} {date} {year}). */
export type MagTextDef = {
  text: string
  x: number
  y: number
  w: number
  size: number
  font: MagFont
  color: string
  align?: 'left' | 'center' | 'right'
  weight?: 400 | 500 | 600 | 700
  italic?: boolean
  upper?: boolean
  /** Letter spacing in em. */
  spacing?: number
  /** Soft shadow for text sitting on photos. */
  shadow?: boolean
}

/** A text block on an album page (defaults get ids `<pageId>-tN`). */
export type MagText = MagTextDef & { id: string }

export type MagMeta = { bride: string; groom: string; date: string }

export const SAMPLE_META: MagMeta = { bride: 'Simran', groom: 'Arjun', date: 'October 12, 2026' }

export function resolveText(text: string, meta: MagMeta): string {
  const bride = meta.bride.trim() || SAMPLE_META.bride
  const groom = meta.groom.trim() || SAMPLE_META.groom
  const date = meta.date.trim() || SAMPLE_META.date
  const year = (date.match(/\b(19|20)\d{2}\b/) ?? [String(new Date().getFullYear())])[0]
  return text
    .replace(/\{bride\}/g, bride)
    .replace(/\{groom\}/g, groom)
    .replace(/\{names\}/g, `${bride} & ${groom}`)
    .replace(/\{date\}/g, date)
    .replace(/\{year\}/g, year)
}

export function defaultTexts(pageId: string, defs: MagTextDef[] | undefined): MagText[] {
  return (defs ?? []).map((d, i) => ({ ...d, id: `${pageId}-t${i}` }))
}

const LINE_HEIGHT = 1.18

/** CSS for one text block inside a page whose root is a container
 *  (container-type: inline-size) — so cqw = 1% of page width. */
export function magTextStyle(t: MagTextDef, pageAspect: number): CSSProperties {
  return {
    position: 'absolute',
    left: `${t.x}%`,
    top: `${t.y}%`,
    width: `${t.w}%`,
    transform: 'translate(-50%, -50%)',
    fontFamily: MAG_FONT_FAMILY[t.font],
    // size is % of page HEIGHT; height = width / aspect.
    fontSize: `${t.size / pageAspect}cqw`,
    lineHeight: LINE_HEIGHT,
    fontWeight: t.weight ?? 400,
    fontStyle: t.italic ? 'italic' : 'normal',
    textTransform: t.upper ? 'uppercase' : 'none',
    letterSpacing: `${t.spacing ?? 0}em`,
    color: t.color,
    textAlign: t.align ?? 'center',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    textShadow: t.shadow ? '0 0.06em 0.35em rgba(0,0,0,0.5)' : undefined,
  }
}

/** Draw text blocks onto a page canvas (W × H px) — mirrors magTextStyle. */
export async function drawMagTexts(
  ctx: CanvasRenderingContext2D,
  texts: MagText[],
  meta: MagMeta,
  W: number,
  H: number,
): Promise<void> {
  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
  const fontOf = (t: MagTextDef, px: number) =>
    `${t.italic ? 'italic ' : ''}${t.weight ?? 400} ${px}px ${MAG_FONT_FAMILY[t.font]}`
  if (fonts) {
    try {
      await Promise.all(texts.map((t) => fonts.load(fontOf(t, 40)).catch(() => undefined)))
      await fonts.ready
    } catch {
      /* fall back */
    }
  }
  for (const t of texts) {
    let str = resolveText(t.text, meta)
    if (!str.trim()) continue
    if (t.upper) str = str.toUpperCase()
    const px = Math.max(4, (t.size / 100) * H)
    const boxW = (t.w / 100) * W
    ctx.save()
    ctx.font = fontOf(t, px)
    const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
    if ('letterSpacing' in c) c.letterSpacing = `${(t.spacing ?? 0) * px}px`
    ctx.textBaseline = 'middle'
    const align = t.align ?? 'center'
    ctx.textAlign = align
    const lines: string[] = []
    for (const para of str.split('\n')) {
      let line = ''
      for (const word of para.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word
        if (ctx.measureText(test).width > boxW && line) {
          lines.push(line)
          line = word
        } else line = test
      }
      lines.push(line)
    }
    const lh = px * LINE_HEIGHT
    let y = (t.y / 100) * H - ((lines.length - 1) * lh) / 2
    const cx = (t.x / 100) * W
    const x = align === 'left' ? cx - boxW / 2 : align === 'right' ? cx + boxW / 2 : cx
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = px * 0.35
      ctx.shadowOffsetY = px * 0.06
    }
    ctx.fillStyle = t.color
    for (const ln of lines) {
      ctx.fillText(ln, x, y)
      y += lh
    }
    ctx.restore()
  }
}
