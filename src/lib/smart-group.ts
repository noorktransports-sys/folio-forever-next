/**
 * Smart event grouping — turns a flat dump of wedding photos into the
 * right ceremony buckets without the client having to tag every one.
 *
 * Two signals, used together when available:
 *   1. Folder name (when uploaded via webkitdirectory) — fuzzy-match
 *      common ceremony names to our EventId list.
 *   2. EXIF capture time — split photos at large gaps (default 6 h)
 *      and walk the next-available EventId across clusters in order.
 */

export type EventId =
  | 'unassigned'
  | 'mehndi'
  | 'haldi'
  | 'prep'
  | 'nikkah'
  | 'wedding'
  | 'reception'
  | 'valima'
  | 'other1'
  | 'other2'

// Default progression we hand out to clusters when no folder names map.
// Matches the chronological order most South-Asian weddings follow.
const EVENT_ORDER: EventId[] = [
  'mehndi',
  'haldi',
  'prep',
  'nikkah',
  'wedding',
  'reception',
  'valima',
  'other1',
  'other2',
]

/** Fuzzy-match a folder / sub-folder name to one of our event ids. */
export function folderNameToEvent(name: string | null | undefined): EventId | null {
  if (!name) return null
  const s = name.toLowerCase()
  const has = (kw: string) => s.includes(kw)
  if (has('mehndi') || has('henna') || has('mehendi') || has('mehandi')) return 'mehndi'
  if (has('haldi') || has('manjha') || has('manjh')) return 'haldi'
  if (
    has('prep') ||
    has('getting ready') ||
    has('getting-ready') ||
    has('gettingready') ||
    has('bride ready') ||
    has('groom ready') ||
    has('preparation')
  )
    return 'prep'
  if (has('nikkah') || has('nikah') || has('nikaah')) return 'nikkah'
  if (
    has('wedding') ||
    has('shaadi') ||
    has('barat') ||
    has('baraat') ||
    has('rukhsati') ||
    has('jaimala') ||
    has('phera')
  )
    return 'wedding'
  if (has('reception') || has('engagement') || has('rasm')) return 'reception'
  if (has('valima') || has('walima')) return 'valima'
  return null
}

/**
 * Sub-folder names from a webkitRelativePath like
 * "Wedding/Mehndi/IMG_0001.jpg" — used by folderNameToEvent. We try the
 * deepest sub-folder first, then walk back toward the root.
 */
export function pathToEvent(relativePath: string | undefined): EventId | null {
  if (!relativePath) return null
  const parts = relativePath.split('/').slice(0, -1).reverse()
  for (const p of parts) {
    const m = folderNameToEvent(p)
    if (m) return m
  }
  return null
}

/** Photos sortable by EXIF date for the cluster pass. */
interface ChronoPhoto {
  id: string
  capturedAt?: number
}

/**
 * Cluster a flat photo list into event buckets by EXIF time gaps.
 * Photos within `gapHours` of each other belong to the same event;
 * a larger gap starts a new cluster. Returns a map photoId → EventId.
 *
 * Only photos in `photos` that have `capturedAt` participate; the rest
 * are left for the caller to handle (typically: keep their existing
 * tag, or leave as 'unassigned'). Each new cluster takes the next slot
 * from EVENT_ORDER, skipping any `usedHints` already assigned via
 * folder names — so folder + time-gap can be combined cleanly.
 */
export function clusterByTimeGaps(
  photos: ChronoPhoto[],
  gapHours = 6,
  usedHints: Set<EventId> = new Set(),
): Map<string, EventId> {
  const result = new Map<string, EventId>()
  const withTime = photos
    .filter((p) => typeof p.capturedAt === 'number')
    .slice()
    .sort((a, b) => (a.capturedAt as number) - (b.capturedAt as number))
  if (withTime.length === 0) return result

  const gapMs = gapHours * 60 * 60 * 1000
  // Build clusters.
  const clusters: string[][] = []
  let current: string[] = []
  let lastT = -Infinity
  for (const p of withTime) {
    const t = p.capturedAt as number
    if (current.length === 0 || t - lastT <= gapMs) {
      current.push(p.id)
    } else {
      clusters.push(current)
      current = [p.id]
    }
    lastT = t
  }
  if (current.length) clusters.push(current)

  // Walk EVENT_ORDER, handing out the next free event id to each cluster.
  let cursor = 0
  for (const c of clusters) {
    while (cursor < EVENT_ORDER.length && usedHints.has(EVENT_ORDER[cursor])) {
      cursor++
    }
    const eid = EVENT_ORDER[cursor] ?? 'other2'
    for (const id of c) result.set(id, eid)
    cursor++
  }
  return result
}
