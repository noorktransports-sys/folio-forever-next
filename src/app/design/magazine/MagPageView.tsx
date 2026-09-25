'use client'

// One magazine page (8.5 × 11 portrait) rendered in the DOM. Mirrors the
// print renderer (render-spread.ts) layer for layer so what the client
// sees is what prints: background (colour / blurred photo + tint) →
// rust decor → photos in z-order (circles, frames, B&W) .

import { useEffect, useRef, useState } from 'react'
import { effectiveZoom } from '@/lib/smart-layout/rotate-cover'
import { SlotImage, type SlotAdjust } from '../smart/edit/PanSlider'
import { magTextStyle, type MagText } from '@/lib/magazine/text'
import {
  MAG_ASPECT,
  magSlotBox,
  type MagPage,
} from '@/lib/magazine/pages'

export type MagAdjust = { panX: number; panY: number; zoom: number; rotate?: number }
export const MAG_DEFAULT_ADJUST: MagAdjust = { panX: 50, panY: 50, zoom: 1, rotate: 0 }
/** Zoom ceiling (owner rule for all products: 200%). */
export const MAG_MAX_ZOOM = 2
const clampZoom = (z: number) => Math.max(1, Math.min(MAG_MAX_ZOOM, z))

export type MagPhoto = {
  id: string
  preview: string
  width: number
  height: number
}

const GOLD = '#b8965a'

/** Effective print DPI of a photo in a slot at a given zoom. */
export function slotDpi(
  photo: { width: number; height: number },
  slot: { w: number; h: number },
  zoom: number,
): number {
  const wIn = (slot.w / 100) * 8.5
  const hIn = (slot.h / 100) * 11
  if (wIn <= 0 || hIn <= 0 || !photo.width || !photo.height) return 0
  return Math.min(photo.width / wIn, photo.height / hIn) / Math.max(1, zoom)
}

export default function MagPageView({
  page,
  photoIds,
  photoMap,
  adjusts,
  pageKey,
  selectedSlot,
  onSlotClick,
  onAdjust,
  interactive = true,
  texts,
  selectedTextId,
  onTextSelect,
  onTextMove,
}: {
  page: MagPage
  photoIds: (string | null)[]
  photoMap: Map<string, MagPhoto>
  adjusts: Record<string, MagAdjust>
  /** Prefix for adjust keys: `${pageKey}::${slotIdx}` */
  pageKey: string
  selectedSlot: number
  onSlotClick?: (slotIdx: number) => void
  onAdjust?: (slotIdx: number, next: MagAdjust) => void
  interactive?: boolean
  /** Text blocks with names/date already filled in. */
  texts?: MagText[]
  selectedTextId?: string | null
  onTextSelect?: (id: string) => void
  onTextMove?: (id: string, x: number, y: number) => void
}) {
  const drag = useRef<{ id: string; sx: number; sy: number; x0: number; y0: number; w: number; h: number; moved: boolean } | null>(null)
  const textEditable = interactive && !!onTextSelect
  const rootRef = useRef<HTMLDivElement>(null)
  // Hand tools for the selected photo: corner rotate, edge zoom, pinch, ctrl-wheel.
  const rotDrag = useRef<{ cx: number; cy: number; a0: number; r0: number } | null>(null)
  const zoomDrag = useRef<{ axis: 'x' | 'y'; c: number; d0: number; z0: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; z0: number } | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const selAdjRef = useRef<{ i: number; adj: MagAdjust } | null>(null)
  const onAdjustRef = useRef(onAdjust)
  onAdjustRef.current = onAdjust

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms the selected photo.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const cur = selAdjRef.current
      if (!cur || !(e.ctrlKey || e.metaKey) || !onAdjustRef.current) return
      const t = e.target as HTMLElement | null
      if (!t?.closest('[data-magslot-selected]')) return
      e.preventDefault()
      const z = clampZoom(cur.adj.zoom * Math.exp(-e.deltaY * 0.004))
      onAdjustRef.current(cur.i, { ...cur.adj, zoom: +z.toFixed(3) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const slots = page.slots.map(magSlotBox)
  const order = slots
    .map((s, i) => ({ i, z: s.z ?? 0 }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((x) => x.i)

  const bg = page.bg
  const bgPhoto =
    bg.kind === 'blur' && photoIds[bg.slot] ? photoMap.get(photoIds[bg.slot] as string) : undefined

  selAdjRef.current = null
  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${MAG_ASPECT}`,
        background: bg.kind === 'color' ? bg.color : '#ffffff',
        overflow: 'hidden',
        containerType: 'inline-size',
      }}
    >
      {bg.kind === 'blur' && bgPhoto && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgPhoto.preview}
            alt=""
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: `blur(${bg.blur}cqw)`,
              pointerEvents: 'none',
            }}
          />
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${bg.dim})` }} />
          {bg.tint && <div aria-hidden style={{ position: 'absolute', inset: 0, background: bg.tint }} />}
        </>
      )}

      {(page.decor ?? []).map((d, di) => (
        <div
          key={`d${di}`}
          aria-hidden
          style={{
            position: 'absolute',
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: `${d.w}%`,
            height: `${d.h}%`,
            background: d.fill === 'accent' ? page.accent : d.fill,
          }}
        />
      ))}

      {order.map((i) => {
        const s = slots[i]
        const circle = s.shape === 'circle'
        const pid = photoIds[i]
        const photo = pid ? photoMap.get(pid) : undefined
        const adj = adjusts[`${pageKey}::${i}`] ?? MAG_DEFAULT_ADJUST
        const selected = selectedSlot === i
        const rot = adj.rotate ?? 0
        const effZ =
          photo && photo.width && photo.height
            ? effectiveZoom(adj.zoom, photo.width / photo.height, (s.w / s.h) * MAG_ASPECT, rot)
            : adj.zoom
        const slotAdjust: SlotAdjust = {
          panX: adj.panX,
          panY: adj.panY,
          zoom: effZ,
          rotate: rot,
          flipH: false,
          flipV: false,
        }
        const handsOn = selected && !!photo && !!onAdjust && interactive
        if (handsOn) selAdjRef.current = { i, adj }
        const lowRes = photo ? slotDpi(photo, s, adj.zoom) < 150 : false
        return (
          <div
            key={i}
            data-magslot-selected={handsOn ? '' : undefined}
            onPointerDownCapture={
              handsOn
                ? (e) => {
                    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
                    if (pointers.current.size >= 2) {
                      const [a, b] = Array.from(pointers.current.values())
                      pinch.current = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: adj.zoom }
                      e.stopPropagation()
                    }
                  }
                : undefined
            }
            onPointerMoveCapture={
              handsOn
                ? (e) => {
                    if (!pointers.current.has(e.pointerId)) return
                    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
                    if (pinch.current && pointers.current.size >= 2) {
                      const [a, b] = Array.from(pointers.current.values())
                      const z = clampZoom(pinch.current.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist))
                      onAdjust?.(i, { ...adj, zoom: +z.toFixed(3) })
                      setLabel(`${Math.round(z * 100)}%`)
                      e.stopPropagation()
                    }
                  }
                : undefined
            }
            onPointerUpCapture={
              handsOn
                ? (e) => {
                    pointers.current.delete(e.pointerId)
                    if (pointers.current.size < 2 && pinch.current) {
                      pinch.current = null
                      setLabel(null)
                    }
                  }
                : undefined
            }
            onPointerCancelCapture={
              handsOn
                ? (e) => {
                    pointers.current.delete(e.pointerId)
                    pinch.current = null
                    setLabel(null)
                  }
                : undefined
            }
            onClick={
              interactive
                ? (e) => {
                    e.stopPropagation()
                    onSlotClick?.(i)
                  }
                : undefined
            }
            style={{
              position: 'absolute',
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: circle ? `${s.w}%` : `calc(${s.w}% + 1px)`,
              height: circle ? `${s.h}%` : `calc(${s.h}% + 1px)`,
              borderRadius: circle ? '50%' : undefined,
              overflow: 'hidden',
              containerType: 'inline-size',
              cursor: interactive ? 'pointer' : 'default',
              touchAction: handsOn ? 'none' : undefined,
              outline: selected ? `3px solid ${GOLD}` : 'none',
              outlineOffset: -3,
              background: photo ? 'transparent' : '#efe7dc',
            }}
          >
            {photo ? (
              <SlotImage
                src={photo.preview}
                adjust={slotAdjust}
                onAdjustChange={
                  selected && onAdjust
                    ? (n) => {
                        if (pinch.current) return
                        onAdjust(i, { ...adj, panX: n.panX, panY: n.panY })
                      }
                    : undefined
                }
                style={{ filter: s.filter === 'bw' ? 'grayscale(1)' : undefined }}
              />
            ) : (
              interactive && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    border: '1.5px dashed rgba(184,150,90,0.6)',
                    borderRadius: 'inherit',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: GOLD,
                    fontSize: 10,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: 300, lineHeight: 1 }}>+</span>
                  Add photo
                </div>
              )
            )}
            {photo && s.frame && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: `max(1px, ${s.frame.pct}cqw) solid ${s.frame.color}`,
                  borderRadius: 'inherit',
                  pointerEvents: 'none',
                }}
              />
            )}
            {interactive && lowRes && (
              <span
                title="This photo may print soft at this size"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: circle ? '50%' : 4,
                  transform: circle ? 'translateX(50%)' : undefined,
                  background: '#b3261e',
                  color: '#fff',
                  fontSize: 8,
                  letterSpacing: 1,
                  padding: '2px 5px',
                  borderRadius: 3,
                  pointerEvents: 'none',
                }}
              >
                LOW RES
              </span>
            )}
          </div>
        )
      })}
      {(() => {
        const i = selectedSlot
        const s = i >= 0 ? slots[i] : undefined
        const pid = i >= 0 ? photoIds[i] : null
        if (!s || !pid || !photoMap.get(pid) || !onAdjust || !interactive) return null
        const adj = adjusts[`${pageKey}::${i}`] ?? MAG_DEFAULT_ADJUST
        const cl = (v: number) => Math.max(2.5, Math.min(97.5, v))
        const x0 = s.x
        const y0 = s.y
        const x1 = s.x + s.w
        const y1 = s.y + s.h
        const mx = (x0 + x1) / 2
        const my = (y0 + y1) / 2
        const corners: [number, number][] = [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ]
        const edges: { x: number; y: number; axis: 'x' | 'y' }[] = [
          { x: mx, y: y0, axis: 'y' },
          { x: x1, y: my, axis: 'x' },
          { x: mx, y: y1, axis: 'y' },
          { x: x0, y: my, axis: 'x' },
        ]
        const layerRect = () => (rootRef.current as HTMLDivElement).getBoundingClientRect()
        const end = (e: React.PointerEvent) => {
          rotDrag.current = null
          zoomDrag.current = null
          setLabel(null)
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {}
        }
        return (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 25 }}>
            {corners.map(([cx, cy], k) => (
              <div
                key={`r${k}`}
                title="Drag to rotate · Shift = 15° steps"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const r = layerRect()
                  const ccx = r.left + (mx / 100) * r.width
                  const ccy = r.top + (my / 100) * r.height
                  rotDrag.current = { cx: ccx, cy: ccy, a0: Math.atan2(e.clientY - ccy, e.clientX - ccx), r0: adj.rotate ?? 0 }
                  setLabel(`${Math.round(adj.rotate ?? 0)}°`)
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const d = rotDrag.current
                  if (!d) return
                  const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx)
                  let rr = d.r0 + ((a - d.a0) * 180) / Math.PI
                  rr = ((((rr + 180) % 360) + 360) % 360) - 180
                  const snap = Math.round(rr / 90) * 90
                  if (Math.abs(rr - snap) < 3) rr = snap
                  if (e.shiftKey) rr = Math.round(rr / 15) * 15
                  rr = Math.round(rr * 10) / 10
                  setLabel(`${Math.round(rr)}°`)
                  onAdjust(i, { ...adj, rotate: rr })
                }}
                onPointerUp={end}
                onPointerCancel={end}
                style={{
                  position: 'absolute',
                  left: `calc(${cl(cx)}% - 11px)`,
                  top: `calc(${cl(cy)}% - 11px)`,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  background: '#ffffff',
                  border: `2px solid ${GOLD}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
                  pointerEvents: 'auto',
                  cursor: 'grab',
                  touchAction: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: GOLD,
                  fontSize: 12,
                  lineHeight: 1,
                  userSelect: 'none',
                }}
              >
                ↻
              </div>
            ))}
            {edges.map((ed, k) => (
              <div
                key={`z${k}`}
                title="Drag to zoom · out = bigger, in = smaller"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const r = layerRect()
                  const c = ed.axis === 'x' ? r.left + (mx / 100) * r.width : r.top + (my / 100) * r.height
                  const pnt = ed.axis === 'x' ? e.clientX : e.clientY
                  zoomDrag.current = { axis: ed.axis, c, d0: Math.max(8, Math.abs(pnt - c)), z0: adj.zoom }
                  setLabel(`${Math.round(adj.zoom * 100)}%`)
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const d = zoomDrag.current
                  if (!d) return
                  const pnt = d.axis === 'x' ? e.clientX : e.clientY
                  const z = clampZoom(d.z0 * (Math.max(1, Math.abs(pnt - d.c)) / d.d0))
                  setLabel(`${Math.round(z * 100)}%${z >= MAG_MAX_ZOOM ? ' · max' : ''}`)
                  onAdjust(i, { ...adj, zoom: +z.toFixed(3) })
                }}
                onPointerUp={end}
                onPointerCancel={end}
                style={{
                  position: 'absolute',
                  left: `calc(${cl(ed.x)}% - ${ed.axis === 'y' ? 20 : 11}px)`,
                  top: `calc(${cl(ed.y)}% - ${ed.axis === 'y' ? 11 : 20}px)`,
                  width: ed.axis === 'y' ? 40 : 22,
                  height: ed.axis === 'y' ? 22 : 40,
                  pointerEvents: 'auto',
                  cursor: ed.axis === 'y' ? 'ns-resize' : 'ew-resize',
                  touchAction: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    width: ed.axis === 'y' ? 30 : 8,
                    height: ed.axis === 'y' ? 8 : 30,
                    borderRadius: 4,
                    background: '#ffffff',
                    border: `2px solid ${GOLD}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
                  }}
                />
              </div>
            ))}
            {label && (
              <div
                style={{
                  position: 'absolute',
                  left: `${mx}%`,
                  top: `${my}%`,
                  transform: 'translate(-50%, -50%)',
                  background: 'rgba(14,12,9,0.85)',
                  color: GOLD,
                  border: `1px solid ${GOLD}`,
                  borderRadius: 30,
                  padding: '6px 14px',
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </div>
            )}
          </div>
        )
      })()}
      {(texts ?? []).map((tx) => {
        const selected = selectedTextId === tx.id
        return (
          <div
            key={tx.id}
            data-magtext={tx.id}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={
              textEditable
                ? (e) => {
                    e.stopPropagation()
                    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                    drag.current = { id: tx.id, sx: e.clientX, sy: e.clientY, x0: tx.x, y0: tx.y, w: r.width, h: r.height, moved: false }
                    onTextSelect?.(tx.id)
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }
                : undefined
            }
            onPointerMove={
              textEditable
                ? (e) => {
                    const d = drag.current
                    if (!d || d.id !== tx.id) return
                    const dx = e.clientX - d.sx
                    const dy = e.clientY - d.sy
                    if (!d.moved && Math.hypot(dx, dy) < 3) return
                    d.moved = true
                    const nx = Math.max(0, Math.min(100, d.x0 + (dx / d.w) * 100))
                    const ny = Math.max(0, Math.min(100, d.y0 + (dy / d.h) * 100))
                    onTextMove?.(tx.id, +nx.toFixed(2), +ny.toFixed(2))
                  }
                : undefined
            }
            onPointerUp={
              textEditable
                ? (e) => {
                    drag.current = null
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId)
                    } catch {}
                  }
                : undefined
            }
            style={{
              ...magTextStyle(tx, MAG_ASPECT),
              zIndex: 20,
              pointerEvents: textEditable ? 'auto' : 'none',
              cursor: textEditable ? 'move' : 'default',
              touchAction: textEditable ? 'none' : undefined,
              userSelect: 'none',
              outline: selected ? `1.5px dashed ${GOLD}` : textEditable ? '1px dashed rgba(184,150,90,0)' : undefined,
              outlineOffset: 4,
            }}
            className={textEditable ? 'mag-text-edit' : undefined}
          >
            {tx.text}
          </div>
        )
      })}
      {textEditable && <style>{`.mag-text-edit:hover{outline-color:rgba(184,150,90,0.7)!important}`}</style>}
    </div>
  )
}
