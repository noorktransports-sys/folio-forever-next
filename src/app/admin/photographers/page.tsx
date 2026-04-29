/**
 * /admin/photographers — list of all photographer signups, grouped
 * by status. Pending photographers can be approved or rejected from
 * here; approved ones can be revoked.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthedFromCookieHeader } from '@/lib/admin-auth';
import PhotographerActions from './photographer-actions';
import '../admin.css';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}
interface IndexEntry {
  email: string;
  accountId: string;
  status: 'pending' | 'approved' | 'rejected';
  joinedAt: string;
  name: string;
  studioName: string;
}

export default async function AdminPhotographers() {
  const cookieHeader = (await headers()).get('cookie') || '';
  const { env } = getRequestContext() as { env: Env };
  const authed = await isAuthedFromCookieHeader(
    cookieHeader,
    env.ADMIN_PASSWORD,
  );
  if (!authed) {
    return (
      <main className="admin-shell">
        <p className="admin-empty">
          Not signed in. <Link href="/admin">Go to admin login</Link>.
        </p>
      </main>
    );
  }

  let entries: IndexEntry[] = [];
  try {
    if (env.DESIGN_DRAFTS) {
      const raw = await env.DESIGN_DRAFTS.get('_photographers_v1');
      if (raw) {
        const idx = JSON.parse(raw) as Record<string, IndexEntry>;
        entries = Object.values(idx).sort(
          (a, b) => +new Date(b.joinedAt) - +new Date(a.joinedAt),
        );
      }
    }
  } catch { /* ignore */ }

  const pending = entries.filter((e) => e.status === 'pending');
  const approved = entries.filter((e) => e.status === 'approved');
  const rejected = entries.filter((e) => e.status === 'rejected');

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">Folio &amp; Forever — admin</div>
          <h1>Photographers</h1>
        </div>
        <Link href="/admin" className="admin-logout">← Back to orders</Link>
      </header>

      {pending.length > 0 ? (
        <section style={{ marginBottom: 28 }}>
          <h2 className="admin-photos-heading">Pending approval ({pending.length})</h2>
          <div className="admin-orders">
            <table className="admin-table">
              <thead>
                <tr><th>Joined</th><th>Studio</th><th>Contact</th><th>Action</th></tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.accountId}>
                    <td><span className="admin-when">{new Date(p.joinedAt).toLocaleString()}</span></td>
                    <td><div className="admin-cust-name">{p.studioName}</div><div className="admin-cust-email">{p.name}</div></td>
                    <td><a className="admin-cust-email" href={`mailto:${p.email}`}>{p.email}</a></td>
                    <td><PhotographerActions accountId={p.accountId} status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: 28 }}>
        <h2 className="admin-photos-heading">Approved ({approved.length})</h2>
        {approved.length === 0 ? (
          <p className="admin-empty" style={{ margin: '12px 0', padding: 24 }}>
            No approved photographers yet.
          </p>
        ) : (
          <div className="admin-orders">
            <table className="admin-table">
              <thead>
                <tr><th>Joined</th><th>Studio</th><th>Contact</th><th>Action</th></tr>
              </thead>
              <tbody>
                {approved.map((p) => (
                  <tr key={p.accountId}>
                    <td><span className="admin-when">{new Date(p.joinedAt).toLocaleString()}</span></td>
                    <td><div className="admin-cust-name">{p.studioName}</div><div className="admin-cust-email">{p.name}</div></td>
                    <td><a className="admin-cust-email" href={`mailto:${p.email}`}>{p.email}</a></td>
                    <td><PhotographerActions accountId={p.accountId} status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rejected.length > 0 ? (
        <section>
          <h2 className="admin-photos-heading">Rejected ({rejected.length})</h2>
          <div className="admin-orders">
            <table className="admin-table">
              <thead>
                <tr><th>Joined</th><th>Studio</th><th>Contact</th><th>Action</th></tr>
              </thead>
              <tbody>
                {rejected.map((p) => (
                  <tr key={p.accountId}>
                    <td><span className="admin-when">{new Date(p.joinedAt).toLocaleString()}</span></td>
                    <td><div className="admin-cust-name">{p.studioName}</div><div className="admin-cust-email">{p.name}</div></td>
                    <td><span className="admin-cust-email">{p.email}</span></td>
                    <td><PhotographerActions accountId={p.accountId} status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {entries.length === 0 ? (
        <div className="admin-empty">
          <h2>No photographers yet</h2>
          <p>When pros sign up at <Link href="/pro/join">/pro/join</Link>, they show up here for approval.</p>
        </div>
      ) : null}
    </main>
  );
}
