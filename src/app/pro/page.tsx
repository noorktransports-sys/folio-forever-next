/**
 * /pro — photographer dashboard.
 *
 * If signed in: list of all albums tied to this photographer's account
 * (drafts + submitted, with status, customer name, dates).
 * If not signed in: redirect message → /pro/login.
 *
 * Edge runtime, KV reads server-side, populated on first paint.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { readProSessionFromCookieHeader } from '@/lib/photographer-auth';
import './pro.css';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

interface PhotographerRecord {
  email: string;
  name: string;
  studioName: string;
  phone: string;
  status: string;
  joinedAt: string;
}

interface AlbumIndexEntry {
  token: string;
  orderId?: string;
  customerName: string;
  customerEmail: string;
  size: string;
  totalSpreads: number;
  photoCount: number;
  status: 'draft' | 'submitted' | 'in_progress' | 'shipped' | 'delivered' | 'cancelled' | string;
  savedAt: string;
  submittedAt?: string;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'in_progress':
      return 'In progress';
    case 'shipped':
      return 'Shipped';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    case 'submitted':
      return 'Submitted';
    default:
      return 'Draft';
  }
}

export default async function ProDashboard() {
  const cookieHeader = (await headers()).get('cookie') || '';
  const { env } = getRequestContext() as { env: Env };
  const accountId = await readProSessionFromCookieHeader(
    cookieHeader,
    env.ADMIN_PASSWORD,
  );

  if (!accountId) {
    redirect('/pro/login');
  }
  if (!env.DESIGN_DRAFTS) {
    return (
      <main className="pro-shell">
        <p className="pro-empty">Storage unavailable.</p>
      </main>
    );
  }

  // Load profile + album index.
  const recordRaw = await env.DESIGN_DRAFTS.get(`_photographer_${accountId}`);
  if (!recordRaw) {
    redirect('/pro/login?error=missing');
  }
  const record = JSON.parse(recordRaw!) as PhotographerRecord;

  const albumsRaw = await env.DESIGN_DRAFTS.get(
    `_photographer_${accountId}_albums_v1`,
  );
  const albums: AlbumIndexEntry[] = albumsRaw ? JSON.parse(albumsRaw) : [];

  const submitted = albums.filter((a) => a.status && a.status !== 'draft');
  const drafts = albums.filter((a) => !a.status || a.status === 'draft');

  return (
    <main className="pro-shell">
      <header className="pro-top">
        <div>
          <div className="pro-tag">Folio &amp; Forever Pro</div>
          <h1>{record.studioName}</h1>
          <div className="pro-sub">
            Signed in as {record.name} · {record.email}
          </div>
        </div>
        <div className="pro-top-actions">
          <Link href="/design" className="pro-action-primary">
            + New album
          </Link>
          <form action="/api/pro/logout" method="post">
            <button type="submit" className="pro-action-secondary">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="pro-stats">
        <div className="pro-stat">
          <div className="pro-stat-label">Total albums</div>
          <div className="pro-stat-value">{albums.length}</div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label">Submitted</div>
          <div className="pro-stat-value">{submitted.length}</div>
        </div>
        <div className="pro-stat">
          <div className="pro-stat-label">Drafts</div>
          <div className="pro-stat-value">{drafts.length}</div>
        </div>
      </section>

      {albums.length === 0 ? (
        <div className="pro-empty">
          <h2>No albums yet</h2>
          <p>
            Click <strong>+ New album</strong> to design your first album.
            Each album you build is tied to your account so you can come
            back any time.
          </p>
        </div>
      ) : (
        <>
          <h2 className="pro-section-heading">Your albums</h2>
          <div className="pro-orders">
            <table className="pro-table">
              <thead>
                <tr>
                  <th>Saved</th>
                  <th>Customer</th>
                  <th>Album</th>
                  <th>Status</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {albums.map((a) => (
                  <tr key={a.token}>
                    <td>
                      <span className="pro-when">
                        {new Date(a.submittedAt || a.savedAt).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <div className="pro-cust-name">
                        {a.customerName || '(no name)'}
                      </div>
                      {a.customerEmail ? (
                        <div className="pro-cust-email">{a.customerEmail}</div>
                      ) : null}
                    </td>
                    <td>
                      {a.size || '—'} · {a.totalSpreads} sp · {a.photoCount} ph
                    </td>
                    <td>
                      <span
                        className={
                          'pro-status pro-status-' + (a.status || 'draft')
                        }
                      >
                        {statusLabel(a.status || 'draft')}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={`/album/${a.token}`}
                        className="pro-open-btn"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
