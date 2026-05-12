// src/app/design/smart/edit/cover-presets.ts
//
// Three ready-made cover designs per cover type. The customer picks one
// instead of building a cover from scratch — they still set the names +
// free-form line, but the typography / color / position is preset so each
// album lands in a known-good aesthetic. Picking a preset materialises
// into a SmartCoverState with the preset's typography baked in.
//
// Variation language per cover type:
//   • leather  — foil-stamped text only, no photo. Varies font + foil color.
//   • acrylic  — photo behind clear acrylic; foil-stamped text. Varies font
//                + foil color + position.
//   • photo    — full-bleed photo; CMYK ink text printed on top. Varies
//                font + ink color + position.
//
// The CSS font families here mirror cover-builder.tsx FONTS. Foil hexes
// mirror FOIL_COLORS. Keep both lists in sync if either changes.

export type SmartCoverType = 'leather' | 'acrylic' | 'photo'
export type SmartCoverPosition = 'top' | 'center' | 'lower'

export interface CoverPreset {
  id: string
  /** Customer-facing name shown under the variation card. */
  label: string
  /** Short tagline rendered under the label to communicate the aesthetic. */
  blurb: string
  coverType: SmartCoverType
  fontId: string
  fontFamily: string
  fontStyle: 'normal' | 'italic'
  /** Primary text size in CSS pixels (matches cover-builder slider range). */
  fontSize: number
  position: SmartCoverPosition
  /** Foil hex — used by leather AND acrylic (both foil-stamped). */
  foilHex?: string
  /** Foil id for serialisation back to the foil colour palette. */
  foilId?: string
  /** Ink hex used by photo covers. */
  customTextHex?: string
  /** Default leather color id for leather presets. */
  leatherColorId?: string
  leatherHex?: string
}

// Font lookup mirrored from cover-builder.tsx — keep in sync.
const F = {
  cormorant: { family: '"Cormorant Garamond", serif', style: 'normal' as const },
  cormorantItalic: { family: '"Cormorant Garamond", serif', style: 'italic' as const },
  playfair: { family: '"Playfair Display", serif', style: 'normal' as const },
  cinzel: { family: '"Cinzel", serif', style: 'normal' as const },
  greatVibes: { family: '"Great Vibes", cursive', style: 'normal' as const },
  italianno: { family: '"Italianno", cursive', style: 'normal' as const },
  bebas: { family: '"Bebas Neue", sans-serif', style: 'normal' as const },
}

// Foil + leather palettes mirrored from cover-builder.tsx.
const FOIL = {
  gold: '#d4b07a',
  silver: '#c8c8cc',
  roseGold: '#b76e79',
  black: '#0e0c09',
}
const LEATHER = {
  black: '#1a1816',
  brown: '#5a3a1a',
  ivory: '#f0e6d2',
  burgundy: '#5e1014',
}

export const COVER_PRESETS: CoverPreset[] = [
  // ─── LEATHER ────────────────────────────────────────────────────────
  // Foil-stamped text on premium hide. No photo. Varies font + foil colour.
  {
    id: 'leather-traditional',
    label: 'Traditional',
    blurb: 'Centered serif, gold foil',
    coverType: 'leather',
    fontId: 'cormorant',
    fontFamily: F.cormorant.family,
    fontStyle: F.cormorant.style,
    fontSize: 56,
    position: 'center',
    foilId: 'gold',
    foilHex: FOIL.gold,
    leatherColorId: 'black',
    leatherHex: LEATHER.black,
  },
  {
    id: 'leather-modern',
    label: 'Modern',
    blurb: 'Top-aligned sans, silver foil',
    coverType: 'leather',
    fontId: 'bebas-neue',
    fontFamily: F.bebas.family,
    fontStyle: F.bebas.style,
    fontSize: 64,
    position: 'top',
    foilId: 'silver',
    foilHex: FOIL.silver,
    leatherColorId: 'black',
    leatherHex: LEATHER.black,
  },
  {
    id: 'leather-elegant',
    label: 'Elegant',
    blurb: 'Centered script, rose-gold foil',
    coverType: 'leather',
    fontId: 'great-vibes',
    fontFamily: F.greatVibes.family,
    fontStyle: F.greatVibes.style,
    fontSize: 68,
    position: 'center',
    foilId: 'rose-gold',
    foilHex: FOIL.roseGold,
    leatherColorId: 'burgundy',
    leatherHex: LEATHER.burgundy,
  },
  // ─── ACRYLIC ────────────────────────────────────────────────────────
  // Photo behind clear acrylic; text foil-stamped on the acrylic.
  {
    id: 'acrylic-hero',
    label: 'Hero',
    blurb: 'Large centered serif, white foil',
    coverType: 'acrylic',
    fontId: 'cormorant',
    fontFamily: F.cormorant.family,
    fontStyle: F.cormorant.style,
    fontSize: 72,
    position: 'center',
    foilId: 'silver',
    foilHex: '#ffffff',
  },
  {
    id: 'acrylic-minimal',
    label: 'Minimalist',
    blurb: 'Small bottom sans, silver foil',
    coverType: 'acrylic',
    fontId: 'bebas-neue',
    fontFamily: F.bebas.family,
    fontStyle: F.bebas.style,
    fontSize: 32,
    position: 'lower',
    foilId: 'silver',
    foilHex: FOIL.silver,
  },
  {
    id: 'acrylic-romantic',
    label: 'Romantic',
    blurb: 'Centered script, rose-gold foil',
    coverType: 'acrylic',
    fontId: 'great-vibes',
    fontFamily: F.greatVibes.family,
    fontStyle: F.greatVibes.style,
    fontSize: 68,
    position: 'center',
    foilId: 'rose-gold',
    foilHex: FOIL.roseGold,
  },
  // ─── PHOTO ──────────────────────────────────────────────────────────
  // Full-bleed photo; text printed in CMYK ink on top.
  {
    id: 'photo-classic',
    label: 'Classic',
    blurb: 'Centered serif, white ink',
    coverType: 'photo',
    fontId: 'cormorant',
    fontFamily: F.cormorant.family,
    fontStyle: F.cormorant.style,
    fontSize: 56,
    position: 'center',
    customTextHex: '#ffffff',
  },
  {
    id: 'photo-cinematic',
    label: 'Cinematic',
    blurb: 'Lower-third script, white ink',
    coverType: 'photo',
    fontId: 'great-vibes',
    fontFamily: F.greatVibes.family,
    fontStyle: F.greatVibes.style,
    fontSize: 64,
    position: 'lower',
    customTextHex: '#ffffff',
  },
  {
    id: 'photo-editorial',
    label: 'Editorial',
    blurb: 'Top-band sans, gold ink',
    coverType: 'photo',
    fontId: 'bebas-neue',
    fontFamily: F.bebas.family,
    fontStyle: F.bebas.style,
    fontSize: 40,
    position: 'top',
    customTextHex: FOIL.gold,
  },
]

export function presetsForType(t: SmartCoverType): CoverPreset[] {
  return COVER_PRESETS.filter((p) => p.coverType === t)
}

export function findPreset(id: string): CoverPreset | undefined {
  return COVER_PRESETS.find((p) => p.id === id)
}

/**
 * State persisted on the order. Captures the chosen preset PLUS the
 * customer's free-form inputs — the printer can re-render the cover at
 * print resolution from this alone (no need to inspect the canvas blob).
 */
export interface SmartCoverState {
  coverType: SmartCoverType
  presetId: string
  /** Couple name (line 1 — primary text on the cover). */
  primaryText: string
  /** Free-form line (line 2 — date, place, etc; optional). */
  subtitleText: string
  /** photoId from the smart wizard's uploaded photos (for acrylic/photo). */
  photoId?: string
  /** Resolved blob: URL or https URL of the chosen photo — for the live
   *  preview only. Not persisted to the order (we use photoId there). */
  photoSrc?: string
}
