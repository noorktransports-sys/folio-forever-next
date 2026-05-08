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

type AlbumSize = '17x24' | '20x30'
type AlbumType = 'standard' | 'layflat'

type EventId =
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
  | 'submit'

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
  photoIds: string[]
  eventId: EventId
}

type PhotoAdjust = {
  zoom: number
  panX: number
  panY: number
  flipH: boolean
  flipV: boolean
  rotate: 0 | 90 | 180 | 270
  fit: 'fill' | 'contain'
}
const DEFAULT_ADJUST: PhotoAdjust = {
  zoom: 1,
  panX: 50,
  panY: 50,
  flipH: false,
  flipV: false,
  rotate: 0,
  fit: 'fill',
}
const adjustKey = (spreadId: string, slotIdx: number) => `${spreadId}::${slotIdx}`

// ============== ALBUM SPECS ==============

const ALBUM_SPECS: Record<
  AlbumSize,
  Record<AlbumType, { base: number; perExtraSpread: number; minSpreads: number; maxSpreads: number }> & {
    spreadAspectRatio: number
    label: string
  }
> = {
  '17x24': {
    spreadAspectRatio: 24 / 17,
    label: '17×24',
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: 25 },
  },
  '20x30': {
    spreadAspectRatio: 30 / 20,
    label: '20×30',
    standard: { base: 340, perExtraSpread: 12, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 375, perExtraSpread: 15, minSpreads: 10, maxSpreads: 25 },
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

function pickTemplate(
  type: AlbumType,
  count: number,
  needsHero: boolean,
  preferredId?: string,
): LayoutTemplate | null {
  const candidates = TEMPLATES.filter(
    (t) =>
      t.compat.includes(type) &&
      t.slots.length === count &&
      (needsHero ? t.slots.some((s) => s.isHero) : !t.slots.some((s) => s.isHero)),
  )
  if (preferredId) {
    const pref = candidates.find((t) => t.id === preferredId)
    if (pref) return pref
  }
  return candidates[0] ?? null
}

// ============== LAYOUT ENGINE ==============
// Pacing rule: every 3rd spread is a hero spread (positions 2, 5, 8, ...
// 0-indexed within an event). Non-hero spreads default to PAIR (2 photos).
// Density only steps up when math requires it to fit all photos.
// Strict event grouping: each spread contains photos from ONE event.

function generateLayout(photos: Photo[], pageCount: number, type: AlbumType): Spread[] {
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
          const tpl = pickTemplate(type, chunk.length, false) ?? pickTemplate(type, chunk.length, true)
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
        const tpl = pickTemplate(type, total, true, tplId) ?? pickTemplate(type, total, true)
        if (!tpl) {
          // Fall back: put hero into a 2-photo pair as if it were any photo
          const fallback = pickTemplate(type, total, false)
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
        const tpl = pickTemplate(type, chunk.length, false) ?? pickTemplate(type, chunk.length, true)
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
  const placed = new Set(spreads.flatMap((s) => s.photoIds))
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
  const eventMap: EventId[] = [
    'mehndi', 'mehndi', 'mehndi',
    'haldi', 'haldi',
    'prep', 'prep', 'prep', 'prep',
    'nikkah', 'nikkah', 'nikkah',
    'wedding', 'wedding', 'wedding', 'wedding', 'wedding', 'wedding', 'wedding',
    'reception', 'reception', 'reception', 'reception', 'reception',
    'valima', 'valima',
    'other1', 'other1', 'other2', 'other2',
  ]
  const blurryIdxs = new Set([4, 13, 22])
  return eventMap.map((eventId, i) => ({
    id: `sample-${i}`,
    preview: `https://picsum.photos/seed/wedding${i}/1200/800`,
    width: 4000,
    height: 4000,
    tagged: 'none' as const,
    eventId,
    blurry: blurryIdxs.has(i),
  }))
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
  const [swapSlot, setSwapSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  const [editSlot, setEditSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  const [adjusts, setAdjusts] = useState<Record<string, PhotoAdjust>>({})
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
            unusedPhotoIds: string[]
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
          if (Array.isArray(s.unusedPhotoIds)) setUnusedPhotoIds(s.unusedPhotoIds)
        }
      } catch {
        /* ignore corrupt state */
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
        unusedPhotoIds,
      }
      window.localStorage.setItem(`${SMART_STATE_PREFIX}:${albumId}`, JSON.stringify(payload))
      upsertAlbumIndex(albumId, {})
    } catch {
      /* quota exceeded or disabled — silently drop */
    }
  }, [hydrated, albumId, size, type, pageCount, step, photos, spreads, adjusts, unusedPhotoIds])

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

  const loadSamples = useCallback(() => {
    setPhotos(buildSampleWeddingPhotos())
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
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
        eventId: 'other1',
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

  const recategorize = (photoId: string, eventId: EventId) => {
    setPhotos(photos.map((p) => (p.id === photoId ? { ...p, eventId } : p)))
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
    setTimeout(() => {
      installLayout(generateLayout(photos, pageCount, type))
      setGenerating(false)
      setStep('adjust')
    }, 1400)
  }, [photos, pageCount, type, undoApi, installLayout])

  const regenerate = () => {
    if (!type) return
    if (undoApi.canUndo || undoApi.canRedo) {
      const ok = window.confirm('Regenerating will clear your edit history. Continue?')
      if (!ok) return
    }
    undoApi.clearStack()
    installLayout(generateLayout([...photos].sort(() => Math.random() - 0.5), pageCount, type))
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

    let newIds = [...current.photoIds]
    let nextUnused = [...unusedPhotoIds]

    if (newTpl.slots.length < newIds.length) {
      // shrink: surplus photos go to unused
      const surplus = newIds.slice(newTpl.slots.length)
      newIds = newIds.slice(0, newTpl.slots.length)
      nextUnused = [...nextUnused, ...surplus]
    } else if (newTpl.slots.length > newIds.length) {
      // grow: pull from unused
      const need = newTpl.slots.length - newIds.length
      const pulled = nextUnused.slice(0, need)
      nextUnused = nextUnused.slice(need)
      newIds = [...newIds, ...pulled]
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
  const handlePhotoCountChange = useCallback(
    (spreadId: string, newCount: number) => {
      if (!type) return
      const result = buildPhotoCountOp(
        { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
        spreadId,
        newCount,
        { albumType: type, isHeroPhoto, templatesForCount: templatesForCountAdapter },
      )
      if ('op' in result) {
        undoApi.record(result.op)
      } else if (result.error === 'no-unused') {
        showToast('Not enough unused photos to grow this spread')
      } else if (result.error === 'count-unchanged') {
        // silent — same count picked
      } else {
        showToast(`Couldn't change count: ${result.error}`)
      }
    },
    [type, spreads, unusedPhotoIds, isHeroPhoto, templatesForCountAdapter, undoApi, showToast],
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
        eventId: 'other1',
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
    const stepOrder: Step[] = ['setup', 'guidance', 'upload', 'group', 'tag', 'pages', 'adjust', 'submit']
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
          {(['17x24', '20x30'] as AlbumSize[]).map((s) => {
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
                  {s === '17x24' ? 'Coffee-table size · the classic format' : 'Oversized poster · premium hero format'}
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
          onClick={() => photos.length < PHOTO_CAP && fileInputRef.current?.click()}
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
            <div
              style={{
                marginTop: 32,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {photos.map((p) => (
                <div
                  key={p.id}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '0.5px solid rgba(184,150,90,0.2)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
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
    return (
      <div style={{ ...css.container, maxWidth: 1280 }}>
        {renderStepIndicator()}
        <h2 style={{ ...css.title, marginBottom: 8 }}>
          Group by <em style={css.titleEm}>event</em>
        </h2>
        <p style={{ ...css.subtitle, marginBottom: 18 }}>
          Sort each photo into the right tag — Mehndi, Haldi, Wedding, etc.
        </p>

        {/* Animated guide banner — photo slides toward folder, repeats */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 18px',
            marginBottom: 20,
            background: 'rgba(184,150,90,0.06)',
            border: `0.5px solid rgba(184,150,90,0.35)`,
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--cream)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ position: 'relative', width: 56, height: 22, flexShrink: 0 }}>
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: -2,
                fontSize: 18,
                animation: 'recatHint 2.2s ease-in-out infinite',
              }}
              aria-hidden
            >
              🖼️
            </span>
            <span
              style={{ position: 'absolute', right: 0, top: -2, fontSize: 18 }}
              aria-hidden
            >
              📂
            </span>
          </div>
          <span>
            <strong style={{ color: GOLD }}>Drag any photo onto a tag</strong> to recategorize.
            Or click a photo for a quick list.
          </span>
          <style>{`
            @keyframes recatHint {
              0% { transform: translateX(0); opacity: 1; }
              60% { transform: translateX(34px); opacity: 0.2; }
              61% { transform: translateX(0); opacity: 0; }
              100% { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </div>

        {/* 5-column responsive grid — 9 tags fit in 2 rows on a normal desktop.
            Falls back to fewer columns on narrow screens via auto-fill minmax. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 8,
          }}
        >
          {EVENTS.map((ev) => {
            const inEvent = photos.filter((p) => p.eventId === ev.id)
            const isDropTarget = recatDragOverEvent === ev.id
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
                  const photoId = e.dataTransfer.getData(RECAT_MIME)
                  if (photoId) recategorize(photoId, ev.id)
                  setRecatDragOverEvent(null)
                }}
                style={{
                  background: isDropTarget ? 'rgba(184,150,90,0.1)' : 'var(--dark2)',
                  border: `0.5px solid ${isDropTarget ? GOLD : 'rgba(184,150,90,0.18)'}`,
                  borderRadius: 6,
                  padding: 8,
                  transition: 'border-color 0.15s, background 0.15s',
                  // Fixed height so empty cards don't stretch to match a populated one.
                  // Populated cards scroll their thumbnail grid internally.
                  height: 180,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <p
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 6,
                    marginBottom: 6,
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--cream)' }}>
                    {ev.name}
                  </span>
                  <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', flexShrink: 0 }}>
                    {inEvent.length}
                  </span>
                </p>

                {inEvent.length === 0 ? (
                  <div
                    style={{
                      border: `0.5px dashed ${isDropTarget ? GOLD : 'rgba(184,150,90,0.25)'}`,
                      borderRadius: 3,
                      flex: 1,
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
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))',
                      gap: 3,
                      flex: 1,
                      overflowY: 'auto',
                      // Subtle scrollbar styling
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(184,150,90,0.4) transparent',
                    }}
                  >
                    {inEvent.map((p) => (
                      <div key={p.id} style={{ position: 'relative' }}>
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(RECAT_MIME, p.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRecatId(p.id === recatId ? null : p.id)
                          }}
                          style={{
                            aspectRatio: '1',
                            borderRadius: 4,
                            overflow: 'hidden',
                            cursor: 'grab',
                            border: recatId === p.id ? `1.5px solid ${GOLD}` : '0.5px solid transparent',
                          }}
                          title="Drag to a tag, or click for list"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.preview}
                            alt=""
                            draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                          />
                        </div>
                        {recatId === p.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              top: 'calc(100% + 4px)',
                              left: 0,
                              zIndex: 10,
                              background: 'var(--dark3)',
                              border: `0.5px solid ${GOLD}`,
                              borderRadius: 8,
                              padding: 6,
                              minWidth: 140,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                            }}
                          >
                            {EVENTS.filter((e) => e.id !== p.eventId).map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onClick={() => recategorize(p.id, e.id)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '8px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--cream)',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                  borderRadius: 4,
                                  fontFamily: 'var(--font-body)',
                                }}
                                onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(184,150,90,0.15)')}
                                onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                              >
                                Move to {e.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('upload')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('tag')}>
            Continue →
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
                photoMap={photoMap}
                albumSize={size}
                albumType={type}
                adjusts={adjusts}
                onPhotoClick={(idx) => {
                  // Always reveal the toolbar on click. If we were in swap
                  // mode for a different slot, switch the active slot.
                  setEditSlot(
                    editSlot && editSlot.spreadId === s.id && editSlot.idx === idx
                      ? null
                      : { spreadId: s.id, idx },
                  )
                  if (swapSlot && (swapSlot.spreadId !== s.id || swapSlot.idx !== idx)) {
                    setSwapSlot(null)
                  }
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
                layoutMenuOpen={layoutMenuId === s.id}
                onToggleLayoutMenu={() => setLayoutMenuId(layoutMenuId === s.id ? null : s.id)}
                onPickTemplate={(tplId) => swapTemplate(s.id, tplId)}
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
                      : 'Drag a photo onto a slot to swap, or onto a spread for +1 layout.'}
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
                        onClick={() => swapSlot && swapPhoto(p.id)}
                        style={{
                          aspectRatio: '1',
                          borderRadius: 4,
                          overflow: 'hidden',
                          cursor: 'grab',
                          border: '0.5px solid rgba(184,150,90,0.2)',
                        }}
                        title={
                          swapSlot
                            ? 'Click to use as replacement, or drag to a slot'
                            : 'Drag onto a slot to swap, or onto a spread for +1 layout'
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
          <button type="button" style={{ ...css.btnSecondary, padding: '11px 24px' }}>
            + $99 · Hand off to design team
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('pages')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('submit')}>
            Submit Order · ${albumPrice} →
          </button>
        </div>
      </div>
    )
  }

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
        Order <em style={css.titleEm}>received.</em>
      </h2>
      <p style={css.subtitle}>
        Order #{orderId} · ${albumPrice}
      </p>

      <div style={{ ...css.card, textAlign: 'left', marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          What happens next
        </p>
        <ol style={{ paddingLeft: 18, lineHeight: 2, fontSize: 12, color: 'var(--cream)' }}>
          <li>Smart engine arrangement is queued for review</li>
          <li>Design team checks crops &amp; balance (24h)</li>
          <li>You&apos;ll receive a final PDF proof to approve</li>
          <li>After approval, printing &amp; binding begins (5–7 days)</li>
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
      {step === 'submit' && renderSubmit()}

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
  photoMap,
  albumSize,
  albumType,
  adjusts,
  onPhotoClick,
  editingSlot,
  swappingSlot,
  onStartSwap,
  onResetAdjust,
  onRemovePhoto,
  onAdjustChange,
  layoutMenuOpen,
  onToggleLayoutMenu,
  onPickTemplate,
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
  photoMap: Map<string, Photo>
  albumSize: AlbumSize
  albumType: AlbumType
  adjusts: Record<string, PhotoAdjust>
  onPhotoClick: (idx: number) => void
  editingSlot: number
  swappingSlot: number
  onStartSwap: (idx: number) => void
  onResetAdjust: (idx: number) => void
  onRemovePhoto: (idx: number) => void
  onAdjustChange: (idx: number, patch: Partial<PhotoAdjust>) => void
  layoutMenuOpen: boolean
  onToggleLayoutMenu: () => void
  onPickTemplate: (tplId: string) => void
}) {
  const tpl = TEMPLATE_BY_ID.get(spread.templateId)
  if (!tpl) return null

  const eventName = EVENTS.find((e) => e.id === spread.eventId)?.name ?? ''
  const aspect = ALBUM_SPECS[albumSize].spreadAspectRatio
  const showGutter = albumType === 'standard'

  const alternates = templatesForCount(spread.photoIds.length, albumType).filter(
    (t) => t.id !== spread.templateId,
  )

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        position: 'relative',
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s',
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

        {/* Photo count dropdown — change how many photos this spread holds */}
        <PhotoCountDropdown
          current={spread.photoIds.filter(Boolean).length}
          available={[1, 2, 3, 4, 5]}
          onChange={onPhotoCountChange}
        />

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleLayoutMenu()
            }}
            style={{
              background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.3)',
              color: GOLD,
              fontSize: 9,
              letterSpacing: 1,
              padding: '4px 10px',
              borderRadius: 30,
              cursor: alternates.length > 0 ? 'pointer' : 'default',
              opacity: alternates.length > 0 ? 1 : 0.6,
              fontFamily: 'var(--font-body)',
              textTransform: 'uppercase',
            }}
          >
            {tpl.name} {alternates.length > 0 ? '▾' : ''}
          </button>
          {layoutMenuOpen && alternates.length > 0 && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                zIndex: 10,
                background: 'var(--dark3)',
                border: `0.5px solid ${GOLD}`,
                borderRadius: 8,
                padding: 6,
                minWidth: 220,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              <p style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', padding: '6px 10px', textTransform: 'uppercase' }}>
                Switch layout ({alternates.length} options)
              </p>
              {alternates.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => onPickTemplate(alt.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cream)',
                    fontSize: 11,
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontFamily: 'var(--font-body)',
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(184,150,90,0.15)')}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                >
                  {alt.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>{eventName}</span>
      </div>

      <div
        // Spread-level drop target: dropping an unused photo here
        // (NOT on a specific slot) grows the template by 1.
        onDragOver={spreadDropHandlers(spread.id).onDragOver}
        onDrop={spreadDropHandlers(spread.id).onDrop}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${aspect}`,
          background: '#ffffff', // album paper — gaps appear white
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
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
              {photo && (
                <>
                  <SlotImage
                    src={photo.preview}
                    adjust={slotAdjust}
                    fit={adj.fit}
                    onAdjustChange={
                      editing
                        ? (next) => onAdjustChange(i, next as Partial<PhotoAdjust>)
                        : undefined
                    }
                  />
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
      {editingSlot >= 0 && (
        <PhotoToolbar
          adj={adjusts[adjustKey(spread.id, editingSlot)] ?? DEFAULT_ADJUST}
          onChange={(patch) => onAdjustChange(editingSlot, patch)}
          onSwap={() => onStartSwap(editingSlot)}
          onReset={() => onResetAdjust(editingSlot)}
          onRemove={() => onRemovePhoto(editingSlot)}
          slotIdx={editingSlot}
          inSwapMode={swappingSlot === editingSlot}
        />
      )}
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
}: {
  adj: PhotoAdjust
  onChange: (patch: Partial<PhotoAdjust>) => void
  onSwap: () => void
  onReset: () => void
  onRemove: () => void
  slotIdx: number
  inSwapMode: boolean
}) {
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

        {/* ZOOM */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Zoom</span>
          <button type="button" style={btn} onClick={() => onChange({ zoom: Math.max(1, +(adj.zoom - 0.1).toFixed(2)) })}>
            −
          </button>
          <input
            type="range"
            min="100"
            max="500"
            step="5"
            value={Math.round(adj.zoom * 100)}
            onChange={(e) => onChange({ zoom: parseInt(e.target.value) / 100 })}
            style={{ width: 100, accentColor: GOLD }}
          />
          <button type="button" style={btn} onClick={() => onChange({ zoom: Math.min(5, +(adj.zoom + 0.1).toFixed(2)) })}>
            +
          </button>
          <span style={{ fontSize: 10, color: GOLD, minWidth: 42, textAlign: 'center' }}>
            {Math.round(adj.zoom * 100)}%
          </span>
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

        {/* ROTATE */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Rotate</span>
          <button
            type="button"
            style={btn}
            title="Rotate left 90°"
            onClick={() => onChange({ rotate: ((adj.rotate + 270) % 360) as PhotoAdjust['rotate'] })}
          >
            ↺
          </button>
          <button
            type="button"
            style={btn}
            title="Rotate right 90°"
            onClick={() => onChange({ rotate: ((adj.rotate + 90) % 360) as PhotoAdjust['rotate'] })}
          >
            ↻
          </button>
          <span style={{ fontSize: 10, color: GOLD, minWidth: 32 }}>{adj.rotate}°</span>
        </div>
      </div>

      {/* PAN sliders (only meaningful when fit=fill) */}
      {adj.fit === 'fill' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <span style={groupLabel}>Pan</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--cream)' }}>X</span>
            <input
              type="range"
              min="0"
              max="100"
              value={adj.panX}
              onChange={(e) => onChange({ panX: parseInt(e.target.value) })}
              style={{ width: 100, accentColor: GOLD }}
            />
            <span style={{ fontSize: 9, color: 'var(--muted2)', minWidth: 30 }}>{adj.panX}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--cream)' }}>Y</span>
            <input
              type="range"
              min="0"
              max="100"
              value={adj.panY}
              onChange={(e) => onChange({ panY: parseInt(e.target.value) })}
              style={{ width: 100, accentColor: GOLD }}
            />
            <span style={{ fontSize: 9, color: 'var(--muted2)', minWidth: 30 }}>{adj.panY}%</span>
          </div>
        </div>
      )}

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
