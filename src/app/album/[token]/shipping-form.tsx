'use client';

/**
 * ShippingForm — pre-submit modal that collects what we need to
 * actually deliver the album. Without this we'd have an order with
 * no address; the printed album would have nowhere to go.
 *
 * Captures: full name, phone, address line 1+2, city, state/region,
 * postal code, country (default US), delivery notes.
 *
 * Persists optimistically into localStorage (folio-shipping-v1) so
 * a customer who walked away mid-form can resume without retyping.
 *
 * On confirm: calls onSubmit(values). The parent (album-viewer)
 * pipes those values into POST /api/submit-order alongside the token.
 */

import { useEffect, useState } from 'react';

export interface ShippingValues {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
}

const EMPTY: ShippingValues = {
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'United States',
  notes: '',
};

const LS_KEY = 'folio-shipping-v1';

export default function ShippingForm({
  defaultName,
  onCancel,
  onSubmit,
}: {
  defaultName?: string;
  onCancel: () => void;
  onSubmit: (v: ShippingValues) => void | Promise<void>;
}) {
  const [values, setValues] = useState<ShippingValues>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ShippingValues;
        return { ...EMPTY, ...parsed };
      }
    } catch { /* empty */ }
    return { ...EMPTY, recipientName: defaultName || '' };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist to localStorage on every change so partial fills survive
  // an accidental tab close.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(values));
    } catch { /* storage disabled */ }
  }, [values]);

  function set<K extends keyof ShippingValues>(k: K, v: ShippingValues[K]) {
    setValues((p) => ({ ...p, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    // Minimal required-field check.
    const required: (keyof ShippingValues)[] = [
      'recipientName',
      'phone',
      'line1',
      'city',
      'region',
      'postalCode',
      'country',
    ];
    const missing = required.filter((k) => !values[k].trim());
    if (missing.length) {
      setError(`Please fill: ${missing.join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ship-overlay" role="dialog" aria-modal="true">
      <form className="ship-card" onSubmit={handleSubmit}>
        <div className="ship-tag">Almost done</div>
        <h2 className="ship-title">Where should we send it?</h2>
        <p className="ship-desc">
          We&rsquo;ll email a proof + invoice within 24 hours. Album ships
          to this address once approved.
        </p>

        <div className="ship-grid">
          <label className="ship-field ship-col-2">
            <span>Recipient name</span>
            <input
              type="text"
              value={values.recipientName}
              onChange={(e) => set('recipientName', e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="ship-field ship-col-2">
            <span>Phone</span>
            <input
              type="tel"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+1 415 555 0172"
              required
            />
          </label>
          <label className="ship-field ship-col-2">
            <span>Street address</span>
            <input
              type="text"
              value={values.line1}
              onChange={(e) => set('line1', e.target.value)}
              required
            />
          </label>
          <label className="ship-field ship-col-2">
            <span>Apt / suite (optional)</span>
            <input
              type="text"
              value={values.line2}
              onChange={(e) => set('line2', e.target.value)}
            />
          </label>
          <label className="ship-field">
            <span>City</span>
            <input
              type="text"
              value={values.city}
              onChange={(e) => set('city', e.target.value)}
              required
            />
          </label>
          <label className="ship-field">
            <span>State / region</span>
            <input
              type="text"
              value={values.region}
              onChange={(e) => set('region', e.target.value)}
              required
            />
          </label>
          <label className="ship-field">
            <span>Postal code</span>
            <input
              type="text"
              value={values.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              required
            />
          </label>
          <label className="ship-field">
            <span>Country</span>
            <input
              type="text"
              value={values.country}
              onChange={(e) => set('country', e.target.value)}
              required
            />
          </label>
          <label className="ship-field ship-col-2">
            <span>Delivery notes (optional)</span>
            <textarea
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Gate code, leave at door, etc."
            />
          </label>
        </div>

        {error ? <div className="ship-error">{error}</div> : null}

        <div className="ship-actions">
          <button
            type="button"
            className="ship-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            Back
          </button>
          <button type="submit" className="ship-submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Confirm &amp; submit'}
          </button>
        </div>
      </form>
    </div>
  );
}
