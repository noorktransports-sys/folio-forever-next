/**
 * /admin/orders/[token] — single order detail.
 *
 * Shows: customer info, album metadata, link to /album/<token> for the
 * preview, and a grid of photo thumbnails with download links pointing
 * at the private /api/photo/<key> endpoint.
 *
 * Read-only for now. A future pass adds order status workflow
 * (in-progress / shipped / cancelled) and a "download all as zip"
 * server action.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthedFromCookieHeader } from '@/lib/admin-auth';
import StatusControl from './status-control';
import '../../admin.css';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}
interface SavedDesign {
  size?: string;
  totalSpreads?: number;
  uploadedPhotos?: Record<string, string>;
  cover?: { primaryText?: string; subtitleText?: string } | null;
  customer?: { name?: string; email?: string } | null;
  status?: string;
  orderId?: string;
  submittedAt?: string;
  savedAt?: string;
}

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
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
          Not signed in. <Link href="/admin">Go to login</Link>.
        </p>
      </main>
    );
  }

  const { token } = await params;
  if (!/^[a-f0-9]{8,64}$/i.test(token) || !env.DESIGN_DRAFTS) {
    return (
      <main className="admin-shell">
        <p className="admin-empty">Invalid token.</p>
      </main>
    );
  }
  const json = await env.DESIGN_DRAFTS.get(token);
  if (!json) {
    return (
      <main className="admin-shell">
        <p className="admin-empty">Order not found or expired.</p>
      </main>
    );
  }
  const design = JSON.parse(json) as SavedDesign;

  const photos = Object.entries(design.uploadedPhotos || {}).map(
    ([id, url]) => ({ id, url }),
  );
  const customer = design.customer || {};
  const cover = design.cover || {};

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">Folio &amp; Forever — order</div>
          <h1>{design.orderId || 'Order'}</h1>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin" className="admin-logout">
            ← All orders
          </Link>
        </div>
      </header>

      <section className="admin-order-meta">
        <div className="admin-meta-block">
          <div className="admin-meta-label">Customer</div>
          <div className="admin-meta-value">
            {customer.name || '(no name)'}
          </div>
          {customer.email ? (
            <a
              className="admin-meta-link"
              href={`mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(
                'Your album order ' + (design.orderId || ''),
              )}`}
            >
              {customer.email}
            </a>
          ) : (
            <div className="admin-meta-value muted">no email</div>
          )}
        </div>
        <div className="admin-meta-block">
          <div className="admin-meta-label">Album</div>
          <div className="admin-meta-value">
            {design.size || '—'} · {design.totalSpreads || 0} spread
            {design.totalSpreads === 1 ? '' : 's'}
          </div>
          <div className="admin-meta-value muted">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="admin-meta-block">
          <div className="admin-meta-label">Cover</div>
          <div className="admin-meta-value">
            {cover.primaryText || '(no title)'}
          </div>
          <div className="admin-meta-value muted">
            {cover.subtitleText || ''}
          </div>
        </div>
        <div className="admin-meta-block">
          <div className="admin-meta-label">Submitted</div>
          <div className="admin-meta-value">
            {design.submittedAt
              ? new Date(design.submittedAt).toLocaleString()
              : '—'}
          </div>
        </div>
        <div className="admin-meta-block">
          <StatusControl token={token} initial={design.status} />
        </div>
      </section>

      <section className="admin-order-actions">
        <Link
          href={`/album/${token}`}
          target="_blank"
          rel="noopener"
          className="admin-action-primary"
        >
          Open customer preview ↗
        </Link>
        {customer.email ? (
          <a
            href={`mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(
              'Your album order ' + (design.orderId || ''),
            )}`}
            className="admin-action-secondary"
          >
            Email customer
          </a>
        ) : null}
      </section>

      <section>
        <h2 className="admin-photos-heading">Photos ({photos.length})</h2>
        {photos.length === 0 ? (
          <p className="admin-empty muted">No photos in this order.</p>
        ) : (
          <div className="admin-photo-grid">
            {photos.map(({ id, url }) => (
              <a
                key={id}
                href={url}
                target="_blank"
                rel="noopener"
                download
                className="admin-photo-card"
                title="Click to open / right-click → Save image as"
              >
                <img src={url} alt="" loading="lazy" />
                <div className="admin-photo-id">{id}</div>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
