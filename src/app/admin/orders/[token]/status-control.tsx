'use client';

/**
 * StatusControl — dropdown that POSTs to /api/admin/orders/[token]/status.
 * Optimistically updates the visible status pill, rolls back on failure.
 */

import { useState } from 'react';

const STATUSES = [
  { v: 'submitted', label: 'Pending' },
  { v: 'in_progress', label: 'In progress' },
  { v: 'shipped', label: 'Shipped' },
  { v: 'delivered', label: 'Delivered' },
  { v: 'cancelled', label: 'Cancelled' },
];

export default function StatusControl({
  token,
  initial,
}: {
  token: string;
  initial?: string;
}) {
  const [status, setStatus] = useState(initial || 'submitted');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(next: string) {
    if (busy || next === status) return;
    const prev = status;
    setStatus(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${token}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setStatus(prev);
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-status-control">
      <label className="admin-meta-label" htmlFor={`status-${token}`}>
        Order status
      </label>
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
      {error ? <div className="admin-login-error">{error}</div> : null}
    </div>
  );
}
