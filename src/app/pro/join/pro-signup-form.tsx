'use client';

import { useState } from 'react';

export default function ProSignupForm() {
  const [values, setValues] = useState({
    studioName: '',
    name: '',
    email: '',
    phone: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof values>(k: K, v: string) {
    setValues((p) => ({ ...p, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/pro/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="pro-login-sent">
        <div className="pro-login-sent-tick">&#10003;</div>
        <p>
          Application received. We&rsquo;ll email{' '}
          <strong>{values.email}</strong> within 1 business day with a
          sign-in link once we&rsquo;ve reviewed it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="pro-join-form">
      <label className="pro-join-field">
        <span>Studio name</span>
        <input
          type="text"
          value={values.studioName}
          onChange={(e) => set('studioName', e.target.value)}
          required
          autoFocus
        />
      </label>
      <label className="pro-join-field">
        <span>Your name</span>
        <input
          type="text"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />
      </label>
      <label className="pro-join-field">
        <span>Email</span>
        <input
          type="email"
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label className="pro-join-field">
        <span>Phone</span>
        <input
          type="tel"
          value={values.phone}
          onChange={(e) => set('phone', e.target.value)}
          required
          autoComplete="tel"
        />
      </label>
      <label className="pro-join-field">
        <span>Anything else? (optional)</span>
        <textarea
          rows={3}
          value={values.message}
          onChange={(e) => set('message', e.target.value)}
          placeholder="Volume, website, how you heard about us…"
        />
      </label>
      {error ? <div className="pro-login-error">{error}</div> : null}
      <button
        type="submit"
        className="pro-login-submit"
        disabled={submitting}
      >
        {submitting ? 'Submitting…' : 'Apply for account'}
      </button>
    </form>
  );
}
