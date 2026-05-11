'use client'

/**
 * Order-detail client island. Owns:
 *   • Refund modal (full or partial, with reason)
 *   • Resend confirmation email button
 *   • Copy all photo URLs to clipboard
 *   • Open all photos in new tabs (with browser-block guard)
 *
 * Server component passes in the order's token, current paid amount cap
 * for refunds, the photo URL list, and feature flags. The island never
 * needs to re-fetch the order — actions either reload the page or show
 * a small inline status.
 */

import { useCallback, useState } from 'react'

interface Props {
  token: string
  orderId: string
  isSmart: boolean
  canRefund: boolean
  canResend: boolean
  /** Used as the upper bound for partial refunds (in cents). */
  maxRefundCents: number
  photoUrls: string[]
}

export default function OrderActions({
  token,
  orderId,
  isSmart,
  canRefund,
  canResend,
  maxRefundCents,
  photoUrls,
}: Props) {
  const [refundOpen, setRefundOpen] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 5000)
  }, [])

  const onResend = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/orders/${token}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: 'customer' }),
      })
      const j = (await r.json()) as { ok?: boolean; customerSent?: boolean; error?: string }
      if (!r.ok || !j.ok) throw new Error(j.error || 'Failed')
      showToast('ok', j.customerSent ? 'Confirmation email resent.' : 'Send attempted (provider may have throttled).')
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e))
    }
  }, [token, showToast])

  const onCopyUrls = useCallback(async () => {
    try {
      const text = photoUrls.map((u) => (u.startsWith('http') ? u : window.location.origin + u)).join('\n')
      await navigator.clipboard.writeText(text)
      showToast('ok', `Copied ${photoUrls.length} URL${photoUrls.length === 1 ? '' : 's'} to clipboard.`)
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e))
    }
  }, [photoUrls, showToast])

  const onOpenAll = useCallback(() => {
    if (photoUrls.length > 20) {
      if (!window.confirm(`Open ${photoUrls.length} photos in new tabs? Your browser will likely block tabs after the first few. Continue?`)) {
        return
      }
    }
    let opened = 0
    for (const u of photoUrls) {
      const win = window.open(u, '_blank', 'noopener')
      if (win) opened++
    }
    showToast(opened === photoUrls.length ? 'ok' : 'err', `Opened ${opened} of ${photoUrls.length}.`)
  }, [photoUrls, showToast])

  return (
    <>
      {canResend && (
        <button type="button" className="admin-action-secondary" onClick={onResend}>
          Resend confirmation
        </button>
      )}
      {canRefund && (
        <button type="button" className="admin-action-secondary" onClick={() => setRefundOpen(true)}>
          Issue refund
        </button>
      )}
      {photoUrls.length > 0 && (
        <>
          <button type="button" className="admin-action-secondary" onClick={onCopyUrls}>
            Copy {photoUrls.length} URL{photoUrls.length === 1 ? '' : 's'}
          </button>
          <button type="button" className="admin-action-secondary" onClick={onOpenAll}>
            Open all photos
          </button>
        </>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 18,
            right: 18,
            background: toast.kind === 'ok' ? '#e7f5ec' : '#fbecec',
            color: toast.kind === 'ok' ? '#2a6a3f' : '#7a2828',
            border: `0.5px solid ${toast.kind === 'ok' ? '#a8d8b8' : '#d8a8a8'}`,
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            zIndex: 10000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            maxWidth: 320,
          }}
        >
          {toast.msg}
        </div>
      )}

      {refundOpen && (
        <RefundModal
          token={token}
          orderId={orderId}
          isSmart={isSmart}
          maxCents={maxRefundCents}
          onClose={() => setRefundOpen(false)}
          onSuccess={(msg) => {
            showToast('ok', msg)
            setRefundOpen(false)
            // Reload after a beat so the new status + refund row renders
            setTimeout(() => window.location.reload(), 800)
          }}
          onError={(msg) => showToast('err', msg)}
        />
      )}
    </>
  )
}

interface RefundModalProps {
  token: string
  orderId: string
  isSmart: boolean
  maxCents: number
  onClose: () => void
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}

function RefundModal({ token, orderId, maxCents, onClose, onSuccess, onError }: RefundModalProps) {
  const [kind, setKind] = useState<'full' | 'partial'>('full')
  const [amountInput, setAmountInput] = useState(() => (maxCents / 100).toFixed(2))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const doRefund = useCallback(async () => {
    const amountCents =
      kind === 'full' ? maxCents : Math.round(parseFloat(amountInput.trim()) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > maxCents) {
      onError(`Amount must be between $0.01 and $${(maxCents / 100).toFixed(2)}`)
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/orders/${token}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents, reason: reason.trim() || undefined }),
      })
      const j = (await r.json()) as { ok?: boolean; refundId?: string; error?: string }
      if (!r.ok || !j.ok) throw new Error(j.error || 'Refund failed')
      onSuccess(`Refund issued · $${(amountCents / 100).toFixed(2)} · ${j.refundId}`)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [kind, amountInput, reason, maxCents, token, onSuccess, onError])

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#faf7f0',
          border: '0.5px solid #b8965a',
          borderRadius: 12,
          padding: 28,
          maxWidth: 460,
          width: '100%',
        }}
      >
        <h3 style={{ fontFamily: 'var(--font-display, "Cormorant Garamond", serif)', fontSize: 22, fontWeight: 400, margin: '0 0 6px' }}>
          Issue refund · {orderId}
        </h3>
        <p style={{ fontSize: 12, color: '#6b5e4d', margin: '0 0 18px', lineHeight: 1.6 }}>
          Refunds money via Square back to the original payment method. Order status flips to <strong>refunded</strong>.
          This action is logged in the audit trail.
        </p>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" name="kind" checked={kind === 'full'} onChange={() => setKind('full')} />
            Full refund · ${(maxCents / 100).toFixed(2)}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" name="kind" checked={kind === 'partial'} onChange={() => setKind('partial')} />
            Partial refund
          </label>
          {kind === 'partial' && (
            <div style={{ marginTop: 8, paddingLeft: 24 }}>
              <label style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase' }}>
                Amount (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={(maxCents / 100).toFixed(2)}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                disabled={busy}
                className="admin-login-input"
                style={{ width: 160, marginTop: 4 }}
              />
            </div>
          )}
        </div>

        <label style={{ fontSize: 10, letterSpacing: 1.5, color: '#6b5e4d', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
          Reason (optional, stored on Square)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 192))}
          disabled={busy}
          className="admin-notes-area"
          rows={3}
          placeholder="e.g. Customer requested cancellation before production started"
        />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="admin-action-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-action-primary"
            onClick={doRefund}
            disabled={busy}
            style={{ opacity: busy ? 0.6 : 1, cursor: busy ? 'progress' : 'pointer' }}
          >
            {busy ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  )
}
