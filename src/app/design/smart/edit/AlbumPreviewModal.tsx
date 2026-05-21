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
  // a centre gutter). A cover page is rendered as a SINGLE closed
  // page. The book frame around either gives the "this is a book"
  // visual that was missing before.
  const isSpread = page.kind === 'spread'

  // Visible page-edge stacks on either side of the current "leaf"
  // give the book some depth: pages-already-turned on the left,
  // pages-still-to-come on the right.
  const turned = idx
  const remaining = pages.length - idx - 1

  return (
    <div
      style={{
        position: 'relative',
        // Fit within the viewport: cap by height (88vh) and let aspect
        // do the rest. A single cover face is narrower (coverAspect <
        // spreadAspect) so it naturally shows smaller.
        height: 'min(88vh, calc(92vw / ' + aspect + '))',
        aspectRatio: `${aspect}`,
        perspective: '2200px',
        userSelect: 'none',
        // Deep table-shadow under the whole book so it reads as
        // sitting on a surface.
        filter: 'drop-shadow(0 40px 50px rgba(0,0,0,0.6))',
      }}
    >
      {/* Stacked page-edges on the LEFT (already-turned pages) */}
      {turned > 0 && (
        <PageEdgeStack side="left" count={Math.min(turned, 18)} />
      )}
      {/* Stacked page-edges on the RIGHT (pages still to come) */}
      {remaining > 0 && (
        <PageEdgeStack side="right" count={Math.min(remaining, 18)} />
      )}

      {/* The current visible page (or open spread) — sits ON TOP of
          the page-edge stacks. A subtle Y-rotate during flip gives a
          physical "page lifting" cue. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transformOrigin:
            flipping === 'next' ? 'left center' : flipping === 'prev' ? 'right center' : 'center',
          transform:
            flipping === 'next'
              ? 'rotateY(-22deg)'
              : flipping === 'prev'
              ? 'rotateY(22deg)'
              : 'rotateY(0)',
          transition: 'transform 0.42s ease',
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
            // A subtle paper-coloured backdrop so any letterboxing
            // around contain-fit pictures reads as "page", not "void".
            background: '#15110b',
            borderRadius: 4,
            boxShadow:
              '0 22px 38px rgba(0,0,0,0.55), 0 6px 14px rgba(0,0,0,0.4)',
          }}
          draggable={false}
        />
        {/* Centre gutter — drawn for EVERY spread, not just standard.
            This is the visual that makes the page read as TWO pages
            of one open book rather than one merged image. */}
        {isSpread && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: '2%',
              bottom: '2%',
              width: 14,
              transform: 'translateX(-7px)',
              pointerEvents: 'none',
              background: isStandard
                ? // Standard hardcover: deep, hard gutter shadow
                  'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0) 100%)'
                : // Layflat: very soft seam (barely visible)
                  'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0) 100%)',
            }}
          />
        )}
        {/* Inner page-edge highlight on either side: a slim warm
            stripe that looks like the cut edge of paper catching
            light. Helps the book feel tangible. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'linear-gradient(to right, #b9985f, transparent)',
            opacity: 0.35,
            pointerEvents: 'none',
            borderRadius: '4px 0 0 4px',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'linear-gradient(to left, #b9985f, transparent)',
            opacity: 0.35,
            pointerEvents: 'none',
            borderRadius: '0 4px 4px 0',
          }}
        />
        {/* Click zones: left half = prev, right half = next */}
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

/**
 * PageEdgeStack — the thin stack of paper sticking out on either
 * side of the visible page, used as a depth cue so the album reads
 * as a real bound book rather than a single flat image.
 */
function PageEdgeStack({
  side,
  count,
}: {
  side: 'left' | 'right'
  count: number
}) {
  // Each "page edge" is a 1px hairline. Stack them just outside the
  // visible page on the side that matches its position in the book.
  // For a SPREAD (open book) the stack hugs the outer edge of the
  // appropriate half. For a single page (cover/back) the stack hugs
  // the outer edge of the whole page.
  const totalWidth = Math.min(count * 0.6, 14) // px
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: '1.5%',
        bottom: '1.5%',
        width: totalWidth,
        // For a spread, the left stack lives at the LEFT edge of the
        // open book, and the right stack at the RIGHT edge — same as
        // the single-page case. The visible content always spans the
        // full frame, so edges sit just outside it.
        [side]: -totalWidth,
        background:
          side === 'left'
            ? 'linear-gradient(to right, rgba(255,242,217,0.05), rgba(220,200,170,0.4) 60%, rgba(120,100,80,0.6))'
            : 'linear-gradient(to left, rgba(255,242,217,0.05), rgba(220,200,170,0.4) 60%, rgba(120,100,80,0.6))',
        boxShadow:
          side === 'left'
            ? 'inset -1px 0 0 rgba(0,0,0,0.4)'
            : 'inset 1px 0 0 rgba(0,0,0,0.4)',
        borderRadius:
          side === 'left' ? '2px 0 0 2px' : '0 2px 2px 0',
        pointerEvents: 'none',
        // Subtle slant so the edges read as 3D paper, not a flat bar.
        transformOrigin: side === 'left' ? 'right center' : 'left center',
        // Faint stripe pattern to suggest individual sheets.
        backgroundImage:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 3px)',
      }}
    />
  )
}
