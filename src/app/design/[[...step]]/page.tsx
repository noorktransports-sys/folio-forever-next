'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { useParams, useRouter } from 'next/navigation';
import CoverBuilder, { type CoverState } from '../cover-builder';
import '../album-builder.css';

/**
 * Cloudflare Pages requires every dynamic route to opt into the
 * Edge Runtime. Without this, @cloudflare/next-on-pages refuses to
 * produce a build and the deploy fails with:
 *   "The following routes were not configured to run with the Edge
 *    Runtime: - /design/[[...step]]"
 * Static routes inherit a default; the catch-all is dynamic so it
 * needs the explicit declaration.
 */
export const runtime = 'edge';

/**
 * URL-driven step routing.
 *
 * /design               → intro (path-choice)
 * /design/product       → product picker (4 SKUs)
 * /design/build         → spread builder
 * /design/cover         → cover builder
 * /design/expert        → expert design form
 *
 * The catch-all route at /design/[[...step]]/page.tsx is the SOLE
 * source of this component — the parent /design/page.tsx is just a
 * thin re-export pointing here. Keeping the component in one place
 * avoids the "two routes resolve to the same path" build error that
 * Next.js throws when an optional catch-all and a sibling static
 * page.tsx both define the route at the parent level.
 *
 * The component derives `currentStep` from useParams().step and
 * toggles the existing DOM sections via useEffect. Navigation flows
 * through router.push so browser back/forward works and refresh
 * keeps the user on their step (paired with localStorage
 * persistence in album-builder.js).
 */
type RouteStep = 'intro' | 'product' | 'build' | 'cover' | 'expert';

function deriveStep(stepArr?: string[]): RouteStep {
  const s = (stepArr?.[0] ?? '').toLowerCase();
  if (s === 'product') return 'product';
  if (s === 'build') return 'build';
  if (s === 'cover') return 'cover';
  if (s === 'expert') return 'expert';
  return 'intro';
}

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

export default function DesignerPage() {
  const router = useRouter();
  const params = useParams<{ step?: string[] }>();
  const currentStep: RouteStep = deriveStep(params?.step);

  const [photos, setPhotos] = useState<{ id: string; src: string }[]>([]);

  // Submit lock — `null` until we know (server-rendered HTML can't read
  // localStorage; we read it inside the first effect). The legacy JS is
  // still loaded on the unlocked render so it can wire up uploads etc.
  const [submitted, setSubmitted] = useState<SubmittedRecord | null>(null);

  useEffect(() => {
    setSubmitted(readSubmittedFromStorage());

    function onSubmitted(ev: Event) {
      const detail = (ev as CustomEvent<{ orderId?: string }>).detail;
      const orderId = detail?.orderId;
      if (!orderId) return;
      setSubmitted({
        orderId,
        submittedAt: new Date().toISOString(),
      });
    }
    function onFolioNav(ev: Event) {
      const detail = (ev as CustomEvent<{ to?: string }>).detail;
      if (detail?.to) router.push(detail.to);
    }
    window.addEventListener('folio:submitted', onSubmitted);
    window.addEventListener('folio:nav', onFolioNav);
    return () => {
      window.removeEventListener('folio:submitted', onSubmitted);
      window.removeEventListener('folio:nav', onFolioNav);
    };
  }, [router]);

  // Drive DOM section visibility from the URL.
  useEffect(() => {
    const intro = document.getElementById('introSection') as HTMLElement | null;
    const product = document.getElementById('productSection');
    const builder = document.getElementById('builderSection');
    const expert = document.getElementById('expertSection');

    product?.classList.remove('active');
    builder?.classList.remove('active');
    expert?.classList.remove('active');
    if (intro) intro.style.display = currentStep === 'intro' ? '' : 'none';

    if (currentStep === 'product') product?.classList.add('active');
    else if (currentStep === 'build' || currentStep === 'cover') builder?.classList.add('active');
    else if (currentStep === 'expert') expert?.classList.add('active');

    const inBuilder = currentStep === 'build' || currentStep === 'cover';
    const navSubmitBtn = document.getElementById('navSubmitBtn') as HTMLElement | null;
    const navSaveBtn = document.getElementById('navSaveBtn') as HTMLElement | null;
    const changeBtn = document.getElementById('changeBindingBtn') as HTMLElement | null;
    const priceTag = document.getElementById('priceTag') as HTMLElement | null;
    if (navSubmitBtn) navSubmitBtn.style.display = inBuilder ? 'block' : 'none';
    if (navSaveBtn) navSaveBtn.style.display = inBuilder ? 'block' : 'none';
    if (changeBtn) changeBtn.style.display = inBuilder ? 'inline-flex' : 'none';
    if (priceTag) priceTag.style.display = inBuilder ? 'inline-flex' : 'none';

    if (currentStep === 'build') {
      let tries = 0;
      const tick = () => {
        const w = window as unknown as { mountBuilder?: () => void };
        if (typeof w.mountBuilder === 'function') {
          w.mountBuilder();
        } else if (tries++ < 40) {
          setTimeout(tick, 50);
        }
      };
      tick();
    }

    if (currentStep === 'cover') {
      const w = window as unknown as { uploadedPhotos?: Record<string, unknown> };
      const map = w.uploadedPhotos ?? {};
      const list = Object.entries(map).map(([id, val]) => ({
        id,
        src: typeof val === 'string' ? val : ((val as { src?: string })?.src ?? ''),
      })).filter((p) => p.src);
      setPhotos(list);
    }
  }, [currentStep]);

  function startNewAlbum() {
    try {
      window.localStorage.removeItem(SUBMITTED_KEY);
      const w = window as unknown as { _folioClearState?: () => void };
      if (typeof w._folioClearState === 'function') w._folioClearState();
    } catch { /* ignore */ }
    window.location.href = '/design';
  }

  if (submitted) {
    return <SubmittedView record={submitted} onNewAlbum={startNewAlbum} />;
  }

  function goToCover() {
    const w = window as unknown as { uploadedPhotos?: Record<string, unknown> };
    const map = w.uploadedPhotos ?? {};
    const list = Object.entries(map).map(([id, val]) => ({
      id,
      src: typeof val === 'string' ? val : ((val as { src?: string })?.src ?? ''),
    })).filter((p) => p.src);
    setPhotos(list);
    router.push('/design/cover');
  }

  function continueFromCover(cover: CoverState) {
    (window as unknown as { __coverState?: CoverState }).__coverState = cover;
    fb('openModal');
  }

  return (
    <>
      <Script src="/js/album-builder.js?v=20260506-2" strategy="afterInteractive" />

      <nav>
        <Link href="/" className="nav-logo">
          FOLIO &amp; FOREVER
        </Link>
        <div className="nav-right">
          <button
            type="button"
            className="nav-back nav-back-btn"
            onClick={() => {
              if (currentStep === 'build') router.push('/design/product');
              else if (currentStep === 'cover') router.push('/design/build');
              else if (currentStep === 'product') router.push('/design');
              else if (currentStep === 'expert') router.push('/design');
              else window.location.href = '/';
            }}
          >
            ← Back
          </button>
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
          <div className="path-card" onClick={() => router.push('/design/product')}>
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

          <div
            className="path-card recommended"
            onClick={() => router.push('/design/expert')}
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

      <div className="builder-section" id="productSection">
        <div className="binding-section product-picker">
          <span className="page-tag">Pick your album</span>
          <h2 className="page-title">
            Choose a<br />
            <em>style &amp; size.</em>
          </h2>
          <p className="page-sub">
            Both styles are hardcover. Lay-flat hides the center seam;
            coffee-table is press-printed and slightly cheaper. You can
            switch later.
          </p>

          <div className="product-grid">
            <div
              className="binding-card product-card"
              onClick={() => {
                fb('selectProduct', 'spread_17x24', 'hardcover');
                router.push('/design/build');
              }}
            >
              <div className="binding-thumb binding-thumb-hardcover product-thumb-17" aria-hidden="true">
                <div className="binding-thumb-page" />
                <div className="binding-thumb-page" />
              </div>
              <p className="binding-name">17×24 Coffee-Table</p>
              <span className="binding-tagline">Press-printed hardcover</span>
              <div className="product-price">
                <span className="product-price-amount">$240</span>
                <span className="product-price-note">10 spreads included · $8 / extra</span>
              </div>
              <ul className="binding-features">
                <li>Visible spine gutter</li>
                <li>Photos sit fully on each page</li>
                <li>Friendliest price</li>
              </ul>
              <button type="button" className="btn-path btn-path-secondary">
                Choose this
              </button>
            </div>

            <div
              className="binding-card product-card"
              onClick={() => {
                fb('selectProduct', 'spread_17x24', 'layflat');
                router.push('/design/build');
              }}
            >
              <div className="binding-thumb binding-thumb-layflat product-thumb-17" aria-hidden="true">
                <div className="binding-thumb-page" />
              </div>
              <p className="binding-name">17×24 Lay-Flat</p>
              <span className="binding-tagline">No center seam</span>
              <div className="product-price">
                <span className="product-price-amount">$275</span>
                <span className="product-price-delta">+$35 vs coffee-table</span>
                <span className="product-price-note">10 spreads included · $10 / extra</span>
              </div>
              <ul className="binding-features">
                <li>Full-bleed across the spine</li>
                <li>Hand-bound construction</li>
                <li>Best for hero shots</li>
              </ul>
              <button type="button" className="btn-path btn-path-primary">
                Choose this
              </button>
            </div>

            <div
              className="binding-card product-card"
              onClick={() => {
                fb('selectProduct', 'page_20x30', 'hardcover');
                router.push('/design/build');
              }}
            >
              <div className="binding-thumb binding-thumb-hardcover product-thumb-20" aria-hidden="true">
                <div className="binding-thumb-page" />
                <div className="binding-thumb-page" />
              </div>
              <p className="binding-name">20×30 Poster · Coffee-Table</p>
              <span className="binding-tagline">Extra large · Press-printed</span>
              <div className="product-price">
                <span className="product-price-amount">$340</span>
                <span className="product-price-delta">+$100 size upgrade</span>
                <span className="product-price-note">10 spreads included · $12 / extra</span>
              </div>
              <ul className="binding-features">
                <li>Oversized coffee-table format</li>
                <li>Visible spine gutter</li>
                <li>Photos sit fully on each page</li>
              </ul>
              <button type="button" className="btn-path btn-path-secondary">
                Choose this
              </button>
            </div>

            <div
              className="binding-card product-card"
              onClick={() => {
                fb('selectProduct', 'page_20x30', 'layflat');
                router.push('/design/build');
              }}
            >
              <div className="binding-thumb binding-thumb-layflat product-thumb-20" aria-hidden="true">
                <div className="binding-thumb-page" />
              </div>
              <p className="binding-name">20×30 Poster · Lay-Flat</p>
              <span className="binding-tagline">Extra large · No center seam</span>
              <div className="product-price">
                <span className="product-price-amount">$375</span>
                <span className="product-price-delta">+$135 vs base</span>
                <span className="product-price-note">10 spreads included · $15 / extra</span>
              </div>
              <ul className="binding-features">
                <li>Premium hero format</li>
                <li>Full-bleed across the spine</li>
                <li>Hand-bound construction</li>
              </ul>
              <button type="button" className="btn-path btn-path-primary">
                Choose this
              </button>
            </div>
          </div>
        </div>
      </div>

      {currentStep === 'cover' && (
        <CoverBuilder
          uploadedPhotos={photos}
          onBack={() => router.push('/design/build')}
          onContinue={continueFromCover}
        />
      )}

      <div
        className="builder-section"
        id="builderSection"
        hidden={currentStep === 'cover'}
      >
        <div className="builder-wrap">
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

          <div className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="spread-nav">
                <button type="button" className="spread-btn" onClick={() => fb('prevSpread')}>‹</button>
                <span className="spread-info" id="spreadInfo">Spread 1 of 10</span>
                <button type="button" className="spread-btn" onClick={() => fb('nextSpread')}>›</button>
              </div>

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
                  20×30 Poster
                </button>
              </div>

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

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div className="history-btns">
                  <button type="button" className="zoom-btn" onClick={() => fb('doUndo')} title="Undo">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6a4 4 0 104-.5" stroke="#b8965a" strokeWidth="1" strokeLinecap="round" />
                      <path d="M2 3v3h3" stroke="#b8965a" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => fb('doRedo')} title="Redo">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M10 6a4 4 0 11-4-.5" stroke="#b8965a" strokeWidth="1" strokeLinecap="round" />
                      <path d="M10 3v3H7" stroke="#b8965a" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                <button type="button" className="zoom-btn" onClick={() => fb('addTextOverlay')} title="Add Text" style={{ width: 'auto', padding: '0 8px', fontSize: 9, letterSpacing: 1, color: 'var(--gold)' }}>
                  + Text
                </button>
                <button type="button" className="zoom-btn" onClick={() => fb('toggleBgPicker')} title="Background Color" style={{ width: 'auto', padding: '0 8px', fontSize: 9, letterSpacing: 1, color: 'var(--gold)' }}>
                  BG Color
                </button>
                <button type="button" className="zoom-btn" onClick={() => fb('toggleFilterStrip')} title="Filters" style={{ width: 'auto', padding: '0 8px', fontSize: 9, letterSpacing: 1, color: 'var(--gold)' }}>
                  Filters
                </button>
              </div>
              <div className="zoom-controls">
                <button type="button" className="zoom-btn" onClick={() => fb('zoom', -0.1)}>−</button>
                <span className="zoom-val" id="zoomVal">80%</span>
                <button type="button" className="zoom-btn" onClick={() => fb('zoom', 0.1)}>+</button>
              </div>
            </div>

            <div className="filter-strip" id="filterStrip">
              <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted2)' }}>
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

          <div className="layout-panel">
            <div className="panel-header">
              <p className="panel-header-title">Layouts</p>
              <div className="photo-count-tabs" id="photoCountTabs" />
            </div>
            <div className="layout-scroll" id="layoutScroll" />
          </div>
        </div>
      </div>

      <div className="builder-section" id="expertSection">
        <div className="expert-section">
          <span className="page-tag" style={{ display: 'inline-block', marginBottom: 24 }}>
            Expert Design
          </span>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(30px,4vw,50px)', fontWeight: 300, color: 'var(--cream)', marginBottom: 12 }}>
            Tell us about your{' '}
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>photos</em>
          </h2>
          <p style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 2, marginBottom: 44 }}>
            Upload your photos and any notes. We&apos;ll send a proof within 3
            business days.
          </p>

          <div className="field-group">
            <label className="field-label">Upload your photos</label>
            <label className="upload-zone" htmlFor="expertUpload" style={{ borderRadius: 8, padding: 28 }}>
              <input
                type="file"
                id="expertUpload"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => fb('expertUploadHandle', e.nativeEvent)}
              />
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ marginBottom: 10 }}>
                <path d="M14 20V8M14 8l-5 5M14 8l5 5" stroke="#b8965a" strokeWidth="0.9" strokeLinecap="round" />
                <rect x="3" y="3" width="22" height="22" rx="4" stroke="#b8965a" strokeWidth="0.5" />
              </svg>
              <div className="upload-text">
                <strong id="expertUploadLabel">Click to upload your wedding photos</strong>
                JPG or PNG · High resolution recommended
              </div>
            </label>
          </div>

          <div className="field-group">
            <label className="field-label">Your name</label>
            <input className="field-input" type="text" placeholder="Sarah & James" />
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
            <label className="field-label">Notes for our designers (optional)</label>
            <textarea
              className="field-input"
              rows={4}
              placeholder="e.g. Start with ceremony shots, keep reception lighter and candid. Our favourite shots are the golden hour portraits..."
              style={{ resize: 'vertical' }}
            />
          </div>

          <div style={{ background: 'rgba(184,150,90,0.06)', border: '0.5px solid rgba(184,150,90,0.2)', borderRadius: 10, padding: '18px 22px', marginBottom: 28, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="11" cy="11" r="9" stroke="#b8965a" strokeWidth="0.6" />
              <path d="M11 7v5M11 14.5h.01" stroke="#b8965a" strokeWidth="1" strokeLinecap="round" />
            </svg>
            <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.8 }}>
              <strong style={{ color: 'var(--cream)' }}>$150 design fee</strong>{' '}
              added to your order. You&apos;ll receive a proof within 3
              business days with one round of revisions before we go to print.
            </p>
          </div>

          <button type="button" className="btn-submit" onClick={() => fb('submitExpert')}>
            Submit for Expert Design →
          </button>
        </div>
      </div>

      <div className="photo-float-toolbar" id="photoFloatToolbar" hidden={currentStep !== 'build'}>
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
        <button type="button" className="ftb-btn" onClick={() => fb('ftbZoomStep', -0.1)} title="Zoom out" style={{ width: 28 }}>
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
        <button type="button" className="ftb-btn" onClick={() => fb('ftbZoomStep', 0.1)} title="Zoom in" style={{ width: 28 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="white" strokeWidth="1.2" />
            <path d="M4 6h4M6 4v4M10 10l2 2" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <span id="ftbZoomVal" style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', minWidth: 36, textAlign: 'center' }}>100%</span>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbFlip', 'x')} title="Flip horizontal">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3v12M4 6l-2 3 2 3M14 6l2 3-2 3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="ftb-btn" onClick={() => fb('ftbFlip', 'y')} title="Flip vertical">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9h12M6 4l3-2 3 2M6 14l3 2 3-2" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbRotate', -90)} title="Rotate left 90°">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M4 9a5 5 0 105-5H6M6 1L4 4l2 3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="ftb-btn" onClick={() => fb('ftbRotate', 90)} title="Rotate right 90°">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M14 9a5 5 0 11-5-5h3M12 1l2 3-2 3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbReset')} title="Reset crop">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 9a6 6 0 106-6H6M6 1L3 4l3 3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ftb-sep" />
        <button type="button" className="ftb-btn" onClick={() => fb('ftbDelete')} title="Remove photo" style={{ color: '#ff6b6b' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M4 4l10 10M14 4L4 14" stroke="#ff6b6b" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="modal-overlay" id="modalOverlay">
        <div className="modal">
          <button type="button" className="modal-close" onClick={() => fb('closeModal')}>×</button>
          <span className="modal-tag">Almost done</span>
          <h2 className="modal-title">Submit your <em>design</em></h2>
          <p className="modal-desc">
            Your layout is ready. Enter your details and we&apos;ll confirm
            your order and send an invoice.
          </p>
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
          <button type="button" className="btn-submit" onClick={() => fb('submitOrder')}>
            Place Order →
          </button>
          <p className="modal-note">
            Confirmation and invoice sent by email.<br />
            12–16 day delivery anywhere in the US.
          </p>
        </div>
      </div>

      <div className="success-overlay" id="successOverlay">
        <div className="success-ring">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M7 14l5 5 9-9" stroke="#b8965a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="success-title">Order <em>received.</em></h2>
        <p className="success-desc" style={{ marginTop: 12 }}>
          We&apos;ll send a confirmation and invoice to your email within the
          hour. Your monument will arrive in 12–16 days.
        </p>
        <p
          id="successOrderId"
          style={{ marginTop: 8, fontSize: 10, letterSpacing: 2, color: 'var(--gold)', textTransform: 'uppercase' }}
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
            <path d="M7 14l5 5 9-9" stroke="#b8965a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
          Order <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>received.</em>
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
          <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase', marginBottom: 6 }}>
            Order ID
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--gold)', letterSpacing: 1 }}>
            {record.orderId}
          </div>
          {submittedDate && (
            <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 8, letterSpacing: 1 }}>
              Submitted {submittedDate}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
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

        <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, lineHeight: 1.8, opacity: 0.7 }}>
          Need to change something on this order?{' '}
          <a
            href={`mailto:orders@folioforever.com?subject=Change%20request%20${encodeURIComponent(record.orderId)}`}
            style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Email us
          </a>
          .
        </p>
      </div>
    </div>
  );
}
