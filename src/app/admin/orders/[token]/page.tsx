/**
 * /admin/orders/[token] — single order detail.
 *
 * Handles BOTH order shapes that share the DESIGN_DRAFTS KV namespace:
 *   • smart  — keyed `photos: SmartPhotoUpload[]`, payment via Square,
 *     legal audit attached, status history populated
 *   • manual — keyed `uploadedPhotos: Record<id,url>`, older order shape,
 *     status enum is a subset
 *
 * The page detects which shape it has by sniffing the first photo-bearing
 * field present. Most blocks are conditional on shape.
 *
 * Includes:
 *   • Customer / shipping / album cards
 *   • Payment card (Square IDs, receipt link, paid timestamp)
 *   • Status control + status history timeline
 *   • Composite preview gallery (smart orders only)
 *   • Photo grid + bulk-action helpers (copy URLs, open in tabs)
 *   • Legal audit summary (proof + content rights records)
 *   • Refunds list
 *   • Refund modal + resend-email button (in OrderActions client island)
 *   • Internal admin notes
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { isAuthedFromCookieHeader } from '@/lib/admin-auth';
import StatusControl from './status-control';
import DownloadAll from './download-all';
import AdminNotes from './admin-notes';
import OrderActions from './OrderActions';
import '../../admin.css';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

interface SmartPhoto {
  photoId: string;
  originalKey?: string;
  originalUrl?: string;
  previewKey?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  tagged?: string;
  eventId?: string;
}

interface SpreadComposite {
  spreadId: string;
  key?: string;
  url?: string;
}

interface StatusHistoryEntry {
  status: string;
  at: string;
  by: string;
  note?: string;
}

interface RefundEntry {
  refundId: string;
  amountCents: number;
  reason?: string;
  at: string;
  squareStatus?: string;
}

interface ShippingBlock {
  recipientName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
}

interface SavedDesign {
  // Common
  status?: string;
  orderId?: string;
  submittedAt?: string;
  savedAt?: string;
  mode?: 'smart' | 'manual';
  customer?: { name?: string; email?: string } | null;
  shipping?: ShippingBlock | null;
  adminNotes?: string;
  statusHistory?: StatusHistoryEntry[];

  // Manual shape
  size?: string;
  totalSpreads?: number;
  uploadedPhotos?: Record<string, string>;
  cover?: { primaryText?: string; subtitleText?: string } | null;

  // Smart shape
  albumName?: string;
  album?: {
    size?: string;
    type?: string;
    pageCount?: number;
    totalPrice?: number;
  };
  polishHandoff?: boolean;
  photos?: SmartPhoto[];
  spreadComposites?: SpreadComposite[];
  proofApproval?: { acceptedAt?: string; clauseVersion?: string; reviewedSpreadIds?: string[] };
  contentRights?: { acceptedAt?: string; clauseVersion?: string };
  lowResPhotos?: Array<{ id: string; width: number; height: number }>;
  auditClientIp?: string | null;
  auditUserAgent?: string | null;

  // Square (smart)
  squarePaymentLinkId?: string;
  squareOrderId?: string;
  squareCheckoutUrl?: string;
  squareCheckoutCreatedAt?: string;
  squarePaymentId?: string;
  squareReceiptUrl?: string;
  squareAmountTotalCents?: number;
  paidAt?: string;

  // Refunds (smart)
  refunds?: RefundEntry[];
  lastRefundAt?: string;
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'pending_payment': return 'Pending payment';
    case 'paid': return 'Paid';
    case 'in_design': return 'In design';
    case 'in_production': return 'In production';
    case 'shipped': return 'Shipped';
    case 'delivered': return 'Delivered';
    case 'cancelled': return 'Cancelled';
    case 'refunded': return 'Refunded';
    case 'submitted': return 'Submitted';
    case 'in_progress': return 'In progress';
    default: return 'Pending';
  }
}

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const cookieHeader = (await headers()).get('cookie') || '';
  const { env } = getRequestContext() as { env: Env };
  const authed = await isAuthedFromCookieHeader(cookieHeader, env.ADMIN_PASSWORD);
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

  // Detect order shape
  const isSmart = design.mode === 'smart' || Array.isArray(design.photos);

  // Photos (normalized to { id, url })
  const photos: Array<{ id: string; url: string; previewUrl?: string; width?: number; height?: number; tagged?: string }> = isSmart
    ? (design.photos ?? []).map((p) => ({
        id: p.photoId,
        url: p.originalUrl ?? '',
        previewUrl: p.previewUrl,
        width: p.width,
        height: p.height,
        tagged: p.tagged,
      }))
    : Object.entries(design.uploadedPhotos ?? {}).map(([id, url]) => ({ id, url }));

  const customer = design.customer || {};
  const cover = design.cover || {};
  const albumSize = design.album?.size ?? design.size ?? '—';
  const albumBinding = design.album?.type;
  const spreadCount = design.album?.pageCount ?? design.totalSpreads ?? 0;
  const totalPrice = design.album?.totalPrice ?? 0;
  const isPaidLike = !!design.paidAt && design.status !== 'pending_payment' && design.status !== 'cancelled';
  const refunds = design.refunds ?? [];
  const refundedTotalCents = refunds.reduce((s, r) => s + (r.amountCents || 0), 0);

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div>
          <div className="admin-tag">
            Folio &amp; Forever — {isSmart ? 'smart order' : 'manual order'}
          </div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {design.orderId || 'Order'}
            <span className={'admin-status admin-status-' + (design.status || 'submitted')}>
              {statusLabel(design.status)}
            </span>
          </h1>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin" className="admin-logout">← All orders</Link>
        </div>
      </header>

      {/* ── Top meta grid ── */}
      <section className="admin-order-meta">
        <div className="admin-meta-block">
          <div className="admin-meta-label">Customer</div>
          <div className="admin-meta-value">{customer.name || '(no name)'}</div>
          {customer.email ? (
            <a className="admin-meta-link" href={`mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent('Your album order ' + (design.orderId || ''))}`}>
              {customer.email}
            </a>
          ) : (
            <div className="admin-meta-value muted">no email</div>
          )}
        </div>

        <div className="admin-meta-block">
          <div className="admin-meta-label">Album</div>
          <div className="admin-meta-value">
            {design.albumName ? <strong>{design.albumName}</strong> : ''}
            {design.albumName && <br />}
            {albumSize}
            {albumBinding ? ` · ${albumBinding === 'standard' ? 'Standard' : 'Layflat'}` : ''}
            {' · '}{spreadCount} spread{spreadCount === 1 ? '' : 's'}
          </div>
          <div className="admin-meta-value muted">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {design.polishHandoff ? ' · polish +$99' : ''}
          </div>
        </div>

        {!isSmart && (
          <div className="admin-meta-block">
            <div className="admin-meta-label">Cover</div>
            <div className="admin-meta-value">{cover.primaryText || '(no title)'}</div>
            <div className="admin-meta-value muted">{cover.subtitleText || ''}</div>
          </div>
        )}

        <div className="admin-meta-block">
          <div className="admin-meta-label">Submitted</div>
          <div className="admin-meta-value">
            {design.submittedAt ? new Date(design.submittedAt).toLocaleString() : '—'}
          </div>
          {design.paidAt && (
            <>
              <div className="admin-meta-label" style={{ marginTop: 8 }}>Paid</div>
              <div className="admin-meta-value">{new Date(design.paidAt).toLocaleString()}</div>
            </>
          )}
        </div>

        <div className="admin-meta-block">
          <div className="admin-meta-label">Status</div>
          <StatusControl token={token} initial={design.status} />
        </div>
      </section>

      {/* ── Payment card (smart orders) ── */}
      {isSmart && (
        <section className="admin-meta-block" style={{ marginBottom: 22 }}>
          <div className="admin-meta-label">Payment (Square)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 6 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase' }}>Order total</div>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-display, "Cormorant Garamond", serif)' }}>
                ${totalPrice}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase' }}>Status</div>
              <div style={{ fontSize: 13 }}>
                {isPaidLike ? (
                  <span className="admin-paid-yes">Paid · ${(design.squareAmountTotalCents ?? totalPrice * 100) / 100}</span>
                ) : design.status === 'pending_payment' ? (
                  <span className="admin-paid-no">Awaiting payment</span>
                ) : (
                  <span className="admin-paid-no">{statusLabel(design.status)}</span>
                )}
              </div>
            </div>
            {refunds.length > 0 && (
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase' }}>Refunded</div>
                <div style={{ fontSize: 13, color: '#7a2828' }}>
                  ${(refundedTotalCents / 100).toFixed(2)} ({refunds.length} refund{refunds.length === 1 ? '' : 's'})
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase' }}>Receipt</div>
              {design.squareReceiptUrl ? (
                <a className="admin-meta-link" href={design.squareReceiptUrl} target="_blank" rel="noopener">
                  Open Square receipt ↗
                </a>
              ) : design.squareCheckoutUrl && !isPaidLike ? (
                <a className="admin-meta-link" href={design.squareCheckoutUrl} target="_blank" rel="noopener">
                  Re-send checkout link ↗
                </a>
              ) : (
                <div className="admin-meta-value muted">—</div>
              )}
            </div>
            {design.squarePaymentId && (
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase' }}>Square payment ID</div>
                <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                  {design.squarePaymentId}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Shipping ── */}
      {design.shipping ? (
        <section className="admin-shipping">
          <div className="admin-meta-label">Ship to</div>
          <div className="admin-ship-address">
            <div><strong>{design.shipping.recipientName}</strong></div>
            <div>{design.shipping.line1}</div>
            {design.shipping.line2 && <div>{design.shipping.line2}</div>}
            <div>
              {design.shipping.city}, {design.shipping.region} {design.shipping.postalCode}
            </div>
            <div>{design.shipping.country}</div>
            {design.shipping.phone && (
              <div className="admin-ship-phone">
                <a href={`tel:${design.shipping.phone}`}>{design.shipping.phone}</a>
              </div>
            )}
            {design.shipping.notes && (
              <div className="admin-ship-notes">Notes: {design.shipping.notes}</div>
            )}
          </div>
        </section>
      ) : null}

      {/* ── Actions ── */}
      <section className="admin-order-actions">
        <DownloadAll orderId={design.orderId || token} photos={photos.map((p) => ({ id: p.id, url: p.url }))} />
        <Link href={`/album/${token}`} target="_blank" rel="noopener" className="admin-action-secondary">
          Open customer preview ↗
        </Link>
        {customer.email && (
          <a
            href={`mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent('Your album order ' + (design.orderId || ''))}`}
            className="admin-action-secondary"
          >
            Email customer
          </a>
        )}
        <OrderActions
          token={token}
          orderId={design.orderId || token}
          isSmart={isSmart}
          canRefund={isSmart && !!design.squarePaymentId && isPaidLike && design.status !== 'refunded'}
          canResend={isSmart && isPaidLike}
          maxRefundCents={design.squareAmountTotalCents ?? totalPrice * 100}
          photoUrls={photos.map((p) => p.url).filter(Boolean)}
        />
      </section>

      <AdminNotes token={token} initial={design.adminNotes} />

      {/* ── Composites (smart) ── */}
      {isSmart && (design.spreadComposites?.length ?? 0) > 0 && (
        <section style={{ marginBottom: 26 }}>
          <h2 className="admin-photos-heading">Spread composites ({design.spreadComposites!.length})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {design.spreadComposites!.map((c, i) =>
              c.url ? (
                <a key={c.spreadId} href={c.url} target="_blank" rel="noopener" className="admin-photo-card">
                  <img src={c.url} alt={`Spread ${i + 1}`} loading="lazy" style={{ aspectRatio: 'auto', height: 'auto' }} />
                  <div className="admin-photo-id">Spread {i + 1}</div>
                </a>
              ) : null,
            )}
          </div>
        </section>
      )}

      {/* ── Photos ── */}
      <section>
        <h2 className="admin-photos-heading">Photos ({photos.length})</h2>
        {photos.length === 0 ? (
          <p className="admin-empty muted">No photos in this order.</p>
        ) : (
          <div className="admin-photo-grid">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener" download className="admin-photo-card" title="Click to open / right-click → Save image as">
                {p.url ? <img src={p.url} alt="" loading="lazy" /> : <div style={{ aspectRatio: '1', background: '#f5efdf' }} />}
                <div className="admin-photo-id">
                  {p.id}
                  {p.width && p.height && (
                    <span style={{ color: '#6b5e4d', marginLeft: 6 }}>{p.width}×{p.height}</span>
                  )}
                  {p.tagged && p.tagged !== 'none' && (
                    <span style={{ color: '#b8965a', marginLeft: 6, textTransform: 'uppercase' }}> · {p.tagged}</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* ── Legal audit summary (smart) ── */}
      {isSmart && (design.proofApproval || design.contentRights) && (
        <section style={{ marginTop: 26 }}>
          <h2 className="admin-photos-heading">Legal audit</h2>
          <div className="admin-meta-block">
            <table style={{ fontSize: 12, lineHeight: 1.7, width: '100%' }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d', width: 200 }}>Proof approved at</td>
                  <td>{design.proofApproval?.acceptedAt ? new Date(design.proofApproval.acceptedAt).toLocaleString() : '—'}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d' }}>Reviewed spreads</td>
                  <td>{design.proofApproval?.reviewedSpreadIds?.length ?? 0}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d' }}>Rights accepted at</td>
                  <td>{design.contentRights?.acceptedAt ? new Date(design.contentRights.acceptedAt).toLocaleString() : '—'}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d' }}>Clause version</td>
                  <td><code>{design.proofApproval?.clauseVersion ?? design.contentRights?.clauseVersion ?? '—'}</code></td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d' }}>Client IP</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{design.auditClientIp ?? '—'}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d' }}>User-Agent</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{design.auditUserAgent ?? '—'}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 16, color: '#6b5e4d' }}>Low-res photos</td>
                  <td>
                    {(design.lowResPhotos?.length ?? 0)}
                    {design.lowResPhotos && design.lowResPhotos.length > 0 && (
                      <span style={{ color: '#8a5613', marginLeft: 8 }}>(printer should review — clause 2.2)</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Status history ── */}
      {Array.isArray(design.statusHistory) && design.statusHistory.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h2 className="admin-photos-heading">Status history</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {design.statusHistory.slice().reverse().map((h, i) => (
                <tr key={i}>
                  <td className="admin-when">{new Date(h.at).toLocaleString()}</td>
                  <td><span className={'admin-status admin-status-' + h.status}>{statusLabel(h.status)}</span></td>
                  <td>{h.by}</td>
                  <td style={{ fontSize: 12, color: '#6b5e4d' }}>{h.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Refunds ── */}
      {refunds.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h2 className="admin-photos-heading">Refunds</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Refund ID</th>
                <th>Amount</th>
                <th>Square status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.refundId}>
                  <td className="admin-when">{new Date(r.at).toLocaleString()}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.refundId}</td>
                  <td>${(r.amountCents / 100).toFixed(2)}</td>
                  <td>{r.squareStatus || '—'}</td>
                  <td style={{ fontSize: 12, color: '#6b5e4d' }}>{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
