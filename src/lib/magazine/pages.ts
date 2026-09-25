// src/lib/magazine/pages.ts
//
// "Create Your Magazine" — the FIXED 20-page inside layout.
//
// Every page is 8.5 × 11 in, portrait. Coordinates are % of the PAGE
// (x/w of page width, y/h of page height), measured from the owner's
// designed reference pages (4830 × 6250 px exports). Page 20 was added
// to complete the set in the same rust / cream language.
//
// These are ordinary LayoutTemplates (id prefix `mag-`) so the shared
// print renderer (render-spread.ts) draws them exactly like the editor:
//   • `mag-` ids are never gap-snapped (overlaps are intentional)
//   • decor  = rust bands / blocks, drawn under the photos
//   • shape  = 'circle' → true circle sized from its width
//   • z      = paint order for overlapping photos
//   • frame  = the thin cream / grey keyline around a photo
//   • filter = 'bw' prints that photo in black & white
//   • bg.blur is a % of the PAGE WIDTH so the blur looks the same on
//     screen (cqw) and in the 300-DPI print file (px = pct × width).

import type { LayoutTemplate, Slot } from '@/lib/smart-layout/templates'

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

/** How a page's background is filled.
 *  - color:  flat colour (paper white, rust …)
 *  - blur:   a blurred copy of one of the page's own photos (slot index),
 *            optionally washed with a colour tint. Uses the same bg-photo
 *            path as the album editor, so proof === print. */
export type MagPageBg =
  | { kind: 'color'; color: string }
  | { kind: 'blur'; slot: number; blur: number; dim: number; tint?: string }

export type MagSlot = Slot & { filter?: 'bw' }

export type MagPage = LayoutTemplate & {
  slots: MagSlot[]
  bg: MagPageBg
}

const frame = (color: string, pct: number) => ({ color, pct })
const sideBars = (l: number, r: number) => [
  { x: 0, y: 0, w: l, h: 100, fill: 'accent' },
  { x: r, y: 0, w: 100 - r, h: 100, fill: 'accent' },
]
const fullRust = [{ x: 0, y: 0, w: 100, h: 100, fill: 'accent' }]

function page(
  n: number,
  name: string,
  bg: MagPageBg,
  slots: MagSlot[],
  decor: LayoutTemplate['decor'] = [],
): MagPage {
  return {
    id: `mag-p${String(n).padStart(2, '0')}`,
    name,
    compat: ['standard', 'layflat'],
    accent: RUST,
    bg,
    decor,
    slots,
  }
}

const WHITE: MagPageBg = { kind: 'color', color: '#ffffff' }

export const MAG_PAGES: MagPage[] = [
  // 1 — framed detail on a blurred copy of itself
  page(1, 'Framed detail', { kind: 'blur', slot: 0, blur: 1.2, dim: 0.05 }, [
    { x: 9.4, y: 5.4, w: 81, h: 89.2, frame: frame(CREAM, 0.85) },
  ]),
  // 2 — full-height photo between rust side bars
  page(2, 'Side bars', WHITE, [{ x: 4.3, y: 0, w: 91.4, h: 100 }], sideBars(4.3, 95.7)),
  // 3 — rust bands, wide photo, circle over the top band, box over the bottom band
  page(
    3,
    'Circle & box',
    WHITE,
    [
      { x: 0, y: 7, w: 100, h: 84.3, z: 0 },
      { x: 22.3, y: 1, w: 53, h: 0, shape: 'circle', z: 2, frame: frame('#3a3a3a', 0.15) },
      { x: 3.4, y: 55.8, w: 41, h: 44.2, z: 1 },
    ],
    [
      { x: 0, y: 0, w: 100, h: 7, fill: 'accent' },
      { x: 0, y: 91.3, w: 100, h: 8.7, fill: 'accent' },
    ],
  ),
  // 4 — rust bands top and bottom
  page(4, 'Top & bottom bands', WHITE, [{ x: 0, y: 7, w: 100, h: 84.5 }], [
    { x: 0, y: 0, w: 100, h: 7, fill: 'accent' },
    { x: 0, y: 91.5, w: 100, h: 8.5, fill: 'accent' },
  ]),
  // 5 — side bars
  page(5, 'Side bars II', WHITE, [{ x: 4.3, y: 0, w: 91.9, h: 100 }], sideBars(4.3, 96.2)),
  // 6 — black & white print framed on a blurred colour copy
  page(6, 'B&W framed', { kind: 'blur', slot: 0, blur: 1, dim: 0.05 }, [
    { x: 18.5, y: 14.4, w: 62.6, h: 72.5, frame: frame(CREAM, 1.4), filter: 'bw' },
  ]),
  // 7 — two photos stacked, edge to edge
  page(7, 'Stacked pair', WHITE, [
    { x: 2.2, y: 0, w: 97, h: 47.4 },
    { x: 0, y: 47.4, w: 100, h: 52.6 },
  ]),
  // 8 — near-full portrait on a warm blurred wash
  page(8, 'Portrait on wash', { kind: 'blur', slot: 0, blur: 2, dim: 0, tint: 'rgba(143,46,13,0.45)' }, [
    { x: 5, y: 1.1, w: 90.1, h: 98.9 },
  ]),
  // 9 — two landscapes on a warm blurred wash
  page(9, 'Two landscapes', { kind: 'blur', slot: 0, blur: 2, dim: 0, tint: 'rgba(143,46,13,0.55)' }, [
    { x: 6.4, y: 0, w: 88.4, h: 45.1 },
    { x: 6.4, y: 56.2, w: 88.4, h: 43.3 },
  ]),
  // 10 — side bars (narrow)
  page(10, 'Side bars III', WHITE, [{ x: 3.7, y: 0, w: 91.2, h: 100 }], sideBars(3.7, 94.9)),
  // 11 — three full-width strips
  page(11, 'Three strips', WHITE, [
    { x: 0, y: 0, w: 100, h: 31.1 },
    { x: 0, y: 31.3, w: 100, h: 37.3 },
    { x: 0, y: 68.8, w: 100, h: 31.2 },
  ]),
  // 12 — two portraits centred on rust
  page(12, 'Pair on rust', WHITE, [
    { x: 29.7, y: 0, w: 42.9, h: 45.3 },
    { x: 29.7, y: 55, w: 42.9, h: 45 },
  ], fullRust),
  // 13 — wide side bars (group shot)
  page(13, 'Wide side bars', WHITE, [{ x: 7.7, y: 0, w: 88.4, h: 100 }], sideBars(7.7, 96.1)),
  // 14 — side bars with a cream keyline
  page(14, 'Keyline bars', WHITE, [{ x: 5.1, y: 0, w: 90.1, h: 100 }], [
    ...sideBars(4.1, 96.2),
    { x: 4.1, y: 0, w: 1, h: 100, fill: CREAM },
    { x: 95.2, y: 0, w: 1, h: 100, fill: CREAM },
  ]),
  // 15 — staircase of three framed photos on rust
  page(15, 'Staircase', WHITE, [
    { x: 0, y: 0, w: 32.8, h: 31.2, frame: frame(CREAM, 1.2) },
    { x: 33, y: 31.4, w: 34, h: 37.4, frame: frame(CREAM, 1.2) },
    { x: 67.2, y: 68.9, w: 32.8, h: 31.1, frame: frame(CREAM, 1.2) },
  ], fullRust),
  // 16 — single portrait on white with a keyline
  page(16, 'Single framed', WHITE, [
    { x: 8.7, y: 1.5, w: 82.6, h: 85.5, frame: frame(KEYLINE, 0.3) },
  ]),
  // 17 — 2 × 2 grid
  page(17, 'Grid of four', WHITE, [
    { x: 0, y: 0, w: 49.85, h: 49.6 },
    { x: 50.15, y: 0, w: 49.85, h: 49.6 },
    { x: 0, y: 49.9, w: 49.85, h: 50.1 },
    { x: 50.15, y: 49.9, w: 49.85, h: 50.1 },
  ]),
  // 18 — one tall + two stacked, keylines on white
  page(18, 'Tall + two', WHITE, [
    { x: 8.5, y: 5.5, w: 36.3, h: 88.8, frame: frame(KEYLINE, 0.4) },
    { x: 51.3, y: 5.5, w: 40.3, h: 39.9, frame: frame(KEYLINE, 0.4) },
    { x: 51.3, y: 54.5, w: 40.3, h: 39.8, frame: frame(KEYLINE, 0.4) },
  ]),
  // 19 — three strips with white gaps
  page(19, 'Three strips II', WHITE, [
    { x: 0, y: 0, w: 100, h: 31 },
    { x: 0, y: 31.4, w: 100, h: 36.9 },
    { x: 0, y: 68.7, w: 100, h: 31.3 },
  ]),
  // 20 — closing page (new): circle over two framed boxes on rust
  page(20, 'Closing circle', WHITE, [
    { x: 17, y: 5, w: 66, h: 0, shape: 'circle', frame: frame(CREAM, 0.8), z: 1 },
    { x: 6, y: 60, w: 42, h: 34, frame: frame(CREAM, 1.2) },
    { x: 52, y: 60, w: 42, h: 34, frame: frame(CREAM, 1.2) },
  ], fullRust),
]

/* ═══════════════════════════ more styles ═══════════════════════════
 * Each style is its own 20-page design. Page ids are `mag-<style>-pNN`
 * (still `mag-` prefixed, so the shared renderer never gap-snaps them).
 * Terracotta keeps its original `mag-pNN` ids so saved albums still load.
 * Circle slots: set h: 0 — the real height is w × page aspect.
 */

function styledPage(style: string, accent: string) {
  return (n: number, name: string, bg: MagPageBg, slots: MagSlot[], decor: LayoutTemplate['decor'] = []): MagPage => ({
    id: `mag-${style}-p${String(n).padStart(2, '0')}`,
    name,
    compat: ['standard', 'layflat'],
    accent,
    bg,
    decor,
    slots,
  })
}
const col = (color: string): MagPageBg => ({ kind: 'color', color })
const FULL: MagSlot = { x: 0, y: 0, w: 100, h: 100 }

// ── NOIR — cinematic black, white keylines, lots of black & white ──
const NOIR_BG = '#111111'
const nP = styledPage('noir', NOIR_BG)
const NB = col(NOIR_BG)
const WHITE_LINE = frame('#ffffff', 0.35)
export const NOIR_PAGES: MagPage[] = [
  nP(1, 'Opening frame', NB, [{ ...FULL, filter: 'bw' }]),
  nP(2, 'Portrait in the dark', NB, [{ x: 14, y: 10, w: 72, h: 72, frame: WHITE_LINE }]),
  nP(3, 'Two scenes', NB, [
    { x: 8, y: 8, w: 84, h: 40 },
    { x: 8, y: 52, w: 84, h: 40, filter: 'bw' },
  ]),
  nP(4, 'Full colour', NB, [FULL]),
  nP(5, 'Scene + contact strip', NB, [
    { x: 0, y: 0, w: 100, h: 62 },
    { x: 6, y: 70, w: 28, h: 21.6, filter: 'bw' },
    { x: 36, y: 70, w: 28, h: 21.6, filter: 'bw' },
    { x: 66, y: 70, w: 28, h: 21.6, filter: 'bw' },
  ]),
  nP(6, 'Spotlight', NB, [{ x: 15, y: 23, w: 70, h: 0, shape: 'circle', frame: WHITE_LINE }]),
  nP(7, 'Split screen', NB, [
    { x: 0, y: 0, w: 50, h: 100 },
    { x: 50, y: 0, w: 50, h: 100, filter: 'bw' },
  ]),
  nP(8, 'Tall + detail', NB, [
    { x: 38, y: 0, w: 62, h: 100 },
    { x: 6, y: 60, w: 26, h: 30, frame: WHITE_LINE },
  ]),
  nP(9, 'Monochrome', NB, [{ ...FULL, filter: 'bw' }]),
  nP(10, 'Six frames', NB, [
    { x: 8, y: 8, w: 40, h: 27 },
    { x: 52, y: 8, w: 40, h: 27 },
    { x: 8, y: 37, w: 40, h: 27 },
    { x: 52, y: 37, w: 40, h: 27 },
    { x: 8, y: 66, w: 40, h: 27 },
    { x: 52, y: 66, w: 40, h: 27 },
  ]),
  nP(11, 'Framed on shadow', { kind: 'blur', slot: 0, blur: 2, dim: 0.45 }, [
    { x: 12, y: 12, w: 76, h: 76, frame: frame('#ffffff', 0.6) },
  ]),
  nP(12, 'Overlap', NB, [
    { x: 0, y: 0, w: 70, h: 55, z: 0 },
    { x: 30, y: 45, w: 70, h: 55, z: 1, frame: frame(NOIR_BG, 1.4) },
  ]),
  nP(13, 'Full colour II', NB, [FULL]),
  nP(14, 'Three columns', NB, [
    { x: 6, y: 15, w: 27, h: 70, filter: 'bw' },
    { x: 36.5, y: 15, w: 27, h: 70, filter: 'bw' },
    { x: 67, y: 15, w: 27, h: 70, filter: 'bw' },
  ]),
  nP(15, 'Letterbox', NB, [{ x: 0, y: 30, w: 100, h: 40 }]),
  nP(16, 'Portrait + still', NB, [
    { x: 20, y: 8, w: 60, h: 62, filter: 'bw' },
    { x: 38, y: 74, w: 24, h: 18, frame: WHITE_LINE },
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
  nP(19, 'Moon & horizon', { kind: 'blur', slot: 1, blur: 2, dim: 0.55 }, [
    { x: 22, y: 12, w: 56, h: 0, shape: 'circle', frame: WHITE_LINE },
    { x: 16, y: 62, w: 68, h: 30, frame: WHITE_LINE },
  ]),
  nP(20, 'Fade out', NB, [{ x: 30, y: 30, w: 40, h: 40, frame: WHITE_LINE }]),
]

// ── IVORY — gallery white, generous margins, fine grey keylines ──
const IVORY_BG = '#fbf8f3'
const TAUPE = '#cbbfae'
const iP = styledPage('ivory', TAUPE)
const IB = col(IVORY_BG)
const FINE = frame('#d9d3ca', 0.3)
export const IVORY_PAGES: MagPage[] = [
  iP(1, 'Gallery portrait', IB, [{ x: 16, y: 12, w: 68, h: 66, frame: FINE }]),
  iP(2, 'Full bleed', IB, [FULL]),
  iP(3, 'Diptych', IB, [
    { x: 8, y: 20, w: 40, h: 50, frame: FINE },
    { x: 52, y: 20, w: 40, h: 50, frame: FINE },
  ]),
  iP(4, 'Horizon', IB, [{ x: 10, y: 28, w: 80, h: 40, frame: FINE }]),
  iP(5, 'One over two', IB, [
    { x: 10, y: 8, w: 80, h: 44 },
    { x: 10, y: 56, w: 38.5, h: 36 },
    { x: 51.5, y: 56, w: 38.5, h: 36 },
  ]),
  iP(6, 'Quiet page', IB, [{ x: 30, y: 34, w: 40, h: 32, frame: FINE }]),
  iP(7, 'Full bleed II', IB, [FULL]),
  iP(8, 'Tall + two', IB, [
    { x: 8, y: 8, w: 54, h: 84 },
    { x: 66, y: 8, w: 26, h: 40 },
    { x: 66, y: 52, w: 26, h: 40 },
  ]),
  iP(9, 'Soft circle', IB, [{ x: 20, y: 20, w: 60, h: 0, shape: 'circle', frame: FINE }]),
  iP(10, 'Four square', IB, [
    { x: 10, y: 18, w: 38, h: 29.4 },
    { x: 52, y: 18, w: 38, h: 29.4 },
    { x: 10, y: 52, w: 38, h: 29.4 },
    { x: 52, y: 52, w: 38, h: 29.4 },
  ]),
  iP(11, 'Wide + pair', IB, [
    { x: 0, y: 0, w: 100, h: 45 },
    { x: 10, y: 55, w: 38, h: 35 },
    { x: 52, y: 55, w: 38, h: 35 },
  ]),
  iP(12, 'Black & white', IB, [{ ...FULL, filter: 'bw' }]),
  iP(13, 'On a taupe block', IB, [{ x: 8, y: 12, w: 64, h: 76, z: 1 }], [
    { x: 60, y: 0, w: 40, h: 100, fill: 'accent' },
  ]),
  iP(14, 'Three stacked', IB, [
    { x: 14, y: 8, w: 72, h: 26 },
    { x: 14, y: 37, w: 72, h: 26 },
    { x: 14, y: 66, w: 72, h: 26 },
  ]),
  iP(15, 'Portrait', IB, [{ x: 20, y: 10, w: 60, h: 70, frame: FINE }]),
  iP(16, 'Layered pair', IB, [
    { x: 8, y: 10, w: 50, h: 58, z: 0 },
    { x: 44, y: 50, w: 48, h: 40, z: 1, frame: frame('#ffffff', 1.2) },
  ]),
  iP(17, 'Full bleed III', IB, [FULL]),
  iP(18, 'Side by side', IB, [
    { x: 8, y: 30, w: 41, h: 40 },
    { x: 51, y: 30, w: 41, h: 40 },
  ]),
  iP(19, 'Framed on haze', { kind: 'blur', slot: 0, blur: 2, dim: 0, tint: 'rgba(251,248,243,0.55)' }, [
    { x: 14, y: 14, w: 72, h: 72, frame: frame('#ffffff', 1) },
  ]),
  iP(20, 'Last light', IB, [{ x: 35, y: 38, w: 30, h: 0, shape: 'circle', frame: FINE }]),
]

// ── SAGE — garden green, circles, overlapping cream frames ──
const SAGE = '#8a9a7b'
const SAGE_CREAM = '#f1efe6'
const sP = styledPage('sage', SAGE)
const SG = col(SAGE)
const SC = col(SAGE_CREAM)
const CF = frame(SAGE_CREAM, 0.9)
export const SAGE_PAGES: MagPage[] = [
  sP(1, 'Garden circle', SG, [{ x: 12, y: 16, w: 76, h: 0, shape: 'circle', frame: CF }]),
  sP(2, 'Full bleed', SC, [FULL]),
  sP(3, 'Over the band', SC, [{ x: 18, y: 10, w: 74, h: 80, z: 1 }], [{ x: 0, y: 0, w: 34, h: 100, fill: 'accent' }]),
  sP(4, 'Offset pair', SC, [
    { x: 6, y: 6, w: 52, h: 56, z: 0 },
    { x: 42, y: 38, w: 52, h: 56, z: 1, frame: frame(SAGE_CREAM, 1.1) },
  ]),
  sP(5, 'Black & white', SC, [{ ...FULL, filter: 'bw' }]),
  sP(6, 'Three circles', SG, [
    { x: 8, y: 6, w: 40, h: 0, shape: 'circle', frame: CF },
    { x: 52, y: 34.5, w: 40, h: 0, shape: 'circle', frame: CF },
    { x: 8, y: 63, w: 40, h: 0, shape: 'circle', frame: CF },
  ]),
  sP(7, 'Wide over two', SC, [
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 0, y: 56, w: 49.7, h: 44 },
    { x: 50.3, y: 56, w: 49.7, h: 44 },
  ], [{ x: 0, y: 50, w: 100, h: 6, fill: 'accent' }]),
  sP(8, 'Full bleed II', SC, [FULL]),
  sP(9, 'Framed in green', SG, [{ x: 10, y: 10, w: 80, h: 80, frame: CF }]),
  sP(10, 'Six', SC, [
    { x: 4, y: 4, w: 44, h: 29.5 },
    { x: 52, y: 4, w: 44, h: 29.5 },
    { x: 4, y: 35.25, w: 44, h: 29.5 },
    { x: 52, y: 35.25, w: 44, h: 29.5 },
    { x: 4, y: 66.5, w: 44, h: 29.5 },
    { x: 52, y: 66.5, w: 44, h: 29.5 },
  ]),
  sP(11, 'Circle on haze', { kind: 'blur', slot: 0, blur: 2, dim: 0, tint: 'rgba(138,154,123,0.45)' }, [
    { x: 18, y: 27, w: 64, h: 0, shape: 'circle', frame: CF },
  ]),
  sP(12, 'Split', SC, [
    { x: 0, y: 0, w: 49.7, h: 100 },
    { x: 50.3, y: 0, w: 49.7, h: 100 },
  ]),
  sP(13, 'Portrait + bloom', SG, [
    { x: 16, y: 6, w: 68, h: 62, frame: CF, z: 0 },
    { x: 58, y: 64, w: 30, h: 0, shape: 'circle', frame: CF, z: 1 },
  ]),
  sP(14, 'Full bleed III', SC, [FULL]),
  sP(15, 'Staggered four', SC, [
    { x: 6, y: 4, w: 42, h: 44 },
    { x: 52, y: 12, w: 42, h: 44 },
    { x: 6, y: 52, w: 42, h: 44 },
    { x: 52, y: 60, w: 42, h: 36 },
  ]),
  sP(16, 'Under the canopy', SC, [{ x: 8, y: 14, w: 84, h: 78, z: 1 }], [{ x: 0, y: 0, w: 100, h: 30, fill: 'accent' }]),
  sP(17, 'Wide + circle', SC, [
    { x: 0, y: 0, w: 100, h: 62, z: 0 },
    { x: 60, y: 52, w: 34, h: 0, shape: 'circle', frame: frame(SAGE_CREAM, 1.2), z: 1 },
  ]),
  sP(18, 'Black & white II', SC, [{ ...FULL, filter: 'bw' }]),
  sP(19, 'Two in green', SG, [
    { x: 8, y: 8, w: 84, h: 40, frame: CF },
    { x: 8, y: 52, w: 84, h: 40, frame: CF },
  ]),
  sP(20, 'Closing circle', SG, [{ x: 25, y: 30, w: 50, h: 0, shape: 'circle', frame: CF }]),
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
    tagline: 'Gallery white, generous margins, quiet and timeless.',
    swatches: [IVORY_BG, TAUPE, '#d9d3ca'],
    pages: IVORY_PAGES,
  },
  {
    id: 'sage',
    name: 'SAGE',
    tagline: 'Garden green, soft circles and layered cream frames.',
    swatches: [SAGE, SAGE_CREAM, '#5f6d53'],
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
      const want: Orient =
        s.shape === 'circle' ? 'square' : orientOf(s.w * MAG_ASPECT, s.h)
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
