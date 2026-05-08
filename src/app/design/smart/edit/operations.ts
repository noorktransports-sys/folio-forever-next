// src/app/design/smart/edit/operations.ts
//
// Every user edit becomes an Op. Each Op carries enough state (before/after
// snapshots of the affected slices) to apply AND reverse without recomputing.
// The undo stack just records ops; this file applies them.
//
// IMPORTANT: types below mirror the handoff doc. Verify against your real
// types in page.tsx and adjust the imports/shape if your fields differ.

// ─── Types ────────────────────────────────────────────────────────────────

export type AlbumType = 'standard' | 'layflat'

export interface Spread {
  id: string
  templateId: string
  photoIds: (string | null)[]
  /**
   * Smart wizard tags each spread with the event it belongs to (prep,
   * ceremony, portraits, reception, other). Optional here so the ops
   * library stays generic. Preserved across applyOp via spread-rest.
   */
  eventId?: string
}

/** A snapshot of one spread's mutable state. */
export interface SpreadSnapshot {
  templateId: string
  photoIds: (string | null)[]
}

export interface SpreadDelta {
  spreadId: string
  before: SpreadSnapshot
  after: SpreadSnapshot
}

export interface UnusedDelta {
  before: string[]
  after: string[]
}

/**
 * One user edit. Carries before/after of every slice it touched.
 * Apply = restore `after`. Undo = restore `before`. No recomputation.
 */
export interface Op {
  id: string                 // uuid, for React keys + dedupe
  kind: OpKind
  label: string              // e.g. "Swap on Spread 7" — shown in undo toast
  ts: number                 // Date.now(), for debugging
  spreads: SpreadDelta[]     // can be 1 (in-spread swap) or 2 (cross-spread swap)
  unused?: UnusedDelta       // present when unused pool changed
}

export type OpKind =
  | 'swap'              // photo↔photo within a spread, or photo↔unused
  | 'swap-cross'        // photo on spread A ↔ photo on spread B
  | 'remove'            // photo removed from spread → unused
  | 'add'               // photo dragged from unused → spread (template grows by 1)
  | 'photo-count'       // user changed dropdown 2→3, etc.
  | 'layout-variant'    // user picked alternate template at same count

// ─── Apply / Undo ─────────────────────────────────────────────────────────

/**
 * Apply an op. Mutates a fresh state object — caller is responsible for
 * passing in a copy (or wrapping in immer). Returns the next state.
 */
export function applyOp(
  state: { spreads: Spread[]; unusedPhotoIds: string[] },
  op: Op,
  direction: 'forward' | 'backward'
): { spreads: Spread[]; unusedPhotoIds: string[] } {
  const target = direction === 'forward' ? 'after' : 'before'

  // Apply spread deltas
  const nextSpreads = state.spreads.map(s => {
    const delta = op.spreads.find(d => d.spreadId === s.id)
    if (!delta) return s
    const snap = delta[target]
    return { ...s, templateId: snap.templateId, photoIds: [...snap.photoIds] }
  })

  // Apply unused delta (if any)
  const nextUnused = op.unused
    ? [...op.unused[target]]
    : state.unusedPhotoIds

  return { spreads: nextSpreads, unusedPhotoIds: nextUnused }
}

// ─── Op constructors ──────────────────────────────────────────────────────
// One per user-facing edit. Each takes the current state and returns an Op.
// They never mutate; they read state to build the before/after snapshots.

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const snap = (s: Spread): SpreadSnapshot => ({
  templateId: s.templateId,
  photoIds: [...s.photoIds],
})

const findSpread = (state: { spreads: Spread[] }, id: string): Spread => {
  const s = state.spreads.find(x => x.id === id)
  if (!s) throw new Error(`Spread ${id} not found`)
  return s
}

const spreadIndex = (state: { spreads: Spread[] }, id: string): number =>
  state.spreads.findIndex(x => x.id === id) + 1 // 1-based for labels

/** Swap two slots within the same spread. */
export function makeSwapOp(
  state: { spreads: Spread[] },
  spreadId: string,
  slotA: number,
  slotB: number
): Op {
  const s = findSpread(state, spreadId)
  const before = snap(s)
  const after: SpreadSnapshot = { ...before, photoIds: [...before.photoIds] }
  ;[after.photoIds[slotA], after.photoIds[slotB]] = [after.photoIds[slotB], after.photoIds[slotA]]
  return {
    id: uuid(),
    kind: 'swap',
    label: `Swap on Spread ${spreadIndex(state, spreadId)}`,
    ts: Date.now(),
    spreads: [{ spreadId, before, after }],
  }
}

/** Swap a slot with a photo from the unused pool. */
export function makeSwapWithUnusedOp(
  state: { spreads: Spread[]; unusedPhotoIds: string[] },
  spreadId: string,
  slotIndex: number,
  unusedPhotoId: string
): Op {
  const s = findSpread(state, spreadId)
  const before = snap(s)
  const displaced = before.photoIds[slotIndex]
  const after: SpreadSnapshot = { ...before, photoIds: [...before.photoIds] }
  after.photoIds[slotIndex] = unusedPhotoId

  const unusedBefore = [...state.unusedPhotoIds]
  const unusedAfter = unusedBefore.filter(id => id !== unusedPhotoId)
  if (displaced) unusedAfter.push(displaced)

  return {
    id: uuid(),
    kind: 'swap',
    label: `Swap on Spread ${spreadIndex(state, spreadId)}`,
    ts: Date.now(),
    spreads: [{ spreadId, before, after }],
    unused: { before: unusedBefore, after: unusedAfter },
  }
}

/** Swap photos between two different spreads. */
export function makeCrossSwapOp(
  state: { spreads: Spread[] },
  spreadIdA: string, slotA: number,
  spreadIdB: string, slotB: number
): Op {
  const sA = findSpread(state, spreadIdA)
  const sB = findSpread(state, spreadIdB)
  const beforeA = snap(sA)
  const beforeB = snap(sB)
  const afterA: SpreadSnapshot = { ...beforeA, photoIds: [...beforeA.photoIds] }
  const afterB: SpreadSnapshot = { ...beforeB, photoIds: [...beforeB.photoIds] }
  afterA.photoIds[slotA] = beforeB.photoIds[slotB]
  afterB.photoIds[slotB] = beforeA.photoIds[slotA]
  return {
    id: uuid(),
    kind: 'swap-cross',
    label: `Swap between Spread ${spreadIndex(state, spreadIdA)} and ${spreadIndex(state, spreadIdB)}`,
    ts: Date.now(),
    spreads: [
      { spreadId: spreadIdA, before: beforeA, after: afterA },
      { spreadId: spreadIdB, before: beforeB, after: afterB },
    ],
  }
}

/**
 * Remove a photo from a spread. Caller provides the new templateId picked by
 * pickTemplate(count - 1, hasHero) — this op doesn't choose templates.
 */
export function makeRemoveOp(
  state: { spreads: Spread[]; unusedPhotoIds: string[] },
  spreadId: string,
  slotIndex: number,
  newTemplateId: string,
  /** new photoIds in the order the new template expects */
  newPhotoIds: (string | null)[]
): Op {
  const s = findSpread(state, spreadId)
  const before = snap(s)
  const removed = before.photoIds[slotIndex]
  const after: SpreadSnapshot = { templateId: newTemplateId, photoIds: newPhotoIds }
  const unusedBefore = [...state.unusedPhotoIds]
  const unusedAfter = removed ? [...unusedBefore, removed] : unusedBefore
  return {
    id: uuid(),
    kind: 'remove',
    label: `Remove from Spread ${spreadIndex(state, spreadId)}`,
    ts: Date.now(),
    spreads: [{ spreadId, before, after }],
    unused: { before: unusedBefore, after: unusedAfter },
  }
}

/**
 * Drag an unused photo onto a spread → template grows by 1 slot.
 * Caller provides the new templateId from pickTemplate(count + 1, hasHero)
 * and the newPhotoIds in the order the new template expects.
 */
export function makeAddOp(
  state: { spreads: Spread[]; unusedPhotoIds: string[] },
  spreadId: string,
  newTemplateId: string,
  newPhotoIds: (string | null)[],
  addedPhotoId: string
): Op {
  const s = findSpread(state, spreadId)
  const before = snap(s)
  const after: SpreadSnapshot = { templateId: newTemplateId, photoIds: newPhotoIds }
  const unusedBefore = [...state.unusedPhotoIds]
  const unusedAfter = unusedBefore.filter(id => id !== addedPhotoId)
  return {
    id: uuid(),
    kind: 'add',
    label: `Add to Spread ${spreadIndex(state, spreadId)}`,
    ts: Date.now(),
    spreads: [{ spreadId, before, after }],
    unused: { before: unusedBefore, after: unusedAfter },
  }
}

/**
 * User changed photo count via dropdown. Caller computes the new template
 * and new photoIds (pulling from / pushing to unused as needed) and passes
 * them in. This op just records the diff.
 */
export function makePhotoCountOp(
  state: { spreads: Spread[]; unusedPhotoIds: string[] },
  spreadId: string,
  newTemplateId: string,
  newPhotoIds: (string | null)[],
  newUnusedPhotoIds: string[]
): Op {
  const s = findSpread(state, spreadId)
  const before = snap(s)
  const after: SpreadSnapshot = { templateId: newTemplateId, photoIds: newPhotoIds }
  return {
    id: uuid(),
    kind: 'photo-count',
    label: `Change count on Spread ${spreadIndex(state, spreadId)}`,
    ts: Date.now(),
    spreads: [{ spreadId, before, after }],
    unused: { before: [...state.unusedPhotoIds], after: newUnusedPhotoIds },
  }
}

/** User picked a different layout at the same photo count. */
export function makeLayoutVariantOp(
  state: { spreads: Spread[] },
  spreadId: string,
  newTemplateId: string,
  /** photoIds reordered to match new template's slot order (caller decides) */
  newPhotoIds: (string | null)[]
): Op {
  const s = findSpread(state, spreadId)
  const before = snap(s)
  const after: SpreadSnapshot = { templateId: newTemplateId, photoIds: newPhotoIds }
  return {
    id: uuid(),
    kind: 'layout-variant',
    label: `Change layout on Spread ${spreadIndex(state, spreadId)}`,
    ts: Date.now(),
    spreads: [{ spreadId, before, after }],
  }
}
