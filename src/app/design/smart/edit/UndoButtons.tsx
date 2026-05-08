// src/app/design/smart/edit/UndoButtons.tsx

'use client'

import React from 'react'

interface Props {
  canUndo: boolean
  canRedo: boolean
  nextUndoLabel: string | null
  nextRedoLabel: string | null
  onUndo: () => void
  onRedo: () => void
}

const baseBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(218, 165, 32, 0.3)', // var(--gold) at 30%
  color: 'var(--cream, #f5f0e6)',
  width: 36,
  height: 36,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background 120ms ease, opacity 120ms ease',
  padding: 0,
}

export function UndoButtons({
  canUndo, canRedo, nextUndoLabel, nextRedoLabel, onUndo, onRedo
}: Props) {
  return (
    <div style={{ display: 'inline-flex', gap: 6 }} role="group" aria-label="Edit history">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title={canUndo ? `Undo: ${nextUndoLabel ?? ''} (Ctrl+Z)` : 'Nothing to undo'}
        aria-label={canUndo ? `Undo ${nextUndoLabel ?? ''}` : 'Undo (disabled)'}
        style={{
          ...baseBtn,
          opacity: canUndo ? 1 : 0.35,
          cursor: canUndo ? 'pointer' : 'not-allowed',
        }}
        onMouseEnter={e => { if (canUndo) e.currentTarget.style.borderColor = 'var(--gold, #daa520)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(218, 165, 32, 0.3)' }}
      >
        {/* Undo arrow icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 7v6h6" />
          <path d="M3 13a9 9 0 1 0 3-7l-3 3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title={canRedo ? `Redo: ${nextRedoLabel ?? ''} (Ctrl+Shift+Z)` : 'Nothing to redo'}
        aria-label={canRedo ? `Redo ${nextRedoLabel ?? ''}` : 'Redo (disabled)'}
        style={{
          ...baseBtn,
          opacity: canRedo ? 1 : 0.35,
          cursor: canRedo ? 'pointer' : 'not-allowed',
        }}
        onMouseEnter={e => { if (canRedo) e.currentTarget.style.borderColor = 'var(--gold, #daa520)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(218, 165, 32, 0.3)' }}
      >
        {/* Redo arrow icon (mirrored) */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 7v6h-6" />
          <path d="M21 13a9 9 0 1 1-3-7l3 3" />
        </svg>
      </button>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────
// Tiny, headless. Plug into your app's toast system if you have one;
// otherwise this is a drop-in.

export function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = React.useCallback((m: string) => {
    setMsg(m)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 2200)
  }, [])
  const Toast = msg ? (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(20, 20, 22, 0.95)',
        border: '1px solid rgba(218, 165, 32, 0.4)',
        color: 'var(--cream, #f5f0e6)',
        padding: '10px 18px',
        borderRadius: 8,
        fontSize: 13,
        letterSpacing: 0.3,
        zIndex: 9999,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
      }}
    >
      {msg}
    </div>
  ) : null
  return { show, Toast }
}
