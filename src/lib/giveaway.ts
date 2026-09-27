// src/lib/giveaway.ts
//
// Printed coupon cards 2026 — 100 single-use codes for 50% off the
// wedding magazine: a flat $35 instead of $70. Shipping is the couple's
// normal delivery choice. Codes work on the MAGAZINE checkout only (the
// album routes never read them), each code can be used once, and all
// codes stop working after Nov 25, 2026.
//
// KV keys (DESIGN_DRAFTS):
//   giveaway:<hash>  → { status: 'reserved' | 'used', token, orderId, at }

import { GIVEAWAY_CODE_HASHES, GIVEAWAY_DOLLAR_HASHES, GIVEAWAY_TEST_HASHES } from './giveaway-codes'

export const GIVEAWAY = {
  name: 'Coupon card · 50% off magazine',
  /** Codes stop working at the end of Nov 25 (US Pacific, PST). */
  endsAt: '2026-11-26T08:00:00Z',
  endsLabel: 'Nov 25, 2026',
  /** Flat magazine price with a code (normally $70). */
  magazineUsd: 35,
  offLabel: '50% off',
  /** A started-but-unpaid checkout holds the code this long. */
  holdMinutes: 60,
} as const

/** Owner's single-use $1 test code: the WHOLE magazine order (magazine +
 *  shipping) costs $1, so a real payment can be tested end to end. */
export const DOLLAR_TEST = {
  totalUsd: 1,
  endsAt: '2026-11-01T07:00:00Z',
  endsLabel: 'Oct 31, 2026',
  label: '$1 test order',
} as const

export interface GiveawayKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export type GiveawayHold = { status: 'reserved' | 'used'; token: string; orderId: string; at: string }

export type GiveawayCheck =
  | { ok: true; hash: string; test: boolean; dollar: boolean; display: string }
  | { ok: false; error: string }

/** "ff-hfghx g3k93" → "FFHFGHXG3K93" (case, spaces and dashes ignored). */
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32) : ''
}

/** "FFHFGHXG3K93" → "FF-HFGHX-G3K93" (for emails / admin). */
export function displayCode(norm: string): string {
  if (norm.startsWith('TEST') && norm.length === 12) return `TEST-${norm.slice(4, 8)}-${norm.slice(8)}`
  if (norm.startsWith('ONE') && norm.length === 11) return `ONE-${norm.slice(3, 7)}-${norm.slice(7)}`
  if (norm.startsWith('FF') && norm.length === 12) return `FF-${norm.slice(2, 7)}-${norm.slice(7)}`
  return norm
}

async function hashCode(norm: string): Promise<string> {
  const data = new TextEncoder().encode(`folioforever-giveaway-2026:${norm}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function giveawayOpen(now = Date.now()): boolean {
  return now < Date.parse(GIVEAWAY.endsAt)
}

/**
 * Is this code usable right now? `token` = the order about to use it (a
 * code held by that same order is fine). Does NOT reserve anything.
 */
export async function checkGiveawayCode(kv: GiveawayKV, raw: unknown, token?: string): Promise<GiveawayCheck> {
  const norm = normalizeCode(raw)
  if (norm.length < 8) return { ok: false, error: 'Please enter your coupon code.' }
  if (!giveawayOpen()) return { ok: false, error: `This coupon expired on ${GIVEAWAY.endsLabel} and can no longer be used.` }
  const hash = await hashCode(norm)
  const test = GIVEAWAY_TEST_HASHES.includes(hash)
  const dollar = GIVEAWAY_DOLLAR_HASHES.includes(hash)
  if (!test && !dollar && !GIVEAWAY_CODE_HASHES.includes(hash)) {
    return { ok: false, error: 'That code isn’t valid. Please check the letters and numbers and try again.' }
  }
  if (dollar && Date.now() >= Date.parse(DOLLAR_TEST.endsAt)) {
    return { ok: false, error: `This test code expired on ${DOLLAR_TEST.endsLabel}.` }
  }
  const display = displayCode(norm)
  if (test) return { ok: true, hash, test, dollar: false, display }
  const held = await kv.get(`giveaway:${hash}`)
  if (held) {
    let h: GiveawayHold | null = null
    try {
      h = JSON.parse(held) as GiveawayHold
    } catch {
      h = null
    }
    if (h && h.token !== token) {
      if (h.status === 'used') return { ok: false, error: 'This coupon code has already been used for a magazine order.' }
      const age = Date.now() - Date.parse(h.at)
      if (age < GIVEAWAY.holdMinutes * 60_000) {
        return { ok: false, error: 'This code is in use in another checkout right now. If that was you, finish that payment — or try again in an hour.' }
      }
    }
  }
  return { ok: true, hash, test, dollar, display }
}

/** Hold the code for an unpaid order (released automatically after holdMinutes). */
export async function reserveGiveawayCode(kv: GiveawayKV, hash: string, token: string, orderId: string): Promise<void> {
  const v: GiveawayHold = { status: 'reserved', token, orderId, at: new Date().toISOString() }
  await kv.put(`giveaway:${hash}`, JSON.stringify(v))
}

/**
 * Called when the $12 is paid. Returns the order that ALREADY used the
 * code if a different order got there first (owner should refund one).
 */
export async function markGiveawayCodeUsed(kv: GiveawayKV, hash: string, token: string, orderId: string): Promise<string | null> {
  const prev = await kv.get(`giveaway:${hash}`)
  if (prev) {
    try {
      const h = JSON.parse(prev) as GiveawayHold
      if (h.status === 'used' && h.token !== token) return h.orderId
    } catch {
      /* overwrite a corrupt record */
    }
  }
  const v: GiveawayHold = { status: 'used', token, orderId, at: new Date().toISOString() }
  await kv.put(`giveaway:${hash}`, JSON.stringify(v))
  return null
}
