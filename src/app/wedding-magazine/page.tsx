import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import JsonLd from '@/components/JsonLd';
import { MAG_STYLES, MAG_PRICE, MAG_PAGE_COUNT } from '@/lib/magazine/pages';
import { SHIPPING_OPTIONS } from '@/lib/shipping';
import { magazineProductLd, breadcrumbLd, faqLd } from '@/lib/seo';
import '@/components/product-page.css';

/**
 * /wedding-magazine — the indexable landing page for the wedding magazine.
 * The designer at /design/magazine is an app; this page describes the
 * product in words (styles come straight from the style catalogue) and
 * links into it. No demo wedding photos are used here.
 */

export const metadata: Metadata = {
  title: 'Custom Wedding Magazine From Your Photos',
  description: `Turn your wedding photos into a ${MAG_PAGE_COUNT}-page, 8.5×11 inch editorial-style wedding magazine. Choose from ${MAG_STYLES.length} original styles, preview every page, and order for $${MAG_PRICE}.`,
  alternates: { canonical: '/wedding-magazine' },
  openGraph: {
    title: 'Custom Wedding Magazine | Folio Forever',
    description: `A ${MAG_PAGE_COUNT}-page editorial wedding magazine made from your photos, in ${MAG_STYLES.length} original styles.`,
    url: '/wedding-magazine',
  },
};

const FAQS = [
  {
    q: 'What is a wedding magazine?',
    a: `A wedding magazine tells the story of your day like a glossy editorial: a cover, feature spreads, quotes and your best photos across ${MAG_PAGE_COUNT} pages. It is lighter and more casual than an album — perfect for coffee tables, parents and guests.`,
  },
  {
    q: 'How many photos do I need?',
    a: 'Upload as many as you like; the designer places them into the style’s page layouts automatically. You can swap, crop and change the text on every page before ordering.',
  },
  {
    q: 'Can I see it before I pay?',
    a: 'Yes. You preview every page on screen and can email yourself a watermarked preview. You approve each page before paying, and we print exactly what you approve.',
  },
  {
    q: 'How much does a wedding magazine cost?',
    a: `$${MAG_PRICE} for the ${MAG_PAGE_COUNT}-page magazine, plus delivery: ${SHIPPING_OPTIONS.map((o) => `${o.label} $${o.usd}`).join(', ')}.`,
  },
];

export default function WeddingMagazinePage() {
  return (
    <>
      <JsonLd data={magazineProductLd()} />
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Wedding magazine', path: '/wedding-magazine' }])} />
      <JsonLd data={faqLd(FAQS)} />
      <SiteHeader />
      <main className="pp-main">
        <section className="pp-hero">
          <div className="pp-wrap">
            <div role="navigation" className="pp-crumbs" aria-label="Breadcrumb">
              <Link href="/">Home</Link> / <span aria-current="page">Wedding magazine</span>
            </div>
            <p className="pp-eyebrow">Wedding magazines</p>
            <h1 className="pp-h1">A custom wedding magazine, made from your photos</h1>
            <p className="pp-lede">
              Turn your wedding day into a {MAG_PAGE_COUNT}-page editorial magazine. Pick one of {MAG_STYLES.length} original
              styles, upload your photos, and every page is laid out for you in minutes.
            </p>
            <div className="pp-ctas">
              <Link href="/design/magazine" className="pp-btn pp-btn-gold">Make your magazine</Link>
              <a href="#styles" className="pp-btn pp-btn-line">See the styles</a>
            </div>
            <div className="pp-facts">
              <div className="pp-fact"><b>${MAG_PRICE}</b><span>Complete magazine</span></div>
              <div className="pp-fact"><b>{MAG_PAGE_COUNT} pages</b><span>8.5×11 inches</span></div>
              <div className="pp-fact"><b>{MAG_STYLES.length} styles</b><span>Original designs</span></div>
              <div className="pp-fact"><b>Preview</b><span>Every page first</span></div>
            </div>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="styles" id="styles">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Styles</p>
            <h2 className="pp-h2">{MAG_STYLES.length} original magazine styles</h2>
            <p className="pp-intro">
              Each style has its own cover, typography, colors and page layouts. You can switch styles at any time
              while designing and your photos are re-placed into the new design.
            </p>
            <div className="pp-grid">
              {MAG_STYLES.map((st) => (
                <div className="pp-card" key={st.id}>
                  <div className="pp-swatches" aria-hidden>
                    {st.swatches.map((c, i) => (
                      <span key={i} style={{ background: c }} />
                    ))}
                  </div>
                  <h3>{st.name}</h3>
                  <p>{st.tagline}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="inside">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Inside the magazine</p>
            <h2 className="pp-h2" id="inside">Your wedding, told like a feature story</h2>
            <div className="pp-grid">
              <div className="pp-card">
                <h3>A real cover</h3>
                <p>Your names, date and favorite portrait on a magazine-style cover.</p>
              </div>
              <div className="pp-card">
                <h3>Feature spreads</h3>
                <p>Getting ready, the ceremony, portraits and the party — laid out like an editorial.</p>
              </div>
              <div className="pp-card">
                <h3>Your words</h3>
                <p>Edit every headline, quote and caption, or keep the ready-written story text.</p>
              </div>
              <div className="pp-card">
                <h3>Great as a gift</h3>
                <p>A lighter keepsake for parents, the wedding party or the guest table.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="how">
          <div className="pp-wrap">
            <p className="pp-eyebrow">How it works</p>
            <h2 className="pp-h2" id="how">Ready in minutes, printed in days</h2>
            <ol className="pp-steps">
              <li><strong>Pick a style</strong>Choose from {MAG_STYLES.length} designs.</li>
              <li><strong>Upload photos</strong>Every page fills in automatically. Swap photos and edit text as you like.</li>
              <li><strong>Preview &amp; approve</strong>Check every page, email yourself a preview, then approve and pay.</li>
              <li><strong>Printed &amp; shipped</strong>Printed in 5–7 business days, then shipped with tracking anywhere in the US.</li>
            </ol>
            <p className="pp-note">
              Delivery: {SHIPPING_OPTIONS.map((o) => `${o.label} ${o.days} ($${o.usd})`).join(' · ')} —{' '}
              <Link href="/shipping">shipping details</Link>.
            </p>
          </div>
        </section>

        <section className="pp-section pp-faq" aria-labelledby="faq">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Questions</p>
            <h2 className="pp-h2" id="faq">Wedding magazine FAQ</h2>
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
            <p className="pp-note">
              More answers in our <Link href="/faq">FAQ</Link>. Print defects are covered by our{' '}
              <Link href="/refunds">reprint promise</Link>.
            </p>
          </div>
        </section>

        <section className="pp-cta">
          <div className="pp-wrap">
            <h2 className="pp-h2">Make your wedding magazine</h2>
            <p>See your whole magazine laid out in minutes. Nothing is charged until you approve and pay.</p>
            <div className="pp-ctas">
              <Link href="/design/magazine" className="pp-btn pp-btn-gold">Make your magazine</Link>
              <Link href="/wedding-albums" className="pp-btn pp-btn-line">Or design a wedding album</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
