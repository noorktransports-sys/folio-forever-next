import type { Metadata } from 'next';
import Link from 'next/link';
import Album3D from './components/Album3D';
import './homepage.css';
import SiteFooter from '@/components/SiteFooter';
import JsonLd from '@/components/JsonLd';
import { organizationLd, websiteLd } from '@/lib/seo';
import { ALBUM_PRICING } from '@/lib/pricing';
import { MAG_PRICE } from '@/lib/magazine/pages';

/**
 * Homepage — ported from `folio-forever-child/page-homepage.php`.
 *
 * Visual parity with the WP version is the goal of this port; behaviour and
 * content can iterate later. Internal links use Next.js <Link>; in-page
 * anchors and mailto: stay as plain <a>.
 *
 * Routes referenced here (created later in tasks #3 and #4):
 *   /design          -> album designer
 *   /photographers   -> trade page
 */
const ROUTE_DESIGN = '/design';
const ROUTE_PHOTOG = '/photographers';
const ROUTE_FAQ = '/faq';
const ROUTE_ALBUMS_PAGE = '/wedding-albums';
const ALBUM_FROM = Math.min(...Object.values(ALBUM_PRICING).map((t) => t.standard.base));
const ROUTE_MAGAZINE = '/design/magazine';

export const metadata: Metadata = {
  title: { absolute: 'Custom Wedding Albums & Wedding Magazines | Folio Forever' },
  description:
    'Design a custom lay-flat wedding album (up to 20×30 in) or a 20-page wedding magazine online. Smart Auto-Layout, page-by-page proof approval, printed in 5–7 business days and shipped across the US.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={organizationLd()} />
      <JsonLd data={websiteLd()} />
      {/* NAVBAR */}
      <nav>
        <Link href="/" className="nav-logo">
          FOLIO FOREVER
        </Link>
        <ul className="nav-links">
          <li>
            <Link href={ROUTE_ALBUMS_PAGE}>Albums</Link>
          </li>
          <li>
            <Link href="/wedding-magazine">Magazine</Link>
          </li>
          <li>
            <Link href={ROUTE_PHOTOG}>Photographers</Link>
          </li>
          <li>
            <Link href={ROUTE_FAQ}>FAQ</Link>
          </li>
        </ul>
        <Link href={ROUTE_DESIGN} className="nav-cta">
          Order Now
        </Link>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-video-wrap">
          {/* Hero film — muted + playsInline so it autoplays on every
              browser (incl. iOS). The file has cinema letterbox bars
              baked in; CSS scales it 1.25× so they sit off-screen. */}
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/video/hero-poster.jpg"
            aria-hidden
          >
            <source src="/video/hero.mp4" type="video/mp4" />
          </video>
        </div>
        <div className="hero-overlay" />
        <div className="hero-content">
          <span className="hero-tag">Custom wedding albums &amp; magazines</span>
          <h1 className="hero-title">
            Not an album.<br />
            <em>
              A monument to your<br />wedding day.
            </em>
          </h1>
          <p className="hero-subtitle">
            Custom lay-flat wedding albums up to 20×30 inches open, with 3D
            tactile printing you can feel.<br />
            Plus 20-page wedding magazines. Designed online, printed to last.
          </p>
          <div className="hero-btns">
            <Link href={ROUTE_DESIGN} className="btn-primary">
              Order Your Monument
            </Link>
            <Link href={ROUTE_MAGAZINE} className="btn-secondary">
              Make a Wedding Magazine
            </Link>
          </div>
        </div>
        <div className="hero-scroll">
          <span>Scroll</span>
          <div className="scroll-line" />
        </div>
      </section>

      {/* TRUST BAR */}
      <div className="trust-bar">
        <div className="trust-item">
          <span className="trust-num">300 DPI</span>
          <span className="trust-label">Archival Print Quality</span>
        </div>
        <div className="trust-divider" />
        <div className="trust-item">
          <span className="trust-num">Proof First</span>
          <span className="trust-label">Approve Every Page</span>
        </div>
        <div className="trust-divider" />
        <div className="trust-item">
          <span className="trust-num">Reprint Promise</span>
          <span className="trust-label">Print Defects Fixed Free</span>
        </div>
        <div className="trust-divider" />
        <div className="trust-item">
          <span className="trust-num">US Based</span>
          <span className="trust-label">Owner &amp; Support</span>
        </div>
      </div>

      {/* WHAT WE MAKE — plain-language summary + links for search engines */}
      <section className="make-section" aria-labelledby="what-we-make">
        <div className="section-inner">
          <span className="section-tag" style={{ textAlign: 'center' }}>What we make</span>
          <h2 className="section-title make-title" id="what-we-make">
            Wedding albums &amp; wedding magazines
          </h2>
          <div className="make-grid">
            <Link href={ROUTE_ALBUMS_PAGE} className="make-card">
              <span className="make-kicker">From ${ALBUM_FROM}</span>
              <span className="make-name">Custom wedding albums</span>
              <span className="make-desc">
                Standard or lay-flat albums from 17×24 to 20×30 inches open, with
                photo, leather or acrylic covers. Smart Auto-Layout designs every
                spread; you approve each page.
              </span>
              <span className="make-link">Sizes &amp; prices →</span>
            </Link>
            <Link href="/wedding-magazine" className="make-card">
              <span className="make-kicker">${MAG_PRICE}</span>
              <span className="make-name">Wedding magazines</span>
              <span className="make-desc">
                A 20-page, 8.5×11 inch editorial magazine made from your photos,
                in ten original styles. A perfect gift for parents and guests.
              </span>
              <span className="make-link">See the styles →</span>
            </Link>
          </div>
        </div>
      </section>

      {/* SIZE SECTION */}
      <section className="size-section" id="albums">
        <div className="section-inner" style={{ textAlign: 'center' }}>
          <span className="section-tag">The scale changes everything</span>
          <h2 className="section-title">
            Bigger than any album<br />you have ever seen
          </h2>
          <div className="gold-line centered" />
          <p
            style={{
              fontSize: '13px',
              color: 'var(--muted2)',
              maxWidth: '480px',
              margin: '0 auto',
              lineHeight: 1.9,
            }}
          >
            When fully open, our largest album stretches 20×30 inches — bigger
            than most coffee table books and built to be displayed, not
            shelved. This is not a photo book. This is a statement piece.
          </p>

          {/* Real WebGL Album3D hero — Three.js with PBR materials,
           * three-light setup, and inertial drag-to-rotate. Replaces
           * every prior CSS approach because none of them solved the
           * back-view fakeness. */}
          <div className="album-showcase">
            <Album3D
              title="Forever"
              subtitle="A monument to your day"
              variant="leather"
              leatherHex="#2a1c12"
              foilHex="#d4b07a"
              width={320}
              caption="Drag to rotate · 3D preview"
            />
          </div>

          <div className="size-grid">
            <div className="size-card">
              <span className="size-dims">17 × 12&quot;</span>
              <span className="size-name">
                Closed · Standard Monument
              </span>
              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--muted2)',
                  lineHeight: 1.8,
                }}
              >
                Opens to 17×24 inches. Commanding presence on any coffee table
                or shelf.
              </p>
              <div className="size-bar-wrap">
                <div className="size-bar" style={{ width: '65%', margin: '0 auto' }}>
                  <span>17 inches</span>
                </div>
              </div>
            </div>
            <div className="size-card featured">
              <div className="badge">Largest Size</div>
              <span className="size-dims">20 × 30&quot;</span>
              <span className="size-name">Open · The Full Statement</span>
              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--muted2)',
                  lineHeight: 1.8,
                }}
              >
                Fully open at 20×30 inches; folds to 20×15 closed. Bigger than
                most coffee table books — pure wow factor.
              </p>
              <div className="size-bar-wrap">
                <div className="size-bar" style={{ width: '98%', margin: '0 auto' }}>
                  <span>20 × 30&quot; open · 20 × 15&quot; closed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3D DIFFERENCE */}
      <section className="difference-section">
        <span className="section-tag">See the difference</span>
        <h2 className="section-title" style={{ color: 'var(--dark)' }}>
          Printing you can<br />feel with your fingertips
        </h2>
        <div className="gold-line centered" />
        <p
          style={{
            fontSize: '13px',
            color: 'var(--muted)',
            maxWidth: '500px',
            margin: '0 auto',
            lineHeight: 1.9,
          }}
        >
          Standard printing is flat. Ours is dimensional. Run your finger
          across the page and feel every petal, every texture, every edge
          raised off the surface.
        </p>
        <div className="compare-grid">
          <div className="compare-side standard">
            <div className="compare-video">
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '100px',
                    height: '70px',
                    background: '#d4cabb',
                    borderRadius: '4px',
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontSize: '10px', color: '#8a7a65' }}>
                    Flat print
                  </span>
                </div>
              </div>
              <div className="compare-label-overlay">Standard printing</div>
            </div>
            <div className="compare-body">
              <p className="compare-title">Standard flat printing</p>
              <ul className="compare-features">
                <li>Completely flat surface</li>
                <li>No texture or depth</li>
                <li>Photos sit on the surface</li>
              </ul>
            </div>
          </div>
          <div className="compare-side ours">
            <div className="compare-video">
              <div style={{ textAlign: 'center' }}>
                <div
                  className="play-btn"
                  style={{ width: '44px', height: '44px', margin: '0 auto 8px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <path d="M6 4L16 10L6 16V4Z" fill="#b8965a" />
                  </svg>
                </div>
                <span
                  style={{
                    fontSize: '9px',
                    color: 'var(--gold)',
                    letterSpacing: '1px',
                  }}
                >
                  Close-up film coming soon
                </span>
              </div>
              <div className="compare-label-overlay">Our 3D tactile printing</div>
            </div>
            <div className="compare-body">
              <p className="compare-title">Our 3D tactile printing</p>
              <ul className="compare-features">
                <li>Raised edges you can feel</li>
                <li>Tactile depth and dimension</li>
                <li>Archival inks and paper</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="hiw-section" id="how-it-works">
        <span
          className="section-tag"
          style={{ display: 'block', textAlign: 'center' }}
        >
          Simple process
        </span>
        <h2 className="section-title" style={{ textAlign: 'center' }}>
          Three steps to your heirloom
        </h2>
        <div className="gold-line centered" />
        <div className="steps-grid">
          <div className="step">
            <div className="step-num">1</div>
            <p className="step-title">Choose &amp; Upload</p>
            <p className="step-desc">
              Pick your size, cover material, and upload your photos through
              our simple portal.
            </p>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <p className="step-title">Design &amp; Approve</p>
            <p className="step-desc">
              Smart Auto-Layout builds every spread for you. Adjust anything,
              or add design-team polish (+$99). Approve each page before paying.
            </p>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <p className="step-title">Delivered to You</p>
            <p className="step-desc">
              Printed in 5–7 business days after approval, then shipped with
              Express, Standard or Economy delivery anywhere in the US.
            </p>
          </div>
        </div>
      </section>

      {/* VIDEO REVEAL */}
      <section className="reveal-section">
        <span
          className="section-tag"
          style={{ display: 'block', textAlign: 'center' }}
        >
          Watch the reveal
        </span>
        <h2 className="section-title" style={{ textAlign: 'center' }}>
          A couple sees their monument<br />for the first time
        </h2>
        <div className="video-frame">
          {/* Couple-reaction video: "coming soon" until the real film is ready. */}
          <div className="video-placeholder-inner">
            <span
              style={{
                display: 'inline-block',
                border: '0.5px solid rgba(184,150,90,0.6)',
                borderRadius: 30,
                padding: '7px 18px',
                fontSize: '10px',
                letterSpacing: '3px',
                color: '#b8965a',
                textTransform: 'uppercase',
                marginBottom: 14,
              }}
            >
              Coming soon
            </span>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(20px, 3vw, 30px)',
                fontStyle: 'italic',
                color: 'var(--cream)',
                lineHeight: 1.3,
              }}
            >
              Real couples, real first reactions.
            </div>
            <span
              style={{
                display: 'block',
                marginTop: 10,
                fontSize: '10px',
                letterSpacing: '2px',
                color: 'var(--muted2)',
                textTransform: 'uppercase',
              }}
            >
              Our first reveal film is being edited
            </span>
          </div>
        </div>
      </section>

      {/* PHOTOGRAPHER STRIP */}
      <section className="photographer-strip" id="photographers">
        <div className="strip-inner">
          <div className="strip-text">
            <span className="section-tag">For photographers</span>
            <h2 className="strip-title">
              Offer your clients something<br />no one else can
            </h2>
            <p className="strip-desc">
              Built by a working wedding photographer.
              <br />
              Our trade program is coming soon — register your interest today.
            </p>
          </div>
          <Link href={ROUTE_PHOTOG} className="btn-dark">
            Photographer Program →
          </Link>
        </div>
      </section>

      {/* PROMISE */}
      <section className="testimonial-section">
        <span className="section-tag">Our promise</span>
        <div className="gold-line centered" />
        <blockquote className="testimonial-quote">
          You see and approve every page before we print. If anything arrives
          with a print defect or shipping damage, we reprint it free.
        </blockquote>
        <p className="testimonial-author">
          <Link href="/refunds">Read our reprint promise</Link>
        </p>
      </section>

      {/* SAMPLE CTA */}
      <section className="sample-section" id="sample">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span
            className="section-tag"
            style={{ display: 'block', textAlign: 'center' }}
          >
            Coming soon
          </span>
          <h2 className="section-title">Hold it in your hands first</h2>
          <div className="gold-line centered" />
          <p className="sample-desc">
            A paper and texture sample kit is on the way. Want to hear when
            it&apos;s ready? Send us a note.
          </p>
          <Link href="/contact" className="btn-primary">
            Contact Us
          </Link>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
