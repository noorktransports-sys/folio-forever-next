// src/lib/pricing.ts
//
// THE price list. Used by the album builder (to show prices) and by the
// SERVER (to decide what the customer pays). The server never trusts a
// price sent by the browser — it recomputes everything from the order's
// size / type / spread count / cover / polish / shipping choice.

import { getShipping } from './shipping'

export type AlbumSizeKey = '17x24' | '12x24' | '20x30' | '15x30'
export type AlbumTypeKey = 'standard' | 'layflat'
export type CoverTypeKey = 'photo' | 'leather' | 'acrylic'

export type AlbumTier = { base: number; perExtraSpread: number; minSpreads: number; maxSpreads: number }

/** Most spreads the printer can bind, per binding. Change here only —
 *  the designer, checkout price check and website all read this. */
export const MAX_SPREADS: Record<AlbumTypeKey, number> = { standard: 40, layflat: 40 }

export const ALBUM_PRICING: Record<AlbumSizeKey, Record<AlbumTypeKey, AlbumTier>> = {
  '17x24': {
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: MAX_SPREADS.standard },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: MAX_SPREADS.layflat },
  },
  '12x24': {
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: MAX_SPREADS.standard },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: MAX_SPREADS.layflat },
  },
  '20x30': {
    standard: { base: 340, perExtraSpread: 12, minSpreads: 10, maxSpreads: MAX_SPREADS.standard },
    layflat: { base: 375, perExtraSpread: 15, minSpreads: 10, maxSpreads: MAX_SPREADS.layflat },
  },
  '15x30': {
    standard: { base: 300, perExtraSpread: 15, minSpreads: 10, maxSpreads: MAX_SPREADS.standard },
    layflat: { base: 335, perExtraSpread: 18, minSpreads: 10, maxSpreads: MAX_SPREADS.layflat },
  },
}

/** Customer-facing binding names (printer terms in brackets for staff). */
export const BINDING_LABEL: Record<AlbumTypeKey, string> = { standard: 'Classic book', layflat: 'Lay-flat' }
export const BINDING_LABEL_STAFF: Record<AlbumTypeKey, string> = {
  standard: 'Classic book (standard hardcover)',
  layflat: 'Lay-flat (flush-mount)',
}

/** Cover add-on by style: photo included, leather +$25, acrylic +$39. */
export const COVER_PRICE: Record<CoverTypeKey, number> = { photo: 0, leather: 25, acrylic: 39 }

/** Design-team "polish hand-off" add-on. */
export const POLISH_PRICE = 99

export function isAlbumSize(v: unknown): v is AlbumSizeKey {
  return typeof v === 'string' && v in ALBUM_PRICING
}
export function isAlbumType(v: unknown): v is AlbumTypeKey {
  return v === 'standard' || v === 'layflat'
}

/** Album price (USD) for a size/type and number of spreads. */
export function computeAlbumPrice(size: AlbumSizeKey, type: AlbumTypeKey, spreads: number): number {
  const t = ALBUM_PRICING[size][type]
  const extra = Math.max(0, Math.round(spreads) - t.minSpreads)
  return t.base + extra * t.perExtraSpread
}

export type SmartQuote = {
  albumUsd: number
  coverUsd: number
  polishUsd: number
  shippingUsd: number
  shippingId: string
  totalUsd: number
  expectedCents: number
}

/**
 * Full server-side quote for a smart album order. Throws on anything the
 * price list doesn't know (unknown size, too many spreads, …) so a
 * tampered order is rejected instead of mis-priced.
 */
export function quoteSmartOrder(o: {
  size: unknown
  type: unknown
  spreads: number
  coverType?: unknown
  polish?: boolean
  shippingId?: unknown
}): SmartQuote {
  if (!isAlbumSize(o.size)) throw new Error('Unknown album size')
  if (!isAlbumType(o.type)) throw new Error('Unknown album type')
  const tier = ALBUM_PRICING[o.size][o.type]
  const spreads = Math.round(Number(o.spreads))
  if (!Number.isFinite(spreads) || spreads < 1) throw new Error('Album has no spreads')
  if (spreads > tier.maxSpreads) throw new Error(`Albums can have at most ${tier.maxSpreads} spreads`)
  const albumUsd = computeAlbumPrice(o.size, o.type, spreads)
  const coverUsd = o.coverType && typeof o.coverType === 'string' && o.coverType in COVER_PRICE ? COVER_PRICE[o.coverType as CoverTypeKey] : 0
  const polishUsd = o.polish ? POLISH_PRICE : 0
  const ship = getShipping(o.shippingId)
  const totalUsd = albumUsd + coverUsd + polishUsd + ship.usd
  return { albumUsd, coverUsd, polishUsd, shippingUsd: ship.usd, shippingId: ship.id, totalUsd, expectedCents: Math.round(totalUsd * 100) }
}

/** Marker the submit routes put on real orders. Saved drafts can never carry it. */
export const ORDER_SOURCE = 'submit-v2'
