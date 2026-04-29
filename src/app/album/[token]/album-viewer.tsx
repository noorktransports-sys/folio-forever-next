'use client';

/**
 * AlbumViewer — the cinematic, read-only experience for a saved design.
 *
 * Flow:
 *   1. Land on cover (full-screen, dimmed background, large 3D-feeling
 *      cover face). Customer's title + subtitle on the cover, exactly
 *      as they composed it in the editor.
 *   2. Click "Open Album" (or press Enter / →). Cover swings open with
 *      a quick rotateY transition; spread carousel slides in.
 *   3. Spread carousel: one spread on screen at a time, big and centered.
 *      Left/right arrows, keyboard ← → navigation, page indicator at the
 *      bottom (e.g. "Spread 4 / 12"). Cursor / dots stay subtle.
 *   4. Past the last spread → "End" card with "View again" + (owner-only)
 *      "Edit this design" + a "Made with Folio & Forever" sigil.
 *
 * Layout maths mirror the builder's layouts[] table — same grid columns
 * and rows, so a 'Side by Side' spread renders identically here. Image
 * transforms (px/py/scale/rotate/flip/filter) are applied verbatim.
 *
 * Mobile is best-effort. ~90% of customers design on desktop and almost
 * all share-link viewing happens at a real screen — the carousel collapses
 * to vertical scroll-snap below 720px so it doesn't break, but no
 * cinematic effects there.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ----- types matching what album-builder.js writes -----

export interface PhotoSlot {
  src: string;
  px?: number;
  py?: number;
  scale?: number;
  rotate?: number;
  flipX?: boolean;
  flipY?: boolean;
  filter?: string;
}

export interface Spread {
  layoutId: number;
  slots: Array<PhotoSlot | string | null>;
  bgColor?: string;
}

export interface CoverSnapshot {
  type?: 'leather' | 'acrylic' | 'photo' | string;
  leatherColor?: string;
  photoSrc?: string | null;
  photoScale?: number;
  photoX?: number;
  photoY?: number;
  primaryText?: string;
  subtitleText?: string;
  fontId?: string;
  fontSize?: number;
  foilColor?: string;
  textColor?: string;
  position?: string;
}

export interface SavedDesign {
  version?: number;
  size?: string;
  totalSpreads?: number;
  spreadData?: Spread[];
  uploadedPhotos?: Record<string, string>;
  cover?: CoverSnapshot | null;
  customer?: { email?: string; name?: string; deferred?: boolean } | null;
  savedAt?: string;
}

// Layout grid templates — must match album-builder.js's `layouts` array.
const LAYOUTS: { cols: string; rows: string; slots: number }[] = [
  { cols: '1fr', rows: '1fr', slots: 1 },
  { cols: '1fr 1fr', rows: '1fr', slots: 2 },
  { cols: '2fr 1fr', rows: '1fr', slots: 2 },
  { cols: '1fr 2fr', rows: '1fr', slots: 2 },
  { cols: '1fr 1fr 1fr', rows: '1fr', slots: 3 },
  { cols: '1fr 1fr', rows: '2fr 1fr', slots: 3 },
  { cols: '1fr 1fr', rows: '1fr 2fr', slots: 3 },
  { cols: '1fr 1fr', rows: '1fr 1fr', slots: 4 },
  { cols: '1fr 1fr 1fr', rows: '1fr 1fr', slots: 5 },
  { cols: '3fr 2fr', rows: '1fr 1fr', slots: 3 },
];

// Cover font registry — mirrors cover-builder.tsx FONTS array.
const COVER_FONTS: Record<string, { family: string; style?: 'italic' | 'normal' }> = {
  cormorant: { family: '"Cormorant Garamond", serif' },
  'cormorant-italic': { family: '"Cormorant Garamond", serif', style: 'italic' },
  playfair: { family: '"Playfair Display", serif' },
  cinzel: { family: '"Cinzel", serif' },
  italianno: { family: '"Italianno", cursive' },
  'great-vibes': { family: '"Great Vibes", cursive' },
  allura: { family: '"Allura", cursive' },
  ebgaramond: { family: '"EB Garamond", serif' },
  inter: { family: '"Inter", sans-serif' },
  lora: { family: '"Lora", serif' },
};

const LEATHER_BG: Record<string, string> = {
  ebony: 'linear-gradient(135deg, #1a1410 0%, #0e0a07 100%)',
  cognac: 'linear-gradient(135deg, #6b3a1f 0%, #4a2814 100%)',
  navy: 'linear-gradient(135deg, #2a3a5c 0%, #1a2640 100%)',
  bone: 'linear-gradient(135deg, #e8dec9 0%, #c8baa0 100%)',
  burgundy: 'linear-gradient(135deg, #6b2a3a 0%, #4a1a26 100%)',
  forest: 'linear-gradient(135deg, #2a4a3a 0%, #1a3026 100%)',
};

function slotData(raw: PhotoSlot | string | null): PhotoSlot | null {
  if (!raw) return null;
  if (typeof raw === 'string') return { src: raw };
  return raw;
}

function imgTransform(d: PhotoSlot): string {
  const s = d.scale ?? 1;
  const px = d.px ?? 0;
  const py = d.py ?? 0;
  const r = d.rotate ?? 0;
  const fx = d.flipX ? -1 : 1;
  const fy = d.flipY ? -1 : 1;
  return `translate(${px}px, ${py}px) scale(${s * fx}, ${s * fy}) rotate(${r}deg)`;
}

function CoverFace({ cover }: { cover: CoverSnapshot | null | undefined }) {
  const c = cover || {};
  const type = c.type || 'leather';
  const font = COVER_FONTS[c.fontId || 'cormorant'] || COVER_FONTS.cormorant;
  const titleSize = c.fontSize ?? 48;
  const photoTransform = `translate(${c.photoX ?? 0}px, ${c.photoY ?? 0}px) scale(${c.photoScale ?? 1})`;

  const isPhoto = (type === 'acrylic' || type === 'photo') && c.photoSrc;
  const isLeather = type === 'leather';

  const bg = isLeather
    ? LEATHER_BG[c.leatherColor || 'ebony'] || LEATHER_BG.ebony
    : '#1a1410';

  // Foil text on leather, custom textColor on photo cover.
  const titleColor = isLeather
    ? c.foilColor || '#d4b16a'
    : c.textColor || '#ffffff';

  return (
    <div
      className="album-cover-face"
      style={{
        background: bg,
      }}
    >
      {isPhoto && c.photoSrc ? (
        <div className="album-cover-photo-wrap">
          <img
            src={c.photoSrc}
            alt=""
            style={{
              transform: photoTransform,
              transformOrigin: 'center center',
            }}
          />
          <div className="album-cover-photo-shade" />
        </div>
      ) : null}
      <div className="album-cover-text">
        <div
          className="album-cover-title"
          style={{
            fontFamily: font.family,
            fontStyle: font.style || 'normal',
            fontSize: `${titleSize}px`,
            color: titleColor,
          }}
        >
          {c.primaryText || 'Our Story'}
        </div>
        {c.subtitleText ? (
          <div
            className="album-cover-subtitle"
            style={{ color: titleColor, fontFamily: font.family }}
          >
            {c.subtitleText}
          </div>
        ) : null}
      </div>
      <div className="album-cover-spine" />
    </div>
  );
}

function SpreadCard({ spread }: { spread: Spread }) {
  const layout = LAYOUTS[spread.layoutId] || LAYOUTS[0];
  return (
    <div
      className="album-spread"
      style={{
        background: spread.bgColor || '#f8f4ee',
      }}
    >
      <div
        className="album-spread-grid"
        style={{
          gridTemplateColumns: layout.cols,
          gridTemplateRows: layout.rows,
        }}
      >
        {spread.slots.map((raw, i) => {
          const d = slotData(raw);
          return (
            <div className="album-spread-cell" key={i}>
              {d ? (
                <img
                  src={d.src}
                  alt=""
                  style={{
                    transform: imgTransform(d),
                    filter: d.filter || undefined,
                  }}
                />
              ) : (
                <div className="album-spread-empty" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AlbumViewer({
  design,
  token,
}: {
  design: SavedDesign;
  token: string;
}) {
  const spreads = useMemo<Spread[]>(
    () => (Array.isArray(design.spreadData) ? design.spreadData : []),
    [design.spreadData],
  );
  const total = spreads.length;

  // Stage: 'cover' (initial), 'spreads' (carousel), 'end' (final card).
  const [stage, setStage] = useState<'cover' | 'spreads' | 'end'>('cover');
  const [index, setIndex] = useState(0);

  // Owner detection: only the device that designed this gets the Edit
  // affordance. Photographers / family receiving the link see no editor
  // entry point.
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('folio-customer-v1');
      if (!raw) return;
      const stored = JSON.parse(raw) as { email?: string };
      const ownerEmail = (design.customer?.email || '').trim().toLowerCase();
      const localEmail = (stored.email || '').trim().toLowerCase();
      if (ownerEmail && localEmail && ownerEmail === localEmail) {
        setIsOwner(true);
      }
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, [design.customer?.email]);

  const next = useCallback(() => {
    if (stage === 'cover') {
      setStage(total > 0 ? 'spreads' : 'end');
      return;
    }
    if (stage === 'spreads') {
      if (index >= total - 1) {
        setStage('end');
      } else {
        setIndex((i) => i + 1);
      }
    }
  }, [stage, index, total]);

  const prev = useCallback(() => {
    if (stage === 'end') {
      setStage(total > 0 ? 'spreads' : 'cover');
      setIndex(Math.max(0, total - 1));
      return;
    }
    if (stage === 'spreads') {
      if (index <= 0) {
        setStage('cover');
      } else {
        setIndex((i) => i - 1);
      }
    }
  }, [stage, index, total]);

  // Keyboard navigation: ← → for spreads, Enter to advance from cover.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || (stage === 'cover' && e.key === 'Enter')) {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, stage]);

  const sizeLabel = design.size || '';
  const customerName = design.customer?.name || '';
  const editLink = `/design?d=${encodeURIComponent(token)}`;

  const carouselRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="album-viewer">
      {/* Top bar — minimal, doesn't compete with the album */}
      <header className="album-top">
        <Link href="/" className="album-brand">
          FOLIO &amp; FOREVER
        </Link>
        <div className="album-meta">
          {customerName ? <span>{customerName}</span> : null}
          {sizeLabel ? <span>{sizeLabel}</span> : null}
          <span>{total} spread{total === 1 ? '' : 's'}</span>
        </div>
      </header>

      {/* Stage: Cover */}
      {stage === 'cover' ? (
        <section className="album-stage album-stage-cover">
          <div className="album-cover-pedestal">
            <div className="album-cover-shadow" />
            <CoverFace cover={design.cover} />
          </div>
          <div className="album-cover-cta">
            <button
              type="button"
              className="album-open-btn"
              onClick={next}
              autoFocus
            >
              Open album
            </button>
            <div className="album-cover-hint">
              Press <kbd>Enter</kbd> or <kbd>→</kbd>
            </div>
          </div>
        </section>
      ) : null}

      {/* Stage: Spreads carousel */}
      {stage === 'spreads' ? (
        <section className="album-stage album-stage-spreads">
          <button
            type="button"
            className="album-nav album-nav-prev"
            onClick={prev}
            aria-label="Previous spread"
          >
            ‹
          </button>
          <div className="album-carousel" ref={carouselRef}>
            <div
              className="album-carousel-track"
              style={{ transform: `translateX(-${index * 100}%)` }}
            >
              {spreads.map((s, i) => (
                <div className="album-carousel-cell" key={i}>
                  <SpreadCard spread={s} />
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="album-nav album-nav-next"
            onClick={next}
            aria-label="Next spread"
          >
            ›
          </button>
          <div className="album-progress">
            Spread {index + 1} <span>of {total}</span>
          </div>
        </section>
      ) : null}

      {/* Stage: End */}
      {stage === 'end' ? (
        <section className="album-stage album-stage-end">
          <div className="album-end-card">
            <div className="album-end-tag">The end</div>
            <h2 className="album-end-title">
              {customerName ? `${customerName}'s album` : 'Your album'}
            </h2>
            <p className="album-end-desc">
              Saved with Folio &amp; Forever. Your link works for 60 days.
            </p>
            <div className="album-end-actions">
              <button
                type="button"
                className="album-end-secondary"
                onClick={() => {
                  setStage('cover');
                  setIndex(0);
                }}
              >
                View again
              </button>
              {isOwner ? (
                <Link href={editLink} className="album-end-primary">
                  Edit this design
                </Link>
              ) : (
                <Link href="/design" className="album-end-primary">
                  Start your own
                </Link>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
