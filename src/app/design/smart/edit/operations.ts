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
  /**
   * Reorder ops (kind 'reorder-spread') store the full spread-id order
   * before and after. applyOp reorders state.spreads to match.
   */
  spreadOrder?: { before: string[]; after: string[] }
  /**
   * Whole-spread deletion (kind 'delete-spread'). Forward removes the
   * spread at this position; undo re-inserts it. The op's `unused`
   * delta carries the photo movement so undo also restores them.
   */
  deletedSpread?: DeletedSpreadInfo
}

export type OpKind =
  | 'swap'              // photo↔photo within a spread, or photo↔unused
  | 'swap-cross'        // photo on spread A ↔ photo on spread B
  | 'remove'            // photo removed from spread → unused
  | 'add'               // photo dragged from unused → spread (template grows by 1)
  | 'photo-count'       // user changed dropdown 2→3, etc.
  | 'layout-variant'    // user picked alternate template at same count
  | 'reorder-spread'    // user dragged a spread to a new position
  | 'delete-spread'     // user deleted a whole spread (its photos → unused pool)

/**
 * Carries the full state needed to restore a deleted spread on undo:
 * its position in the spreads list and a snapshot of its mutable
 * fields. (Used only when `op.kind === 'delete-spread'`.)
 */
export interface DeletedSpreadInfo {
  position: number
  id: string
  templateId: string
  photoIds: (string | null)[]
  eventId?: string
}

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
  let nextSpreads = state.spreads.map(s => {
    const delta = op.spreads.find(d => d.spreadId === s.id)
    if (!delta) return s
    const snap = delta[target]
    return { ...s, templateId: snap.templateId, photoIds: [...snap.photoIds] }
  })

  // Apply spread order (reorder ops)
  if (op.spreadOrder) {
    const orderTarget = op.spreadOrder[target]
    const byId = new Map(nextSpreads.map(s => [s.id, s] as const))
    const reordered = orderTarget
      .map(id => byId.get(id))
      .filter((s): s is Spread => Boolean(s))
    // Append any spreads not in the order list (shouldn't happen, but
    // keeps spreads from disappearing if state drifts).
    nextSpreads.forEach(s => {
      if (!orderTarget.includes(s.id)) reordered.push(s)
    })
    nextSpreads = reordered
  }

  // Apply spread deletion / restoration (delete-spread ops).
  // Forward: remove the spread. Backward: re-insert it at its original
  // position. The photo movement is carried by the `unused` delta.
  if (op.deletedSpread) {
    const d = op.deletedSpread
    if (direction === 'forward') {
      nextSpreads = nextSpreads.filter(s => s.id !== d.id)
    } else {
      const exists = nextSpreads.some(s => s.id === d.id)
      if (!exists) {
        const restored: Spread = {
          id: d.id,
          templateId: d.templateId,
          photoIds: [...d.photoIds],
          ...(d.eventId !== undefined ? { eventId: d.eventId } : {}),
        }
        const pos = Math.max(0, Math.min(nextSpreads.length, d.position))
        nextSpreads = [
          ...nextSpreads.slice(0, pos),
          restored,
          ...nextSpreads.slice(pos),
        ]
      }
    }
  }

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

/**
 * User dragged a spread from one position to another.
 *
 * `fromIndex` and `toIndex` are the visible (1-based for label, but
 * 0-based for the array math). The op records the full id order before
 * and after so undo / redo restore exactly.
 *
 * Move semantics: the dragged spread is removed from `fromIndex` and
 * inserted at `toIndex` (insert-before, not swap). If toIndex is past
 * the original position the insert visually "skips over" itself; the
 * caller can pass toIndex - 1 in that case if pure-insert semantics is
 * preferred. We don't auto-correct here so the caller decides.
 */
export function makeReorderSpreadOp(
  state: { spreads: Spread[] },
  fromIndex: number,
  toIndex: number,
): Op {
  const before = state.spreads.map(s => s.id)
  const after = [...before]
  const [movedId] = after.splice(fromIndex, 1)
  if (movedId == null) {
    // No-op fallback; return an empty op that won't affect state.
    return {
      id: uuid(),
      kind: 'reorder-spread',
      label: 'No-op reorder',
      ts: Date.now(),
      spreads: [],
      spreadOrder: { before, after: before },
    }
  }
  after.splice(toIndex, 0, movedId)
  return {
    id: uuid(),
    kind: 'reorder-spread',
    label: `Move Spread ${fromIndex + 1} → position ${toIndex + 1}`,
    ts: Date.now(),
    spreads: [],
    spreadOrder: { before, after },
  }
}

/**
 * Delete an entire spread. Every photo currently on the spread returns
 * to the unused pool (so nothing is lost — the client can drop the
 * photos onto other spreads or rebuild a new spread). Undo restores
 * the spread at its original position and pulls those photos back out
 * of unused.
 */
export function makeDeleteSpreadOp(
  state: { spreads: Spread[]; unusedPhotoIds: string[] },
  spreadId: string,
): Op {
  const position = state.spreads.findIndex(s => s.id === spreadId)
  if (position < 0) throw new Error(`Spread ${spreadId} not found`)
  const s = state.spreads[position]
  const photosOnSpread = s.photoIds.filter(
    (id): id is string => Boolean(id),
  )
  // Don't double-add a photo if it's somehow already in the unused
  // pool (shouldn't happen, but defensive).
  const unusedBefore = [...state.unusedPhotoIds]
  const unusedAfter = [
    ...unusedBefore,
    ...photosOnSpread.filter(id => !unusedBefore.includes(id)),
  ]
  return {
    id: uuid(),
    kind: 'delete-spread',
    label: `Delete Spread ${position + 1}`,
    ts: Date.now(),
    spreads: [],
    unused: { before: unusedBefore, after: unusedAfter },
    deletedSpread: {
      position,
      id: s.id,
      templateId: s.templateId,
      photoIds: [...s.photoIds],
      ...(s.eventId !== undefined ? { eventId: s.eventId } : {}),
    },
  }
}
