/**
 * /design/smart/success
 *
 * Landing page after Stripe Checkout success. The customer is redirected
 * here with `?token=<orderToken>&order=<orderId>` in the URL. We do NOT
 * fetch order details — the confirmation email gives the customer
 * everything they need. This page just acknowledges receipt visually
 * and links back home.
 *
 * Stripe's webhook may not have processed the payment yet by the time
 * the customer lands here (it's async), so we don't claim "paid" —
 * we say "Thank you · we'll email you when payment is confirmed."
 */

'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

export const runtime = 'edge'

const GOLD = '#b8965a'

function SuccessInner() {
  const params = useSearchParams()
  const orderId = params?.get('order') ?? null

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0e0c09',
        color: '#f5f0e6',
        fontFamily: 'Georgia, serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: '100%',
          background: '#1a1611',
          border: `0.5px solid ${GOLD}`,
          borderRadius: 12,
          padding: '40px 36px',
          textAlign: 'center',
        }}
      >
        {/* Check mark */}
        <div
          style={{
            width: 80,
            height: 80,
            margin: '0 auto 24px',
            border: `0.5px solid ${GOLD}`,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontWeight: 300,
            fontSize: 36,
            margin: '0 0 12px',
            color: '#f5f0e6',
          }}
        >
          Thank you — payment <em style={{ color: GOLD, fontStyle: 'italic' }}>received</em>.
        </h1>
        {orderId && (
          <p style={{ fontSize: 13, letterSpacing: 1.5, color: GOLD, marginBottom: 18, textTransform: 'uppercase' }}>
            Order {orderId}
          </p>
        )}

        <p style={{ fontSize: 13, lineHeight: 1.7, color: '#cbb98a', margin: '0 0 24px' }}>
          We&apos;ve received your payment and your album is now locked for production.
          A confirmation email is on its way to your inbox — if you don&apos;t see it within a
          few minutes, check spam, or reply to{' '}
          <a href="mailto:orders@folioforever.com" style={{ color: GOLD }}>
            orders@folioforever.com
          </a>
          .
        </p>

        <div
          style={{
            background: 'rgba(184,150,90,0.06)',
            border: '0.5px solid rgba(184,150,90,0.25)',
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 28,
            fontSize: 12,
            lineHeight: 1.9,
            textAlign: 'left',
          }}
        >
          <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 10, display: 'block', marginBottom: 8 }}>
            What happens next
          </strong>
          <ol style={{ paddingLeft: 18, margin: 0, color: '#e8ddc1' }}>
            <li>Our design team reviews crops &amp; pacing (24 h)</li>
            <li>Printing &amp; binding begins (5–7 business days)</li>
            <li>We ship with tracking to the address on file</li>
          </ol>
        </div>

        <p style={{ fontSize: 10, color: '#8a7a65', lineHeight: 1.6, margin: '0 0 20px' }}>
          Per clause 2.3 of our Terms of Service, your approved proof now governs the
          print and the order cannot be cancelled or modified except for manufacturing
          defects.
        </p>

        <Link
          href="/"
          style={{
            display: 'inline-block',
            background: GOLD,
            color: '#0e0c09',
            padding: '12px 28px',
            textDecoration: 'none',
            fontSize: 11,
            letterSpacing: 2,
            textTransform: 'uppercase',
            borderRadius: 4,
            fontFamily: 'inherit',
          }}
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}

export default function SmartSuccessPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0e0c09' }} />}>
      <SuccessInner />
    </Suspense>
  )
}
