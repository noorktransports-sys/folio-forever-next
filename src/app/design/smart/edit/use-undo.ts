// src/app/design/smart/edit/use-undo.ts

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyOp, type Op, type Spread } from './operations'
import { OperationStack, loadStack, saveStack } from './stack'

interface AlbumStateSlice {
  spreads: Spread[]
  unusedPhotoIds: string[]
}

interface UseUndoArgs {
  albumId: string | null
  state: AlbumStateSlice
  setState: (next: AlbumStateSlice) => void
  /** Called whenever an op resolves (push/undo/redo) so toast can fire. */
  onAnnounce?: (label: string, kind: 'do' | 'undo' | 'redo') => void
}

export function useUndo({ albumId, state, setState, onAnnounce }: UseUndoArgs) {
  // One stack per album, swapped when albumId changes.
  const stackRef = useRef<OperationStack>(new OperationStack())
  const [, force] = useState(0)
  const tick = useCallback(() => force(n => n + 1), [])

  // Latest state in a ref so the keyboard handler sees current values.
  const stateRef = useRef(state)
  stateRef.current = state
  const setStateRef = useRef(setState)
  setStateRef.current = setState

  // Hydrate the stack when album changes.
  useEffect(() => {
    if (!albumId) {
      stackRef.current = new OperationStack()
      tick()
      return
    }
    stackRef.current = loadStack(albumId)
    tick()
  }, [albumId, tick])

  // Persist on every change.
  const persist = useCallback(() => {
    if (albumId) saveStack(albumId, stackRef.current)
  }, [albumId])

  /** Record an op and apply it forward. Use this to wrap every user edit. */
  const record = useCallback((op: Op) => {
    stackRef.current.push(op)
    setStateRef.current(applyOp(stateRef.current, op, 'forward'))
    persist()
    tick()
    onAnnounce?.(op.label, 'do')
  }, [persist, tick, onAnnounce])

  const undo = useCallback(() => {
    const op = stackRef.current.undo()
    if (!op) return
    setStateRef.current(applyOp(stateRef.current, op, 'backward'))
    persist()
    tick()
    onAnnounce?.(`Undid: ${op.label}`, 'undo')
  }, [persist, tick, onAnnounce])

  const redo = useCallback(() => {
    const op = stackRef.current.redo()
    if (!op) return
    setStateRef.current(applyOp(stateRef.current, op, 'forward'))
    persist()
    tick()
    onAnnounce?.(`Redid: ${op.label}`, 'redo')
  }, [persist, tick, onAnnounce])

  /** Call this on Generate, AFTER the user confirms the dialog. */
  const clearStack = useCallback(() => {
    stackRef.current.clear()
    persist()
    tick()
  }, [persist, tick])

  // Keyboard: Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Don't hijack typing in inputs/textareas/contenteditable
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return useMemo(() => ({
    record,
    undo,
    redo,
    clearStack,
    canUndo: stackRef.current.canUndo(),
    canRedo: stackRef.current.canRedo(),
    nextUndoLabel: stackRef.current.peekUndo()?.label ?? null,
    nextRedoLabel: stackRef.current.peekRedo()?.label ?? null,
  }), [record, undo, redo, clearStack, /* tick triggers re-memo via state change */])
}
