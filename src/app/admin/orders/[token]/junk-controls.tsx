'use client'

/** Order-detail Junk banner / buttons: move to Junk, restore, delete forever. */

import { useState } from 'react'

export default function JunkControls({ token, orderId, junk, junkAt }: { token: string; orderId: string; junk: boolean; junkAt?: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const call = async (url: string, body: unknown) => {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { error?: string; deleted?: number }
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`)
      return j
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  const toggle = async () => {
    if (await call('/api/admin/orders/junk', { tokens: [token], junk: !junk })) window.location.reload()
  }
  const destroy = async () => {
    const typed = window.prompt(
      `Permanently delete order ${orderId}?\n\nThis removes the order AND its photos and print files. It cannot be undone.\n\nType DELETE to confirm:`,
    )
    if (typed !== 'DELETE') return
    const j = await call('/api/admin/orders/delete', { tokens: [token], confirm: 'DELETE' })
    if (j && j.deleted) window.location.href = '/admin?tab=junk'
    else if (j) setErr('Not deleted — only orders in Junk can be deleted, and a paid order only once it is delivered, refunded or cancelled.')
  }

  if (!junk) {
    return (
      <button type="button" className="admin-logout" disabled={busy} onClick={toggle} title="Hide this order in the Junk folder">
        🗑 Move to Junk
      </button>
    )
  }
  return (
    <div className="admin-junk-banner">
      <span>
        🗑 This order is in <strong>Junk</strong>
        {junkAt ? ` since ${new Date(junkAt).toLocaleDateString()}` : ''}. It&apos;s hidden from the order lists.
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button type="button" className="admin-logout" disabled={busy} onClick={toggle}>
          ↩ Restore
        </button>
        <button type="button" className="admin-logout admin-danger" disabled={busy} onClick={destroy}>
          Delete forever
        </button>
      </span>
      {err && <div className="admin-download-errors" style={{ width: '100%' }}>{err}</div>}
    </div>
  )
}
