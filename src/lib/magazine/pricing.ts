// src/lib/magazine/pricing.ts
//
// Server-side magazine pricing. The client never decides the amount.
//   price    = MAG_PRICE ($70)
//   shipping = env MAGAZINE_SHIPPING_USD (unset / 0 → arranged separately)

import { MAG_PRICE } from './pages'

export function magazineShippingUsd(env: { MAGAZINE_SHIPPING_USD?: string }): number {
  const v = Number(env.MAGAZINE_SHIPPING_USD ?? 0)
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0
}

export function magazineTotal(env: { MAGAZINE_SHIPPING_USD?: string }) {
  const shippingUsd = magazineShippingUsd(env)
  return { price: MAG_PRICE, shippingUsd, total: MAG_PRICE + shippingUsd }
}
