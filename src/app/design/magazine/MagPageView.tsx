'use client'

// One magazine page (8.5 × 11 portrait) rendered in the DOM. Mirrors the
// print renderer (render-spread.ts) layer for layer so what the client
// sees is what prints: background (colour / blurred photo + tint) →
// rust decor → photos in z-order (circles, frames, B&W) .

import { SlotImage, type SlotAdjust } from '../smart/edit/PanSlider'
import {
  MAG_ASPECT,
  magSlotBox,
  type MagPage,
} from '@/lib/magazine/pages'

export type MagAdjust = { panX: number; panY: number; zoom: number }
export const MAG_DEFAULT_ADJUST: MagAdjust = { panX: 50, panY: 50, zoom: 1 }

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
}) {
  const slots = page.slots.map(magSlotBox)
  const order = slots
    .map((s, i) => ({ i, z: s.z ?? 0 }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((x) => x.i)

  const bg = page.bg
  const bgPhoto =
    bg.kind === 'blur' && photoIds[bg.slot] ? photoMap.get(photoIds[bg.slot] as string) : undefined

  return (
    <div
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
        const slotAdjust: SlotAdjust = {
          panX: adj.panX,
          panY: adj.panY,
          zoom: adj.zoom,
          rotate: 0,
          flipH: false,
          flipV: false,
        }
        const lowRes = photo ? slotDpi(photo, s, adj.zoom) < 150 : false
        return (
          <div
            key={i}
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
                    ? (n) => onAdjust(i, { panX: n.panX, panY: n.panY, zoom: adj.zoom })
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
    </div>
  )
}
