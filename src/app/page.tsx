import Link from 'next/link';
import './homepage.css';

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
const ROUTE_FAQ = '/photographers#faq';

export default function HomePage() {
  return (
    <>
      {/* NAVBAR */}
      <nav>
        <Link href="/" className="nav-logo">
          FOLIO &amp; FOREVER
        </Link>
        <ul className="nav-links">
          <li>
            <a href="#albums">Albums</a>
          </li>
          <li>
            <Link href={ROUTE_DESIGN}>Design</Link>
          </li>
          <li>
            <Link href={ROUTE_PHOTOG}>Photographers</Link>
          </li>
          <li>
            <a href="#sample">Sample Kit</a>
          </li>
        </ul>
        <Link href={ROUTE_DESIGN} className="nav-cta">
          Order Now
        </Link>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-video-wrap">
          {/* TODO: replace placeholder with real hero video */}
          <div className="hero-video-placeholder">
            <div className="play-btn">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M6 4L16 10L6 16V4Z" fill="#b8965a" />
              </svg>
            </div>
            <span
              style={{
                fontSize: '10px',
                letterSpacing: '2px',
                color: '#4a3f30',
                textTransform: 'uppercase',
              }}
            >
              Your hero video goes here
            </span>
          </div>
        </div>
        <div className="hero-overlay" />
        <div className="hero-content">
          <span className="hero-tag">Printed on paper no one else offers</span>
          <h1 className="hero-title">
            Not an album.<br />
            <em>
              A monument to your<br />wedding day.
            </em>
          </h1>
          <p className="hero-subtitle">
            Up to 20×60 inches open. 3D tactile printing you can feel.<br />
            A scale and quality no online printer comes close to.
          </p>
          <div className="hero-btns">
            <Link href={ROUTE_DESIGN} className="btn-primary">
              Order Your Monument
            </Link>
            <Link href={ROUTE_DESIGN} className="btn-secondary">
              Get Free Sample Kit
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
          <span className="trust-num">500+</span>
          <span className="trust-label">Albums Delivered</span>
        </div>
        <div className="trust-divider" />
        <div className="trust-item">
          <span className="trust-num">12–16 days</span>
          <span className="trust-label">US Delivery</span>
        </div>
        <div className="trust-divider" />
        <div className="trust-item">
          <span className="trust-num">100%</span>
          <span className="trust-label">Satisfaction Guarantee</span>
        </div>
        <div className="trust-divider" />
        <div className="trust-item">
          <span className="trust-num">US Based</span>
          <span className="trust-label">Owner &amp; Support</span>
        </div>
      </div>

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
            When fully open, our largest album stretches 20×60 inches — wider
            than most dining tables. This is not a photo book. This is a
            statement piece.
          </p>
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
              <div className="badge">Most Popular</div>
              <span className="size-dims">20 × 60&quot;</span>
              <span className="size-name">Open · The Full Statement</span>
              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--muted2)',
                  lineHeight: 1.8,
                }}
              >
                Fully open at 20×60 inches. Wider than most dining tables. Pure
                wow factor.
              </p>
              <div className="size-bar-wrap">
                <div className="size-bar" style={{ width: '98%', margin: '0 auto' }}>
                  <span>20 × 60&quot; — wider than most dining tables</span>
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
          Feel what other printers<br />simply cannot do
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
              <p className="compare-title">Every other printer</p>
              <ul className="compare-features">
                <li>Completely flat surface</li>
                <li>No texture or depth</li>
                <li>Colors fade over time</li>
                <li>Looks like every other album</li>
              </ul>
            </div>
          </div>
          <div className="compare-side ours">
            <div className="compare-video">
              {/* TODO: swap to real texture close-up video */}
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
                  Your texture video here
                </span>
              </div>
              <div className="compare-label-overlay">Our 3D tactile printing</div>
            </div>
            <div className="compare-body">
              <p className="compare-title">Our 3D tactile printing</p>
              <ul className="compare-features">
                <li>Raised edges you can feel</li>
                <li>Tactile depth and dimension</li>
                <li>Deep color permanence</li>
                <li>A physical experience unlike anything</li>
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
            <p className="step-title">We Design It</p>
            <p className="step-desc">
              Our expert team designs your album — or use our self-design tool
              to create it yourself.
            </p>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <p className="step-title">Delivered to You</p>
            <p className="step-desc">
              Carefully packaged and shipped to anywhere in the US within 12–16
              days.
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
          {/* TODO: swap to real couple-reaction video */}
          <div className="video-placeholder-inner">
            <div className="play-btn" style={{ margin: '0 auto 12px' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M6 4L16 10L6 16V4Z" fill="#b8965a" />
              </svg>
            </div>
            <span
              style={{
                fontSize: '10px',
                letterSpacing: '2px',
                color: 'var(--muted2)',
                textTransform: 'uppercase',
              }}
            >
              Couple reaction video goes here
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
              Trade pricing available. Built by a working wedding photographer.
              <br />
              Repeat order discounts. Your clients will never go anywhere else.
            </p>
          </div>
          <Link href={ROUTE_PHOTOG} className="btn-dark">
            Photographer Program →
          </Link>
        </div>
      </section>

      {/* TESTIMONIAL */}
      <section className="testimonial-section">
        <span className="section-tag">What couples say</span>
        <div className="gold-line centered" />
        <blockquote className="testimonial-quote">
          “We&apos;ve shown this album to everyone who visits. The paper, the
          colors, the weight of it — nothing we have seen online comes close.”
        </blockquote>
        <p className="testimonial-author">— Sarah &amp; James, married 2024</p>
      </section>

      {/* SAMPLE CTA */}
      <section className="sample-section" id="sample">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span
            className="section-tag"
            style={{ display: 'block', textAlign: 'center' }}
          >
            Before you order
          </span>
          <h2 className="section-title">Hold it in your hands first</h2>
          <div className="gold-line centered" />
          <p className="sample-desc">
            Order a sample kit for $15. Feel the 3D texture. See the paper
            quality. The $15 is fully credited toward your album order.
          </p>
          <Link href={ROUTE_DESIGN} className="btn-primary">
            Get Your Sample Kit — $15
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">FOLIO &amp; FOREVER</div>
        <ul className="footer-links">
          <li>
            <a href="#albums">Albums</a>
          </li>
          <li>
            <a href="#how-it-works">How It Works</a>
          </li>
          <li>
            <Link href={ROUTE_DESIGN}>Design</Link>
          </li>
          <li>
            <Link href={ROUTE_PHOTOG}>Photographers</Link>
          </li>
          <li>
            <Link href={ROUTE_FAQ}>FAQ</Link>
          </li>
          <li>
            <a href="mailto:orders@noorkphotography.com">Contact</a>
          </li>
        </ul>
        <span className="footer-copy">
          © {new Date().getFullYear()} Folio &amp; Forever. All rights reserved.
          {' · '}
          {/* Discreet admin link — not advertised on the homepage hero
              (would attract brute-force attempts) but easy to find for
              Jayvee in the footer. Bookmarking /admin is the better
              path; this is the safety net. */}
          <a href="/admin" className="footer-admin">Admin</a>
        </span>
      </footer>
    </>
  );
}
