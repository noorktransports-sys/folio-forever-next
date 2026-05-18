'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUndo } from './edit/use-undo'
import { UndoButtons, useToast } from './edit/UndoButtons'
import {
  makeSwapOp,
  makeSwapWithUnusedOp,
  makeCrossSwapOp,
  makeRemoveOp,
  makeLayoutVariantOp,
  makeReorderSpreadOp,
  type Spread as OpSpread,
} from './edit/operations'
import { SlotImage, type SlotAdjust } from './edit/PanSlider'
import {
  saveBlob,
  loadAlbumBlobs,
  clearAlbumBlobs,
} from './edit/photo-blob-store'
import { useSlotDrag } from './edit/swap'
import { PhotoCountDropdown } from './edit/PhotoCountDropdown'
import { buildPhotoCountOp, buildAddOp } from './edit/photo-count'

export const runtime = 'edge'

// ============== ALBUM STORAGE ==============
// Smart albums share the `folio-albums-index` localStorage key with the
// manual builder so they appear in the same "My Albums" list on /design.
// The `mode: 'smart'` field on each entry tells the picker to route
// back to /design/smart instead of /design/build on resume.

const ALBUMS_INDEX_KEY = 'folio-albums-index'
const SMART_STATE_PREFIX = 'folio-smart-state'

type AlbumIndexEntry = {
  id: string
  name: string
  createdAt: string
  lastEditedAt: string
  mode?: 'smart' | 'manual'
}

function readAlbumsIndex(): AlbumIndexEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ALBUMS_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAlbumsIndex(list: AlbumIndexEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ALBUMS_INDEX_KEY, JSON.stringify(list))
  } catch {
    /* quota or disabled — ignore */
  }
}

function upsertAlbumIndex(id: string, patch: Partial<AlbumIndexEntry>) {
  const list = readAlbumsIndex()
  const existing = list.find((a) => a.id === id)
  const now = new Date().toISOString()
  if (existing) {
    Object.assign(existing, patch, { lastEditedAt: now })
  } else {
    list.unshift({
      id,
      name: 'Untitled',
      createdAt: now,
      lastEditedAt: now,
      ...patch,
    })
  }
  writeAlbumsIndex(list)
}

function generateAlbumId(): string {
  return 'a' + Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 6)
}

// What we persist per album. We always save metadata; photo previews are
// kept too — sample photos use stable HTTPS URLs (survive refresh), while
// uploaded photos use blob: URLs which are invalidated on reload. We
// fall back gracefully if a preview won't load.

// ============== CONSTANTS ==============

const GOLD = '#b8965a'
const HERO_MIN_PX = 3000
const PHOTO_CAP = 100
const HERO_CAP = 8
const FAV_CAP = 30

// ============== TYPES ==============

type AlbumSize = '17x24' | '20x30' | '12x24' | '15x30'
type AlbumType = 'standard' | 'layflat'

type EventId =
  | 'unassigned'
  | 'mehndi'
  | 'haldi'
  | 'prep'
  | 'nikkah'
  | 'wedding'
  | 'reception'
  | 'valima'
  | 'other1'
  | 'other2'
  // Legacy values from older saved albums — kept in the union so
  // hydration doesn't trip on them. migrateLegacyEvent maps these
  // to current EventIds.
  | 'ceremony'
  | 'portraits'
  | 'other'

type EventDef = { id: EventId; name: string }

// Tag list shown in the Group step + used by the layout engine's
// chronological ordering. Order matches typical Pakistani / Indian
// wedding flow (Mehndi → Haldi → Getting Ready → Nikkah → Wedding →
// Reception → Valima → spillover slots).
const EVENTS: EventDef[] = [
  { id: 'mehndi', name: 'Mehndi' },
  { id: 'haldi', name: 'Haldi' },
  { id: 'prep', name: 'Getting Ready' },
  { id: 'nikkah', name: 'Nikkah' },
  { id: 'wedding', name: 'Wedding' },
  { id: 'reception', name: 'Reception' },
  { id: 'valima', name: 'Valima' },
  { id: 'other1', name: 'Other 1' },
  { id: 'other2', name: 'Other 2' },
]

/**
 * Map any legacy EventId (from albums saved with the old 5-tag list)
 * to a current one. Run on hydrated photos so the Group step doesn't
 * end up with photos in a no-longer-rendered bucket.
 */
function migrateLegacyEvent(eid: EventId): EventId {
  switch (eid) {
    case 'ceremony':
      return 'wedding'
    case 'portraits':
      return 'other1'
    case 'other':
      return 'other1'
    default:
      return eid
  }
}

type Photo = {
  id: string
  preview: string
  width: number
  height: number
  tagged: 'hero' | 'favorite' | 'none'
  eventId: EventId
  blurry: boolean
}

type Step =
  | 'setup'
  | 'guidance'
  | 'upload'
  | 'group'
  | 'tag'
  | 'pages'
  | 'generate'
  | 'adjust'
  | 'proof'
  | 'submit'

// ───── Legal clauses (PDF: Album_Legal_Clauses_and_Dev_Instructions.pdf) ─────
// Stored as constants so the EXACT text shown to the user is the EXACT text
// captured in the audit record. Versioned — bump the suffix if clause text
// changes so old acceptances stay traceable to the version they accepted.
//
// [ATTORNEY REVIEW PENDING] — placeholders [Company], [STATE/COUNTRY],
// [JURISDICTION] left intentionally so the attorney can finalize before
// these appear on payment-enabled production.
const LEGAL_VERSION = 'v1-2026-05-11'

const CLAUSE_PROOF_APPROVAL = `2.3  PROOF APPROVAL — FINAL RESPONSIBILITY OF CUSTOMER

You will receive a digital proof of every spread before printing. By approving the proof, you confirm that:

  (a) you have reviewed every spread carefully and the design reflects what you want printed;
  (b) the order of photos, crops, layout, and any visible text are correct;
  (c) you understand that once you approve the proof, the album enters production and CANNOT be cancelled, modified, refunded, or recalled for any reason other than a manufacturing defect attributable to [Company];
  (d) any error you fail to identify in the proof — including but not limited to misplaced photos, color shifts within normal tolerance, spelling, cropping, or sequence — is your responsibility, not [Company]'s;
  (e) reprints requested due to customer-side errors will be billed at full price.

This approval is the single most important decision in the order. Please take your time.`

const CLAUSE_CONTENT_RIGHTS = `2.4  CONTENT OWNERSHIP & COPYRIGHT — INDEMNIFICATION

By uploading photos to [Company], you represent and warrant that:

  (a) you own the photos, OR you have explicit written or verbal permission from the photographer / rights-holder to use them in a printed album for personal use;
  (b) the photos do not infringe upon any copyright, trademark, publicity right, privacy right, or other intellectual-property right of any third party;
  (c) you will defend, indemnify, and hold harmless [Company], its agents, and its production partners against any claim, demand, or liability (including reasonable attorney's fees) arising from a breach of (a) or (b).

[Company] does not verify ownership and is not liable for content uploaded by the customer.`

const CLAUSE_CONTENT_POLICY = `2.2  CONTENT QUALITY & POLICY

You agree not to upload content that is illegal, sexually explicit, hateful, defamatory, or that depicts minors in any inappropriate way. [Company] reserves the right to refuse to print any content that violates this policy at our sole discretion, and to refund the order minus any work already performed.

You are responsible for the quality of the source files you upload. Low-resolution photos (under 1500 px on the shortest edge) may print soft or pixelated. We will not stop the order for resolution reasons unless you ask us to — but you accept the print result.`

// Threshold for the "low resolution" warning shown at upload + on each
// photo card. 1500 px on the shortest edge is the floor for an acceptable
// 17×24 print at ~150 dpi viewing distance.
const LOW_RES_PX = 1500

type Slot = { x: number; y: number; w: number; h: number; isHero?: boolean }

type LayoutTemplate = {
  id: string
  name: string
  slots: Slot[]
  compat: AlbumType[]
}

type Spread = {
  id: string
  templateId: string
  // (string | null)[] so a slot can be empty after layout-grow / remove.
  // Empty slots show a "+ Add" button — the engine never inserts nulls
  // automatically, only the user does via the layout-switch flow.
  photoIds: (string | null)[]
  eventId: EventId
}

type PhotoAdjust = {
  zoom: number
  panX: number
  panY: number
  flipH: boolean
  flipV: boolean
  /** Rotation in degrees, any value (was constrained to 90° snaps). */
  rotate: number
  fit: 'fill' | 'contain'
  /** Photo frame: 0 = none … 10 = thick. Rendered as a % of slot so it
   *  looks consistent in the editor, proof preview, and print composite. */
  borderWidth: number
  borderColor: string
}
const DEFAULT_ADJUST: PhotoAdjust = {
  zoom: 1,
  panX: 50,
  panY: 50,
  flipH: false,
  flipV: false,
  rotate: 0,
  fit: 'fill',
  borderWidth: 0,
  borderColor: '#ffffff',
}

/** Curated frame colours. */
const BORDER_PALETTE: { id: string; label: string; hex: string }[] = [
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'cream', label: 'Cream', hex: '#f5f0e8' },
  { id: 'black', label: 'Black', hex: '#0e0c09' },
  { id: 'charcoal', label: 'Charcoal', hex: '#3a342c' },
  { id: 'gold', label: 'Gold', hex: '#b8965a' },
]

/** Frame thickness in px for a given level + the element's rendered
 *  width, so the frame is the SAME relative weight everywhere
 *  (editor / proof / print composite). level 10 ≈ 2.2% of width. */
function borderPx(level: number | undefined, renderedWidthPx: number): number {
  if (!level || level <= 0) return 0
  return Math.max(1, (level / 10) * 0.022 * renderedWidthPx)
}
const adjustKey = (spreadId: string, slotIdx: number) => `${spreadId}::${slotIdx}`

// ============== SPREAD BACKGROUNDS ==============
// Per-spread background. Stored in its OWN state map keyed by spread id
// (NOT on the Spread object) so it never touches the undo/op system —
// same pattern as `adjusts`. Persisted to localStorage alongside it.

type SpreadBg = {
  mode: 'paper' | 'color' | 'photo'
  /** hex, when mode==='color' */
  color?: string
  /** photo id, when mode==='photo' (Phase 2) */
  photoId?: string
  /** 0..40 px gaussian blur for the bg photo (Phase 2) */
  blur?: number
  /** 0..0.7 black overlay opacity over the bg photo (Phase 2) */
  dim?: number
  /** bg-photo zoom 1..2 — HARD-CAPPED at 2.0 (200%) per owner */
  zoom?: number
  panX?: number
  panY?: number
}

const DEFAULT_SPREAD_BG: SpreadBg = { mode: 'paper' }

/** Max zoom for a background photo — 200%, owner spec. */
const BG_PHOTO_MAX_ZOOM = 2

// ============== SMART ZOOM CAP (print-resolution aware) ==============
// Minimum acceptable print resolution. Owner spec: 200 DPI.
const MIN_PRINT_DPI = 200
// Global hard ceiling on zoom regardless of resolution (owner: 200%).
const GLOBAL_MAX_ZOOM = 2

/** Open-spread physical inches for an album size. Key is `${h}x${w}`
 *  (e.g. '17x24' = 17″ tall × 24″ wide open). */
function spreadInches(size: AlbumSize): { wIn: number; hIn: number } {
  const [h, w] = size.split('x').map(Number)
  return { wIn: w || 24, hIn: h || 17 }
}

/**
 * Sharpness of a photo cover-fitted into a slot at zoom 1, in DPI.
 *   coverDPI = min(photoW / slotWidthInches, photoH / slotHeightInches)
 * Effective DPI at any zoom = coverDPI / zoom.
 */
function coverDpi(
  photo: { width: number; height: number },
  slot: { w: number; h: number },
  size: AlbumSize,
): number {
  if (!photo.width || !photo.height) return 0
  const { wIn, hIn } = spreadInches(size)
  const slotWin = (slot.w / 100) * wIn
  const slotHin = (slot.h / 100) * hIn
  if (slotWin <= 0 || slotHin <= 0) return 0
  return Math.min(photo.width / slotWin, photo.height / slotHin)
}

/**
 * The maximum zoom this photo can take in this slot+album before it
 * drops below MIN_PRINT_DPI. Clamped to [1, GLOBAL_MAX_ZOOM]. If the
 * photo can't even hit 200 DPI at zoom 1, returns 1 (and effDpi at 1
 * will read red so the UI warns).
 */
function smartMaxZoom(
  photo: { width: number; height: number },
  slot: { w: number; h: number },
  size: AlbumSize,
): number {
  const cd = coverDpi(photo, slot, size)
  if (cd <= 0) return GLOBAL_MAX_ZOOM
  const raw = cd / MIN_PRINT_DPI
  return Math.max(1, Math.min(GLOBAL_MAX_ZOOM, +raw.toFixed(2)))
}

const PAPER_HEX = '#ffffff'

const BG_PALETTE: { id: string; label: string; hex: string }[] = [
  { id: 'cream', label: 'Cream', hex: '#f5f0e8' },
  { id: 'ivory', label: 'Ivory', hex: '#efe7d6' },
  { id: 'warmgrey', label: 'Warm grey', hex: '#b9b2a4' },
  { id: 'charcoal', label: 'Charcoal', hex: '#3a342c' },
  { id: 'black', label: 'Black', hex: '#0e0c09' },
  { id: 'blush', label: 'Blush', hex: '#e8d6d2' },
]

/** Resolve the solid fill colour for a spread's background (paper/color).
 *  For mode==='photo' callers handle the image separately. */
function bgFillColor(bg: SpreadBg | undefined): string {
  if (!bg || bg.mode === 'paper') return PAPER_HEX
  if (bg.mode === 'color') return bg.color || BG_PALETTE[0].hex
  return PAPER_HEX
}

// ============== ALBUM SPECS ==============

const ALBUM_SPECS: Record<
  AlbumSize,
  Record<AlbumType, { base: number; perExtraSpread: number; minSpreads: number; maxSpreads: number }> & {
    spreadAspectRatio: number
    label: string
    desc: string
  }
> = {
  '17x24': {
    spreadAspectRatio: 24 / 17,
    label: '17×24',
    desc: 'Coffee-table size · the classic format',
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: 25 },
  },
  '12x24': {
    // Same pricing as 17×24 per owner. 12 tall × 24 wide open → 24/12 = 2.0
    spreadAspectRatio: 24 / 12,
    label: '12×24',
    desc: 'Panoramic · slim landscape format',
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: 25 },
  },
  '20x30': {
    spreadAspectRatio: 30 / 20,
    label: '20×30',
    desc: 'Oversized poster · premium hero format',
    standard: { base: 340, perExtraSpread: 12, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 375, perExtraSpread: 15, minSpreads: 10, maxSpreads: 25 },
  },
  '15x30': {
    // Owner: $300 base, +$15 per sheet (standard). Layflat assumed at the
    // same +$35 base / +$3 per-spread delta as the other sizes — CONFIRM.
    spreadAspectRatio: 30 / 15,
    label: '15×30',
    desc: 'Grand panoramic · wide statement format',
    standard: { base: 300, perExtraSpread: 15, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 335, perExtraSpread: 18, minSpreads: 10, maxSpreads: 25 },
  },
}

function computePrice(size: AlbumSize, type: AlbumType, spreads: number): number {
  const spec = ALBUM_SPECS[size][type]
  const extra = Math.max(0, spreads - spec.minSpreads)
  return spec.base + extra * spec.perExtraSpread
}

// ============== LAYOUT TEMPLATES ==============
// Half-mm-thin gaps: 0.5% edge, 1% gutter (0.5% each side of x=50),
// 0.5% inter-photo. All slot %ages within the spread.
// HALF_W = 49 (left half: 0.5 to 49.5, right half: 50.5 to 99.5).

const TEMPLATES: LayoutTemplate[] = [
  // --- 2 PHOTOS ---
  {
    id: 'hero-1r',
    name: 'Hero · Solo right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 49, h: 99 },
    ],
  },
  {
    id: 'hero-1l',
    name: 'Hero · Solo left',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99 },
      { x: 50.5, y: 0.5, w: 49, h: 99, isHero: true },
    ],
  },
  {
    id: 'pair',
    name: '2 photos',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99 },
      { x: 50.5, y: 0.5, w: 49, h: 99 },
    ],
  },

  // --- 3 PHOTOS ---
  {
    id: 'hero-2r',
    name: 'Hero · Pair right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 49, h: 49 },
      { x: 50.5, y: 50, w: 49, h: 49.5 },
    ],
  },
  {
    id: 'hero-2l',
    name: 'Hero · Pair left',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 49 },
      { x: 0.5, y: 50, w: 49, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 99, isHero: true },
    ],
  },
  {
    id: 'pair-solo',
    name: '3 · 2+1',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 49 },
      { x: 0.5, y: 50, w: 49, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 99 },
    ],
  },

  // --- 4 PHOTOS ---
  {
    id: 'hero-3r',
    name: 'Hero · Trio right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 49, h: 32.5 },
      { x: 50.5, y: 33.5, w: 49, h: 32.5 },
      { x: 50.5, y: 66.5, w: 49, h: 33 },
    ],
  },
  {
    id: 'hero-3l',
    name: 'Hero · Trio left',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 32.5 },
      { x: 0.5, y: 33.5, w: 49, h: 32.5 },
      { x: 0.5, y: 66.5, w: 49, h: 33 },
      { x: 50.5, y: 0.5, w: 49, h: 99, isHero: true },
    ],
  },
  {
    id: 'pair-pair',
    name: '4 · 2+2 grid',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 49 },
      { x: 0.5, y: 50, w: 49, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 49 },
      { x: 50.5, y: 50, w: 49, h: 49.5 },
    ],
  },

  // --- 5 PHOTOS ---
  {
    id: 'hero-4r',
    name: 'Hero · Quad right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 24.25, h: 49 },
      { x: 75.25, y: 0.5, w: 24.25, h: 49 },
      { x: 50.5, y: 50, w: 24.25, h: 49.5 },
      { x: 75.25, y: 50, w: 24.25, h: 49.5 },
    ],
  },
  {
    id: 'hero-4l',
    name: 'Hero · Quad left',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24.25, h: 49 },
      { x: 25.25, y: 0.5, w: 24.25, h: 49 },
      { x: 0.5, y: 50, w: 24.25, h: 49.5 },
      { x: 25.25, y: 50, w: 24.25, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 99, isHero: true },
    ],
  },
  {
    id: 'trio-pair',
    name: '5 · 3+2',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 32.5 },
      { x: 0.5, y: 33.5, w: 49, h: 32.5 },
      { x: 0.5, y: 66.5, w: 49, h: 33 },
      { x: 50.5, y: 0.5, w: 49, h: 49 },
      { x: 50.5, y: 50, w: 49, h: 49.5 },
    ],
  },
  {
    id: 'pair-trio',
    name: '5 · 2+3',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 49 },
      { x: 0.5, y: 50, w: 49, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 32.5 },
      { x: 50.5, y: 33.5, w: 49, h: 32.5 },
      { x: 50.5, y: 66.5, w: 49, h: 33 },
    ],
  },

  // --- 6 PHOTOS ---
  {
    id: 'trio-trio',
    name: '6 · 3+3 rows',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 32.5 },
      { x: 0.5, y: 33.5, w: 49, h: 32.5 },
      { x: 0.5, y: 66.5, w: 49, h: 33 },
      { x: 50.5, y: 0.5, w: 49, h: 32.5 },
      { x: 50.5, y: 33.5, w: 49, h: 32.5 },
      { x: 50.5, y: 66.5, w: 49, h: 33 },
    ],
  },
  {
    id: 'pair-quad',
    name: '6 · 2+4',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 49 },
      { x: 0.5, y: 50, w: 49, h: 49.5 },
      { x: 50.5, y: 0.5, w: 24.25, h: 49 },
      { x: 75.25, y: 0.5, w: 24.25, h: 49 },
      { x: 50.5, y: 50, w: 24.25, h: 49.5 },
      { x: 75.25, y: 50, w: 24.25, h: 49.5 },
    ],
  },
  {
    id: 'quad-pair',
    name: '6 · 4+2',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24.25, h: 49 },
      { x: 25.25, y: 0.5, w: 24.25, h: 49 },
      { x: 0.5, y: 50, w: 24.25, h: 49.5 },
      { x: 25.25, y: 50, w: 24.25, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 49 },
      { x: 50.5, y: 50, w: 49, h: 49.5 },
    ],
  },

  // --- 7 PHOTOS ---
  {
    id: 'quad-trio',
    name: '7 · 4+3',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24.25, h: 49 },
      { x: 25.25, y: 0.5, w: 24.25, h: 49 },
      { x: 0.5, y: 50, w: 24.25, h: 49.5 },
      { x: 25.25, y: 50, w: 24.25, h: 49.5 },
      { x: 50.5, y: 0.5, w: 49, h: 32.5 },
      { x: 50.5, y: 33.5, w: 49, h: 32.5 },
      { x: 50.5, y: 66.5, w: 49, h: 33 },
    ],
  },
  {
    id: 'trio-quad',
    name: '7 · 3+4',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 32.5 },
      { x: 0.5, y: 33.5, w: 49, h: 32.5 },
      { x: 0.5, y: 66.5, w: 49, h: 33 },
      { x: 50.5, y: 0.5, w: 24.25, h: 49 },
      { x: 75.25, y: 0.5, w: 24.25, h: 49 },
      { x: 50.5, y: 50, w: 24.25, h: 49.5 },
      { x: 75.25, y: 50, w: 24.25, h: 49.5 },
    ],
  },

  // --- 8 PHOTOS ---
  {
    id: 'quad-quad',
    name: '8 · 4+4 grid',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24.25, h: 49 },
      { x: 25.25, y: 0.5, w: 24.25, h: 49 },
      { x: 0.5, y: 50, w: 24.25, h: 49.5 },
      { x: 25.25, y: 50, w: 24.25, h: 49.5 },
      { x: 50.5, y: 0.5, w: 24.25, h: 49 },
      { x: 75.25, y: 0.5, w: 24.25, h: 49 },
      { x: 50.5, y: 50, w: 24.25, h: 49.5 },
      { x: 75.25, y: 50, w: 24.25, h: 49.5 },
    ],
  },

  // --- PORTRAIT-COLUMN VARIANTS (Part A) ---
  // The original library was almost entirely landscape/grid. These
  // column layouts give the orientation scorer real choices when a
  // spread's photos are vertical (the common wedding-portrait case).

  // 3 PHOTOS — all-portrait: 1 tall + 2 tall columns
  {
    id: 'tri-cols-r',
    name: '3 · tall columns (R)',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 24, h: 99 },
      { x: 75, y: 0.5, w: 24.5, h: 99 },
    ],
  },
  {
    id: 'tri-cols-l',
    name: '3 · tall columns (L)',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24, h: 99 },
      { x: 25, y: 0.5, w: 24.5, h: 99 },
      { x: 50.5, y: 0.5, w: 49, h: 99, isHero: true },
    ],
  },
  // 4 PHOTOS — all-portrait: 4 tall columns (2 per page)
  {
    id: 'quad-cols',
    name: '4 · tall columns',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24, h: 99 },
      { x: 25, y: 0.5, w: 24.5, h: 99 },
      { x: 50.5, y: 0.5, w: 24, h: 99 },
      { x: 75, y: 0.5, w: 24.5, h: 99 },
    ],
  },
  // 4 PHOTOS — portrait hero + 3 stacked accents on the right
  {
    id: 'hero-stack-r4',
    name: '4 · hero + stacked (R)',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 49, h: 32.5 },
      { x: 50.5, y: 33.5, w: 49, h: 32.5 },
      { x: 50.5, y: 66.5, w: 49, h: 33 },
    ],
  },
  // 5 PHOTOS — all-portrait: 2 columns left + 3 columns right
  {
    id: 'five-cols',
    name: '5 · tall columns',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24, h: 99 },
      { x: 25, y: 0.5, w: 24.5, h: 99 },
      { x: 50.5, y: 0.5, w: 16, h: 99 },
      { x: 66.83, y: 0.5, w: 16, h: 99 },
      { x: 83.17, y: 0.5, w: 16.33, h: 99 },
    ],
  },
  // 5 PHOTOS — landscape: 1 tall portrait + 4 stacked landscape bands
  {
    id: 'solo-quadband-r',
    name: '5 · solo + 4 bands',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 99, isHero: true },
      { x: 50.5, y: 0.5, w: 49, h: 24.25 },
      { x: 50.5, y: 25.25, w: 49, h: 24.25 },
      { x: 50.5, y: 50, w: 49, h: 24.25 },
      { x: 50.5, y: 75, w: 49, h: 24.5 },
    ],
  },
  // 2 PHOTOS — landscape stack on each page (good for wide photos)
  {
    id: 'duo-band',
    name: '2 · stacked bands',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 25, w: 49, h: 50 },
      { x: 50.5, y: 25, w: 49, h: 50 },
    ],
  },

  // --- MATTED / NEGATIVE-SPACE FAMILY (Phase 1a) ---
  // Slots are inset from the edges so the photo "floats" in a wide
  // mat (paper / colour / blurred-photo background fills the margin).
  // Naming: mat-<count>-<S|M|L> where S/M/L ≈ 8% / 18% / 30% margin.

  // 1 photo, centred — three mat widths
  {
    id: 'mat-1-s',
    name: 'Mat · single S',
    compat: ['standard', 'layflat'],
    slots: [{ x: 8, y: 8, w: 84, h: 84, isHero: true }],
  },
  {
    id: 'mat-1-m',
    name: 'Mat · single M',
    compat: ['standard', 'layflat'],
    slots: [{ x: 18, y: 18, w: 64, h: 64, isHero: true }],
  },
  {
    id: 'mat-1-l',
    name: 'Mat · single L',
    compat: ['standard', 'layflat'],
    slots: [{ x: 30, y: 26, w: 40, h: 48, isHero: true }],
  },
  // 1 photo, one page only — big empty facing page
  {
    id: 'mat-1-left',
    name: 'Mat · solo left, open right',
    compat: ['standard', 'layflat'],
    slots: [{ x: 6, y: 14, w: 38, h: 72, isHero: true }],
  },
  {
    id: 'mat-1-right',
    name: 'Mat · solo right, open left',
    compat: ['standard', 'layflat'],
    slots: [{ x: 56, y: 14, w: 38, h: 72, isHero: true }],
  },
  // 2 photos, matted pair (one per page, generous margins + centre gap)
  {
    id: 'mat-2',
    name: 'Mat · matted pair',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 9, y: 18, w: 33, h: 64 },
      { x: 58, y: 18, w: 33, h: 64 },
    ],
  },
  // 2 photos, offset — one large matted, one small accent + air
  {
    id: 'mat-2-offset',
    name: 'Mat · offset duo',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 8, y: 12, w: 46, h: 76, isHero: true },
      { x: 62, y: 30, w: 26, h: 40 },
    ],
  },
  // 3 photos, matted row with breathing room
  {
    id: 'mat-3',
    name: 'Mat · matted trio',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 7, y: 30, w: 26, h: 40 },
      { x: 37, y: 30, w: 26, h: 40 },
      { x: 67, y: 30, w: 26, h: 40 },
    ],
  },

  // ===== EXPANDED LIBRARY — lots more options per count =====
  // Bleed = edge-to-edge classics; mat-* = float in negative space.

  // ---- 1 PHOTO · bleed ----
  {
    id: 'one-full',
    name: '1 · full bleed',
    compat: ['standard', 'layflat'],
    slots: [{ x: 0, y: 0, w: 100, h: 100, isHero: true }],
  },

  // ---- 1 PHOTO · more mat options ----
  {
    id: 'mat-1-tall',
    name: 'Mat · tall centre',
    compat: ['standard', 'layflat'],
    slots: [{ x: 33, y: 6, w: 34, h: 88, isHero: true }],
  },
  {
    id: 'mat-1-wide',
    name: 'Mat · wide centre',
    compat: ['standard', 'layflat'],
    slots: [{ x: 12, y: 30, w: 76, h: 40, isHero: true }],
  },
  {
    id: 'mat-1-top',
    name: 'Mat · top-weighted',
    compat: ['standard', 'layflat'],
    slots: [{ x: 16, y: 8, w: 68, h: 58, isHero: true }],
  },

  // ---- 2 PHOTOS · bleed (target: lots of options) ----
  {
    id: 'b2-6040',
    name: '2 · 60 / 40',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 59, h: 99, isHero: true },
      { x: 60, y: 0.5, w: 39.5, h: 99 },
    ],
  },
  {
    id: 'b2-4060',
    name: '2 · 40 / 60',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 39, h: 99 },
      { x: 40, y: 0.5, w: 59.5, h: 99, isHero: true },
    ],
  },
  {
    id: 'b2-stack',
    name: '2 · stacked full',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 99, h: 49 },
      { x: 0.5, y: 50, w: 99, h: 49.5 },
    ],
  },
  {
    id: 'b2-stack-7030',
    name: '2 · stacked 70 / 30',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 99, h: 68, isHero: true },
      { x: 0.5, y: 69, w: 99, h: 30.5 },
    ],
  },
  {
    id: 'b2-stack-3070',
    name: '2 · stacked 30 / 70',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 99, h: 30 },
      { x: 0.5, y: 31, w: 99, h: 68.5, isHero: true },
    ],
  },
  {
    id: 'b2-left-stack',
    name: '2 · L tall + R tall (gap)',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 2, w: 47, h: 96 },
      { x: 51, y: 2, w: 47, h: 96 },
    ],
  },
  {
    id: 'b2-center-pair',
    name: '2 · centre band pair',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 12, w: 49, h: 76 },
      { x: 50.5, y: 12, w: 49, h: 76 },
    ],
  },

  // ---- 2 PHOTOS · mat ----
  {
    id: 'mat-2-stack',
    name: 'Mat · stacked duo',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 22, y: 8, w: 56, h: 40 },
      { x: 22, y: 52, w: 56, h: 40 },
    ],
  },
  {
    id: 'mat-2-big-small',
    name: 'Mat · big + accent',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 8, y: 14, w: 52, h: 72, isHero: true },
      { x: 64, y: 34, w: 22, h: 32 },
    ],
  },
  {
    id: 'mat-2-tall',
    name: 'Mat · twin tall',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 16, y: 12, w: 28, h: 76 },
      { x: 56, y: 12, w: 28, h: 76 },
    ],
  },

  // ---- 3 PHOTOS · bleed ----
  {
    id: 'b3-row',
    name: '3 · equal columns',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 32.5, h: 99 },
      { x: 33.5, y: 0.5, w: 32.5, h: 99 },
      { x: 66.5, y: 0.5, w: 33, h: 99 },
    ],
  },
  {
    id: 'b3-stack',
    name: '3 · stacked bands',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 99, h: 32.5 },
      { x: 0.5, y: 33.5, w: 99, h: 32.5 },
      { x: 0.5, y: 66.5, w: 99, h: 33 },
    ],
  },
  {
    id: 'b3-big-top',
    name: '3 · big top + 2 below',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 99, h: 60, isHero: true },
      { x: 0.5, y: 61, w: 49, h: 38.5 },
      { x: 50.5, y: 61, w: 49, h: 38.5 },
    ],
  },
  {
    id: 'b3-2top-big',
    name: '3 · 2 top + big bottom',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 49, h: 38 },
      { x: 50.5, y: 0.5, w: 49, h: 38 },
      { x: 0.5, y: 39, w: 99, h: 60.5, isHero: true },
    ],
  },

  // ---- 3 PHOTOS · mat ----
  {
    id: 'mat-3-stack',
    name: 'Mat · stacked trio',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 30, y: 6, w: 40, h: 26 },
      { x: 30, y: 37, w: 40, h: 26 },
      { x: 30, y: 68, w: 40, h: 26 },
    ],
  },
  {
    id: 'mat-3-hero',
    name: 'Mat · hero + 2 accents',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 8, y: 14, w: 50, h: 72, isHero: true },
      { x: 64, y: 18, w: 24, h: 30 },
      { x: 64, y: 54, w: 24, h: 30 },
    ],
  },

  // ---- 4 PHOTOS · bleed ----
  {
    id: 'b4-strip',
    name: '4 · equal columns',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 24.25, h: 99 },
      { x: 25.25, y: 0.5, w: 24.25, h: 99 },
      { x: 50.5, y: 0.5, w: 24.25, h: 99 },
      { x: 75.25, y: 0.5, w: 24.25, h: 99 },
    ],
  },
  {
    id: 'b4-bands',
    name: '4 · stacked bands',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 99, h: 24.25 },
      { x: 0.5, y: 25.25, w: 99, h: 24.25 },
      { x: 0.5, y: 50, w: 99, h: 24.25 },
      { x: 0.5, y: 75, w: 99, h: 24.5 },
    ],
  },
  {
    id: 'b4-big-3',
    name: '4 · big left + 3 right bands',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 64, h: 99, isHero: true },
      { x: 65, y: 0.5, w: 34.5, h: 32.5 },
      { x: 65, y: 33.5, w: 34.5, h: 32.5 },
      { x: 65, y: 66.5, w: 34.5, h: 33 },
    ],
  },

  // ---- 4 PHOTOS · mat ----
  {
    id: 'mat-4-grid',
    name: 'Mat · 2×2 grid',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 16, y: 14, w: 32, h: 34 },
      { x: 52, y: 14, w: 32, h: 34 },
      { x: 16, y: 52, w: 32, h: 34 },
      { x: 52, y: 52, w: 32, h: 34 },
    ],
  },
  {
    id: 'mat-4-row',
    name: 'Mat · row of 4',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 6, y: 34, w: 20, h: 32 },
      { x: 29, y: 34, w: 20, h: 32 },
      { x: 52, y: 34, w: 20, h: 32 },
      { x: 75, y: 34, w: 20, h: 32 },
    ],
  },

  // ---- 5 PHOTOS · bleed ----
  {
    id: 'b5-strip',
    name: '5 · equal columns',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 19.3, h: 99 },
      { x: 20.3, y: 0.5, w: 19.3, h: 99 },
      { x: 40.1, y: 0.5, w: 19.3, h: 99 },
      { x: 59.9, y: 0.5, w: 19.3, h: 99 },
      { x: 79.7, y: 0.5, w: 19.8, h: 99 },
    ],
  },
  {
    id: 'b5-big-4',
    name: '5 · big + 4 grid',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 0.5, y: 0.5, w: 64, h: 99, isHero: true },
      { x: 65, y: 0.5, w: 17, h: 49 },
      { x: 82.5, y: 0.5, w: 17, h: 49 },
      { x: 65, y: 50, w: 17, h: 49.5 },
      { x: 82.5, y: 50, w: 17, h: 49.5 },
    ],
  },

  // ---- 5 PHOTOS · mat ----
  {
    id: 'mat-5-row',
    name: 'Mat · row of 5',
    compat: ['standard', 'layflat'],
    // 5 identical slots, evenly spaced: margin 5, gap 2.5, w 16 → ends at 95.
    slots: [
      { x: 5, y: 36, w: 16, h: 28 },
      { x: 23.5, y: 36, w: 16, h: 28 },
      { x: 42, y: 36, w: 16, h: 28 },
      { x: 60.5, y: 36, w: 16, h: 28 },
      { x: 79, y: 36, w: 16, h: 28 },
    ],
  },

  // ===== MATTED — BIGGER, VARIED COMPOSITIONS =====
  // Generous photo blocks with clean breathing room (not thin strips).

  // 1 photo
  {
    id: 'mat-1-xl',
    name: 'Mat · XL framed',
    compat: ['standard', 'layflat'],
    slots: [{ x: 6, y: 7, w: 88, h: 86, isHero: true }],
  },
  {
    id: 'mat-1-portrait-xl',
    name: 'Mat · tall XL',
    compat: ['standard', 'layflat'],
    slots: [{ x: 27, y: 5, w: 46, h: 90, isHero: true }],
  },
  {
    id: 'mat-1-band-xl',
    name: 'Mat · wide band XL',
    compat: ['standard', 'layflat'],
    slots: [{ x: 7, y: 24, w: 86, h: 52, isHero: true }],
  },

  // 2 photos — big blocks
  {
    id: 'mat-2-big',
    name: 'Mat · big pair',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 6, y: 10, w: 41, h: 80 },
      { x: 53, y: 10, w: 41, h: 80 },
    ],
  },
  {
    id: 'mat-2-big-stack',
    name: 'Mat · big stack',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 14, y: 7, w: 72, h: 40 },
      { x: 14, y: 53, w: 72, h: 40 },
    ],
  },
  {
    id: 'mat-2-Lbig-Racc',
    name: 'Mat · big left + accent',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 5, y: 8, w: 44, h: 84, isHero: true },
      { x: 55, y: 26, w: 38, h: 48 },
    ],
  },

  // 3 photos — feature + supporting
  {
    id: 'mat-3-Lbig-Rstack',
    name: 'Mat · feature + 2',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 5, y: 8, w: 46, h: 84, isHero: true },
      { x: 56, y: 8, w: 38, h: 40 },
      { x: 56, y: 52, w: 38, h: 40 },
    ],
  },
  {
    id: 'mat-3-big-row',
    name: 'Mat · big trio',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 5, y: 20, w: 28, h: 60 },
      { x: 36, y: 20, w: 28, h: 60 },
      { x: 67, y: 20, w: 28, h: 60 },
    ],
  },
  {
    id: 'mat-3-top-2big',
    name: 'Mat · banner + pair',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 8, y: 8, w: 84, h: 34 },
      { x: 8, y: 48, w: 40, h: 44 },
      { x: 52, y: 48, w: 40, h: 44 },
    ],
  },

  // 4 photos — big grid / feature
  {
    id: 'mat-4-big-grid',
    name: 'Mat · big 2×2',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 8, y: 9, w: 39, h: 39 },
      { x: 53, y: 9, w: 39, h: 39 },
      { x: 8, y: 53, w: 39, h: 39 },
      { x: 53, y: 53, w: 39, h: 39 },
    ],
  },
  {
    id: 'mat-4-Lbig-R3',
    name: 'Mat · feature + 3',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 5, y: 8, w: 46, h: 84, isHero: true },
      { x: 56, y: 8, w: 38, h: 25 },
      { x: 56, y: 37, w: 38, h: 25 },
      { x: 56, y: 67, w: 38, h: 25 },
    ],
  },

  // 5 photos — generous (replaces the tiny-row feel)
  {
    id: 'mat-5-feature',
    name: 'Mat · feature + 4',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 5, y: 9, w: 45, h: 82, isHero: true },
      { x: 54, y: 9, w: 20, h: 39 },
      { x: 76, y: 9, w: 19, h: 39 },
      { x: 54, y: 52, w: 20, h: 39 },
      { x: 76, y: 52, w: 19, h: 39 },
    ],
  },
  {
    id: 'mat-5-2top-3',
    name: 'Mat · 2 + 3 big',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 13, y: 9, w: 35, h: 37 },
      { x: 52, y: 9, w: 35, h: 37 },
      { x: 7, y: 53, w: 27, h: 38 },
      { x: 37, y: 53, w: 27, h: 38 },
      { x: 67, y: 53, w: 27, h: 38 },
    ],
  },

  // --- LAYFLAT-ONLY ---
  {
    id: 'panorama',
    name: 'Panorama · full bleed',
    compat: ['layflat'],
    slots: [{ x: 0, y: 0, w: 100, h: 100, isHero: true }],
  },
  {
    id: 'hero-wide-1',
    name: 'Hero spans gutter · 1 accent',
    compat: ['layflat'],
    slots: [
      { x: 0, y: 0, w: 70, h: 100, isHero: true },
      { x: 70.5, y: 0.5, w: 29, h: 99 },
    ],
  },
  {
    id: 'hero-wide-3',
    name: 'Hero spans gutter · 3 accent',
    compat: ['layflat'],
    slots: [
      { x: 0, y: 0, w: 70, h: 100, isHero: true },
      { x: 70.5, y: 0.5, w: 29, h: 32.5 },
      { x: 70.5, y: 33.5, w: 29, h: 32.5 },
      { x: 70.5, y: 66.5, w: 29, h: 33 },
    ],
  },
]

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t] as const))

function templatesForCount(count: number, type: AlbumType): LayoutTemplate[] {
  return TEMPLATES.filter((t) => t.compat.includes(type) && t.slots.length === count)
}

/** Two layout families: 'mat' = floats photos in negative space (a
 *  colour / blurred-photo background shows around them); 'bleed' =
 *  edge-to-edge classic layouts. Matted templates are all id 'mat-*'. */
type LayoutFamily = 'bleed' | 'mat'
function templateFamily(t: { id: string }): LayoutFamily {
  return t.id.startsWith('mat-') ? 'mat' : 'bleed'
}

// After removing a photo from a spread, pick a smaller template that
// matches the new photo count (preferring same hero/non-hero kind).
// Falls back to the closest fit if no exact match exists.
function pickFitTemplate(
  currentTplId: string,
  newCount: number,
  type: AlbumType,
): string {
  if (newCount <= 0) return currentTplId
  const current = TEMPLATE_BY_ID.get(currentTplId)
  const wantHero = current?.slots.some((s) => s.isHero) ?? false
  // Try exact-count match in same kind
  const same = TEMPLATES.find(
    (t) =>
      t.compat.includes(type) &&
      t.slots.length === newCount &&
      t.slots.some((s) => s.isHero) === wantHero,
  )
  if (same) return same.id
  // Fall back to opposite kind, exact count
  const opp = TEMPLATES.find((t) => t.compat.includes(type) && t.slots.length === newCount)
  if (opp) return opp.id
  // Last resort: keep current template id
  return currentTplId
}

/* ─── Orientation-aware scoring (Part B) ────────────────────────────────
 *
 * The original engine picked candidates[0] — purely by photo count. That
 * dumped tall portrait photos into wide landscape slots and vice-versa.
 *
 * Now: classify every photo and every slot as portrait / landscape /
 * square, then score how well a template's slot shapes match the actual
 * photos going into it. A slot's TRUE shape depends on the spread's wide
 * aspect ratio (24/17 or 30/20), so a "half page" slot is actually
 * portrait-ish, and a half-height band is landscape.
 */

type AspectClass = 'portrait' | 'landscape' | 'square'

function classifyAspect(ratio: number): AspectClass {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'square'
  if (ratio < 0.85) return 'portrait'
  if (ratio > 1.18) return 'landscape'
  return 'square'
}

function photoAspectClass(p: { width: number; height: number }): AspectClass {
  if (!p.width || !p.height) return 'square'
  return classifyAspect(p.width / p.height)
}

function slotAspectClass(
  slot: { w: number; h: number },
  spreadAspectRatio: number,
): AspectClass {
  if (!slot.w || !slot.h) return 'square'
  // pixel aspect = (slot.w / slot.h) × (spreadW / spreadH)
  return classifyAspect((slot.w / slot.h) * spreadAspectRatio)
}

/**
 * 0..1 — how well this template's slots fit these photos by orientation.
 * Exact class matches are worth most; square acts as a flexible wildcard.
 */
function scoreTemplateForPhotos(
  tpl: LayoutTemplate,
  photos: { width: number; height: number }[],
  spreadAspectRatio: number,
): number {
  if (tpl.slots.length === 0) return 0
  const slotCounts = { portrait: 0, landscape: 0, square: 0 }
  for (const s of tpl.slots) slotCounts[slotAspectClass(s, spreadAspectRatio)]++
  const photoCounts = { portrait: 0, landscape: 0, square: 0 }
  for (const p of photos) photoCounts[photoAspectClass(p)]++

  const pMatch = Math.min(slotCounts.portrait, photoCounts.portrait)
  const lMatch = Math.min(slotCounts.landscape, photoCounts.landscape)
  let score = (pMatch + lMatch) * 2

  // Whatever's left over — square slots take any photo, square photos
  // fit any slot — counts as a soft (half-value) match.
  const slotsLeft =
    slotCounts.portrait - pMatch + (slotCounts.landscape - lMatch) + slotCounts.square
  const photosLeft =
    photoCounts.portrait - pMatch + (photoCounts.landscape - lMatch) + photoCounts.square
  score += Math.min(slotsLeft, photosLeft) * 1

  return score / (tpl.slots.length * 2)
}

function pickTemplate(
  type: AlbumType,
  count: number,
  needsHero: boolean,
  preferredId?: string,
  photos?: { width: number; height: number }[],
  spreadAspectRatio?: number,
): LayoutTemplate | null {
  const candidates = TEMPLATES.filter(
    (t) =>
      t.compat.includes(type) &&
      t.slots.length === count &&
      (needsHero ? t.slots.some((s) => s.isHero) : !t.slots.some((s) => s.isHero)),
  )
  if (candidates.length === 0) return null

  // No photo info → preserve the old behaviour (preferred id, else first).
  if (!photos || photos.length === 0 || spreadAspectRatio === undefined) {
    if (preferredId) {
      const pref = candidates.find((t) => t.id === preferredId)
      if (pref) return pref
    }
    return candidates[0]
  }

  // Orientation-aware: pick the best-scoring candidate. The paced
  // preferred id (hero side rotation) only wins ties — pacing rhythm is
  // decided OUTSIDE this function via isHeroSpot, so it's preserved.
  let best = candidates[0]
  let bestScore = -1
  for (const c of candidates) {
    let s = scoreTemplateForPhotos(c, photos, spreadAspectRatio)
    if (c.id === preferredId) s += 0.04
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  return best
}

// ============== LAYOUT ENGINE ==============
// Pacing rule: every 3rd spread is a hero spread (positions 2, 5, 8, ...
// 0-indexed within an event). Non-hero spreads default to PAIR (2 photos).
// Density only steps up when math requires it to fit all photos.
// Strict event grouping: each spread contains photos from ONE event.

function generateLayout(
  photos: Photo[],
  pageCount: number,
  type: AlbumType,
  spreadAspectRatio: number,
): Spread[] {
  const useable = photos.filter((p) => !p.blurry)
  if (useable.length === 0) return []

  const eventOrder: EventId[] = [
    'mehndi',
    'haldi',
    'prep',
    'nikkah',
    'wedding',
    'reception',
    'valima',
    'other1',
    'other2',
    // 'unassigned' is appended last so any photos the user didn't tag
    // in the Group step still get placed in the album. Without this,
    // untagged photos vanish during generation and the album ends up
    // empty (0 spreads). Per-spread label falls back gracefully when
    // the EventId isn't in the EVENTS list.
    'unassigned',
  ]
  const buckets = eventOrder
    .map((eid) => ({
      eid,
      photos: useable.filter((p) => p.eventId === eid),
    }))
    .filter((b) => b.photos.length > 0)

  if (buckets.length === 0) return []

  // Allocate spread budgets per event proportional to photo count
  const totalPhotos = useable.length

  const rawBudgets = buckets.map((b) => ({
    eid: b.eid,
    bucket: b,
    spreads: Math.max(1, Math.round((b.photos.length / totalPhotos) * pageCount)),
  }))
  let total = rawBudgets.reduce((s, x) => s + x.spreads, 0)
  while (total > pageCount) {
    const biggest = rawBudgets.reduce((a, b) => (a.spreads > b.spreads ? a : b))
    biggest.spreads--
    total--
  }
  while (total < pageCount) {
    const biggest = rawBudgets.reduce((a, b) => (a.spreads > b.spreads ? a : b))
    biggest.spreads++
    total++
  }

  const spreads: Spread[] = []
  let idx = 0

  for (const { eid, bucket, spreads: spreadBudget } of rawBudgets) {
    const heroes = bucket.photos.filter((p) => p.tagged === 'hero')
    const favorites = bucket.photos.filter((p) => p.tagged === 'favorite')
    const others = bucket.photos.filter((p) => p.tagged === 'none')
    const totalEventPhotos = bucket.photos.length

    // ---- PASS 1: PLAN ----
    // Decide which spread positions are heroes vs non-hero, and the
    // photo count per spread.
    const isHeroSpot: boolean[] = new Array(spreadBudget).fill(false)
    let heroAssigned = 0
    // First pass: every 3rd position (i % 3 === 2)
    for (let i = 0; i < spreadBudget; i++) {
      if (heroAssigned >= heroes.length) break
      if (i % 3 === 2) {
        isHeroSpot[i] = true
        heroAssigned++
      }
    }
    // If extra heroes still remain, append on first available pair slots
    // from the front (so heroes get featured even if we have many).
    for (let i = 0; i < spreadBudget && heroAssigned < heroes.length; i++) {
      if (!isHeroSpot[i]) {
        isHeroSpot[i] = true
        heroAssigned++
      }
    }

    const heroSpreadCount = isHeroSpot.filter(Boolean).length
    const pairSpreadCount = spreadBudget - heroSpreadCount

    // Photo budget: heroes themselves are placed (heroSpreadCount of them),
    // plus the non-hero photos to be distributed.
    const nonHeroPhotos = favorites.length + others.length

    // Per-spread sizes: hero spread defaults to 2 photos (hero+1, matches
    // pair density). Pair spread defaults to 2.
    const sizes: number[] = isHeroSpot.map((isH) => (isH ? 2 : 2))

    // Adjust sizes to fit ALL non-hero photos.
    // Non-hero photos to place = nonHeroPhotos
    // Slots dedicated to non-hero = (heroSpreadCount * 1 fillers) + (pairSpreadCount * 2)
    let nonHeroSlotsPlanned = heroSpreadCount * 1 + pairSpreadCount * 2

    if (nonHeroSlotsPlanned > nonHeroPhotos) {
      // Slots > photos. Reduce some pair spreads from 2 to 1 photo.
      let surplus = nonHeroSlotsPlanned - nonHeroPhotos
      for (let i = sizes.length - 1; i >= 0 && surplus > 0; i--) {
        if (!isHeroSpot[i] && sizes[i] > 1) {
          sizes[i]--
          surplus--
        }
      }
      // If still surplus, reduce pair spreads to 0 (shouldn't normally happen)
      for (let i = sizes.length - 1; i >= 0 && surplus > 0; i--) {
        if (!isHeroSpot[i] && sizes[i] > 0) {
          sizes[i]--
          surplus--
        }
      }
    } else if (nonHeroSlotsPlanned < nonHeroPhotos) {
      // Need to increase density. Step up hero spreads first (hero+1 → hero+2 → +3 → +4 max),
      // then pair spreads (2 → 3 → 4 → 5). Hard cap is 5 photos per spread — anything
      // beyond that becomes unused-pool overflow.
      let deficit = nonHeroPhotos - nonHeroSlotsPlanned
      const heroMax = 5 // 1 hero + 4 fillers
      const pairMax = 5
      let safety = 1000
      while (deficit > 0 && safety-- > 0) {
        let bumped = false
        // Bump hero spreads first (give heroes more support photos)
        for (let i = 0; i < sizes.length && deficit > 0; i++) {
          if (isHeroSpot[i] && sizes[i] < heroMax) {
            sizes[i]++
            deficit--
            bumped = true
          }
        }
        // Then bump pair spreads
        for (let i = 0; i < sizes.length && deficit > 0; i++) {
          if (!isHeroSpot[i] && sizes[i] < pairMax) {
            sizes[i]++
            deficit--
            bumped = true
          }
        }
        if (!bumped) break
      }
    }

    // ---- PASS 2: ASSIGN ----
    // Build the actual spreads using the planned sizes + hero positions.
    const fillerQueue: Photo[] = [...favorites, ...others]
    let alternateLeft = true
    const eventSpreads: Spread[] = []

    for (let i = 0; i < spreadBudget; i++) {
      if (isHeroSpot[i]) {
        const hero = heroes.shift()
        if (!hero) {
          // Shouldn't happen — but if it does, fall back to a pair
          const take = Math.min(sizes[i], fillerQueue.length)
          const chunk = fillerQueue.splice(0, take)
          if (chunk.length === 0) continue
          const tpl =
            pickTemplate(type, chunk.length, false, undefined, chunk, spreadAspectRatio) ??
            pickTemplate(type, chunk.length, true, undefined, chunk, spreadAspectRatio)
          if (!tpl) continue
          eventSpreads.push({ id: `s-${idx++}`, templateId: tpl.id, photoIds: chunk.map((p) => p.id), eventId: eid })
          continue
        }
        const fillerCount = Math.max(0, sizes[i] - 1)
        const fillers = fillerQueue.splice(0, fillerCount)
        const total = 1 + fillers.length
        // Pick template: hero+N with side alternating
        const tplId = alternateLeft
          ? total === 5 ? 'hero-4r' : total === 4 ? 'hero-3r' : total === 3 ? 'hero-2r' : 'hero-1r'
          : total === 5 ? 'hero-4l' : total === 4 ? 'hero-3l' : total === 3 ? 'hero-2l' : 'hero-1l'
        const heroPhotos = [hero, ...fillers]
        const tpl =
          pickTemplate(type, total, true, tplId, heroPhotos, spreadAspectRatio) ??
          pickTemplate(type, total, true, undefined, heroPhotos, spreadAspectRatio)
        if (!tpl) {
          // Fall back: put hero into a 2-photo pair as if it were any photo
          const fallback = pickTemplate(type, total, false, undefined, heroPhotos, spreadAspectRatio)
          if (!fallback) continue
          eventSpreads.push({
            id: `s-${idx++}`,
            templateId: fallback.id,
            photoIds: [hero, ...fillers].map((p) => p.id),
            eventId: eid,
          })
          continue
        }
        const heroSlotIdx = tpl.slots.findIndex((s) => s.isHero)
        const photoIds: string[] = new Array(tpl.slots.length).fill('')
        photoIds[heroSlotIdx] = hero.id
        let fi = 0
        for (let s = 0; s < tpl.slots.length; s++) {
          if (s === heroSlotIdx) continue
          if (fillers[fi]) photoIds[s] = fillers[fi++].id
        }
        eventSpreads.push({ id: `s-${idx++}`, templateId: tpl.id, photoIds: photoIds.filter(Boolean), eventId: eid })
        alternateLeft = !alternateLeft
      } else {
        // Pair (or higher density) spread
        const take = Math.min(sizes[i], fillerQueue.length)
        if (take === 0) continue
        const chunk = fillerQueue.splice(0, take)
        const tpl =
          pickTemplate(type, chunk.length, false, undefined, chunk, spreadAspectRatio) ??
          pickTemplate(type, chunk.length, true, undefined, chunk, spreadAspectRatio)
        if (!tpl) continue
        eventSpreads.push({ id: `s-${idx++}`, templateId: tpl.id, photoIds: chunk.map((p) => p.id), eventId: eid })
      }
    }

    // If anything still remains in this event, jam it onto the last spread
    // by upgrading the template — keeps the all-photos-placed promise.
    const stillLeft = [...heroes, ...fillerQueue]
    if (stillLeft.length > 0 && eventSpreads.length > 0) {
      const last = eventSpreads[eventSpreads.length - 1]
      const tgt = Math.min(5, last.photoIds.length + stillLeft.length)
      const upgrade = pickTemplate(type, tgt, false)
      if (upgrade) {
        last.templateId = upgrade.id
        last.photoIds = [
          ...last.photoIds,
          ...stillLeft.slice(0, tgt - last.photoIds.length).map((p) => p.id),
        ]
      }
    }

    spreads.push(...eventSpreads)
  }

  // Final orphan-safety pass
  const placed = new Set(spreads.flatMap((s) => s.photoIds).filter((id): id is string => Boolean(id)))
  const orphans = useable.filter((p) => !placed.has(p.id))
  if (orphans.length > 0 && spreads.length > 0) {
    const last = spreads[spreads.length - 1]
    const tgt = Math.min(5, last.photoIds.length + orphans.length)
    const upgrade = pickTemplate(type, tgt, false)
    if (upgrade) {
      last.templateId = upgrade.id
      last.photoIds = [...last.photoIds, ...orphans.slice(0, tgt - last.photoIds.length).map((p) => p.id)]
    }
  }

  return spreads
}

// ============== DEMO DATA ==============

function buildSampleWeddingPhotos(): Photo[] {
  // Sample photos start in the UNASSIGNED bucket — same as real uploads.
  // The Group step is meant to teach the user how to drag-and-tag, so
  // presenting them already-tagged would skip the lesson and feel
  // confusing ("why are these in Other 1?").
  const blurryIdxs = new Set([4, 13, 22])
  // Realistic, VARIED dimensions so the orientation scorer and the smart
  // DPI zoom-cap behave like real wedding photos. ~60% portrait, ~30%
  // landscape, ~10% square — and the picsum URL aspect matches the
  // reported width/height so previews aren't distorted.
  return Array.from({ length: 30 }, (_, i) => {
    const kind = i % 10 === 0 ? 'square' : i % 3 === 1 ? 'landscape' : 'portrait'
    const dims =
      kind === 'portrait'
        ? { width: 4000, height: 6000, pw: 1000, ph: 1500 }
        : kind === 'landscape'
        ? { width: 6000, height: 4000, pw: 1500, ph: 1000 }
        : { width: 4000, height: 4000, pw: 1200, ph: 1200 }
    return {
      id: `sample-${i}`,
      preview: `https://picsum.photos/seed/wedding${i}/${dims.pw}/${dims.ph}`,
      width: dims.width,
      height: dims.height,
      tagged: 'none' as const,
      eventId: 'unassigned' as EventId,
      blurry: blurryIdxs.has(i),
    }
  })
}

// ============== STYLES ==============

const css: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--dark)',
    color: 'var(--cream)',
    fontFamily: 'var(--font-body)',
    paddingBottom: 80,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 5%',
    borderBottom: '0.5px solid rgba(184,150,90,0.15)',
    marginBottom: 40,
  },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    letterSpacing: 4,
    color: 'var(--cream)',
    textDecoration: 'none',
    textTransform: 'uppercase',
  },
  navBack: {
    background: 'transparent',
    border: 'none',
    color: GOLD,
    fontSize: 9,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    textDecoration: 'none',
  },
  container: { maxWidth: 1100, margin: '0 auto', padding: '0 5%' },
  containerWide: { maxWidth: 1400, margin: '0 auto', padding: '0 5%' },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 5vw, 56px)',
    fontWeight: 300,
    lineHeight: 1.1,
    color: 'var(--cream)',
    marginBottom: 16,
  },
  titleEm: { color: GOLD, fontStyle: 'italic' },
  subtitle: { fontSize: 12, letterSpacing: 1, color: 'var(--muted2)', lineHeight: 2, marginBottom: 32 },
  betaPill: {
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: 3,
    color: GOLD,
    border: '0.5px solid rgba(184,150,90,0.4)',
    padding: '6px 16px',
    borderRadius: 30,
    textTransform: 'uppercase',
    marginBottom: 18,
  },
  btnPrimary: {
    background: GOLD,
    color: 'var(--dark)',
    border: 'none',
    padding: '15px 32px',
    borderRadius: 40,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    flex: 1,
  },
  btnSecondary: {
    background: 'transparent',
    color: GOLD,
    border: `0.5px solid ${GOLD}`,
    padding: '13px 28px',
    borderRadius: 40,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  btnGhost: {
    background: 'transparent',
    color: 'var(--cream)',
    border: '0.5px solid rgba(184,150,90,0.3)',
    padding: '10px 20px',
    borderRadius: 30,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  notice: {
    background: 'rgba(184,150,90,0.06)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 10,
    padding: '16px 20px',
    fontSize: 11,
    color: 'var(--muted2)',
    lineHeight: 1.8,
  },
  uploadZone: {
    border: '0.5px dashed rgba(184,150,90,0.4)',
    borderRadius: 12,
    padding: 50,
    textAlign: 'center',
    cursor: 'pointer',
    background: 'var(--dark2)',
    transition: 'border-color 0.3s',
  },
  card: {
    background: 'var(--dark2)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 12,
    padding: 24,
  },
  cardSelectable: {
    background: 'var(--dark2)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 12,
    padding: 24,
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  cardSelected: {
    background: 'rgba(184,150,90,0.08)',
    borderColor: GOLD,
  },
}

// ============== ICONS ==============

const IconUpload = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke={GOLD}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
)
const IconStar = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill={(props.fill as string) ?? GOLD} viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
)
const IconHeart = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="#ff8a8a" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
  </svg>
)
const IconCheck = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke={GOLD}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
  </svg>
)
const IconBlur = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 20 20" stroke="#ff8a8a">
    <circle cx="10" cy="10" r="7" strokeWidth={1.2} strokeDasharray="2 2" />
    <path d="M10 6v4M10 13.5h.01" strokeWidth={1.2} strokeLinecap="round" />
  </svg>
)

// ============== MAIN ==============

export default function SmartDesignerPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlAlbumId = searchParams?.get('album') ?? null

  const [albumId, setAlbumId] = useState<string | null>(urlAlbumId)
  const [albumName, setAlbumName] = useState<string>('')
  const [hydrated, setHydrated] = useState(false) // true once we've read localStorage on mount
  const [step, setStep] = useState<Step>('setup')
  const [size, setSize] = useState<AlbumSize | null>(null)
  const [type, setType] = useState<AlbumType | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [pageCount, setPageCount] = useState(15)
  const [spreads, setSpreads] = useState<Spread[]>([])
  // Unused-pool state — explicit (not derived) so undo/redo ops can move
  // photos between spreads and unused without recomputing. Initialized
  // when generateLayout runs; maintained by ops afterwards.
  const [unusedPhotoIds, setUnusedPhotoIds] = useState<string[]>([])
  const [eventFilter, setEventFilter] = useState<EventId | 'all'>('all')
  const [recatId, setRecatId] = useState<string | null>(null)
  // Tracks which event card is currently a drag-over target (for the
  // gold-highlight feedback while the user drags a photo onto a tag).
  const [recatDragOverEvent, setRecatDragOverEvent] = useState<EventId | null>(null)
  // Multi-select for the Group step. Click a photo to toggle its selection;
  // dragging any selected photo carries the whole set. The action bar at the
  // bottom of the screen gives quick "Move all to <tag>" buttons.
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set())
  // Per-album custom names for the event tags. Keyed by EventId. Persisted
  // alongside the rest of the wizard state. Falls back to the default name
  // from the EVENTS array.
  const [customEventNames, setCustomEventNames] = useState<Record<string, string>>({})
  const [editingTagId, setEditingTagId] = useState<EventId | null>(null)
  // Empty-slot picker — when a user clicks a "+ Add" empty slot in the
  // adjust step, this opens a small popover with two options:
  //   1. Pick from unused photos
  //   2. Upload a new file
  const [emptySlotPicker, setEmptySlotPicker] = useState<{ spreadId: string; slotIdx: number } | null>(null)
  const emptySlotFileInputRef = useRef<HTMLInputElement>(null)

  // ---------- Final submit flow ----------
  // Customer info form (modal shown when "Submit Order" is clicked).
  const [submitModalOpen, setSubmitModalOpen] = useState(false)
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    notes: '',
  })
  // Submission progress: uploadIdx of total when uploading photos.
  const [submitting, setSubmitting] = useState<{
    stage: 'idle' | 'uploading' | 'persisting' | 'done' | 'error'
    done: number
    total: number
    label: string
    error?: string
  }>({ stage: 'idle', done: 0, total: 0, label: '' })
  // Real order ID returned by /api/submit-smart-order (replaces the
  // session-only random one we generate at mount time).
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null)
  const [polishHandoff, setPolishHandoff] = useState(false)

  // ────── Phase 1: Proof approval (clause 2.3) ──────
  // Tracks which spreads the customer has personally reviewed. Required
  // before they can hit "Approve This Proof for Printing."
  // Cleared whenever the user navigates back to adjust (so any subsequent
  // edit forces a fresh review).
  const [reviewedSpreadIds, setReviewedSpreadIds] = useState<Set<string>>(new Set())
  // The full audit record we send to the server when proof is approved.
  // Server adds IP + UA + orderId on its side.
  const [proofApproval, setProofApproval] = useState<{
    acceptedAt: string
    clauseVersion: string
    clauseText: string
    reviewedSpreadIds: string[]
  } | null>(null)

  // ────── Phase 2: Content rights modal (clauses 2.2 + 2.4) ──────
  // Shown the first time photos enter the album. Stored in localStorage
  // tied to the album so resuming a saved album doesn't re-prompt.
  const [contentRightsModalOpen, setContentRightsModalOpen] = useState(false)
  // Two-checkbox state inside the modal.
  const [crCopyrightOk, setCrCopyrightOk] = useState(false)
  const [crPolicyOk, setCrPolicyOk] = useState(false)
  const [contentRights, setContentRights] = useState<{
    acceptedAt: string
    clauseVersion: string
    copyrightClause: string
    policyClause: string
  } | null>(null)
  const [swapSlot, setSwapSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  // Tap-to-place: an unused photo the user "picked up" by tapping it.
  // While set, tapping any slot drops this photo into it. This is the
  // touch-friendly alternative to HTML5 drag-and-drop (which is
  // mouse-only and silently does nothing on touchscreens).
  const [pickedUnusedId, setPickedUnusedId] = useState<string | null>(null)
  // Universal pointer-drag (mouse + touch + pen). Native HTML5 DnD is
  // mouse-only; this works on every device. A floating ghost follows the
  // pointer; on release we hit-test the slot under it via
  // document.elementFromPoint + data-ff-slot attributes.
  const pointerDragRef = useRef<{
    photoId: string
    startX: number
    startY: number
    active: boolean
    suppressClick: boolean
  } | null>(null)
  const [dragGhost, setDragGhost] = useState<{
    preview: string
    x: number
    y: number
  } | null>(null)
  const [editSlot, setEditSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  const [adjusts, setAdjusts] = useState<Record<string, PhotoAdjust>>({})
  // Per-spread backgrounds (paper/color/photo). Keyed by spread id.
  // Separate from the op system, persisted like `adjusts`.
  const [spreadBgs, setSpreadBgs] = useState<Record<string, SpreadBg>>({})
  const [layoutMenuId, setLayoutMenuId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [orderId] = useState(() => `FF-${Math.floor(100000 + Math.random() * 900000)}`)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ----- Undo / redo (5-deep, per-album, persisted) -----
  const { show: showToast, Toast } = useToast()
  const undoApi = useUndo({
    albumId,
    state: {
      spreads: spreads as unknown as OpSpread[],
      unusedPhotoIds,
    },
    setState: ({ spreads: nextSpreads, unusedPhotoIds: nextUnused }) => {
      setSpreads(nextSpreads as unknown as Spread[])
      setUnusedPhotoIds(nextUnused)
    },
    onAnnounce: showToast,
  })

  // -------- Album hydrate / mint on mount --------
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (urlAlbumId) {
      // Resume an existing smart album: load saved state.
      const indexEntry = readAlbumsIndex().find((a) => a.id === urlAlbumId)
      if (indexEntry) {
        setAlbumName(indexEntry.name)
      }
      let loadedPhotos: Photo[] | null = null
      try {
        const raw = window.localStorage.getItem(`${SMART_STATE_PREFIX}:${urlAlbumId}`)
        if (raw) {
          const s = JSON.parse(raw) as Partial<{
            size: AlbumSize
            type: AlbumType
            pageCount: number
            step: Step
            photos: Photo[]
            spreads: Spread[]
            adjusts: Record<string, PhotoAdjust>
            spreadBgs: Record<string, SpreadBg>
            unusedPhotoIds: string[]
            customEventNames: Record<string, string>
          }>
          if (s.size) setSize(s.size)
          if (s.type) setType(s.type)
          if (typeof s.pageCount === 'number') setPageCount(s.pageCount)
          if (s.step) setStep(s.step)
          if (Array.isArray(s.photos)) {
            // Migrate any legacy eventIds (ceremony / portraits / other)
            // from albums saved with the old 5-tag list.
            const migrated = s.photos.map((p) =>
              p.eventId !== migrateLegacyEvent(p.eventId)
                ? { ...p, eventId: migrateLegacyEvent(p.eventId) }
                : p,
            )
            loadedPhotos = migrated
            setPhotos(migrated)
          }
          if (Array.isArray(s.spreads)) setSpreads(s.spreads)
          if (s.adjusts && typeof s.adjusts === 'object') setAdjusts(s.adjusts)
          if (s.spreadBgs && typeof s.spreadBgs === 'object') setSpreadBgs(s.spreadBgs)
          if (Array.isArray(s.unusedPhotoIds)) setUnusedPhotoIds(s.unusedPhotoIds)
          if (s.customEventNames && typeof s.customEventNames === 'object') {
            setCustomEventNames(s.customEventNames)
          }
        }
      } catch {
        /* ignore corrupt state */
      }

      // Phase 2: hydrate content-rights acceptance from localStorage so the
      // modal doesn't re-prompt on every visit.
      try {
        const crRaw = window.localStorage.getItem(`folio-content-rights:${urlAlbumId}`)
        if (crRaw) {
          const cr = JSON.parse(crRaw) as {
            acceptedAt: string
            clauseVersion: string
            copyrightClause: string
            policyClause: string
          }
          if (cr.acceptedAt && cr.clauseVersion) setContentRights(cr)
        }
      } catch {
        /* ignore */
      }

      // Restore uploaded photo blobs from IndexedDB.
      // Saved blob: URLs are invalidated by the browser on reload, so we
      // look them up by photoId in IDB and replace with fresh object URLs.
      // Sample photos (https://picsum.photos/...) keep their stable URLs.
      if (loadedPhotos && loadedPhotos.some((p) => p.preview.startsWith('blob:'))) {
        loadAlbumBlobs(urlAlbumId).then((blobMap) => {
          if (blobMap.size === 0) return
          setPhotos((prev) =>
            prev.map((p) => {
              if (!p.preview.startsWith('blob:')) return p
              const fresh = blobMap.get(p.id)
              return fresh ? { ...p, preview: fresh } : p
            }),
          )
        })
      }

      setHydrated(true)
      return
    }

    // No album in URL — mint a new one. Prompt for name first.
    const raw = window.prompt(
      'Name this album (you can rename later from the My Albums list):',
      '',
    )
    if (raw === null) {
      // User cancelled — return to design picker
      router.push('/design')
      return
    }
    const trimmed = raw.trim().slice(0, 80)
    const fallback = (() => {
      try {
        return 'Smart · ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      } catch {
        return 'Smart album'
      }
    })()
    const name = trimmed || fallback
    const newId = generateAlbumId()
    upsertAlbumIndex(newId, { name, mode: 'smart' })
    setAlbumId(newId)
    setAlbumName(name)
    // Push the album id into the URL so refresh resumes correctly
    router.replace(`/design/smart?album=${newId}`)
    setHydrated(true)
  }, [urlAlbumId, router])

  // -------- Auto-save on state changes --------
  useEffect(() => {
    if (!hydrated || !albumId || typeof window === 'undefined') return
    try {
      const payload = {
        size,
        type,
        pageCount,
        step: step === 'generate' ? 'pages' : step, // don't get stuck mid-generate
        photos,
        spreads,
        adjusts,
        spreadBgs,
        unusedPhotoIds,
        customEventNames,
      }
      window.localStorage.setItem(`${SMART_STATE_PREFIX}:${albumId}`, JSON.stringify(payload))
      upsertAlbumIndex(albumId, {})
    } catch {
      /* quota exceeded or disabled — silently drop */
    }
  }, [hydrated, albumId, size, type, pageCount, step, photos, spreads, adjusts, spreadBgs, unusedPhotoIds, customEventNames])

  const renameAlbum = () => {
    if (!albumId) return
    const next = window.prompt('Rename album:', albumName)
    if (next === null) return
    const trimmed = next.trim().slice(0, 80)
    if (!trimmed || trimmed === albumName) return
    upsertAlbumIndex(albumId, { name: trimmed })
    setAlbumName(trimmed)
  }

  const heroCount = photos.filter((p) => p.tagged === 'hero').length
  const favCount = photos.filter((p) => p.tagged === 'favorite').length
  const usefulPhotoCount = photos.filter((p) => !p.blurry).length

  // Recommended spreads = photos ÷ 4 (breathable, ~4 photos per spread).
  // Floor of 10, ceiling of 25 to fit album-spec range.
  const recommendedSpreads = Math.max(10, Math.min(25, Math.ceil(usefulPhotoCount / 4)))

  const albumPrice = useMemo(() => {
    if (!size || !type) return 0
    return computePrice(size, type, pageCount)
  }, [size, type, pageCount])

  // Phase 2: gate any path that adds photos behind the content-rights modal.
  // Returns true if photos may be added now; false if the modal was opened
  // and the caller should bail (the user will retry after accepting).
  const ensureContentRights = useCallback((): boolean => {
    if (contentRights) return true
    setCrCopyrightOk(false)
    setCrPolicyOk(false)
    setContentRightsModalOpen(true)
    return false
  }, [contentRights])

  const loadSamples = useCallback(() => {
    if (!ensureContentRights()) return
    setPhotos(buildSampleWeddingPhotos())
  }, [ensureContentRights])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    if (!ensureContentRights()) {
      // Clear the input so opening it again triggers another change event.
      e.target.value = ''
      return
    }
    const remaining = PHOTO_CAP - photos.length
    if (remaining <= 0) {
      alert(`You've reached the ${PHOTO_CAP}-photo limit.`)
      return
    }
    const toProcess = Array.from(files).slice(0, remaining)
    if (files.length > remaining) {
      alert(`Only ${remaining} more photos can fit (limit ${PHOTO_CAP}). Adding the first ${remaining}.`)
    }

    setUploadProgress(0)
    const newPhotos: Photo[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      const dim = await getImageDimensions(file)
      const photoId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
      newPhotos.push({
        id: photoId,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: 'unassigned',
        blurry: false,
      })
      // Persist the blob to IndexedDB so it survives a refresh.
      // Fire-and-forget; failure is handled inside saveBlob.
      if (albumId) saveBlob(albumId, photoId, file)
      setUploadProgress((i + 1) / toProcess.length)
    }
    setPhotos([...photos, ...newPhotos])
    setTimeout(() => setUploadProgress(0), 600)
  }

  // Functional update so the helper composes correctly when called in a
  // loop (e.g. multi-drag drop on a tag fires recategorize once per id).
  // The old version read `photos` from closure → only the last call won
  // → user saw "only one photo moved" with multi-select.
  const recategorize = (photoId: string, eventId: EventId) => {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, eventId } : p)))
    setRecatId(null)
  }

  const toggleTag = (photoId: string, tag: 'hero' | 'favorite') => {
    const photo = photos.find((p) => p.id === photoId)
    if (!photo) return

    if (tag === 'hero' && photo.tagged !== 'hero') {
      if (photo.width < HERO_MIN_PX || photo.height < HERO_MIN_PX) {
        alert(
          `This photo is ${photo.width}×${photo.height}px. Hero photos take a full page (half-spread) ` +
            `so they need at least ${HERO_MIN_PX}×${HERO_MIN_PX}px to print sharp. Try a higher-res ` +
            `shot, or tag this one as a Favorite — favorites get prioritized placement too.`,
        )
        return
      }
      if (photo.blurry) {
        if (
          !confirm(
            'This photo is auto-flagged as blurry. Heroes get the most prominent placement. Use it anyway?',
          )
        )
          return
      }
      if (heroCount >= HERO_CAP) {
        alert(`Maximum ${HERO_CAP} hero photos`)
        return
      }
    }
    if (tag === 'favorite' && photo.tagged !== 'favorite' && favCount >= FAV_CAP) {
      alert(`Maximum ${FAV_CAP} favorite photos`)
      return
    }
    setPhotos(
      photos.map((p) =>
        p.id === photoId ? { ...p, tagged: p.tagged === tag ? 'none' : tag } : p,
      ),
    )
  }

  /**
   * After running generateLayout, install the spreads AND recompute the
   * unused pool as photos that didn't make it into any spread (blurry
   * photos are deliberately excluded from both layouts and the pool).
   */
  const installLayout = useCallback(
    (newSpreads: Spread[]) => {
      const placed = new Set(newSpreads.flatMap((s) => s.photoIds))
      const newUnused = photos.filter((p) => !p.blurry && !placed.has(p.id)).map((p) => p.id)
      setSpreads(newSpreads)
      setUnusedPhotoIds(newUnused)
    },
    [photos],
  )

  const runGenerate = useCallback(() => {
    if (!type) return
    if (undoApi.canUndo || undoApi.canRedo) {
      const ok = window.confirm('Regenerating will clear your edit history. Continue?')
      if (!ok) return
    }
    undoApi.clearStack()
    setGenerating(true)
    setStep('generate')
    setAdjusts({})
    const aspect = size ? ALBUM_SPECS[size].spreadAspectRatio : 24 / 17
    setTimeout(() => {
      installLayout(generateLayout(photos, pageCount, type, aspect))
      setGenerating(false)
      setStep('adjust')
    }, 1400)
  }, [photos, pageCount, type, size, undoApi, installLayout])

  const regenerate = () => {
    if (!type) return
    if (undoApi.canUndo || undoApi.canRedo) {
      const ok = window.confirm('Regenerating will clear your edit history. Continue?')
      if (!ok) return
    }
    undoApi.clearStack()
    const aspect = size ? ALBUM_SPECS[size].spreadAspectRatio : 24 / 17
    installLayout(
      generateLayout([...photos].sort(() => Math.random() - 0.5), pageCount, type, aspect),
    )
    setAdjusts({})
  }

  // Swap a slot photo with a replacement (could be from another spread,
  // could be from unused pool). Records the right Op so it goes on the
  // undo stack.
  const swapPhoto = (newPhotoId: string) => {
    if (!swapSlot) return
    const replacingSpreadId = swapSlot.spreadId
    const replacingIdx = swapSlot.idx

    const opState = {
      spreads: spreads as unknown as OpSpread[],
      unusedPhotoIds,
    }

    if (unusedPhotoIds.includes(newPhotoId)) {
      // Swap with unused
      undoApi.record(makeSwapWithUnusedOp(opState, replacingSpreadId, replacingIdx, newPhotoId))
    } else {
      // Cross-spread swap: find which spread/slot the new photo currently lives in
      const sourceSpread = spreads.find((s) => s.photoIds.includes(newPhotoId))
      if (sourceSpread) {
        const sourceIdx = sourceSpread.photoIds.indexOf(newPhotoId)
        if (sourceSpread.id === replacingSpreadId) {
          // In-spread reorder
          undoApi.record(makeSwapOp(opState, replacingSpreadId, sourceIdx, replacingIdx))
        } else {
          // Cross-spread swap
          undoApi.record(
            makeCrossSwapOp(opState, sourceSpread.id, sourceIdx, replacingSpreadId, replacingIdx),
          )
        }
      }
    }
    // Reset adjustment for this slot since the photo changed
    setAdjusts((prev) => {
      const next = { ...prev }
      delete next[adjustKey(replacingSpreadId, replacingIdx)]
      return next
    })
    setSwapSlot(null)
  }

  const swapTemplate = (spreadId: string, newTemplateId: string) => {
    const current = spreads.find((s) => s.id === spreadId)
    if (!current) return
    const newTpl = TEMPLATE_BY_ID.get(newTemplateId)
    if (!newTpl) return

    let newIds: (string | null)[] = [...current.photoIds]
    let nextUnused = [...unusedPhotoIds]

    if (newTpl.slots.length < newIds.length) {
      // shrink: surplus photos go BACK to unused (so user doesn't lose them)
      const surplus = newIds
        .slice(newTpl.slots.length)
        .filter((id): id is string => Boolean(id))
      newIds = newIds.slice(0, newTpl.slots.length)
      nextUnused = [...nextUnused, ...surplus]
    } else if (newTpl.slots.length > newIds.length) {
      // grow: leave new slots EMPTY (per owner's spec — don't auto-fill).
      // User clicks the empty slot's + Add button to fill it manually.
      while (newIds.length < newTpl.slots.length) {
        newIds.push(null)
      }
    }

    const op = makeLayoutVariantOp(
      { spreads: spreads as unknown as OpSpread[] },
      spreadId,
      newTemplateId,
      newIds,
    )
    // Layout variant op only knows about the spread; if we shifted the
    // unused pool above, sync it manually after recording.
    undoApi.record(op)
    if (nextUnused.length !== unusedPhotoIds.length) {
      setUnusedPhotoIds(nextUnused)
    }
    setLayoutMenuId(null)
    setAdjusts((prev) => {
      const next: Record<string, PhotoAdjust> = {}
      Object.entries(prev).forEach(([k, v]) => {
        if (!k.startsWith(`${spreadId}::`)) next[k] = v
      })
      return next
    })
  }

  const updateAdjust = (key: string, patch: Partial<PhotoAdjust>) => {
    setAdjusts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? DEFAULT_ADJUST), ...patch },
    }))
  }

  // ---------- Add a new (empty) spread to the album from the adjust step ----------
  // Inserts at the end. Uses the 'pair' template so the new spread has 2 empty
  // slots, each with a "+ Add photo" affordance. Increments pageCount so the
  // price recalculates and persists. Capped at the album spec's maxSpreads.
  const handleAddSpread = useCallback(() => {
    if (!size || !type) return
    const spec = ALBUM_SPECS[size][type]
    if (pageCount >= spec.maxSpreads) {
      showToast(`Max ${spec.maxSpreads} spreads for ${ALBUM_SPECS[size].label}`)
      return
    }
    const pairTpl =
      TEMPLATES.find((t) => t.compat.includes(type) && t.id === 'pair') ?? TEMPLATES[0]
    const newSpread: Spread = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      templateId: pairTpl.id,
      photoIds: new Array(pairTpl.slots.length).fill(null),
      eventId: 'unassigned',
    }
    setSpreads((prev) => [...prev, newSpread])
    setPageCount((prev) => prev + 1)
    showToast(`+1 spread · $${spec.perExtraSpread} added to total`)
  }, [size, type, pageCount, showToast])

  // ---------- Empty-slot fillers (called from SpreadView's "+ Add" overlay) ----------
  /** Place a specific photo id into an empty slot. Used by both pick-from-unused
   *  and upload-new flows. */
  const fillEmptySlot = useCallback(
    (spreadId: string, slotIdx: number, photoId: string) => {
      setSpreads((prev) =>
        prev.map((s) => {
          if (s.id !== spreadId) return s
          const newIds = [...s.photoIds]
          newIds[slotIdx] = photoId
          return { ...s, photoIds: newIds }
        }),
      )
      setUnusedPhotoIds((prev) => prev.filter((id) => id !== photoId))
      setEmptySlotPicker(null)
    },
    [],
  )

  // Shared placement: drop an unused photo into a slot. Empty slot →
  // fill; filled slot → swap (old photo back to unused, undoable).
  // Used by BOTH tap-to-place and the universal pointer-drag.
  const placeUnusedIntoSlot = useCallback(
    (spreadId: string, slotIdx: number, photoId: string) => {
      const target = spreads.find((s) => s.id === spreadId)
      const filled = target ? Boolean(target.photoIds[slotIdx]) : false
      if (filled) {
        undoApi.record(
          makeSwapWithUnusedOp(
            { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
            spreadId,
            slotIdx,
            photoId,
          ),
        )
      } else {
        fillEmptySlot(spreadId, slotIdx, photoId)
      }
      setPickedUnusedId(null)
      setEditSlot({ spreadId, idx: slotIdx })
    },
    [spreads, unusedPhotoIds, undoApi, fillEmptySlot],
  )

  // Drag-to-background: drop a photo on a spread's empty/matted area to
  // make it the blurred background. Sensible defaults if first time.
  const setSpreadBgPhoto = useCallback(
    (spreadId: string, photoId: string) => {
      setSpreadBgs((prev) => {
        const cur = prev[spreadId]
        return {
          ...prev,
          [spreadId]: {
            mode: 'photo',
            photoId,
            blur: cur?.blur ?? 18,
            dim: cur?.dim ?? 0.25,
            zoom: Math.min(BG_PHOTO_MAX_ZOOM, cur?.zoom ?? 1),
            panX: cur?.panX ?? 50,
            panY: cur?.panY ?? 50,
          },
        }
      })
      setPickedUnusedId(null)
    },
    [],
  )

  // ----- Universal pointer-drag for unused photos -----
  const beginPointerDrag = useCallback(
    (e: React.PointerEvent, photoId: string, preview: string) => {
      // Left button / primary touch only
      if (e.button !== 0 && e.pointerType === 'mouse') return
      pointerDragRef.current = {
        photoId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        suppressClick: false,
      }

      const DRAG_THRESHOLD = 7 // px before it counts as a drag (vs a tap)

      const onMove = (ev: PointerEvent) => {
        const st = pointerDragRef.current
        if (!st) return
        const dx = ev.clientX - st.startX
        const dy = ev.clientY - st.startY
        if (!st.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        if (!st.active) {
          st.active = true
          st.suppressClick = true
        }
        ev.preventDefault()
        setDragGhost({ preview, x: ev.clientX, y: ev.clientY })
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const st = pointerDragRef.current
        setDragGhost(null)
        if (!st || !st.active) {
          // No real movement → it was a tap; let onClick handle it.
          pointerDragRef.current = null
          return
        }
        // Hit-test whatever is under the release point.
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const slotEl = el?.closest('[data-ff-slot]') as HTMLElement | null
        if (slotEl) {
          // Dropped on a photo slot → fill / swap.
          const sId = slotEl.getAttribute('data-ff-spread')
          const sIdx = slotEl.getAttribute('data-ff-slot')
          if (sId && sIdx !== null) {
            placeUnusedIntoSlot(sId, Number(sIdx), st.photoId)
          }
        } else {
          // Not on a slot — dropped on the spread's background/margin
          // area → use this photo as the blurred background.
          const bgEl = el?.closest('[data-ff-bgzone]') as HTMLElement | null
          const bgSpread = bgEl?.getAttribute('data-ff-bgspread')
          if (bgSpread) {
            setSpreadBgPhoto(bgSpread, st.photoId)
          }
        }
        // keep suppressClick true until the click fires, then it resets
        setTimeout(() => {
          if (pointerDragRef.current === st) pointerDragRef.current = null
        }, 0)
      }

      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
    },
    [placeUnusedIntoSlot, setSpreadBgPhoto],
  )

  const onEmptySlotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!emptySlotPicker) return
    const file = e.target.files?.[0]
    if (!file) return
    if (!ensureContentRights()) {
      e.target.value = ''
      return
    }
    const dim = await getImageDimensions(file)
    const photoId = `${Date.now()}-empty-${Math.random().toString(36).slice(2, 8)}`
    const newPhoto: Photo = {
      id: photoId,
      preview: URL.createObjectURL(file),
      width: dim.width,
      height: dim.height,
      tagged: 'none',
      eventId: 'unassigned',
      blurry: false,
    }
    setPhotos((prev) => [...prev, newPhoto])
    if (albumId) saveBlob(albumId, photoId, file)
    fillEmptySlot(emptySlotPicker.spreadId, emptySlotPicker.slotIdx, photoId)
    e.target.value = ''
  }

  // ---------- Final submit (customer info → upload to R2 → API call) ----------
  // Validates the form, runs the photo-upload pipeline (orig + watermarked
  // preview to R2), then POSTs everything to /api/submit-smart-order which
  // persists to KV + emails owner + customer. On success we land on the
  // submit step with the REAL order ID returned by the server.
  const runFinalSubmit = useCallback(async () => {
    if (!size || !type) return
    const c = customerForm
    if (!c.name.trim() || !c.email.trim()) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Name and email are required' })
      return
    }
    if (!c.line1.trim() || !c.city.trim() || !c.postalCode.trim()) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Shipping address line 1, city and postal code are required' })
      return
    }
    if (!albumId) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Album id missing — please refresh and try again' })
      return
    }
    // Legal gate (clause 2.3 + clause 2.4). If either record is missing we
    // refuse — the customer must have walked through both checkpoints.
    if (!proofApproval) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Proof not approved. Please review every spread before submitting (clause 2.3).' })
      return
    }
    if (!contentRights) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Content rights not accepted (clauses 2.2 and 2.4). Please re-open the rights confirmation.' })
      return
    }
    // Only photos that are actually placed in spreads get uploaded.
    const usedIds = new Set(
      spreads.flatMap((s) => s.photoIds).filter((id): id is string => Boolean(id)),
    )
    const photosToUpload = photos.filter((p) => usedIds.has(p.id))
    if (photosToUpload.length === 0) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Album has no photos placed' })
      return
    }

    setSubmitting({
      stage: 'uploading',
      done: 0,
      total: photosToUpload.length + spreads.length,
      label: 'Preparing upload…',
    })
    try {
      const { prepareSubmission } = await import('./edit/submit-helpers')
      const designId = albumId // use albumId as the R2 designId folder
      // Build the template map for spread compositing
      const templateMap = new Map(
        TEMPLATES.map((t) => [
          t.id,
          { id: t.id, name: t.name, slots: t.slots },
        ]),
      )
      const result = await prepareSubmission({
        albumId,
        designId,
        photos: photosToUpload.map((p) => ({
          id: p.id,
          preview: p.preview,
          width: p.width,
          height: p.height,
        })),
        spreads: spreads.map((s) => ({
          id: s.id,
          templateId: s.templateId,
          photoIds: s.photoIds as (string | null)[],
        })),
        templates: templateMap,
        adjusts,
        spreadAspectRatio: ALBUM_SPECS[size].spreadAspectRatio,
        showGutter: type === 'standard',
        spreadBgs,
        onProgress: (done, total, label) =>
          setSubmitting({ stage: 'uploading', done, total, label }),
      })

      setSubmitting({
        stage: 'persisting',
        done: photosToUpload.length + spreads.length,
        total: photosToUpload.length + spreads.length,
        label: 'Saving order…',
      })

      // Map photo tag + event back onto each upload result
      const photoById = new Map(photos.map((p) => [p.id, p]))
      const photosPayload = result.photos.map((u) => {
        const meta = photoById.get(u.photoId)
        return {
          ...u,
          tagged: meta?.tagged ?? 'none',
          eventId: meta?.eventId ?? 'unassigned',
        }
      })

      const res = await fetch('/api/submit-smart-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          albumName: albumName || 'Untitled Smart Album',
          customer: { name: c.name.trim(), email: c.email.trim() },
          shipping: {
            recipientName: c.name.trim(),
            phone: c.phone.trim(),
            line1: c.line1.trim(),
            line2: c.line2.trim() || undefined,
            city: c.city.trim(),
            region: c.region.trim(),
            postalCode: c.postalCode.trim(),
            country: c.country.trim() || 'United States',
            notes: c.notes.trim() || undefined,
          },
          album: {
            size,
            type,
            pageCount,
            totalPrice: albumPrice + (polishHandoff ? 99 : 0),
          },
          photos: photosPayload,
          spreads,
          spreadComposites: result.spreadComposites,
          customEventNames,
          polishHandoff,
          // ── Legal audit records (Phase 1 + Phase 2) ──
          proofApproval,
          contentRights,
          // Summary of low-res photos so the owner can flag them on the
          // print order (clause 2.2 — customer bears responsibility for
          // resolution, but the printer wants to know in advance).
          lowResPhotos: photosToUpload
            .filter((p) => Math.min(p.width, p.height) < LOW_RES_PX)
            .map((p) => ({ id: p.id, width: p.width, height: p.height })),
        }),
      })
      if (!res.ok) {
        let detail = ''
        try {
          const j = (await res.json()) as { error?: string }
          detail = j.error ?? ''
        } catch {
          /* ignore */
        }
        throw new Error(`Server rejected the order${detail ? ': ' + detail : ''}`)
      }
      const json = (await res.json()) as { orderId: string; token: string }
      setSubmittedOrderId(json.orderId)

      // ── Payment hand-off (Square) ──
      // submit-smart-order has persisted the order at pending_payment and
      // sent us the owner heads-up. Now we ask /api/square-checkout to
      // build a Payment Link and redirect the customer to Square's hosted
      // checkout. The confirmation emails (customer + owner PAID) fire
      // from the webhook on payment success.
      setSubmitting({
        stage: 'persisting',
        done: photosToUpload.length + spreads.length,
        total: photosToUpload.length + spreads.length,
        label: 'Opening secure checkout…',
      })
      const checkoutRes = await fetch('/api/square-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: json.token }),
      })
      if (!checkoutRes.ok) {
        let detail = ''
        try {
          const j = (await checkoutRes.json()) as { error?: string }
          detail = j.error ?? ''
        } catch {
          /* ignore */
        }
        throw new Error(`Couldn't start payment${detail ? ': ' + detail : ''}`)
      }
      const checkoutJson = (await checkoutRes.json()) as { url: string }
      // Hard navigation — Stripe's hosted checkout takes over from here.
      // The customer comes back to /design/smart/success on success or to
      // /design/smart?payment=cancelled if they bail.
      window.location.href = checkoutJson.url
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: msg })
    }
  }, [
    size,
    type,
    albumId,
    albumName,
    pageCount,
    albumPrice,
    photos,
    spreads,
    customerForm,
    customEventNames,
    polishHandoff,
    proofApproval,
    contentRights,
    adjusts,
  ])

  // ---------- DnD: slot↔slot swap, unused→slot swap, unused→spread (+1) ----------
  // Adapter so templatesForCount matches the integration's signature
  // (count, { type, hasHero }).
  const templatesForCountAdapter = useCallback(
    (count: number, opts: { type: AlbumType; hasHero: boolean }) =>
      templatesForCount(count, opts.type).filter((t) =>
        opts.hasHero ? t.slots.some((s) => s.isHero) : !t.slots.some((s) => s.isHero),
      ),
    [],
  )
  const isHeroPhoto = useCallback(
    (id: string) => photos.find((p) => p.id === id)?.tagged === 'hero',
    [photos],
  )
  const handleAddUnusedToSpread = useCallback(
    (spreadId: string, photoId: string) => {
      if (!type) return
      const result = buildAddOp(
        { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
        spreadId,
        photoId,
        { albumType: type, isHeroPhoto, templatesForCount: templatesForCountAdapter, maxPhotosPerSpread: 5 },
      )
      if ('op' in result) {
        undoApi.record(result.op)
      } else if (result.error === 'at-capacity') {
        showToast('Spread is at the 5-photo cap')
      } else {
        showToast(`Couldn't add: ${result.error}`)
      }
    },
    [type, spreads, unusedPhotoIds, isHeroPhoto, templatesForCountAdapter, undoApi, showToast],
  )
  // Custom count-change that mirrors swapTemplate's "leave-empty" behavior:
  //   - GROW: keep current photos, pad with null slots (user fills via + button or drag)
  //   - SHRINK: keep first N photos, push surplus back to unused
  // The integration's buildPhotoCountOp blocks growing without unused photos,
  // which the owner explicitly does NOT want — they want to grow even with
  // an empty pool and fill manually.
  const handlePhotoCountChange = useCallback(
    (spreadId: string, newCount: number) => {
      if (!type) return
      const spread = spreads.find((s) => s.id === spreadId)
      if (!spread) return
      const filled = spread.photoIds.filter((id): id is string => Boolean(id))
      const currentCount = filled.length
      if (newCount === currentCount) return

      // Pick a template with the new slot count. Prefer same hero/non-hero
      // kind, then pick the best ORIENTATION match among those for the
      // spread's actual photos (Part B).
      const currentTpl = TEMPLATE_BY_ID.get(spread.templateId)
      const wantsHero = currentTpl?.slots.some((s) => s.isHero) && newCount >= 2
      const aspect = size ? ALBUM_SPECS[size].spreadAspectRatio : 24 / 17
      const spreadPhotos = filled
        .map((id) => photos.find((p) => p.id === id))
        .filter((p): p is Photo => Boolean(p))
      const candidates = TEMPLATES.filter(
        (t) => t.compat.includes(type) && t.slots.length === newCount,
      )
      const sameKind = candidates.filter(
        (t) => t.slots.some((s) => s.isHero) === wantsHero,
      )
      const pool = sameKind.length > 0 ? sameKind : candidates
      let newTpl = pool[0]
      if (spreadPhotos.length > 0) {
        let bestScore = -1
        for (const c of pool) {
          const sc = scoreTemplateForPhotos(c, spreadPhotos, aspect)
          if (sc > bestScore) {
            bestScore = sc
            newTpl = c
          }
        }
      }
      if (!newTpl) {
        showToast(`No layout available for ${newCount} photos`)
        return
      }

      let newIds: (string | null)[]
      let nextUnused = [...unusedPhotoIds]
      if (newCount > currentCount) {
        // Grow: keep filled + pad with nulls (empty slots show "+ Add")
        newIds = [...filled]
        while (newIds.length < newCount) newIds.push(null)
      } else {
        // Shrink: keep first N, push surplus back to unused pool
        newIds = filled.slice(0, newCount)
        const surplus = filled.slice(newCount)
        nextUnused = [...nextUnused, ...surplus]
      }

      const op = makeLayoutVariantOp(
        { spreads: spreads as unknown as OpSpread[] },
        spreadId,
        newTpl.id,
        newIds,
      )
      undoApi.record(op)
      if (nextUnused.length !== unusedPhotoIds.length) {
        setUnusedPhotoIds(nextUnused)
      }
    },
    [type, size, photos, spreads, unusedPhotoIds, undoApi, showToast],
  )
  // useSlotDrag gives us slot draggability + drop targets + spread-bg
  // drop handler. record + state are passed in; the hooks call our op
  // constructors directly for the simple swap cases. The +1 layout case
  // routes through onAddRequested → handleAddUnusedToSpread.
  const slotDrag = useSlotDrag({
    state: { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
    record: undoApi.record,
    onAddRequested: handleAddUnusedToSpread,
  })

  // ---------- Drag-to-reorder spreads ----------
  // Lightweight HTML5 drag. The dragged spread's index is stashed in
  // dataTransfer; the drop target computes the new index.
  const [draggingSpreadIdx, setDraggingSpreadIdx] = useState<number | null>(null)
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)

  const onSpreadDragStart = (idx: number) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-folio-spread', String(idx))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingSpreadIdx(idx)
  }
  const onSpreadDragOver = (idx: number) => (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-folio-spread')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetIdx(idx)
    }
  }
  const onSpreadDrop = (idx: number) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-folio-spread')) return
    e.preventDefault()
    const fromIdx = parseInt(e.dataTransfer.getData('application/x-folio-spread'), 10)
    if (Number.isNaN(fromIdx) || fromIdx === idx) {
      setDraggingSpreadIdx(null)
      setDropTargetIdx(null)
      return
    }
    // Insert-before semantics: dragging FROM index X TO index Y means
    // "remove from X, insert at Y". If X < Y, that's "after Y-1"; we
    // pass `idx` as-is and the op handles it correctly (splice + insert).
    const targetIdx = fromIdx < idx ? idx - 1 : idx
    const op = makeReorderSpreadOp(
      { spreads: spreads as unknown as OpSpread[] },
      fromIdx,
      targetIdx,
    )
    undoApi.record(op)
    setDraggingSpreadIdx(null)
    setDropTargetIdx(null)
  }
  const onSpreadDragEnd = () => {
    setDraggingSpreadIdx(null)
    setDropTargetIdx(null)
  }

  // ---------- Add more photos (from the unused-panel sidebar) ----------
  // Adds new uploads straight into the unused pool with default tags.
  // User is past the group/tag steps so we don't ask for an event —
  // photos go to 'other1' and the user can drag/swap them in. Honors
  // the global PHOTO_CAP.
  const addMorePhotosInputRef = useRef<HTMLInputElement>(null)
  const onAddMorePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    if (!ensureContentRights()) {
      e.target.value = ''
      return
    }
    const remaining = PHOTO_CAP - photos.length
    if (remaining <= 0) {
      alert(`You're at the ${PHOTO_CAP}-photo limit.`)
      return
    }
    const toProcess = Array.from(files).slice(0, remaining)
    if (files.length > remaining) {
      alert(`Only ${remaining} more photos can fit. Adding the first ${remaining}.`)
    }
    const newPhotos: Photo[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      const dim = await getImageDimensions(file)
      const photoId = `${Date.now()}-add-${i}-${Math.random().toString(36).slice(2, 8)}`
      newPhotos.push({
        id: photoId,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: 'unassigned',
        blurry: false,
      })
      if (albumId) saveBlob(albumId, photoId, file)
    }
    setPhotos((prev) => [...prev, ...newPhotos])
    setUnusedPhotoIds((prev) => [...prev, ...newPhotos.map((p) => p.id)])
    showToast(`Added ${newPhotos.length} photo${newPhotos.length === 1 ? '' : 's'} to unused pool`)
    // Reset input so selecting the same files again would re-trigger
    if (addMorePhotosInputRef.current) addMorePhotosInputRef.current.value = ''
  }

  const reset = () => {
    // Clear stored photo blobs for this album so storage doesn't leak.
    // Fire-and-forget — don't block the reset.
    if (albumId) clearAlbumBlobs(albumId)
    setStep('setup')
    setSize(null)
    setType(null)
    setPhotos([])
    setSpreads([])
    setUnusedPhotoIds([])
    undoApi.clearStack()
    setPageCount(15)
    setEventFilter('all')
    setAdjusts({})
  }

  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>()
    photos.forEach((p) => m.set(p.id, p))
    return m
  }, [photos])

  // usedPhotoIds and unusedPhotos are now derived from explicit
  // unusedPhotoIds state (maintained via ops) rather than computed
  // from spreads. This is what lets undo/redo move photos in and out
  // of the unused pool cleanly.
  const usedPhotoIds = useMemo(() => new Set(spreads.flatMap((s) => s.photoIds.filter(Boolean))), [spreads])
  const unusedPhotos = useMemo(
    () => {
      const result: Photo[] = []
      for (const id of unusedPhotoIds) {
        const p = photos.find((x) => x.id === id)
        if (p && !p.blurry) result.push(p)
      }
      return result
    },
    [unusedPhotoIds, photos],
  )

  // Hydrate-time backfill: if we restored saved state but unusedPhotoIds
  // is empty (because the persistence format was older or got out of
  // sync), recompute it from photos minus used. Only runs once after
  // hydration.
  useEffect(() => {
    if (!hydrated) return
    if (spreads.length === 0) return
    if (unusedPhotoIds.length > 0) return
    const used = new Set(spreads.flatMap((s) => s.photoIds.filter(Boolean) as string[]))
    const computed = photos.filter((p) => !p.blurry && !used.has(p.id)).map((p) => p.id)
    if (computed.length > 0) setUnusedPhotoIds(computed)
    // Only run once per hydration — empty stays empty after intentional clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // ============== RENDERS ==============

  const renderStepIndicator = () => {
    const stepOrder: Step[] = ['setup', 'guidance', 'upload', 'group', 'tag', 'pages', 'adjust', 'proof', 'submit']
    const stepForIdx = step === 'generate' ? 'adjust' : step
    const idx = Math.max(0, stepOrder.indexOf(stepForIdx))
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, justifyContent: 'center' }}>
        {stepOrder.map((s, i) => (
          <div
            key={s}
            style={{
              width: 24,
              height: 3,
              background: i <= idx ? GOLD : 'rgba(184,150,90,0.2)',
              borderRadius: 2,
            }}
          />
        ))}
      </div>
    )
  }

  const renderSetup = () => (
    <div style={css.container}>
      {renderStepIndicator()}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <span style={css.betaPill}>⚡ Smart Auto-Layout · Beta</span>
        <h1 style={css.title}>
          Choose your <em style={css.titleEm}>album.</em>
        </h1>
        <p style={css.subtitle}>Size and binding shape every layout that follows.</p>
      </div>

      <div style={{ marginBottom: 36 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          Album size
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {(['17x24', '12x24', '20x30', '15x30'] as AlbumSize[]).map((s) => {
            const spec = ALBUM_SPECS[s]
            const isSel = size === s
            return (
              <div
                key={s}
                onClick={() => setSize(s)}
                style={{ ...css.cardSelectable, ...(isSel ? css.cardSelected : {}) }}
              >
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)', marginBottom: 6 }}>
                  {spec.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.7 }}>
                  {spec.desc}
                </p>
                <p style={{ fontSize: 10, color: GOLD, marginTop: 10, letterSpacing: 1 }}>
                  Standard from ${spec.standard.base} · Layflat from ${spec.layflat.base}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginBottom: 36 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          Binding type
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {(['standard', 'layflat'] as AlbumType[]).map((t) => {
            const isSel = type === t
            return (
              <div
                key={t}
                onClick={() => setType(t)}
                style={{ ...css.cardSelectable, ...(isSel ? css.cardSelected : {}) }}
              >
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', marginBottom: 6 }}>
                  {t === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.7 }}>
                  {t === 'standard'
                    ? 'Visible gutter between pages. Photos stay on each page.'
                    : 'No center seam. Photos can span the full spread.'}
                </p>
                {size && (
                  <p style={{ fontSize: 10, color: GOLD, marginTop: 10, letterSpacing: 1 }}>
                    From ${ALBUM_SPECS[size][t].base} · 10 spreads included · ${ALBUM_SPECS[size][t].perExtraSpread}/extra
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <Link href="/design" style={{ ...css.btnSecondary, textDecoration: 'none', display: 'inline-block', textAlign: 'center' }}>
          ← Back
        </Link>
        <button
          type="button"
          style={{ ...css.btnPrimary, opacity: size && type ? 1 : 0.4, cursor: size && type ? 'pointer' : 'not-allowed' }}
          disabled={!size || !type}
          onClick={() => setStep('guidance')}
        >
          Continue →
        </button>
      </div>
    </div>
  )

  const renderGuidance = () => {
    if (!size || !type) return null
    const spec = ALBUM_SPECS[size][type]
    return (
      <div style={{ ...css.container, maxWidth: 720 }}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Before you <em style={css.titleEm}>upload.</em>
        </h2>
        <p style={css.subtitle}>A quick read so the layout fits your story.</p>

        <div style={{ ...css.card, marginBottom: 18 }}>
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 12 }}>
            How many photos to upload
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9, marginBottom: 10 }}>
            Each spread fits up to <strong style={{ color: GOLD }}>5 photos</strong>.
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9 }}>
            Rule of thumb: <strong style={{ color: GOLD }}>photos ÷ 4 ≈ spreads</strong> for a breathable layout.
            <br />
            100 photos → ~25 spreads. 50 photos → ~13 spreads.
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.8, marginTop: 14 }}>
            Hard cap: 100 photos. Less is fine — every photo you upload will be placed in the album.
          </p>
        </div>

        <div style={{ ...css.card, marginBottom: 18 }}>
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 12 }}>
            Album range
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9 }}>
            <strong style={{ color: GOLD }}>{ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard' : 'Layflat'}</strong>
            <br />
            Min {spec.minSpreads} spreads · Max {spec.maxSpreads} spreads · Base ${spec.base} · ${spec.perExtraSpread} per extra spread
          </p>
        </div>

        <div style={css.notice}>
          <strong style={{ color: 'var(--cream)' }}>Heroes</strong> = main photos. They take a full page (half a spread) — paired with 4 smaller photos on the other side.
          <br />
          <strong style={{ color: 'var(--cream)' }}>Favorites</strong> = priority photos. They get prominent placement.
          <br />
          <strong style={{ color: 'var(--cream)' }}>Everything else</strong> still gets placed — heroes/favorites are priority flags, not filters.
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('setup')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('upload')}>
            Got it — let&apos;s upload →
          </button>
        </div>
      </div>
    )
  }

  const renderUpload = () => {
    const pct = Math.round((photos.length / PHOTO_CAP) * 100)
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={css.title}>
            Upload your <em style={css.titleEm}>photos</em>
          </h1>
          <p style={css.subtitle}>
            {photos.length} of {PHOTO_CAP} used · {Math.max(0, PHOTO_CAP - photos.length)} remaining
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'var(--dark2)',
              borderRadius: 4,
              overflow: 'hidden',
              border: '0.5px solid rgba(184,150,90,0.2)',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: pct >= 100 ? '#ff8a8a' : GOLD,
                transition: 'width 0.3s',
              }}
            />
          </div>
          <p style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', marginTop: 6, textAlign: 'right', textTransform: 'uppercase' }}>
            {pct}% capacity
          </p>
        </div>

        {uploadProgress > 0 && uploadProgress < 1 && (
          <div style={{ ...css.notice, marginBottom: 16, borderColor: GOLD }}>
            Uploading… {Math.round(uploadProgress * 100)}%
          </div>
        )}

        <div
          onClick={() => {
            if (photos.length >= PHOTO_CAP) return
            // Surface the rights modal BEFORE the native file picker opens,
            // so the customer can't sneak past it by cancelling the picker.
            if (!ensureContentRights()) return
            fileInputRef.current?.click()
          }}
          style={{
            ...css.uploadZone,
            cursor: photos.length >= PHOTO_CAP ? 'not-allowed' : 'pointer',
            opacity: photos.length >= PHOTO_CAP ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (photos.length < PHOTO_CAP) e.currentTarget.style.borderColor = GOLD
          }}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(184,150,90,0.4)')}
        >
          <IconUpload width={36} height={36} style={{ marginBottom: 12 }} />
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)' }}>
            {photos.length >= PHOTO_CAP ? 'Photo limit reached' : 'Click to select photos'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, marginTop: 8 }}>
            Up to {PHOTO_CAP - photos.length} more
          </p>
        </div>

        <div style={{ textAlign: 'center', margin: '24px 0' }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>or</span>
        </div>

        <button
          type="button"
          onClick={loadSamples}
          style={{ ...css.btnGhost, width: '100%', padding: '14px 20px' }}
        >
          Use sample wedding photos (no upload)
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {photos.length > 0 && (
          <>
            {(() => {
              const lowResCount = photos.filter((p) => Math.min(p.width, p.height) < LOW_RES_PX).length
              if (lowResCount === 0) return null
              return (
                <div
                  style={{
                    marginTop: 24,
                    padding: '10px 14px',
                    background: 'rgba(255,183,77,0.08)',
                    border: '0.5px solid rgba(255,183,77,0.5)',
                    borderRadius: 6,
                    fontSize: 11,
                    color: 'var(--cream)',
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ color: '#ffb74d' }}>{lowResCount} photo{lowResCount === 1 ? '' : 's'} below {LOW_RES_PX}px on the shortest edge.</strong>
                  {' '}These may print soft. You can continue — per clause 2.2 the print quality of low-resolution photos is the customer's responsibility.
                </div>
              )
            })()}
            <div
              style={{
                marginTop: 32,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {photos.map((p) => {
                const lowRes = Math.min(p.width, p.height) < LOW_RES_PX
                return (
                  <div
                    key={p.id}
                    style={{
                      position: 'relative',
                      aspectRatio: '1',
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: lowRes
                        ? '0.5px solid rgba(255,170,80,0.7)'
                        : '0.5px solid rgba(184,150,90,0.2)',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {lowRes && (
                      <span
                        title={`This photo's shortest edge is ${Math.min(p.width, p.height)} px (under ${LOW_RES_PX}). It may print soft. See clause 2.2.`}
                        style={{
                          position: 'absolute',
                          top: 4,
                          left: 4,
                          fontSize: 8,
                          letterSpacing: 1,
                          color: '#1a1108',
                          background: '#ffb74d',
                          padding: '2px 6px',
                          borderRadius: 3,
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          pointerEvents: 'none',
                        }}
                      >
                        Low res
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
              <button type="button" style={css.btnSecondary} onClick={() => setPhotos([])}>
                Clear
              </button>
              <button type="button" style={css.btnPrimary} onClick={() => setStep('group')}>
                Continue →
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderGroup = () => {
    const RECAT_MIME = 'application/x-folio-recat'
    const unassignedCount = photos.filter((p) => p.eventId === 'unassigned').length
    const tagDisplayName = (id: EventId): string =>
      customEventNames[id] ?? EVENTS.find((e) => e.id === id)?.name ?? id

    const togglePhotoSelection = (photoId: string) => {
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev)
        if (next.has(photoId)) next.delete(photoId)
        else next.add(photoId)
        return next
      })
    }
    const clearSelection = () => setSelectedPhotoIds(new Set())
    const moveSelectedTo = (eventId: EventId) => {
      selectedPhotoIds.forEach((id) => {
        setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, eventId } : p)))
      })
      clearSelection()
    }
    // dataTransfer payload for the drag — JSON array of ids so multi-drag works
    const dragPayload = (sourceId: string): string => {
      const ids = selectedPhotoIds.has(sourceId)
        ? Array.from(selectedPhotoIds)
        : [sourceId]
      return JSON.stringify(ids)
    }
    const parseDropPayload = (data: string): string[] => {
      if (!data) return []
      try {
        const parsed = JSON.parse(data)
        return Array.isArray(parsed) ? parsed : [data]
      } catch {
        return [data]
      }
    }

    return (
      <div style={{ ...css.container, maxWidth: 1280 }}>
        {renderStepIndicator()}
        <h2 style={{ ...css.title, marginBottom: 8 }}>
          Group by <em style={css.titleEm}>event</em>
        </h2>
        <p style={{ ...css.subtitle, marginBottom: 18 }}>
          Drag each photo onto its tag. Tagged photos get a label so you can re-assign them anytime.
        </p>

        {/* TAG CARDS — small cards with thumbnail strips inside. 5 cols on desktop.
            - Empty card: just header + dashed drop zone
            - Populated card: header + horizontal scroll strip of thumbnails
            - Drop on the card = move dragged photo(s) into this tag
            - Click thumbnail = toggle selection (same as bottom grid)
            - Double-click tag name = rename. Click chip = move selected. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 8,
            marginBottom: 14,
          }}
        >
          {EVENTS.map((ev) => {
            const inTag = photos.filter((p) => p.eventId === ev.id)
            const count = inTag.length
            const isDropTarget = recatDragOverEvent === ev.id
            const isEditing = editingTagId === ev.id
            const hasSelection = selectedPhotoIds.size > 0
            return (
              <div
                key={ev.id}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(RECAT_MIME)) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (recatDragOverEvent !== ev.id) setRecatDragOverEvent(ev.id)
                  }
                }}
                onDragLeave={() => setRecatDragOverEvent(null)}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(RECAT_MIME)) return
                  e.preventDefault()
                  const ids = parseDropPayload(e.dataTransfer.getData(RECAT_MIME))
                  ids.forEach((id) => recategorize(id, ev.id))
                  if (ids.length > 1) clearSelection()
                  setRecatDragOverEvent(null)
                }}
                onClick={(e) => {
                  if (isEditing) return
                  // If anything is selected, clicking the card = move selection to this tag.
                  // Inner thumbnail clicks stop propagation so they don't trigger this.
                  if (hasSelection) {
                    e.stopPropagation()
                    moveSelectedTo(ev.id)
                  }
                }}
                style={{
                  background: isDropTarget ? 'rgba(184,150,90,0.12)' : 'var(--dark2)',
                  border: `1px solid ${isDropTarget ? GOLD : hasSelection ? 'rgba(184,150,90,0.5)' : 'rgba(184,150,90,0.2)'}`,
                  borderRadius: 8,
                  padding: 8,
                  height: 90,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  transition: 'border-color 0.15s, background 0.15s',
                  cursor: hasSelection ? 'pointer' : 'default',
                }}
                title={hasSelection ? `Click to move ${selectedPhotoIds.size} selected to ${tagDisplayName(ev.id)}` : 'Double-click name to rename'}
              >
                {/* Header: name + count */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      defaultValue={tagDisplayName(ev.id)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim()
                        setCustomEventNames((prev) => {
                          const next = { ...prev }
                          if (v && v !== ev.name) next[ev.id] = v
                          else delete next[ev.id]
                          return next
                        })
                        setEditingTagId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                        if (e.key === 'Escape') {
                          ;(e.currentTarget as HTMLInputElement).value = tagDisplayName(ev.id)
                          setEditingTagId(null)
                        }
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: `0.5px dashed ${GOLD}`,
                        color: 'var(--cream)',
                        fontFamily: 'var(--font-display)',
                        fontSize: 13,
                        outline: 'none',
                        flex: 1,
                        minWidth: 0,
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setEditingTagId(ev.id)
                      }}
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 13,
                        color: 'var(--cream)',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {tagDisplayName(ev.id)}
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 10,
                      letterSpacing: 0.5,
                      background: count > 0 ? GOLD : 'rgba(184,150,90,0.15)',
                      color: count > 0 ? '#0e0c09' : 'var(--muted2)',
                      padding: '2px 8px',
                      borderRadius: 30,
                      minWidth: 22,
                      textAlign: 'center',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {count}
                  </span>
                </div>

                {/* Body: thumbnails OR empty drop zone */}
                {count === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      border: `0.5px dashed ${isDropTarget ? GOLD : 'rgba(184,150,90,0.25)'}`,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 8,
                      letterSpacing: 1.2,
                      color: isDropTarget ? GOLD : 'var(--muted2)',
                      textTransform: 'uppercase',
                    }}
                  >
                    Drop
                  </div>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      gap: 4,
                      overflowX: 'auto',
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(184,150,90,0.4) transparent',
                    }}
                  >
                    {inTag.map((p) => {
                      const isSelected = selectedPhotoIds.has(p.id)
                      return (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation()
                            e.dataTransfer.setData(RECAT_MIME, dragPayload(p.id))
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePhotoSelection(p.id)
                          }}
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 4,
                            overflow: 'hidden',
                            cursor: 'grab',
                            border: isSelected ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.25)',
                            flexShrink: 0,
                            position: 'relative',
                          }}
                          title="Drag to another tag, or click to select"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.preview}
                            alt=""
                            draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* HAND GUIDANCE — animated finger pointing UP at the chips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 18px',
            marginBottom: 18,
            background: 'rgba(184,150,90,0.06)',
            border: `0.5px solid rgba(184,150,90,0.35)`,
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--cream)',
          }}
        >
          <span
            style={{
              fontSize: 24,
              animation: 'handPointUp 1.6s ease-in-out infinite',
              display: 'inline-block',
            }}
            aria-hidden
          >
            👆
          </span>
          <span>
            <strong style={{ color: GOLD }}>Click photos to select multiple</strong>, then drag any one — or click a chip — to move the whole batch.
            {unassignedCount > 0 && (
              <span style={{ color: 'var(--muted2)' }}> · {unassignedCount} untagged</span>
            )}
            {selectedPhotoIds.size > 0 && (
              <span style={{ color: GOLD, marginLeft: 8 }}> · {selectedPhotoIds.size} selected</span>
            )}
          </span>
          <style>{`
            @keyframes handPointUp {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-8px); }
            }
          `}</style>
        </div>

        {/* BIG UNASSIGNED PHOTO GRID — only photos that haven't been tagged yet.
            Once tagged, the photo moves up into its tag card and disappears here. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          {photos.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 60,
                color: 'var(--muted2)',
                fontSize: 12,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              No photos to tag
            </div>
          )}
          {photos.length > 0 && unassignedCount === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 50,
                color: GOLD,
                fontSize: 13,
                letterSpacing: 1,
              }}
            >
              ✓ All photos tagged · Continue to the next step
            </div>
          )}
          {photos
            .filter((p) => p.eventId === 'unassigned')
            .map((p) => {
              const isSelected = selectedPhotoIds.has(p.id)
              return (
                <div key={p.id} style={{ position: 'relative' }}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(RECAT_MIME, dragPayload(p.id))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePhotoSelection(p.id)
                    }}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: 'grab',
                      border: isSelected
                        ? `2px solid ${GOLD}`
                        : '0.5px solid rgba(184,150,90,0.18)',
                      boxShadow: isSelected ? `0 0 0 2px rgba(184,150,90,0.3)` : 'none',
                      transition: 'box-shadow 0.2s',
                    }}
                    title={
                      isSelected
                        ? `${selectedPhotoIds.size} selected — drag any one to a tag, or click a tag card`
                        : 'Click to select, drag onto a tag above'
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.preview}
                      alt=""
                      draggable={false}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                  </div>
                  {/* Selection ✓ badge */}
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: GOLD,
                        color: '#0e0c09',
                        fontSize: 13,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                      aria-hidden
                    >
                      ✓
                    </span>
                  )}
                </div>
              )
            })}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('upload')}>
            ← Back
          </button>
          {selectedPhotoIds.size > 0 && (
            <button type="button" style={css.btnGhost} onClick={clearSelection}>
              Clear selection ({selectedPhotoIds.size})
            </button>
          )}
          <button type="button" style={css.btnPrimary} onClick={() => setStep('tag')}>
            {unassignedCount > 0 ? `Continue (${unassignedCount} untagged) →` : 'Continue →'}
          </button>
        </div>
      </div>
    )
  }

  const renderTag = () => {
    const visible = photos.filter((p) => eventFilter === 'all' || p.eventId === eventFilter)
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Tag your <em style={css.titleEm}>best shots</em>
        </h2>
        <p style={css.subtitle}>
          Heroes get a full page (paired with 4 photos on the other side). Favorites get prominent placement. Everything else still gets placed.
        </p>

        <div style={{ display: 'flex', gap: 24, marginBottom: 18, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--cream)', letterSpacing: 1 }}>
            <IconStar width={14} height={14} /> {heroCount} / {HERO_CAP} Heroes
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--cream)', letterSpacing: 1 }}>
            <IconHeart width={14} height={14} /> {favCount} / {FAV_CAP} Favorites
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {(['all', ...EVENTS.map((e) => e.id)] as Array<EventId | 'all'>).map((id) => {
            const active = eventFilter === id
            const label = id === 'all' ? 'All' : EVENTS.find((e) => e.id === id)?.name ?? id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setEventFilter(id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 30,
                  border: `0.5px solid ${active ? GOLD : 'rgba(184,150,90,0.3)'}`,
                  background: active ? 'rgba(184,150,90,0.15)' : 'transparent',
                  color: active ? GOLD : 'var(--cream)',
                  fontSize: 9,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {visible.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <div
                style={{
                  aspectRatio: '1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border:
                    p.tagged === 'hero'
                      ? `1.5px solid ${GOLD}`
                      : p.tagged === 'favorite'
                      ? '1.5px solid #ff8a8a'
                      : '0.5px solid rgba(184,150,90,0.2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.preview}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: p.blurry ? 'blur(1.2px) brightness(0.85)' : 'none',
                  }}
                />
              </div>
              {p.blurry && (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    background: 'rgba(255,138,138,0.95)',
                    color: '#0e0c09',
                    fontSize: 8,
                    letterSpacing: 1,
                    padding: '3px 7px',
                    borderRadius: 30,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <IconBlur width={10} height={10} /> Blur
                </span>
              )}
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => toggleTag(p.id, 'hero')}
                  title="Mark as hero"
                  style={{
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: '50%',
                    background: p.tagged === 'hero' ? GOLD : 'rgba(0,0,0,0.65)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconStar width={14} height={14} fill={p.tagged === 'hero' ? '#0e0c09' : GOLD} />
                </button>
                <button
                  type="button"
                  onClick={() => toggleTag(p.id, 'favorite')}
                  title="Mark as favorite"
                  style={{
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: '50%',
                    background: p.tagged === 'favorite' ? '#ff8a8a' : 'rgba(0,0,0,0.65)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconHeart width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('group')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('pages')}>
            Continue →
          </button>
        </div>
      </div>
    )
  }

  const renderPages = () => {
    if (!size || !type) return null
    const spec = ALBUM_SPECS[size][type]
    const extraSpreads = Math.max(0, pageCount - spec.minSpreads)
    const extraCost = extraSpreads * spec.perExtraSpread
    return (
      <div style={{ ...css.container, maxWidth: 640 }}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Album <em style={css.titleEm}>length</em>
        </h2>
        <p style={css.subtitle}>
          {usefulPhotoCount} usable photos · we recommend ~{recommendedSpreads} spreads
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
            Spreads ({pageCount * 2} pages)
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: GOLD }}>{pageCount}</span>
        </div>

        <input
          type="range"
          min={spec.minSpreads}
          max={spec.maxSpreads}
          value={pageCount}
          onChange={(e) => setPageCount(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: GOLD, cursor: 'pointer' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', marginTop: 8 }}>
          <span>{spec.minSpreads} spreads</span>
          <span>{spec.maxSpreads} spreads</span>
        </div>

        {pageCount < recommendedSpreads && (
          <div style={{ ...css.notice, marginTop: 18, borderColor: '#ff8a8a' }}>
            ⚠ With {pageCount} spreads, your {usefulPhotoCount} photos will be packed{' '}
            <strong>~{Math.ceil(usefulPhotoCount / pageCount)} per spread</strong>. Consider going up to{' '}
            <strong>{recommendedSpreads}</strong> for a more breathable layout.
          </div>
        )}

        <div style={{ ...css.card, marginTop: 28 }}>
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
            {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard' : 'Layflat'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--cream)', marginBottom: 10 }}>
            <span>Base ({spec.minSpreads} spreads)</span>
            <span>${spec.base}</span>
          </div>
          {extraSpreads > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: GOLD, marginBottom: 10 }}>
              <span>{extraSpreads} extra spreads × ${spec.perExtraSpread}</span>
              <span>+${extraCost}</span>
            </div>
          )}
          <div
            style={{
              borderTop: '0.5px solid rgba(184,150,90,0.2)',
              paddingTop: 14,
              marginTop: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>Total</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: GOLD }}>${albumPrice}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('tag')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={runGenerate}>
            Generate Layout →
          </button>
        </div>
      </div>
    )
  }

  const renderGenerate = () => (
    <div style={{ ...css.container, maxWidth: 520, textAlign: 'center', paddingTop: 80 }}>
      <div
        style={{
          width: 60,
          height: 60,
          margin: '0 auto 24px',
          borderRadius: '50%',
          border: `2px solid ${GOLD}`,
          borderTopColor: 'transparent',
          animation: 'spin 1s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <h2 style={css.title}>
        Composing your <em style={css.titleEm}>album</em>
      </h2>
      <p style={css.subtitle}>
        {generating
          ? `Placing ${heroCount} hero${heroCount === 1 ? '' : 'es'} · ${favCount} favorites · fitting ${pageCount} spreads…`
          : 'Done.'}
      </p>
    </div>
  )

  const renderAdjust = () => {
    if (!size || !type) return null
    return (
      <div style={css.containerWide}>
        {renderStepIndicator()}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 8,
          }}
        >
          <h2 style={{ ...css.title, marginBottom: 0 }}>
            Review &amp; <em style={css.titleEm}>adjust</em>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UndoButtons
              canUndo={undoApi.canUndo}
              canRedo={undoApi.canRedo}
              nextUndoLabel={undoApi.nextUndoLabel}
              nextRedoLabel={undoApi.nextRedoLabel}
              onUndo={undoApi.undo}
              onRedo={undoApi.redo}
            />
            <button type="button" style={css.btnGhost} onClick={regenerate}>
              ↻ Regenerate
            </button>
          </div>
        </div>
        <p style={css.subtitle}>
          {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard (with gutter)' : 'Layflat (flush)'} · click a photo for tools ·
          drag photos between slots to swap · drag from Unused onto a spread to add a photo · use the count pill to grow / shrink ·
          Cmd+Z to undo.
        </p>

        {swapSlot && (
          <div style={{ ...css.notice, marginBottom: 20, borderColor: GOLD }}>
            <strong style={{ color: GOLD }}>Pick a replacement</strong> — click an unused photo on the right, or{' '}
            <button
              type="button"
              onClick={() => setSwapSlot(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: GOLD,
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              cancel
            </button>
          </div>
        )}

        {/* Hide the fixed page-rail when the viewport is too narrow to
            have free left-margin (it would overlap the content). */}
        <style>{`@media (max-width: 1180px){.ff-spread-rail{display:none !important}}`}</style>
        <SpreadNavRail
          spreads={spreads}
          previewFor={(id) => photos.find((p) => p.id === id)?.preview}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 24 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            {spreads.map((s, i) => (
              <SpreadView
                key={s.id}
                spread={s}
                index={i}
                isDragging={draggingSpreadIdx === i}
                isDropTarget={dropTargetIdx === i && draggingSpreadIdx !== null && draggingSpreadIdx !== i}
                onDragStart={onSpreadDragStart(i)}
                onDragOver={onSpreadDragOver(i)}
                onDrop={onSpreadDrop(i)}
                onDragEnd={onSpreadDragEnd}
                slotDragHandlers={slotDrag.slotHandlers}
                spreadDropHandlers={slotDrag.spreadDropHandlers}
                onPhotoCountChange={(n) => handlePhotoCountChange(s.id, n)}
                onEmptySlotClick={(slotIdx) => setEmptySlotPicker({ spreadId: s.id, slotIdx })}
                photoMap={photoMap}
                albumSize={size}
                albumType={type}
                adjusts={adjusts}
                bg={spreadBgs[s.id] ?? DEFAULT_SPREAD_BG}
                onBgChange={(next) =>
                  setSpreadBgs((prev) => ({ ...prev, [s.id]: next }))
                }
                photoListForBg={photos}
                onPhotoClick={(idx) => {
                  // Tap-to-place: a picked-up unused photo drops into the
                  // tapped slot. Works on touch where drag-drop can't.
                  if (pickedUnusedId) {
                    const targetHasPhoto = Boolean(s.photoIds[idx])
                    if (targetHasPhoto) {
                      // Filled slot → swap (old photo returns to unused),
                      // recorded on the undo stack.
                      const opState = {
                        spreads: spreads as unknown as OpSpread[],
                        unusedPhotoIds,
                      }
                      undoApi.record(
                        makeSwapWithUnusedOp(opState, s.id, idx, pickedUnusedId),
                      )
                    } else {
                      // Empty slot → makeSwapWithUnusedOp has nothing to
                      // swap out and no-ops. Use the proven fill path.
                      fillEmptySlot(s.id, idx, pickedUnusedId)
                    }
                    setPickedUnusedId(null)
                    setEditSlot({ spreadId: s.id, idx })
                    return
                  }
                  // Swap mode: clicking ANOTHER slot performs the swap.
                  // Clicking the SAME slot (the armed one) cancels the swap.
                  if (swapSlot) {
                    if (swapSlot.spreadId === s.id && swapSlot.idx === idx) {
                      // Same slot tapped twice — cancel
                      setSwapSlot(null)
                    } else {
                      // Different slot — perform cross-slot swap via op
                      const opState = {
                        spreads: spreads as unknown as OpSpread[],
                        unusedPhotoIds,
                      }
                      if (swapSlot.spreadId === s.id) {
                        undoApi.record(makeSwapOp(opState, s.id, swapSlot.idx, idx))
                      } else {
                        undoApi.record(
                          makeCrossSwapOp(opState, swapSlot.spreadId, swapSlot.idx, s.id, idx),
                        )
                      }
                      setSwapSlot(null)
                      setEditSlot({ spreadId: s.id, idx })
                    }
                    return
                  }
                  // Normal click — open the toolbar (or close if same slot already open)
                  setEditSlot(
                    editSlot && editSlot.spreadId === s.id && editSlot.idx === idx
                      ? null
                      : { spreadId: s.id, idx },
                  )
                }}
                editingSlot={editSlot && editSlot.spreadId === s.id ? editSlot.idx : -1}
                swappingSlot={swapSlot && swapSlot.spreadId === s.id ? swapSlot.idx : -1}
                onStartSwap={(idx) => {
                  // Toggle swap mode but KEEP the toolbar visible so the
                  // user keeps access to zoom/flip/etc.
                  if (swapSlot && swapSlot.spreadId === s.id && swapSlot.idx === idx) {
                    setSwapSlot(null)
                  } else {
                    setSwapSlot({ spreadId: s.id, idx })
                    setEditSlot({ spreadId: s.id, idx })
                  }
                }}
                onResetAdjust={(idx) => {
                  setAdjusts((prev) => {
                    const next = { ...prev }
                    delete next[adjustKey(s.id, idx)]
                    return next
                  })
                }}
                onRemovePhoto={(idx) => {
                  // Photo returns to the unused pool. Records a Remove op
                  // so it goes on the undo stack.
                  const newIds = [...s.photoIds]
                  newIds.splice(idx, 1)
                  if (newIds.length === 0) {
                    // Don't allow removing the last photo on a spread
                    showToast('Spread must have at least 1 photo')
                    return
                  }
                  const newTplId = pickFitTemplate(s.templateId, newIds.length, type)
                  undoApi.record(
                    makeRemoveOp(
                      { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
                      s.id,
                      idx,
                      newTplId,
                      newIds,
                    ),
                  )
                  setAdjusts((prev) => {
                    const next = { ...prev }
                    delete next[adjustKey(s.id, idx)]
                    return next
                  })
                  setEditSlot(null)
                  setSwapSlot(null)
                }}
                onAdjustChange={(idx, patch) => updateAdjust(adjustKey(s.id, idx), patch)}
                onPickTemplate={(tplId) => swapTemplate(s.id, tplId)}
                placementArmed={!!pickedUnusedId}
              />
            ))}
          </div>

          <aside style={{ position: 'sticky', top: 20, alignSelf: 'start' }}>
            <div style={{ ...css.card, marginBottom: 16 }}>
              <p style={{ fontSize: 10, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 8 }}>
                Used in album
              </p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--cream)' }}>
                {usedPhotoIds.size}{' '}
                <span style={{ fontSize: 14, color: 'var(--muted2)' }}>/ {usefulPhotoCount}</span>
              </p>
            </div>

            <div style={css.card}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 10,
                  gap: 8,
                }}
              >
                <p
                  style={{
                    fontSize: 10,
                    letterSpacing: 2,
                    color: unusedPhotos.length > 0 ? '#ff8a8a' : 'var(--muted2)',
                    textTransform: 'uppercase',
                  }}
                >
                  Unused ({unusedPhotos.length})
                </p>
                <button
                  type="button"
                  onClick={() => addMorePhotosInputRef.current?.click()}
                  disabled={photos.length >= PHOTO_CAP}
                  title={
                    photos.length >= PHOTO_CAP
                      ? `Photo limit reached (${PHOTO_CAP})`
                      : `Add more photos to the album (${PHOTO_CAP - photos.length} slots left)`
                  }
                  style={{
                    background: 'transparent',
                    border: `0.5px solid ${photos.length >= PHOTO_CAP ? 'rgba(184,150,90,0.2)' : GOLD}`,
                    color: photos.length >= PHOTO_CAP ? 'var(--muted2)' : GOLD,
                    fontSize: 9,
                    letterSpacing: 1.5,
                    padding: '5px 10px',
                    borderRadius: 30,
                    cursor: photos.length >= PHOTO_CAP ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-body)',
                    textTransform: 'uppercase',
                  }}
                >
                  + Add photos
                </button>
              </div>
              <input
                ref={addMorePhotosInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onAddMorePhotos}
                style={{ display: 'none' }}
              />
              {unusedPhotos.length === 0 ? (
                <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7 }}>
                  All your photos are placed. Click <strong style={{ color: GOLD }}>+ Add photos</strong> above to upload more.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7, marginBottom: 12 }}>
                    {swapSlot
                      ? 'Click one to drop into the selected slot.'
                      : pickedUnusedId
                      ? 'Now tap any photo in a spread to place it there. Tap this photo again to cancel.'
                      : 'Tap a photo, then tap a slot to place it. (On a mouse you can also drag it onto a slot, or onto a spread for +1.)'}
                  </p>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
                      gap: 4,
                      maxHeight: 360,
                      overflowY: 'auto',
                    }}
                  >
                    {unusedPhotos.map((p) => (
                      <div
                        key={p.id}
                        draggable
                        onDragStart={slotDrag.unusedHandlers(p.id).onDragStart}
                        onDragEnd={slotDrag.unusedHandlers(p.id).onDragEnd}
                        onPointerDown={(e) => beginPointerDrag(e, p.id, p.preview)}
                        onClick={() => {
                          // If a pointer-drag just happened, swallow the
                          // click so we don't also toggle pick-up state.
                          if (pointerDragRef.current?.suppressClick) {
                            pointerDragRef.current = null
                            return
                          }
                          // Legacy path: a slot's swap button is armed →
                          // this click fills it (unchanged behaviour).
                          if (swapSlot) {
                            swapPhoto(p.id)
                            return
                          }
                          // Tap-to-place: toggle "picked up" state. Tapping
                          // the same photo again puts it back down.
                          setPickedUnusedId((prev) => (prev === p.id ? null : p.id))
                        }}
                        style={{
                          aspectRatio: '1',
                          borderRadius: 4,
                          overflow: 'hidden',
                          cursor: 'grab',
                          touchAction: 'none',
                          border:
                            pickedUnusedId === p.id
                              ? `2px solid ${GOLD}`
                              : '0.5px solid rgba(184,150,90,0.2)',
                          boxShadow:
                            pickedUnusedId === p.id
                              ? `0 0 0 2px rgba(184,150,90,0.35)`
                              : 'none',
                          opacity: pickedUnusedId && pickedUnusedId !== p.id ? 0.5 : 1,
                          transition: 'opacity 0.15s, border-color 0.15s',
                        }}
                        title={
                          swapSlot
                            ? 'Click to use as replacement, or drag to a slot'
                            : pickedUnusedId === p.id
                            ? 'Picked up — tap a slot to place it, or tap here to cancel'
                            : 'Tap to pick up, then tap a slot. Or drag onto a slot/spread.'
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.preview}
                          alt=""
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>

        {/* Add spread button — appends a fresh empty spread + bumps pageCount.
            Live price preview shows the per-spread surcharge. */}
        {size && type && (() => {
          const spec = ALBUM_SPECS[size][type]
          const atMax = pageCount >= spec.maxSpreads
          return (
            <div
              style={{
                marginTop: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={handleAddSpread}
                disabled={atMax}
                style={{
                  background: atMax ? 'transparent' : 'rgba(184,150,90,0.08)',
                  border: `0.5px dashed ${atMax ? 'rgba(184,150,90,0.3)' : GOLD}`,
                  color: atMax ? 'var(--muted2)' : GOLD,
                  padding: '14px 32px',
                  borderRadius: 30,
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600,
                  cursor: atMax ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
                title={atMax ? `Max ${spec.maxSpreads} spreads reached` : 'Append an empty spread to the album'}
              >
                {atMax
                  ? `Max spreads reached (${spec.maxSpreads})`
                  : `+ Add new spread · +$${spec.perExtraSpread}`}
              </button>
              {!atMax && (
                <span style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1 }}>
                  Currently {pageCount} of {spec.maxSpreads} spreads · ${albumPrice} total
                </span>
              )}
            </div>
          )
        })()}

        <div
          style={{
            ...css.card,
            background: 'linear-gradient(135deg, rgba(184,150,90,0.08), rgba(184,150,90,0.02))',
            borderColor: 'rgba(184,150,90,0.3)',
            marginTop: 32,
            marginBottom: 32,
          }}
        >
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', marginBottom: 6 }}>
            Want our team to <em style={{ color: GOLD, fontStyle: 'italic' }}>polish it?</em>
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.8, marginBottom: 14 }}>
            For an extra <strong style={{ color: GOLD }}>$99</strong>, our designers fine-tune crops, refine spread pacing,
            and balance the visual flow. Proof in 24 hours.
          </p>
          <button
            type="button"
            onClick={() => setPolishHandoff((v) => !v)}
            style={{
              ...css.btnSecondary,
              padding: '11px 24px',
              background: polishHandoff ? GOLD : 'transparent',
              color: polishHandoff ? '#0e0c09' : GOLD,
              borderColor: GOLD,
            }}
            title={polishHandoff ? 'Click to remove the polish add-on' : 'Click to add the $99 polish service to your order'}
          >
            {polishHandoff ? '✓ $99 · Hand-off added' : '+ $99 · Hand off to design team'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('pages')}>
            ← Back
          </button>
          <button
            type="button"
            style={css.btnPrimary}
            onClick={() => {
              // Proof review (clause 2.3) is required before the order can
              // be submitted. We always send the customer through the proof
              // step — even if they've been here before — so any edits since
              // the last review must be re-acknowledged.
              setReviewedSpreadIds(new Set())
              setProofApproval(null)
              setStep('proof')
            }}
          >
            Review proof & submit · ${albumPrice + (polishHandoff ? 99 : 0)} →
          </button>
        </div>

        {/* Customer info + Submit modal */}
        {submitModalOpen && size && type && (
          <div
            onClick={() => {
              if (submitting.stage !== 'uploading' && submitting.stage !== 'persisting') {
                setSubmitModalOpen(false)
              }
            }}
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              zIndex: 10000,
              padding: 24,
              overflowY: 'auto',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--dark2)',
                border: `0.5px solid ${GOLD}`,
                borderRadius: 12,
                padding: 32,
                maxWidth: 540,
                width: '100%',
                marginTop: 40,
                marginBottom: 40,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)', margin: 0 }}>
                  Shipping &amp; <em style={{ color: GOLD, fontStyle: 'italic' }}>contact</em>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (submitting.stage === 'uploading' || submitting.stage === 'persisting') return
                    setSubmitModalOpen(false)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cream)',
                    fontSize: 24,
                    cursor: 'pointer',
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Order summary */}
              <div
                style={{
                  background: 'rgba(184,150,90,0.06)',
                  border: '0.5px solid rgba(184,150,90,0.2)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  marginBottom: 20,
                  fontSize: 11,
                  color: 'var(--cream)',
                  lineHeight: 1.8,
                }}
              >
                {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard' : 'Layflat'} · {pageCount} spreads · {photos.length} photos
                <br />
                <strong style={{ color: GOLD, fontSize: 14 }}>
                  Total: ${albumPrice + (polishHandoff ? 99 : 0)}
                  {polishHandoff && (
                    <span style={{ fontSize: 10, color: 'var(--muted2)', fontWeight: 400 }}> (incl. $99 polish hand-off)</span>
                  )}
                </strong>
              </div>

              {/* Form fields */}
              {(() => {
                const inputStyle: React.CSSProperties = {
                  width: '100%',
                  background: 'var(--dark3)',
                  border: '0.5px solid rgba(184,150,90,0.25)',
                  borderRadius: 4,
                  padding: '10px 12px',
                  color: 'var(--cream)',
                  fontSize: 12,
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                }
                const labelStyle: React.CSSProperties = {
                  display: 'block',
                  fontSize: 9,
                  letterSpacing: 2,
                  color: GOLD,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                  marginTop: 10,
                }
                const setField = (field: keyof typeof customerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setCustomerForm((prev) => ({ ...prev, [field]: e.target.value }))
                const busy = submitting.stage === 'uploading' || submitting.stage === 'persisting'
                return (
                  <>
                    <label style={labelStyle}>Full name *</label>
                    <input
                      style={inputStyle}
                      value={customerForm.name}
                      onChange={setField('name')}
                      disabled={busy}
                      placeholder="Sarah Khan"
                    />
                    <label style={labelStyle}>Email *</label>
                    <input
                      style={inputStyle}
                      value={customerForm.email}
                      onChange={setField('email')}
                      disabled={busy}
                      type="email"
                      placeholder="you@email.com"
                    />
                    <label style={labelStyle}>Phone</label>
                    <input
                      style={inputStyle}
                      value={customerForm.phone}
                      onChange={setField('phone')}
                      disabled={busy}
                      placeholder="+1 555 000 0000"
                    />
                    <label style={labelStyle}>Address line 1 *</label>
                    <input
                      style={inputStyle}
                      value={customerForm.line1}
                      onChange={setField('line1')}
                      disabled={busy}
                      placeholder="123 Main St"
                    />
                    <label style={labelStyle}>Address line 2</label>
                    <input
                      style={inputStyle}
                      value={customerForm.line2}
                      onChange={setField('line2')}
                      disabled={busy}
                      placeholder="Apt / Suite (optional)"
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 10 }}>
                      <div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>City *</label>
                        <input style={inputStyle} value={customerForm.city} onChange={setField('city')} disabled={busy} />
                      </div>
                      <div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>State</label>
                        <input style={inputStyle} value={customerForm.region} onChange={setField('region')} disabled={busy} />
                      </div>
                      <div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>Postal *</label>
                        <input style={inputStyle} value={customerForm.postalCode} onChange={setField('postalCode')} disabled={busy} />
                      </div>
                    </div>
                    <label style={labelStyle}>Country</label>
                    <input style={inputStyle} value={customerForm.country} onChange={setField('country')} disabled={busy} />
                    <label style={labelStyle}>Delivery notes (optional)</label>
                    <textarea
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 60, fontFamily: 'var(--font-body)' }}
                      value={customerForm.notes}
                      onChange={setField('notes')}
                      disabled={busy}
                      placeholder="e.g. Leave at door / Apartment buzzer code"
                    />
                  </>
                )
              })()}

              {/* Progress / error / submit */}
              {submitting.stage === 'uploading' && (
                <div style={{ marginTop: 20 }}>
                  <div
                    style={{
                      width: '100%',
                      height: 8,
                      background: 'var(--dark3)',
                      borderRadius: 4,
                      overflow: 'hidden',
                      border: '0.5px solid rgba(184,150,90,0.2)',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((submitting.done / Math.max(1, submitting.total)) * 100)}%`,
                        height: '100%',
                        background: GOLD,
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 10, letterSpacing: 1, color: 'var(--muted2)', marginTop: 6, textAlign: 'center' }}>
                    {submitting.label}
                  </p>
                </div>
              )}
              {submitting.stage === 'persisting' && (
                <p style={{ fontSize: 11, color: GOLD, textAlign: 'center', marginTop: 16 }}>
                  Photos uploaded · saving your order…
                </p>
              )}
              {submitting.stage === 'error' && submitting.error && (
                <div
                  style={{
                    marginTop: 16,
                    padding: '10px 12px',
                    background: 'rgba(255,138,138,0.1)',
                    border: '0.5px solid rgba(255,138,138,0.4)',
                    borderRadius: 6,
                    fontSize: 11,
                    color: '#ff8a8a',
                  }}
                >
                  {submitting.error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                <button
                  type="button"
                  style={{ ...css.btnSecondary, opacity: submitting.stage === 'uploading' || submitting.stage === 'persisting' ? 0.4 : 1 }}
                  disabled={submitting.stage === 'uploading' || submitting.stage === 'persisting'}
                  onClick={() => setSubmitModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ ...css.btnPrimary, opacity: submitting.stage === 'uploading' || submitting.stage === 'persisting' ? 0.6 : 1 }}
                  disabled={submitting.stage === 'uploading' || submitting.stage === 'persisting'}
                  onClick={runFinalSubmit}
                >
                  {submitting.stage === 'uploading' || submitting.stage === 'persisting'
                    ? 'Submitting…'
                    : `Continue to secure payment · $${albumPrice + (polishHandoff ? 99 : 0)} →`}
                </button>
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7, marginTop: 14 }}>
                Photo upload takes ~1 second per photo. You&apos;ll be redirected to Square to enter card details — your order is held under your email and confirmed by email once payment lands. Please don&apos;t close this tab while uploading.
              </p>
            </div>
          </div>
        )}

        {/* Empty-slot picker modal — opens when user clicks "+ Add" on an empty slot */}
        {emptySlotPicker && (
          <div
            onClick={() => setEmptySlotPicker(null)}
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              padding: 24,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--dark2)',
                border: `0.5px solid ${GOLD}`,
                borderRadius: 12,
                padding: 24,
                maxWidth: 720,
                width: '100%',
                maxHeight: '80vh',
                overflow: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', margin: 0 }}>
                  Add a photo
                </h3>
                <button
                  type="button"
                  onClick={() => setEmptySlotPicker(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cream)',
                    fontSize: 24,
                    cursor: 'pointer',
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Upload from computer */}
              <button
                type="button"
                onClick={() => emptySlotFileInputRef.current?.click()}
                style={{
                  ...css.btnSecondary,
                  width: '100%',
                  marginBottom: 16,
                }}
              >
                ↑ Upload from computer
              </button>
              <input
                ref={emptySlotFileInputRef}
                type="file"
                accept="image/*"
                onChange={onEmptySlotUpload}
                style={{ display: 'none' }}
              />

              {/* Pick from unused */}
              <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 10 }}>
                Or pick from unused ({unusedPhotos.length})
              </p>
              {unusedPhotos.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.7, padding: '20px 0', textAlign: 'center' }}>
                  No unused photos right now. Upload a new one above, or shrink another spread to free some up.
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: 6,
                  }}
                >
                  {unusedPhotos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => fillEmptySlot(emptySlotPicker.spreadId, emptySlotPicker.slotIdx, p.id)}
                      style={{
                        aspectRatio: '1',
                        padding: 0,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: '0.5px solid rgba(184,150,90,0.25)',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.preview}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────
  //  PROOF APPROVAL STEP (clause 2.3)
  //
  //  This is the legal checkpoint. The customer scrolls every spread,
  //  ticks "Reviewed" on each, then clicks the final approve button.
  //  Once approved, the order locks (no further edits, no cancellations
  //  except for manufacturing defects per clause 2.9).
  //
  //  Audit record captured here is sent to the server with the
  //  submission and stored in KV at `proof_approval:{orderId}`.
  // ─────────────────────────────────────────────────────────────────────
  const renderProof = () => {
    if (!size || !type) return null
    const aspect = ALBUM_SPECS[size].spreadAspectRatio
    const showGutter = type === 'standard'
    const photoMap = new Map(photos.map((p) => [p.id, p]))
    const allReviewed = spreads.length > 0 && spreads.every((s) => reviewedSpreadIds.has(s.id))

    const toggleReview = (id: string) => {
      setReviewedSpreadIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    const markAll = () => setReviewedSpreadIds(new Set(spreads.map((s) => s.id)))

    const onApprove = () => {
      if (!allReviewed) return
      const approval = {
        acceptedAt: new Date().toISOString(),
        clauseVersion: LEGAL_VERSION,
        clauseText: CLAUSE_PROOF_APPROVAL,
        reviewedSpreadIds: spreads.map((s) => s.id),
      }
      setProofApproval(approval)
      // The shipping modal's JSX lives inside renderAdjust(), so we
      // navigate BACK to the adjust step before opening it. Without this,
      // the modal markup is never mounted (step='proof' doesn't render
      // renderAdjust's JSX) and the click silently fails.
      // TODO: move the shipping modal to the root render so it works
      // independently of which step is active.
      setStep('adjust')
      setSubmitting({ stage: 'idle', done: 0, total: 0, label: '' })
      setSubmitModalOpen(true)
    }

    return (
      <div style={{ ...css.container, maxWidth: 720 }}>
        {renderStepIndicator()}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1 style={css.title}>
            Review your <em style={css.titleEm}>proof</em>
          </h1>
          <p style={css.subtitle}>
            This is your final chance to catch anything before we print. Tick each spread once you've reviewed it.
          </p>
        </div>

        {/* Clause 2.3 banner — visible before, during, and after review */}
        <div
          style={{
            background: 'rgba(184,150,90,0.08)',
            border: `0.5px solid ${GOLD}`,
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 24,
            fontSize: 11,
            lineHeight: 1.75,
            color: 'var(--cream)',
            whiteSpace: 'pre-wrap',
          }}
        >
          <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 10 }}>
            Clause 2.3 — Proof Approval [attorney review pending]
          </strong>
          <div style={{ marginTop: 8 }}>{CLAUSE_PROOF_APPROVAL}</div>
        </div>

        {/* Reviewed counter + mark-all helper */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            fontSize: 11,
            color: 'var(--cream)',
            letterSpacing: 1,
          }}
        >
          <span>
            <strong style={{ color: allReviewed ? GOLD : 'var(--cream)' }}>
              {reviewedSpreadIds.size}
            </strong>{' '}
            of {spreads.length} spreads reviewed
          </span>
          <button
            type="button"
            onClick={markAll}
            style={{
              background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.4)',
              color: 'var(--cream)',
              padding: '6px 12px',
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Mark all reviewed
          </button>
        </div>

        {/* Spread list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {spreads.map((s, idx) => {
            const tpl = TEMPLATE_BY_ID.get(s.templateId)
            if (!tpl) return null
            const reviewed = reviewedSpreadIds.has(s.id)
            const eventName = s.eventId === 'unassigned'
              ? 'Untagged'
              : customEventNames[s.eventId] ?? EVENTS.find((e) => e.id === s.eventId)?.name ?? ''
            return (
              <div
                key={s.id}
                style={{
                  background: 'var(--dark2)',
                  border: `0.5px solid ${reviewed ? GOLD : 'rgba(184,150,90,0.2)'}`,
                  borderRadius: 10,
                  padding: 14,
                  transition: 'border-color 0.2s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
                    Spread {idx + 1} of {spreads.length} · {eventName}
                  </span>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 11,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                      color: reviewed ? GOLD : 'var(--cream)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={() => toggleReview(s.id)}
                      style={{ accentColor: GOLD, width: 16, height: 16, cursor: 'pointer' }}
                    />
                    {reviewed ? 'Reviewed ✓' : 'I reviewed this spread'}
                  </label>
                </div>

                {/* Mini read-only preview of the spread */}
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: `${aspect}`,
                    background: bgFillColor(spreadBgs[s.id]),
                    overflow: 'hidden',
                    borderRadius: 6,
                  }}
                >
                  {(() => {
                    const pbg = spreadBgs[s.id]
                    if (!pbg || pbg.mode !== 'photo' || !pbg.photoId) return null
                    const bgP = photos.find((p) => p.id === pbg.photoId)
                    if (!bgP) return null
                    const z = Math.min(BG_PHOTO_MAX_ZOOM, Math.max(1, pbg.zoom ?? 1))
                    return (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={bgP.preview}
                          alt=""
                          aria-hidden
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            objectPosition: `${pbg.panX ?? 50}% ${pbg.panY ?? 50}%`,
                            transform: `scale(${z})`,
                            filter: `blur(${pbg.blur ?? 18}px)`,
                            pointerEvents: 'none',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: `rgba(0,0,0,${pbg.dim ?? 0.25})`,
                            pointerEvents: 'none',
                          }}
                        />
                      </>
                    )
                  })()}
                  {tpl.slots.map((slot, i) => {
                    const photoId = s.photoIds[i]
                    const photo = photoId ? photoMap.get(photoId) : undefined
                    const adj = adjusts[adjustKey(s.id, i)] ?? DEFAULT_ADJUST
                    const slotAdjust: SlotAdjust = {
                      panX: adj.panX,
                      panY: adj.panY,
                      zoom: adj.zoom,
                      rotate: adj.rotate,
                      flipH: adj.flipH,
                      flipV: adj.flipV,
                    }
                    return (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          left: `${slot.x}%`,
                          top: `${slot.y}%`,
                          width: `${slot.w}%`,
                          height: `${slot.h}%`,
                          overflow: 'hidden',
                          background: '#f5f0e8',
                        }}
                      >
                        {photo && (
                          <SlotImage src={photo.preview} adjust={slotAdjust} fit={adj.fit} />
                        )}
                        {photo && adj.borderWidth > 0 && (
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute',
                              inset: 0,
                              border: `${(adj.borderWidth / 10) * 6}px solid ${adj.borderColor}`,
                              boxSizing: 'border-box',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                  {/* Gutter line for standard hardcover */}
                  {showGutter && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: '50%',
                        width: 1,
                        background: 'rgba(0,0,0,0.18)',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer: back to edit + approve & continue */}
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--dark)',
            paddingTop: 18,
            paddingBottom: 18,
            marginTop: 24,
            borderTop: '0.5px solid rgba(184,150,90,0.2)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            style={css.btnSecondary}
            onClick={() => {
              // Going back to edit clears the review checks — any subsequent
              // edit invalidates the previous review per clause 2.3.
              setReviewedSpreadIds(new Set())
              setStep('adjust')
            }}
          >
            ← Back to edit
          </button>
          <button
            type="button"
            disabled={!allReviewed}
            onClick={onApprove}
            style={{
              ...css.btnPrimary,
              opacity: allReviewed ? 1 : 0.4,
              cursor: allReviewed ? 'pointer' : 'not-allowed',
            }}
            title={allReviewed ? 'Approve and continue to shipping' : 'Tick every spread first'}
          >
            ✓ I Approve This Proof for Printing →
          </button>
        </div>

        <p style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 10, lineHeight: 1.7, textAlign: 'center' }}>
          By clicking the button above you accept clause 2.3 in full. Your acceptance is timestamped and stored with your order.
        </p>
      </div>
    )
  }

  // Note: under the Stripe Checkout flow the wizard's "Place order" button
  // redirects out of this tab to Stripe, and the post-payment landing is
  // the standalone /design/smart/success page. This in-app submit step is
  // kept as a fallback for the rare case where the redirect to Stripe
  // fails (network drop between submit-smart-order and stripe-checkout)
  // and we still need to give the customer a visible "we have your order
  // — check email" state.
  const renderSubmit = () => (
    <div style={{ ...css.container, maxWidth: 560, textAlign: 'center', paddingTop: 40 }}>
      {renderStepIndicator()}
      <div
        style={{
          width: 80,
          height: 80,
          margin: '0 auto 28px',
          border: '0.5px solid rgba(184,150,90,0.4)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconCheck width={40} height={40} />
      </div>

      <h2 style={css.title}>
        Order <em style={css.titleEm}>placed.</em>
      </h2>
      <p style={css.subtitle}>
        Order #{submittedOrderId ?? orderId} · ${albumPrice + (polishHandoff ? 99 : 0)}
        <br />
        <span style={{ fontSize: 11, color: 'var(--muted2)' }}>
          We&apos;ll email {customerForm.email || 'you'} once payment is confirmed.
        </span>
      </p>

      <div style={{ ...css.card, textAlign: 'left', marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          What happens next
        </p>
        <ol style={{ paddingLeft: 18, lineHeight: 2, fontSize: 12, color: 'var(--cream)' }}>
          <li>Complete payment on Stripe (you&apos;ll be redirected back)</li>
          <li>Our design team reviews crops &amp; pacing (24 h)</li>
          <li>Printing &amp; binding begins (5–7 business days)</li>
          <li>We ship to the address on file with tracking</li>
        </ol>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={{ ...css.btnSecondary }} onClick={reset}>
          Start New
        </button>
        <Link
          href="/"
          style={{ ...css.btnPrimary, textDecoration: 'none', display: 'inline-block', textAlign: 'center', flex: 'unset' }}
        >
          Back to Home
        </Link>
      </div>
    </div>
  )

  useEffect(() => {
    if (!recatId && !layoutMenuId) return
    const onClick = () => {
      setRecatId(null)
      setLayoutMenuId(null)
    }
    const t = setTimeout(() => document.addEventListener('click', onClick), 100)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
    }
  }, [recatId, layoutMenuId])

  return (
    <div style={css.page}>
      <nav style={css.nav}>
        <Link href="/" style={css.logo}>
          Folio &amp; Forever
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {albumName && (
            <button
              type="button"
              onClick={renameAlbum}
              title="Click to rename this album"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--cream)',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                cursor: 'pointer',
                fontStyle: 'italic',
                padding: 0,
                borderBottom: '0.5px dashed rgba(184,150,90,0.4)',
              }}
            >
              {albumName} ✎
            </button>
          )}
          <Link href="/design" style={css.navBack}>
            ← Back to Design
          </Link>
        </div>
      </nav>

      {step === 'setup' && renderSetup()}
      {step === 'guidance' && renderGuidance()}
      {step === 'upload' && renderUpload()}
      {step === 'group' && renderGroup()}
      {step === 'tag' && renderTag()}
      {step === 'pages' && renderPages()}
      {step === 'generate' && renderGenerate()}
      {step === 'adjust' && renderAdjust()}
      {step === 'proof' && renderProof()}
      {step === 'submit' && renderSubmit()}

      {/* Phase 2 — Content rights modal (clauses 2.2 + 2.4).
          Shown the first time photos enter the album, gated above any
          upload path (file picker, samples, drag-and-drop). */}
      {contentRightsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setContentRightsModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 24,
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--dark2)',
              border: `0.5px solid ${GOLD}`,
              borderRadius: 12,
              padding: 28,
              maxWidth: 580,
              width: '100%',
              marginTop: 40,
              marginBottom: 40,
            }}
          >
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--cream)', margin: 0, marginBottom: 8 }}>
              Before you upload <em style={{ color: GOLD, fontStyle: 'italic' }}>photos</em>
            </h3>
            <p style={{ fontSize: 11, color: 'var(--muted2)', margin: 0, marginBottom: 16, lineHeight: 1.7 }}>
              Please confirm two things. These protect both you and us, and your
              acknowledgement is timestamped and stored with the order.
            </p>

            {/* Copyright clause */}
            <div
              style={{
                background: 'rgba(184,150,90,0.06)',
                border: '0.5px solid rgba(184,150,90,0.25)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 14,
                fontSize: 11,
                lineHeight: 1.7,
                color: 'var(--cream)',
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 9 }}>
                Clause 2.4 — Copyright [attorney review pending]
              </strong>
              <div style={{ marginTop: 6 }}>{CLAUSE_CONTENT_RIGHTS}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 11, lineHeight: 1.6, color: 'var(--cream)', marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={crCopyrightOk}
                onChange={(e) => setCrCopyrightOk(e.target.checked)}
                style={{ accentColor: GOLD, width: 16, height: 16, marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
              />
              <span>
                I own these photos, or I have permission from the photographer or rights-holder to use them in this album.
              </span>
            </label>

            {/* Content policy clause */}
            <div
              style={{
                background: 'rgba(184,150,90,0.06)',
                border: '0.5px solid rgba(184,150,90,0.25)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 14,
                fontSize: 11,
                lineHeight: 1.7,
                color: 'var(--cream)',
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 9 }}>
                Clause 2.2 — Content quality &amp; policy [attorney review pending]
              </strong>
              <div style={{ marginTop: 6 }}>{CLAUSE_CONTENT_POLICY}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 11, lineHeight: 1.6, color: 'var(--cream)', marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={crPolicyOk}
                onChange={(e) => setCrPolicyOk(e.target.checked)}
                style={{ accentColor: GOLD, width: 16, height: 16, marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
              />
              <span>
                My photos meet the content policy. I understand low-resolution photos (under {LOW_RES_PX} px on the shortest edge) may print soft and I accept that result.
              </span>
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                style={css.btnSecondary}
                onClick={() => setContentRightsModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!crCopyrightOk || !crPolicyOk}
                style={{
                  ...css.btnPrimary,
                  opacity: crCopyrightOk && crPolicyOk ? 1 : 0.4,
                  cursor: crCopyrightOk && crPolicyOk ? 'pointer' : 'not-allowed',
                }}
                onClick={() => {
                  if (!(crCopyrightOk && crPolicyOk)) return
                  const record = {
                    acceptedAt: new Date().toISOString(),
                    clauseVersion: LEGAL_VERSION,
                    copyrightClause: CLAUSE_CONTENT_RIGHTS,
                    policyClause: CLAUSE_CONTENT_POLICY,
                  }
                  setContentRights(record)
                  setContentRightsModalOpen(false)
                  if (albumId) {
                    try {
                      window.localStorage.setItem(
                        `folio-content-rights:${albumId}`,
                        JSON.stringify(record),
                      )
                    } catch {
                      /* ignore quota / private mode */
                    }
                  }
                }}
              >
                Accept &amp; continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating ghost for the universal pointer-drag (mouse + touch). */}
      {dragGhost && (
        <img
          src={dragGhost.preview}
          alt=""
          aria-hidden
          style={{
            position: 'fixed',
            left: dragGhost.x,
            top: dragGhost.y,
            width: 96,
            height: 96,
            objectFit: 'cover',
            transform: 'translate(-50%, -50%) rotate(-3deg)',
            borderRadius: 6,
            border: `2px solid ${GOLD}`,
            boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
            zIndex: 99999,
            opacity: 0.92,
          }}
        />
      )}

      {/* Toast for op announcements (undo/redo/etc.) */}
      {Toast}
    </div>
  )
}

// ============== HELPERS ==============

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = URL.createObjectURL(file)
  })
}

// ============== SPREAD RENDER ==============

/**
 * LayoutThumb (Part C + D) — a mini visual diagram of a template's slots,
 * drawn proportionally to the album's spread aspect ratio. Hovering
 * enlarges it (scale + raised z-index + shadow) so the arrangement is
 * easy to read on a small screen before picking.
 */
function LayoutThumb({
  tpl,
  aspect,
  active,
  onClick,
}: {
  tpl: LayoutTemplate
  aspect: number
  active: boolean
  onClick: () => void
}) {
  const W = 56
  const H = Math.max(28, Math.round(W / aspect))
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`${tpl.name}${active ? ' (current)' : ''}`}
      style={{
        position: 'relative',
        width: W,
        height: H,
        padding: 0,
        background: '#0e0c09',
        border: active ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.3)',
        borderRadius: 3,
        cursor: 'pointer',
        flexShrink: 0,
        // Grow DOWNWARD into the open spread area on hover — growing up
        // gets clipped by the card's top edge / rounded corner.
        transformOrigin: 'center top',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(2.4)'
        e.currentTarget.style.zIndex = '50'
        e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.7)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.zIndex = '1'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {tpl.slots.map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.w}%`,
            height: `${s.h}%`,
            background: s.isHero ? 'rgba(184,150,90,0.6)' : 'rgba(184,150,90,0.28)',
            border: '0.5px solid rgba(184,150,90,0.55)',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </button>
  )
}

/**
 * SpreadNavRail — fixed left-edge page navigator. One mini card per
 * spread (number + first-photo thumbnail). Click jumps straight to that
 * spread instead of scrolling. Auto-hides on narrow screens where the
 * left margin would overlap the content.
 */
function SpreadNavRail({
  spreads,
  previewFor,
}: {
  spreads: Spread[]
  previewFor: (photoId: string) => string | undefined
}) {
  if (spreads.length < 2) return null
  return (
    <nav
      aria-label="Spread navigator"
      className="ff-spread-rail"
      style={{
        position: 'fixed',
        left: 8,
        top: 110,
        bottom: 24,
        width: 76,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 6px',
        background: 'rgba(20,16,12,0.6)',
        border: '0.5px solid rgba(184,150,90,0.2)',
        borderRadius: 10,
        zIndex: 40,
      }}
    >
      {spreads.map((s, i) => {
        const firstId = s.photoIds.find((id): id is string => Boolean(id))
        const prev = firstId ? previewFor(firstId) : undefined
        return (
          <button
            key={s.id}
            type="button"
            title={`Jump to spread ${i + 1}`}
            onClick={() => {
              document
                .getElementById(`ff-spread-${s.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: 4,
              background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.25)',
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = GOLD)}
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = 'rgba(184,150,90,0.25)')
            }
          >
            <div
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                borderRadius: 3,
                overflow: 'hidden',
                background: '#1a1410',
              }}
            >
              {prev ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={prev}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : null}
            </div>
            <span
              style={{
                fontSize: 9,
                letterSpacing: 1,
                color: 'var(--muted2)',
                fontFamily: 'var(--font-body)',
              }}
            >
              {i + 1}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/**
 * SpreadBgControl — per-spread background picker in the header.
 * Modes: Paper · Colour swatches · Photo (blurred, dimmed, zoom ≤200%).
 */
function SpreadBgControl({
  bg,
  onChange,
  spreadPhotos,
}: {
  bg: SpreadBg
  onChange: (next: SpreadBg) => void
  spreadPhotos: Photo[]
}) {
  const [open, setOpen] = useState(false)
  const swatch =
    bg.mode === 'paper'
      ? PAPER_HEX
      : bg.mode === 'color'
      ? bg.color || BG_PALETTE[0].hex
      : '#b8965a'
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        title="Spread background"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: '0.5px solid rgba(184,150,90,0.3)',
          borderRadius: 30,
          padding: '4px 10px',
          cursor: 'pointer',
          color: GOLD,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            background: bg.mode === 'photo' ? 'linear-gradient(135deg,#b8965a,#3a342c)' : swatch,
            border: '0.5px solid rgba(184,150,90,0.5)',
            display: 'inline-block',
          }}
        />
        BG
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            background: 'var(--dark3)',
            border: `0.5px solid ${GOLD}`,
            borderRadius: 8,
            padding: 12,
            width: 230,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          }}
        >
          <p style={{ fontSize: 9, letterSpacing: 1.5, color: 'var(--muted2)', textTransform: 'uppercase', margin: '0 0 8px' }}>
            Spread background
          </p>

          {/* Paper + colour swatches */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => onChange({ mode: 'paper' })}
              title="Paper (white)"
              style={{
                width: 26, height: 26, borderRadius: 4, cursor: 'pointer',
                background: PAPER_HEX,
                border: bg.mode === 'paper' ? `2px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.4)',
              }}
            />
            {BG_PALETTE.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => onChange({ mode: 'color', color: c.hex })}
                style={{
                  width: 26, height: 26, borderRadius: 4, cursor: 'pointer',
                  background: c.hex,
                  border:
                    bg.mode === 'color' && bg.color === c.hex
                      ? `2px solid ${GOLD}`
                      : '0.5px solid rgba(184,150,90,0.4)',
                }}
              />
            ))}
          </div>

          {/* Photo background */}
          <p style={{ fontSize: 9, letterSpacing: 1.5, color: 'var(--muted2)', textTransform: 'uppercase', margin: '0 0 6px' }}>
            Or a blurred photo
          </p>
          {spreadPhotos.length === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--muted2)', margin: 0 }}>
              Add photos to this spread to use one as a background.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {spreadPhotos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      mode: 'photo',
                      photoId: p.id,
                      blur: bg.blur ?? 18,
                      dim: bg.dim ?? 0.25,
                      zoom: Math.min(BG_PHOTO_MAX_ZOOM, bg.zoom ?? 1),
                      panX: bg.panX ?? 50,
                      panY: bg.panY ?? 50,
                    })
                  }
                  style={{
                    width: 34, height: 34, borderRadius: 4, overflow: 'hidden', padding: 0,
                    cursor: 'pointer',
                    border:
                      bg.mode === 'photo' && bg.photoId === p.id
                        ? `2px solid ${GOLD}`
                        : '0.5px solid rgba(184,150,90,0.4)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}

          {bg.mode === 'photo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Blur {bg.blur ?? 18}px
                <input
                  type="range" min={0} max={40} step={1}
                  value={bg.blur ?? 18}
                  onChange={(e) => onChange({ ...bg, blur: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: GOLD }}
                />
              </label>
              <label style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Darken {Math.round((bg.dim ?? 0.25) * 100)}%
                <input
                  type="range" min={0} max={70} step={5}
                  value={Math.round((bg.dim ?? 0.25) * 100)}
                  onChange={(e) => onChange({ ...bg, dim: Number(e.target.value) / 100 })}
                  style={{ width: '100%', accentColor: GOLD }}
                />
              </label>
              <label style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Zoom {Math.round((bg.zoom ?? 1) * 100)}% (max 200%)
                <input
                  type="range" min={100} max={200} step={5}
                  value={Math.round((bg.zoom ?? 1) * 100)}
                  onChange={(e) =>
                    onChange({ ...bg, zoom: Math.min(BG_PHOTO_MAX_ZOOM, Number(e.target.value) / 100) })
                  }
                  style={{ width: '100%', accentColor: GOLD }}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              marginTop: 10, width: '100%', background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.3)', color: GOLD,
              borderRadius: 4, padding: '5px 0', fontSize: 10, cursor: 'pointer',
              letterSpacing: 1.5, textTransform: 'uppercase',
            }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}

type SlotDragHandlers = ReturnType<typeof useSlotDrag>['slotHandlers']
type SpreadDropHandlers = ReturnType<typeof useSlotDrag>['spreadDropHandlers']

function SpreadView({
  spread,
  index,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  slotDragHandlers,
  spreadDropHandlers,
  onPhotoCountChange,
  onEmptySlotClick,
  photoMap,
  albumSize,
  albumType,
  adjusts,
  bg,
  onBgChange,
  photoListForBg,
  onPhotoClick,
  editingSlot,
  swappingSlot,
  onStartSwap,
  onResetAdjust,
  onRemovePhoto,
  onAdjustChange,
  onPickTemplate,
  placementArmed,
}: {
  spread: Spread
  index: number
  isDragging: boolean
  isDropTarget: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  slotDragHandlers: SlotDragHandlers
  spreadDropHandlers: SpreadDropHandlers
  onPhotoCountChange: (n: number) => void
  onEmptySlotClick: (slotIdx: number) => void
  photoMap: Map<string, Photo>
  albumSize: AlbumSize
  albumType: AlbumType
  adjusts: Record<string, PhotoAdjust>
  bg: SpreadBg
  onBgChange: (next: SpreadBg) => void
  photoListForBg: Photo[]
  onPhotoClick: (idx: number) => void
  editingSlot: number
  swappingSlot: number
  onStartSwap: (idx: number) => void
  onResetAdjust: (idx: number) => void
  onRemovePhoto: (idx: number) => void
  onAdjustChange: (idx: number, patch: Partial<PhotoAdjust>) => void
  onPickTemplate: (tplId: string) => void
  /** True when an unused photo is "picked up" (tap-to-place). When set,
   *  tapping an empty slot PLACES the picked photo instead of opening
   *  the upload/pick picker. */
  placementArmed: boolean
}) {
  // Layout-picker family tab. Hook MUST be before any early return
  // (rules of hooks). Defaults to the family of the current template.
  const [pickerFamily, setPickerFamily] = useState<LayoutFamily>(
    TEMPLATE_BY_ID.get(spread.templateId)?.id.startsWith('mat-') ? 'mat' : 'bleed',
  )
  const tpl = TEMPLATE_BY_ID.get(spread.templateId)
  if (!tpl) return null

  const eventName = spread.eventId === 'unassigned'
    ? 'Untagged'
    : EVENTS.find((e) => e.id === spread.eventId)?.name ?? ''
  const aspect = ALBUM_SPECS[albumSize].spreadAspectRatio
  const showGutter = albumType === 'standard'

  return (
    <div
      id={`ff-spread-${spread.id}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        position: 'relative',
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s',
        scrollMarginTop: 80,
      }}
    >
      {/* Drop indicator (gold line above the spread when this is the drop target) */}
      {isDropTarget && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            left: 0,
            right: 0,
            height: 3,
            background: GOLD,
            borderRadius: 2,
            pointerEvents: 'none',
            boxShadow: `0 0 8px ${GOLD}`,
          }}
        />
      )}

    <div
      style={{
        background: 'var(--dark2)',
        border: '0.5px solid rgba(184,150,90,0.2)',
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder this spread"
          style={{
            fontSize: 9,
            letterSpacing: 2,
            color: 'var(--muted2)',
            textTransform: 'uppercase',
            cursor: 'grab',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            userSelect: 'none',
          }}
          onMouseDown={(e) => (e.currentTarget.style.cursor = 'grabbing')}
          onMouseUp={(e) => (e.currentTarget.style.cursor = 'grab')}
        >
          <span style={{ color: GOLD, fontSize: 11, fontWeight: 700 }}>⋮⋮</span>
          Spread {index + 1} · {ALBUM_SPECS[albumSize].label}
        </span>

        {/* Photo count pill — reflects the LAYOUT'S slot count, not how
            many are filled. Picking a 5-slot layout via the visual
            picker must show "5 photos" (with empties to fill), not "2"
            just because only 2 slots have photos so far. */}
        <PhotoCountDropdown
          current={tpl.slots.length}
          available={[1, 2, 3, 4, 5]}
          onChange={onPhotoCountChange}
        />

        {/* Visual layout picker — Full-bleed vs Background (matted)
            families, best ORIENTATION match first. Hover to enlarge,
            click to apply. */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxWidth: 560,
          }}
        >
          {/* Family toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['bleed', 'mat'] as LayoutFamily[]).map((fam) => {
              const on = pickerFamily === fam
              return (
                <button
                  key={fam}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPickerFamily(fam)
                  }}
                  style={{
                    background: on ? GOLD : 'transparent',
                    color: on ? '#0e0c09' : GOLD,
                    border: `0.5px solid ${on ? GOLD : 'rgba(184,150,90,0.35)'}`,
                    borderRadius: 30,
                    padding: '3px 12px',
                    fontSize: 9,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {fam === 'bleed' ? 'Full bleed' : 'Matted'}
                </button>
              )
            })}
          </div>
          <div
            title="Tap a layout to apply · hover to enlarge"
            style={{
              display: 'flex',
              gap: 5,
              alignItems: 'center',
              flexWrap: 'wrap',
              // overflow stays visible so the hover-zoom isn't clipped.
              overflow: 'visible',
              padding: '12px 2px',
            }}
          >
            {(() => {
              const spreadPhotosForScore = spread.photoIds
                .filter((id): id is string => Boolean(id))
                .map((id) => photoMap.get(id))
                .filter((p): p is Photo => Boolean(p))
              const all = templatesForCount(spread.photoIds.length, albumType).filter(
                (t) => templateFamily(t) === pickerFamily,
              )
              const scored = all
                .map((t) => ({
                  t,
                  s: spreadPhotosForScore.length
                    ? scoreTemplateForPhotos(t, spreadPhotosForScore, aspect)
                    : 0,
                }))
                .sort((a, b) => b.s - a.s)
              const ordered = scored.map((x) => x.t).slice(0, 14)
              if (ordered.length === 0) {
                return (
                  <span style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    No {pickerFamily === 'bleed' ? 'full-bleed' : 'matted'} layouts for {spread.photoIds.length} photos
                  </span>
                )
              }
              return ordered.map((t) => (
                <LayoutThumb
                  key={t.id}
                  tpl={t}
                  aspect={aspect}
                  active={t.id === spread.templateId}
                  onClick={() => onPickTemplate(t.id)}
                />
              ))
            })()}
          </div>
        </div>
        <SpreadBgControl
          bg={bg}
          onChange={onBgChange}
          spreadPhotos={spread.photoIds
            .filter((id): id is string => Boolean(id))
            .map((id) => photoListForBg.find((p) => p.id === id))
            .filter((p): p is Photo => Boolean(p))}
        />
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>{eventName}</span>
      </div>

      <div
        // Spread-level drop target. HTML5 drop here = +1 layout (legacy).
        // The universal pointer-drag hit-tests data-ff-bgzone: dropping
        // a photo on the empty/matted area sets it as the blurred bg.
        data-ff-bgzone
        data-ff-bgspread={spread.id}
        onDragOver={spreadDropHandlers(spread.id).onDragOver}
        onDrop={spreadDropHandlers(spread.id).onDrop}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${aspect}`,
          background: bgFillColor(bg), // paper / chosen colour
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Blurred-photo background layer (Phase 2). Sits behind slots,
            blurred + dimmed; zoom hard-capped at 200% per owner. */}
        {bg.mode === 'photo' && bg.photoId && (() => {
          const bgPhoto = photoListForBg.find((p) => p.id === bg.photoId)
          if (!bgPhoto) return null
          const z = Math.min(BG_PHOTO_MAX_ZOOM, Math.max(1, bg.zoom ?? 1))
          return (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgPhoto.preview}
                alt=""
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${bg.panX ?? 50}% ${bg.panY ?? 50}%`,
                  transform: `scale(${z})`,
                  filter: `blur(${bg.blur ?? 18}px)`,
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `rgba(0,0,0,${bg.dim ?? 0.25})`,
                  pointerEvents: 'none',
                }}
              />
            </>
          )
        })()}
        {tpl.slots.map((slot, i) => {
          const id = spread.photoIds[i]
          const photo = id ? photoMap.get(id) : undefined
          const editing = editingSlot === i
          const adj = adjusts[adjustKey(spread.id, i)] ?? DEFAULT_ADJUST
          const slotAdjust: SlotAdjust = {
            panX: adj.panX,
            panY: adj.panY,
            zoom: adj.zoom,
            rotate: adj.rotate,
            flipH: adj.flipH,
            flipV: adj.flipV,
          }
          // Slot-level DnD: each slot is BOTH draggable (drag a photo
          // to another slot to swap) AND a drop target (drop a slot
          // photo or unused thumbnail here to swap).
          // Only photo-bearing slots are draggable — empty slots can
          // still receive drops but you can't drag from them.
          const slotDH = slotDragHandlers(spread.id, i)
          return (
            <div
              key={i}
              data-ff-spread={spread.id}
              data-ff-slot={i}
              onClick={(e) => {
                e.stopPropagation()
                onPhotoClick(i)
              }}
              draggable={!!photo}
              onDragStart={photo ? slotDH.onDragStart : undefined}
              onDragOver={slotDH.onDragOver}
              onDrop={(e) => {
                slotDH.onDrop(e)
                // Stop the spread-level drop from also firing
                e.stopPropagation()
              }}
              onDragEnd={slotDH.onDragEnd}
              style={{
                position: 'absolute',
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                width: `${slot.w}%`,
                height: `${slot.h}%`,
                cursor: photo ? 'grab' : 'pointer',
                outline: editing ? `2px solid ${GOLD}` : 'none',
                outlineOffset: -2,
                overflow: 'hidden',
                background: '#f5f0e8',
              }}
              title={slot.isHero ? 'Hero photo · drag to swap' : 'Photo · drag to swap'}
            >
              {photo ? (
                <>
                  <SlotImage
                    src={photo.preview}
                    adjust={slotAdjust}
                    fit={adj.fit}
                    // No onAdjustChange → SlotImage's pointer capture is
                    // disabled, leaving HTML5 drag-to-swap unblocked. Pan
                    // and zoom continue to work via the toolbar sliders.
                  />
                  {adj.borderWidth > 0 && (
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        border: `${(adj.borderWidth / 10) * 16}px solid ${adj.borderColor}`,
                        boxSizing: 'border-box',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {slot.isHero && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 4,
                        left: 4,
                        fontSize: 7,
                        letterSpacing: 1.5,
                        color: '#0e0c09',
                        background: GOLD,
                        padding: '2px 6px',
                        borderRadius: 30,
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        pointerEvents: 'none',
                      }}
                    >
                      Hero
                    </span>
                  )}
                </>
              ) : (
                // Empty slot: dashed gold border + "+ Add" hint.
                // Drop targets work the same as filled slots (above).
                // Click → if a photo is "picked up" (tap-to-place), drop
                // it into this empty slot; otherwise open the upload /
                // pick-from-unused picker.
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    if (placementArmed) {
                      onPhotoClick(i)
                    } else {
                      onEmptySlotClick(i)
                    }
                  }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: '#f5f0e8',
                    border: `1.5px dashed rgba(184,150,90,0.5)`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    color: GOLD,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#ede5d3')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#f5f0e8')}
                  title="Click to upload or pick from unused · Or drag a photo here"
                >
                  <span style={{ fontSize: 28, fontWeight: 300, lineHeight: 1 }}>+</span>
                  <span style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
                    Add photo
                  </span>
                </div>
              )}
            </div>
          )
        })}
        {showGutter && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 1,
              background: 'rgba(0,0,0,0.18)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Photo edit toolbar (full set, mirrors manual builder) */}
      {editingSlot >= 0 && (() => {
        const editAdj = adjusts[adjustKey(spread.id, editingSlot)] ?? DEFAULT_ADJUST
        const editPhotoId = spread.photoIds[editingSlot]
        const editPhoto = editPhotoId ? photoMap.get(editPhotoId) : undefined
        const editSlotDef = tpl.slots[editingSlot]
        // Smart cap: how far THIS photo can zoom in THIS slot at THIS
        // album size before dropping under 200 DPI.
        const cap =
          editPhoto && editSlotDef
            ? smartMaxZoom(editPhoto, editSlotDef, albumSize)
            : GLOBAL_MAX_ZOOM
        const cd =
          editPhoto && editSlotDef ? coverDpi(editPhoto, editSlotDef, albumSize) : 0
        const effDpi = cd > 0 ? Math.round(cd / Math.max(1, editAdj.zoom)) : 0
        return (
          <PhotoToolbar
            adj={editAdj}
            onChange={(patch) => onAdjustChange(editingSlot, patch)}
            onSwap={() => onStartSwap(editingSlot)}
            onReset={() => onResetAdjust(editingSlot)}
            onRemove={() => onRemovePhoto(editingSlot)}
            slotIdx={editingSlot}
            inSwapMode={swappingSlot === editingSlot}
            maxZoom={cap}
            effDpi={effDpi}
          />
        )
      })()}
    </div>
    </div>
  )
}

// ============== PHOTO TOOLBAR ==============
// Mirrors the manual builder's photoFloatToolbar: zoom, pan, fit-fill /
// fit-original, flip H/V, rotate ±90°, reset, swap, remove.

function PhotoToolbar({
  adj,
  onChange,
  onSwap,
  onReset,
  onRemove,
  slotIdx,
  inSwapMode,
  maxZoom,
  effDpi,
}: {
  adj: PhotoAdjust
  onChange: (patch: Partial<PhotoAdjust>) => void
  onSwap: () => void
  onReset: () => void
  onRemove: () => void
  slotIdx: number
  inSwapMode: boolean
  /** Smart per-photo zoom ceiling (keeps ≥200 DPI at this album size). */
  maxZoom: number
  /** Effective print DPI at the current zoom (for the quality badge). */
  effDpi: number
}) {
  // Slider/buttons never let the customer zoom past the smart cap.
  const zCap = Math.max(1, maxZoom)
  const dpiColor = effDpi >= 200 ? '#7fd18f' : effDpi >= 150 ? '#e0b15a' : '#ff8a8a'
  const dpiLabel = effDpi >= 200 ? 'Sharp' : effDpi >= 150 ? 'OK' : 'Soft'
  const btn: React.CSSProperties = {
    background: 'transparent',
    border: '0.5px solid rgba(184,150,90,0.35)',
    color: GOLD,
    fontSize: 10,
    padding: '6px 10px',
    borderRadius: 30,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    letterSpacing: 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }
  const btnActive: React.CSSProperties = { ...btn, background: GOLD, color: '#0e0c09', borderColor: GOLD }
  const btnDanger: React.CSSProperties = { ...btn, color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.45)' }
  const groupLabel: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: 1.5,
    color: 'var(--muted2)',
    textTransform: 'uppercase',
    marginRight: 4,
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 10,
        padding: '14px 16px',
        background: 'var(--dark3)',
        border: `0.5px solid ${inSwapMode ? GOLD : 'rgba(184,150,90,0.25)'}`,
        borderRadius: 8,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>
          Slot {slotIdx + 1} · Photo tools
        </span>

        {/* FIT mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Fit</span>
          <button type="button" style={adj.fit === 'fill' ? btnActive : btn} onClick={() => onChange({ fit: 'fill' })}>
            Fill
          </button>
          <button type="button" style={adj.fit === 'contain' ? btnActive : btn} onClick={() => onChange({ fit: 'contain' })}>
            Original
          </button>
        </div>

        {/* ZOOM — smart-capped so it never pixelates at print */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Zoom</span>
          <button
            type="button"
            style={btn}
            onClick={() => onChange({ zoom: Math.max(1, +(adj.zoom - 0.1).toFixed(2)) })}
          >
            −
          </button>
          <input
            type="range"
            min="100"
            max={Math.round(zCap * 100)}
            step="5"
            value={Math.round(Math.min(adj.zoom, zCap) * 100)}
            onChange={(e) =>
              onChange({ zoom: Math.min(zCap, parseInt(e.target.value) / 100) })
            }
            style={{ width: 100, accentColor: GOLD }}
          />
          <button
            type="button"
            style={btn}
            onClick={() =>
              onChange({ zoom: Math.min(zCap, +(adj.zoom + 0.1).toFixed(2)) })
            }
          >
            +
          </button>
          <span style={{ fontSize: 10, color: GOLD, minWidth: 42, textAlign: 'center' }}>
            {Math.round(adj.zoom * 100)}%
          </span>
          {/* Live print-quality badge + smart cap note */}
          {effDpi > 0 && (
            <span
              title={`Effective ${effDpi} DPI at this zoom. Zoom is auto-limited to ${Math.round(
                zCap * 100,
              )}% so this photo stays at least 200 DPI at this album size.`}
              style={{
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: dpiColor,
                border: `0.5px solid ${dpiColor}`,
                borderRadius: 30,
                padding: '2px 8px',
              }}
            >
              {effDpi} DPI · {dpiLabel}
            </span>
          )}
          {zCap < GLOBAL_MAX_ZOOM && (
            <span style={{ fontSize: 9, color: 'var(--muted2)' }}>
              max {Math.round(zCap * 100)}%
            </span>
          )}
        </div>

        {/* FLIP */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Flip</span>
          <button
            type="button"
            style={adj.flipH ? btnActive : btn}
            title="Flip horizontal"
            onClick={() => onChange({ flipH: !adj.flipH })}
          >
            ⇄
          </button>
          <button
            type="button"
            style={adj.flipV ? btnActive : btn}
            title="Flip vertical"
            onClick={() => onChange({ flipV: !adj.flipV })}
          >
            ⇅
          </button>
        </div>

        {/* ROTATE — buttons handle the big 90° jumps; slider is a fine-
            tune ±15° around the current coarse angle. Splitting like this
            means a small slider drag only tilts a tiny amount (good for
            straightening a horizon) instead of rotating dramatically. */}
        {(() => {
          const total = adj.rotate ?? 0
          // Nearest 90° "coarse" component; remainder is the fine tilt.
          const coarse = Math.round(total / 90) * 90
          const fine = total - coarse
          const displayTotal = (((Math.round(total) % 360) + 540) % 360) - 180
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={groupLabel}>Rotate</span>
              <button
                type="button"
                style={btn}
                title="Rotate left 90°"
                onClick={() => onChange({ rotate: total - 90 })}
              >
                ↺
              </button>
              <button
                type="button"
                style={btn}
                title="Rotate right 90°"
                onClick={() => onChange({ rotate: total + 90 })}
              >
                ↻
              </button>
              <span style={{ fontSize: 9, color: 'var(--muted2)', marginLeft: 4 }}>fine</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={1}
                value={Math.round(Math.max(-15, Math.min(15, fine)))}
                onChange={(e) => onChange({ rotate: coarse + parseInt(e.target.value) })}
                title="Fine tilt — ±15°"
                style={{ width: 90, accentColor: GOLD }}
              />
              <button
                type="button"
                style={btn}
                title="Reset to 0°"
                onClick={() => onChange({ rotate: 0 })}
              >
                0°
              </button>
              <span style={{ fontSize: 10, color: GOLD, minWidth: 38, textAlign: 'right' }}>
                {displayTotal}°
              </span>
            </div>
          )
        })()}

        {/* BORDER — photo frame: thickness 0-10 + colour */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Border</span>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={adj.borderWidth ?? 0}
            onChange={(e) => onChange({ borderWidth: parseInt(e.target.value) })}
            style={{ width: 84, accentColor: GOLD }}
          />
          <span style={{ fontSize: 10, color: GOLD, minWidth: 22, textAlign: 'center' }}>
            {adj.borderWidth ?? 0}
          </span>
          <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
            {BORDER_PALETTE.map((c) => {
              const on = (adj.borderColor ?? '#ffffff') === c.hex
              return (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() =>
                    onChange({
                      borderColor: c.hex,
                      // turning a colour on with no thickness yet → give it one
                      borderWidth: (adj.borderWidth ?? 0) === 0 ? 4 : adj.borderWidth,
                    })
                  }
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background: c.hex,
                    cursor: 'pointer',
                    border: on ? `2px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.4)',
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* PAN sliders (only meaningful when fit=fill).
          Sliders are in SCREEN coordinates — "X" always moves left/right on
          screen, "Y" always moves up/down. When the image is rotated 90°/180°/
          270°, internally we map screen-X/Y to the image's coordinate axes so
          the pan still matches what the user sees. */}
      {adj.fit === 'fill' && (() => {
        // Snap to nearest 90° step for axis mapping. Fine tilts (e.g. ±15°)
        // map to step 0 — pan stays in image coords, which is close enough to
        // visual coords for small angles.
        const r = ((Math.round(adj.rotate ?? 0) % 360) + 360) % 360
        const step = Math.round(r / 90) % 4
        // imageToScreen: convert stored image-coord pan → what the user sees.
        // screenToImage: convert slider value → image-coord pan to store.
        const inv = (v: number) => 100 - v
        const imageToScreen = (px: number, py: number) => {
          switch (step) {
            case 1: return { sx: inv(py), sy: px }       // 90° CW
            case 2: return { sx: inv(px), sy: inv(py) }  // 180°
            case 3: return { sx: py, sy: inv(px) }       // 270° CW
            default: return { sx: px, sy: py }
          }
        }
        const screenToImage = (sx: number, sy: number) => {
          switch (step) {
            case 1: return { px: sy, py: inv(sx) }
            case 2: return { px: inv(sx), py: inv(sy) }
            case 3: return { px: inv(sy), py: sx }
            default: return { px: sx, py: sy }
          }
        }
        const { sx, sy } = imageToScreen(adj.panX, adj.panY)
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
            <span style={groupLabel}>Pan</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--cream)' }}>X</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(sx)}
                onChange={(e) => {
                  const newSx = parseInt(e.target.value)
                  const { px, py } = screenToImage(newSx, sy)
                  onChange({ panX: px, panY: py })
                }}
                style={{ width: 100, accentColor: GOLD }}
              />
              <span style={{ fontSize: 9, color: 'var(--muted2)', minWidth: 32, textAlign: 'right' }}>
                {Math.round(sx)}%
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--cream)' }}>Y</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(sy)}
                onChange={(e) => {
                  const newSy = parseInt(e.target.value)
                  const { px, py } = screenToImage(sx, newSy)
                  onChange({ panX: px, panY: py })
                }}
                style={{ width: 100, accentColor: GOLD }}
              />
              <span style={{ fontSize: 9, color: 'var(--muted2)', minWidth: 32, textAlign: 'right' }}>
                {Math.round(sy)}%
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--muted2)', fontStyle: 'italic' }}>
              tip: zoom in first to see pan have more effect
            </span>
          </div>
        )
      })()}

      {/* ACTIONS */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 6, borderTop: '0.5px solid rgba(184,150,90,0.15)' }}>
        <button type="button" style={btn} onClick={onReset}>
          ↺ Reset adjustments
        </button>
        <button
          type="button"
          style={inSwapMode ? btnActive : btn}
          onClick={onSwap}
          title="Pick a different photo from the unused pool"
        >
          {inSwapMode ? 'Swap mode active — pick from pool →' : '⇄ Swap photo'}
        </button>
        <button type="button" style={btnDanger} onClick={onRemove} title="Remove from spread (photo returns to unused pool)">
          ✕ Remove
        </button>
      </div>
    </div>
  )
}
