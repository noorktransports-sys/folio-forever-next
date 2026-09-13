/**
 * /design/smart/success
 *
 * Landing page after Stripe Checkout success. The customer is redirected
 * here with `?token=<orderToken>&order=<orderId>` in the URL. We do NOT
 * fetch order details for the bulk of the page — the confirmation email
 * gives the customer everything they need.
 *
 * BUT — we DO fetch lightly to surface the SHARE PACK: two
 * 1080×1920 Instagram-Story cards rendered at submit time with the
 * cover + first spreads + a folioforever.com footer. Offering them
 * here turns every couple who shares into a marketing channel.
 *
 * Stripe's webhook may not have processed the payment yet by the time
 * the customer lands here (it's async), so we don't claim "paid" —
 * we say "Thank you · we'll email you when payment is confirmed."
 */

'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

export const runtime = 'edge'

const GOLD = '#b8965a'

interface SharePack {
  coverUrl?: string | null
  montageUrl?: string | null
}

function SuccessInner() {
  const params = useSearchParams()
  const orderId = params?.get('order') ?? null
  const token = params?.get('token') ?? null

  const [sharePack, setSharePack] = useState<SharePack | null>(null)

  // Fetch the saved design just to pull out the share-pack URLs. Best
  // effort — a failure here is silent; the rest of the page (the
  // thank-you message) is the primary content.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/designs/${encodeURIComponent(token)}`)
        if (!res.ok) return
        const j = (await res.json()) as { sharePack?: SharePack | null }
        if (cancelled) return
        if (j.sharePack) setSharePack(j.sharePack)
      } catch {
        /* silent — no share pack shown */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

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
        gap: 28,
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

      {/* ─── Share Pack ─────────────────────────────────────────────────
          1080×1920 Instagram-Story cards rendered at submit time. Each
          carries a discrete folioforever.com footer so every share is
          organic acquisition. Shown only when the render succeeded. */}
      {sharePack && (sharePack.coverUrl || sharePack.montageUrl) && (
        <SharePackPanel sharePack={sharePack} orderId={orderId} />
      )}
    </div>
  )
}

function SharePackPanel({
  sharePack,
  orderId,
}: {
  sharePack: SharePack
  orderId: string | null
}) {
  const cards: Array<{ label: string; url: string; filename: string }> = []
  if (sharePack.coverUrl) {
    cards.push({
      label: 'Cover',
      url: sharePack.coverUrl,
      filename: `folioforever-${orderId ?? 'album'}-cover.jpg`,
    })
  }
  if (sharePack.montageUrl) {
    cards.push({
      label: 'Highlights',
      url: sharePack.montageUrl,
      filename: `folioforever-${orderId ?? 'album'}-highlights.jpg`,
    })
  }
  if (cards.length === 0) return null

  return (
    <div
      style={{
        maxWidth: 560,
        width: '100%',
        background: '#1a1611',
        border: `0.5px solid ${GOLD}40`,
        borderRadius: 12,
        padding: '28px 28px 24px',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 24,
          fontWeight: 300,
          color: '#f5f0e6',
          margin: '0 0 6px',
        }}
      >
        Share the moment.
      </p>
      <p
        style={{
          fontSize: 12,
          letterSpacing: 1.5,
          color: '#9b8869',
          textTransform: 'uppercase',
          margin: '0 0 22px',
        }}
      >
        Story-ready cards · 1080 × 1920
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cards.length === 1 ? '1fr' : '1fr 1fr',
          gap: 14,
          marginBottom: 16,
        }}
      >
        {cards.map((c) => (
          <ShareCard key={c.url} card={c} />
        ))}
      </div>

      <p style={{ fontSize: 11, color: '#8a7a65', lineHeight: 1.5, margin: 0 }}>
        Save to your camera roll, then upload as an Instagram or Facebook Story.
      </p>
    </div>
  )
}

function ShareCard({
  card,
}: {
  card: { label: string; url: string; filename: string }
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {/* The card preview itself (small thumbnail at 9:16 aspect). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.url}
        alt={`${card.label} share card`}
        style={{
          width: '100%',
          maxWidth: 220,
          aspectRatio: '9 / 16',
          objectFit: 'cover',
          borderRadius: 8,
          border: `0.5px solid ${GOLD}40`,
          background: '#0e0c09',
        }}
      />
      <a
        href={card.url}
        download={card.filename}
        style={{
          display: 'inline-block',
          width: '100%',
          maxWidth: 220,
          background: 'transparent',
          color: GOLD,
          border: `0.5px solid ${GOLD}80`,
          padding: '9px 0',
          textDecoration: 'none',
          fontSize: 10,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          borderRadius: 4,
          fontFamily: 'inherit',
          textAlign: 'center',
        }}
      >
        ↓ Save {card.label.toLowerCase()}
      </a>
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
