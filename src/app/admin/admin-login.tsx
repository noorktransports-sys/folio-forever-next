'use client';

/**
 * AdminLogin — single password input. Submits to /api/admin/login.
 * On 200 the route's Set-Cookie header authenticates the next page
 * load, so we just window.location.reload().
 */

import { useState } from 'react';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login-shell">
      <form className="admin-login-card" onSubmit={onSubmit}>
        <div className="admin-tag">Folio &amp; Forever</div>
        <h1>Admin sign-in</h1>
        <p className="admin-login-desc">
          Enter the admin password to view submitted orders.
        </p>
        <input
          type="password"
          name="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          minLength={4}
          className="admin-login-input"
          autoComplete="current-password"
        />
        {error ? <div className="admin-login-error">{error}</div> : null}
        <button
          type="submit"
          className="admin-login-submit"
          disabled={submitting}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
