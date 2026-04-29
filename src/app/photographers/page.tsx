import type { Metadata } from 'next';
import Link from 'next/link';
import './photographers.css';

/**
 * Photographers / trade page — ported from
 * `folio-forever-child/page-photographers.php`.
 *
 * The FAQ accordion is implemented with native <details>/<summary> instead of
 * a custom click handler. This keeps the page a server component (no
 * 'use client' needed) and gives accessibility/keyboard handling for free.
 *
 * Pricing values here (Standard $149, Monument $229) are placeholder copy
 * from the WP version. Real pricing will load from a config file once
 * Stripe checkout is wired (Task #6).
 */
export const metadata: Metadata = {
  title: 'For Photographers — Trade Pricing',
  description:
    'Trade pricing for wedding photographers. 30–40% below retail, no minimums, 12–16 day turnaround, white label shipping available.',
};

const ROUTE_HOME = '/';
const ROUTE_DESIGN = '/design';
const ROUTE_PHOTOG = '/photographers';
const ROUTE_ALBUMS = '/#albums';
const ROUTE_SAMPLE = '/#sample';

export default function PhotographersPage() {
  return (
    <>
      {/* NAV */}
      <nav>
        <Link href={ROUTE_HOME} className="nav-logo">
          FOLIO &amp; FOREVER
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
            <Link href={ROUTE_SAMPLE}>Sample Kit</Link>
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
            Built by a working wedding photographer. Trade pricing, zero
            minimums, and a quality that makes you look like the best in the
            business.
          </p>
          <div className="hero-btns">
            <a href="#pricing" className="btn-gold">
              See Trade Pricing
            </a>
            <Link href={ROUTE_DESIGN} className="btn-outline">
              Start a Sample Order
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
                So I built Folio &amp; Forever — a print company designed
                specifically for photographers who care about their craft. Our
                3D tactile printing and oversized formats are things no other
                online printer offers.
              </p>
              <p>
                When your couple opens one of our albums for the first time,
                they will not stop talking about it. That&apos;s a referral
                you didn&apos;t have to ask for.
              </p>
            </div>
            <div className="from-signature">
              — Noor K, Founder &amp; Wedding Photographer
            </div>
          </div>
          <div className="from-card">
            <div className="from-card-title">What photographers get</div>
            <div className="from-stat">
              <span className="from-stat-label">Trade discount</span>
              <span className="from-stat-val">30–40%</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">Minimum order</span>
              <span className="from-stat-val">Zero</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">Turnaround</span>
              <span className="from-stat-val">12–16 days</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">Repeat order discount</span>
              <span className="from-stat-val">Extra 10%</span>
            </div>
            <div className="from-stat">
              <span className="from-stat-label">White label option</span>
              <span className="from-stat-val">Available</span>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="benefits-section">
        <span className="section-tag">Why photographers choose us</span>
        <h2 className="section-title">
          Everything you need.<br />Nothing you don&apos;t.
        </h2>
        <div className="gold-line" />
        <div className="benefits-grid">
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 2l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                />
              </svg>
            </div>
            <div className="benefit-title">Quality that sells itself</div>
            <p className="benefit-desc">
              Our 3D tactile printing and oversized formats are unlike anything
              your clients have seen. One unboxing video and your DMs fill up.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect
                  x="2"
                  y="4"
                  width="16"
                  height="12"
                  rx="2"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                />
                <path d="M2 8h16" stroke="#b8965a" strokeWidth="0.8" />
              </svg>
            </div>
            <div className="benefit-title">Trade pricing — no minimums</div>
            <p className="benefit-desc">
              30–40% below retail. Order one album or one hundred. No annual
              fees, no contracts, no commitments required.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                />
                <path
                  d="M10 6v4l3 3"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="benefit-title">12–16 day turnaround</div>
            <p className="benefit-desc">
              Consistent delivery window you can promise your clients. Track
              every order and get notified at each production stage.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M4 4h12v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                />
                <path
                  d="M8 15v2M12 15v2M6 17h8"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="benefit-title">White label available</div>
            <p className="benefit-desc">
              Ship directly to your clients with your studio branding — not
              ours. Your name on the box, your reputation on the album.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 3l1.5 3 3.5.5-2.5 2.5.5 3.5L10 13l-3 1.5.5-3.5L5 8.5l3.5-.5L10 5z"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                />
              </svg>
            </div>
            <div className="benefit-title">Repeat order rewards</div>
            <p className="benefit-desc">
              Every 5th order earns an extra 10% discount. The more you use
              us, the better your margins get.
            </p>
          </div>
          <div className="benefit-card">
            <div className="benefit-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 10h14M10 3l7 7-7 7"
                  stroke="#b8965a"
                  strokeWidth="0.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="benefit-title">Designer upload portal</div>
            <p className="benefit-desc">
              Upload your designed spreads directly. Or let your clients use
              our self-design tool — we handle the rest.
            </p>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing-section" id="pricing">
        <span className="section-tag">Trade pricing</span>
        <h2 className="section-title">
          Simple. Transparent.<br />No surprises.
        </h2>
        <div className="gold-line" />
        <div className="pricing-grid">
          <div className="pricing-card">
            <span className="pricing-tier">Standard</span>
            <span className="pricing-num">$149</span>
            <span className="pricing-sub">per album · trade price</span>
            <ul className="pricing-features">
              <li>17×12 inches closed</li>
              <li>Up to 20 spreads</li>
              <li>3D tactile printing</li>
              <li>Lay-flat binding</li>
              <li>Choice of cover material</li>
              <li>12–16 day delivery</li>
            </ul>
            <Link
              href={ROUTE_DESIGN}
              className="btn-outline"
              style={{ display: 'block', textAlign: 'center' }}
            >
              Order Now
            </Link>
          </div>
          <div className="pricing-card featured">
            <div className="pricing-badge">Most Popular</div>
            <span className="pricing-tier">Monument</span>
            <span className="pricing-num">$229</span>
            <span className="pricing-sub">per album · trade price</span>
            <ul className="pricing-features">
              <li>20×30 inches closed</li>
              <li>Opens to 20×60&quot;</li>
              <li>3D tactile printing</li>
              <li>Premium lay-flat binding</li>
              <li>Luxury cover options</li>
              <li>Priority 12–14 day delivery</li>
            </ul>
            <Link
              href={ROUTE_DESIGN}
              className="btn-gold"
              style={{ display: 'block', textAlign: 'center' }}
            >
              Order Now
            </Link>
          </div>
          <div className="pricing-card">
            <span className="pricing-tier">Volume</span>
            <span className="pricing-num">Custom</span>
            <span className="pricing-sub">5+ albums per month</span>
            <ul className="pricing-features">
              <li>All Monument features</li>
              <li>Extra 10–15% discount</li>
              <li>Dedicated account manager</li>
              <li>White label shipping</li>
              <li>Priority production slot</li>
              <li>Monthly invoicing available</li>
            </ul>
            <a
              href="mailto:orders@noorkphotography.com"
              className="btn-outline"
              style={{ display: 'block', textAlign: 'center' }}
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how-section">
        <span className="section-tag">Simple process</span>
        <h2 className="section-title">How it works for photographers</h2>
        <div className="gold-line" />
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <p className="step-title">Apply for trade account</p>
            <p className="step-desc">
              Fill out a quick form — approved within 24 hours. No fees or
              commitments.
            </p>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <p className="step-title">Upload your design</p>
            <p className="step-desc">
              Send us your designed spreads or have your client use our
              self-design tool.
            </p>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <p className="step-title">We print &amp; ship</p>
            <p className="step-desc">
              We print, package carefully, and ship directly to you or your
              client.
            </p>
          </div>
          <div className="step">
            <div className="step-num">4</div>
            <p className="step-title">Client is amazed</p>
            <p className="step-desc">
              Your couple gets an album unlike anything they&apos;ve seen. You
              get the referrals.
            </p>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="testimonials-section">
        <span className="section-tag" style={{ color: 'var(--gold)' }}>
          What photographers say
        </span>
        <h2 className="section-title" style={{ color: 'var(--dark)' }}>
          From photographers<br />who switched to us
        </h2>
        <div className="gold-line" />
        <div className="testimonials-grid">
          <div className="testimonial-card">
            <p className="testimonial-quote">
              “My couples literally gasp when they open these albums.
              I&apos;ve had three referrals this month just from someone
              seeing it at a dinner party.”
            </p>
            <span className="testimonial-author">— Jessica M.</span>
            <span className="testimonial-role">
              Wedding photographer, Texas
            </span>
          </div>
          <div className="testimonial-card">
            <p className="testimonial-quote">
              “The trade pricing makes it easy to bundle into my packages. My
              margins are better and my clients are happier. I don&apos;t
              know why I waited so long.”
            </p>
            <span className="testimonial-author">— David R.</span>
            <span className="testimonial-role">
              Wedding photographer, California
            </span>
          </div>
          <div className="testimonial-card">
            <p className="testimonial-quote">
              “The 3D texture is something you have to feel to believe. Every
              single client calls me after delivery to say thank you. That
              never happened with my old lab.”
            </p>
            <span className="testimonial-author">— Priya S.</span>
            <span className="testimonial-role">
              Wedding photographer, New York
            </span>
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
              Do I need to order a minimum quantity?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              No minimums ever. Order one album for a single client or fifty
              for a busy season. Trade pricing applies from your very first
              order.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              Can albums be shipped directly to my clients?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Yes. We can ship directly to your client anywhere in the US
              with white label packaging — your studio name on the box, not
              ours.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              What file formats do you accept?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              We accept high resolution JPG or PDF files. Minimum 300 DPI. We
              also offer a self-design portal your clients can use directly.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              How long does production take?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Standard turnaround is 12–16 business days from design approval.
              Volume accounts get priority production slots.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              What is the repeat order discount?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Every 5th album order earns an additional 10% off that order.
              This stacks automatically — no codes or requests needed.
            </div>
          </details>
          <details className="faq-item">
            <summary className="faq-q">
              Can I get a sample before ordering for clients?
              <span className="faq-icon">+</span>
            </summary>
            <div className="faq-a">
              Absolutely. We recommend ordering a sample kit first ($15,
              credited toward your first order) so you can show clients the
              paper quality and 3D texture in person.
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
            Apply for your trade account today. Approved within 24 hours. No
            fees, no minimums, no contracts.
          </p>
          <div
            style={{
              display: 'flex',
              gap: '14px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Link href={ROUTE_DESIGN} className="btn-gold">
              Apply for Trade Account
            </Link>
            <Link href={ROUTE_DESIGN} className="btn-outline">
              Order a Sample Kit — $15
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">FOLIO &amp; FOREVER</div>
        <ul className="footer-links">
          <li>
            <Link href={ROUTE_HOME}>Home</Link>
          </li>
          <li>
            <Link href={ROUTE_ALBUMS}>Albums</Link>
          </li>
          <li>
            <Link href={ROUTE_DESIGN}>Design</Link>
          </li>
          <li>
            <Link href={ROUTE_PHOTOG}>Photographers</Link>
          </li>
          <li>
            <a href="#faq">FAQ</a>
          </li>
          <li>
            <a href="mailto:orders@noorkphotography.com">Contact</a>
          </li>
        </ul>
        <span className="footer-copy">
          © {new Date().getFullYear()} Folio &amp; Forever. All rights
          reserved.
        </span>
      </footer>
    </>
  );
}
