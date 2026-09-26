'use client'

/**
 * Orders table with selection + Junk actions.
 *   live mode: select → "Move to Junk"; per-row "Junk" button.
 *   junk mode: select → "Restore" / "Delete forever"; "Empty Junk" deletes
 *              everything in Junk. Deletes need the admin to type DELETE.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

export interface OrderRow {
  token: string
  orderId: string
  customerName: string
  customerEmail: string
  size: string
  spreads: number
  photoCount: number
  submittedAt: string
  status?: string
  statusLabel: string
  total: number
  mode?: string
  junkAt?: string
  /** Last failed/cancelled Square attempt, e.g. "FAILED". */
  paymentIssue?: string
}

export default function OrdersTable({ rows, mode }: { rows: OrderRow[]; mode: 'live' | 'junk' }) {
  const router = useRouter()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.token))
  const toggle = (t: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })
  const selected = useMemo(() => rows.filter((r) => sel.has(r.token)).map((r) => r.token), [rows, sel])

  const post = useCallback(async (url: string, body: unknown) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
    if (!r.ok) throw new Error(String(j.error ?? `Failed (${r.status})`))
    return j
  }, [])

  const junk = useCallback(
    async (tokens: string[], toJunk: boolean) => {
      if (!tokens.length) return
      setBusy(toJunk ? 'Moving to Junk…' : 'Restoring…')
      setMsg(null)
      try {
        await post('/api/admin/orders/junk', { tokens, junk: toJunk })
        setSel(new Set())
        setMsg({ ok: true, text: `${tokens.length} order${tokens.length === 1 ? '' : 's'} ${toJunk ? 'moved to Junk' : 'restored'}.` })
        router.refresh()
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
      } finally {
        setBusy(null)
      }
    },
    [post, router],
  )

  const del = useCallback(
    async (all: boolean) => {
      const count = all ? rows.length : selected.length
      if (!count) return
      const typed = window.prompt(
        `Permanently delete ${count} order${count === 1 ? '' : 's'}?\n\n` +
          'This removes the order AND its photos and print files. It cannot be undone.\n' +
          'A one-line record stays in the audit log.\n\nType DELETE to confirm:',
      )
      if (typed !== 'DELETE') {
        if (typed !== null) setMsg({ ok: false, text: 'Not deleted — you must type DELETE exactly.' })
        return
      }
      setMsg(null)
      let deleted = 0
      let files = 0
      try {
        // The server works in batches — repeat until nothing remains.
        for (let guard = 0; guard < 100; guard++) {
          setBusy(`Deleting… ${deleted}/${count}`)
          const j = (await post('/api/admin/orders/delete', all ? { all: true, confirm: 'DELETE' } : { tokens: selected, confirm: 'DELETE' })) as {
            deleted: number
            files: number
            remaining: number
            filesSkipped?: boolean
          }
          deleted += j.deleted
          files += j.files
          if (j.filesSkipped) setMsg({ ok: false, text: 'Photo storage is not connected here — order records deleted, files kept.' })
          if (!j.remaining || !j.deleted) break
        }
        setSel(new Set())
        setMsg((m) => m ?? { ok: true, text: `Deleted ${deleted} order${deleted === 1 ? '' : 's'} and ${files} file${files === 1 ? '' : 's'}.` })
        router.refresh()
      } catch (e) {
        setMsg({ ok: false, text: `${e instanceof Error ? e.message : String(e)} (${deleted} deleted so far)` })
        router.refresh()
      } finally {
        setBusy(null)
      }
    },
    [rows.length, selected, post, router],
  )

  return (
    <div className="admin-orders">
      <div className="admin-orders-meta" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>
          {rows.length} order{rows.length === 1 ? '' : 's'}
          {mode === 'junk' && ' in Junk — sent-to-print and old unpaid orders land here. Restore any time.'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {mode === 'live' ? (
            <button type="button" className="admin-logout" disabled={!selected.length || !!busy} onClick={() => junk(selected, true)}>
              🗑 Move to Junk{selected.length ? ` (${selected.length})` : ''}
            </button>
          ) : (
            <>
              <button type="button" className="admin-logout" disabled={!selected.length || !!busy} onClick={() => junk(selected, false)}>
                ↩ Restore{selected.length ? ` (${selected.length})` : ''}
              </button>
              <button type="button" className="admin-logout admin-danger" disabled={!selected.length || !!busy} onClick={() => del(false)}>
                Delete forever{selected.length ? ` (${selected.length})` : ''}
              </button>
              <button type="button" className="admin-logout admin-danger" disabled={!rows.length || !!busy} onClick={() => del(true)}>
                Empty Junk ({rows.length})
              </button>
            </>
          )}
        </span>
      </div>
      {(busy || msg) && (
        <div className={busy || msg?.ok ? 'admin-junk-note' : 'admin-download-errors'} style={{ marginBottom: 10 }}>
          {busy ?? msg?.text}
        </div>
      )}
      <table className="admin-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allOn}
                onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.token)))}
              />
            </th>
            <th>Submitted</th>
            <th>Order</th>
            <th>Customer</th>
            <th>Album</th>
            <th>Status</th>
            <th>Amount</th>
            {mode === 'junk' && <th>In Junk since</th>}
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.token} style={sel.has(o.token) ? { background: '#fff8e9' } : undefined}>
              <td>
                <input type="checkbox" aria-label={`Select ${o.orderId}`} checked={sel.has(o.token)} onChange={() => toggle(o.token)} />
              </td>
              <td>
                <span className="admin-when">{new Date(o.submittedAt).toLocaleString()}</span>
              </td>
              <td>
                <span className="admin-orderid">{o.orderId}</span>
              </td>
              <td>
                <div className="admin-cust-name">{o.customerName || '(no name)'}</div>
                <a className="admin-cust-email" href={`mailto:${encodeURIComponent(o.customerEmail)}`}>
                  {o.customerEmail || '—'}
                </a>
              </td>
              <td>
                {o.mode === 'magazine'
                  ? `${o.size || 'Magazine'} · 20 pages · ${o.photoCount} ph`
                  : `${o.size || '—'} · ${o.spreads} sp · ${o.photoCount} ph`}
              </td>
              <td>
                <span className={'admin-status admin-status-' + (o.status || 'submitted')}>{o.statusLabel}</span>
                {o.status === 'pending_payment' && o.paymentIssue && (
                  <div style={{ fontSize: 10, color: '#8a2a2a', marginTop: 3 }}>last attempt {o.paymentIssue.toLowerCase()}</div>
                )}
              </td>
              <td>
                {o.total > 0 ? (
                  <span className={o.status === 'refunded' ? 'admin-paid-no' : 'admin-paid-yes'}>${o.total.toFixed(0)}</span>
                ) : (
                  <span className="admin-paid-no">—</span>
                )}
              </td>
              {mode === 'junk' && <td className="admin-when">{o.junkAt ? new Date(o.junkAt).toLocaleDateString() : '—'}</td>}
              <td style={{ whiteSpace: 'nowrap' }}>
                <Link href={`/admin/orders/${o.token}`} className="admin-open-btn">
                  View →
                </Link>{' '}
                <button
                  type="button"
                  className="admin-row-btn"
                  disabled={!!busy}
                  title={mode === 'live' ? 'Move to Junk' : 'Restore'}
                  onClick={() => junk([o.token], mode === 'live')}
                >
                  {mode === 'live' ? '🗑' : '↩'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
