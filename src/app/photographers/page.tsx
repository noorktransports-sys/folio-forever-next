import type { Metadata } from 'next';
import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { ALBUM_PRICING, COVER_PRICE, POLISH_PRICE } from '@/lib/pricing';
import './photographers.css';

/**
 * Photographers page. The trade program (discounts, white-label shipping,
 * volume accounts) is not built yet, so this page only describes what
 * exists today and marks the rest "coming soon". Prices shown come from
 * lib/pricing.ts — the same list the server charges.
 */
export const metadata: Metadata = {
  title: 'For Photographers',
  description:
    'Heirloom wedding albums and magazines for photographers and their clients. Proof-first ordering, printed in 5–7 business days. Trade program coming soon.',
  alternates: { canonical: '/photographers' },
};

const ROUTE_HOME = '/';
const ROUTE_DESIGN = '/design';
const ROUTE_PHOTOG = '/photographers';
const ROUTE_ALBUMS = '/#albums';
const ROUTE_FAQ = '/faq';

export default function PhotographersPage() {
  return (
    <>
      {/* NAV */}
      <nav>
        <Link href={ROUTE_HOME} className="nav-logo">
          FOLIO FOREVER
        </Link>
        <ul className="nav-links">
          <li>
            <Link href={ROUTE_ALBUMS}>Albums</Link>
          </li>
          <li>
            <Link href={ROUTE_DESIGN}>Design</Link>
          </li>
          <li>
            <Link href={ROUTE_PHOTOG} aria-current="page">
              Photographers
            </Link>
          </li>
          <li>
            <Link href={ROUTE_FAQ}>FAQ</Link>
          </li>
        </ul>
        {/* Pro nav cluster — sign-in goes to magic-link request,
            apply opens the signup form. The original "Order now" CTA
            is replaced because pros aren't supposed to enter via the
            customer flow; their orders happen inside their dashboard. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link
            href="/pro/login"
            style={{
              color: 'var(--gold)',
              fontSize: 12,
              letterSpacing: 2,
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            Sign in
          </Link>
          <Link href="/pro/join" className="nav-cta">
            Apply
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-content">
          <span className="hero-tag">For wedding photographers</span>
          <h1 className="hero-title">
            Albums your clients<br />
            <em>will never stop showing.</em>
          </h1>
          <p className="hero-sub">
            Built by a working wedding photographer. Large-format albums and
            wedding magazines, proofed page by page and printed to last.
          </p>
          <div className="hero-btns">
            <a href="#pricing" className="btn-gold">
              See Current Pricing
            </a>
            <Link href="/pro/join" className="btn-outline">
              Register for the Trade Program
            </Link>
          </div>
        </div>
      </section>

      {/* FROM A PHOTOGRAPHER */}
      <section className="from-section">
        <div className="from-inner">
          <div className="from-text">
            <span className="tag">A message from the founder</span>
            <h2 className="from-title">
              I built this because I<br />
              <em>needed it myself.</em>
            </h2>
            <div className="from-body">
              <p>
                As a wedding photographer, I spent years frustrated with album
                companies that treated my clients like order numbers. Long
                waits, generic quality, and prices that made upselling
                awkward.
              </p>
              <p>
                So I built Folio Forever — large-format albums and wedding
                magazines made for photographers who care about their craft,
                with a designer that lays out every spread for you.
              </p>
              <p>
                When your couple opens their album for the first time, that&apos;s
                a referral you didn&apos;t have to ask for.
              </p>
            </div>
            <div className="from-signature">
              — Noor K, Founder &amp; Wedding Photographer
            </div>
          </div>
          <div className="from-card">
            <div className="from-card-title">Available today</div>
            <div className="from-stat">
              <span className="from-stat-label">Minimum order</span>
              <span className="from-stat-val">One album</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">Printing</span>
              <span className="from-stat-val">5–7 business days</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">Ship to your client</span>
              <span className="from-stat-val">Any US address</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">Trade discounts</span>
              <span className="from-stat-val">Coming soon</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">White-label packaging</span>
              <span className="from-stat-val">Coming soon</span>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="benefits-section">
        <span className="section-tag">What you get today</span>
        <h2 className="section-title">
          Everything you need.<br />Nothing you don&apos;t.
        </h2>
        <div className="gold-line" />
        <div className="benefits-grid">
          <div className="benefit-card">
            <div className="benefit-title">Large formats</div>
            <p className="benefit-desc">
              Albums from 17×24 to 20×30 inches open, in standard or lay-flat
              binding, with photo, leather or acrylic covers.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-title">Smart Auto-Layout</div>
            <p className="benefit-desc">
              Upload the gallery and every spread is laid out for you. Adjust
              anything, or add design-team polish (+${POLISH_PRICE}).
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-title">Proof first</div>
            <p className="benefit-desc">
              Every spread is approved before payment, so what you approve is
              exactly what prints.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-title">Reprint promise</div>
            <p className="benefit-desc">
              Print defects and shipping damage reported within 14 days are
              reprinted free. <Link href="/refunds">See the policy</Link>.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-title">Wedding magazines</div>
            <p className="benefit-desc">
              A 20-page editorial-style magazine in ten original styles — a
              great add-on for parents and guests.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-title">Trade program — coming soon</div>
            <p className="benefit-desc">
              Trade pricing, repeat-order rewards and white-label shipping are
              in the works. Register now and we&apos;ll email you when they open.
            </p>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing-section" id="pricing">
        <span className="section-tag">Current pricing</span>
        <h2 className="section-title">
          Simple. Transparent.<br />No surprises.
        </h2>
        <div className="gold-line" />
        <div className="pricing-grid">
          <div className="pricing-card">
            <span className="pricing-tier">17×24 open</span>
            <span className="pricing-num">${ALBUM_PRICING['17x24'].standard.base}</span>
            <span className="pricing-sub">from · {ALBUM_PRICING['17x24'].standard.minSpreads} spreads</span>
            <ul className="pricing-features">
              <li>Lay-flat: ${ALBUM_PRICING['17x24'].layflat.base}</li>
              <li>+${ALBUM_PRICING['17x24'].standard.perExtraSpread} per extra spread</li>
              <li>Up to {ALBUM_PRICING['17x24'].standard.maxSpreads} spreads</li>
              <li>Photo cover included</li>
            </ul>
            <Link href="/design/smart" className="btn-outline" style={{ display: 'block', textAlign: 'center' }}>
              Start an Album
            </Link>
          </div>
          <div className="pricing-card featured">
            <div className="pricing-badge">Largest size</div>
            <span className="pricing-tier">20×30 open</span>
            <span className="pricing-num">${ALBUM_PRICING['20x30'].standard.base}</span>
            <span className="pricing-sub">from · {ALBUM_PRICING['20x30'].standard.minSpreads} spreads</span>
            <ul className="pricing-features">
              <li>Lay-flat: ${ALBUM_PRICING['20x30'].layflat.base}</li>
              <li>+${ALBUM_PRICING['20x30'].standard.perExtraSpread} per extra spread</li>
              <li>Up to {ALBUM_PRICING['20x30'].standard.maxSpreads} spreads</li>
              <li>Leather +${COVER_PRICE.leather} · Acrylic +${COVER_PRICE.acrylic}</li>
            </ul>
            <Link href="/design/smart" className="btn-gold" style={{ display: 'block', textAlign: 'center' }}>
              Start an Album
            </Link>
          </div>
          <div className="pricing-card">
            <span className="pricing-tier">Trade</span>
            <span className="pricing-num">Soon</span>
            <span className="pricing-sub">trade program coming soon</span>
            <ul className="pricing-features">
              <li>Trade pricing</li>
              <li>Repeat-order rewards</li>
              <li>White-label shipping</li>
            </ul>
            <Link href="/pro/join" className="btn-outline" style={{ display: 'block', textAlign: 'center' }}>
              Register Interest
            </Link>
          </div>
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, marginTop: 24 }}>
          Retail prices, before shipping. Delivery options and prices:{' '}
          <Link href="/shipping">Shipping &amp; Delivery</Link>.
        </p>
      </section>

      {/* HOW IT WORKS */}
      <section className="how-section">
        <span className="section-tag">Simple process</span>
        <h2 className="section-title">How it works for photographers</h2>
        <div className="gold-line" />
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <p className="step-title">Upload the gallery</p>
            <p className="step-desc">
              Choose a size and cover, then upload your edited photos.
            </p>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <p className="step-title">Lay out &amp; approve</p>
            <p className="step-desc">
              Smart Auto-Layout builds the spreads. Fine-tune, then approve each
              one.
            </p>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <p className="step-title">We print &amp; ship</p>
            <p className="step-desc">
              Printed in 5–7 business days, then shipped to you or your client
              with the delivery speed you choose.
            </p>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <p className="step-title">Client is amazed</p>
            <p className="step-desc">
              Your couple gets an heirloom they&apos;ll show everyone. You get
              the referrals.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq-section" id="faq">
        <span className="section-tag">Common questions</span>
        <h2 className="section-title">Photographer FAQ</h2>
        <div className="gold-line" />
        <div className="faq-list">
          <details className="faq-item">
            <summary className="faq-q">
              Is there a minimum order?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              No. Order a single album whenever you need one.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              Can albums be shipped directly to my clients?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Yes — enter your client&apos;s address at checkout and we ship
              anywhere in the US. Branded (white-label) packaging is coming
              soon.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              What files do I upload?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Your edited photos as full-size JPEG, PNG or WebP files. The
              designer lays them out and warns you if a photo is too small for
              its frame. Uploading finished spread designs is not available
              yet.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              How long does production take?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Printing takes 5–7 business days after approval and payment,
              then delivery depends on the option chosen at checkout. See{' '}
              <Link href="/shipping">Shipping &amp; Delivery</Link>.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              When does the trade program open?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Soon. <Link href="/pro/join">Register your interest</Link> and
              we&apos;ll email you as soon as trade pricing is available.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              Can I get a sample?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              A sample kit is coming soon. <Link href="/contact">Contact us</Link>{' '}
              and we&apos;ll let you know when it&apos;s ready.
            </div>
          </details>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span className="section-tag">Ready to get started?</span>
          <h2 className="cta-title">
            Your clients deserve<br />
            <em>the best album they&apos;ve ever held.</em>
          </h2>
          <div className="gold-line" />
          <p className="cta-sub">
            Start an album today, or register for the trade program and
            we&apos;ll be in touch when it opens.
          </p>
          <div
            style={{
              display: 'flex',
              gap: '14px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Link href="/pro/join" className="btn-gold">
              Register for the Trade Program
            </Link>
            <Link href="/design/smart" className="btn-outline">
              Start an Album
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
