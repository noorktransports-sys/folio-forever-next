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

export const MAG_PAGE_BY_ID = new Map(MAG_PAGES.map((p) => [p.id, p] as const))

/** Total photo slots across the magazine (what the client should upload). */
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
): (string | null)[][] {
  const queue = [...photos]
  const LOOKAHEAD = 6
  return MAG_PAGES.map((pg) =>
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
