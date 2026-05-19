/**
 * /admin/clients
 *
 * Lead list — every new client who registered + verified their email
 * at the designer gate. View, search, and CSV export.
 *
 * Server shell (auth gate) + a client island that fetches
 * /api/admin/clients.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthedFromCookieHeader } from '@/lib/admin-auth';
import { ClientsViewer } from './ClientsViewer';
import '../admin.css';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface Env {
  ADMIN_PASSWORD?: string;
}

export default async function AdminClientsPage() {
  const cookieHeader = (await cookies()).toString();
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthedFromCookieHeader(cookieHeader, env.ADMIN_PASSWORD))) {
    redirect('/admin');
  }

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">Folio &amp; Forever · clients</div>
          <h1>Registered clients</h1>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin" className="admin-logout">
            ← Dashboard
          </Link>
        </div>
      </header>

      <p
        style={{
          fontSize: 12,
          color: '#6b5e4d',
          maxWidth: 680,
          lineHeight: 1.6,
          margin: '0 0 18px',
        }}
      >
        Everyone who signed up and verified their email before using the album
        designer. Use the search to filter, or export the list to CSV for your
        CRM / mailing list.
      </p>

      <ClientsViewer />
    </div>
  );
}
