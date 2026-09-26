import Link from 'next/link';
import SiteFooter from './SiteFooter';
import './legal-page.css';

/**
 * Shared shell for policy / help pages (Terms, Privacy, Refunds, Shipping,
 * FAQ, Contact): simple header, readable column, site footer.
 */
export default function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="legal-top">
        <Link href="/" className="legal-logo">FOLIO FOREVER</Link>
        <div role="navigation" className="legal-nav" aria-label="Main">
          <Link href="/design/smart">Albums</Link>
          <Link href="/design/magazine">Magazine</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </header>
      <main className="legal-main">
        <p className="legal-eyebrow">{eyebrow}</p>
        <h1 className="legal-title">{title}</h1>
        {updated && <p className="legal-updated">Last updated: {updated}</p>}
        <div className="legal-body">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
