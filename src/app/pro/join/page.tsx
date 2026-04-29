/**
 * /pro/join — photographer signup form. Submits to /api/pro/signup
 * which creates a pending record + emails Jayvee for approval.
 */

import Link from 'next/link';
import ProSignupForm from './pro-signup-form';
import '../pro.css';

export const runtime = 'edge';

export default function ProJoin() {
  return (
    <main className="pro-login-shell">
      <div className="pro-login-card pro-join-card">
        <div className="pro-tag">Folio &amp; Forever Pro</div>
        <h1>Apply for a photographer account</h1>
        <p className="pro-login-desc">
          Submit your studio details and we&rsquo;ll review your
          application within 1 business day. Once approved you&rsquo;ll
          get a sign-in email and can start designing albums for your
          clients at wholesale pricing.
        </p>
        <ProSignupForm />
        <p className="pro-login-foot">
          Already have an account? <Link href="/pro/login">Sign in</Link>.
        </p>
      </div>
    </main>
  );
}
