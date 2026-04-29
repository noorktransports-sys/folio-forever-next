/**
 * /pro/login — request a magic-link sign-in email.
 *
 * Server component just renders the layout; the form is client-side
 * because it needs to display "check your email" without a navigation.
 */

import Link from 'next/link';
import ProLoginForm from './pro-login-form';
import '../pro.css';

export const runtime = 'edge';

export default async function ProLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  let errorMsg = '';
  if (error === 'expired') errorMsg = 'That sign-in link expired. Request a new one.';
  else if (error === 'invalid') errorMsg = 'That sign-in link wasn’t valid.';
  else if (error === 'missing') errorMsg = 'Account not found. Sign in or create one.';

  return (
    <main className="pro-login-shell">
      <div className="pro-login-card">
        <div className="pro-tag">Folio &amp; Forever Pro</div>
        <h1>Sign in</h1>
        <p className="pro-login-desc">
          Enter your email and we&rsquo;ll send a one-time sign-in link.
          No password to remember.
        </p>
        {errorMsg ? <div className="pro-login-error">{errorMsg}</div> : null}
        <ProLoginForm />
        <p className="pro-login-foot">
          New photographer? <Link href="/pro/join">Apply for an account</Link>.
        </p>
      </div>
    </main>
  );
}
