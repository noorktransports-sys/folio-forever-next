'use client';

import { useState } from 'react';

export default function ProLoginForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      // Always succeeds (server returns 200 even for unknown emails to
      // prevent account enumeration). We just optimistically show the
      // "check your email" screen.
      await fetch('/api/pro/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="pro-login-sent">
        <div className="pro-login-sent-tick">&#10003;</div>
        <p>
          If an approved account exists for <strong>{email}</strong>, a
          sign-in link is on its way. The link is good for 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <input
        type="email"
        className="pro-login-input"
        placeholder="you@studio.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
        autoComplete="email"
      />
      <button
        type="submit"
        className="pro-login-submit"
        disabled={submitting}
      >
        {submitting ? 'Sending…' : 'Send sign-in link'}
      </button>
    </form>
  );
}
