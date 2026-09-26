import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import JsonLd from '@/components/JsonLd';
import { ALBUM_PRICING, COVER_PRICE, POLISH_PRICE, type AlbumSizeKey } from '@/lib/pricing';
import { SHIPPING_OPTIONS } from '@/lib/shipping';
import { albumProductLd, breadcrumbLd, faqLd } from '@/lib/seo';
import '@/components/product-page.css';

/**
 * /wedding-albums — the indexable landing page for albums. The designer at
 * /design/smart is an app (little text for search engines), so this page
 * explains the product in words and links into it. Every price shown is
 * read from lib/pricing, the same table checkout charges from.
 */

const from = Math.min(...Object.values(ALBUM_PRICING).map((t) => t.standard.base));

export const metadata: Metadata = {
  title: 'Custom Lay-Flat Wedding Albums up to 20×30 in',
  description: `Design a custom wedding album online: Smart Auto-Layout builds every spread, you approve each page, we print it. Standard or lay-flat binding, 17×24 to 20×30 inches open, from $${from}.`,
  alternates: { canonical: '/wedding-albums' },
  openGraph: {
    title: 'Custom Wedding Albums | Folio Forever',
    description: 'Large-format standard and lay-flat wedding albums, designed online and approved page by page.',
    url: '/wedding-albums',
  },
};

const SIZES: Array<{ key: AlbumSizeKey; name: string; closed: string; desc: string }> = [
  { key: '17x24', name: '17×24 in open', closed: '17×12 in closed', desc: 'The classic coffee-table size. A commanding presence on any table or shelf.' },
  { key: '12x24', name: '12×24 in open', closed: '12×12 in closed', desc: 'A square album that opens into slim panoramic spreads.' },
  { key: '15x30', name: '15×30 in open', closed: '15×15 in closed', desc: 'A larger square album with grand, wide panoramic spreads.' },
  { key: '20x30', name: '20×30 in open', closed: '20×15 in closed', desc: 'Our largest format — an oversized statement piece built to be displayed.' },
];

const FAQS = [
  {
    q: 'What is a lay-flat wedding album?',
    a: 'In a lay-flat (flush-mount) album every page opens completely flat with no dip in the middle, so a single photo can run seamlessly across both pages. Standard hardcover albums have a small gutter at the center fold.',
  },
  {
    q: 'How many spreads can my album have?',
    a: `Every album starts at ${ALBUM_PRICING['17x24'].standard.minSpreads} spreads (${ALBUM_PRICING['17x24'].standard.minSpreads * 2} pages) and can have up to ${ALBUM_PRICING['17x24'].standard.maxSpreads} spreads. Each extra spread adds a small per-spread price shown in the table above.`,
  },
  {
    q: 'Do I have to design the album myself?',
    a: `No. Upload your photos and Smart Auto-Layout designs every spread for you in minutes. You can adjust anything, or add design-team polish (+$${POLISH_PRICE}) and our designers hand-finish every spread before printing.`,
  },
  {
    q: 'How long does a wedding album take?',
    a: `Printing takes 5–7 business days after you approve your proof and pay, then delivery takes ${SHIPPING_OPTIONS.map((o) => `${o.days} (${o.label})`).join(', ')}.`,
  },
];

export default function WeddingAlbumsPage() {
  return (
    <>
      <JsonLd data={albumProductLd()} />
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Wedding albums', path: '/wedding-albums' }])} />
      <JsonLd data={faqLd(FAQS)} />
      <SiteHeader />
      <main className="pp-main">
        <section className="pp-hero">
          <div className="pp-wrap">
            <div role="navigation" className="pp-crumbs" aria-label="Breadcrumb">
              <Link href="/">Home</Link> / <span aria-current="page">Wedding albums</span>
            </div>
            <p className="pp-eyebrow">Custom wedding albums</p>
            <h1 className="pp-h1">Custom wedding albums, designed online and printed to last</h1>
            <p className="pp-lede">
              Upload your wedding photos and Smart Auto-Layout designs every spread for you. Choose standard or lay-flat
              binding, sizes up to 20×30 inches open, and approve every page before we print.
            </p>
            <div className="pp-ctas">
              <Link href="/design/smart" className="pp-btn pp-btn-gold">Design your album</Link>
              <a href="#prices" className="pp-btn pp-btn-line">See prices</a>
            </div>
            <div className="pp-facts">
              <div className="pp-fact"><b>From ${from}</b><span>10 spreads included</span></div>
              <div className="pp-fact"><b>Up to 20×30 in</b><span>Open size</span></div>
              <div className="pp-fact"><b>Lay-flat</b><span>or standard binding</span></div>
              <div className="pp-fact"><b>5–7 days</b><span>Printing after approval</span></div>
            </div>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="sizes">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Sizes</p>
            <h2 className="pp-h2" id="sizes">Four large-format album sizes</h2>
            <p className="pp-intro">
              Sizes are height × width with the album open across both pages, so a 17×24 album is 17×12 inches
              when closed.
            </p>
            <div className="pp-grid">
              {SIZES.map((s) => (
                <div className="pp-card" key={s.key}>
                  <h3>{s.name}</h3>
                  <p>{s.closed} · {s.desc}</p>
                  <span className="pp-price">From ${ALBUM_PRICING[s.key].standard.base}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="binding">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Binding &amp; covers</p>
            <h2 className="pp-h2" id="binding">Standard or lay-flat, with the cover you love</h2>
            <div className="pp-grid">
              <div className="pp-card">
                <h3>Standard hardcover</h3>
                <p>Classic bound pages with a small gutter at the fold. The most affordable way to a large album.</p>
              </div>
              <div className="pp-card">
                <h3>Lay-flat (flush-mount)</h3>
                <p>Thick pages that open completely flat, so panoramic photos run seamlessly across the spread.</p>
              </div>
              <div className="pp-card">
                <h3>Photo cover</h3>
                <p>Your favorite photo wrapped around the cover, with your names and date. Included.</p>
              </div>
              <div className="pp-card">
                <h3>Leather or acrylic</h3>
                <p>Leather with foil lettering (+${COVER_PRICE.leather}) or a glossy acrylic photo cover (+${COVER_PRICE.acrylic}).</p>
              </div>
            </div>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="prices" id="prices">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Prices</p>
            <h2 className="pp-h2">Wedding album prices</h2>
            <p className="pp-intro">
              Prices include {ALBUM_PRICING['17x24'].standard.minSpreads} spreads ({ALBUM_PRICING['17x24'].standard.minSpreads * 2} pages)
              and a photo cover. You see the exact total, with shipping, before you pay.
            </p>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Size (open)</th>
                    <th>Standard</th>
                    <th>Lay-flat</th>
                    <th>Extra spread</th>
                  </tr>
                </thead>
                <tbody>
                  {SIZES.map((s) => {
                    const t = ALBUM_PRICING[s.key];
                    return (
                      <tr key={s.key}>
                        <td><strong>{s.name.replace(' open', '')}</strong></td>
                        <td>${t.standard.base}</td>
                        <td>${t.layflat.base}</td>
                        <td>+${t.standard.perExtraSpread} / +${t.layflat.perExtraSpread}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="pp-note">
              Up to {ALBUM_PRICING['17x24'].standard.maxSpreads} spreads. Optional design-team polish +${POLISH_PRICE}.
              Delivery: {SHIPPING_OPTIONS.map((o) => `${o.label} $${o.usd}`).join(' · ')} —{' '}
              <Link href="/shipping">shipping details</Link>.
            </p>
          </div>
        </section>

        <section className="pp-section" aria-labelledby="how">
          <div className="pp-wrap">
            <p className="pp-eyebrow">How it works</p>
            <h2 className="pp-h2" id="how">From photos to finished album</h2>
            <ol className="pp-steps">
              <li><strong>Choose &amp; upload</strong>Pick a size, binding and cover, then upload your wedding photos.</li>
              <li><strong>Auto-layout</strong>Smart Auto-Layout arranges every spread. Swap, crop or add text as you like.</li>
              <li><strong>Approve every page</strong>Check each spread and approve it. We print exactly what you approve.</li>
              <li><strong>Printed &amp; shipped</strong>Printed in 5–7 business days, then shipped with tracking anywhere in the US.</li>
            </ol>
          </div>
        </section>

        <section className="pp-section pp-faq" aria-labelledby="faq">
          <div className="pp-wrap">
            <p className="pp-eyebrow">Questions</p>
            <h2 className="pp-h2" id="faq">Wedding album FAQ</h2>
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
            <p className="pp-note">
              More answers in our <Link href="/faq">FAQ</Link>. Every order is covered by our{' '}
              <Link href="/refunds">reprint promise</Link>.
            </p>
          </div>
        </section>

        <section className="pp-cta">
          <div className="pp-wrap">
            <h2 className="pp-h2">Start your wedding album</h2>
            <p>It takes a few minutes to see your whole album laid out. Nothing is charged until you approve and pay.</p>
            <div className="pp-ctas">
              <Link href="/design/smart" className="pp-btn pp-btn-gold">Design your album</Link>
              <Link href="/wedding-magazine" className="pp-btn pp-btn-line">Or make a wedding magazine</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
