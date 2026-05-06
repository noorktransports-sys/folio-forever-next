'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import CoverBuilder, { type CoverState } from './cover-builder';
import './album-builder.css';

/**
 * Submitted-order lock contract (Phase 1 — localStorage only).
 *
 * When a user clicks "Place Order", album-builder.js writes a `folio-submitted`
 * key to localStorage with the order id + submission timestamp, then
 * dispatches a `folio:submitted` window event. This module reads both:
 *   1. On mount — restores the locked view after a refresh.
 *   2. On the event — flips to the locked view in the same session, before
 *      the user can navigate back into the designer.
 *
 * Per-browser, not per-user. A determined client can clear localStorage and
 * unlock; this is a "no accidental edits" guarantee, not a security control.
 * Once /api/submit-order + KV land (Phase 2) the lock becomes server-side
 * and persists across browsers.
 */
const SUBMITTED_KEY = 'folio-submitted';
type SubmittedRecord = { orderId: string; submittedAt: string };

function readSubmittedFromStorage(): SubmittedRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SUBMITTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.orderId === 'string') {
      return {
        orderId: parsed.orderId,
        submittedAt: typeof parsed.submittedAt === 'string'
          ? parsed.submittedAt
          : new Date().toISOString(),
      };
    }
  } catch { /* ignore corrupted entry */ }
  return null;
}

/**
 * Album Designer — ported from `folio-forever-child/page-album-designer.php`.
 *
 * The interactive logic still lives in `/public/js/album-builder.js` as
 * vanilla JS. That script declares functions on `window` (choosePath,
 * handleUpload, …) which the JSX `onClick` handlers below invoke. This is
 * deliberately a thin React wrapper so v1 ships at parity with the WP
 * version. A future pass will lift state into useReducer + components and
 * remove the window-scoped contract.
 *
 * The script is loaded with `afterInteractive` so it runs once React has
 * mounted and the DOM elements it queries (#photoGrid, #spreadCanvas, …)
 * actually exist. All interactive controls are no-ops until the script
 * loads; the optional chaining (`?.`) keeps that safe.
 */

// Helper: invoke a window-scoped function added by album-builder.js.
// Cast through `unknown` to satisfy TS without disabling strict mode.
function fb(name: string, ...args: unknown[]) {
  if (typeof window === 'undefined') return;
  const fn = (window as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[name];
  if (typeof fn === 'function') fn(...args);
}

/**
 * Step controls which view of the designer is shown:
 *   'spreads' — the legacy album-builder.js drag/drop spread editor.
 *   'cover'   — the React-based CoverBuilder (cover-builder.tsx).
 *
 * The spreads section is kept mounted (display: none) so that the legacy JS
 * keeps its module-scoped state (spreadData, uploadedPhotos, history) when
 * the user toggles between cover and spreads.
 */
type Step = 'spreads' | 'cover';

export default function DesignerPage() {
  const [step, setStep] = useState<Step>('spreads');
  const [photos, setPhotos] = useState<{ id: string; src: string }[]>([]);

  // Submit lock — `null` until we know (server-rendered HTML can't read
  // localStorage; we read it inside the first effect). The legacy JS is
  // still loaded on the unlocked render so it can wire up uploads etc.
  const [submitted, setSubmitted] = useState<SubmittedRecord | null>(null);

  useEffect(() => {
    // 1. Restore lock from a prior session.
    setSubmitted(readSubmittedFromStorage());

    // 2. Listen for in-session submits dispatched by album-builder.js.
    function onSubmitted(ev: Event) {
      const detail = (ev as CustomEvent<{ orderId?: string }>).detail;
      const orderId = detail?.orderId;
      if (!orderId) return;
      setSubmitted({
        orderId,
        submittedAt: new Date().toISOString(),
      });
    }
    window.addEventListener('folio:submitted', onSubmitted);
    return () => {
      window.removeEventListener('folio:submitted', onSubmitted);
    };
  }, []);

  /**
   * Clear the lock and reload the designer for a fresh order. Used by the
   * SubmittedView's "Start a new album" CTA. We reload rather than
   * re-mount so the legacy album-builder.js fully resets its module-scoped
   * state (spreadData, uploadedPhotos, history) — easier than tracking
   * down every globally-scoped reset.
   */
  function startNewAlbum() {
    try {
      window.localStorage.removeItem(SUBMITTED_KEY);
    } catch { /* ignore */ }
    window.location.reload();
  }

  // When locked, render the minimal confirmation view — no nav, no
  // designer. This is the post-submit experience whether the user just
  // clicked Place Order or returned days later.
  if (submitted) {
    return <SubmittedView record={submitted} onNewAlbum={startNewAlbum} />;
  }

  /**
   * Pulls the photo list from the legacy JS's `window.uploadedPhotos` map
   * and transitions to the cover step. Called from the nav "Submit Order"
   * button now that cover is part of the flow.
   */
  function goToCover() {
    const w = window as unknown as { uploadedPhotos?: Record<string, unknown> };
    const map = w.uploadedPhotos ?? {};
    const list = Object.entries(map).map(([id, val]) => ({
      id,
      src: typeof val === 'string' ? val : ((val as { src?: string })?.src ?? ''),
    })).filter((p) => p.src);
    setPhotos(list);
    setStep('cover');
  }

  /**
   * onContinue from CoverBuilder: stash the cover state on window where
   * the legacy submit modal will pick it up (Task #6 wires it into the
   * Stripe checkout payload), then open the modal as before.
   */
  function continueFromCover(cover: CoverState) {
    (window as unknown as { __coverState?: CoverState }).__coverState = cover;
    fb('openModal');
  }

  return (
    <>
      <Script src="/js/album-builder.js?v=20260505-3" strategy="afterInteractive" />

      {/* NAVBAR */}
      <nav>
        <Link href="/" className="nav-logo">
          FOLIO &amp; FOREVER
        </Link>
        <div className="nav-right">
          <Link href="/" className="nav-back">
            ← Back
          </Link>
          {/* Live running total — populated by renderPriceTag in
              album-builder.js. Hidden until a binding is selected so
              we don't show $275 before the customer has chosen anything. */}
          <span
            id="priceTag"
            className="price-tag"
            title="Total"
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="nav-submit"
            id="navSaveBtn"
            onClick={(e) => fb('saveDesign', { buttonEl: e.currentTarget })}
            style={{
              display: 'none',
              background: 'transparent',
              color: 'var(--gold)',
              border: '0.5px solid var(--gold)',
              marginRight: 6,
            }}
          >
            Save &amp; Share
          </button>
          <button
            type="button"
            className="nav-submit"
            id="navSubmitBtn"
            onClick={goToCover}
            style={{ display: 'none' }}
          >
            Next: Cover &rarr;
          </button>
        </div>
      </nav>

      {/* INTRO */}
      <div id="introSection">
        <div className="intro-section">
          <span className="page-tag">Design Your Album</span>
          <h1 className="page-title">
            How would you like it<br />
            <em>designed?</em>
          </h1>
          <p className="page-sub">
            Design it yourself using our simple builder, or let our expert
            team handle every spread.
          </p>
        </div>

        <div className="path-choice">
          {/* SELF DESIGN */}
          <div className="path-card" onClick={() => fb('choosePath', 'self')}>
            <div className="path-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="7" height="7" stroke="#b8965a" strokeWidth="0.8" />
                <rect x="11" y="2" width="7" height="4" stroke="#b8965a" strokeWidth="0.8" />
                <rect x="11" y="9" width="7" height="9" stroke="#b8965a" strokeWidth="0.8" />
                <rect x="2" y="12" width="7" height="6" stroke="#b8965a" strokeWidth="0.8" />
              </svg>
            </div>
            <p className="path-name">I&apos;ll design it</p>
            <span className="path-tagline">Self-design builder</span>
            <p className="path-desc">
              Upload your photos and place them into pre-built layouts.
              Simple drag and drop — no design skills needed.
            </p>
            <ul className="path-features">
              <li>Upload your photos directly</li>
              <li>12 curated layouts per spread</li>
              <li>Drag &amp; drop to fill each page</li>
              <li>Preview before submitting</li>
            </ul>
            <span className="path-price">
              Included <span>in your album price</span>
            </span>
            <button type="button" className="btn-path btn-path-secondary">
              Open the Builder
            </button>
          </div>

          {/* EXPERT DESIGN */}
          <div
            className="path-card recommended"
            onClick={() => fb('choosePath', 'expert')}
          >
            <div className="path-badge">Recommended</div>
            <div className="path-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 2l1.8 5.4H18l-4.7 3.4 1.8 5.5L10 13l-5.1 3.3 1.8-5.5L2 7.4h6.2z"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                  fill="none"
                />
              </svg>
            </div>
            <p className="path-name">We design it</p>
            <span className="path-tagline">Expert design service</span>
            <p className="path-desc">
              Upload your photos and our team professionally layouts every
              spread — beautifully composed, perfectly balanced.
            </p>
            <ul className="path-features">
              <li>Upload your photos</li>
              <li>Our designers handle everything</li>
              <li>Digital proof within 3 business days</li>
              <li>One round of revisions included</li>
            </ul>
            <span className="path-price">
              +$150 <span>design fee added to order</span>
            </span>
            <button type="button" className="btn-path btn-path-primary">
              Choose Expert Design
            </button>
          </div>
        </div>
      </div>

      {/* BINDING PICKER — shown after path-choice (Self), before builder.
          Picking a card calls selectBinding() in album-builder.js which
          flips this section off and the builder on. */}
      <div className="builder-section" id="bindingSection">
        <div className="binding-section">
          <span className="page-tag">Pick your album style</span>
          <h2 className="page-title">
            Lay-flat or<br />
            <em>coffee-table book?</em>
          </h2>
          <p className="page-sub">
            Both are hardcover — the difference is how the spreads
            behave. You can switch later, but we&apos;ll need to reset
            your layouts.
          </p>
          <div className="binding-choice">
            <div
              className="binding-card"
              onClick={() => fb('selectBinding', 'layflat')}
            >
              <div className="binding-thumb binding-thumb-layflat" aria-hidden="true">
                <div className="binding-thumb-page" />
              </div>
              <p className="binding-name">Lay-Flat Album</p>
              <span className="binding-tagline">No center seam</span>
              <p className="binding-desc">
                Pages lie completely flat across the spine. Photos can
                span the entire spread without losing the middle.
              </p>
              <ul className="binding-features">
                <li>Full-bleed photos across the spine</li>
                <li>Premium hand-bound construction</li>
                <li>Best for hero shots &amp; panoramas</li>
              </ul>
              <button type="button" className="btn-path btn-path-primary">
                Choose Lay-Flat
              </button>
            </div>

            <div
              className="binding-card"
              onClick={() => fb('selectBinding', 'hardcover')}
            >
              <div className="binding-thumb binding-thumb-hardcover" aria-hidden="true">
                <div className="binding-thumb-page" />
                <div className="binding-thumb-page" />
              </div>
              <p className="binding-name">Coffee-Table Book</p>
              <span className="binding-tagline">Press-printed hardcover</span>
              <p className="binding-desc">
                Hardcover and casebound, with a visible spine gutter
                between facing pages. Layouts keep photos clear of the
                binding.
              </p>
              <ul className="binding-features">
                <li>Crisp press-printed pages</li>
                <li>More pages at a friendlier price</li>
                <li>Photos sit fully on each page</li>
              </ul>
              <button type="button" className="btn-path btn-path-secondary">
                Choose Coffee-Table
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* COVER BUILDER (shown when step === 'cover') */}
      {step === 'cover' && (
        <CoverBuilder
          uploadedPhotos={photos}
          onBack={() => setStep('spreads')}
          onContinue={continueFromCover}
        />
      )}

      {/* SELF-DESIGN BUILDER */}
      <div
        className="builder-section"
        id="builderSection"
        hidden={step === 'cover'}
      >
        <div className="builder-wrap">
          {/* LEFT: Photos */}
          <div className="photo-panel">
            <div className="panel-header">
              <p className="panel-header-title">Your Photos</p>
              <label className="upload-zone" htmlFor="photoUpload">
                <input
                  type="file"
                  id="photoUpload"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => fb('handleUpload', e.nativeEvent)}
                />
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 22 22"
                  fill="none"
                  style={{ marginBottom: 8 }}
                >
                  <path
                    d="M11 15V7M11 7L8 10M11 7l3 3"
                    stroke="#b8965a"
                    strokeWidth="0.9"
                    strokeLinecap="round"
                  />
                  <rect x="2" y="2" width="18" height="18" rx="3" stroke="#b8965a" strokeWidth="0.5" />
                </svg>
                <div className="upload-text">
                  <strong>Upload Photos</strong>
                  Click or drag files here
                </div>
              </label>
            </div>
            <div className="photo-grid" id="photoGrid" />
            <div className="photo-count" id="photoCount">
              Upload photos to begin
            </div>
          </div>

          {/* CENTRE: Canvas */}
          <div className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="spread-nav">
                <button
                  type="button"
                  className="spread-btn"
                  onClick={() => fb('prevSpread')}
                >
                  ‹
                </button>
                <span className="spread-info" id="spreadInfo">
                  Spread 1 of 10
                </span>
                <button
                  type="button"
                  className="spread-btn"
                  onClick={() => fb('nextSpread')}
                >
                  ›
                </button>
              </div>

              {/* SIZE SWITCHER */}
              <div className="size-switcher" role="tablist" aria-label="Album size">
                <button
                  type="button"
                  className="size-btn active"
                  data-size="spread_17x24"
                  onClick={() => fb('setSize', 'spread_17x24')}
                >
                  17×24
                </button>
                <button
                  type="button"
                  className="size-btn"
                  data-size="page_20x30"
                  onClick={() => fb('setSize', 'page_20x30')}
                >
                  20×30
                </button>
              </div>

              {/* CHANGE BINDING — initially hidden; album-builder.js
                  reveals it once a binding is selected. Click prompts a
                  warning before resetting layouts. */}
              <button
                type="button"
                id="changeBindingBtn"
                className="binding-pill"
                onClick={() => fb('promptBindingChange')}
                style={{ display: 'none' }}
              >
                <span className="binding-pill-label">Style:</span>
                <span id="currentBindingLabel">Lay-Flat</span>
                <span className="binding-pill-arrow">⇄</span>
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div className="history-btns">
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => fb('doUndo')}
                    title="Undo"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6a4 4 0 104-.5"
                        stroke="#b8965a"
                        strokeWidth="1"
                        strokeLinecap="round"
                      />
                      <path
                        d="M2 3v3h3"
                        stroke="#b8965a"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => fb('doRedo')}
                    title="Redo"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M10 6a4 4 0 11-4-.5"
                        stroke="#b8965a"
                        strokeWidth="1"
                        strokeLinecap="round"
                      />
                      <path
                        d="M10 3v3H7"
                        stroke="#b8965a"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => fb('addTextOverlay')}
                  title="Add Text"
                  style={{
                    width: 'auto',
                    padding: '0 8px',
                    fontSize: 9,
                    letterSpacing: 1,
                    color: 'var(--gold)',
                  }}
                >
                  + Text
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => fb('toggleBgPicker')}
                  title="Background Color"
                  style={{
                    width: 'auto',
                    padding: '0 8px',
                    fontSize: 9,
                    letterSpacing: 1,
                    color: 'var(--gold)',
                  }}
                >
                  BG Color
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => fb('toggleFilterStrip')}
                  title="Filters"
                  style={{
                    width: 'auto',
                    padding: '0 8px',
                    fontSize: 9,
                    letterSpacing: 1,
                    color: 'var(--gold)',
                  }}
                >
                  Filters
                </button>
              </div>
              <div className="zoom-controls">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => fb('zoom', -0.1)}
                >
                  −
                </button>
                <span className="zoom-val" id="zoomVal">
                  80%
                </span>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => fb('zoom', 0.1)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="filter-strip" id="filterStrip">
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: 1,
                  color: 'var(--muted2)',
                }}
              >
                Apply to selected photo:
              </span>
              {[
                { label: 'None',   val: 'none' },
                { label: 'B&W',    val: 'grayscale(100%)' },
                { label: 'Sepia',  val: 'sepia(80%)' },
                { label: 'Bright', val: 'brightness(1.15) contrast(1.05)' },
                { label: 'Vivid',  val: 'contrast(1.2) saturate(1.2)' },
                { label: 'Moody',  val: 'brightness(0.85) contrast(1.1)' },
                { label: 'Warm',   val: 'sepia(30%) brightness(1.1) saturate(0.9)' },
                { label: 'Cool',   val: 'hue-rotate(200deg) saturate(0.8) brightness(1.05)' },
                { label: 'Fade',   val: 'saturate(0) brightness(1.1) contrast(1.3)' },
              ].map((f, i) => (
                <button
                  type="button"
                  key={f.label}
                  className={'filter-btn' + (i === 0 ? ' active' : '')}
                  onClick={(e) => fb('applyFilter', f.val, e.currentTarget)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* BG panel is populated dynamically by album-builder.js
                (renderBgPanel) so we can show tabs, custom hex picker,
                and the photo-backdrop sub-panel without hardcoding any
                of it here. Empty container is intentional. */}
            <div className="bg-picker" id="bgPicker" />


            <div className="canvas-area">
              <div
                className="spread-canvas is-spread"
                id="spreadCanvas"
                data-size="spread_17x24"
              >
                <div className="layout-slots" id="layoutSlots" />
              </div>
            </div>

            <div className="page-strip">
              <span className="page-strip-title">All Spreads</span>
              <div className="page-thumbs" id="pageThumbs" />
            </div>
          </div>

          {/* RIGHT: Layouts */}
          <div className="layout-panel">
            <div className="panel-header">
              <p className="panel-header-title">Layouts</p>
              {/* Photo-count filter tabs. Populated by renderPhotoCountTabs
                  in album-builder.js so the active state can flip without
                  React knowing the count. */}
              <div className="photo-count-tabs" id="photoCountTabs" />
            </div>
            <div className="layout-scroll" id="layoutScroll" />
          </div>
        </div>
      </div>

      {/* EXPERT DESIGN FORM */}
      <div className="builder-section" id="expertSection">
        <div className="expert-section">
          <span
            className="page-tag"
            style={{ display: 'inline-block', marginBottom: 24 }}
          >
            Expert Design
          </span>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(30px,4vw,50px)',
              fontWeight: 300,
              color: 'var(--cream)',
              marginBottom: 12,
            }}
          >
            Tell us about your{' '}
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>
              photos
            </em>
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--muted2)',
              lineHeight: 2,
              marginBottom: 44,
            }}
          >
            Upload your photos and any notes. We&apos;ll send a proof within 3
            business days.
          </p>

          <div className="field-group">
            <label className="field-label">Upload your photos</label>
            <label
              className="upload-zone"
              htmlFor="expertUpload"
              style={{ borderRadius: 8, padding: 28 }}
            >
              <input
                type="file"
                id="expertUpload"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => fb('expertUploadHandle', e.nativeEvent)}
              />
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                fill="none"
                style={{ marginBottom: 10 }}
              >
                <path
                  d="M14 20V8M14 8l-5 5M14 8l5 5"
                  stroke="#b8965a"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                />
                <rect x="3" y="3" width="22" height="22" rx="4" stroke="#b8965a" strokeWidth="0.5" />
              </svg>
              <div className="upload-text">
                <strong id="expertUploadLabel">
                  Click to upload your wedding photos
                </strong>
                JPG or PNG · High resolution recommended
              </div>
            </label>
          </div>

          <div className="field-group">
            <label className="field-label">Your name</label>
            <input
              className="field-input"
              type="text"
              placeholder="Sarah & James"
            />
          </div>
          <div className="field-group">
            <label className="field-label">Email address</label>
            <input className="field-input" type="email" placeholder="you@email.com" />
          </div>
          <div className="field-group">
            <label className="field-label">Wedding date</label>
            <input className="field-input" type="text" placeholder="June 14, 2024" />
          </div>
          <div className="field-group">
            <label className="field-label">
              Notes for our designers (optional)
            </label>
            <textarea
              className="field-input"
              rows={4}
              placeholder="e.g. Start with ceremony shots, keep reception lighter and candid. Our favourite shots are the golden hour portraits..."
              style={{ resize: 'vertical' }}
            />
          </div>

          <div
            style={{
              background: 'rgba(184,150,90,0.06)',
              border: '0.5px solid rgba(184,150,90,0.2)',
              borderRadius: 10,
              padding: '18px 22px',
              marginBottom: 28,
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <circle cx="11" cy="11" r="9" stroke="#b8965a" strokeWidth="0.6" />
              <path
                d="M11 7v5M11 14.5h.01"
                stroke="#b8965a"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
            <p
              style={{
                fontSize: 10,
                color: 'var(--muted2)',
                lineHeight: 1.8,
              }}
            >
              <strong style={{ color: 'var(--cream)' }}>$150 design fee</strong>{' '}
              added to your order. You&apos;ll receive a proof within 3
              business days with one round of revisions before we go to print.
            </p>
          </div>

          <button
            type="button"
            className="btn-submit"
            onClick={() => fb('submitExpert')}
          >
            Submit for Expert Design →
          </button>
        </div>
      </div>

      {/* FLOATING PHOTO TOOLBAR */}
      <div
        className="photo-float-toolbar"
        id="photoFloatToolbar"
        hidden={step === 'cover'}
      >
        <span className="ftb-label">Photo</span>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbFitFill')} title="Fit to fill">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="2" y="2" width="14" height="14" rx="1" stroke="white" strokeWidth="1.2" />
            <path d="M5 9h8M9 5v8" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="ftb-btn" onClick={() => fb('ftbFitOriginal')} title="Fit original">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="3" y="3" width="12" height="12" rx="1" stroke="white" strokeWidth="1.2" />
            <rect x="6" y="6" width="6" height="6" rx="0.5" stroke="white" strokeWidth="1" />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button
          type="button"
          className="ftb-btn"
          onClick={() => fb('ftbZoomStep', -0.1)}
          title="Zoom out"
          style={{ width: 28 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="white" strokeWidth="1.2" />
            <path d="M4 6h4M10 10l2 2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <input
          type="range"
          id="zoomSlider"
          min="30"
          max="500"
          defaultValue="100"
          step="1"
          style={{ width: 90, accentColor: '#b8965a', cursor: 'pointer' }}
          onInput={(e) => fb('ftbZoomSlider', (e.target as HTMLInputElement).value)}
          title="Zoom / stretch photo in frame"
        />
        <button
          type="button"
          className="ftb-btn"
          onClick={() => fb('ftbZoomStep', 0.1)}
          title="Zoom in"
          style={{ width: 28 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="white" strokeWidth="1.2" />
            <path
              d="M4 6h4M6 4v4M10 10l2 2"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span
          id="ftbZoomVal"
          style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.6)',
            minWidth: 36,
            textAlign: 'center',
          }}
        >
          100%
        </span>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbFlip', 'x')} title="Flip horizontal">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M9 3v12M4 6l-2 3 2 3M14 6l2 3-2 3"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="ftb-btn" onClick={() => fb('ftbFlip', 'y')} title="Flip vertical">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M3 9h12M6 4l3-2 3 2M6 14l3 2 3-2"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbRotate', -90)} title="Rotate left 90°">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M4 9a5 5 0 105-5H6M6 1L4 4l2 3"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="ftb-btn" onClick={() => fb('ftbRotate', 90)} title="Rotate right 90°">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M14 9a5 5 0 11-5-5h3M12 1l2 3-2 3"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbReset')} title="Reset crop">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M3 9a6 6 0 106-6H6M6 1L3 4l3 3"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button
          type="button"
          className="ftb-btn"
          onClick={() => fb('ftbDelete')}
          title="Remove photo"
          style={{ color: '#ff6b6b' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M4 4l10 10M14 4L4 14"
              stroke="#ff6b6b"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* SUBMIT MODAL */}
      <div className="modal-overlay" id="modalOverlay">
        <div className="modal">
          <button
            type="button"
            className="modal-close"
            onClick={() => fb('closeModal')}
          >
            ×
          </button>
          <span className="modal-tag">Almost done</span>
          <h2 className="modal-title">
            Submit your <em>design</em>
          </h2>
          <p className="modal-desc">
            Your layout is ready. Enter your details and we&apos;ll confirm
            your order and send an invoice.
          </p>
          {/* Line-item breakdown: base + extras + cover surcharge.
              Populated by renderPriceBreakdown in album-builder.js when
              the modal opens, so the cover step's choices are picked up. */}
          <div className="price-breakdown" id="priceBreakdown" />
          <div className="modal-row">
            <div className="modal-field">
              <label className="modal-label">First name</label>
              <input className="modal-input" type="text" placeholder="Sarah" />
            </div>
            <div className="modal-field">
              <label className="modal-label">Last name</label>
              <input className="modal-input" type="text" placeholder="Johnson" />
            </div>
          </div>
          <div className="modal-field">
            <label className="modal-label">Email address</label>
            <input className="modal-input" type="email" placeholder="you@email.com" />
          </div>
          <div className="modal-field">
            <label className="modal-label">Phone (optional)</label>
            <input className="modal-input" type="tel" placeholder="+1 (555) 000-0000" />
          </div>
          <button
            type="button"
            className="btn-submit"
            onClick={() => fb('submitOrder')}
          >
            Place Order →
          </button>
          <p className="modal-note">
            Confirmation and invoice sent by email.<br />
            12–16 day delivery anywhere in the US.
          </p>
        </div>
      </div>

      {/* SUCCESS */}
      <div className="success-overlay" id="successOverlay">
        <div className="success-ring">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path
              d="M7 14l5 5 9-9"
              stroke="#b8965a"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="success-title">
          Order <em>received.</em>
        </h2>
        <p className="success-desc" style={{ marginTop: 12 }}>
          We&apos;ll send a confirmation and invoice to your email within the
          hour. Your monument will arrive in 12–16 days.
        </p>
        <p
          id="successOrderId"
          style={{
            marginTop: 8,
            fontSize: 10,
            letterSpacing: 2,
            color: 'var(--gold)',
            textTransform: 'uppercase',
          }}
        />
        <Link
          href="/"
          style={{
            display: 'inline-block',
            marginTop: 36,
            fontSize: 9,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'var(--gold)',
            textDecoration: 'none',
            borderBottom: '0.5px solid rgba(184,150,90,0.4)',
            paddingBottom: 4,
          }}
        >
          ← Back to Home
        </Link>
      </div>
    </>
  );
}

/**
 * SubmittedView — the locked, post-submit experience.
 *
 * Replaces the entire designer once an order is locked (via localStorage
 * flag set by album-builder.js's submitOrder). No nav, no edit controls,
 * just confirmation + the option to start a brand new album. Refreshes,
 * back-navigation, or direct revisit to /design all land here as long as
 * the flag persists.
 */
function SubmittedView({
  record,
  onNewAlbum,
}: {
  record: SubmittedRecord;
  onNewAlbum: () => void;
}) {
  const submittedDate = (() => {
    const d = new Date(record.submittedAt);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  })();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--dark)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div
          style={{
            width: 80,
            height: 80,
            margin: '0 auto 28px',
            border: '0.5px solid rgba(184,150,90,0.4)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
            <path
              d="M7 14l5 5 9-9"
              stroke="#b8965a"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 300,
            color: 'var(--cream)',
            lineHeight: 1.15,
            marginBottom: 16,
          }}
        >
          Order <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>
            received.
          </em>
        </h1>

        <p
          style={{
            fontSize: 13,
            color: 'var(--muted2)',
            lineHeight: 2,
            margin: '0 auto 28px',
            maxWidth: 420,
          }}
        >
          Your design is locked and queued for production. We&apos;ll send a
          confirmation and invoice within the hour. Your album will arrive
          in 12–16 days.
        </p>

        <div
          style={{
            background: 'var(--dark2)',
            border: '0.5px solid rgba(184,150,90,0.2)',
            borderRadius: 10,
            padding: '18px 22px',
            display: 'inline-block',
            marginBottom: 36,
            minWidth: 280,
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: 2,
              color: 'var(--muted2)',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Order ID
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--gold)',
              letterSpacing: 1,
            }}
          >
            {record.orderId}
          </div>
          {submittedDate && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--muted2)',
                marginTop: 8,
                letterSpacing: 1,
              }}
            >
              Submitted {submittedDate}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: 24,
          }}
        >
          <button
            type="button"
            onClick={onNewAlbum}
            style={{
              background: 'var(--gold)',
              color: 'var(--dark)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 2,
              textTransform: 'uppercase',
              padding: '15px 36px',
              borderRadius: 40,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Start a new album
          </button>
          <Link
            href="/"
            style={{
              background: 'transparent',
              color: 'var(--gold)',
              fontSize: 10,
              letterSpacing: 2,
              textTransform: 'uppercase',
              padding: '15px 36px',
              borderRadius: 40,
              border: '0.5px solid var(--gold)',
              textDecoration: 'none',
              fontFamily: 'var(--font-body)',
              display: 'inline-block',
            }}
          >
            Back to Home
          </Link>
        </div>

        <p
          style={{
            fontSize: 10,
            color: 'var(--muted2)',
            letterSpacing: 1,
            lineHeight: 1.8,
            opacity: 0.7,
          }}
        >
          Need to change something on this order?{' '}
          <a
            href={`mailto:orders@folioforever.com?subject=Change%20request%20${encodeURIComponent(record.orderId)}`}
            style={{
              color: 'var(--gold)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Email us
          </a>
          .
        </p>
      </div>
    </div>
  );
}
