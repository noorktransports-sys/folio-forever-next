'use client'

/**
 * AlbumPreviewModal — full-screen "open the book" preview.
 *
 * A lightweight CSS flipbook that reads as a real bound album:
 * page-edge stacks on either side for depth, a centre gutter on
 * every spread (deeper on standard hardcover, softer on layflat),
 * and a small 3D page-lift tilt on each turn. Renders all composites
 * once when the modal opens and revokes their object URLs on close.
 *
 * Order: front cover → spread 1 → … → back cover. Use ←/→ to flip;
 * click the right half to advance, the left half to go back.
 *
 * Earlier revisions tried a Three.js 3D book scene here. It was
 * brittle on real hardware (off-centre rendering, ambiguous click
 * targets) so the flat flipbook is now the only view — it's the
 * one that survives contact with users.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderSpreadComposite } from './render-spread'
import { renderCoverComposite } from './render-cover'
import {
  TEMPLATE_BY_ID,
  type Spread,
  type LayoutTemplate,
  type Slot,
} from '@/lib/smart-layout/templates'

// Note: A Three.js 3D preview lived here in an earlier revision but
// proved fiddly on real hardware. We now ship the lightweight CSS
// flipbook on every device — it loads fast, never gets stuck, and
// reads as "this is my album" without users needing to learn how to
// drag/tilt.

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
        background: '#0a0806',
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
        {pages && (
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
      {pages && (
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

  // A spread is rendered as an OPEN book (two pages side-by-side with
  // a strong centre gutter). Covers are rendered as a SINGLE closed
  // page — the whole leather frame still wraps it, but no gutter is
  // drawn. This is what makes the preview unmistakably an album.
  const isSpread = page.kind === 'spread'

  // ── Visual constants for the leather book frame ──
  // FRAME_PX = leather visible around the open spread (paper edges
  // poke out of this; the gutter sits flush with it).
  const FRAME_PX = 22
  // GUTTER_PX = width of the centre binding shadow on a spread.
  const GUTTER_PX = 28
  // The page-edge stacks (paper sheets visible on either side of the
  // current page) scale with how many turns have / haven't happened.
  const turned = idx
  const remaining = pages.length - idx - 1
  const leftEdgeWidth = Math.max(0, Math.min(turned * 1.4, 26))
  const rightEdgeWidth = Math.max(0, Math.min(remaining * 1.4, 26))

  return (
    <div
      style={{
        position: 'relative',
        // Outer width is determined by aspect + capped by viewport.
        // We add FRAME_PX*2 + edge-stack widths to the inner aspect
        // box so the whole thing (leather + edges + pages) fits.
        height: 'min(86vh, calc(90vw / ' + aspect + '))',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        // Strong table shadow so the book reads as sitting on a surface.
        filter: 'drop-shadow(0 38px 50px rgba(0,0,0,0.7))',
        // A bit of perspective for the page-turn tilt.
        perspective: '2200px',
      }}
    >
      {/* ── Left paper-edge stack (pages already turned) ── */}
      <div
        aria-hidden
        style={{
          width: leftEdgeWidth,
          height: '94%',
          alignSelf: 'center',
          background:
            // Cream paper colour, slightly darker at the spine side,
            // with a hairline-stripe pattern suggesting sheets.
            'linear-gradient(to right, #d8c39a 0%, #c9b285 80%, #6f5a3a 100%), repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgba(60,40,20,0.18) 2px, rgba(60,40,20,0.18) 3px)',
          backgroundBlendMode: 'multiply',
          borderRadius: '2px 0 0 2px',
          boxShadow: 'inset -3px 0 6px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      />

      {/* ── Leather book frame around the open spread ── */}
      <div
        style={{
          // Aspect-driven height; leather frame adds padding on top.
          flex: '0 1 auto',
          aspectRatio: `${aspect}`,
          height: '100%',
          // The leather itself — deep brown, slight gradient for cover
          // material feel, rounded outer corners.
          background:
            'linear-gradient(135deg, #2a1f12 0%, #1a120a 45%, #0f0a05 100%)',
          padding: FRAME_PX,
          borderRadius: 6,
          boxShadow:
            'inset 0 0 0 1px rgba(140,110,70,0.25), inset 0 2px 6px rgba(0,0,0,0.6)',
          position: 'relative',
          transformStyle: 'preserve-3d',
          transformOrigin:
            flipping === 'next' ? 'left center' : flipping === 'prev' ? 'right center' : 'center',
          transform:
            flipping === 'next'
              ? 'rotateY(-18deg)'
              : flipping === 'prev'
              ? 'rotateY(18deg)'
              : 'rotateY(0)',
          transition: 'transform 0.42s ease',
        }}
      >
        {/* Inner cream "paper mat" — gives the open pages a thin
            cream surround inside the leather. Looks like the paper
            edge peeking out around the print. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#e9dcc1',
            borderRadius: 2,
            boxShadow:
              'inset 0 0 0 1px rgba(0,0,0,0.25), 0 0 20px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.url}
            alt={page.label}
            style={{
              position: 'absolute',
              inset: 4, // 4px paper mat showing through around the image
              width: 'calc(100% - 8px)',
              height: 'calc(100% - 8px)',
              objectFit: 'contain',
              background: '#15110b',
              borderRadius: 1,
            }}
            draggable={false}
          />
          {/* ── Centre gutter — drawn for EVERY spread, hardcover or
              layflat. The dark wedge in the middle is what makes the
              spread read as TWO pages on one open book instead of a
              single merged photo. ── */}
          {isSpread && (
            <>
              {/* Soft wide shadow on either side of the binding so
                  the paper looks like it curves into the spine. */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: GUTTER_PX,
                  transform: `translateX(-${GUTTER_PX / 2}px)`,
                  pointerEvents: 'none',
                  background: isStandard
                    ? 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.85) 50%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0) 100%)'
                    : 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.55) 50%, rgba(0,0,0,0.35) 65%, rgba(0,0,0,0) 100%)',
                }}
              />
              {/* Hard binding line right down the centre. Always
                  visible — proves the spread is two pages. */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: 2,
                  transform: 'translateX(-1px)',
                  background: isStandard
                    ? 'rgba(0,0,0,0.85)'
                    : 'rgba(0,0,0,0.55)',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}
          {/* Click zones on the visible pages */}
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

      {/* ── Right paper-edge stack (pages still to come) ── */}
      <div
        aria-hidden
        style={{
          width: rightEdgeWidth,
          height: '94%',
          alignSelf: 'center',
          background:
            'linear-gradient(to left, #d8c39a 0%, #c9b285 80%, #6f5a3a 100%), repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgba(60,40,20,0.18) 2px, rgba(60,40,20,0.18) 3px)',
          backgroundBlendMode: 'multiply',
          borderRadius: '0 2px 2px 0',
          boxShadow: 'inset 3px 0 6px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      />
    </div>
  )
}

