'use client';

/**
 * AdminNotes — textarea for the admin's working memory on this order.
 * Saves to /api/admin/orders/[token]/notes on blur (no save button —
 * less friction). Shows a quiet "saved" confirmation indicator.
 */

import { useEffect, useRef, useState } from 'react';

export default function AdminNotes({
  token,
  initial,
}: {
  token: string;
  initial?: string;
}) {
  const [value, setValue] = useState(initial || '');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef(initial || '');

  // Save on blur OR after 2 s of inactivity.
  useEffect(() => {
    if (value === lastSavedRef.current) return;
    const t = window.setTimeout(() => save(value), 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function save(notes: string) {
    if (notes === lastSavedRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${token}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      lastSavedRef.current = notes;
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-notes">
      <div className="admin-notes-head">
        <span className="admin-meta-label">Internal notes</span>
        <span className="admin-notes-state">
          {saving ? 'Saving…' : error ? <span className="admin-notes-err">{error}</span> : savedAt ? `Saved ${savedAt}` : ''}
        </span>
      </div>
      <textarea
        className="admin-notes-area"
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => save(value)}
        placeholder="Working notes — won't be shown to the customer."
      />
    </div>
  );
}
