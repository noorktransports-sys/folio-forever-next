/**
 * /admin — orders dashboard.
 *
 * Stats first (paid count + revenue placeholders ready for Stripe,
 * plus what we can already track today: submitted, pending production,
 * delivered, drafts).
 *
 * Below stats: tabbed list — All / Pending / In progress / Delivered /
 * Drafts. URL ?tab=<name> drives selection so it's bookmark-friendly.
 *
 * Edge runtime, KV reads server-side, populated on first paint.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthedFromCookieHeader } from '@/lib/admin-auth';
import './admin.css';
import AdminLogin from './admin-login';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}
interface OrderEntry {
  token: string;
  orderId: string;
  customerName: string;
  customerEmail: string;
  size: string;
  totalSpreads: number;
  photoCount: number;
  submittedAt: string;
  status?: string;
  paid?: boolean;
  amountPaid?: number;
}
interface DraftEntry {
  token: string;
  customerName: string;
  customerEmail: string;
  size: string;
  totalSpreads: number;
  photoCount: number;
  savedAt: string;
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'in_progress':
      return 'In progress';
    case 'shipped':
      return 'Shipped';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const cookieHeader = (await headers()).get('cookie') || '';
  const { env } = getRequestContext() as { env: Env };
  const authed = await isAuthedFromCookieHeader(
    cookieHeader,
    env.ADMIN_PASSWORD,
  );
  if (!authed) return <AdminLogin />;

  const { tab: tabParam } = await searchParams;
  const tab = tabParam || 'all';

  let orders: OrderEntry[] = [];
  let drafts: DraftEntry[] = [];
  try {
    if (env.DESIGN_DRAFTS) {
      const oj = await env.DESIGN_DRAFTS.get('_orders_index_v1');
      if (oj) orders = JSON.parse(oj);
      const dj = await env.DESIGN_DRAFTS.get('_drafts_index_v1');
      if (dj) drafts = JSON.parse(dj);
    }
  } catch {
    /* ignore — show empty state */
  }

  // Stats
  const totalOrders = orders.length;
  const pendingCount = orders.filter(
    (o) => !o.status || o.status === 'submitted',
  ).length;
  const inProgressCount = orders.filter((o) => o.status === 'in_progress').length;
  const shippedCount = orders.filter((o) => o.status === 'shipped').length;
  const deliveredCount = orders.filter((o) => o.status === 'delivered').length;
  const cancelledCount = orders.filter((o) => o.status === 'cancelled').length;
  const paidCount = orders.filter((o) => o.paid).length;
  const totalRevenue = orders.reduce(
    (sum, o) => sum + (o.amountPaid || 0),
    0,
  );

  // Tab filtering
  let visibleOrders: OrderEntry[] = orders;
  let showDrafts = false;
  if (tab === 'pending')
    visibleOrders = orders.filter(
      (o) => !o.status || o.status === 'submitted',
    );
  else if (tab === 'in_progress')
    visibleOrders = orders.filter((o) => o.status === 'in_progress');
  else if (tab === 'shipped')
    visibleOrders = orders.filter((o) => o.status === 'shipped');
  else if (tab === 'delivered')
    visibleOrders = orders.filter((o) => o.status === 'delivered');
  else if (tab === 'cancelled')
    visibleOrders = orders.filter((o) => o.status === 'cancelled');
  else if (tab === 'drafts') {
    visibleOrders = [];
    showDrafts = true;
  }

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">Folio &amp; Forever — admin</div>
          <h1>Orders dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/admin/photographers" className="admin-logout">
            Photographers
          </Link>
          <form action="/api/admin/logout" method="post">
            <button type="submit" className="admin-logout">Sign out</button>
          </form>
        </div>
      </header>

      {/* ----- stat cards ----- */}
      <section className="admin-stats">
        <div className="admin-stat">
          <div className="admin-stat-label">Total orders</div>
          <div className="admin-stat-value">{totalOrders}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Pending</div>
          <div className="admin-stat-value">{pendingCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">In progress</div>
          <div className="admin-stat-value">{inProgressCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Delivered</div>
          <div className="admin-stat-value">{deliveredCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Drafts (leads)</div>
          <div className="admin-stat-value">{drafts.length}</div>
        </div>
        <div className="admin-stat admin-stat-pending">
          <div className="admin-stat-label">
            Paid <span className="admin-stat-soon">Stripe pending</span>
          </div>
          <div className="admin-stat-value">{paidCount}</div>
        </div>
        <div className="admin-stat admin-stat-pending">
          <div className="admin-stat-label">
            Revenue <span className="admin-stat-soon">Stripe pending</span>
          </div>
          <div className="admin-stat-value">
            ${totalRevenue.toFixed(0)}
          </div>
        </div>
      </section>

      {/* ----- tabs ----- */}
      <nav className="admin-tabs">
        <Link
          href="/admin?tab=all"
          className={'admin-tab' + (tab === 'all' ? ' is-active' : '')}
        >
          All ({totalOrders})
        </Link>
        <Link
          href="/admin?tab=pending"
          className={'admin-tab' + (tab === 'pending' ? ' is-active' : '')}
        >
          Pending ({pendingCount})
        </Link>
        <Link
          href="/admin?tab=in_progress"
          className={
            'admin-tab' + (tab === 'in_progress' ? ' is-active' : '')
          }
        >
          In progress ({inProgressCount})
        </Link>
        <Link
          href="/admin?tab=shipped"
          className={'admin-tab' + (tab === 'shipped' ? ' is-active' : '')}
        >
          Shipped ({shippedCount})
        </Link>
        <Link
          href="/admin?tab=delivered"
          className={'admin-tab' + (tab === 'delivered' ? ' is-active' : '')}
        >
          Delivered ({deliveredCount})
        </Link>
        <Link
          href="/admin?tab=cancelled"
          className={
            'admin-tab' + (tab === 'cancelled' ? ' is-active' : '')
          }
        >
          Cancelled ({cancelledCount})
        </Link>
        <Link
          href="/admin?tab=drafts"
          className={'admin-tab' + (tab === 'drafts' ? ' is-active' : '')}
        >
          Drafts / leads ({drafts.length})
        </Link>
      </nav>

      {/* ----- table ----- */}
      {showDrafts ? (
        drafts.length === 0 ? (
          <div className="admin-empty">
            <h2>No draft saves yet</h2>
            <p>
              Designs that customers saved but didn&apos;t submit show up
              here. Useful for follow-up emails.
            </p>
          </div>
        ) : (
          <div className="admin-orders">
            <div className="admin-orders-meta">
              {drafts.length} draft{drafts.length === 1 ? '' : 's'} —
              customers who designed but haven&rsquo;t submitted
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Saved</th>
                  <th>Customer</th>
                  <th>Album</th>
                  <th>Photos</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.token}>
                    <td>
                      <span className="admin-when">
                        {new Date(d.savedAt).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <div className="admin-cust-name">
                        {d.customerName || '(no name)'}
                      </div>
                      <a
                        className="admin-cust-email"
                        href={`mailto:${encodeURIComponent(d.customerEmail)}`}
                      >
                        {d.customerEmail || '—'}
                      </a>
                    </td>
                    <td>
                      {d.size || '—'} · {d.totalSpreads} spread
                      {d.totalSpreads === 1 ? '' : 's'}
                    </td>
                    <td>{d.photoCount}</td>
                    <td>
                      <Link
                        href={`/album/${d.token}`}
                        target="_blank"
                        rel="noopener"
                        className="admin-open-btn"
                      >
                        Preview ↗
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : visibleOrders.length === 0 ? (
        <div className="admin-empty">
          <h2>Nothing here yet</h2>
          <p>
            No orders match this filter. Submitted albums show up here as
            soon as a customer clicks Submit.
          </p>
        </div>
      ) : (
        <div className="admin-orders">
          <div className="admin-orders-meta">
            {visibleOrders.length} order{visibleOrders.length === 1 ? '' : 's'}
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Album</th>
                <th>Status</th>
                <th>Paid</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => (
                <tr key={o.token}>
                  <td>
                    <span className="admin-when">
                      {new Date(o.submittedAt).toLocaleString()}
                    </span>
                  </td>
                  <td>
                    <span className="admin-orderid">{o.orderId}</span>
                  </td>
                  <td>
                    <div className="admin-cust-name">
                      {o.customerName || '(no name)'}
                    </div>
                    <a
                      className="admin-cust-email"
                      href={`mailto:${encodeURIComponent(o.customerEmail)}`}
                    >
                      {o.customerEmail || '—'}
                    </a>
                  </td>
                  <td>
                    {o.size || '—'} · {o.totalSpreads} sp · {o.photoCount} ph
                  </td>
                  <td>
                    <span
                      className={'admin-status admin-status-' + (o.status || 'submitted')}
                    >
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td>
                    {o.paid ? (
                      <span className="admin-paid-yes">
                        ${(o.amountPaid || 0).toFixed(0)}
                      </span>
                    ) : (
                      <span className="admin-paid-no">Unpaid</span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/admin/orders/${o.token}`}
                      className="admin-open-btn"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
