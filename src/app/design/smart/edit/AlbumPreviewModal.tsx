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

// Mirrors LEATHER_HEX in render-cover.ts. Used to colour the spine
// shadow on the cover preview so it matches the leather chosen on
// leather + acrylic covers.
const LEATHER_HEX: Record<string, string> = {
  black: '#1a1816',
  brown: '#5a3a1a',
  ivory: '#f0e6d2',
  burgundy: '#5e1014',
}

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
      // Match the CSS animation duration below (the 0.6s flip).
      window.setTimeout(() => {
        setIdx(next)
        setFlipping(null)
      }, 600)
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
            coverType={cover?.type ?? 'photo'}
            leatherHex={LEATHER_HEX[cover?.leatherColor ?? 'black'] ?? '#1a1816'}
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
  coverType,
  leatherHex,
  onPrev,
  onNext,
}: {
  pages: Page[]
  idx: number
  flipping: 'next' | 'prev' | null
  aspect: number
  isStandard: boolean
  coverType: 'leather' | 'acrylic' | 'photo'
  leatherHex: string
  onPrev: () => void
  onNext: () => void
}) {
  const page = pages[idx]
  if (!page) return null

  // During a flip, the BACK face shows the page we're flipping to.
  // We pre-compute it so the CSS card-flip can swap front↔back
  // smoothly with backface-visibility.
  const targetIdx =
    flipping === 'next' ? idx + 1 : flipping === 'prev' ? idx - 1 : null
  const targetPage =
    targetIdx != null && targetIdx >= 0 && targetIdx < pages.length
      ? pages[targetIdx]
      : null

  return (
    <div
      style={{
        position: 'relative',
        height: 'min(88vh, calc(94vw / ' + aspect + '))',
        aspectRatio: `${aspect}`,
        userSelect: 'none',
        filter: 'drop-shadow(0 24px 36px rgba(0,0,0,0.55))',
        // Perspective is set on the OUTER wrapper so the 3D flip
        // reads properly across the whole page.
        perspective: '2400px',
      }}
    >
      {/* Flipper: a preserve-3d container that physically rotates
          180° during a turn. Front face = current page; back face =
          target page (pre-rotated 180° so it shows correctly at the
          end of the flip). backface-visibility hides whichever face
          is pointing away from the camera. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform:
            flipping === 'next'
              ? 'rotateY(-180deg)'
              : flipping === 'prev'
              ? 'rotateY(180deg)'
              : 'rotateY(0)',
          transition: 'transform 0.6s cubic-bezier(0.42, 0, 0.30, 1.0)',
        }}
      >
        {/* ── Front face: current page ── */}
        <PageFace
          page={page}
          isStandard={isStandard}
          coverType={coverType}
          leatherHex={leatherHex}
        />
        {/* ── Back face: target page, pre-rotated so it ends face-up
              when the flipper finishes its ±180° rotation. ── */}
        {targetPage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: 'rotateY(180deg)',
              backfaceVisibility: 'hidden',
            }}
          >
            <PageFace
              page={targetPage}
              isStandard={isStandard}
              coverType={coverType}
              leatherHex={leatherHex}
            />
          </div>
        )}
      </div>

      {/* Click zones sit ABOVE the flipper. They never rotate so the
          user can always press the next/prev edges. */}
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
          zIndex: 5,
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
          zIndex: 5,
        }}
      />
    </div>
  )
}

/**
 * PageFace — one face of the flipper. Shows the page image + the
 * appropriate overlays (centre gutter on spreads, spine shadow on
 * covers). Used twice in FlatFlipbook: once for the front face,
 * once for the back face during a flip.
 */
function PageFace({
  page,
  isStandard,
  coverType,
  leatherHex,
}: {
  page: Page
  isStandard: boolean
  coverType: 'leather' | 'acrylic' | 'photo'
  leatherHex: string
}) {
  const isSpread = page.kind === 'spread'
  const isCoverFront = page.kind === 'cover-front'
  const isCoverBack = page.kind === 'cover-back'

  // Cover spine colour: leather + acrylic show the chosen leather
  // colour (same as their physical binding); photo covers show a
  // soft dark spine cue since the print itself has no binding strip.
  const spineColor =
    coverType === 'leather' || coverType === 'acrylic'
      ? leatherHex
      : '#0a0806'

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backfaceVisibility: 'hidden',
        borderRadius: 3,
        overflow: 'hidden',
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
          background: '#15110b',
        }}
        draggable={false}
      />

      {/* ── Spread centre gutter ── */}
      {isSpread && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 2,
            transform: 'translateX(-1px)',
            pointerEvents: 'none',
            background: isStandard ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
            boxShadow: isStandard
              ? '0 0 12px 4px rgba(0,0,0,0.25)'
              : '0 0 8px 3px rgba(0,0,0,0.12)',
          }}
        />
      )}

      {/* ── Cover spine shadow ──
          For the FRONT cover the spine is on the LEFT (the binding
          side of the book). For the BACK cover the binding sits on
          the RIGHT. Leather + acrylic use the chosen leather colour
          (same binding as the physical product); photo covers get a
          soft dark spine shadow because the print itself wraps the
          photo and has no binding strip. */}
      {(isCoverFront || isCoverBack) && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [isCoverFront ? 'left' : 'right']: 0,
            width: '7%',
            pointerEvents: 'none',
            background: isCoverFront
              ? `linear-gradient(to right, ${spineColor} 0%, ${spineColor}cc 35%, transparent 100%)`
              : `linear-gradient(to left, ${spineColor} 0%, ${spineColor}cc 35%, transparent 100%)`,
            mixBlendMode:
              coverType === 'photo' ? 'multiply' : 'normal',
            opacity: coverType === 'photo' ? 0.55 : 0.85,
          }}
        />
      )}

      {/* ── Cover "thickness" cue ──
          A faint outside-edge shadow on the side opposite the spine
          suggests the album has depth — i.e., this is a closed book
          you're looking at, not a flat picture. */}
      {(isCoverFront || isCoverBack) && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [isCoverFront ? 'right' : 'left']: 0,
            width: '3%',
            pointerEvents: 'none',
            background: isCoverFront
              ? 'linear-gradient(to left, rgba(0,0,0,0.45), transparent)'
              : 'linear-gradient(to right, rgba(0,0,0,0.45), transparent)',
          }}
        />
      )}
    </div>
  )
}

