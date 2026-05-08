// src/app/design/smart/edit/PhotoCountDropdown.tsx
//
// The "2 PHOTOS ▾" pill in your screenshot. Lets the user change the count
// for one spread. Disables counts that aren't possible (e.g., increase past
// what the unused pool can supply).

'use client'

import React, { useState, useRef, useEffect } from 'react'

interface Props {
  current: number
  /** Counts the user can choose from (typically 1..5). */
  available: number[]
  /** Counts that are currently impossible — pre-disable with a tooltip. */
  disabled?: Partial<Record<number, string>> // count -> reason
  onChange: (next: number) => void
}

export function PhotoCountDropdown({ current, available, disabled = {}, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          background: 'rgba(218, 165, 32, 0.08)',
          border: '1px solid rgba(218, 165, 32, 0.3)',
          color: 'var(--cream, #f5f0e6)',
          padding: '6px 12px',
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          borderRadius: 4,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        {current} {current === 1 ? 'photo' : 'photos'}
        <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
            background: '#1a1a1d',
            border: '1px solid rgba(218, 165, 32, 0.3)',
            borderRadius: 4,
            listStyle: 'none', padding: 4, margin: 0,
            minWidth: 140, zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {available.map(n => {
            const isCurrent = n === current
            const reason = disabled[n]
            const isDisabled = !!reason
            return (
              <li key={n}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={isDisabled}
                  title={reason}
                  onClick={() => { if (!isDisabled) { onChange(n); setOpen(false) } }}
                  style={{
                    width: '100%',
                    background: isCurrent ? 'rgba(218,165,32,0.15)' : 'transparent',
                    border: 'none',
                    color: isDisabled ? 'rgba(245,240,230,0.35)' : 'var(--cream, #f5f0e6)',
                    padding: '8px 12px',
                    fontSize: 12,
                    letterSpacing: 0.8,
                    textAlign: 'left',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    borderRadius: 3,
                  }}
                >
                  {n} {n === 1 ? 'photo' : 'photos'}
                  {isDisabled && reason && (
                    <span style={{
                      display: 'block',
                      fontSize: 10, opacity: 0.6, marginTop: 2,
                    }}>{reason}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
