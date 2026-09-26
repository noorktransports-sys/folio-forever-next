import Link from 'next/link';
import './site-footer.css';

/**
 * Site-wide footer: navigation + every policy page. Used on the home,
 * photographers and policy pages so customers can always find the
 * Terms, Privacy, Refund and Shipping policies.
 */
export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <div className="site-footer-logo">FOLIO FOREVER</div>
          <p className="site-footer-tag">Heirloom wedding albums &amp; magazines</p>
          <a className="site-footer-mail" href="mailto:orders@folioforever.com">
            orders@folioforever.com
          </a>
        </div>
        <div role="navigation" className="site-footer-cols" aria-label="Footer">
          <div>
            <p className="site-footer-h">Create</p>
            <ul>
              <li><Link href="/wedding-albums">Wedding albums</Link></li>
              <li><Link href="/wedding-magazine">Wedding magazines</Link></li>
              <li><Link href="/design/smart">Design an album</Link></li>
              <li><Link href="/photographers">Photographers</Link></li>
            </ul>
          </div>
          <div>
            <p className="site-footer-h">Help</p>
            <ul>
              <li><Link href="/faq">FAQ</Link></li>
              <li><Link href="/shipping">Shipping &amp; delivery</Link></li>
              <li><Link href="/contact">Contact us</Link></li>
            </ul>
          </div>
          <div>
            <p className="site-footer-h">Policies</p>
            <ul>
              <li><Link href="/terms">Terms of Service</Link></li>
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><Link href="/refunds">Refunds &amp; Cancellations</Link></li>
            </ul>
          </div>
        </div>
      </div>
      <p className="site-footer-copy">© {year} Folio Forever · Florida, USA · Secure payments by Square</p>
    </footer>
  );
}
