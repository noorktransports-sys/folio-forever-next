// src/lib/shipping.ts
//
// Delivery options offered at checkout (magazine + albums). Prices live
// HERE and the SERVER re-reads them from the chosen id — the client never
// decides the amount.

export type ShippingId = 'express' | 'standard' | 'economy'

export type ShippingOption = {
  id: ShippingId
  label: string
  days: string
  usd: number
}

export const SHIPPING_OPTIONS: ShippingOption[] = [
  { id: 'express', label: 'Express', days: '5–7 days', usd: 60 },
  { id: 'standard', label: 'Standard', days: '7–10 days', usd: 32 },
  { id: 'economy', label: 'Economy', days: '15–18 days', usd: 12 },
]

export const DEFAULT_SHIPPING: ShippingId = 'standard'

/** Look up an option by id; unknown / missing ids fall back to the default. */
export function getShipping(id: unknown): ShippingOption {
  return SHIPPING_OPTIONS.find((o) => o.id === id) ?? SHIPPING_OPTIONS.find((o) => o.id === DEFAULT_SHIPPING)!
}

/** "Standard · 7–10 days" */
export function shippingText(o: { label: string; days: string }): string {
  return `${o.label} · ${o.days}`
}
