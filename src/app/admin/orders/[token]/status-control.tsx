'use client';

/**
 * StatusControl — dropdown that POSTs to /api/admin/orders/[token]/status.
 *
 * Adds an optional inline "note" field so transitions can be annotated
 * (e.g. "shipped via USPS, tracking 1Z…"). The note is captured in the
 * order's `statusHistory` for the timeline.
 *
 * If the server returns 409 (order locked because paid/refunded), we
 * surface the message and offer a "force" retry button. The user has to
 * click it explicitly — we won't auto-force.
 */

import { useState } from 'react';

const STATUSES = [
  { v: 'pending_payment', label: 'Pending payment', forSmart: true },
  { v: 'in_design', label: 'In design', forSmart: true },
  { v: 'in_production', label: 'In production', forSmart: true },
  { v: 'shipped', label: 'Shipped', forSmart: true },
  { v: 'delivered', label: 'Delivered', forSmart: true },
  { v: 'cancelled', label: 'Cancelled', forSmart: true },
  // Legacy manual statuses
  { v: 'submitted', label: 'Submitted (manual)', forSmart: false },
  { v: 'in_progress', label: 'In progress (manual)', forSmart: false },
];

interface LockState {
  message: string;
  attemptedStatus: string;
}

export default function StatusControl({
  token,
  initial,
}: {
  token: string;
  initial?: string;
}) {
  const [status, setStatus] = useState(initial || 'submitted');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState | null>(null);

  async function update(next: string, opts: { force?: boolean } = {}) {
    if (busy || (next === status && !opts.force)) return;
    const prev = status;
    if (!opts.force) setStatus(next);
    setBusy(true);
    setError(null);
    setLockState(null);
    try {
      const res = await fetch(`/api/admin/orders/${token}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: next,
          note: note.trim() || undefined,
          force: !!opts.force,
        }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus(prev);
        setLockState({ message: data.error || 'Order is locked', attemptedStatus: next });
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Success — clear the note so it isn't accidentally re-used.
      setNote('');
      if (opts.force) setStatus(next);
      // Soft reload to re-render the history table
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      setStatus(prev);
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-status-control">
      <select
        id={`status-${token}`}
        value={status}
        disabled={busy}
        onChange={(e) => update(e.target.value)}
        className={'admin-status-select admin-status-' + status}
      >
        {STATUSES.map((s) => (
          <option key={s.v} value={s.v}>
            {s.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        placeholder="Optional note (saved with transition)"
        disabled={busy}
        style={{
          marginTop: 6,
          width: '100%',
          background: '#faf7f0',
          border: '0.5px solid #c8baa0',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 12,
          fontFamily: 'inherit',
          color: '#1a1410',
          boxSizing: 'border-box',
        }}
      />
      {error && <div className="admin-login-error" style={{ marginTop: 6 }}>{error}</div>}
      {lockState && (
        <div
          style={{
            marginTop: 6,
            padding: '10px 12px',
            background: '#fbecec',
            border: '0.5px solid #d8a8a8',
            color: '#7a2828',
            fontSize: 12,
            lineHeight: 1.6,
            borderRadius: 6,
          }}
        >
          <div style={{ marginBottom: 6 }}>{lockState.message}</div>
          <button
            type="button"
            onClick={() => update(lockState.attemptedStatus, { force: true })}
            disabled={busy}
            style={{
              background: '#7a2828',
              color: '#fff',
              border: 'none',
              padding: '4px 10px',
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Force unlock &amp; apply
          </button>
        </div>
      )}
    </div>
  );
}
