// src/lib/order-junk.ts
//
// "Junk folder" for admin orders + permanent delete.
//
//   • An order is moved to Junk by a flag (`junk: true`, `junkAt`) on BOTH
//     the order record (KV key = token) and its `_orders_index_v1` entry.
//     Status is untouched, so history/revenue stay correct.
//   • Auto-junk: marking an order "In production" (sent to print) and
//     unpaid orders older than 30 days.
//   • Delete forever (Junk only): removes the order record, the order's
//     files in R2 (print pages, uploaded photos, previews, cover) and its
//     index entry. Leaves a small `deleted_order:{orderId}` record (shown in
//     the audit log) + a summary in `_orders_deleted_v1` so revenue totals
//     still add up. Legal consent records (proof_approval:/content_rights:)
//     are kept.

import { readAllIndex, patchIndexEntry, removeIndexEntry, type IndexKV } from './order-index'

export type JunkKV = IndexKV
export interface JunkR2 {
  delete(keys: string | string[]): Promise<void>
}

export const ORDERS_INDEX_KEY = '_orders_index_v1'
export const DELETED_INDEX_KEY = '_orders_deleted_v1'
/** Paid orders may only be deleted forever once they're finished. */
const DELETABLE_WHEN_PAID = new Set(['delivered', 'refunded', 'cancelled'])
/** Unpaid orders older than this go to Junk automatically. */
export const STALE_UNPAID_DAYS = 30

type IndexEntry = { token: string; junk?: boolean; junkAt?: string; [k: string]: unknown }
type HistoryEntry = { status: string; at: string; by: 'admin' | 'system'; note?: string }

export type DeletedSummary = {
  token: string
  orderId: string
  customerName?: string
  customerEmail?: string
  totalPrice?: number
  status?: string
  paidAt?: string
  submittedAt?: string
  mode?: string
  size?: string
  deletedAt: string
}

export async function readIndex(kv: JunkKV): Promise<IndexEntry[]> {
  try {
    return (await readAllIndex(kv)) as IndexEntry[]
  } catch {
    return []
  }
}

export async function readDeleted(kv: Pick<JunkKV, 'get'>): Promise<DeletedSummary[]> {
  try {
    const raw = await kv.get(DELETED_INDEX_KEY)
    return raw ? (JSON.parse(raw) as DeletedSummary[]) : []
  } catch {
    return []
  }
}

/** Set/clear the junk flag on one order RECORD (not the index). */
export async function flagRecord(kv: JunkKV, token: string, junk: boolean, note: string, by: 'admin' | 'system'): Promise<boolean> {
  const raw = await kv.get(token)
  if (!raw) return false
  let rec: { junk?: boolean; junkAt?: string; statusHistory?: HistoryEntry[]; status?: string; [k: string]: unknown }
  try {
    rec = JSON.parse(raw)
  } catch {
    return false
  }
  if (!!rec.junk === junk) return true
  const at = new Date().toISOString()
  rec.junk = junk
  if (junk) rec.junkAt = at
  else delete rec.junkAt
  const hist = Array.isArray(rec.statusHistory) ? rec.statusHistory : []
  hist.push({ status: rec.status ?? 'submitted', at, by, note })
  rec.statusHistory = hist
  await kv.put(token, JSON.stringify(rec))
  return true
}

/** Move orders to / out of Junk (records + index, index written once). */
export async function setJunk(
  kv: JunkKV,
  tokens: string[],
  junk: boolean,
  opts: { note?: string; by?: 'admin' | 'system' } = {},
): Promise<number> {
  const by = opts.by ?? 'admin'
  const note = opts.note ?? (junk ? 'Moved to Junk' : 'Restored from Junk')
  let n = 0
  const at = new Date().toISOString()
  for (const t of tokens) {
    if (await flagRecord(kv, t, junk, note, by)) n++
    await patchIndexEntry(kv, t, junk ? { junk: true, junkAt: at } : { junk: false, junkAt: undefined })
  }
  return n
}

/** Every R2 key (designs/…) referenced anywhere inside an order record. */
export function collectR2Keys(record: unknown): string[] {
  const keys = new Set<string>()
  const re = /(?:^|\/api\/photo\/)(designs\/[A-Za-z0-9._\-/]+)/
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || v == null) return
    if (typeof v === 'string') {
      const m = v.match(re)
      if (m && !m[1].includes('..')) keys.add(m[1])
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    if (typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1)
  }
  walk(record, 0)
  return [...keys]
}

/**
 * Permanently delete Junk orders. Only orders flagged junk in the index
 * are touched. Processes at most `max` per call (edge sub-request limits);
 * the caller repeats while `remaining > 0`.
 */
export async function deleteJunkOrders(
  kv: JunkKV,
  r2: JunkR2 | undefined,
  tokens: string[] | 'all',
  max = 20,
): Promise<{ deleted: number; files: number; remaining: number; skipped: number }> {
  const list = await readIndex(kv)
  // Only Junk orders, and never a PAID order that isn't finished yet
  // (e.g. sent to print but not delivered) — its print files may still
  // be needed for a reprint.
  const deletable = (e: IndexEntry) =>
    !!e.junk && (!e.paidAt || DELETABLE_WHEN_PAID.has(String(e.status ?? '')))
  const junkTokens = new Set(list.filter(deletable).map((e) => e.token))
  const inJunk = list.filter((e) => e.junk).length
  const targets = (tokens === 'all' ? [...junkTokens] : tokens.filter((t) => junkTokens.has(t)))
  const skipped = tokens === 'all' ? inJunk - targets.length : tokens.length - targets.length
  const batch = targets.slice(0, max)
  const deletedSummaries: DeletedSummary[] = []
  const gone = new Set<string>()
  let files = 0
  const now = new Date().toISOString()

  for (const token of batch) {
    const entry = list.find((e) => e.token === token) as (IndexEntry & Record<string, unknown>) | undefined
    const raw = await kv.get(token)
    let rec: Record<string, unknown> | null = null
    try {
      rec = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    } catch {
      rec = null
    }
    // 1 — files
    if (rec && r2) {
      const keys = collectR2Keys(rec)
      for (let i = 0; i < keys.length; i += 900) {
        await r2.delete(keys.slice(i, i + 900))
      }
      files += keys.length
    }
    // 2 — tombstone (audit log + revenue history)
    const cust = (rec?.customer ?? {}) as { name?: string; email?: string }
    const album = (rec?.album ?? {}) as { totalPrice?: number; size?: string }
    const orderId = String(rec?.orderId ?? entry?.orderId ?? token)
    const summary: DeletedSummary = {
      token,
      orderId,
      customerName: cust.name ?? (entry?.customerName as string | undefined),
      customerEmail: cust.email ?? (entry?.customerEmail as string | undefined),
      totalPrice: Number(entry?.totalPrice ?? album.totalPrice ?? entry?.amountPaid ?? 0) || 0,
      status: String(rec?.status ?? entry?.status ?? ''),
      paidAt: (rec?.paidAt ?? entry?.paidAt) as string | undefined,
      submittedAt: (rec?.submittedAt ?? entry?.submittedAt) as string | undefined,
      mode: (rec?.mode ?? entry?.mode) as string | undefined,
      size: (entry?.size as string | undefined) ?? album.size,
      deletedAt: now,
    }
    await kv.put(`deleted_order:${orderId}`, JSON.stringify({ ...summary, at: now, serverReceivedAt: now, filesDeleted: rec ? collectR2Keys(rec).length : 0 }))
    deletedSummaries.push(summary)
    // 3 — the order record itself
    await kv.delete(token)
    gone.add(token)
  }

  if (gone.size) {
    for (const t of gone) await removeIndexEntry(kv, t)
    const del = await readDeleted(kv)
    await kv.put(DELETED_INDEX_KEY, JSON.stringify([...deletedSummaries, ...del].slice(0, 5000)))
  }
  return { deleted: gone.size, files, remaining: Math.max(0, targets.length - batch.length), skipped }
}

/** Unpaid (pending payment) orders older than STALE_UNPAID_DAYS, not yet in Junk. */
export function staleUnpaidTokens(list: Array<{ token: string; status?: string; submittedAt?: string; junk?: boolean }>): string[] {
  const cutoff = Date.now() - STALE_UNPAID_DAYS * 24 * 60 * 60 * 1000
  return list
    .filter((o) => !o.junk && o.status === 'pending_payment' && o.submittedAt && new Date(o.submittedAt).getTime() < cutoff)
    .map((o) => o.token)
}
