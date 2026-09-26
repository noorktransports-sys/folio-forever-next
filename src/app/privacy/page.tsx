import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What personal information and photos Folio Forever collects, why, who we share it with and your choices.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Policies" title="Privacy Policy" updated="September 26, 2026">
      <p>
        This policy explains what Folio Forever (&ldquo;we&rdquo;, based in Florida, USA) collects when you use
        folioforever.com, why, and the choices you have. Questions:{' '}
        <a href="mailto:orders@folioforever.com">orders@folioforever.com</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Order details:</strong> your name, email, phone number (optional), shipping address and delivery
          notes.
        </li>
        <li>
          <strong>Your photos and designs:</strong> the photos you upload, your layout, text (such as names and dates)
          and the print files made from your approved proof.
        </li>
        <li>
          <strong>Approval records:</strong> when you approved your proof and accepted our terms, with your IP address
          and browser type, kept as proof of the order.
        </li>
        <li>
          <strong>Payment:</strong> handled entirely by Square. We receive the payment status and amount, never your
          full card number.
        </li>
        <li>
          <strong>Designs saved on your device:</strong> the designer keeps your work-in-progress in your own
          browser&apos;s storage so you can come back to it. It isn&apos;t sent to us until you order or save.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To make, print and deliver your order and send you order and shipping emails.</li>
        <li>To answer your questions and handle reprints or refunds.</li>
        <li>To keep records we need for accounting, tax and legal reasons.</li>
        <li>To keep the site secure (for example, limiting repeated requests).</li>
      </ul>
      <p>We don&apos;t sell your personal information, and we don&apos;t use advertising trackers.</p>

      <h2>Who we share it with</h2>
      <p>Only the service providers that help us run the shop, and only what they need:</p>
      <ul>
        <li><strong>Square</strong> — payments.</li>
        <li><strong>Cloudflare</strong> — website hosting and secure storage of your photos and order records.</li>
        <li><strong>Resend</strong> — sending order emails.</li>
        <li><strong>Our print and shipping partners</strong> — to print your order and deliver it to your address.</li>
      </ul>
      <p>We may also disclose information if the law requires it.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          <strong>Photos and print files:</strong> kept for up to 12 months after delivery so we can reprint if
          something goes wrong, then deleted. Unpaid orders and their files may be deleted sooner.
        </li>
        <li>
          <strong>Order and approval records:</strong> kept for as long as needed for tax, accounting and legal
          purposes (usually up to 7 years).
        </li>
      </ul>

      <h2>Your choices and rights</h2>
      <p>
        You can ask us to show you, correct or delete the personal information and photos we hold about you by emailing{' '}
        <a href="mailto:orders@folioforever.com">orders@folioforever.com</a>. We&apos;ll respond within 30 days. We may
        keep records we&apos;re legally required to keep. Residents of some states (including California) may have
        additional rights; we&apos;ll honour them.
      </p>

      <h2>Cookies</h2>
      <p>
        We use only the cookies and browser storage needed for the site to work (for example, keeping your design in
        progress and keeping staff signed in). We don&apos;t use advertising cookies.
      </p>

      <h2>Children</h2>
      <p>The site isn&apos;t directed to children under 13, and we don&apos;t knowingly collect their information.</p>

      <h2>Security</h2>
      <p>
        Data is sent over encrypted connections and stored with access controls. No system is perfectly secure, so
        please contact us right away if you think something is wrong.
      </p>

      <h2>Changes</h2>
      <p>
        We&apos;ll post any changes here with a new date. See also our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
