// src/lib/magazine/styles-more.ts
//
// Six more magazine styles (05–10). Same rules as pages.ts: 20 pages,
// % coordinates, page 1 is a real magazine cover (see kit.cover), at most
// one circle per style (none here), every text editable.

import type { MagStyle } from './pages'
import { QUOTE, STORY, block, col, cover, frame, grid, styledPage, t, wash, FULL, type MagPage } from './kit'

const W = '#ffffff'
const CAP = { upper: true, spacing: 0.3, weight: 500 as const }

/* ══════════════════════════ 05 · VOGUE ══════════════════════════
 * High-fashion editorial: white pages, black type, a red accent,
 * chapter numbers, a contents page, full-bleed black & white. */
const V_INK = '#111111'
const V_RED = '#b3122e'
const vP = styledPage('vogue', V_RED)
const VW = col(W)
const chapter = (n: number, num: string, title: string): MagPage =>
  vP(n, `Chapter ${num}`, VW, [{ ...FULL, filter: 'bw' }], [], [
    t(num, 16, 12, 28, 14, 'bodoni', W, { weight: 600, shadow: true }),
    t(title, 24, 22, 44, 1.35, 'montserrat', W, { ...CAP, align: 'left', spacing: 0.36, shadow: true }),
  ])
const VOGUE_PAGES: MagPage[] = [
  (() => {
    const c = cover({ masthead: 'VOWS', mastFont: 'bodoni', mastSize: 15, mastSpacing: 0.04, mastWeight: 700, lineFont: 'bodoni', lineItalic: true, accent: '#ffd9df' })
    return vP(1, 'Cover', VW, c.slots, [], c.texts, c.overlay)
  })(),
  vP(2, 'Contents', VW, [
    { x: 55, y: 7, w: 38, h: 42 },
    { x: 0, y: 58, w: 100, h: 42 },
  ], [block(7, 8, 8, 0.5, V_RED)], [
    t('Contents', 30, 14, 46, 6.2, 'bodoni', V_INK, { italic: true, align: 'left' }),
    t('04  The Beginning\n08  The Morning Of\n12  The Vows\n16  The Celebration\n20  With Love', 30, 35, 46, 1.5, 'montserrat', V_INK, { ...CAP, align: 'left', spacing: 0.16 }),
    t('The Wedding Issue · {year}', 30, 51, 46, 1, 'montserrat', V_RED, { ...CAP, align: 'left' }),
  ]),
  chapter(3, '01', 'The Beginning'),
  vP(4, 'The Beginning', VW, [{ x: 8, y: 44, w: 84, h: 50 }], [block(8, 8, 10, 0.45, V_RED)], [
    t('The Beginning', 50, 16.5, 84, 6, 'bodoni', V_INK, { align: 'left' }),
    t(STORY.beginning, 50, 31, 84, 1.8, 'cormorant', V_INK, { align: 'left' }),
  ]),
  vP(5, 'Full bleed', VW, [FULL]),
  vP(6, 'Stacked pair', VW, [
    { x: 0, y: 0, w: 100, h: 49.4 },
    { x: 0, y: 50.6, w: 100, h: 49.4 },
  ]),
  chapter(7, '02', 'The Morning Of'),
  vP(8, 'Four', VW, grid(2, 2, 6, 6, 88, 80, 1.5), [], [t('The Morning Of — Details', 50, 93, 80, 1.1, 'montserrat', V_INK, CAP)]),
  vP(9, 'Portrait & quote', VW, [
    { x: 0, y: 0, w: 62, h: 100 },
    { x: 66, y: 62, w: 30, h: 30 },
  ], [], [
    t(QUOTE.lifetime, 81, 28, 32, 3, 'playfair', V_INK, { italic: true }),
    t('— {groom}', 81, 43, 30, 1.05, 'montserrat', V_RED, CAP),
  ]),
  vP(10, 'Here comes the bride', VW, [FULL], [], [t('Here comes the bride.', 50, 90, 86, 4.4, 'bodoni', W, { italic: true, shadow: true })]),
  vP(11, 'The Details', VW, grid(3, 1, 4, 14, 92, 74, 2, 2, { filter: 'bw' }), [], [
    t('The Details', 50, 7, 80, 1.3, 'montserrat', V_RED, CAP),
    t(STORY.details, 50, 94, 84, 1.45, 'cormorant', V_INK, { italic: true }),
  ]),
  chapter(12, '03', 'The Vows'),
  vP(13, 'The Vows', VW, [{ x: 0, y: 36, w: 100, h: 64 }], [], [
    t('The Vows', 50, 11, 90, 9, 'bodoni', V_INK, { italic: true }),
    t(STORY.vows, 50, 25.5, 72, 1.85, 'cormorant', V_INK),
  ]),
  vP(14, 'Full bleed II', VW, [FULL]),
  vP(15, 'Wide + quote', VW, [
    { x: 0, y: 0, w: 100, h: 56 },
    { x: 6, y: 60, w: 42, h: 34 },
  ], [], [
    t(QUOTE.always, 74, 72, 40, 3.2, 'bodoni', V_INK, { italic: true }),
    t('— {bride}', 74, 83, 40, 1.05, 'montserrat', V_RED, CAP),
  ]),
  chapter(16, '04', 'The Celebration'),
  vP(17, 'Six', VW, grid(2, 3, 6, 6, 88, 88, 1.5)),
  vP(18, 'Split', VW, [
    { x: 0, y: 0, w: 49.6, h: 100 },
    { x: 50.4, y: 0, w: 49.6, h: 100 },
  ]),
  vP(19, 'Just Married', VW, [FULL], [], [t('Just Married', 50, 86, 92, 9, 'bodoni', W, { italic: true, shadow: true })]),
  vP(20, 'With love', VW, [{ x: 20, y: 9, w: 60, h: 56 }], [block(46, 92, 8, 0.35, V_RED)], [
    t('With love,', 50, 72.5, 60, 3, 'bodoni', V_INK, { italic: true }),
    t('{bride} & {groom}', 50, 80, 86, 4.6, 'bodoni', V_INK),
    t('{date}', 50, 87.5, 60, 1.1, 'montserrat', V_RED, CAP),
  ]),
]

/* ════════════════════════ 06 · MAHARANI ════════════════════════
 * Royal South Asian: maroon & emerald pages, gold double keylines,
 * Cinzel capitals, calligraphy script. */
const MAROON = '#5a1022'
const EMERALD = '#0f3d33'
const GOLD = '#c9a14a'
const M_CREAM = '#f3e6c8'
const mP = styledPage('maharani', GOLD)
const GL = frame(GOLD, 0.3)
/** Gold double keyline behind a photo: gold band, page-colour gap, gold line on the photo. */
const dk = (x: number, y: number, w: number, h: number, pageColor: string) => [
  block(x - 1.4, y - 1.1, w + 2.8, h + 2.2, GOLD),
  block(x - 1.0, y - 0.8, w + 2.0, h + 1.6, pageColor),
]
const MCAP = { upper: true, spacing: 0.4 }
const MAHARANI_PAGES: MagPage[] = [
  (() => {
    const c = cover({ masthead: 'MAHARANI', mastFont: 'cinzel', mastSize: 9.2, mastSpacing: 0.12, mastWeight: 600, lineFont: 'cormorant', lineItalic: true, ink: '#fff3dc', accent: GOLD, shade: 0.55 })
    return mP(1, 'Cover', col(MAROON), c.slots, [], c.texts, c.overlay)
  })(),
  mP(2, 'Chapter One', col(MAROON), [{ x: 18, y: 10, w: 64, h: 62, frame: GL }], dk(18, 10, 64, 62, MAROON), [
    t('Chapter One', 50, 81.5, 80, 1.5, 'cinzel', GOLD, MCAP),
    t('The Beginning', 50, 88, 86, 4.4, 'pinyon', M_CREAM),
  ]),
  mP(3, 'Full bleed', col(MAROON), [FULL]),
  mP(4, 'Two families', col(EMERALD), [
    { x: 8, y: 14, w: 40, h: 60, frame: GL },
    { x: 52, y: 14, w: 40, h: 60, frame: GL },
  ], [...dk(8, 14, 40, 60, EMERALD), ...dk(52, 14, 40, 60, EMERALD)], [
    t('Two Families', 50, 7, 60, 1.3, 'cinzel', GOLD, MCAP),
    t(STORY.beginning, 50, 86, 76, 1.7, 'cormorant', M_CREAM, { italic: true }),
  ]),
  mP(5, 'Full bleed II', col(MAROON), [FULL]),
  mP(6, 'The morning of', wash(0, 0, 'rgba(90,16,34,0.55)'), [{ x: 12, y: 10, w: 76, h: 66, frame: frame(GOLD, 0.6) }], [], [
    t('The Morning Of', 50, 88, 86, 4.6, 'pinyon', M_CREAM, { shadow: true }),
  ]),
  mP(7, 'Four in gold', col(MAROON), grid(2, 2, 8, 8, 84, 74, 2, 2, { frame: GL }), [], [
    t(STORY.morning, 50, 91, 80, 1.5, 'cormorant', M_CREAM, { italic: true }),
  ]),
  mP(8, 'Full bleed III', col(MAROON), [FULL]),
  mP(9, 'The bride', col(EMERALD), [{ x: 14, y: 6, w: 72, h: 72, frame: GL }], dk(14, 6, 72, 72, EMERALD), [
    t('Here comes the bride', 50, 86, 90, 4.6, 'pinyon', M_CREAM),
    t('The Bride', 50, 93, 50, 1.2, 'cinzel', GOLD, MCAP),
  ]),
  mP(10, 'Gold strips', col(GOLD), grid(1, 3, 0, 0, 100, 100, 0.8)),
  mP(11, 'The details', col(MAROON), grid(3, 2, 6, 20, 88, 56, 2, 2, { frame: GL }), [], [
    t('The Details', 50, 10, 80, 4.2, 'pinyon', M_CREAM),
    t(STORY.details, 50, 87, 76, 1.55, 'cormorant', M_CREAM, { italic: true }),
  ]),
  mP(12, 'Black & white', col(MAROON), [{ ...FULL, filter: 'bw' }]),
  mP(13, 'The vows', col(EMERALD), [{ x: 0, y: 0, w: 100, h: 58 }], [], [
    t('The Vows', 50, 67.5, 80, 1.6, 'cinzel', GOLD, { upper: true, spacing: 0.45 }),
    t(STORY.vows, 50, 78, 76, 1.85, 'cormorant', M_CREAM, { italic: true }),
    t(QUOTE.souls, 50, 90.5, 80, 3.4, 'pinyon', GOLD),
  ]),
  mP(14, 'Layered pair', col(MAROON), [
    { x: 6, y: 6, w: 56, h: 58, z: 0 },
    { x: 40, y: 40, w: 54, h: 54, z: 1, frame: frame(GOLD, 0.8) },
  ]),
  mP(15, 'Full bleed IV', col(MAROON), [FULL]),
  mP(16, 'The family', wash(0, 0.1, 'rgba(15,61,51,0.6)'), grid(2, 1, 8, 24, 84, 44, 3, 3, { frame: frame(GOLD, 0.5) }), [], [
    t('The Family', 50, 12, 80, 4.4, 'pinyon', M_CREAM, { shadow: true }),
    t(STORY.family, 50, 82, 76, 1.6, 'cormorant', M_CREAM, { italic: true, shadow: true }),
  ]),
  mP(17, 'Six in gold', col(MAROON), grid(2, 3, 6, 6, 88, 88, 2, 2, { frame: GL })),
  mP(18, 'Gold split', col(GOLD), [
    { x: 0, y: 0, w: 49.5, h: 100 },
    { x: 50.5, y: 0, w: 49.5, h: 100 },
  ]),
  mP(19, 'The celebration', col(MAROON), [FULL], [], [t('The Celebration', 50, 88, 90, 5, 'pinyon', '#fff3dc', { shadow: true })]),
  mP(20, 'With love', col(MAROON), [{ x: 26, y: 10, w: 48, h: 50, frame: GL }], dk(26, 10, 48, 50, MAROON), [
    t('With love,', 50, 68.5, 70, 4, 'pinyon', M_CREAM),
    t('{bride} & {groom}', 50, 76.5, 86, 2.8, 'cinzel', GOLD, { upper: true, spacing: 0.2 }),
    t(STORY.thanks, 50, 85, 70, 1.5, 'cormorant', M_CREAM, { italic: true }),
    t('{date}', 50, 92.5, 60, 1.1, 'cinzel', GOLD, MCAP),
  ]),
]

/* ═════════════════════════ 07 · ANALOG ═════════════════════════
 * Film photography: warm paper, thick white print borders, contact
 * sheets, typewriter-style captions and frame numbers. */
const PAPER = '#eee6d8'
const A_INK = '#2b2622'
const A_MUTED = '#8a7f70'
const SHEET = '#1b1a18'
const PRINT = frame('#ffffff', 2.2)
const aP = styledPage('analog', A_INK)
const AP = col(PAPER)
const ACAP = { upper: true, spacing: 0.26, weight: 500 as const }
const ANALOG_PAGES: MagPage[] = [
  (() => {
    const c = cover({ masthead: 'ANALOG', mastFont: 'playfair', mastSize: 12, mastSpacing: 0.18, mastWeight: 700, lineFont: 'playfair', lineItalic: true, shade: 0.45 })
    return aP(1, 'Cover', AP, c.slots, [], c.texts, c.overlay)
  })(),
  aP(2, 'Frame 01', AP, [{ x: 14, y: 9, w: 72, h: 60, frame: PRINT }], [], [
    t('Frame 01 — The Beginning', 50, 75, 80, 1.1, 'montserrat', A_INK, ACAP),
    t(STORY.beginning, 50, 84.5, 72, 1.8, 'cormorant', A_INK, { italic: true }),
  ]),
  aP(3, 'Full bleed', AP, [FULL]),
  aP(4, 'Contact sheet', col(SHEET), grid(3, 3, 6, 8, 88, 78, 1.6), [], [
    t('Contact sheet · {date}', 50, 92.5, 80, 1.05, 'montserrat', '#d9d2c5', ACAP),
  ]),
  aP(5, 'Two prints', AP, [
    { x: 8, y: 6, w: 50, h: 44, frame: PRINT, z: 0 },
    { x: 40, y: 48, w: 52, h: 44, frame: PRINT, z: 1 },
  ], [], [
    t('The Morning Of', 22, 70, 36, 3.6, 'playfair', A_INK, { italic: true }),
    t('{date}', 22, 77, 36, 1, 'montserrat', A_MUTED, ACAP),
  ]),
  aP(6, 'Black & white', AP, [{ ...FULL, filter: 'bw' }]),
  aP(7, 'Three prints', AP, grid(1, 3, 22, 5, 56, 90, 2.4, 2.4, { frame: PRINT })),
  aP(8, 'Full bleed II', AP, [FULL]),
  aP(9, 'The bride', AP, [{ x: 8, y: 8, w: 84, h: 56, frame: PRINT }], [], [
    t('Here comes the bride', 50, 72, 84, 4, 'playfair', A_INK, { italic: true }),
    t(STORY.bride, 50, 83.5, 72, 1.7, 'cormorant', A_INK),
  ]),
  aP(10, 'Four prints', AP, grid(2, 2, 7, 7, 86, 80, 3, 3, { frame: PRINT }), [], [
    t('The Details', 50, 93, 60, 1.1, 'montserrat', A_INK, ACAP),
  ]),
  aP(11, 'Full bleed III', AP, [FULL]),
  aP(12, 'Contact sheet II', col(SHEET), grid(2, 3, 8, 8, 84, 78, 2), [], [
    t('Roll 02 · Frames 14–19', 50, 92.5, 80, 1.05, 'montserrat', '#d9d2c5', ACAP),
  ]),
  aP(13, 'The vows', AP, [{ x: 0, y: 0, w: 100, h: 60 }], [], [
    t('The Vows', 50, 69, 80, 5, 'playfair', A_INK, { italic: true }),
    t(STORY.vows, 50, 81, 74, 1.8, 'cormorant', A_INK),
    t('Frame 12', 50, 93, 40, 1, 'montserrat', A_MUTED, ACAP),
  ]),
  aP(14, 'Black & white II', AP, [{ ...FULL, filter: 'bw' }]),
  aP(15, 'Three strips', AP, grid(1, 3, 0, 0, 100, 100, 1.2)),
  aP(16, 'Tall + two', AP, [
    { x: 6, y: 6, w: 46, h: 86, frame: PRINT },
    { x: 56, y: 6, w: 38, h: 40, frame: PRINT },
    { x: 56, y: 52, w: 38, h: 40, frame: PRINT },
  ]),
  aP(17, 'Full bleed IV', AP, [FULL]),
  aP(18, 'The celebration', wash(0, 0.35), [{ x: 10, y: 10, w: 80, h: 58, frame: PRINT }], [], [
    t('The Celebration', 50, 78.5, 86, 4.4, 'playfair', '#ffffff', { italic: true, shadow: true }),
    t(STORY.party, 50, 89, 76, 1.6, 'cormorant', '#f3eee6', { shadow: true }),
  ]),
  aP(19, 'Split', AP, [
    { x: 0, y: 0, w: 49.6, h: 100 },
    { x: 50.4, y: 0, w: 49.6, h: 100 },
  ]),
  aP(20, 'With love', AP, [{ x: 30, y: 14, w: 40, h: 46, frame: PRINT }], [], [
    t('With love,', 50, 68.5, 60, 3.6, 'playfair', A_INK, { italic: true }),
    t('{bride} & {groom}', 50, 76, 80, 2.6, 'montserrat', A_INK, { upper: true, spacing: 0.3 }),
    t(STORY.thanks, 50, 84.5, 66, 1.55, 'cormorant', A_INK, { italic: true }),
    t('Developed with love · {date}', 50, 93, 70, 1, 'montserrat', A_MUTED, ACAP),
  ]),
]

/* ══════════════════════════ 08 · BLUSH ══════════════════════════
 * Soft romance: blush and rose pages, white frames, flowing script. */
const BL = '#f6e3e1'
const ROSE = '#d9a5a0'
const PLUM = '#5b3a3a'
const WF = frame('#ffffff', 0.9)
const bP = styledPage('blush', ROSE)
const BB = col(BL)
const BLUSH_PAGES: MagPage[] = [
  (() => {
    const c = cover({ masthead: 'Blush', mastFont: 'vibes', mastSize: 14, mastSpacing: 0, mastWeight: 400, lineFont: 'cormorant', lineItalic: true, accent: '#ffe3e0', shade: 0.4 })
    return bP(1, 'Cover', BB, c.slots, [], c.texts, c.overlay)
  })(),
  bP(2, 'Chapter One', BB, [{ x: 16, y: 10, w: 68, h: 64, frame: WF }], [], [
    t('Chapter One', 50, 82, 70, 4.2, 'vibes', PLUM),
    t('The Beginning', 50, 89, 60, 1.2, 'cinzel', PLUM, { upper: true, spacing: 0.4 }),
  ]),
  bP(3, 'Full bleed', BB, [FULL]),
  bP(4, 'Pair on rose', BB, [
    { x: 10, y: 12, w: 38, h: 52, frame: WF },
    { x: 52, y: 22, w: 38, h: 52, frame: WF },
  ], [block(0, 0, 100, 38, ROSE)], [t(STORY.beginning, 50, 86, 76, 1.75, 'cormorant', PLUM, { italic: true })]),
  bP(5, 'Full bleed II', BB, [FULL]),
  bP(6, 'The morning of', wash(0, 0, 'rgba(217,165,160,0.5)'), [{ x: 14, y: 10, w: 72, h: 66, frame: WF }], [], [
    t('The Morning Of', 50, 87, 86, 4.8, 'vibes', '#ffffff', { shadow: true }),
  ]),
  bP(7, 'Four', BB, grid(2, 2, 8, 8, 84, 76, 2.5, 2.5, { frame: WF }), [], [
    t(QUOTE.home, 50, 92, 80, 2.4, 'cormorant', PLUM, { italic: true }),
  ]),
  bP(8, 'Full bleed III', BB, [FULL]),
  bP(9, 'The bride', BB, [
    { x: 0, y: 0, w: 56, h: 100 },
    { x: 60, y: 30, w: 34, h: 40, frame: WF },
  ], [], [
    t('Here comes the bride', 77, 13, 38, 3.2, 'vibes', PLUM),
    t(STORY.bride, 77, 83, 36, 1.45, 'cormorant', PLUM, { italic: true }),
  ]),
  bP(10, 'Three stacked', BB, grid(1, 3, 12, 6, 76, 88, 2.2, 2.2, { frame: WF })),
  bP(11, 'Full bleed IV', BB, [FULL]),
  bP(12, 'The details', BB, grid(3, 2, 6, 22, 88, 54, 2, 2, { frame: frame('#ffffff', 0.6) }), [], [
    t('Every detail, a promise.', 50, 11, 86, 3.8, 'vibes', PLUM),
    t(STORY.details, 50, 87, 76, 1.5, 'cormorant', PLUM, { italic: true }),
  ]),
  bP(13, 'The vows', col(ROSE), [{ x: 10, y: 8, w: 80, h: 56, frame: WF }], [], [
    t('The Vows', 50, 72, 70, 4.6, 'vibes', '#ffffff'),
    t(STORY.vows, 50, 84, 74, 1.7, 'cormorant', '#ffffff', { italic: true }),
  ]),
  bP(14, 'Black & white', BB, [{ ...FULL, filter: 'bw' }]),
  bP(15, 'Layered pair', BB, [
    { x: 6, y: 6, w: 54, h: 56, z: 0 },
    { x: 40, y: 40, w: 54, h: 54, z: 1, frame: frame('#ffffff', 1.2) },
  ]),
  bP(16, 'Full bleed V', BB, [FULL]),
  bP(17, 'Six', BB, grid(2, 3, 6, 6, 88, 88, 2)),
  bP(18, 'The celebration', wash(0, 0, 'rgba(217,165,160,0.55)'), grid(2, 1, 8, 20, 84, 48, 3, 3, { frame: WF }), [], [
    t('The Celebration', 50, 10, 86, 4.4, 'vibes', '#ffffff', { shadow: true }),
    t(STORY.party, 50, 82, 76, 1.6, 'cormorant', '#ffffff', { italic: true, shadow: true }),
  ]),
  bP(19, 'Full bleed VI', BB, [FULL]),
  bP(20, 'With love', BB, [{ x: 28, y: 10, w: 44, h: 50, frame: WF }], [], [
    t('With love,', 50, 68.5, 60, 4.6, 'vibes', PLUM),
    t('{bride} & {groom}', 50, 77, 86, 3.2, 'cormorant', PLUM, { italic: true }),
    t(STORY.thanks, 50, 85.5, 70, 1.45, 'cormorant', PLUM),
    t('{date}', 50, 92.5, 60, 1.1, 'cinzel', PLUM, { upper: true, spacing: 0.35 }),
  ]),
]

/* ═════════════════════════ 09 · RIVIERA ═════════════════════════
 * Destination / travel: sand, navy and azure, postcard borders, stamps. */
const SAND = '#efe3cf'
const NAVY = '#1f3354'
const AZURE = '#6fa3c8'
const R_CREAM = '#f1e9da'
const POST = frame('#ffffff', 1.8)
const rP = styledPage('riviera', AZURE)
const RS = col(SAND)
const RCAP = { upper: true, spacing: 0.3, weight: 500 as const }
const RIVIERA_PAGES: MagPage[] = [
  (() => {
    const c = cover({ masthead: 'RIVIERA', mastFont: 'playfair', mastSize: 11.5, mastSpacing: 0.16, mastWeight: 700, lineFont: 'playfair', lineItalic: true, accent: '#cfe4f3', shade: 0.45 })
    return rP(1, 'Cover', RS, c.slots, [], c.texts, c.overlay)
  })(),
  rP(2, 'Postcard', RS, [{ x: 10, y: 14, w: 80, h: 54, frame: POST }], [block(78, 2.5, 14, 9, AZURE)], [
    t('{year}', 85, 7, 14, 2.2, 'cinzel', '#ffffff'),
    t('Greetings from our wedding', 50, 75, 84, 3.2, 'playfair', NAVY, { italic: true }),
    t('Chapter One · The Beginning', 50, 81.5, 70, 1.1, 'montserrat', NAVY, RCAP),
  ]),
  rP(3, 'Full bleed', RS, [FULL]),
  rP(4, 'Two postcards', col(NAVY), [
    { x: 8, y: 8, w: 56, h: 40, frame: POST, z: 0 },
    { x: 36, y: 46, w: 56, h: 40, frame: POST, z: 1 },
  ], [], [
    t('The Beginning', 82, 20, 30, 3.4, 'playfair', '#ffffff', { italic: true }),
    t(STORY.beginning, 18, 74, 30, 1.4, 'cormorant', R_CREAM, { italic: true }),
  ]),
  rP(5, 'Full bleed II', RS, [FULL]),
  rP(6, 'The morning of', wash(0, 0, 'rgba(31,51,84,0.55)'), [{ x: 12, y: 10, w: 76, h: 66, frame: POST }], [], [
    t('The Morning Of', 50, 86, 86, 4.4, 'playfair', '#ffffff', { italic: true, shadow: true }),
  ]),
  rP(7, 'Four postcards', RS, grid(2, 2, 7, 7, 86, 78, 3, 3, { frame: frame('#ffffff', 1.2) }), [], [
    t('Wish you were here', 50, 93, 70, 2.4, 'playfair', NAVY, { italic: true }),
  ]),
  rP(8, 'Full bleed III', RS, [FULL]),
  rP(9, 'The bride', RS, [{ x: 0, y: 0, w: 100, h: 62 }], [], [
    t('Here comes the bride', 50, 72, 86, 4.2, 'playfair', NAVY, { italic: true }),
    t(STORY.bride, 50, 84, 74, 1.7, 'cormorant', NAVY),
  ]),
  rP(10, 'The details', col(NAVY), grid(3, 1, 5, 16, 90, 68, 2.5, 2.5, { frame: frame('#ffffff', 1) }), [], [
    t('The Details', 50, 8, 60, 1.3, 'montserrat', '#ffffff', RCAP),
    t(STORY.details, 50, 92, 80, 1.45, 'cormorant', R_CREAM, { italic: true }),
  ]),
  rP(11, 'Full bleed IV', RS, [FULL]),
  rP(12, 'Sea & sky', col(AZURE), [
    { x: 0, y: 0, w: 100, h: 49.6 },
    { x: 0, y: 50.4, w: 100, h: 49.6 },
  ]),
  rP(13, 'The vows', RS, [{ x: 8, y: 8, w: 84, h: 58, frame: POST }], [], [
    t('The Vows', 50, 74, 80, 4.8, 'playfair', NAVY, { italic: true }),
    t(STORY.vows, 50, 86, 74, 1.7, 'cormorant', NAVY),
  ]),
  rP(14, 'Full bleed V', RS, [FULL]),
  rP(15, 'Six', RS, grid(2, 3, 6, 6, 88, 88, 2)),
  rP(16, 'Postcards on azure', col(AZURE), [
    { x: 6, y: 8, w: 56, h: 48, frame: POST, z: 0 },
    { x: 38, y: 44, w: 56, h: 48, frame: POST, z: 1 },
  ]),
  rP(17, 'Black & white', RS, [{ ...FULL, filter: 'bw' }]),
  rP(18, 'The celebration', col(NAVY), [{ x: 0, y: 0, w: 100, h: 58 }], [], [
    t('The Celebration', 50, 68, 86, 4.8, 'playfair', '#ffffff', { italic: true }),
    t(STORY.party, 50, 80, 74, 1.7, 'cormorant', R_CREAM),
    t(QUOTE.favourite, 50, 92, 80, 1.9, 'cormorant', AZURE, { italic: true }),
  ]),
  rP(19, 'Full bleed VI', RS, [FULL]),
  rP(20, 'With love', RS, [{ x: 24, y: 10, w: 52, h: 46, frame: POST }], [], [
    t('With love,', 50, 65.5, 60, 3.6, 'playfair', NAVY, { italic: true }),
    t('{bride} & {groom}', 50, 73, 86, 3, 'cinzel', NAVY, { upper: true, spacing: 0.15 }),
    t(STORY.thanks, 50, 82.5, 70, 1.5, 'cormorant', NAVY, { italic: true }),
    t('{date}', 50, 91, 60, 1.1, 'montserrat', NAVY, RCAP),
  ]),
]

/* ═════════════════════════ 10 · GILDED ═════════════════════════
 * Evening luxury: black pages, champagne gold, art-deco double rules. */
const BLK = '#0c0b0a'
const CHAMP = '#d4b87a'
const G_IVORY = '#efe6d2'
const gP = styledPage('gilded', CHAMP)
const GB = col(BLK)
const CF = frame(CHAMP, 0.35)
const DECO = [block(6, 3.6, 88, 0.22, CHAMP), block(6, 4.4, 88, 0.1, CHAMP), block(6, 95.5, 88, 0.1, CHAMP), block(6, 96.2, 88, 0.22, CHAMP)]
const GCAP = { upper: true, spacing: 0.4, weight: 500 as const }
const GILDED_PAGES: MagPage[] = [
  (() => {
    const c = cover({ masthead: 'GILDED', mastFont: 'italiana', mastSize: 13, mastSpacing: 0.22, mastWeight: 400, lineFont: 'cormorant', lineItalic: true, ink: '#fff7e6', accent: CHAMP, shade: 0.6 })
    return gP(1, 'Cover', GB, c.slots, [], c.texts, c.overlay)
  })(),
  gP(2, 'Chapter One', GB, [{ x: 16, y: 11, w: 68, h: 60, frame: CF }], DECO, [
    t('Chapter One', 50, 79.5, 70, 4, 'italiana', CHAMP, { spacing: 0.08 }),
    t('The Beginning', 50, 86.5, 60, 1.15, 'montserrat', G_IVORY, GCAP),
  ]),
  gP(3, 'Full bleed', GB, [FULL]),
  gP(4, 'Pair', GB, [
    { x: 8, y: 11, w: 40, h: 56, frame: CF },
    { x: 52, y: 11, w: 40, h: 56, frame: CF },
  ], DECO, [t(STORY.beginning, 50, 81.5, 76, 1.75, 'cormorant', G_IVORY, { italic: true })]),
  gP(5, 'Black & white', GB, [{ ...FULL, filter: 'bw' }]),
  gP(6, 'The morning of', wash(0, 0.55), [{ x: 12, y: 10, w: 76, h: 66, frame: frame(CHAMP, 0.6) }], [], [
    t('The Morning Of', 50, 87, 86, 4.4, 'italiana', CHAMP, { spacing: 0.06, shadow: true }),
  ]),
  gP(7, 'Four', GB, grid(2, 2, 8, 9, 84, 76, 1.6, 1.6, { frame: CF }), DECO, [
    t('The Details', 50, 90.8, 60, 1.2, 'montserrat', CHAMP, GCAP),
  ]),
  gP(8, 'Full bleed II', GB, [FULL]),
  gP(9, 'The bride', GB, [{ x: 0, y: 0, w: 58, h: 100 }], [block(61.5, 10, 0.18, 80, CHAMP)], [
    t('Here comes the bride', 80, 30, 34, 3.4, 'italiana', CHAMP, { spacing: 0.04 }),
    t(STORY.bride, 80, 62, 32, 1.45, 'cormorant', G_IVORY, { italic: true }),
  ]),
  gP(10, 'Gold strips', col(CHAMP), grid(1, 3, 0, 0, 100, 100, 0.6)),
  gP(11, 'Full bleed III', GB, [FULL]),
  gP(12, 'Every detail', GB, grid(3, 2, 6, 22, 88, 54, 1.6, 1.6, { frame: frame(CHAMP, 0.25) }), DECO, [
    t('Every detail, a promise.', 50, 12, 86, 3.4, 'italiana', CHAMP, { spacing: 0.04 }),
    t(STORY.details, 50, 86, 76, 1.5, 'cormorant', G_IVORY, { italic: true }),
  ]),
  gP(13, 'The vows', GB, [{ x: 0, y: 0, w: 100, h: 58 }], [], [
    t('The Vows', 50, 66.5, 80, 1.5, 'montserrat', CHAMP, { upper: true, spacing: 0.5, weight: 500 }),
    t(STORY.vows, 50, 77, 76, 1.85, 'cormorant', G_IVORY, { italic: true }),
    t(QUOTE.always, 50, 89, 80, 3, 'italiana', CHAMP),
  ]),
  gP(14, 'Full bleed IV', GB, [FULL]),
  gP(15, 'Layered pair', GB, [
    { x: 6, y: 6, w: 56, h: 58, z: 0 },
    { x: 40, y: 40, w: 54, h: 54, z: 1, frame: frame(CHAMP, 0.6) },
  ]),
  gP(16, 'Black & white II', GB, [{ ...FULL, filter: 'bw' }]),
  gP(17, 'Six', GB, grid(2, 3, 6, 6, 88, 88, 1.6)),
  gP(18, 'The celebration', wash(0, 0.5), grid(2, 1, 8, 24, 84, 44, 2.5, 2.5, { frame: frame(CHAMP, 0.4) }), [], [
    t('The Celebration', 50, 12, 86, 4.4, 'italiana', CHAMP, { spacing: 0.05, shadow: true }),
    t(STORY.party, 50, 82, 76, 1.6, 'cormorant', G_IVORY, { italic: true, shadow: true }),
  ]),
  gP(19, 'Full bleed V', GB, [FULL]),
  gP(20, 'With love', GB, [{ x: 28, y: 12, w: 44, h: 48, frame: CF }], DECO, [
    t('With love,', 50, 68.5, 60, 3.4, 'italiana', CHAMP, { spacing: 0.06 }),
    t('{bride} & {groom}', 50, 76, 86, 3.6, 'cormorant', G_IVORY, { italic: true }),
    t(STORY.thanks, 50, 84, 70, 1.45, 'cormorant', G_IVORY),
    t('{date}', 50, 91, 60, 1.1, 'montserrat', CHAMP, GCAP),
  ]),
]

export const MORE_STYLES: MagStyle[] = [
  { id: 'vogue', name: 'VOGUE', tagline: 'High-fashion editorial — black & white, a red accent, chapter numbers.', swatches: [W, V_INK, V_RED], pages: VOGUE_PAGES },
  { id: 'maharani', name: 'MAHARANI', tagline: 'Royal maroon & emerald with gold double keylines.', swatches: [MAROON, EMERALD, GOLD], pages: MAHARANI_PAGES },
  { id: 'analog', name: 'ANALOG', tagline: 'Film prints, contact sheets and warm paper.', swatches: [PAPER, '#ffffff', SHEET], pages: ANALOG_PAGES },
  { id: 'blush', name: 'BLUSH', tagline: 'Soft blush and rose, white frames, flowing script.', swatches: [BL, ROSE, PLUM], pages: BLUSH_PAGES },
  { id: 'riviera', name: 'RIVIERA', tagline: 'Destination postcards in sand, navy and azure.', swatches: [SAND, NAVY, AZURE], pages: RIVIERA_PAGES },
  { id: 'gilded', name: 'GILDED', tagline: 'Black and champagne gold with art-deco rules.', swatches: [BLK, CHAMP, G_IVORY], pages: GILDED_PAGES },
]
