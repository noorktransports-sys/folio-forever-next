// src/app/design/smart/brief.ts
//
// Album brief + "smart" helpers for the album designer (Phase 1):
//   • AlbumBrief — the 4 quick answers the client gives before upload
//   • detectSessions — groups photos into days / sessions from their
//     capture time so chapters (Mehndi, Nikkah, …) can be set in one tap
//   • recommendSpreads — Essential / Recommended / Complete page counts
//
// Pure functions only (no React), so they can be unit-tested.

import type { EventId } from '@/lib/smart-layout/templates'

export type PhotoMix = 'couple' | 'balanced' | 'family'
export type AlbumFeel = 'airy' | 'balanced' | 'full'

export type AlbumBrief = {
  /** Events the wedding had, in order. Each becomes a chapter. */
  events: EventId[]
  mix: PhotoMix
  feel: AlbumFeel
  /** Rough number of photos the client wants in the album. */
  photoGoal: number
}

export const DEFAULT_BRIEF: AlbumBrief = {
  events: [],
  mix: 'balanced',
  feel: 'balanced',
  photoGoal: 100,
}

/** Average photos per spread for each feel. */
export const PHOTOS_PER_SPREAD: Record<AlbumFeel, number> = {
  airy: 2.5,
  balanced: 4,
  full: 6,
}

export const FEEL_INFO: Record<AlbumFeel, { title: string; desc: string; range: string }> = {
  airy: { title: 'Airy & luxurious', desc: 'Big photos, lots of full-page features.', range: '1–3 photos per spread' },
  balanced: { title: 'Balanced', desc: 'A mix of big moments and small stories.', range: '3–5 photos per spread' },
  full: { title: 'Full story', desc: 'More photos per page so nobody is left out.', range: '5–8 photos per spread' },
}

export const MIX_INFO: Record<PhotoMix, { title: string; desc: string }> = {
  couple: { title: 'Mostly the couple', desc: 'Portraits of the two of you.' },
  balanced: { title: 'A balanced mix', desc: 'Couple, family, details and the party.' },
  family: { title: 'Lots of family & guests', desc: 'Groups, relatives and friends.' },
}

/** The feel we suggest for a photo mix (client can change it). */
export function suggestedFeel(mix: PhotoMix): AlbumFeel {
  return mix === 'couple' ? 'airy' : mix === 'family' ? 'full' : 'balanced'
}

export const PHOTO_GOALS = [50, 100, 200, 300] as const

/* ───────────────────────── sessions / chapters ───────────────────────── */

export type SessionPhoto = { id: string; capturedAt?: number }

export type Session = {
  /** Stable key for React lists. */
  key: string
  photoIds: string[]
  /** First / last capture time (ms). Undefined for the "no date" group. */
  start?: number
  end?: number
}

/** Capture times are the CAMERA's clock stored as UTC ms (see lib/exif),
 *  so dates and times are always read back in UTC — never shifted into
 *  the viewer's time zone. */
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** A new session starts after this much time with no photos. */
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000
/** Sessions smaller than this are merged into their nearest neighbour. */
const MIN_SESSION = 3

/**
 * Split photos into sessions (usually one per event) using capture time.
 * A gap of 3+ hours, or a new calendar day, starts a new session. Tiny
 * sessions (a stray photo or two) are merged into the closest neighbour.
 * Photos without a capture time go into a final "no date" session.
 */
export function detectSessions(photos: SessionPhoto[]): Session[] {
  const dated = photos.filter((p) => typeof p.capturedAt === 'number').sort((a, b) => a.capturedAt! - b.capturedAt!)
  const undated = photos.filter((p) => typeof p.capturedAt !== 'number')

  const groups: SessionPhoto[][] = []
  for (const p of dated) {
    const cur = groups[groups.length - 1]
    const prev = cur?.[cur.length - 1]
    const newDay = prev && dayKey(prev.capturedAt!) !== dayKey(p.capturedAt!)
    if (!cur || p.capturedAt! - prev!.capturedAt! >= SESSION_GAP_MS || newDay) groups.push([p])
    else cur.push(p)
  }

  // Merge tiny groups into whichever neighbour is closer in time.
  let changed = true
  while (changed && groups.length > 1) {
    changed = false
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].length >= MIN_SESSION) continue
      const g = groups[i]
      const before = i > 0 ? g[0].capturedAt! - groups[i - 1][groups[i - 1].length - 1].capturedAt! : Infinity
      const after = i < groups.length - 1 ? groups[i + 1][0].capturedAt! - g[g.length - 1].capturedAt! : Infinity
      if (before <= after) groups[i - 1].push(...g)
      else groups[i + 1].unshift(...g)
      groups.splice(i, 1)
      changed = true
      break
    }
  }

  const sessions: Session[] = groups.map((g) => ({
    key: `s-${g[0].capturedAt}`,
    photoIds: g.map((p) => p.id),
    start: g[0].capturedAt,
    end: g[g.length - 1].capturedAt,
  }))
  if (undated.length > 0) sessions.push({ key: 'no-date', photoIds: undated.map((p) => p.id) })
  return sessions
}

/**
 * Default event for each session, in order. When there are as many
 * sessions as chosen events they map 1:1; with more sessions the extra
 * ones continue the last event; with fewer, later events go unused.
 * The "no date" session gets the last event (client can change it).
 */
export function defaultSessionEvents(sessions: Session[], events: EventId[]): EventId[] {
  const evs: EventId[] = events.length > 0 ? events : ['wedding']
  const dated = sessions.filter((s) => s.start !== undefined)
  return sessions.map((s) => {
    if (s.start === undefined) return evs[evs.length - 1]
    const i = dated.indexOf(s)
    if (dated.length <= evs.length) return evs[i]
    // More sessions than events: spread the events across the sessions in order.
    return evs[Math.min(evs.length - 1, Math.floor((i * evs.length) / dated.length))]
  })
}

/** "Sat, Sep 12 · 4:10–9:45 PM" style label for a session. */
export function sessionLabel(s: Session): string {
  if (s.start === undefined) return 'Photos without a date'
  const d = new Date(s.start)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const t = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  return `${day} · ${t(s.start)}–${t(s.end ?? s.start)}`
}

/* ───────────────────────── page recommendation ───────────────────────── */

export type SpreadOption = {
  id: 'essential' | 'recommended' | 'complete'
  title: string
  spreads: number
  /** Average photos per spread at this length. */
  perSpread: number
  note: string
}

/**
 * Three album lengths for this many photos. Recommended follows the
 * chosen feel; Essential packs tighter; Complete gives more room. Each
 * chapter needs at least one spread. All clamped to [min, max] and
 * kept distinct where the range allows.
 */
export function recommendSpreads(
  photoCount: number,
  feel: AlbumFeel,
  chapters: number,
  min: number,
  max: number,
): SpreadOption[] {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)))
  const per = PHOTOS_PER_SPREAD[feel]
  const floor = Math.max(min, chapters)
  let rec = clamp(Math.max(floor, Math.ceil(photoCount / per)))
  let ess = clamp(Math.max(floor, Math.ceil(photoCount / (per * 1.6))))
  let com = clamp(Math.max(floor, Math.ceil(photoCount / (per * 0.65))))
  // Keep the three options distinct when there is room to.
  if (ess >= rec) ess = Math.max(min, rec - Math.max(2, Math.round(rec * 0.25)))
  if (com <= rec) com = Math.min(max, rec + Math.max(2, Math.round(rec * 0.3)))
  if (ess === rec && rec > min) ess = rec - 1
  if (com === rec && rec < max) com = rec + 1
  const perOf = (n: number) => Math.round((photoCount / Math.max(1, n)) * 10) / 10
  const all: SpreadOption[] = [
    { id: 'essential', title: 'Essential', spreads: ess, perSpread: perOf(ess), note: 'Tighter pages, lower price' },
    { id: 'recommended', title: 'Recommended', spreads: rec, perSpread: perOf(rec), note: 'The best balance for your photos' },
    { id: 'complete', title: 'Complete', spreads: com, perSpread: perOf(com), note: 'Room for every favorite, bigger photos' },
  ]
  // Near the size limits two options can land on the same length — show
  // each length once (Recommended wins a tie).
  return all.filter((o) => o.id === 'recommended' || o.spreads !== rec)
}

/** Photos that won't fit comfortably (beyond 8 per spread). */
export function photosOverflow(photoCount: number, spreads: number): number {
  return Math.max(0, photoCount - spreads * 8)
}

/** Spreads needed to place `unused` photos at the chosen feel. */
export function spreadsForUnused(unused: number, feel: AlbumFeel): number {
  return Math.max(1, Math.ceil(unused / PHOTOS_PER_SPREAD[feel]))
}
