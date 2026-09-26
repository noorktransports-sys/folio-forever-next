import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contact Folio Forever about an order, a reprint, or anything else.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <LegalPage eyebrow="Help" title="Contact us">
      <p>We&apos;re a small studio in Florida and we read every message.</p>

      <h2>Email</h2>
      <p style={{ fontSize: 20 }}>
        <a href="mailto:orders@folioforever.com">orders@folioforever.com</a>
      </p>
      <p>
        We reply within 1–2 business days. If it&apos;s about an order, please include your order number (it starts with{' '}
        <strong>FF-</strong> and is in your order email).
      </p>

      <h2>Common questions</h2>
      <ul>
        <li>
          Delivery times and prices — <Link href="/shipping">Shipping &amp; Delivery</Link>
        </li>
        <li>
          Something arrived damaged or with a print problem — <Link href="/refunds">Refunds &amp; Cancellations</Link>{' '}
          (please report within 14 days of delivery, with photos)
        </li>
        <li>
          Everything else — <Link href="/faq">FAQ</Link>
        </li>
      </ul>

      <h2>Photographers</h2>
      <p>
        Interested in offering Folio Forever albums to your clients? Our trade program is coming soon —{' '}
        <Link href="/pro/join">register your interest</Link> or email us.
      </p>
    </LegalPage>
  );
}
