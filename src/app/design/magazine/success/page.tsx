'use client'

// Shown after Square payment for a magazine order.
// Square redirects to /design/magazine/success?token=…&order=…

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export const runtime = 'edge'

const GOLD = '#b8965a'

function Inner() {
  const params = useSearchParams()
  const order = params?.get('order') ?? ''
  return (
    <main style={{ minHeight: '100vh', background: 'var(--dark)', color: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: GOLD, textTransform: 'uppercase' }}>Folio Forever</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 46, lineHeight: 1.1, margin: '18px 0 10px' }}>
          Thank you — <em style={{ color: GOLD }}>it&apos;s off to print.</em>
        </h1>
        <p style={{ color: 'var(--muted2)', fontSize: 14, lineHeight: 1.8 }}>
          Your wedding magazine order{order ? <> <strong style={{ color: 'var(--cream)' }}>{order}</strong></> : null} is confirmed.
          <br />A confirmation email with your approved pages is on its way.
          <br />We&apos;ll be in touch about shipping.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
          <Link href="/design" style={{ border: `0.5px solid ${GOLD}`, color: GOLD, borderRadius: 30, padding: '11px 22px', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textDecoration: 'none' }}>
            Design another
          </Link>
          <Link href="/" style={{ background: GOLD, color: '#0e0c09', borderRadius: 30, padding: '11px 22px', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', textDecoration: 'none', fontWeight: 700 }}>
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function MagazineSuccessPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
