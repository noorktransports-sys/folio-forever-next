'use client';

import { useState } from 'react';

export default function PhotographerActions({
  accountId,
  status,
}: {
  accountId: string;
  status: 'pending' | 'approved' | 'rejected';
}) {
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);

  async function update(decision: 'approve' | 'reject') {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/photographers/${accountId}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { status?: string };
      if (res.ok && data.status) {
        setCurrent(data.status as typeof current);
      }
    } finally {
      setBusy(false);
    }
  }

  if (current === 'approved') {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="admin-status admin-status-shipped">Approved</span>
        <button
          type="button"
          className="admin-action-secondary"
          onClick={() => update('reject')}
          disabled={busy}
          style={{ padding: '4px 10px', fontSize: 10 }}
        >
          Revoke
        </button>
      </div>
    );
  }
  if (current === 'rejected') {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="admin-status admin-status-cancelled">Rejected</span>
        <button
          type="button"
          className="admin-action-secondary"
          onClick={() => update('approve')}
          disabled={busy}
          style={{ padding: '4px 10px', fontSize: 10 }}
        >
          Approve
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        type="button"
        className="admin-action-primary"
        onClick={() => update('approve')}
        disabled={busy}
        style={{ padding: '6px 12px', fontSize: 10 }}
      >
        {busy ? '…' : 'Approve'}
      </button>
      <button
        type="button"
        className="admin-action-secondary"
        onClick={() => update('reject')}
        disabled={busy}
        style={{ padding: '6px 12px', fontSize: 10 }}
      >
        Reject
      </button>
    </div>
  );
}
