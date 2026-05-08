// src/app/design/smart/edit/swap.tsx
//
// Three swap gestures, one underlying operation:
//   1. Tap-to-swap     — useTapSwap hook (pick first slot, then pick second)
//   2. Drag-and-drop   — useSlotDrag hook (HTML5 drag, no library)
//   3. Toolbar picker  — <SwapPicker /> modal
//
// All three resolve to one of: makeSwapOp, makeSwapWithUnusedOp, makeCrossSwapOp.

'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  makeSwapOp, makeSwapWithUnusedOp, makeCrossSwapOp,
  type Op, type Spread,
} from './operations'

interface Photo { id: string; preview: string }

interface SlotRef {
  spreadId: string
  slotIndex: number
}

interface AlbumStateSlice {
  spreads: Spread[]
  unusedPhotoIds: string[]
}

// ─── 1. Tap-to-swap ───────────────────────────────────────────────────────
//
// Usage:
//   const { armed, onSlotTap, onUnusedTap, cancel } = useTapSwap({ state, record })
//   <div onClick={() => onSlotTap(spreadId, slotIndex)} ... />
//   <img onClick={() => onUnusedTap(photoId)} ... />
// 'armed' is the first selection. Pass it down so you can highlight the slot.

export function useTapSwap({
  state,
  record,
}: {
  state: AlbumStateSlice
  record: (op: Op) => void
}) {
  const [armed, setArmed] = useState<SlotRef | null>(null)

  // Esc cancels
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setArmed(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [armed])

  const onSlotTap = useCallback((spreadId: string, slotIndex: number) => {
    if (!armed) {
      setArmed({ spreadId, slotIndex })
      return
    }
    // Tapped same slot twice = cancel
    if (armed.spreadId === spreadId && armed.slotIndex === slotIndex) {
      setArmed(null)
      return
    }
    // Same spread — in-spread swap
    if (armed.spreadId === spreadId) {
      record(makeSwapOp(state, spreadId, armed.slotIndex, slotIndex))
    } else {
      // Cross-spread swap
      record(makeCrossSwapOp(state, armed.spreadId, armed.slotIndex, spreadId, slotIndex))
    }
    setArmed(null)
  }, [armed, state, record])

  const onUnusedTap = useCallback((photoId: string) => {
    if (!armed) return // arming from unused isn't a thing — must arm a slot first
    record(makeSwapWithUnusedOp(state, armed.spreadId, armed.slotIndex, photoId))
    setArmed(null)
  }, [armed, state, record])

  const cancel = useCallback(() => setArmed(null), [])

  return { armed, onSlotTap, onUnusedTap, cancel }
}

// ─── 2. Drag-and-drop ─────────────────────────────────────────────────────
//
// Native HTML5 drag. No library. Works on desktop. Touch needs polyfill or
// a long-press wrapper — see notes in INTEGRATION.md.

const DRAG_MIME_SLOT = 'application/x-folio-slot'
const DRAG_MIME_UNUSED = 'application/x-folio-unused'

interface DragHandlers {
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}

/** Draggable slot. Drop a slot onto another slot to swap. */
export function useSlotDrag({
  state,
  record,
  onAddRequested, // called when an unused photo is dropped on a slot's parent spread
}: {
  state: AlbumStateSlice
  record: (op: Op) => void
  onAddRequested?: (spreadId: string, photoId: string) => void
}) {
  const [dragging, setDragging] = useState(false)

  const slotHandlers = (spreadId: string, slotIndex: number): DragHandlers => ({
    onDragStart: (e) => {
      e.dataTransfer.setData(DRAG_MIME_SLOT, JSON.stringify({ spreadId, slotIndex }))
      e.dataTransfer.effectAllowed = 'move'
      setDragging(true)
    },
    onDragOver: (e) => {
      // Accept either a slot drag or an unused-photo drag
      if (e.dataTransfer.types.includes(DRAG_MIME_SLOT) ||
          e.dataTransfer.types.includes(DRAG_MIME_UNUSED)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }
    },
    onDrop: (e) => {
      e.preventDefault()
      setDragging(false)
      const slotData = e.dataTransfer.getData(DRAG_MIME_SLOT)
      const unusedData = e.dataTransfer.getData(DRAG_MIME_UNUSED)
      if (slotData) {
        const src = JSON.parse(slotData) as SlotRef
        if (src.spreadId === spreadId && src.slotIndex === slotIndex) return
        if (src.spreadId === spreadId) {
          record(makeSwapOp(state, spreadId, src.slotIndex, slotIndex))
        } else {
          record(makeCrossSwapOp(state, src.spreadId, src.slotIndex, spreadId, slotIndex))
        }
      } else if (unusedData) {
        const { photoId } = JSON.parse(unusedData) as { photoId: string }
        record(makeSwapWithUnusedOp(state, spreadId, slotIndex, photoId))
      }
    },
    onDragEnd: () => setDragging(false),
  })

  /**
   * Handlers for an unused-pool thumbnail. Drop on a slot → swap. Drop on
   * spread background → grow template by 1 (handled by parent via
   * onAddRequested).
   */
  const unusedHandlers = (photoId: string): Pick<DragHandlers, 'onDragStart' | 'onDragEnd'> => ({
    onDragStart: (e) => {
      e.dataTransfer.setData(DRAG_MIME_UNUSED, JSON.stringify({ photoId }))
      e.dataTransfer.effectAllowed = 'move'
      setDragging(true)
    },
    onDragEnd: () => setDragging(false),
  })

  /**
   * Spread-background drop zone for the +1 layout case. Wire this to the
   * spread container (NOT a slot). Drops here mean "add this unused photo
   * to this spread."
   */
  const spreadDropHandlers = (spreadId: string): Pick<DragHandlers, 'onDragOver' | 'onDrop'> => ({
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes(DRAG_MIME_UNUSED)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    onDrop: (e) => {
      const unusedData = e.dataTransfer.getData(DRAG_MIME_UNUSED)
      if (!unusedData) return
      e.preventDefault()
      e.stopPropagation()
      const { photoId } = JSON.parse(unusedData) as { photoId: string }
      // Parent decides which template to upgrade to (calls templatesForCount)
      // and dispatches makeAddOp via record(). We just signal the intent here.
      onAddRequested?.(spreadId, photoId)
      setDragging(false)
    },
  })

  return { dragging, slotHandlers, unusedHandlers, spreadDropHandlers }
}

// ─── 3. Toolbar swap picker (modal) ───────────────────────────────────────

interface SwapPickerProps {
  open: boolean
  onClose: () => void
  /** All photos in the album, keyed by id. */
  photos: Record<string, Photo>
  /** Photo IDs currently placed on any spread (shown with a "used" badge). */
  usedPhotoIds: Set<string>
  /** Photo IDs in the unused pool. */
  unusedPhotoIds: string[]
  /** Currently-selected slot (target of the swap). */
  target: SlotRef | null
  /**
   * Called when the user picks a photo. Parent decides whether this is a
   * swap-with-unused or a cross-spread swap and calls the appropriate op.
   */
  onPick: (photoId: string) => void
}

export function SwapPicker({
  open, onClose, photos, usedPhotoIds, unusedPhotoIds, target, onPick,
}: SwapPickerProps) {
  if (!open || !target) return null

  const allPhotos = Object.values(photos)
  // Unused first, then used.
  const sorted = [
    ...unusedPhotoIds.map(id => photos[id]).filter(Boolean),
    ...allPhotos.filter(p => !unusedPhotoIds.includes(p.id)),
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a photo to swap"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#16161a',
          border: '1px solid rgba(218, 165, 32, 0.3)',
          borderRadius: 12,
          padding: 20,
          maxWidth: 720,
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          color: 'var(--cream, #f5f0e6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, letterSpacing: 1.5, margin: 0, textTransform: 'uppercase' }}>
            Swap with…
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--cream, #f5f0e6)', cursor: 'pointer', fontSize: 22 }}
            aria-label="Close"
          >×</button>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 8,
        }}>
          {sorted.map(p => {
            const isUsed = usedPhotoIds.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => { onPick(p.id); onClose() }}
                style={{
                  position: 'relative',
                  padding: 0, border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6, background: 'transparent',
                  aspectRatio: '1', overflow: 'hidden', cursor: 'pointer',
                }}
                aria-label={isUsed ? 'Used photo' : 'Unused photo'}
              >
                <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {isUsed && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    background: 'rgba(0,0,0,0.7)',
                    color: 'var(--gold, #daa520)',
                    fontSize: 9, padding: '2px 6px', borderRadius: 3,
                    letterSpacing: 0.8, textTransform: 'uppercase',
                  }}>used</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
