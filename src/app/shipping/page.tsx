import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { SHIPPING_OPTIONS } from '@/lib/shipping';

export const metadata: Metadata = {
  title: 'Shipping & Delivery',
  description: 'Production times, delivery options and prices for Folio Forever albums and magazines.',
  alternates: { canonical: '/shipping' },
};

export default function ShippingPage() {
  return (
    <LegalPage eyebrow="Help" title="Shipping & Delivery" updated="September 26, 2026">
      <p className="legal-note">
        <strong>Total time = printing + delivery.</strong> Printing takes <strong>5–7 business days</strong> after you
        approve your proof and payment is complete. Then your order ships with the delivery option you choose at
        checkout.
      </p>

      <h2>Delivery options</h2>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Delivery after printing</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {SHIPPING_OPTIONS.map((o) => (
            <tr key={o.id}>
              <td>{o.label}</td>
              <td>{o.days}</td>
              <td>${o.usd}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Example: approve and pay on a Monday with Standard delivery → printed within 5–7 business days, then delivered
        about 7–10 days later. Delivery days are estimates from the carrier.
      </p>

      <h2>Where we ship</h2>
      <p>
        We currently ship within the United States. If you&apos;re outside the US, please{' '}
        <Link href="/contact">contact us</Link> before ordering.
      </p>

      <h2>Tracking</h2>
      <p>We email you a tracking number as soon as your order ships.</p>

      <h2>If there&apos;s a delay</h2>
      <p>
        If we can&apos;t ship within the time shown, we&apos;ll email you before that date with a new estimate and the
        choice to wait or cancel for a full refund. Refunds for cancelled orders are issued within 7 business days.
      </p>

      <h2>Address problems</h2>
      <p>
        Please double-check your address at checkout. If you notice a mistake, email us right away — we can change it
        until the order ships. Orders returned because of an incorrect address can be re-sent for the cost of shipping.
      </p>

      <h2>Damaged or lost in transit</h2>
      <p>
        We&apos;ll put it right — see our <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
      </p>
    </LegalPage>
  );
}
