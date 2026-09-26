import Link from 'next/link';
import './legal-page.css';

/** Simple site header used by the policy, help and product pages. */
export default function SiteHeader() {
  return (
    <header className="legal-top">
      <Link href="/" className="legal-logo">FOLIO FOREVER</Link>
      <div role="navigation" className="legal-nav" aria-label="Main">
        <Link href="/wedding-albums">Albums</Link>
        <Link href="/wedding-magazine">Magazine</Link>
        <Link href="/faq">FAQ</Link>
        <Link href="/contact">Contact</Link>
      </div>
    </header>
  );
}
