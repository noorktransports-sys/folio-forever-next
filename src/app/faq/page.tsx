import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/LegalPage';
import { SHIPPING_OPTIONS } from '@/lib/shipping';
import JsonLd from '@/components/JsonLd';
import { faqLd, breadcrumbLd } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Answers about designing, approving, printing and shipping your Folio Forever wedding album or magazine.',
  alternates: { canonical: '/faq' },
};

const ship = SHIPPING_OPTIONS.map((o) => `${o.label} ${o.days} ($${o.usd})`).join(', ');

const FAQS: Array<{ q: string; a: React.ReactNode; text: string }> = [
  {
    q: 'How long will my order take?',
    text: 'Printing takes 5–7 business days after you approve your proof and pay. Delivery then depends on the option you choose: ' + ship + '.',
    a: (
      <>
        Printing takes 5–7 business days after you approve your proof and pay. Delivery then depends on the option you
        choose: {ship}. See <Link href="/shipping">Shipping &amp; Delivery</Link>.
      </>
    ),
  },
  {
    q: 'How does proof approval work?',
    text: 'Before paying you see every spread or page exactly as it will print, and you tick each one to confirm it. We print exactly what you approve.',
    a: (
      <>
        Before paying you see every spread or page exactly as it will print, and you tick each one to confirm it. We
        print exactly what you approve, so check names, dates, spelling and crops carefully.
      </>
    ),
  },
  {
    q: 'Can I change or cancel after I pay?',
    text: 'Approved proofs go to print straight away, so orders can’t be changed or cancelled for a change of mind. Print defects and shipping damage reported within 14 days are reprinted free or refunded.',
    a: (
      <>
        Your approved proof goes to print straight away, so orders can&apos;t be changed or cancelled for a change of
        mind. If you notice a problem right after paying, email us immediately. Print defects and shipping damage are
        always fixed — see our <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
      </>
    ),
  },
  {
    q: 'What photo quality do I need?',
    text: 'Upload the original, full-size JPEG, PNG or WebP files. The designer warns you when a photo is too small for its frame.',
    a: (
      <>
        Upload the original, full-size files from your photographer or phone (JPEG, PNG or WebP). The designer warns
        you when a photo is too small for its frame; low-resolution photos can print soft.
      </>
    ),
  },
  {
    q: 'What’s the difference between an album and a magazine?',
    text: 'Albums are large hardcover or lay-flat books from 17×24 inches open. The wedding magazine is a 20-page 8.5×11 inch editorial-style keepsake for $70.',
    a: (
      <>
        Albums are large hardcover or lay-flat books (from 17×24 in open) built to last generations. The wedding
        magazine is a 20-page 8.5×11 in editorial-style keepsake for $70 — great as a gift or a guest-table piece.
      </>
    ),
  },
  {
    q: 'Can your team design the album for me?',
    text: 'Yes. Build it with Smart Auto-Layout and add Design-team polish (+$99) at checkout; our designers hand-finish every spread before printing.',
    a: (
      <>
        Yes — build it with Smart Auto-Layout and add &ldquo;Design-team polish&rdquo; (+$99) at checkout. Our designers
        hand-finish every spread before printing.
      </>
    ),
  },
  {
    q: 'How do I pay?',
    text: 'By card on Square’s secure checkout page. Nothing is charged until you complete payment there.',
    a: <>Payment is taken on Square&apos;s secure checkout page by card. Nothing is charged until you complete payment there.</>,
  },
  {
    q: 'Where’s my order?',
    text: 'You get an email with a tracking number when it ships. For anything else, email orders@folioforever.com with your order number.',
    a: (
      <>
        You&apos;ll get an email with a tracking number when it ships. Anything else? Email{' '}
        <a href="mailto:orders@folioforever.com">orders@folioforever.com</a> with your order number.
      </>
    ),
  },
  {
    q: 'What happens to my photos?',
    text: 'They are used only to make your order and kept for up to 12 months after delivery in case a reprint is needed, then deleted.',
    a: (
      <>
        They&apos;re used only to make your order and kept for up to 12 months after delivery in case a reprint is
        needed, then deleted. See our <Link href="/privacy">Privacy Policy</Link>.
      </>
    ),
  },
  {
    q: 'Do you have a sample kit?',
    text: 'A paper sample kit is coming soon. Contact us and we’ll let you know when it’s available.',
    a: (
      <>
        A paper sample kit is coming soon. <Link href="/contact">Contact us</Link> and we&apos;ll let you know as soon as
        it&apos;s available.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <LegalPage eyebrow="Help" title="Frequently asked questions">
      <JsonLd data={faqLd(FAQS.map((f) => ({ q: f.q, a: f.text })))} />
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'FAQ', path: '/faq' }])} />
      {FAQS.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
      <p style={{ marginTop: 28 }}>
        Still have a question? <Link href="/contact">Contact us</Link>.
      </p>
    </LegalPage>
  );
}
