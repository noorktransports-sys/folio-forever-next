/**
 * /admin — orders dashboard.
 *
 * Stats: revenue (paid), counts by status, drafts, conversion hints.
 * Tabbed list: All / Pending payment / Paid / In design / In production /
 *              Shipped / Delivered / Cancelled / Refunded / Drafts.
 *
 * URL ?tab=<name> drives selection so it's bookmark-friendly.
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
  totalSpreads?: number;
  spreads?: number; // smart orders use this name
  photoCount: number;
  submittedAt: string;
  status?: string;
  paid?: boolean;
  amountPaid?: number;
  totalPrice?: number;
  paidAt?: string;
  refundedAt?: string;
  mode?: 'smart' | 'manual';
  albumName?: string;
  proofApprovedAt?: string | null;
  rightsAcceptedAt?: string | null;
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
    case 'pending_payment':
      return 'Pending payment';
    case 'paid':
      return 'Paid';
    case 'in_design':
      return 'In design';
    case 'in_production':
      return 'In production';
    case 'in_progress':
      return 'In progress';
    case 'shipped':
      return 'Shipped';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
    case 'submitted':
      return 'Submitted';
    default:
      return 'Pending';
  }
}

/** Recognised "active production" statuses — counted as in-progress for
 *  the dashboard headline number. */
const IN_PROGRESS_STATUSES = new Set(['submitted', 'in_progress', 'paid', 'in_design', 'in_production']);

function totalSpreadsOf(o: OrderEntry): number {
  return o.totalSpreads ?? o.spreads ?? 0;
}

function totalPriceOf(o: OrderEntry): number {
  return o.totalPrice ?? o.amountPaid ?? 0;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const cookieHeader = (await headers()).get('cookie') || '';
  const { env } = getRequestContext() as { env: Env };
  const authed = await isAuthedFromCookieHeader(cookieHeader, env.ADMIN_PASSWORD);
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

  // ── Stats ──
  const totalOrders = orders.length;
  const pendingPaymentCount = orders.filter((o) => o.status === 'pending_payment').length;
  const paidCount = orders.filter((o) => o.status === 'paid').length;
  const inDesignCount = orders.filter((o) => o.status === 'in_design').length;
  const inProductionCount = orders.filter((o) => o.status === 'in_production').length;
  const inProgressCount = orders.filter((o) => o.status === 'in_progress').length; // legacy
  const submittedCount = orders.filter((o) => o.status === 'submitted' || !o.status).length;
  const shippedCount = orders.filter((o) => o.status === 'shipped').length;
  const deliveredCount = orders.filter((o) => o.status === 'delivered').length;
  const cancelledCount = orders.filter((o) => o.status === 'cancelled').length;
  const refundedCount = orders.filter((o) => o.status === 'refunded').length;

  // Revenue = sum totalPrice for orders that ever reached 'paid'.
  // Refunded orders STILL show as revenue here (they're gross). The
  // refunds page tracks the offsetting subtractions.
  const paidLike = new Set(['paid', 'in_design', 'in_production', 'shipped', 'delivered', 'refunded']);
  const totalRevenue = orders
    .filter((o) => o.status && paidLike.has(o.status))
    .reduce((sum, o) => sum + totalPriceOf(o), 0);
  const refundedRevenue = orders
    .filter((o) => o.status === 'refunded')
    .reduce((sum, o) => sum + totalPriceOf(o), 0);
  const netRevenue = totalRevenue - refundedRevenue;

  // Today / this week revenue
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const revenueToday = orders
    .filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= startOfToday.getTime() && o.status !== 'refunded')
    .reduce((s, o) => s + totalPriceOf(o), 0);
  const revenueWeek = orders
    .filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= weekAgo && o.status !== 'refunded')
    .reduce((s, o) => s + totalPriceOf(o), 0);

  // Pending-payment orders older than 24h — likely abandoned
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const abandonedCount = orders.filter(
    (o) => o.status === 'pending_payment' && new Date(o.submittedAt).getTime() < dayAgo,
  ).length;

  const activeCount = orders.filter((o) => o.status && IN_PROGRESS_STATUSES.has(o.status)).length;

  // ── Tab filtering ──
  let visibleOrders: OrderEntry[] = orders;
  let showDrafts = false;
  if (tab === 'pending_payment') visibleOrders = orders.filter((o) => o.status === 'pending_payment');
  else if (tab === 'paid') visibleOrders = orders.filter((o) => o.status === 'paid');
  else if (tab === 'in_design') visibleOrders = orders.filter((o) => o.status === 'in_design');
  else if (tab === 'in_production') visibleOrders = orders.filter((o) => o.status === 'in_production');
  else if (tab === 'pending') visibleOrders = orders.filter((o) => !o.status || o.status === 'submitted');
  else if (tab === 'in_progress') visibleOrders = orders.filter((o) => o.status === 'in_progress');
  else if (tab === 'shipped') visibleOrders = orders.filter((o) => o.status === 'shipped');
  else if (tab === 'delivered') visibleOrders = orders.filter((o) => o.status === 'delivered');
  else if (tab === 'cancelled') visibleOrders = orders.filter((o) => o.status === 'cancelled');
  else if (tab === 'refunded') visibleOrders = orders.filter((o) => o.status === 'refunded');
  else if (tab === 'drafts') {
    visibleOrders = [];
    showDrafts = true;
  }

  // ── Recent activity feed: last 10 status-bearing events ──
  const activity = orders
    .map((o) => ({
      at: o.paidAt ?? o.refundedAt ?? o.submittedAt,
      kind: o.status === 'refunded' ? 'refund' : o.paidAt ? 'paid' : 'submitted',
      token: o.token,
      orderId: o.orderId,
      customerName: o.customerName,
      amount: totalPriceOf(o),
      status: o.status,
    }))
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, 10);

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">Folio &amp; Forever — admin</div>
          <h1>Orders dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/admin/clients" className="admin-logout">Clients</Link>
          <Link href="/admin/audit" className="admin-logout">Audit log</Link>
          <Link href="/admin/photographers" className="admin-logout">Photographers</Link>
          <form action="/api/admin/logout" method="post">
            <button type="submit" className="admin-logout">Sign out</button>
          </form>
        </div>
      </header>

      {/* ----- top-line revenue cards ----- */}
      <section className="admin-stats" style={{ marginBottom: 8 }}>
        <div className="admin-stat" style={{ background: '#fff8e9', borderColor: '#e0c98e' }}>
          <div className="admin-stat-label">Revenue · today</div>
          <div className="admin-stat-value">${revenueToday.toFixed(0)}</div>
        </div>
        <div className="admin-stat" style={{ background: '#fff8e9', borderColor: '#e0c98e' }}>
          <div className="admin-stat-label">Revenue · 7d</div>
          <div className="admin-stat-value">${revenueWeek.toFixed(0)}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Revenue · gross</div>
          <div className="admin-stat-value">${totalRevenue.toFixed(0)}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Revenue · net (post-refund)</div>
          <div className="admin-stat-value">${netRevenue.toFixed(0)}</div>
        </div>
      </section>

      {/* ----- order-status cards ----- */}
      <section className="admin-stats">
        <div className="admin-stat">
          <div className="admin-stat-label">All orders</div>
          <div className="admin-stat-value">{totalOrders}</div>
        </div>
        <div className="admin-stat admin-stat-pending">
          <div className="admin-stat-label">
            Pending payment
            {abandonedCount > 0 && <span className="admin-stat-soon" title={`${abandonedCount} older than 24h`}>{abandonedCount} stale</span>}
          </div>
          <div className="admin-stat-value">{pendingPaymentCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Active production</div>
          <div className="admin-stat-value">{activeCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Delivered</div>
          <div className="admin-stat-value">{deliveredCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Refunded</div>
          <div className="admin-stat-value">{refundedCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Drafts (leads)</div>
          <div className="admin-stat-value">{drafts.length}</div>
        </div>
      </section>

      {/* ----- recent activity ----- */}
      {activity.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontFamily: 'var(--font-display, "Cormorant Garamond", serif)', fontWeight: 400, fontSize: 18, margin: '0 0 8px', color: '#1a1410' }}>
            Recent activity
          </h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={`${a.token}-${a.at}`}>
                  <td className="admin-when">{a.at ? new Date(a.at).toLocaleString() : '—'}</td>
                  <td>
                    <span className={'admin-status admin-status-' + (a.kind === 'refund' ? 'cancelled' : a.kind === 'paid' ? 'shipped' : 'submitted')}>
                      {a.kind === 'refund' ? 'Refunded' : a.kind === 'paid' ? 'Paid' : 'Submitted'}
                    </span>
                  </td>
                  <td><span className="admin-orderid">{a.orderId}</span></td>
                  <td>{a.customerName || '—'}</td>
                  <td>${a.amount.toFixed(0)}</td>
                  <td>
                    <Link href={`/admin/orders/${a.token}`} className="admin-meta-link">View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ----- tabs ----- */}
      <nav className="admin-tabs">
        <Link href="/admin?tab=all" className={'admin-tab' + (tab === 'all' ? ' is-active' : '')}>
          All ({totalOrders})
        </Link>
        <Link href="/admin?tab=pending_payment" className={'admin-tab' + (tab === 'pending_payment' ? ' is-active' : '')}>
          Pending payment ({pendingPaymentCount})
        </Link>
        <Link href="/admin?tab=paid" className={'admin-tab' + (tab === 'paid' ? ' is-active' : '')}>
          Paid ({paidCount})
        </Link>
        <Link href="/admin?tab=in_design" className={'admin-tab' + (tab === 'in_design' ? ' is-active' : '')}>
          In design ({inDesignCount})
        </Link>
        <Link href="/admin?tab=in_production" className={'admin-tab' + (tab === 'in_production' ? ' is-active' : '')}>
          In production ({inProductionCount})
        </Link>
        <Link href="/admin?tab=shipped" className={'admin-tab' + (tab === 'shipped' ? ' is-active' : '')}>
          Shipped ({shippedCount})
        </Link>
        <Link href="/admin?tab=delivered" className={'admin-tab' + (tab === 'delivered' ? ' is-active' : '')}>
          Delivered ({deliveredCount})
        </Link>
        <Link href="/admin?tab=refunded" className={'admin-tab' + (tab === 'refunded' ? ' is-active' : '')}>
          Refunded ({refundedCount})
        </Link>
        <Link href="/admin?tab=cancelled" className={'admin-tab' + (tab === 'cancelled' ? ' is-active' : '')}>
          Cancelled ({cancelledCount})
        </Link>
        {(submittedCount > 0 || inProgressCount > 0) && (
          <Link href="/admin?tab=pending" className={'admin-tab' + (tab === 'pending' ? ' is-active' : '')}>
            Legacy ({submittedCount + inProgressCount})
          </Link>
        )}
        <Link href="/admin?tab=drafts" className={'admin-tab' + (tab === 'drafts' ? ' is-active' : '')}>
          Drafts / leads ({drafts.length})
        </Link>
      </nav>

      {/* ----- table ----- */}
      {showDrafts ? (
        drafts.length === 0 ? (
          <div className="admin-empty">
            <h2>No draft saves yet</h2>
            <p>Designs that customers saved but didn&apos;t submit show up here. Useful for follow-up emails.</p>
          </div>
        ) : (
          <div className="admin-orders">
            <div className="admin-orders-meta">
              {drafts.length} draft{drafts.length === 1 ? '' : 's'} — customers who designed but haven&rsquo;t submitted
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
                    <td><span className="admin-when">{new Date(d.savedAt).toLocaleString()}</span></td>
                    <td>
                      <div className="admin-cust-name">{d.customerName || '(no name)'}</div>
                      <a className="admin-cust-email" href={`mailto:${encodeURIComponent(d.customerEmail)}`}>
                        {d.customerEmail || '—'}
                      </a>
                    </td>
                    <td>{d.size || '—'} · {d.totalSpreads} spread{d.totalSpreads === 1 ? '' : 's'}</td>
                    <td>{d.photoCount}</td>
                    <td>
                      <Link href={`/album/${d.token}`} target="_blank" rel="noopener" className="admin-open-btn">
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
          <p>No orders match this filter. Submitted albums show up here as soon as a customer clicks Submit.</p>
        </div>
      ) : (
        <div className="admin-orders">
          <div className="admin-orders-meta">{visibleOrders.length} order{visibleOrders.length === 1 ? '' : 's'}</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Album</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => (
                <tr key={o.token}>
                  <td><span className="admin-when">{new Date(o.submittedAt).toLocaleString()}</span></td>
                  <td><span className="admin-orderid">{o.orderId}</span></td>
                  <td>
                    <div className="admin-cust-name">{o.customerName || '(no name)'}</div>
                    <a className="admin-cust-email" href={`mailto:${encodeURIComponent(o.customerEmail)}`}>
                      {o.customerEmail || '—'}
                    </a>
                  </td>
                  <td>{o.size || '—'} · {totalSpreadsOf(o)} sp · {o.photoCount} ph</td>
                  <td>
                    <span className={'admin-status admin-status-' + (o.status || 'submitted')}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td>
                    {totalPriceOf(o) > 0 ? (
                      <span className={o.status === 'refunded' ? 'admin-paid-no' : 'admin-paid-yes'}>
                        ${totalPriceOf(o).toFixed(0)}
                      </span>
                    ) : (
                      <span className="admin-paid-no">—</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/admin/orders/${o.token}`} className="admin-open-btn">View →</Link>
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
