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
  // Order-state fields written by /api/submit-order. A draft has neither.
  status?: 'draft' | 'submitted';
  submittedAt?: string;
  orderId?: string;
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

  // Stages:
  //   cover     — landing screen with cover face + Open Album CTA
  //   spreads   — horizontal carousel of designed spreads
  //   end       — review card with Submit / Edit / Save & Share
  //   submitted — thank-you confirmation (only reachable post-submit)
  type Stage = 'cover' | 'spreads' | 'end' | 'submitted';
  const initialStage: Stage = design.status === 'submitted' ? 'cover' : 'cover';
  const [stage, setStage] = useState<Stage>(initialStage);
  const [index, setIndex] = useState(0);

  // Submission state — drives the end-card UI and the locked badge.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(
    design.orderId || null,
  );
  const isSubmitted = design.status === 'submitted' || !!submittedOrderId;

  // Owner detection: only the device that designed this gets the Edit
  // affordance. Photographers / family receiving the link see no editor
  // entry point.
  const [isOwner, setIsOwner] = useState(false);
  // Fallback cover: if the saved design pre-dates the cover-state mirror
  // fix, design.cover will be null. For the original customer's device
  // we can still pick the cover up from localStorage (folio-cover-v1)
  // so they don't see the "Our Story" placeholder.
  const [fallbackCover, setFallbackCover] = useState<CoverSnapshot | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('folio-customer-v1');
      const ownerEmail = (design.customer?.email || '').trim().toLowerCase();
      let onOwnersDevice = false;
      if (raw) {
        const stored = JSON.parse(raw) as { email?: string };
        const localEmail = (stored.email || '').trim().toLowerCase();
        if (ownerEmail && localEmail && ownerEmail === localEmail) {
          onOwnersDevice = true;
          setIsOwner(true);
        }
      }
      if (!design.cover && onOwnersDevice) {
        const c = localStorage.getItem('folio-cover-v1');
        if (c) {
          try {
            const parsed = JSON.parse(c) as { state?: CoverSnapshot };
            if (parsed && parsed.state) setFallbackCover(parsed.state);
          } catch { /* ignore */ }
        }
      }
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, [design.customer?.email, design.cover]);
  const effectiveCover = design.cover || fallbackCover;

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

  // Mobile scroll-spy: on phones the carousel is a vertical scroll-snap
  // column rather than a translate-X track. When the customer scrolls
  // through spreads with their finger, the highlighted page-number pill
  // in the side rail must follow them — otherwise pill 1 stays gold no
  // matter where they are. IntersectionObserver fires when each spread
  // crosses the middle of the viewport; whichever spread is most-visible
  // becomes the new index. Desktop ignores this — the carousel transform
  // already keeps index in sync.
  useEffect(() => {
    if (stage !== 'spreads') return;
    if (typeof window === 'undefined') return;
    const isMobile = window.matchMedia('(max-width: 720px)').matches;
    if (!isMobile) return;
    const cells = carouselRef.current?.querySelectorAll('.album-carousel-cell');
    if (!cells || cells.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.spreadIndex);
        if (!Number.isNaN(idx)) setIndex(idx);
      },
      { threshold: [0.5, 0.7, 0.9] },
    );
    cells.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [stage, total]);

  const sizeLabel = design.size || '';
  const customerName = design.customer?.name || '';
  const editLink = `/design?d=${encodeURIComponent(token)}`;

  /**
   * Submit album — the commit point. Confirms with the user, calls
   * /api/submit-order which (a) marks the KV record submitted with
   * a 1-year TTL, (b) emails the owner with photo download links,
   * (c) emails the customer their confirmation. On success transitions
   * to the thank-you stage.
   *
   * Disabled while in flight to prevent double-submits.
   */
  const submitAlbum = useCallback(async () => {
    if (submitting || isSubmitted) return;
    const ok = window.confirm(
      `Submit ${customerName ? customerName + "'s " : 'this '}album for production?\n\nWe'll email you within 24 hours with a proof + invoice. Photos will be locked from further edits.`,
    );
    if (!ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/submit-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        orderId?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSubmittedOrderId(data.orderId || 'pending');
      setStage('submitted');
    } catch (e) {
      setSubmitError(
        (e instanceof Error ? e.message : 'unknown error') +
          ' — please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitting, isSubmitted, customerName, token]);

  const carouselRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="album-viewer">
      {/* Top bar — minimal, doesn't compete with the album.
          Includes a "Cover" button that returns to the cover face from
          any stage. Originally there was only keyboard ← to back out of
          the carousel; users (correctly) couldn't tell that worked, so
          the button is now an explicit affordance always on screen. */}
      <header className="album-top">
        <Link href="/" className="album-brand">
          FOLIO &amp; FOREVER
        </Link>
        <div className="album-meta">
          {stage !== 'cover' ? (
            <button
              type="button"
              className="album-back-cover"
              onClick={() => {
                setStage('cover');
                setIndex(0);
              }}
              aria-label="Back to cover"
            >
              ← Cover
            </button>
          ) : null}
          {isSubmitted ? (
            <span className="album-badge-submitted" title="This album has been submitted for production">
              Submitted &#10003;
            </span>
          ) : null}
          {customerName ? <span>{customerName}</span> : null}
          {sizeLabel ? <span>{sizeLabel}</span> : null}
          <span>
            {total} spread{total === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      {/* Stage: Cover */}
      {stage === 'cover' ? (
        <section className="album-stage album-stage-cover">
          <div className="album-cover-pedestal">
            <div className="album-cover-shadow" />
            <CoverFace cover={effectiveCover} />
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
                <div
                  className="album-carousel-cell"
                  key={i}
                  data-spread-index={i}
                >
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
          {/* Quick-jump page numbers. Click any number to jump straight
              to that spread — beats clicking through six arrows when the
              user remembers "the photo I wanted to fix is on page 9".
              Wraps onto multiple rows for big albums; the active page
              gets a gold pill. The "Spread X of Y" text stays as a
              positional readout, just smaller and above the numbers. */}
          <div className="album-progress">
            <div className="album-progress-label">
              Spread {index + 1} <span>of {total}</span>
            </div>
            {total > 1 ? (
              <div
                className="album-page-numbers"
                role="tablist"
                aria-label="Jump to spread"
              >
                {spreads.map((_, i) => (
                  <button
                    type="button"
                    key={i}
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`Go to spread ${i + 1}`}
                    className={
                      'album-page-num' + (i === index ? ' is-active' : '')
                    }
                    onClick={() => {
                      setIndex(i);
                      // On mobile the carousel is a vertical scroll-snap
                      // column, not a translate-X track — setIndex alone
                      // doesn't move the viewport. Explicitly scroll the
                      // target cell into view so the side-rail jump works
                      // on phone too.
                      const cells = carouselRef.current?.querySelectorAll(
                        '.album-carousel-cell',
                      );
                      const cell = cells?.[i] as HTMLElement | undefined;
                      cell?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Stage: End — review screen with Submit album as primary CTA */}
      {stage === 'end' ? (
        <section className="album-stage album-stage-end">
          <div className="album-end-card">
            <div className="album-end-tag">
              {isSubmitted ? 'Order received' : 'Ready to submit?'}
            </div>
            <h2 className="album-end-title">
              {customerName ? `${customerName}'s album` : 'Your album'}
            </h2>
            <p className="album-end-desc">
              {isSubmitted
                ? `Order ${design.orderId || submittedOrderId || ''} is in production. We'll email you with a proof and invoice within 24 hours.`
                : 'Reviewed everything? Submitting locks the design and sends it to our team. You’ll get an emailed proof + invoice within 24 hours.'}
            </p>
            {submitError ? (
              <p className="album-end-error">{submitError}</p>
            ) : null}
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
              {isSubmitted ? null : isOwner ? (
                <Link href={editLink} className="album-end-secondary">
                  Edit
                </Link>
              ) : null}
              {isSubmitted ? (
                <span className="album-end-locked">Submitted &#10003;</span>
              ) : (
                <button
                  type="button"
                  className="album-end-primary"
                  disabled={submitting}
                  onClick={submitAlbum}
                >
                  {submitting ? 'Submitting…' : 'Submit album'}
                </button>
              )}
            </div>
            {!isSubmitted && isOwner ? (
              <p className="album-end-share-hint">
                Want feedback first? <Link href={editLink}>Go back to edit</Link>
                {' '}or share this preview link with someone before submitting.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Stage: Submitted — thank-you confirmation, only reachable after the
          Submit button click resolves successfully. The same content is
          shown on the end-stage when re-loading a submitted design, but
          this stage is the live "I just clicked submit" celebration. */}
      {stage === 'submitted' ? (
        <section className="album-stage album-stage-submitted">
          <div className="album-end-card">
            <div className="album-thanks-tick" aria-hidden>&#10003;</div>
            <div className="album-end-tag">Order submitted</div>
            <h2 className="album-end-title">Thank you</h2>
            <p className="album-end-desc">
              {customerName ? `${customerName}, your` : 'Your'} album order
              {' '}<strong>{submittedOrderId || design.orderId}</strong>{' '}
              is in. We&rsquo;ll email a proof + invoice within 24 hours.
              Save this link to come back any time.
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
                View album again
              </button>
              <Link href="/" className="album-end-primary">
                Back to home
              </Link>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
