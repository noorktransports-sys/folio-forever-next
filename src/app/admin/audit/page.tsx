/**
 * /admin/audit
 *
 * Legal audit log viewer. Shows three tabs:
 *   • Proof approvals (clause 2.3)
 *   • Content rights  (clauses 2.2 + 2.4)
 *   • Refunds         (Square refunds we issued)
 *
 * Server component shell + a client island that fetches /api/admin/audit
 * on tab switch + handles cursor pagination.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthedFromCookieHeader } from '@/lib/admin-auth';
import { AuditViewer } from './AuditViewer';
import '../admin.css';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface Env {
  ADMIN_PASSWORD?: string;
}

export default async function AdminAuditPage() {
  const cookieHeader = (await cookies()).toString();
  const { env } = getRequestContext() as { env: Env };
  if (!(await isAuthedFromCookieHeader(cookieHeader, env.ADMIN_PASSWORD))) {
    // Login is rendered inline at /admin (no separate /admin/login route).
    redirect('/admin');
  }

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">Folio &amp; Forever · audit log</div>
          <h1>Legal audit</h1>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin" className="admin-logout">← Dashboard</Link>
        </div>
      </header>

      <p style={{ fontSize: 12, color: '#6b5e4d', maxWidth: 680, lineHeight: 1.6, margin: '0 0 18px' }}>
        Each record is a customer&apos;s timestamped acceptance of the exact clause text shown to them.
        IP and User-Agent are captured server-side. Records are retained for 365 days (TTL on KV).
      </p>

      <AuditViewer />
    </div>
  );
}
