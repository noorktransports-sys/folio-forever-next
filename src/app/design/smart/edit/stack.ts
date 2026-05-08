// src/app/design/smart/edit/stack.ts
//
// 5-step undo stack. Per-album, persisted to localStorage. Pushing a new op
// drops the oldest if at capacity, and clears the redo stack (standard
// editor behavior — branching after undo is a separate feature, not v1).

import type { Op } from './operations'

export const UNDO_CAPACITY = 5

export interface SerializedStack {
  undoStack: Op[]
  redoStack: Op[]
  v: 1
}

export class OperationStack {
  private undoStack: Op[] = []
  private redoStack: Op[] = []

  push(op: Op): void {
    this.undoStack.push(op)
    if (this.undoStack.length > UNDO_CAPACITY) {
      this.undoStack.shift() // drop oldest
    }
    this.redoStack = [] // any new edit invalidates redo history
  }

  undo(): Op | null {
    const op = this.undoStack.pop()
    if (!op) return null
    this.redoStack.push(op)
    if (this.redoStack.length > UNDO_CAPACITY) {
      this.redoStack.shift()
    }
    return op
  }

  redo(): Op | null {
    const op = this.redoStack.pop()
    if (!op) return null
    this.undoStack.push(op)
    if (this.undoStack.length > UNDO_CAPACITY) {
      this.undoStack.shift()
    }
    return op
  }

  /** Cleared on Generate (after user confirms). */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }

  /** Peek at the next op that would be undone (for tooltip / a11y label). */
  peekUndo(): Op | null {
    return this.undoStack[this.undoStack.length - 1] ?? null
  }
  peekRedo(): Op | null {
    return this.redoStack[this.redoStack.length - 1] ?? null
  }

  serialize(): SerializedStack {
    return { undoStack: [...this.undoStack], redoStack: [...this.redoStack], v: 1 }
  }

  hydrate(s: SerializedStack | null | undefined): void {
    if (!s || s.v !== 1) {
      this.clear()
      return
    }
    this.undoStack = (s.undoStack || []).slice(-UNDO_CAPACITY)
    this.redoStack = (s.redoStack || []).slice(-UNDO_CAPACITY)
  }
}

// ─── localStorage persistence ─────────────────────────────────────────────

const KEY = (albumId: string) => `folio-smart-undo:${albumId}`

export function saveStack(albumId: string, stack: OperationStack): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY(albumId), JSON.stringify(stack.serialize()))
  } catch (err) {
    // Quota exceeded or storage disabled — silently degrade. Undo will work
    // in-memory for the rest of the session.
    console.warn('[undo] persist failed', err)
  }
}

export function loadStack(albumId: string): OperationStack {
  const stack = new OperationStack()
  if (typeof window === 'undefined') return stack
  try {
    const raw = localStorage.getItem(KEY(albumId))
    if (raw) stack.hydrate(JSON.parse(raw))
  } catch (err) {
    console.warn('[undo] load failed', err)
  }
  return stack
}

export function clearStorage(albumId: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(KEY(albumId)) } catch {}
}
