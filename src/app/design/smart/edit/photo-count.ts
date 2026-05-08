// src/app/design/smart/edit/photo-count.ts
//
// Two related operations that both touch template + photoIds + unused pool:
//
//   1. User changes the per-spread count dropdown (2 → 4, etc.)
//   2. User drops an unused photo onto a spread (count + 1)
//
// Both need to: pick a new template, reorder photoIds to fit it, and move
// photos between the spread and the unused pool. The op constructors in
// operations.ts only RECORD the diff — picking the template is your engine's
// job. This file is the glue.

import {
  makePhotoCountOp, makeAddOp, makeRemoveOp,
  type Op, type Spread,
} from './operations'

// These types/functions come from your existing engine in page.tsx.
// Adjust the imports to wherever you split them.
interface Template {
  id: string
  slots: { isHero?: boolean }[]
  compat: ('standard' | 'layflat')[]
}

/**
 * Your existing template picker. Doc says it's `templatesForCount(n)` and
 * returns Template[] sorted by preference. Adjust the import path.
 */
type TemplatesForCount = (count: number, opts: {
  type: 'standard' | 'layflat'
  hasHero: boolean
}) => Template[]

interface AlbumStateSlice {
  spreads: Spread[]
  unusedPhotoIds: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const heroSlotIndex = (tpl: Template): number =>
  tpl.slots.findIndex(s => s.isHero) // -1 if none

/**
 * Reorder photoIds for a new template. Hero photo (if any) goes into the
 * new template's hero slot. Non-hero photos fill the rest in order.
 */
function reorderForTemplate(
  newTpl: Template,
  currentPhotoIds: (string | null)[],
  isHeroPhoto: (id: string) => boolean
): (string | null)[] {
  const result: (string | null)[] = new Array(newTpl.slots.length).fill(null)
  const heroIdx = heroSlotIndex(newTpl)
  const heroPhoto = currentPhotoIds.find(id => id && isHeroPhoto(id)) ?? null
  const others = currentPhotoIds.filter(id => id && id !== heroPhoto) as string[]

  if (heroIdx >= 0 && heroPhoto) {
    result[heroIdx] = heroPhoto
  }
  let writeIdx = 0
  for (let i = 0; i < result.length && others.length; i++) {
    if (i === heroIdx) continue
    result[i] = others[writeIdx++] ?? null
  }
  return result
}

// ─── Operation builders ───────────────────────────────────────────────────

/**
 * User changed photo count via dropdown. Returns null if not possible
 * (e.g., increasing count but unused pool is empty).
 *
 * Behavior:
 *   - count up:   pull from unused pool (FIFO).
 *   - count down: displace from end of slot list (prefer non-hero) into unused.
 */
export function buildPhotoCountOp(
  state: AlbumStateSlice,
  spreadId: string,
  newCount: number,
  opts: {
    albumType: 'standard' | 'layflat'
    isHeroPhoto: (id: string) => boolean
    templatesForCount: TemplatesForCount
  }
): { op: Op } | { error: 'no-template' | 'no-unused' | 'no-spread' | 'count-unchanged' } {
  const spread = state.spreads.find(s => s.id === spreadId)
  if (!spread) return { error: 'no-spread' }

  const current = spread.photoIds.filter(Boolean) as string[]
  const currentCount = current.length
  if (currentCount === newCount) return { error: 'count-unchanged' }

  const hasHero = current.some(opts.isHeroPhoto)
  const candidates = opts.templatesForCount(newCount, { type: opts.albumType, hasHero })
  const newTpl = candidates[0]
  if (!newTpl) return { error: 'no-template' }

  let nextPhotoIds = [...current]
  let nextUnused = [...state.unusedPhotoIds]

  if (newCount > currentCount) {
    const need = newCount - currentCount
    if (nextUnused.length < need) return { error: 'no-unused' }
    const pulled = nextUnused.splice(0, need)
    nextPhotoIds = [...nextPhotoIds, ...pulled]
  } else {
    const drop = currentCount - newCount
    // Drop non-hero from the end first
    const keep: string[] = []
    const displaced: string[] = []
    // Walk from end to start so we preserve early ordering
    for (let i = nextPhotoIds.length - 1; i >= 0; i--) {
      const id = nextPhotoIds[i]
      if (displaced.length < drop && !opts.isHeroPhoto(id)) {
        displaced.unshift(id)
      } else {
        keep.unshift(id)
      }
    }
    // If we couldn't drop enough non-heroes, fall back to dropping anything
    while (displaced.length < drop && keep.length > newCount) {
      displaced.push(keep.pop()!)
    }
    nextPhotoIds = keep
    nextUnused = [...nextUnused, ...displaced]
  }

  const newSlotIds = reorderForTemplate(newTpl, nextPhotoIds, opts.isHeroPhoto)
  const op = makePhotoCountOp(state, spreadId, newTpl.id, newSlotIds, nextUnused)
  return { op }
}

/**
 * User dropped an unused photo onto a spread → grow template by 1.
 * Returns error if the spread is already at the largest available template.
 */
export function buildAddOp(
  state: AlbumStateSlice,
  spreadId: string,
  unusedPhotoId: string,
  opts: {
    albumType: 'standard' | 'layflat'
    isHeroPhoto: (id: string) => boolean
    templatesForCount: TemplatesForCount
    maxPhotosPerSpread?: number // default 5
  }
): { op: Op } | { error: 'at-capacity' | 'no-template' | 'no-spread' | 'photo-not-unused' } {
  const max = opts.maxPhotosPerSpread ?? 5
  const spread = state.spreads.find(s => s.id === spreadId)
  if (!spread) return { error: 'no-spread' }
  if (!state.unusedPhotoIds.includes(unusedPhotoId)) return { error: 'photo-not-unused' }

  const current = spread.photoIds.filter(Boolean) as string[]
  const newCount = current.length + 1
  if (newCount > max) return { error: 'at-capacity' }

  const hasHero = [...current, unusedPhotoId].some(opts.isHeroPhoto)
  const candidates = opts.templatesForCount(newCount, { type: opts.albumType, hasHero })
  const newTpl = candidates[0]
  if (!newTpl) return { error: 'no-template' }

  const allPhotos = [...current, unusedPhotoId]
  const newSlotIds = reorderForTemplate(newTpl, allPhotos, opts.isHeroPhoto)

  const op = makeAddOp(state, spreadId, newTpl.id, newSlotIds, unusedPhotoId)
  return { op }
}

/**
 * Remove a photo from a spread → shrink template by 1, photo goes to unused.
 * Returns error if the spread is at minimum (1 photo).
 */
export function buildRemoveOp(
  state: AlbumStateSlice,
  spreadId: string,
  slotIndex: number,
  opts: {
    albumType: 'standard' | 'layflat'
    isHeroPhoto: (id: string) => boolean
    templatesForCount: TemplatesForCount
  }
): { op: Op } | { error: 'at-minimum' | 'no-template' | 'no-spread' | 'empty-slot' } {
  const spread = state.spreads.find(s => s.id === spreadId)
  if (!spread) return { error: 'no-spread' }
  const removedId = spread.photoIds[slotIndex]
  if (!removedId) return { error: 'empty-slot' }

  const remaining = spread.photoIds.filter((id, i) => i !== slotIndex && id) as string[]
  const newCount = remaining.length
  if (newCount < 1) return { error: 'at-minimum' }

  const hasHero = remaining.some(opts.isHeroPhoto)
  const candidates = opts.templatesForCount(newCount, { type: opts.albumType, hasHero })
  const newTpl = candidates[0]
  if (!newTpl) return { error: 'no-template' }

  const newSlotIds = reorderForTemplate(newTpl, remaining, opts.isHeroPhoto)
  const op = makeRemoveOp(state, spreadId, slotIndex, newTpl.id, newSlotIds)
  return { op }
}
