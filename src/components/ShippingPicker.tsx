'use client'

/** Delivery-speed radio cards used at checkout (magazine + albums). */

import { SHIPPING_OPTIONS, type ShippingId } from '@/lib/shipping'

const GOLD = '#b8965a'

export default function ShippingPicker({
  value,
  onChange,
  disabled,
}: {
  value: ShippingId
  onChange: (id: ShippingId) => void
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Delivery speed" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
      {SHIPPING_OPTIONS.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 8,
              cursor: disabled ? 'default' : 'pointer',
              background: on ? 'rgba(184,150,90,0.14)' : 'transparent',
              border: on ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.35)',
              color: 'var(--cream)',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
                {on ? '● ' : '○ '}
                {o.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>${o.usd}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 3 }}>Delivered in {o.days}</div>
          </button>
        )
      })}
    </div>
  )
}
