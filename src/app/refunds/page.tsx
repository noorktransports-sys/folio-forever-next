import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description: 'How cancellations, reprints and refunds work for custom Folio Forever albums and magazines.',
  alternates: { canonical: '/refunds' },
};

export default function RefundsPage() {
  return (
    <LegalPage eyebrow="Policies" title="Refund & Cancellation Policy" updated="September 26, 2026">
      <p className="legal-note">
        <strong>In short:</strong> every album and magazine is printed just for you from the proof you approve, so we
        can&apos;t take returns for a change of mind. If anything arrives with a print defect or shipping damage, tell us
        within 14 days and we&apos;ll reprint it free or refund you.
      </p>

      <h2>Before you pay</h2>
      <p>
        Nothing is charged until you complete payment on Square&apos;s secure checkout. If you stop before paying, your
        order simply stays unpaid — there is nothing to cancel.
      </p>

      <h2>After you approve and pay</h2>
      <p>
        Your approved proof goes into production straight away, so we can&apos;t cancel, change or refund an order for a
        change of mind, a typo or photo choice you missed in the proof, or a delivery address you entered incorrectly.
        If you spot a problem right after paying, email us immediately — if printing hasn&apos;t started we&apos;ll do our
        best to help.
      </p>

      <h2>Print defects and shipping damage — always covered</h2>
      <p>We will reprint your order free of charge, or refund it in full if you prefer, when:</p>
      <ul>
        <li>it has a printing or binding defect (for example streaks, missing or out-of-order pages, loose binding);</li>
        <li>it arrives damaged in transit;</li>
        <li>it doesn&apos;t match the proof you approved.</li>
      </ul>
      <h3>How to report a problem</h3>
      <ol>
        <li>
          Email <a href="mailto:orders@folioforever.com">orders@folioforever.com</a> within <strong>14 days of delivery</strong>{' '}
          with your order number.
        </li>
        <li>Include clear photos of the problem (and of the packaging if it was damaged in transit).</li>
        <li>We&apos;ll reply within 2 business days. You won&apos;t need to send the item back unless we ask.</li>
      </ol>

      <h2>Lost parcels and delays</h2>
      <p>
        If your order is lost in transit we&apos;ll reprint and resend it or refund you. If we can&apos;t ship within the
        time we quoted, we&apos;ll email you before that date with a new estimate and the choice to wait or cancel for a
        full refund — see our <Link href="/shipping">Shipping Policy</Link>.
      </p>

      <h2>What isn&apos;t covered</h2>
      <ul>
        <li>Errors you approved in the proof (spelling, dates, photo order, crops).</li>
        <li>Soft or pixelated prints from low-resolution photos you chose to use.</li>
        <li>Normal colour differences between screens and print.</li>
      </ul>

      <h2>How refunds are paid</h2>
      <p>
        Approved refunds go back to your original payment method through Square within 7 business days of approval.
        Your bank may take a few more days to show it.
      </p>

      <h2>Questions</h2>
      <p>
        Email <a href="mailto:orders@folioforever.com">orders@folioforever.com</a> — we&apos;re happy to help.
      </p>
    </LegalPage>
  );
}
