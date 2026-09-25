// src/lib/magazine/kit.ts
//
// Shared building blocks for magazine styles: page types, small helpers,
// the story copy, and the magazine-COVER builder used for page 1 of every
// style (masthead, dateline, cover lines, couple's names, barcode).

import type { LayoutTemplate, Slot } from '@/lib/smart-layout/templates'
import type { MagFont, MagTextDef } from './text'

export const MAG_PAGE_W_IN = 8.5
export const MAG_PAGE_H_IN = 11
/** Page aspect (width / height). */
export const MAG_ASPECT = MAG_PAGE_W_IN / MAG_PAGE_H_IN

/** How a page's background is filled.
 *  - color:  flat colour
 *  - blur:   a blurred copy of one of the page's own photos (slot index),
 *            optionally darkened (dim) and washed with a colour tint. */
export type MagPageBg =
  | { kind: 'color'; color: string }
  | { kind: 'blur'; slot: number; blur: number; dim: number; tint?: string }

export type MagSlot = Slot & { filter?: 'bw' }

/** Drawn ABOVE the photos (under the text): cover shading, barcode, rules.
 *  fill = flat colour; grad = [from, to] linear gradient in `dir`. */
export type MagOverlay = {
  x: number
  y: number
  w: number
  h: number
  fill?: string
  grad?: [string, string]
  dir?: 'down' | 'right'
}

export type MagPage = LayoutTemplate & {
  slots: MagSlot[]
  bg: MagPageBg
  texts?: MagTextDef[]
  overlay?: MagOverlay[]
}

export const frame = (color: string, pct: number) => ({ color, pct })
export const col = (color: string): MagPageBg => ({ kind: 'color', color })
export const wash = (slot: number, dim: number, tint?: string, blur = 2): MagPageBg => ({ kind: 'blur', slot, blur, dim, tint })
export const FULL: MagSlot = { x: 0, y: 0, w: 100, h: 100 }
export const block = (x: number, y: number, w: number, h: number, fill = 'accent') => ({ x, y, w, h, fill })

/** Text helper: t(text, x, y, w, size, font, color, extras). */
export function t(
  text: string,
  x: number,
  y: number,
  w: number,
  size: number,
  font: MagFont,
  color: string,
  extra: Partial<MagTextDef> = {},
): MagTextDef {
  return { text, x, y, w, size, font, color, ...extra }
}

/** A cols × rows grid of slots inside a box, with a gap (all in %). */
export function grid(
  cols: number,
  rows: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  gapX: number,
  gapY = gapX,
  extra: Partial<MagSlot> = {},
): MagSlot[] {
  const cw = (w - gapX * (cols - 1)) / cols
  const ch = (h - gapY * (rows - 1)) / rows
  const out: MagSlot[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push({ x: +(x0 + c * (cw + gapX)).toFixed(2), y: +(y0 + r * (ch + gapY)).toFixed(2), w: +cw.toFixed(2), h: +ch.toFixed(2), ...extra })
  return out
}

/** Page factory for a style: ids `mag-<style>-pNN`. */
export function styledPage(style: string, accent: string) {
  return (
    n: number,
    name: string,
    bg: MagPageBg,
    slots: MagSlot[],
    decor: LayoutTemplate['decor'] = [],
    texts: MagTextDef[] = [],
    overlay: MagOverlay[] = [],
  ): MagPage => ({
    id: `mag-${style}-p${String(n).padStart(2, '0')}`,
    name,
    compat: ['standard', 'layflat'],
    accent,
    bg,
    decor,
    slots,
    texts,
    overlay,
  })
}

/* ─────────────────────────── the story ───────────────────────────
 * Editorial + romantic copy shared by all styles (each style sets it in
 * its own fonts). Clients can rewrite or delete every line. */
export const STORY = {
  beginning:
    'Some stories begin with a glance. Ours began with a feeling that we had known each other all along — and a promise to spend every day after proving it right.',
  morning:
    'The morning arrived in soft light and quiet laughter. Hands painted, hearts racing, every moment felt like the first page of something we would read forever.',
  bride:
    'She wore her grandmother’s gold and her mother’s smile. He wore the nervous grin of a man who knew exactly how lucky he was.',
  vows:
    'In front of everyone we love, we made the simplest promise there is: to choose each other, again and again, for the rest of our lives.',
  party:
    'The music started, two families became one, and the dance floor never stood still. This is the night we will tell our grandchildren about.',
  thanks:
    'To everyone who laughed, cried, danced and prayed with us — this day was ours, but the love in it was yours.',
  details:
    'The gold, the flowers, the hands that held them — every small thing chosen with love, and every one of them worth remembering.',
  family:
    'Two families, one table. The laughter of aunts, the pride of fathers, the tears of mothers — the people who made us who we are.',
}
export const QUOTE = {
  lifetime: '“I would find you in any lifetime.”',
  souls: '“Two souls, one heart.”',
  favourite: '“Of all the places I’ve been, you are my favourite.”',
  always: '“It was always you.”',
  home: '“Wherever you are is home.”',
}

/* ─────────────────────────── the cover ───────────────────────────
 * A real magazine cover: full-bleed hero photo, masthead, dateline,
 * 3 cover lines, the couple as the main line, a small barcode. */

/** A simple printed-look barcode (white box + bars) as overlay rects. */
export function barcode(x: number, y: number, w = 12, h = 6.4, ink = '#111111'): MagOverlay[] {
  const out: MagOverlay[] = [{ x, y, w, h, fill: '#ffffff' }]
  const pattern = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 2, 1, 3, 1, 1]
  const unit = (w * 0.84) / pattern.reduce((a, b) => a + b, 0)
  let cx = x + w * 0.08
  pattern.forEach((u, i) => {
    if (i % 2 === 0) out.push({ x: +cx.toFixed(3), y: y + h * 0.12, w: +(u * unit).toFixed(3), h: h * 0.62, fill: ink })
    cx += u * unit
  })
  return out
}

export type CoverOpts = {
  masthead: string
  mastFont: MagFont
  mastSize?: number
  mastSpacing?: number
  mastWeight?: 400 | 500 | 600 | 700
  /** Headline font for cover lines + couple's names. */
  lineFont: MagFont
  lineItalic?: boolean
  /** Text colour (default white). */
  ink?: string
  /** Accent for the small caption lines (default = ink). */
  accent?: string
  bw?: boolean
  /** Cover lines: [headline, small caption]. */
  lines?: [string, string][]
  /** Darkening strength 0..1 (default 0.5). */
  shade?: number
}

export function cover(o: CoverOpts): { slots: MagSlot[]; texts: MagTextDef[]; overlay: MagOverlay[] } {
  const ink = o.ink ?? '#ffffff'
  const acc = o.accent ?? ink
  const sh = o.shade ?? 0.5
  const lines = o.lines ?? [
    ['The Vows', 'A promise, again and again'],
    ['Every Detail', 'The gold, the flowers, the hands'],
    ['The Celebration', 'The night that never ended'],
  ]
  const cap = { upper: true, spacing: 0.34, weight: 500 as const, shadow: true }
  const texts: MagTextDef[] = [
    t(o.masthead, 50, 10.5, 96, o.mastSize ?? 12.5, o.mastFont, ink, {
      spacing: o.mastSpacing ?? 0.06,
      weight: o.mastWeight ?? 600,
      shadow: true,
    }),
    t('Issue 01 · {date}', 50, 19.2, 80, 1.1, 'montserrat', ink, cap),
  ]
  lines.forEach(([head, sub], i) => {
    const y = 43 + i * 10.5
    texts.push(t(head, 23, y, 38, 2.7, o.lineFont, ink, { align: 'left', italic: o.lineItalic, shadow: true }))
    texts.push(t(sub, 23, y + 3.6, 38, 1.05, 'montserrat', acc, { ...cap, align: 'left', spacing: 0.18 }))
  })
  texts.push(
    t('{bride} & {groom}', 50, 79.5, 94, 6.4, o.lineFont, ink, { italic: o.lineItalic, shadow: true }),
    t('The Wedding Issue', 50, 86.6, 70, 1.2, 'montserrat', acc, { ...cap, spacing: 0.42 }),
    t('Vol. 01 · {year}', 20, 94.4, 34, 1, 'montserrat', ink, { ...cap, align: 'left', spacing: 0.25 }),
  )
  const overlay: MagOverlay[] = [
    { x: 0, y: 0, w: 100, h: 32, grad: [`rgba(0,0,0,${(sh * 0.9).toFixed(2)})`, 'rgba(0,0,0,0)'], dir: 'down' },
    { x: 0, y: 0, w: 58, h: 100, grad: [`rgba(0,0,0,${(sh * 0.5).toFixed(2)})`, 'rgba(0,0,0,0)'], dir: 'right' },
    { x: 0, y: 62, w: 100, h: 38, grad: ['rgba(0,0,0,0)', `rgba(0,0,0,${sh.toFixed(2)})`], dir: 'down' },
    ...barcode(84, 90.2),
  ]
  return { slots: [{ ...FULL, filter: o.bw ? 'bw' : undefined }], texts, overlay }
}

/** Draw a page's overlay (cover shading, barcode, rules) onto a print
 *  canvas of W × H px — mirrors MagPageView. Call after the photos and
 *  before drawMagTexts. */
export function drawMagOverlay(ctx: CanvasRenderingContext2D, overlay: MagOverlay[] | undefined, W: number, H: number): void {
  for (const o of overlay ?? []) {
    const x = (o.x / 100) * W
    const y = (o.y / 100) * H
    const w = (o.w / 100) * W
    const h = (o.h / 100) * H
    if (o.grad) {
      const g = o.dir === 'right' ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h)
      g.addColorStop(0, o.grad[0])
      g.addColorStop(1, o.grad[1])
      ctx.fillStyle = g
    } else ctx.fillStyle = o.fill ?? 'transparent'
    ctx.fillRect(x, y, w, h)
  }
}
