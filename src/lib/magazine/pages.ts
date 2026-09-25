// src/lib/magazine/pages.ts
//
// "Create Your Magazine" — fixed 20-page designs ("styles").
//
// Every page is 8.5 × 11 in, portrait. Coordinates are % of the PAGE
// (x/w of page width, y/h of page height). TERRACOTTA pages 1–19 were
// measured from the owner's reference designs (4830 × 6250 px exports).
//
// These are ordinary LayoutTemplates (id prefix `mag-`) so the shared
// print renderer draws them exactly like the editor:
//   • `mag-` ids are never gap-snapped (overlaps are intentional)
//   • decor  = colour bands / blocks, drawn under the photos
//   • shape  = 'circle' → true circle sized from its width (h: 0)
//   • z      = paint order for overlapping photos
//   • frame  = thin keyline around a photo
//   • filter = 'bw' prints that photo in black & white
//   • bg.blur is a % of the PAGE WIDTH (same on screen and in print)
//   • texts  = editorial text (see ./text.ts) — sizes are % of page
//              height; {bride} {groom} {names} {date} {year} auto-fill.

import type { LayoutTemplate, Slot } from '@/lib/smart-layout/templates'
import type { MagFont, MagTextDef } from './text'

export const MAG_PAGE_W_IN = 8.5
export const MAG_PAGE_H_IN = 11
/** Page aspect (width / height). */
export const MAG_ASPECT = MAG_PAGE_W_IN / MAG_PAGE_H_IN
export const MAG_PAGE_COUNT = 20
export const MAG_PRICE = 70
/** Print target: 300 DPI on the page's long edge (11 in → 3300 px). */
export const MAG_PRINT_LONG_EDGE_PX = Math.round(MAG_PAGE_H_IN * 300)

export const RUST = '#8f2e0d'
const CREAM = '#f4ede8'
const KEYLINE = '#cfcac4'
const INK = '#2a1a12'

/** How a page's background is filled.
 *  - color:  flat colour (paper white, rust …)
 *  - blur:   a blurred copy of one of the page's own photos (slot index),
 *            optionally darkened (dim) and washed with a colour tint. */
export type MagPageBg =
  | { kind: 'color'; color: string }
  | { kind: 'blur'; slot: number; blur: number; dim: number; tint?: string }

export type MagSlot = Slot & { filter?: 'bw' }

export type MagPage = LayoutTemplate & {
  slots: MagSlot[]
  bg: MagPageBg
  texts?: MagTextDef[]
}

const frame = (color: string, pct: number) => ({ color, pct })
const col = (color: string): MagPageBg => ({ kind: 'color', color })
const wash = (slot: number, dim: number, tint?: string, blur = 2): MagPageBg => ({ kind: 'blur', slot, blur, dim, tint })
const FULL: MagSlot = { x: 0, y: 0, w: 100, h: 100 }
const block = (x: number, y: number, w: number, h: number, fill = 'accent') => ({ x, y, w, h, fill })

/** Text helper: t(text, x, y, w, size, font, color, extras). */
function t(
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

/* ─────────────────────────── the story ───────────────────────────
 * Editorial + romantic copy shared by all styles (each style sets it in
 * its own fonts). Clients can rewrite or delete every line. */
const STORY = {
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
}
const QUOTE = {
  lifetime: '“I would find you in any lifetime.”',
  souls: '“Two souls, one heart.”',
  favourite: '“Of all the places I’ve been, you are my favourite.”',
}

/* ════════════════════════════ TERRACOTTA ════════════════════════════
 * Warm rust + cream, from the owner's reference pages. Bodoni headlines,
 * Pinyon script, Montserrat captions. */

function page(
  n: number,
  name: string,
  bg: MagPageBg,
  slots: MagSlot[],
  decor: LayoutTemplate['decor'] = [],
  texts: MagTextDef[] = [],
): MagPage {
  return {
    id: `mag-p${String(n).padStart(2, '0')}`,
    name,
    compat: ['standard', 'layflat'],
    accent: RUST,
    bg,
    decor,
    slots,
    texts,
  }
}

const WHITE: MagPageBg = { kind: 'color', color: '#ffffff' }
const sideBars = (l: number, r: number) => [block(0, 0, l, 100), block(r, 0, 100 - r, 100)]
const fullRust = [block(0, 0, 100, 100)]
const CAP = { upper: true, spacing: 0.32, weight: 500 as const }

export const MAG_PAGES: MagPage[] = [
  // 1 — cover: framed portrait on a blurred copy of itself + masthead
  page(1, 'Cover', { kind: 'blur', slot: 0, blur: 1.2, dim: 0.12 }, [
    { x: 9.4, y: 5.4, w: 81, h: 89.2, frame: frame(CREAM, 0.85) },
  ], [], [
    t('FOREVER', 50, 14, 76, 9, 'bodoni', '#ffffff', { spacing: 0.14, weight: 600, shadow: true }),
    t('THE WEDDING ISSUE · {year}', 50, 21.5, 70, 1.25, 'montserrat', '#ffffff', { ...CAP, shadow: true }),
    t('{bride} & {groom}', 50, 83, 76, 5.4, 'pinyon', '#ffffff', { shadow: true }),
    t('{date}', 50, 89.5, 60, 1.2, 'montserrat', '#ffffff', { ...CAP, shadow: true }),
  ]),
  // 2 — full-height photo between rust side bars
  page(2, 'Side bars', WHITE, [{ x: 4.3, y: 0, w: 91.4, h: 100 }], sideBars(4.3, 95.7)),
  // 3 — rust bands, wide photo, portrait frame over the top band, box below
  page(
    3,
    'Frame & box',
    WHITE,
    [
      { x: 0, y: 7, w: 100, h: 84.3, z: 0 },
      { x: 27, y: 2.5, w: 46, h: 38, z: 2, frame: frame(CREAM, 0.7) },
      { x: 3.4, y: 55.8, w: 41, h: 44.2, z: 1 },
    ],
    [block(0, 0, 100, 7), block(0, 91.3, 100, 8.7)],
    [t('Chapter One — The Beginning', 72, 95.6, 50, 1.2, 'montserrat', CREAM, CAP)],
  ),
  // 4 — rust bands top and bottom
  page(4, 'Top & bottom bands', WHITE, [{ x: 0, y: 7, w: 100, h: 84.5 }], [block(0, 0, 100, 7), block(0, 91.5, 100, 8.5)], [
    t('The Morning Of', 50, 3.6, 80, 1.3, 'montserrat', CREAM, CAP),
    t('The morning arrived in soft light and quiet laughter.', 50, 95.7, 86, 2, 'cormorant', CREAM, { italic: true }),
  ]),
  // 5 — side bars
  page(5, 'Side bars II', WHITE, [{ x: 4.3, y: 0, w: 91.9, h: 100 }], sideBars(4.3, 96.2)),
  // 6 — black & white print framed on a blurred colour copy
  page(6, 'B&W framed', wash(0, 0.12, undefined, 1), [
    { x: 18.5, y: 14.4, w: 62.6, h: 72.5, frame: frame(CREAM, 1.4), filter: 'bw' },
  ], [], [
    t('Chapter Two', 50, 7.4, 60, 1.5, 'cinzel', '#ffffff', { spacing: 0.3, shadow: true }),
    t('Here comes the bride', 50, 93.4, 84, 4.6, 'pinyon', '#ffffff', { shadow: true }),
  ]),
  // 7 — two photos stacked, edge to edge
  page(7, 'Stacked pair', WHITE, [
    { x: 2.2, y: 0, w: 97, h: 47.4 },
    { x: 0, y: 47.4, w: 100, h: 52.6 },
  ]),
  // 8 — near-full portrait on a warm blurred wash
  page(8, 'Portrait on wash', wash(0, 0, 'rgba(143,46,13,0.45)'), [{ x: 5, y: 1.1, w: 90.1, h: 98.9 }]),
  // 9 — two landscapes on a warm wash, headline in the gap
  page(9, 'Two landscapes', wash(0, 0, 'rgba(143,46,13,0.62)'), [
    { x: 6.4, y: 0, w: 88.4, h: 45.1 },
    { x: 6.4, y: 56.2, w: 88.4, h: 43.3 },
  ], [], [t('Two Families. One Forever.', 50, 50.6, 90, 3.3, 'playfair', CREAM, { italic: true })]),
  // 10 — side bars (narrow)
  page(10, 'Side bars III', WHITE, [{ x: 3.7, y: 0, w: 91.2, h: 100 }], sideBars(3.7, 94.9)),
  // 11 — three full-width strips
  page(11, 'Three strips', WHITE, [
    { x: 0, y: 0, w: 100, h: 31.1 },
    { x: 0, y: 31.3, w: 100, h: 37.3 },
    { x: 0, y: 68.8, w: 100, h: 31.2 },
  ]),
  // 12 — two portraits centred on rust, quote in the gap
  page(12, 'Pair on rust', WHITE, [
    { x: 29.7, y: 0, w: 42.9, h: 45.3 },
    { x: 29.7, y: 55, w: 42.9, h: 45 },
  ], fullRust, [t(QUOTE.lifetime, 51.2, 50.1, 60, 2.3, 'cormorant', CREAM, { italic: true })]),
  // 13 — wide side bars (group shot)
  page(13, 'Wide side bars', WHITE, [{ x: 7.7, y: 0, w: 88.4, h: 100 }], sideBars(7.7, 96.1)),
  // 14 — side bars with a cream keyline
  page(14, 'Keyline bars', WHITE, [{ x: 5.1, y: 0, w: 90.1, h: 100 }], [
    ...sideBars(4.1, 96.2),
    block(4.1, 0, 1, 100, CREAM),
    block(95.2, 0, 1, 100, CREAM),
  ]),
  // 15 — staircase of three framed photos on rust + the vows
  page(15, 'The Vows', WHITE, [
    { x: 0, y: 0, w: 32.8, h: 31.2, frame: frame(CREAM, 1.2) },
    { x: 33, y: 31.4, w: 34, h: 37.4, frame: frame(CREAM, 1.2) },
    { x: 67.2, y: 68.9, w: 32.8, h: 31.1, frame: frame(CREAM, 1.2) },
  ], fullRust, [
    t('The Vows', 67, 9.5, 58, 6.6, 'bodoni', CREAM, { italic: true }),
    t(STORY.vows, 67, 21.5, 56, 1.75, 'cormorant', CREAM),
    t(QUOTE.souls, 32, 84, 58, 3.6, 'pinyon', CREAM),
  ]),
  // 16 — single portrait on white with a keyline + headline
  page(16, 'Single framed', WHITE, [
    { x: 8.7, y: 1.5, w: 82.6, h: 82, frame: frame(KEYLINE, 0.3) },
  ], [], [
    t('A Love Written in Gold', 50, 90, 86, 3.2, 'bodoni', INK),
    t('Photographed with love · {year}', 50, 95.6, 70, 1.1, 'montserrat', RUST, CAP),
  ]),
  // 17 — 2 × 2 grid
  page(17, 'Grid of four', WHITE, [
    { x: 0, y: 0, w: 49.85, h: 49.6 },
    { x: 50.15, y: 0, w: 49.85, h: 49.6 },
    { x: 0, y: 49.9, w: 49.85, h: 50.1 },
    { x: 50.15, y: 49.9, w: 49.85, h: 50.1 },
  ]),
  // 18 — one tall + two stacked, keylines on a blush page
  page(18, 'Tall + two', col('#f7eee9'), [
    { x: 8.5, y: 5.5, w: 36.3, h: 88.8, frame: frame(KEYLINE, 0.4) },
    { x: 51.3, y: 5.5, w: 40.3, h: 39.9, frame: frame(KEYLINE, 0.4) },
    { x: 51.3, y: 54.5, w: 40.3, h: 39.8, frame: frame(KEYLINE, 0.4) },
  ], [], [t('— {names} —', 50, 97.2, 60, 1.1, 'montserrat', RUST, CAP)]),
  // 19 — three strips with white gaps
  page(19, 'Three strips II', WHITE, [
    { x: 0, y: 0, w: 100, h: 31 },
    { x: 0, y: 31.4, w: 100, h: 36.9 },
    { x: 0, y: 68.7, w: 100, h: 31.3 },
  ]),
  // 20 — closing: portrait + two framed boxes on rust + sign-off
  page(20, 'With love', WHITE, [
    { x: 17, y: 4.5, w: 66, h: 44, frame: frame(CREAM, 0.8) },
    { x: 6, y: 60, w: 42, h: 32, frame: frame(CREAM, 1.2) },
    { x: 52, y: 60, w: 42, h: 32, frame: frame(CREAM, 1.2) },
  ], fullRust, [
    t('With love, {bride} & {groom}', 50, 54.2, 90, 3.7, 'pinyon', CREAM),
    t('{date}', 50, 96, 60, 1.15, 'montserrat', CREAM, CAP),
  ]),
]

/* ══════════════════════════ other styles ══════════════════════════
 * Page ids are `mag-<style>-pNN` (still `mag-` prefixed). */

function styledPage(style: string, accent: string) {
  return (
    n: number,
    name: string,
    bg: MagPageBg,
    slots: MagSlot[],
    decor: LayoutTemplate['decor'] = [],
    texts: MagTextDef[] = [],
  ): MagPage => ({
    id: `mag-${style}-p${String(n).padStart(2, '0')}`,
    name,
    compat: ['standard', 'layflat'],
    accent,
    bg,
    decor,
    slots,
    texts,
  })
}

// ── NOIR — cinematic black, white keylines, black & white moments ──
const NOIR_BG = '#111111'
const NOIR_GREY = '#a9a9a9'
const nP = styledPage('noir', '#1d1d1d')
const NB = col(NOIR_BG)
const WL = frame('#ffffff', 0.35)
const NCAP = { upper: true, spacing: 0.35, weight: 500 as const }
export const NOIR_PAGES: MagPage[] = [
  nP(1, 'Cover', NB, [{ ...FULL, filter: 'bw' }], [], [
    t('FOREVER', 50, 12.5, 90, 11, 'bodoni', '#ffffff', { spacing: 0.08, weight: 600, shadow: true }),
    t('The Wedding Issue · {year}', 50, 20.5, 70, 1.2, 'montserrat', '#ffffff', { ...NCAP, shadow: true }),
    t('{bride} & {groom}', 50, 83, 86, 3.4, 'italiana', '#ffffff', { spacing: 0.06, shadow: true }),
    t('{date}', 50, 88.8, 60, 1.15, 'montserrat', '#ffffff', { ...NCAP, shadow: true }),
  ]),
  nP(2, 'Chapter One', NB, [{ x: 14, y: 8, w: 72, h: 72, frame: WL }], [], [
    t('Chapter One', 50, 86.5, 80, 3.4, 'italiana', '#ffffff', { spacing: 0.08 }),
    t('The Beginning', 50, 92.2, 60, 1.15, 'montserrat', NOIR_GREY, NCAP),
  ]),
  nP(3, 'Two scenes', wash(0, 0.72), [
    { x: 8, y: 8, w: 84, h: 40 },
    { x: 8, y: 52, w: 84, h: 40, filter: 'bw' },
  ]),
  nP(4, 'Full colour', NB, [FULL]),
  nP(5, 'Scene + contact strip', NB, [
    { x: 0, y: 0, w: 100, h: 62 },
    { x: 6, y: 70, w: 28, h: 21.6, filter: 'bw' },
    { x: 36, y: 70, w: 28, h: 21.6, filter: 'bw' },
    { x: 66, y: 70, w: 28, h: 21.6, filter: 'bw' },
  ], [], [t('The Morning Of', 50, 96.2, 60, 1.1, 'montserrat', NOIR_GREY, NCAP)]),
  nP(6, 'Here comes the bride', NB, [{ x: 24, y: 7, w: 52, h: 60, frame: WL }], [], [
    t('Here comes the bride.', 50, 75.5, 86, 4.2, 'bodoni', '#ffffff', { italic: true }),
    t(STORY.bride, 50, 86.5, 70, 1.7, 'cormorant', '#d6d6d6', { italic: true }),
  ]),
  nP(7, 'Split screen', NB, [
    { x: 0, y: 0, w: 50, h: 100 },
    { x: 50, y: 0, w: 50, h: 100, filter: 'bw' },
  ]),
  nP(8, 'The Vows', NB, [
    { x: 38, y: 0, w: 62, h: 100 },
    { x: 6, y: 62, w: 26, h: 30, frame: WL },
  ], [block(0, 0, 38, 100, '#181818')], [
    t('The Vows', 19, 15, 32, 5.6, 'bodoni', '#ffffff', { italic: true }),
    t(STORY.vows, 19, 38, 30, 1.55, 'cormorant', '#d6d6d6'),
  ]),
  nP(9, 'Monochrome', NB, [{ ...FULL, filter: 'bw' }], [], [
    t(QUOTE.favourite, 50, 89, 80, 2.5, 'cormorant', '#ffffff', { italic: true, shadow: true }),
  ]),
  nP(10, 'Six frames', wash(0, 0.7, undefined, 2.5), [
    { x: 8, y: 8, w: 40, h: 27 },
    { x: 52, y: 8, w: 40, h: 27 },
    { x: 8, y: 37, w: 40, h: 27 },
    { x: 52, y: 37, w: 40, h: 27 },
    { x: 8, y: 66, w: 40, h: 27 },
    { x: 52, y: 66, w: 40, h: 27 },
  ]),
  nP(11, 'Framed on shadow', wash(0, 0.5), [{ x: 12, y: 12, w: 76, h: 76, frame: frame('#ffffff', 0.6) }]),
  nP(12, 'Every detail', NB, [
    { x: 0, y: 0, w: 70, h: 55, z: 0 },
    { x: 30, y: 45, w: 70, h: 55, z: 1, frame: frame(NOIR_BG, 1.4) },
  ], [], [
    t('Every detail, a promise.', 85, 22, 27, 3, 'bodoni', '#ffffff', { italic: true }),
    t('The Details', 15, 78, 26, 1.1, 'montserrat', NOIR_GREY, NCAP),
  ]),
  nP(13, 'Full colour II', NB, [FULL]),
  nP(14, 'Three columns', NB, [
    { x: 6, y: 15, w: 27, h: 70, filter: 'bw' },
    { x: 36.5, y: 15, w: 27, h: 70, filter: 'bw' },
    { x: 67, y: 15, w: 27, h: 70, filter: 'bw' },
  ], [], [
    t('The Celebration', 50, 8, 80, 1.4, 'montserrat', '#ffffff', NCAP),
    t('Chapter Three', 50, 92, 80, 3.2, 'italiana', '#ffffff', { spacing: 0.08 }),
  ]),
  nP(15, 'Just married', NB, [{ x: 0, y: 30, w: 100, h: 40 }], [], [
    t('Just Married', 50, 17, 90, 7.4, 'bodoni', '#ffffff', { italic: true }),
    t(STORY.party, 50, 83, 76, 1.75, 'cormorant', '#d6d6d6'),
  ]),
  nP(16, 'Portrait + still', NB, [
    { x: 20, y: 8, w: 60, h: 62, filter: 'bw' },
    { x: 38, y: 74, w: 24, h: 18, frame: WL },
  ]),
  nP(17, 'Above & below', NB, [
    { x: 0, y: 0, w: 100, h: 49.8 },
    { x: 0, y: 50.2, w: 100, h: 49.8 },
  ]),
  nP(18, 'Four', NB, [
    { x: 0, y: 0, w: 49.7, h: 49.7 },
    { x: 50.3, y: 0, w: 49.7, h: 49.7 },
    { x: 0, y: 50.3, w: 49.7, h: 49.7 },
    { x: 50.3, y: 50.3, w: 49.7, h: 49.7 },
  ]),
  nP(19, 'Two souls', wash(1, 0.6), [
    { x: 22, y: 8, w: 56, h: 43, frame: WL },
    { x: 16, y: 62, w: 68, h: 30, frame: WL },
  ], [], [t(QUOTE.souls, 50, 56.5, 80, 2.7, 'italiana', '#ffffff', { spacing: 0.04 })]),
  nP(20, 'Fade out', NB, [{ x: 30, y: 22, w: 40, h: 44, frame: WL }], [], [
    t('With love,', 50, 74, 60, 3, 'italiana', '#ffffff', { spacing: 0.06 }),
    t('{bride} & {groom}', 50, 80.5, 80, 4, 'bodoni', '#ffffff', { italic: true }),
    t('{date}', 50, 88, 60, 1.15, 'montserrat', NOIR_GREY, NCAP),
  ]),
]

// ── IVORY — gallery white, blush & champagne fields, fine keylines ──
const IVORY_BG = '#fbf8f3'
const BLUSH = '#f4e7e0'
const CHAMPAGNE = '#efe6d6'
const TAUPE = '#cbbfae'
const IVORY_INK = '#3b342c'
const TAUPE_DARK = '#8a7d6b'
const iP = styledPage('ivory', TAUPE)
const IB = col(IVORY_BG)
const FINE = frame('#d9d3ca', 0.3)
const ICAP = { upper: true, spacing: 0.3 }
export const IVORY_PAGES: MagPage[] = [
  iP(1, 'The wedding of', IB, [{ x: 16, y: 12, w: 68, h: 64, frame: FINE }], [], [
    t('The Wedding of', 50, 6, 70, 2.6, 'cormorant', IVORY_INK, { italic: true }),
    t('{bride} & {groom}', 50, 84, 90, 5, 'italiana', IVORY_INK, { spacing: 0.04 }),
    t('{date}', 50, 91.5, 60, 1.3, 'cinzel', TAUPE_DARK, ICAP),
  ]),
  iP(2, 'Full bleed', IB, [FULL]),
  iP(3, 'Diptych', IB, [
    { x: 8, y: 20, w: 40, h: 50, frame: FINE },
    { x: 52, y: 20, w: 40, h: 50, frame: FINE },
  ], [], [
    t('Chapter One · The Beginning', 50, 11, 80, 1.35, 'cinzel', IVORY_INK, ICAP),
    t(STORY.beginning, 50, 83, 72, 1.85, 'cormorant', IVORY_INK),
  ]),
  iP(4, 'The morning of', col(CHAMPAGNE), [{ x: 10, y: 28, w: 80, h: 40, frame: FINE }], [], [
    t('The Morning Of', 50, 16, 86, 5.2, 'italiana', IVORY_INK, { spacing: 0.03 }),
    t(STORY.morning, 50, 81, 72, 1.8, 'cormorant', IVORY_INK, { italic: true }),
  ]),
  iP(5, 'One over two', IB, [
    { x: 10, y: 8, w: 80, h: 44 },
    { x: 10, y: 56, w: 38.5, h: 36 },
    { x: 51.5, y: 56, w: 38.5, h: 36 },
  ]),
  iP(6, 'Quiet page', col(BLUSH), [{ x: 30, y: 34, w: 40, h: 32, frame: FINE }], [], [
    t(QUOTE.lifetime, 50, 20, 72, 3.1, 'cormorant', IVORY_INK, { italic: true }),
    t('— {groom}', 50, 72, 40, 1.2, 'cinzel', TAUPE_DARK, ICAP),
  ]),
  iP(7, 'Full bleed II', IB, [FULL]),
  iP(8, 'Tall + two', IB, [
    { x: 8, y: 8, w: 54, h: 84 },
    { x: 66, y: 8, w: 26, h: 40 },
    { x: 66, y: 52, w: 26, h: 40 },
  ]),
  iP(9, 'Here comes the bride', col(BLUSH), [{ x: 25, y: 8, w: 50, h: 64, frame: FINE }], [], [
    t('Here comes the bride', 50, 80.5, 86, 4.4, 'pinyon', IVORY_INK),
    t(STORY.bride, 50, 90.5, 70, 1.6, 'cormorant', IVORY_INK),
  ]),
  iP(10, 'The details', IB, [
    { x: 10, y: 18, w: 38, h: 29.4 },
    { x: 52, y: 18, w: 38, h: 29.4 },
    { x: 10, y: 52, w: 38, h: 29.4 },
    { x: 52, y: 52, w: 38, h: 29.4 },
  ], [], [
    t('Every detail, a promise.', 50, 9, 86, 3.3, 'italiana', IVORY_INK, { spacing: 0.03 }),
    t('The Details', 50, 89, 60, 1.25, 'cinzel', TAUPE_DARK, ICAP),
  ]),
  iP(11, 'Wide + pair', IB, [
    { x: 0, y: 0, w: 100, h: 45 },
    { x: 10, y: 55, w: 38, h: 35 },
    { x: 52, y: 55, w: 38, h: 35 },
  ]),
  iP(12, 'Black & white', IB, [{ ...FULL, filter: 'bw' }]),
  iP(13, 'On a taupe block', IB, [{ x: 8, y: 12, w: 64, h: 76, z: 1 }], [block(60, 0, 40, 100)], [
    t('Chapter Two', 80, 6, 38, 2.5, 'cormorant', IVORY_INK, { italic: true }),
    t('The Vows', 86, 94, 26, 1.4, 'cinzel', IVORY_INK, ICAP),
  ]),
  iP(14, 'Three stacked', IB, [
    { x: 14, y: 8, w: 72, h: 26 },
    { x: 14, y: 37, w: 72, h: 26 },
    { x: 14, y: 66, w: 72, h: 26 },
  ]),
  iP(15, 'The vows', col(CHAMPAGNE), [{ x: 20, y: 7, w: 60, h: 66, frame: FINE }], [], [
    t('The Vows', 50, 80, 86, 4.6, 'italiana', IVORY_INK, { spacing: 0.04 }),
    t(STORY.vows, 50, 89.5, 70, 1.6, 'cormorant', IVORY_INK),
  ]),
  iP(16, 'Layered pair', IB, [
    { x: 8, y: 10, w: 50, h: 58, z: 0 },
    { x: 44, y: 50, w: 48, h: 40, z: 1, frame: frame('#ffffff', 1.2) },
  ]),
  iP(17, 'Full bleed III', IB, [FULL]),
  iP(18, 'Just married', col(CHAMPAGNE), [
    { x: 8, y: 30, w: 41, h: 40 },
    { x: 51, y: 30, w: 41, h: 40 },
  ], [], [
    t('Just Married', 50, 17, 90, 6.2, 'italiana', IVORY_INK, { spacing: 0.04 }),
    t(STORY.party, 50, 83, 72, 1.8, 'cormorant', IVORY_INK),
  ]),
  iP(19, 'Framed on haze', wash(0, 0, 'rgba(251,248,243,0.55)'), [
    { x: 14, y: 14, w: 72, h: 72, frame: frame('#ffffff', 1) },
  ]),
  iP(20, 'Thank you', IB, [{ x: 34, y: 22, w: 32, h: 34, frame: FINE }], [], [
    t('Thank you', 50, 66, 70, 5.4, 'pinyon', IVORY_INK),
    t(STORY.thanks, 50, 77, 64, 1.6, 'cormorant', IVORY_INK, { italic: true }),
    t('{names} · {date}', 50, 88, 70, 1.15, 'cinzel', TAUPE_DARK, ICAP),
  ]),
]

// ── SAGE — garden green, layered cream frames, one soft circle ──
const SAGE = '#8a9a7b'
const SAGE_CREAM = '#f1efe6'
const SAGE_DARK = '#3f4a36'
const sP = styledPage('sage', SAGE)
const SG = col(SAGE)
const SC = col(SAGE_CREAM)
const CF = frame(SAGE_CREAM, 0.9)
const SCAP = { upper: true, spacing: 0.3 }
export const SAGE_PAGES: MagPage[] = [
  sP(1, 'Cover', SG, [{ x: 10, y: 17, w: 80, h: 64, frame: CF }], [], [
    t('{bride} & {groom}', 50, 8.5, 92, 6, 'vibes', SAGE_CREAM),
    t('The Wedding Issue', 50, 88.5, 70, 1.4, 'cinzel', SAGE_CREAM, SCAP),
    t('{date}', 50, 93.8, 60, 2, 'cormorant', SAGE_CREAM, { italic: true }),
  ]),
  sP(2, 'Full bleed', SC, [FULL]),
  sP(3, 'Over the band', SC, [{ x: 18, y: 10, w: 74, h: 80, z: 1 }], [block(0, 0, 34, 100)]),
  sP(4, 'Chapter one', SC, [
    { x: 6, y: 6, w: 52, h: 56, z: 0 },
    { x: 42, y: 38, w: 52, h: 56, z: 1, frame: frame(SAGE_CREAM, 1.1) },
  ], [], [
    t('Chapter One', 79, 13, 38, 3.8, 'vibes', SAGE_DARK),
    t('The Beginning', 79, 21, 38, 1.1, 'cinzel', SAGE_DARK, SCAP),
    t(STORY.beginning, 21.5, 80, 35, 1.55, 'cormorant', SAGE_DARK),
  ]),
  sP(5, 'Black & white', SC, [{ ...FULL, filter: 'bw' }]),
  sP(6, 'Here comes the bride', SG, [
    { x: 8, y: 5, w: 40, h: 28, frame: CF },
    { x: 52, y: 36, w: 40, h: 28, frame: CF },
    { x: 8, y: 67, w: 40, h: 28, frame: CF },
  ], [], [
    t('Here comes the bride', 72, 17, 42, 3.6, 'vibes', SAGE_CREAM),
    t(STORY.bride, 72, 82, 40, 1.55, 'cormorant', SAGE_CREAM, { italic: true }),
  ]),
  sP(7, 'The morning of', SC, [
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 0, y: 56, w: 49.7, h: 44 },
    { x: 50.3, y: 56, w: 49.7, h: 44 },
  ], [block(0, 50, 100, 6)], [t('The Morning Of', 50, 53, 80, 1.4, 'cinzel', SAGE_CREAM, SCAP)]),
  sP(8, 'Full bleed II', SC, [FULL]),
  sP(9, 'Framed in green', wash(0, 0, 'rgba(138,154,123,0.6)'), [{ x: 10, y: 8, w: 80, h: 80, frame: CF }], [], [
    t(QUOTE.souls, 50, 94, 86, 2.4, 'cormorant', SAGE_CREAM, { italic: true }),
  ]),
  sP(10, 'Six', SC, [
    { x: 4, y: 4, w: 44, h: 29.5 },
    { x: 52, y: 4, w: 44, h: 29.5 },
    { x: 4, y: 35.25, w: 44, h: 29.5 },
    { x: 52, y: 35.25, w: 44, h: 29.5 },
    { x: 4, y: 66.5, w: 44, h: 29.5 },
    { x: 52, y: 66.5, w: 44, h: 29.5 },
  ]),
  // The style's one circle.
  sP(11, 'Circle on haze', wash(0, 0, 'rgba(138,154,123,0.45)'), [
    { x: 18, y: 20, w: 64, h: 0, shape: 'circle', frame: CF },
  ], [], [t('Every detail, a promise.', 50, 83, 86, 3.6, 'vibes', SAGE_CREAM, { shadow: true })]),
  sP(12, 'Split', SC, [
    { x: 0, y: 0, w: 49.7, h: 100 },
    { x: 50.3, y: 0, w: 49.7, h: 100 },
  ]),
  sP(13, 'The vows', SG, [
    { x: 16, y: 5, w: 68, h: 60, frame: CF, z: 0 },
    { x: 60, y: 60, w: 32, h: 30, frame: CF, z: 1 },
  ], [], [
    t('The Vows', 29, 74, 48, 4.4, 'playfair', SAGE_CREAM, { italic: true }),
    t(STORY.vows, 29, 86, 46, 1.45, 'cormorant', SAGE_CREAM),
  ]),
  sP(14, 'Full bleed III', SC, [FULL]),
  sP(15, 'Staggered four', SC, [
    { x: 6, y: 4, w: 42, h: 44 },
    { x: 52, y: 12, w: 42, h: 44 },
    { x: 6, y: 52, w: 42, h: 44 },
    { x: 52, y: 60, w: 42, h: 36 },
  ]),
  sP(16, 'Under the canopy', SC, [{ x: 8, y: 14, w: 84, h: 78, z: 1 }], [block(0, 0, 100, 30)], [
    t('Chapter Three · The Celebration', 50, 7, 90, 1.35, 'cinzel', SAGE_CREAM, SCAP),
  ]),
  sP(17, 'Just married', SC, [
    { x: 0, y: 0, w: 100, h: 62, z: 0 },
    { x: 60, y: 52, w: 32, h: 30, frame: frame(SAGE_CREAM, 1.2), z: 1 },
  ], [], [
    t('Just Married', 29, 73, 54, 5.4, 'vibes', SAGE_DARK),
    t(STORY.party, 29, 87, 50, 1.5, 'cormorant', SAGE_DARK),
  ]),
  sP(18, 'Black & white II', SC, [{ ...FULL, filter: 'bw' }]),
  sP(19, 'Two in green', SG, [
    { x: 8, y: 8, w: 84, h: 40, frame: CF },
    { x: 8, y: 52, w: 84, h: 40, frame: CF },
  ]),
  sP(20, 'With love', SG, [{ x: 25, y: 8, w: 50, h: 46, frame: CF }], [], [
    t('With love,', 50, 62, 70, 4.4, 'vibes', SAGE_CREAM),
    t('{bride} & {groom}', 50, 70, 86, 3.4, 'playfair', SAGE_CREAM, { italic: true }),
    t(STORY.thanks, 50, 80.5, 70, 1.5, 'cormorant', SAGE_CREAM, { italic: true }),
    t('{date}', 50, 91, 60, 1.2, 'cinzel', SAGE_CREAM, SCAP),
  ]),
]

/* ═══════════════════════════ style catalogue ═══════════════════════════ */

export type MagStyle = {
  id: string
  /** Big display name shown on the style card. */
  name: string
  tagline: string
  /** Colours for the card's little swatch row. */
  swatches: string[]
  pages: MagPage[]
}

export const MAG_STYLES: MagStyle[] = [
  {
    id: 'terracotta',
    name: 'TERRACOTTA',
    tagline: 'Warm rust bands, cream keylines, blurred photo washes.',
    swatches: [RUST, CREAM, '#ffffff'],
    pages: MAG_PAGES,
  },
  {
    id: 'noir',
    name: 'NOIR',
    tagline: 'Cinematic black pages, white keylines, black & white moments.',
    swatches: [NOIR_BG, '#ffffff', '#7a7a7a'],
    pages: NOIR_PAGES,
  },
  {
    id: 'ivory',
    name: 'IVORY',
    tagline: 'Gallery white with blush and champagne pages — quiet and timeless.',
    swatches: [IVORY_BG, BLUSH, CHAMPAGNE],
    pages: IVORY_PAGES,
  },
  {
    id: 'sage',
    name: 'SAGE',
    tagline: 'Garden green, layered cream frames and flowing script.',
    swatches: [SAGE, SAGE_CREAM, SAGE_DARK],
    pages: SAGE_PAGES,
  },
]

export const DEFAULT_MAG_STYLE = 'terracotta'

export function getMagStyle(id: string | undefined | null): MagStyle {
  return MAG_STYLES.find((s) => s.id === id) ?? MAG_STYLES[0]
}

/** Photo slots in a style (what the client should upload). */
export function magSlotCount(style: MagStyle): number {
  return style.pages.reduce((n, p) => n + p.slots.length, 0)
}

export const MAG_PAGE_BY_ID = new Map(MAG_STYLES.flatMap((st) => st.pages).map((p) => [p.id, p] as const))

/** Total photo slots across the Terracotta magazine. */
export const MAG_SLOT_COUNT = MAG_PAGES.reduce((n, p) => n + p.slots.length, 0)

/** Resolve a slot's drawn height (circles are sized from width). */
export function magSlotBox(s: MagSlot): MagSlot {
  return s.shape === 'circle' ? { ...s, h: s.w * MAG_ASPECT } : s
}

type Orient = 'portrait' | 'landscape' | 'square'
function orientOf(w: number, h: number): Orient {
  const r = w / h
  if (r < 0.85) return 'portrait'
  if (r > 1.18) return 'landscape'
  return 'square'
}

/**
 * Fill the fixed pages with photos, in the client's order (capture time
 * when known). Orientation-aware with a short look-ahead: each slot takes
 * the next unused photo whose shape suits it (portrait photo → tall slot,
 * landscape → wide slot), looking at most 6 photos ahead so the story
 * stays chronological. Circles and square-ish slots take anything.
 * Returns photo ids per page (null = empty slot).
 */
export function fillMagazine(
  photos: { id: string; width: number; height: number }[],
  pagesDef: MagPage[] = MAG_PAGES,
): (string | null)[][] {
  const queue = [...photos]
  const LOOKAHEAD = 6
  return pagesDef.map((pg) =>
    pg.slots.map((raw) => {
      if (queue.length === 0) return null
      const s = magSlotBox(raw)
      const want: Orient = s.shape === 'circle' ? 'square' : orientOf(s.w * MAG_ASPECT, s.h)
      let pick = 0
      if (want !== 'square') {
        const k = queue
          .slice(0, LOOKAHEAD)
          .findIndex((p) => orientOf(p.width, p.height) === want)
        if (k > 0) pick = k
      }
      return queue.splice(pick, 1)[0].id
    }),
  )
}
