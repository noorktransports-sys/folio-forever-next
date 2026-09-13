'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type AuditType = 'proof' | 'rights' | 'refund'

interface AuditItem {
  key: string
  data: Record<string, unknown>
}

interface AuditResponse {
  ok: boolean
  type: AuditType
  items: AuditItem[]
  cursor: string | null
  listComplete: boolean
}

export function AuditViewer() {
  const [type, setType] = useState<AuditType>('proof')
  const [items, setItems] = useState<AuditItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (nextType: AuditType, opts: { append?: boolean; cursor?: string | null } = {}) => {
      setLoading(true)
      setError(null)
      try {
        const url = new URL('/api/admin/audit', window.location.origin)
        url.searchParams.set('type', nextType)
        url.searchParams.set('limit', '50')
        if (opts.cursor) url.searchParams.set('cursor', opts.cursor)
        const r = await fetch(url.toString())
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as AuditResponse
        setItems((prev) => (opts.append ? [...prev, ...j.items] : j.items))
        setCursor(j.cursor)
        setHasMore(!j.listComplete && !!j.cursor)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    load(type)
  }, [type, load])

  return (
    <>
      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          className={`admin-tab ${type === 'proof' ? 'is-active' : ''}`}
          onClick={() => setType('proof')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          Proof approvals (2.3)
        </button>
        <button
          type="button"
          className={`admin-tab ${type === 'rights' ? 'is-active' : ''}`}
          onClick={() => setType('rights')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          Content rights (2.2 / 2.4)
        </button>
        <button
          type="button"
          className={`admin-tab ${type === 'refund' ? 'is-active' : ''}`}
          onClick={() => setType('refund')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          Refunds
        </button>
      </div>

      <p className="admin-orders-meta">
        {loading ? 'Loading…' : `${items.length} records${hasMore ? ' (more available)' : ''}`}
      </p>

      {error && (
        <div className="admin-download-errors" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {type === 'proof' && <ProofTable items={items} />}
      {type === 'rights' && <RightsTable items={items} />}
      {type === 'refund' && <RefundTable items={items} />}

      {hasMore && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            type="button"
            className="admin-action-secondary"
            onClick={() => load(type, { append: true, cursor })}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button
            type="button"
            className="admin-action-secondary"
            onClick={() => exportToCsv(type, items)}
          >
            Export visible to CSV
          </button>
        </div>
      )}
    </>
  )
}

/* ── Tables ── */

function ProofTable({ items }: { items: AuditItem[] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Accepted at</th>
          <th>Order</th>
          <th>Customer</th>
          <th>Clause ver</th>
          <th>Spreads</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const d = it.data as {
            proofApproval?: { acceptedAt?: string; clauseVersion?: string; reviewedSpreadIds?: string[] }
            customer?: { name: string; email: string }
            orderId?: string
            token?: string
            clientIp?: string
            serverReceivedAt?: string
          }
          const orderId = d.orderId ?? it.key.replace(/^proof_approval:/, '')
          return (
            <tr key={it.key}>
              <td className="admin-when">{(d.proofApproval?.acceptedAt ?? d.serverReceivedAt ?? '').slice(0, 19).replace('T', ' ')}</td>
              <td>
                {d.token ? (
                  <Link href={`/admin/orders/${d.token}`} className="admin-meta-link">
                    <span className="admin-orderid">{orderId}</span>
                  </Link>
                ) : (
                  <span className="admin-orderid">{orderId}</span>
                )}
              </td>
              <td>
                <div className="admin-cust-name">{d.customer?.name ?? '—'}</div>
                <div style={{ fontSize: 11, color: '#6b5e4d' }}>{d.customer?.email ?? ''}</div>
              </td>
              <td>{d.proofApproval?.clauseVersion ?? '—'}</td>
              <td>{d.proofApproval?.reviewedSpreadIds?.length ?? 0}</td>
              <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{d.clientIp ?? '—'}</td>
            </tr>
          )
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={6} style={{ textAlign: 'center', color: '#6b5e4d', padding: 24 }}>
              No proof approval records yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function RightsTable({ items }: { items: AuditItem[] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Accepted at</th>
          <th>Order</th>
          <th>Customer</th>
          <th>Clause ver</th>
          <th>Photos</th>
          <th>Low-res</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const d = it.data as {
            contentRights?: { acceptedAt?: string; clauseVersion?: string }
            customer?: { name: string; email: string }
            orderId?: string
            token?: string
            clientIp?: string
            photoCount?: number
            lowResPhotos?: unknown[]
            serverReceivedAt?: string
          }
          const orderId = d.orderId ?? it.key.replace(/^content_rights:/, '')
          return (
            <tr key={it.key}>
              <td className="admin-when">{(d.contentRights?.acceptedAt ?? d.serverReceivedAt ?? '').slice(0, 19).replace('T', ' ')}</td>
              <td>
                {d.token ? (
                  <Link href={`/admin/orders/${d.token}`} className="admin-meta-link">
                    <span className="admin-orderid">{orderId}</span>
                  </Link>
                ) : (
                  <span className="admin-orderid">{orderId}</span>
                )}
              </td>
              <td>
                <div className="admin-cust-name">{d.customer?.name ?? '—'}</div>
                <div style={{ fontSize: 11, color: '#6b5e4d' }}>{d.customer?.email ?? ''}</div>
              </td>
              <td>{d.contentRights?.clauseVersion ?? '—'}</td>
              <td>{d.photoCount ?? '—'}</td>
              <td>{Array.isArray(d.lowResPhotos) ? d.lowResPhotos.length : 0}</td>
              <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{d.clientIp ?? '—'}</td>
            </tr>
          )
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={7} style={{ textAlign: 'center', color: '#6b5e4d', padding: 24 }}>
              No content rights records yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function RefundTable({ items }: { items: AuditItem[] }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Refunded at</th>
          <th>Order</th>
          <th>Refund ID</th>
          <th>Amount</th>
          <th>Reason</th>
          <th>Square status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const d = it.data as {
            refundId?: string
            amountCents?: number
            reason?: string
            at?: string
            squareStatus?: string
            token?: string
            orderId?: string
          }
          return (
            <tr key={it.key}>
              <td className="admin-when">{(d.at ?? '').slice(0, 19).replace('T', ' ')}</td>
              <td>
                {d.token ? (
                  <Link href={`/admin/orders/${d.token}`} className="admin-meta-link">
                    <span className="admin-orderid">{d.orderId ?? '—'}</span>
                  </Link>
                ) : (
                  <span className="admin-orderid">{d.orderId ?? '—'}</span>
                )}
              </td>
              <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{d.refundId ?? '—'}</td>
              <td>${((d.amountCents ?? 0) / 100).toFixed(2)}</td>
              <td style={{ fontSize: 12, color: '#6b5e4d' }}>{d.reason || '—'}</td>
              <td>{d.squareStatus ?? '—'}</td>
            </tr>
          )
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={6} style={{ textAlign: 'center', color: '#6b5e4d', padding: 24 }}>
              No refunds yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/* ── CSV export ── */

function exportToCsv(type: AuditType, items: AuditItem[]) {
  let header: string[]
  let rows: string[][]
  if (type === 'proof') {
    header = ['Accepted at', 'Order ID', 'Customer name', 'Customer email', 'Clause version', 'Reviewed spreads', 'Client IP', 'User-Agent']
    rows = items.map((it) => {
      const d = it.data as {
        proofApproval?: { acceptedAt?: string; clauseVersion?: string; reviewedSpreadIds?: string[] }
        customer?: { name: string; email: string }
        orderId?: string
        clientIp?: string
        userAgent?: string
      }
      return [
        d.proofApproval?.acceptedAt ?? '',
        d.orderId ?? '',
        d.customer?.name ?? '',
        d.customer?.email ?? '',
        d.proofApproval?.clauseVersion ?? '',
        String(d.proofApproval?.reviewedSpreadIds?.length ?? 0),
        d.clientIp ?? '',
        d.userAgent ?? '',
      ]
    })
  } else if (type === 'rights') {
    header = ['Accepted at', 'Order ID', 'Customer name', 'Customer email', 'Clause version', 'Photo count', 'Low-res count', 'Client IP', 'User-Agent']
    rows = items.map((it) => {
      const d = it.data as {
        contentRights?: { acceptedAt?: string; clauseVersion?: string }
        customer?: { name: string; email: string }
        orderId?: string
        photoCount?: number
        lowResPhotos?: unknown[]
        clientIp?: string
        userAgent?: string
      }
      return [
        d.contentRights?.acceptedAt ?? '',
        d.orderId ?? '',
        d.customer?.name ?? '',
        d.customer?.email ?? '',
        d.contentRights?.clauseVersion ?? '',
        String(d.photoCount ?? ''),
        String(Array.isArray(d.lowResPhotos) ? d.lowResPhotos.length : 0),
        d.clientIp ?? '',
        d.userAgent ?? '',
      ]
    })
  } else {
    header = ['Refunded at', 'Order ID', 'Refund ID', 'Amount USD', 'Reason', 'Square status']
    rows = items.map((it) => {
      const d = it.data as {
        refundId?: string
        amountCents?: number
        reason?: string
        at?: string
        squareStatus?: string
        orderId?: string
      }
      return [
        d.at ?? '',
        d.orderId ?? '',
        d.refundId ?? '',
        ((d.amountCents ?? 0) / 100).toFixed(2),
        d.reason ?? '',
        d.squareStatus ?? '',
      ]
    })
  }

  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `folio-audit-${type}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
