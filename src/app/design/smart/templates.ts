/**
 * templates.ts — Slot-coord template library for the Smart wizard.
 *
 * Each template is a CSS-grid recipe for one spread. The engine
 * (`generateLayout` in page.tsx) picks templates by `photoCount` and an
 * optional `category` to produce visually varied albums.
 *
 * The shape is intentionally compatible with the layouts array in
 * public/js/album-builder.js so the two systems can be unified later
 * without re-designing coordinates.
 *
 * Binding rules:
 *   - 'layflat'   → free to span the spine; slot edges can fall anywhere
 *   - 'hardcover' → every slot edge must align with the 50 % gutter so no
 *                   photo gets bisected by the binding
 *
 * Categories drive engine selection:
 *   - 'hero'      → big single statement; one photo dominates
 *   - 'pair'      → two photos, balanced or asymmetric
 *   - 'trio'      → three photos
 *   - 'quad'      → four photos in a grid or mosaic
 *   - 'storyboard'→ 5+ photos, contact-sheet feel
 *   - 'panorama'  → layflat-only specials that cross the spine
 *   - 'asymmetric'→ deliberately off-balance composition
 */

export type Binding = 'layflat' | 'hardcover';
export type Category =
  | 'hero'
  | 'pair'
  | 'trio'
  | 'quad'
  | 'storyboard'
  | 'panorama'
  | 'asymmetric';

export interface TemplateDef {
  id: string;
  name: string;
  cols: string;
  rows: string;
  slots: number;
  photoCount: number;
  binding: Binding;
  slotAreas?: string[];
  heroSlot?: number;
  category: Category;
}

export const TEMPLATES: TemplateDef[] = [
  // ── HERO / Single-photo emphasis ───────────────────────────────
  {
    id: 'lf_full',
    name: 'Full Spread',
    cols: '1fr',
    rows: '1fr',
    slots: 1,
    photoCount: 1,
    binding: 'layflat',
    heroSlot: 0,
    category: 'hero',
  },
  {
    id: 'hc_hero_blank_L',
    name: 'Hero Left · Quiet Right',
    cols: '1fr 1fr',
    rows: '1fr',
    slots: 1,
    photoCount: 1,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 2 / 2'],
    heroSlot: 0,
    category: 'hero',
  },
  {
    id: 'hc_hero_blank_R',
    name: 'Quiet Left · Hero Right',
    cols: '1fr 1fr',
    rows: '1fr',
    slots: 1,
    photoCount: 1,
    binding: 'hardcover',
    slotAreas: ['1 / 2 / 2 / 3'],
    heroSlot: 0,
    category: 'hero',
  },

  // ── PAIR / Two-photo layouts ───────────────────────────────────
  {
    id: 'lf_2a',
    name: 'Side by Side',
    cols: '1fr 1fr',
    rows: '1fr',
    slots: 2,
    photoCount: 2,
    binding: 'layflat',
    category: 'pair',
  },
  {
    id: 'lf_2b',
    name: 'Feature Left',
    cols: '2fr 1fr',
    rows: '1fr',
    slots: 2,
    photoCount: 2,
    binding: 'layflat',
    heroSlot: 0,
    category: 'asymmetric',
  },
  {
    id: 'lf_2c',
    name: 'Feature Right',
    cols: '1fr 2fr',
    rows: '1fr',
    slots: 2,
    photoCount: 2,
    binding: 'layflat',
    heroSlot: 1,
    category: 'asymmetric',
  },
  {
    id: 'hc_2a',
    name: 'One Per Page',
    cols: '1fr 1fr',
    rows: '1fr',
    slots: 2,
    photoCount: 2,
    binding: 'hardcover',
    category: 'pair',
  },
  {
    id: 'hc_2b',
    name: 'Stacked Left · Big Right',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 2,
    photoCount: 2,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 2 / 2', '1 / 2 / 3 / 3'],
    heroSlot: 1,
    category: 'asymmetric',
  },
  {
    id: 'hc_2c',
    name: 'Big Left · Stacked Right',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 2,
    photoCount: 2,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3'],
    heroSlot: 0,
    category: 'asymmetric',
  },

  // ── TRIO / Three-photo layouts ─────────────────────────────────
  {
    id: 'lf_3a',
    name: 'Triptych',
    cols: '1fr 1fr 1fr',
    rows: '1fr',
    slots: 3,
    photoCount: 3,
    binding: 'layflat',
    category: 'trio',
  },
  {
    id: 'lf_3b',
    name: 'Top Feature',
    cols: '1fr 1fr',
    rows: '2fr 1fr',
    slots: 3,
    photoCount: 3,
    binding: 'layflat',
    slotAreas: ['1 / 1 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'],
    heroSlot: 0,
    category: 'trio',
  },
  {
    id: 'lf_3c',
    name: 'Bottom Feature',
    cols: '1fr 1fr',
    rows: '1fr 2fr',
    slots: 3,
    photoCount: 3,
    binding: 'layflat',
    slotAreas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'],
    heroSlot: 2,
    category: 'trio',
  },
  {
    id: 'hc_3a',
    name: '1 Left · 2 Right',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 3,
    photoCount: 3,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'],
    heroSlot: 0,
    category: 'asymmetric',
  },
  {
    id: 'hc_3b',
    name: '2 Left · 1 Right',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 3,
    photoCount: 3,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 2 / 2', '2 / 1 / 3 / 2', '1 / 2 / 3 / 3'],
    heroSlot: 2,
    category: 'asymmetric',
  },
  {
    id: 'hc_3c',
    name: 'Big Left · Small + Wide Right',
    cols: '2fr 1fr 1fr',
    rows: '1fr 1fr',
    slots: 3,
    photoCount: 3,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 4', '2 / 2 / 3 / 4'],
    heroSlot: 0,
    category: 'asymmetric',
  },
  {
    id: 'hc_3d',
    name: 'Big Left · Stacked Right',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 3,
    photoCount: 3,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'],
    heroSlot: 0,
    category: 'asymmetric',
  },

  // ── QUAD / Four-photo layouts ──────────────────────────────────
  {
    id: 'lf_4a',
    name: 'Quad Grid',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 4,
    photoCount: 4,
    binding: 'layflat',
    category: 'quad',
  },
  {
    id: 'lf_4b',
    name: 'Wide Strip',
    cols: 'repeat(4, 1fr)',
    rows: '1fr',
    slots: 4,
    photoCount: 4,
    binding: 'layflat',
    category: 'quad',
  },
  {
    id: 'lf_4c',
    name: 'Feature + 3',
    cols: '2fr 1fr',
    rows: 'repeat(3, 1fr)',
    slots: 4,
    photoCount: 4,
    binding: 'layflat',
    slotAreas: ['1 / 1 / 4 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3', '3 / 2 / 4 / 3'],
    heroSlot: 0,
    category: 'asymmetric',
  },
  {
    id: 'hc_4a',
    name: '2×2 Grid',
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    slots: 4,
    photoCount: 4,
    binding: 'hardcover',
    category: 'quad',
  },
  {
    id: 'hc_4b',
    name: 'Wide Strip',
    cols: 'repeat(4, 1fr)',
    rows: '1fr',
    slots: 4,
    photoCount: 4,
    binding: 'hardcover',
    category: 'quad',
  },
  {
    id: 'hc_4c',
    name: 'Big Left · 3-Mosaic Right',
    cols: '2fr 1fr 1fr',
    rows: '1fr 1fr',
    slots: 4,
    photoCount: 4,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '1 / 3 / 2 / 4', '2 / 2 / 3 / 4'],
    heroSlot: 0,
    category: 'asymmetric',
  },
  {
    id: 'hc_4d',
    name: 'Big Left · Big-Top + 2-Small Right',
    cols: '2fr 1fr 1fr',
    rows: '2fr 1fr',
    slots: 4,
    photoCount: 4,
    binding: 'hardcover',
    slotAreas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 4', '2 / 2 / 3 / 3', '2 / 3 / 3 / 4'],
    heroSlot: 0,
    category: 'asymmetric',
  },

  // ── STORYBOARD / Five-plus photo layouts ───────────────────────
  {
    id: 'lf_5a',
    name: 'Feature + Quad',
    cols: '2fr 1fr 1fr',
    rows: '1fr 1fr',
    slots: 5,
    photoCount: 5,
    binding: 'layflat',
    slotAreas: [
      '1 / 1 / 3 / 2',
      '1 / 2 / 2 / 3',
      '1 / 3 / 2 / 4',
      '2 / 2 / 3 / 3',
      '2 / 3 / 3 / 4',
    ],
    heroSlot: 0,
    category: 'storyboard',
  },
  {
    id: 'lf_5b',
    name: 'Five Panel',
    cols: '1fr 1fr 1fr',
    rows: '1fr 1fr',
    slots: 5,
    photoCount: 5,
    binding: 'layflat',
    slotAreas: [
      '1 / 1 / 2 / 3',
      '1 / 3 / 2 / 4',
      '2 / 1 / 3 / 2',
      '2 / 2 / 3 / 3',
      '2 / 3 / 3 / 4',
    ],
    category: 'storyboard',
  },
  {
    id: 'hc_5c',
    name: '2-Left · Big-Top + 2-Bottom Right',
    cols: 'repeat(4, 1fr)',
    rows: 'repeat(3, 1fr)',
    slots: 5,
    photoCount: 5,
    binding: 'hardcover',
    slotAreas: [
      '1 / 1 / 3 / 3',
      '3 / 1 / 4 / 3',
      '1 / 3 / 3 / 5',
      '3 / 3 / 4 / 4',
      '3 / 4 / 4 / 5',
    ],
    heroSlot: 2,
    category: 'storyboard',
  },
  {
    id: 'lf_6a',
    name: 'Six Grid',
    cols: '1fr 1fr 1fr',
    rows: '1fr 1fr',
    slots: 6,
    photoCount: 6,
    binding: 'layflat',
    category: 'storyboard',
  },
  {
    id: 'lf_6b',
    name: 'Two by Three',
    cols: '1fr 1fr',
    rows: 'repeat(3, 1fr)',
    slots: 6,
    photoCount: 6,
    binding: 'layflat',
    category: 'storyboard',
  },
  {
    id: 'hc_6a',
    name: '3 Per Page',
    cols: 'repeat(4, 1fr)',
    rows: '1fr 1fr',
    slots: 6,
    photoCount: 6,
    binding: 'hardcover',
    slotAreas: [
      '1 / 1 / 3 / 2',
      '1 / 2 / 2 / 3',
      '2 / 2 / 3 / 3',
      '1 / 3 / 2 / 4',
      '2 / 3 / 3 / 4',
      '1 / 4 / 3 / 5',
    ],
    category: 'storyboard',
  },
  {
    id: 'hc_8a',
    name: '4 Per Page · 8 Total',
    cols: 'repeat(4, 1fr)',
    rows: 'repeat(2, 1fr)',
    slots: 8,
    photoCount: 8,
    binding: 'hardcover',
    slotAreas: [
      '1 / 1 / 2 / 2',
      '1 / 2 / 2 / 3',
      '2 / 1 / 3 / 2',
      '2 / 2 / 3 / 3',
      '1 / 3 / 2 / 4',
      '1 / 4 / 2 / 5',
      '2 / 3 / 3 / 4',
      '2 / 4 / 3 / 5',
    ],
    category: 'storyboard',
  },
  {
    id: 'hc_10a',
    name: 'Hero Left · 9 Contact Sheet Right',
    cols: 'repeat(6, 1fr)',
    rows: 'repeat(3, 1fr)',
    slots: 10,
    photoCount: 10,
    binding: 'hardcover',
    slotAreas: [
      '1 / 1 / 4 / 4',
      '1 / 4 / 2 / 5',
      '1 / 5 / 2 / 6',
      '1 / 6 / 2 / 7',
      '2 / 4 / 3 / 5',
      '2 / 5 / 3 / 6',
      '2 / 6 / 3 / 7',
      '3 / 4 / 4 / 5',
      '3 / 5 / 4 / 6',
      '3 / 6 / 4 / 7',
    ],
    heroSlot: 0,
    category: 'storyboard',
  },

  // ── PANORAMA / Layflat-only specials ───────────────────────────
  {
    id: 'lf_pano_top',
    name: 'Panorama Top · Pair Bottom',
    cols: '1fr 1fr',
    rows: '2fr 1fr',
    slots: 3,
    photoCount: 3,
    binding: 'layflat',
    slotAreas: ['1 / 1 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'],
    heroSlot: 0,
    category: 'panorama',
  },
  {
    id: 'lf_pano_bottom',
    name: 'Pair Top · Panorama Bottom',
    cols: '1fr 1fr',
    rows: '1fr 2fr',
    slots: 3,
    photoCount: 3,
    binding: 'layflat',
    slotAreas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'],
    heroSlot: 2,
    category: 'panorama',
  },
  {
    id: 'lf_pano_offset',
    name: 'Wide Panorama · Single Below',
    cols: '1fr 2fr 1fr',
    rows: '2fr 1fr',
    slots: 2,
    photoCount: 2,
    binding: 'layflat',
    slotAreas: ['1 / 1 / 2 / 4', '2 / 2 / 3 / 3'],
    heroSlot: 0,
    category: 'panorama',
  },
  {
    id: 'lf_pano_4',
    name: 'Panorama + 4-Strip',
    cols: 'repeat(4, 1fr)',
    rows: '2fr 1fr',
    slots: 5,
    photoCount: 5,
    binding: 'layflat',
    slotAreas: [
      '1 / 1 / 2 / 5',
      '2 / 1 / 3 / 2',
      '2 / 2 / 3 / 3',
      '2 / 3 / 3 / 4',
      '2 / 4 / 3 / 5',
    ],
    heroSlot: 0,
    category: 'panorama',
  },
];

/* ─────────────────────────────── helpers ────────────────────────────── */

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templatesByPhotoCount(
  count: number,
  binding?: Binding,
): TemplateDef[] {
  return TEMPLATES.filter(
    (t) => t.photoCount === count && (!binding || t.binding === binding),
  );
}

/**
 * Pick a template for the given photo count + optional category. Falls
 * back gracefully: exact match → photoCount match → photoCount=1 hero →
 * the first template.
 *
 * Caller can pin a `binding`; otherwise both bindings are eligible so a
 * layflat album can pull hardcover-safe templates too.
 */
export function pickTemplate(
  photoCount: number,
  category: Category | null = null,
  binding?: Binding,
): TemplateDef {
  const eligible = TEMPLATES.filter(
    (t) =>
      t.photoCount === photoCount &&
      (!binding || t.binding === binding) &&
      (!category || t.category === category),
  );
  if (eligible.length > 0) {
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
  // Loose: any template with this photo count
  const looseCount = TEMPLATES.filter((t) => t.photoCount === photoCount);
  if (looseCount.length > 0) {
    return looseCount[Math.floor(Math.random() * looseCount.length)];
  }
  // Last resort: a hero single
  return (
    TEMPLATES.find((t) => t.photoCount === 1) ?? TEMPLATES[0]
  );
}
