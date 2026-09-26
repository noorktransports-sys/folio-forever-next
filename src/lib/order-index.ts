// src/lib/order-index.ts
//
// The admin order list, stored as ONE small KV key per order
// (`oi:<token>`) instead of one big shared array. Every writer touches
// only its own order's key, so two things happening at once (two orders,
// an order + a Square webhook) can never overwrite each other and make an
// order vanish from /admin.
//
// Older orders still live in the legacy `_orders_index_v1` array. Reads
// merge both (a per-order key always wins), and patching a legacy-only
// order simply creates its per-order key. Deletes write a small tombstone
// so the legacy copy stays hidden without rewriting the shared array.

export interface IndexKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>
  delete(key: string): Promise<void>
  list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; metadata?: unknown }>
    list_complete: boolean
    cursor?: string
  }>
}

export type IndexEntry = { token: string; deleted?: boolean; [k: string]: unknown }

export const LEGACY_INDEX_KEY = '_orders_index_v1'
const PREFIX = 'oi:'
const META_MAX = 1000 // KV metadata limit is 1024 bytes

const keyOf = (token: string) => `${PREFIX}${token}`

async function writeEntry(kv: IndexKV, entry: IndexEntry): Promise<void> {
  const json = JSON.stringify(entry)
  await kv.put(keyOf(entry.token), json, { metadata: json.length <= META_MAX ? entry : { token: entry.token, big: true } })
}

async function readLegacy(kv: IndexKV): Promise<IndexEntry[]> {
  try {
    const raw = await kv.get(LEGACY_INDEX_KEY)
    return raw ? (JSON.parse(raw) as IndexEntry[]) : []
  } catch {
    return []
  }
}

/** Read one order's index entry (per-order key first, then legacy). */
export async function getIndexEntry(kv: IndexKV, token: string): Promise<IndexEntry | null> {
  try {
    const raw = await kv.get(keyOf(token))
    if (raw) {
      const e = JSON.parse(raw) as IndexEntry
      return e.deleted ? null : e
    }
  } catch {
    /* fall through */
  }
  return (await readLegacy(kv)).find((e) => e.token === token) ?? null
}

/** Create / replace an order's index entry. */
export async function putIndexEntry(kv: IndexKV, entry: IndexEntry): Promise<void> {
  await writeEntry(kv, { ...entry, deleted: undefined })
}

/** Merge fields into an order's entry (creating it from the legacy list if needed). */
export async function patchIndexEntry(kv: IndexKV, token: string, patch: Record<string, unknown>): Promise<boolean> {
  const cur = await getIndexEntry(kv, token)
  if (!cur) return false
  const next: IndexEntry = { ...cur, ...patch, token }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  await writeEntry(kv, next)
  return true
}

/** Hide an order from the list for good (tombstone; legacy copy stays hidden). */
export async function removeIndexEntry(kv: IndexKV, token: string): Promise<void> {
  await writeEntry(kv, { token, deleted: true })
}

/** Every order, newest first (per-order keys merged over the legacy array). */
export async function readAllIndex(kv: IndexKV): Promise<IndexEntry[]> {
  const byToken = new Map<string, IndexEntry>()
  for (const e of await readLegacy(kv)) if (e && e.token) byToken.set(e.token, e)
  if (kv.list) {
    let cursor: string | undefined
    for (let page = 0; page < 50; page++) {
      const res = await kv.list({ prefix: PREFIX, limit: 1000, cursor })
      for (const k of res.keys) {
        let e = k.metadata as IndexEntry | undefined
        if (!e || (e as { big?: boolean }).big) {
          try {
            const raw = await kv.get(k.name)
            e = raw ? (JSON.parse(raw) as IndexEntry) : undefined
          } catch {
            e = undefined
          }
        }
        if (!e) continue
        const token = k.name.slice(PREFIX.length)
        if (e.deleted) byToken.delete(token)
        else byToken.set(token, { ...e, token })
      }
      if (res.list_complete || !res.cursor) break
      cursor = res.cursor
    }
  }
  return [...byToken.values()].sort((a, b) => String(b.submittedAt ?? '').localeCompare(String(a.submittedAt ?? '')))
}
