import SiteHeader from './SiteHeader';
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
      <SiteHeader />
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
