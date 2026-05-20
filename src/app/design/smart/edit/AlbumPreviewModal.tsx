'use client'

/**
 * AlbumPreviewModal — full-screen "open the book" preview.
 *
 * Default view is a lightweight CSS flipbook (every device). On
 * capable hardware the client can toggle to a Three.js 3D book; the
 * toggle is silent on low-end devices where we already chose the
 * lighter view. Both views consume the same pre-rendered spread +
 * cover composites, so memory and code stay clean.
 *
 * Renders all composites once when the modal opens (revokes their
 * object URLs on close). Order: front cover → spread 1 → … → back
 * cover. Use ←/→ to flip; click the right half to advance, the left
 * half to go back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { renderSpreadComposite } from './render-spread'
import { renderCoverComposite } from './render-cover'
import {
  TEMPLATE_BY_ID,
  type Spread,
  type LayoutTemplate,
  type Slot,
} from '@/lib/smart-layout/templates'
import { is3DCapable } from '@/lib/device-capable'

// Lazy: Three.js book scene loads only when the 3D view is actually
// opened (auto on capable devices, manual toggle on cheap ones).
const AlbumPreview3D = dynamic(() => import('./AlbumPreview3D'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        color: '#b8965a',
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
      }}
    >
      Loading 3D book…
    </div>
  ),
})

// Local mirror of the SpreadText shape (lives in page.tsx); structural
// typing flows through render-spread without an explicit shared type.
interface SpreadText {
  id: string
  text: string
  xPct: number
  yPct: number
  widthPct: number
  sizePct: number
  color: string
  align: 'left' | 'center' | 'right'
  font: 'display' | 'serif' | 'sans' | 'elegant' | 'script' | 'hand' | 'castellar' | 'copperplate'
  weight: 400 | 700
}
// is3DCapable + AlbumPreview3D will be re-introduced in Phase 2 to add
// the Three.js book scene. Phase 1 ships a universal CSS flipbook so
// every device gets a working preview immediately.

interface Photo {
  id: string
  preview: string
  width: number
  height: number
}

interface SpreadBg {
  mode: 'paper' | 'color' | 'photo'
  color?: string
  photoId?: string
  blur?: number
  dim?: number
  zoom?: number
  panX?: number
  panY?: number
}

interface PhotoAdjust {
  zoom: number
  panX: number
  panY: number
  flipH: boolean
  flipV: boolean
  rotate: number
  fit: 'fill' | 'contain'
  borderWidth: number
  borderColor: string
}

interface CoverSpec {
  type: 'leather' | 'acrylic' | 'photo'
  leatherColor: string
  foilColor: string
  customTextHex: string
  fontId: string
  fontSize: number
  primaryText: string
  subtitleText: string
  position: string
  photoSrc: string | null
  backPhotoSrc: string | null
  photoScale: number
  photoX: number
  photoY: number
  titleX?: number
  titleY?: number
}

export interface AlbumPreviewModalProps {
  spreads: Spread[]
  photoMap: Map<string, Photo>
  adjusts: Record<string, PhotoAdjust>
  spreadBgs: Record<string, SpreadBg>
  spreadTexts: Record<string, SpreadText[]>
  cover: CoverSpec | null
  /** Spread WIDTH / HEIGHT ratio (e.g. 24/17 for 17×24 albums). */
  spreadAspect: number
  /** Standard albums show a gutter line; layflat doesn't. */
  isStandard: boolean
  /** Cover face aspect (W/H). Same as a single page. */
  coverAspect: number
  /** "17x24" → label for the header. */
  sizeLabel: string
  onClose: () => void
}

interface Page {
  url: string
  /** 'cover' = full-face cover image; 'spread' = full spread (2 pages). */
  kind: 'cover-front' | 'spread' | 'cover-back'
  /** Index label e.g. "Cover", "Spread 1 of 15", "Back cover". */
  label: string
}

export default function AlbumPreviewModal(props: AlbumPreviewModalProps) {
  const {
    spreads,
    photoMap,
    adjusts,
    spreadBgs,
    spreadTexts,
    cover,
    spreadAspect,
    isStandard,
    coverAspect,
    sizeLabel,
    onClose,
  } = props

  const [pages, setPages] = useState<Page[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idx, setIdx] = useState(0)
  const [flipping, setFlipping] = useState<'next' | 'prev' | null>(null)
  // Auto-pick 3D on capable devices; cheap-phone clients see the
  // CSS flipbook by default. Either view can be toggled at any time.
  const [mode, setMode] = useState<'flat' | '3d'>(() =>
    is3DCapable() ? '3d' : 'flat',
  )
  const objectUrls = useRef<string[]>([])

  // Build all composites in order, with light-weight progress text.
  useEffect(() => {
    let cancelled = false
    const made: string[] = []
    ;(async () => {
      try {
        const out: Page[] = []
        // Cover front (always present — coverState is guaranteed by the
        // wizard's required Cover step).
        if (cover) {
          const blob = await renderCoverComposite({
            type: cover.type,
            side: 'front',
            leatherColor: cover.leatherColor,
            foilColor: cover.foilColor,
            customTextHex: cover.customTextHex,
            fontId: cover.fontId,
            fontSize: cover.fontSize,
            primaryText: cover.primaryText,
            subtitleText: cover.subtitleText,
            position: cover.position,
            photoSrc: cover.photoSrc,
            backPhotoSrc: cover.backPhotoSrc,
            photoScale: cover.photoScale,
            photoX: cover.photoX,
            photoY: cover.photoY,
            titleX: cover.titleX,
            titleY: cover.titleY,
          })
          if (cancelled) return
          const u = URL.createObjectURL(blob)
          made.push(u)
          out.push({ url: u, kind: 'cover-front', label: 'Cover' })
        }
        // Spreads
        for (let i = 0; i < spreads.length; i++) {
          const s = spreads[i]
          const tpl: LayoutTemplate | undefined = TEMPLATE_BY_ID.get(
            s.templateId,
          )
          if (!tpl) continue
          // photoLookup: only photos used by this spread.
          const lookup = new Map<
            string,
            { id: string; preview: string; width: number; height: number }
          >()
          for (const pid of s.photoIds) {
            if (pid) {
              const p = photoMap.get(pid)
              if (p) lookup.set(pid, p)
            }
          }
          try {
            const blob = await renderSpreadComposite({
              spread: {
                id: s.id,
                templateId: s.templateId,
                photoIds: s.photoIds as (string | null)[],
              },
              template: { id: tpl.id, name: tpl.name, slots: tpl.slots as Slot[] },
              photos: lookup,
              adjusts,
              spreadAspectRatio: spreadAspect,
              showGutter: isStandard,
              bg: spreadBgs[s.id],
              texts: spreadTexts[s.id],
            })
            if (cancelled) return
            const u = URL.createObjectURL(blob)
            made.push(u)
            out.push({
              url: u,
              kind: 'spread',
              label: `Spread ${i + 1} of ${spreads.length}`,
            })
          } catch (e) {
            console.warn('preview: spread render failed', s.id, e)
          }
        }
        // Back cover (only for photo covers; leather/acrylic show the
        // same leather binding on the back so we render it too).
        if (cover) {
          const blob = await renderCoverComposite({
            type: cover.type,
            side: 'back',
            leatherColor: cover.leatherColor,
            foilColor: cover.foilColor,
            customTextHex: cover.customTextHex,
            fontId: cover.fontId,
            fontSize: cover.fontSize,
            primaryText: cover.primaryText,
            subtitleText: cover.subtitleText,
            position: cover.position,
            photoSrc: cover.photoSrc,
            backPhotoSrc: cover.backPhotoSrc,
            photoScale: cover.photoScale,
            photoX: cover.photoX,
            photoY: cover.photoY,
            titleX: cover.titleX,
            titleY: cover.titleY,
          })
          if (cancelled) return
          const u = URL.createObjectURL(blob)
          made.push(u)
          out.push({ url: u, kind: 'cover-back', label: 'Back cover' })
        }
        if (cancelled) return
        objectUrls.current = made
        setPages(out)
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Could not build the preview.',
          )
        }
      }
    })()
    return () => {
      cancelled = true
      for (const u of made) URL.revokeObjectURL(u)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!pages || flipping) return
      const next = idx + dir
      if (next < 0 || next >= pages.length) return
      setFlipping(dir > 0 ? 'next' : 'prev')
      // Match the CSS animation duration below.
      window.setTimeout(() => {
        setIdx(next)
        setFlipping(null)
      }, 420)
    },
    [idx, pages, flipping],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Cover pages are a single face (smaller); spreads are 2-up. Pick the
  // aspect of the currently visible page so the frame snaps to the
  // right shape.
  const currentAspect = useMemo(() => {
    const p = pages?.[idx]
    if (!p) return coverAspect
    return p.kind === 'spread' ? spreadAspect : coverAspect
  }, [pages, idx, coverAspect, spreadAspect])

  const pillStyle: React.CSSProperties = {
    background: 'transparent',
    border: '0.5px solid #b8965a',
    color: '#b8965a',
    borderRadius: 30,
    padding: '6px 14px',
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
      }}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: '#f3ece0',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          style={pillStyle}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          ← Close
        </button>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            color: '#f3ece0',
            marginLeft: 4,
          }}
        >
          Your album · {sizeLabel} · {isStandard ? 'Standard hardcover' : 'Layflat'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={
              mode === '3d'
                ? pillStyle
                : { ...pillStyle, background: '#b8965a', color: '#0e0c09', fontWeight: 700 }
            }
            onClick={(e) => {
              e.stopPropagation()
              setMode((m) => (m === '3d' ? 'flat' : '3d'))
            }}
            title={
              mode === '3d'
                ? 'Switch to the lightweight flipbook'
                : 'Open the album in a 3D book scene (capable devices)'
            }
          >
            {mode === '3d' ? 'Switch to simple view' : '✨ Open in 3D book'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 0,
          marginTop: 12,
        }}
      >
        {!pages && !error && (
          <div
            style={{
              color: '#b8965a',
              fontSize: 12,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            Building your album preview…
          </div>
        )}
        {error && (
          <div style={{ color: '#ff8a8a', fontSize: 14 }}>{error}</div>
        )}
        {pages && mode === '3d' && (
          <AlbumPreview3D
            pages={pages}
            spreadAspect={spreadAspect}
            coverAspect={coverAspect}
            isStandard={isStandard}
          />
        )}
        {pages && mode === 'flat' && (
          <FlatFlipbook
            pages={pages}
            idx={idx}
            flipping={flipping}
            aspect={currentAspect}
            isStandard={isStandard}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
          />
        )}
      </div>

      {/* Footer hint */}
      {pages && mode === 'flat' && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            color: '#8a7c66',
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase',
            textAlign: 'center',
            marginTop: 6,
          }}
        >
          {pages[idx]?.label}
          {' · '}
          ← / → keys · click the left/right edge to turn pages · Esc to close
        </div>
      )}
    </div>
  )
}

/* ─── Flat CSS flipbook ────────────────────────────────────────────── */

function FlatFlipbook({
  pages,
  idx,
  flipping,
  aspect,
  isStandard,
  onPrev,
  onNext,
}: {
  pages: Page[]
  idx: number
  flipping: 'next' | 'prev' | null
  aspect: number
  isStandard: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const page = pages[idx]
  if (!page) return null
  return (
    <div
      style={{
        position: 'relative',
        // Fit within the viewport: cap by height (90vh) and let aspect
        // do the rest. A single cover face is narrower (coverAspect <
        // spreadAspect) so it naturally shows smaller.
        height: 'min(90vh, calc(95vw / ' + aspect + '))',
        aspectRatio: `${aspect}`,
        perspective: '1800px',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          // The "flip" — rotate around the spine (left edge of the
          // right half) for forward; around right edge for back.
          transform:
            flipping === 'next'
              ? 'rotateY(-12deg)'
              : flipping === 'prev'
              ? 'rotateY(12deg)'
              : 'rotateY(0)',
          transition: 'transform 0.4s ease',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.url}
          alt={page.label}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            boxShadow:
              '0 30px 60px rgba(0,0,0,0.65), 0 8px 20px rgba(0,0,0,0.5)',
            background: '#0e0c09',
            borderRadius: 4,
          }}
          draggable={false}
        />
        {/* Gutter line — only for spreads on a STANDARD album */}
        {isStandard && page.kind === 'spread' && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 1,
              background:
                'linear-gradient(to right, rgba(0,0,0,0.45), rgba(0,0,0,0.12), rgba(0,0,0,0.45))',
              transform: 'translateX(-0.5px)',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* Invisible click zones: left half = prev, right half = next */}
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous page"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '50%',
            background: 'transparent',
            border: 'none',
            cursor: idx > 0 ? 'w-resize' : 'default',
          }}
        />
        <button
          type="button"
          onClick={onNext}
          aria-label="Next page"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '50%',
            background: 'transparent',
            border: 'none',
            cursor: idx < pages.length - 1 ? 'e-resize' : 'default',
          }}
        />
      </div>
    </div>
  )
}
