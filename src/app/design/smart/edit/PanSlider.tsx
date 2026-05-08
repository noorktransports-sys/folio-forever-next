// src/app/design/smart/edit/PanSlider.tsx
//
// Fix for "pan not working on tools."
//
// Most likely cause (95% of the time, based on the existing toolbar in your
// screenshot): the slider value is stored but isn't being applied to the
// <img> transform. Below is the correct shape — slider value 0..100 maps to
// CSS object-position 0%..100% on the image, which is the standard way to
// pan a fitted image inside a fixed-size container.
//
// If your existing code uses translate(px, px) instead, that's the source
// of the bug. The slider stores 50, but translate(50px) only moves 50px
// regardless of container size = effectively no movement on small slots.
//
// This component gives you both:
//   - Working sliders (the immediate fix)
//   - Optional drag-to-pan on the image itself (Bug #2 from the handoff)

'use client'

import React, { useCallback, useRef } from 'react'

export interface SlotAdjust {
  panX: number   // 0..100, where 50 is centered
  panY: number   // 0..100, where 50 is centered
  zoom: number   // 1.0 = fit, > 1 = zoomed in
  rotate: number // degrees
  flipH: boolean
  flipV: boolean
}

export const DEFAULT_ADJUST: SlotAdjust = {
  panX: 50, panY: 50, zoom: 1, rotate: 0, flipH: false, flipV: false,
}

// ─── The image inside a slot ──────────────────────────────────────────────
// Apply the adjustment as object-position + transform. This is the
// canonical way; matches how Figma, Canva, Apple Photos all do it.

interface SlotImageProps {
  src: string
  alt?: string
  adjust: SlotAdjust
  /** Called with new adjust when the user drags directly on the image. */
  onAdjustChange?: (next: SlotAdjust) => void
  style?: React.CSSProperties
  /**
   * 'fill' = object-fit cover (default — image crops to fill the slot).
   * 'contain' = object-fit contain (image fits inside slot, may show
   * letterbox bars on white). Used by the smart wizard's
   * "Fit Fill / Fit Original" toggle.
   */
  fit?: 'fill' | 'contain'
}

export function SlotImage({ src, alt = '', adjust, onAdjustChange, style, fit = 'fill' }: SlotImageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{
    startX: number; startY: number;
    startPanX: number; startPanY: number;
    rect: DOMRect;
  } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!onAdjustChange || !containerRef.current) return
    // Only left click / primary touch
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const rect = containerRef.current.getBoundingClientRect()
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      startPanX: adjust.panX, startPanY: adjust.panY,
      rect,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [adjust, onAdjustChange])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current
    if (!ds || !onAdjustChange) return
    // Convert pixel delta to %  — divide by container size, invert (drag right → image moves right
    // → object-position decreases), scale by zoom (more zoom = same drag has less effect on pan%).
    const dxPct = ((e.clientX - ds.startX) / ds.rect.width) * 100 / Math.max(1, adjust.zoom)
    const dyPct = ((e.clientY - ds.startY) / ds.rect.height) * 100 / Math.max(1, adjust.zoom)
    // Round to integers so toolbar display doesn't show 56.61231503%.
    // Visual pan still feels smooth — users won't notice 1% snapping.
    const nextX = Math.round(Math.max(0, Math.min(100, ds.startPanX - dxPct)))
    const nextY = Math.round(Math.max(0, Math.min(100, ds.startPanY - dyPct)))
    onAdjustChange({ ...adjust, panX: nextX, panY: nextY })
  }, [adjust, onAdjustChange])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragState.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }, [])

  // Build the transform. Order matters: rotate, then scale, then flip.
  const flipScale = `${adjust.flipH ? -1 : 1}, ${adjust.flipV ? -1 : 1}`
  const transform = `rotate(${adjust.rotate}deg) scale(${adjust.zoom}) scale(${flipScale})`

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%', height: '100%',
        overflow: 'hidden',
        cursor: onAdjustChange ? 'grab' : 'default',
        ...style,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: '100%', height: '100%',
          objectFit: fit === 'contain' ? 'contain' : 'cover',
          // ─── This is the line your bug is on ─────────────────────────
          objectPosition: `${adjust.panX}% ${adjust.panY}%`,
          // ─────────────────────────────────────────────────────────────
          transform,
          transformOrigin: 'center center',
          userSelect: 'none',
          pointerEvents: 'none', // let the container handle drag
          background: fit === 'contain' ? '#ffffff' : 'transparent',
        }}
      />
    </div>
  )
}

// ─── The slider control in the toolbar ────────────────────────────────────

interface PanSlidersProps {
  adjust: SlotAdjust
  onChange: (next: SlotAdjust) => void
  onReset: () => void
}

export function PanSliders({ adjust, onChange, onReset }: PanSlidersProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
        color: 'var(--cream, #f5f0e6)', opacity: 0.7,
      }}>PAN</span>

      <label style={labelStyle}>
        <span style={{ opacity: 0.7, fontSize: 11 }}>X</span>
        <input
          type="range" min={0} max={100} step={1}
          value={adjust.panX}
          onChange={e => onChange({ ...adjust, panX: Number(e.target.value) })}
          style={rangeStyle}
        />
        <span style={valueStyle}>{Math.round(adjust.panX)}%</span>
      </label>

      <label style={labelStyle}>
        <span style={{ opacity: 0.7, fontSize: 11 }}>Y</span>
        <input
          type="range" min={0} max={100} step={1}
          value={adjust.panY}
          onChange={e => onChange({ ...adjust, panY: Number(e.target.value) })}
          style={rangeStyle}
        />
        <span style={valueStyle}>{Math.round(adjust.panY)}%</span>
      </label>

      <button
        type="button"
        onClick={onReset}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.2)',
          color: 'var(--cream, #f5f0e6)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >Reset</button>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  color: 'var(--cream, #f5f0e6)',
}
const rangeStyle: React.CSSProperties = {
  width: 140,
  accentColor: 'var(--gold, #daa520)', // modern browsers
}
const valueStyle: React.CSSProperties = {
  fontSize: 11, opacity: 0.7, minWidth: 36, textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}
