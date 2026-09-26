import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { CLAUSE_CONTENT_POLICY, CLAUSE_CONTENT_RIGHTS, CLAUSE_PROOF_APPROVAL } from '@/lib/legal-clauses';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that apply when you design and order a wedding album or magazine from Folio Forever.',
  alternates: { canonical: '/terms' },
};

const UPDATED = 'September 26, 2026';

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Policies" title="Terms of Service" updated={UPDATED}>
      <p>
        These terms apply when you use folioforever.com (the &ldquo;site&rdquo;) to design, approve and order a printed
        wedding album or wedding magazine from Folio Forever (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Folio Forever is based
        in Florida, USA. By placing an order you agree to these terms, our{' '}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link>, our <Link href="/shipping">Shipping Policy</Link>{' '}
        and our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. What we sell</h2>
      <p>
        Custom, made-to-order printed products: wedding albums (several sizes, standard hardcover or lay-flat, with
        optional cover upgrades and an optional design-team polish) and 20-page 8.5&nbsp;×&nbsp;11&nbsp;in wedding
        magazines. Every product is printed from the photos and design you supply and approve.
      </p>

      <h2>2. Orders, prices and payment</h2>
      <ul>
        <li>Prices are in US dollars and are shown in the designer and at checkout, including the shipping option you choose.</li>
        <li>
          Payment is taken by Square on its secure checkout page. We never see or store your full card number. Sales
          tax is added where it applies.
        </li>
        <li>
          Your order is confirmed when payment succeeds. You&apos;ll receive an &ldquo;order received&rdquo; email with your
          order number when you place the order and a confirmation email once payment is complete.
        </li>
        <li>
          If a price on the site is ever shown wrongly because of an error, we&apos;ll contact you before printing and
          you may cancel for a full refund.
        </li>
        <li>We may refuse or cancel an order (with a full refund) if it breaks these terms or the content policy below.</li>
      </ul>

      <h2>3. Your proof approval</h2>
      <p>
        Before paying you review and approve every page or spread. Printing follows exactly what you approve, so please
        check names, dates, spelling, photo order and crops carefully. The clause you accept at checkout:
      </p>
      <pre className="legal-note" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{CLAUSE_PROOF_APPROVAL}</pre>

      <h2>4. Your photos and content</h2>
      <pre className="legal-note" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{CLAUSE_CONTENT_RIGHTS}</pre>
      <pre className="legal-note" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{CLAUSE_CONTENT_POLICY}</pre>
      <p>
        You keep all rights in your photos. You give us a limited licence to store, process and print them only to
        make and deliver your order, and to keep them for the period described in our{' '}
        <Link href="/privacy">Privacy Policy</Link>. We never use your photos in our marketing without your separate,
        written permission.
      </p>

      <h2>5. Production and delivery</h2>
      <p>
        Printing takes 5–7 business days after your proof is approved and payment is complete, then your order ships
        with the delivery option you chose. Details, delays and lost parcels are covered in our{' '}
        <Link href="/shipping">Shipping Policy</Link>.
      </p>

      <h2>6. Colour and materials</h2>
      <p>
        Screens and printers show colour differently, so printed colour, brightness and contrast can differ slightly
        from what you see on your screen. Small variations in paper, cover material and trimming are normal for
        hand-finished products and are not defects.
      </p>

      <h2>7. Refunds and cancellations</h2>
      <p>
        Because every product is made just for you, orders can&apos;t be cancelled or returned for a change of mind once
        your proof is approved and paid. Print defects and shipping damage are always put right — see the{' '}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
      </p>

      <h2>8. Our designs and the site</h2>
      <p>
        The site, its software, layouts, templates, magazine styles and branding belong to Folio Forever. You may use
        the products you order for personal use. You may not copy or resell our templates or designs.
      </p>

      <h2>9. Copyright complaints</h2>
      <p>
        If you believe something uploaded to our site infringes your copyright, email{' '}
        <a href="mailto:orders@folioforever.com">orders@folioforever.com</a> with the details (who you are, the work,
        where it appears, and a statement that you believe the use is not authorised). We&apos;ll review it promptly and
        remove infringing material.
      </p>

      <h2>10. Liability</h2>
      <p>
        To the extent the law allows, our total liability for any order is limited to the amount you paid for that
        order, and we are not liable for indirect or consequential losses. Nothing in these terms limits rights you have
        under consumer law that cannot be excluded.
      </p>

      <h2>11. Governing law</h2>
      <p>These terms are governed by the laws of the State of Florida, USA.</p>

      <h2>12. Changes and contact</h2>
      <p>
        We may update these terms; the version shown when you place an order applies to that order. Questions? Email{' '}
        <a href="mailto:orders@folioforever.com">orders@folioforever.com</a> or visit our{' '}
        <Link href="/contact">contact page</Link>.
      </p>
    </LegalPage>
  );
}
