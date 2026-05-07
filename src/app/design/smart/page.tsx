'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'

export const runtime = 'edge'

// ============== CONSTANTS ==============

const GOLD = '#b8965a'
const HERO_MIN_PX = 3000
const PHOTO_CAP = 100
const HERO_CAP = 8
const FAV_CAP = 30

// ============== TYPES ==============

type AlbumSize = '17x24' | '20x30'
type AlbumType = 'standard' | 'layflat'

type EventId = 'prep' | 'ceremony' | 'portraits' | 'reception' | 'other'
type EventDef = { id: EventId; name: string }

const EVENTS: EventDef[] = [
  { id: 'prep', name: 'Getting Ready' },
  { id: 'ceremony', name: 'Ceremony' },
  { id: 'portraits', name: 'Portraits' },
  { id: 'reception', name: 'Reception' },
  { id: 'other', name: 'Other' },
]

type Photo = {
  id: string
  preview: string
  width: number
  height: number
  tagged: 'hero' | 'favorite' | 'none'
  eventId: EventId
  blurry: boolean
}

type Step =
  | 'setup'
  | 'guidance'
  | 'upload'
  | 'group'
  | 'tag'
  | 'pages'
  | 'generate'
  | 'adjust'
  | 'submit'

// Slots are positioned in % within the SPREAD (not per-page).
// A standard template's slots respect the gutter at x=50: no slot
// straddles 50%. A layflat template can have slots that cross 50%.
type Slot = { x: number; y: number; w: number; h: number; isHero?: boolean }

type LayoutTemplate = {
  id: string
  name: string
  slots: Slot[]
  // Which album types this template can be used with.
  compat: AlbumType[]
}

type Spread = {
  id: string
  templateId: string
  photoIds: string[]
  eventId: EventId
}

// ============== ALBUM SPECS (pricing + dimensions) ==============

const ALBUM_SPECS: Record<
  AlbumSize,
  Record<AlbumType, { base: number; perExtraSpread: number; minSpreads: number; maxSpreads: number }> & {
    spreadAspectRatio: number
    label: string
  }
> = {
  '17x24': {
    spreadAspectRatio: 24 / 17, // landscape spread (open book = 24w × 17h)
    label: '17×24',
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: 25 },
  },
  '20x30': {
    spreadAspectRatio: 30 / 20,
    label: '20×30',
    standard: { base: 340, perExtraSpread: 12, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 375, perExtraSpread: 15, minSpreads: 10, maxSpreads: 25 },
  },
}

function computePrice(size: AlbumSize, type: AlbumType, spreads: number): number {
  const spec = ALBUM_SPECS[size][type]
  const extra = Math.max(0, spreads - spec.minSpreads)
  return spec.base + extra * spec.perExtraSpread
}

// ============== LAYOUT TEMPLATES ==============
// Coordinates are in % within the spread (0-100 horizontal, 0-100 vertical).
// For standard albums, no slot crosses x=50 (the gutter).
// For layflat, slots may cross x=50 freely.

const TEMPLATES: LayoutTemplate[] = [
  // ---- STANDARD + LAYFLAT (gutter-respecting; usable in both) ----
  {
    id: 'hero-1r',
    name: 'Hero · Solo right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 92, isHero: true },
      { x: 52, y: 4, w: 46, h: 92 },
    ],
  },
  {
    id: 'hero-2r',
    name: 'Hero · Pair right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 92, isHero: true },
      { x: 52, y: 4, w: 46, h: 44 },
      { x: 52, y: 52, w: 46, h: 44 },
    ],
  },
  {
    id: 'hero-3r',
    name: 'Hero · Trio right',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 92, isHero: true },
      { x: 52, y: 4, w: 46, h: 28 },
      { x: 52, y: 36, w: 46, h: 28 },
      { x: 52, y: 68, w: 46, h: 28 },
    ],
  },
  {
    id: 'hero-1l',
    name: 'Hero · Solo left',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 92 },
      { x: 52, y: 4, w: 46, h: 92, isHero: true },
    ],
  },
  {
    id: 'pair',
    name: '2 photos',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 92 },
      { x: 52, y: 4, w: 46, h: 92 },
    ],
  },
  {
    id: 'pair-pair',
    name: '4 photos · 2+2',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 44 },
      { x: 2, y: 52, w: 46, h: 44 },
      { x: 52, y: 4, w: 46, h: 44 },
      { x: 52, y: 52, w: 46, h: 44 },
    ],
  },
  {
    id: 'trio-pair',
    name: '5 photos · 3+2',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 28 },
      { x: 2, y: 36, w: 46, h: 28 },
      { x: 2, y: 68, w: 46, h: 28 },
      { x: 52, y: 4, w: 46, h: 44 },
      { x: 52, y: 52, w: 46, h: 44 },
    ],
  },
  {
    id: 'trio-trio',
    name: '6 photos · 3+3',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 46, h: 28 },
      { x: 2, y: 36, w: 46, h: 28 },
      { x: 2, y: 68, w: 46, h: 28 },
      { x: 52, y: 4, w: 46, h: 28 },
      { x: 52, y: 36, w: 46, h: 28 },
      { x: 52, y: 68, w: 46, h: 28 },
    ],
  },
  {
    id: 'quad-trio',
    name: '7 photos · 4+3',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 22, h: 44 },
      { x: 26, y: 4, w: 22, h: 44 },
      { x: 2, y: 52, w: 22, h: 44 },
      { x: 26, y: 52, w: 22, h: 44 },
      { x: 52, y: 4, w: 46, h: 28 },
      { x: 52, y: 36, w: 46, h: 28 },
      { x: 52, y: 68, w: 46, h: 28 },
    ],
  },
  {
    id: 'quad-quad',
    name: '8 photos · 4+4',
    compat: ['standard', 'layflat'],
    slots: [
      { x: 2, y: 4, w: 22, h: 44 },
      { x: 26, y: 4, w: 22, h: 44 },
      { x: 2, y: 52, w: 22, h: 44 },
      { x: 26, y: 52, w: 22, h: 44 },
      { x: 52, y: 4, w: 22, h: 44 },
      { x: 76, y: 4, w: 22, h: 44 },
      { x: 52, y: 52, w: 22, h: 44 },
      { x: 76, y: 52, w: 22, h: 44 },
    ],
  },
  // ---- LAYFLAT-ONLY (image crosses gutter) ----
  {
    id: 'panorama',
    name: 'Panorama · full bleed',
    compat: ['layflat'],
    slots: [{ x: 0, y: 0, w: 100, h: 100, isHero: true }],
  },
  {
    id: 'hero-wide-1',
    name: 'Hero spans gutter · 1 accent',
    compat: ['layflat'],
    slots: [
      { x: 0, y: 0, w: 70, h: 100, isHero: true },
      { x: 72, y: 4, w: 26, h: 92 },
    ],
  },
  {
    id: 'hero-wide-3',
    name: 'Hero spans gutter · 3 accent',
    compat: ['layflat'],
    slots: [
      { x: 0, y: 0, w: 70, h: 100, isHero: true },
      { x: 72, y: 4, w: 26, h: 28 },
      { x: 72, y: 36, w: 26, h: 28 },
      { x: 72, y: 68, w: 26, h: 28 },
    ],
  },
]

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t] as const))

function templatesForCount(count: number, type: AlbumType): LayoutTemplate[] {
  return TEMPLATES.filter((t) => t.compat.includes(type) && t.slots.length === count)
}

// ============== LAYOUT ENGINE ==============
// Place ALL non-blurry photos across `pageCount` spreads, prioritizing
// heroes (they get the isHero slot in a layout) and favorites (they go
// in lower-density spreads first, more prominent placement).

function generateLayout(photos: Photo[], pageCount: number, type: AlbumType): Spread[] {
  const useable = photos.filter((p) => !p.blurry)
  if (useable.length === 0) return []

  // Photos per spread is bounded by available templates (1–8 above).
  // Distribute photos roughly evenly across spreads, hero-bearing
  // spreads get smaller counts (more prominence).
  const perSpreadAvg = Math.max(1, Math.min(8, Math.ceil(useable.length / pageCount)))

  // Order events: prep → ceremony → portraits → reception → other
  const eventOrder: EventId[] = ['prep', 'ceremony', 'portraits', 'reception', 'other']

  // Priority queues per event
  const eventBuckets = eventOrder.map((eid) => ({
    eid,
    heroes: useable.filter((p) => p.eventId === eid && p.tagged === 'hero'),
    favorites: useable.filter((p) => p.eventId === eid && p.tagged === 'favorite'),
    others: useable.filter((p) => p.eventId === eid && p.tagged === 'none'),
  }))

  const spreads: Spread[] = []
  let idx = 0

  for (const bucket of eventBuckets) {
    if (spreads.length >= pageCount) break

    // Hero spreads: each hero gets a "hero · pair right" or similar
    // template with the hero in the isHero slot. Filler photos come
    // from this event's favorites/others (or borrow from later events
    // if this one runs out of fillers).
    while (bucket.heroes.length > 0 && spreads.length < pageCount) {
      const hero = bucket.heroes.shift()!
      const heroFillerCount = Math.min(
        perSpreadAvg - 1,
        bucket.favorites.length + bucket.others.length,
      )
      const fillers: Photo[] = []
      // Prefer favorites for hero spreads
      while (fillers.length < heroFillerCount && bucket.favorites.length > 0) {
        fillers.push(bucket.favorites.shift()!)
      }
      while (fillers.length < heroFillerCount && bucket.others.length > 0) {
        fillers.push(bucket.others.shift()!)
      }
      const totalCount = 1 + fillers.length
      const candidates = TEMPLATES.filter(
        (t) =>
          t.compat.includes(type) &&
          t.slots.length === totalCount &&
          t.slots.some((s) => s.isHero),
      )
      const tpl = candidates[0] ?? TEMPLATES.find((t) => t.compat.includes(type) && t.slots.length === 2 && t.slots.some((s) => s.isHero))!
      const photoIds = [hero.id, ...fillers.map((f) => f.id)]
      spreads.push({ id: `s-${idx++}`, templateId: tpl.id, photoIds, eventId: bucket.eid })
    }
  }

  // Now distribute remaining favorites + others across remaining spreads.
  // We respect event order roughly by interleaving from each bucket.
  const remaining: Photo[] = []
  for (const eid of eventOrder) {
    const bucket = eventBuckets.find((b) => b.eid === eid)!
    remaining.push(...bucket.favorites, ...bucket.others)
  }

  while (remaining.length > 0 && spreads.length < pageCount) {
    // Decide spread size: keep all spreads roughly equal so all photos fit.
    const remainingSpreads = pageCount - spreads.length
    const idealCount = Math.max(1, Math.min(8, Math.ceil(remaining.length / remainingSpreads)))
    const take = Math.min(idealCount, remaining.length)
    const chunk = remaining.splice(0, take)
    const eventId = chunk[0].eventId
    const candidates = TEMPLATES.filter(
      (t) => t.compat.includes(type) && t.slots.length === take && !t.slots.some((s) => s.isHero),
    )
    const fallback =
      candidates[0] ??
      TEMPLATES.filter((t) => t.compat.includes(type) && t.slots.length >= take).sort(
        (a, b) => a.slots.length - b.slots.length,
      )[0]
    const tpl = fallback ?? TEMPLATES.find((t) => t.compat.includes(type))!
    spreads.push({
      id: `s-${idx++}`,
      templateId: tpl.id,
      photoIds: chunk.slice(0, tpl.slots.length).map((p) => p.id),
      eventId,
    })
  }

  // If photos remain but we ran out of spreads, append them to the last
  // spread by swapping to a larger template if available.
  if (remaining.length > 0 && spreads.length > 0) {
    const last = spreads[spreads.length - 1]
    const newCount = Math.min(8, last.photoIds.length + remaining.length)
    const candidates = TEMPLATES.filter(
      (t) => t.compat.includes(type) && t.slots.length === newCount && !t.slots.some((s) => s.isHero),
    )
    if (candidates[0]) {
      last.templateId = candidates[0].id
      last.photoIds = [...last.photoIds, ...remaining.splice(0, newCount - last.photoIds.length).map((p) => p.id)]
    }
  }

  return spreads
}

// ============== DEMO DATA ==============

function buildSampleWeddingPhotos(): Photo[] {
  // 30 sample photos to better demonstrate the all-photos-placed rule
  const eventMap: EventId[] = [
    'prep', 'prep', 'prep', 'prep', 'prep', 'prep',
    'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony',
    'portraits', 'portraits', 'portraits', 'portraits',
    'reception', 'reception', 'reception', 'reception', 'reception', 'reception', 'reception', 'reception',
    'other', 'other', 'other', 'other',
  ]
  const blurryIdxs = new Set([4, 13, 22])
  return eventMap.map((eventId, i) => ({
    id: `sample-${i}`,
    preview: `https://picsum.photos/seed/wedding${i}/1200/800`,
    width: 4000,
    height: 4000,
    tagged: 'none' as const,
    eventId,
    blurry: blurryIdxs.has(i),
  }))
}

// ============== STYLES ==============

const css: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--dark)',
    color: 'var(--cream)',
    fontFamily: 'var(--font-body)',
    paddingBottom: 80,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 5%',
    borderBottom: '0.5px solid rgba(184,150,90,0.15)',
    marginBottom: 40,
  },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    letterSpacing: 4,
    color: 'var(--cream)',
    textDecoration: 'none',
    textTransform: 'uppercase',
  },
  navBack: {
    background: 'transparent',
    border: 'none',
    color: GOLD,
    fontSize: 9,
    letterSpacing: 3,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    textDecoration: 'none',
  },
  container: { maxWidth: 1100, margin: '0 auto', padding: '0 5%' },
  containerWide: { maxWidth: 1400, margin: '0 auto', padding: '0 5%' },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 5vw, 56px)',
    fontWeight: 300,
    lineHeight: 1.1,
    color: 'var(--cream)',
    marginBottom: 16,
  },
  titleEm: { color: GOLD, fontStyle: 'italic' },
  subtitle: { fontSize: 12, letterSpacing: 1, color: 'var(--muted2)', lineHeight: 2, marginBottom: 32 },
  betaPill: {
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: 3,
    color: GOLD,
    border: '0.5px solid rgba(184,150,90,0.4)',
    padding: '6px 16px',
    borderRadius: 30,
    textTransform: 'uppercase',
    marginBottom: 18,
  },
  btnPrimary: {
    background: GOLD,
    color: 'var(--dark)',
    border: 'none',
    padding: '15px 32px',
    borderRadius: 40,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    flex: 1,
  },
  btnSecondary: {
    background: 'transparent',
    color: GOLD,
    border: `0.5px solid ${GOLD}`,
    padding: '13px 28px',
    borderRadius: 40,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  btnGhost: {
    background: 'transparent',
    color: 'var(--cream)',
    border: '0.5px solid rgba(184,150,90,0.3)',
    padding: '10px 20px',
    borderRadius: 30,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  notice: {
    background: 'rgba(184,150,90,0.06)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 10,
    padding: '16px 20px',
    fontSize: 11,
    color: 'var(--muted2)',
    lineHeight: 1.8,
  },
  uploadZone: {
    border: '0.5px dashed rgba(184,150,90,0.4)',
    borderRadius: 12,
    padding: 50,
    textAlign: 'center',
    cursor: 'pointer',
    background: 'var(--dark2)',
    transition: 'border-color 0.3s',
  },
  card: {
    background: 'var(--dark2)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 12,
    padding: 24,
  },
  cardSelectable: {
    background: 'var(--dark2)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 12,
    padding: 24,
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  cardSelected: {
    background: 'rgba(184,150,90,0.08)',
    borderColor: GOLD,
  },
}

// ============== ICONS ==============

const IconUpload = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke={GOLD}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
)
const IconStar = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill={(props.fill as string) ?? GOLD} viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
)
const IconHeart = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="#ff8a8a" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
  </svg>
)
const IconCheck = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke={GOLD}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
  </svg>
)
const IconBlur = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 20 20" stroke="#ff8a8a">
    <circle cx="10" cy="10" r="7" strokeWidth={1.2} strokeDasharray="2 2" />
    <path d="M10 6v4M10 13.5h.01" strokeWidth={1.2} strokeLinecap="round" />
  </svg>
)

// ============== MAIN ==============

export default function SmartDesignerPage() {
  const [step, setStep] = useState<Step>('setup')
  const [size, setSize] = useState<AlbumSize | null>(null)
  const [type, setType] = useState<AlbumType | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [pageCount, setPageCount] = useState(15)
  const [spreads, setSpreads] = useState<Spread[]>([])
  const [eventFilter, setEventFilter] = useState<EventId | 'all'>('all')
  const [recatId, setRecatId] = useState<string | null>(null)
  const [swapSlot, setSwapSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  const [layoutMenuId, setLayoutMenuId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [orderId] = useState(() => `FF-${Math.floor(100000 + Math.random() * 900000)}`)
  const [uploadProgress, setUploadProgress] = useState(0) // 0-1, transient during upload
  const fileInputRef = useRef<HTMLInputElement>(null)

  const heroCount = photos.filter((p) => p.tagged === 'hero').length
  const favCount = photos.filter((p) => p.tagged === 'favorite').length
  const usefulPhotoCount = photos.filter((p) => !p.blurry).length

  // Recommended page count: ~4 photos per page = 8 per spread.
  const recommendedSpreads = Math.max(10, Math.min(25, Math.ceil(usefulPhotoCount / 8)))

  const albumPrice = useMemo(() => {
    if (!size || !type) return 0
    return computePrice(size, type, pageCount)
  }, [size, type, pageCount])

  const loadSamples = useCallback(() => {
    setPhotos(buildSampleWeddingPhotos())
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const remaining = PHOTO_CAP - photos.length
    if (remaining <= 0) {
      alert(`You've reached the ${PHOTO_CAP}-photo limit.`)
      return
    }
    const toProcess = Array.from(files).slice(0, remaining)
    if (files.length > remaining) {
      alert(`Only ${remaining} more photos can fit (limit ${PHOTO_CAP}). Adding the first ${remaining}.`)
    }

    setUploadProgress(0)
    const newPhotos: Photo[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      const dim = await getImageDimensions(file)
      newPhotos.push({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: 'other',
        blurry: false,
      })
      setUploadProgress((i + 1) / toProcess.length)
    }
    setPhotos([...photos, ...newPhotos])
    setTimeout(() => setUploadProgress(0), 600)
  }

  const recategorize = (photoId: string, eventId: EventId) => {
    setPhotos(photos.map((p) => (p.id === photoId ? { ...p, eventId } : p)))
    setRecatId(null)
  }

  const toggleTag = (photoId: string, tag: 'hero' | 'favorite') => {
    const photo = photos.find((p) => p.id === photoId)
    if (!photo) return

    if (tag === 'hero' && photo.tagged !== 'hero') {
      if (photo.width < HERO_MIN_PX || photo.height < HERO_MIN_PX) {
        alert(
          `This photo is ${photo.width}×${photo.height}px. Hero photos take half a spread (a full page) ` +
            `so they need at least ${HERO_MIN_PX}×${HERO_MIN_PX}px to print sharp. Try a higher-res ` +
            `shot, or tag this one as a Favorite — favorites get prioritized placement too.`,
        )
        return
      }
      if (photo.blurry) {
        if (
          !confirm(
            'This photo is auto-flagged as blurry. Heroes get the most prominent placement. Use it anyway?',
          )
        )
          return
      }
      if (heroCount >= HERO_CAP) {
        alert(`Maximum ${HERO_CAP} hero photos`)
        return
      }
    }
    if (tag === 'favorite' && photo.tagged !== 'favorite' && favCount >= FAV_CAP) {
      alert(`Maximum ${FAV_CAP} favorite photos`)
      return
    }
    setPhotos(
      photos.map((p) =>
        p.id === photoId ? { ...p, tagged: p.tagged === tag ? 'none' : tag } : p,
      ),
    )
  }

  const runGenerate = useCallback(() => {
    if (!type) return
    setGenerating(true)
    setStep('generate')
    setTimeout(() => {
      setSpreads(generateLayout(photos, pageCount, type))
      setGenerating(false)
      setStep('adjust')
    }, 1400)
  }, [photos, pageCount, type])

  const regenerate = () => {
    if (!type) return
    setSpreads(generateLayout([...photos].sort(() => Math.random() - 0.5), pageCount, type))
  }

  const swapPhoto = (newPhotoId: string) => {
    if (!swapSlot) return
    setSpreads(
      spreads.map((s) => {
        if (s.id !== swapSlot.spreadId) return s
        const newIds = [...s.photoIds]
        // If newPhotoId was already used elsewhere, swap places (preserve all-photos placed)
        const oldId = newIds[swapSlot.idx]
        newIds[swapSlot.idx] = newPhotoId
        // Find any other spread where newPhotoId already lives, and put oldId there
        return { ...s, photoIds: newIds }
      }),
    )
    // Maintain "all photos used" by swapping places if duplicated
    setSpreads((prev) => {
      const used = new Map<string, { spreadId: string; idx: number }>()
      const dups: Array<{ spreadId: string; idx: number; photoId: string }> = []
      prev.forEach((s) =>
        s.photoIds.forEach((pid, i) => {
          if (used.has(pid)) {
            dups.push({ spreadId: s.id, idx: i, photoId: pid })
          } else {
            used.set(pid, { spreadId: s.id, idx: i })
          }
        }),
      )
      // Find unused photos to plug duplicate slots
      const unused = photos.filter((p) => !p.blurry && !used.has(p.id))
      let ui = 0
      return prev.map((s) => ({
        ...s,
        photoIds: s.photoIds.map((pid, i) => {
          const dup = dups.find((d) => d.spreadId === s.id && d.idx === i)
          if (dup && unused[ui]) {
            const replacement = unused[ui++]
            return replacement.id
          }
          return pid
        }),
      }))
    })
    setSwapSlot(null)
  }

  const swapTemplate = (spreadId: string, newTemplateId: string) => {
    setSpreads(
      spreads.map((s) => {
        if (s.id !== spreadId) return s
        const newTpl = TEMPLATE_BY_ID.get(newTemplateId)
        if (!newTpl) return s
        // Clip or pad photo list to match the new slot count
        let newIds = [...s.photoIds]
        if (newTpl.slots.length < newIds.length) newIds = newIds.slice(0, newTpl.slots.length)
        if (newTpl.slots.length > newIds.length) {
          const used = new Set(spreads.flatMap((sp) => sp.photoIds))
          const fillers = photos.filter((p) => !p.blurry && !used.has(p.id))
          while (newIds.length < newTpl.slots.length && fillers.length > 0) {
            newIds.push(fillers.shift()!.id)
          }
        }
        return { ...s, templateId: newTemplateId, photoIds: newIds }
      }),
    )
    setLayoutMenuId(null)
  }

  const reset = () => {
    setStep('setup')
    setSize(null)
    setType(null)
    setPhotos([])
    setSpreads([])
    setPageCount(15)
    setEventFilter('all')
  }

  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>()
    photos.forEach((p) => m.set(p.id, p))
    return m
  }, [photos])

  const usedPhotoIds = useMemo(() => new Set(spreads.flatMap((s) => s.photoIds)), [spreads])
  const unusedPhotos = useMemo(
    () => photos.filter((p) => !p.blurry && !usedPhotoIds.has(p.id)),
    [photos, usedPhotoIds],
  )

  // ============== RENDERS ==============

  const renderStepIndicator = () => {
    const stepOrder: Step[] = ['setup', 'guidance', 'upload', 'group', 'tag', 'pages', 'adjust', 'submit']
    const stepForIdx = step === 'generate' ? 'adjust' : step
    const idx = Math.max(0, stepOrder.indexOf(stepForIdx))
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, justifyContent: 'center' }}>
        {stepOrder.map((s, i) => (
          <div
            key={s}
            style={{
              width: 24,
              height: 3,
              background: i <= idx ? GOLD : 'rgba(184,150,90,0.2)',
              borderRadius: 2,
            }}
          />
        ))}
      </div>
    )
  }

  // ----- STEP: SETUP (size + type) -----
  const renderSetup = () => (
    <div style={css.container}>
      {renderStepIndicator()}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <span style={css.betaPill}>⚡ Smart Auto-Layout · Beta</span>
        <h1 style={css.title}>
          Choose your <em style={css.titleEm}>album.</em>
        </h1>
        <p style={css.subtitle}>Size and binding shape every layout that follows.</p>
      </div>

      <div style={{ marginBottom: 36 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          Album size
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {(['17x24', '20x30'] as AlbumSize[]).map((s) => {
            const spec = ALBUM_SPECS[s]
            const isSel = size === s
            return (
              <div
                key={s}
                onClick={() => setSize(s)}
                style={{ ...css.cardSelectable, ...(isSel ? css.cardSelected : {}) }}
              >
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)', marginBottom: 6 }}>
                  {spec.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.7 }}>
                  {s === '17x24' ? 'Coffee-table size · the classic format' : 'Oversized poster · premium hero format'}
                </p>
                <p style={{ fontSize: 10, color: GOLD, marginTop: 10, letterSpacing: 1 }}>
                  Standard from ${spec.standard.base} · Layflat from ${spec.layflat.base}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginBottom: 36 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          Binding type
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {(['standard', 'layflat'] as AlbumType[]).map((t) => {
            const isSel = type === t
            return (
              <div
                key={t}
                onClick={() => setType(t)}
                style={{ ...css.cardSelectable, ...(isSel ? css.cardSelected : {}) }}
              >
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', marginBottom: 6 }}>
                  {t === 'standard' ? 'Standard hardcover' : 'Layflat (flush-mount)'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.7 }}>
                  {t === 'standard'
                    ? 'Visible gutter between pages. Photos stay on each page.'
                    : 'No center seam. Photos can span the full spread.'}
                </p>
                {size && (
                  <p style={{ fontSize: 10, color: GOLD, marginTop: 10, letterSpacing: 1 }}>
                    From ${ALBUM_SPECS[size][t].base} · 10 spreads included · ${ALBUM_SPECS[size][t].perExtraSpread}/extra
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <Link href="/design" style={{ ...css.btnSecondary, textDecoration: 'none', display: 'inline-block', textAlign: 'center' }}>
          ← Back
        </Link>
        <button
          type="button"
          style={{ ...css.btnPrimary, opacity: size && type ? 1 : 0.4, cursor: size && type ? 'pointer' : 'not-allowed' }}
          disabled={!size || !type}
          onClick={() => setStep('guidance')}
        >
          Continue →
        </button>
      </div>
    </div>
  )

  // ----- STEP: GUIDANCE -----
  const renderGuidance = () => {
    if (!size || !type) return null
    const spec = ALBUM_SPECS[size][type]
    return (
      <div style={{ ...css.container, maxWidth: 720 }}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Before you <em style={css.titleEm}>upload.</em>
        </h2>
        <p style={css.subtitle}>A quick read so the layout fits your story.</p>

        <div style={{ ...css.card, marginBottom: 18 }}>
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 12 }}>
            How many photos to upload
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9, marginBottom: 10 }}>
            Each page fits <strong style={{ color: GOLD }}>3–5 photos</strong>. A spread is two pages.
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9, marginBottom: 10 }}>
            Rule of thumb: <strong style={{ color: GOLD }}>photos ÷ 4 ≈ pages</strong>.
            <br />
            100 photos → ~25 pages → ~13 spreads.
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.8, marginTop: 14 }}>
            Hard cap: 100 photos. Less is fine — every photo you upload will be placed in the album.
          </p>
        </div>

        <div style={{ ...css.card, marginBottom: 18 }}>
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 12 }}>
            Album range
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9 }}>
            <strong style={{ color: GOLD }}>{ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard' : 'Layflat'}</strong>
            <br />
            Min {spec.minSpreads} spreads · Max {spec.maxSpreads} spreads · Base ${spec.base} · ${spec.perExtraSpread} per extra spread
          </p>
        </div>

        <div style={css.notice}>
          <strong style={{ color: 'var(--cream)' }}>Heroes</strong> = main photos. They take a full page (half a spread) — not the whole spread, so you keep variety.
          <br />
          <strong style={{ color: 'var(--cream)' }}>Favorites</strong> = priority photos. They get prominent placement.
          <br />
          <strong style={{ color: 'var(--cream)' }}>Everything else</strong> still gets placed — heroes/favorites are priority flags, not filters.
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('setup')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('upload')}>
            Got it — let&apos;s upload →
          </button>
        </div>
      </div>
    )
  }

  // ----- STEP: UPLOAD -----
  const renderUpload = () => {
    const pct = Math.round((photos.length / PHOTO_CAP) * 100)
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={css.title}>
            Upload your <em style={css.titleEm}>photos</em>
          </h1>
          <p style={css.subtitle}>
            {photos.length} of {PHOTO_CAP} used · {Math.max(0, PHOTO_CAP - photos.length)} remaining
          </p>
        </div>

        {/* Capacity bar */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'var(--dark2)',
              borderRadius: 4,
              overflow: 'hidden',
              border: '0.5px solid rgba(184,150,90,0.2)',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: pct >= 100 ? '#ff8a8a' : GOLD,
                transition: 'width 0.3s',
              }}
            />
          </div>
          <p style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', marginTop: 6, textAlign: 'right', textTransform: 'uppercase' }}>
            {pct}% capacity
          </p>
        </div>

        {/* Active upload progress (transient) */}
        {uploadProgress > 0 && uploadProgress < 1 && (
          <div style={{ ...css.notice, marginBottom: 16, borderColor: GOLD }}>
            Uploading… {Math.round(uploadProgress * 100)}%
          </div>
        )}

        <div
          onClick={() => photos.length < PHOTO_CAP && fileInputRef.current?.click()}
          style={{
            ...css.uploadZone,
            cursor: photos.length >= PHOTO_CAP ? 'not-allowed' : 'pointer',
            opacity: photos.length >= PHOTO_CAP ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (photos.length < PHOTO_CAP) e.currentTarget.style.borderColor = GOLD
          }}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(184,150,90,0.4)')}
        >
          <IconUpload width={36} height={36} style={{ marginBottom: 12 }} />
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)' }}>
            {photos.length >= PHOTO_CAP ? 'Photo limit reached' : 'Click to select photos'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, marginTop: 8 }}>
            Up to {PHOTO_CAP - photos.length} more
          </p>
        </div>

        <div style={{ textAlign: 'center', margin: '24px 0' }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>or</span>
        </div>

        <button
          type="button"
          onClick={loadSamples}
          style={{ ...css.btnGhost, width: '100%', padding: '14px 20px' }}
        >
          Use sample wedding photos (no upload)
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {photos.length > 0 && (
          <>
            <div
              style={{
                marginTop: 32,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {photos.map((p) => (
                <div
                  key={p.id}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '0.5px solid rgba(184,150,90,0.2)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
              <button type="button" style={css.btnSecondary} onClick={() => setPhotos([])}>
                Clear
              </button>
              <button type="button" style={css.btnPrimary} onClick={() => setStep('group')}>
                Continue →
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ----- STEP: GROUP -----
  const renderGroup = () => (
    <div style={css.container}>
      {renderStepIndicator()}
      <h2 style={css.title}>
        Group by <em style={css.titleEm}>event</em>
      </h2>
      <p style={css.subtitle}>Auto-grouped to start. Click any photo to recategorize.</p>

      <div style={{ display: 'grid', gap: 20 }}>
        {EVENTS.map((ev) => {
          const inEvent = photos.filter((p) => p.eventId === ev.id)
          if (inEvent.length === 0) return null
          return (
            <div key={ev.id} style={css.card}>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  color: 'var(--cream)',
                  marginBottom: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span>{ev.name}</span>
                <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
                  {inEvent.length} photos
                </span>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
                {inEvent.map((p) => (
                  <div key={p.id} style={{ position: 'relative' }}>
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        setRecatId(p.id === recatId ? null : p.id)
                      }}
                      style={{
                        aspectRatio: '1',
                        borderRadius: 6,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: recatId === p.id ? `1.5px solid ${GOLD}` : '0.5px solid transparent',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    {recatId === p.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 4px)',
                          left: 0,
                          zIndex: 10,
                          background: 'var(--dark3)',
                          border: `0.5px solid ${GOLD}`,
                          borderRadius: 8,
                          padding: 6,
                          minWidth: 140,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                        }}
                      >
                        {EVENTS.filter((e) => e.id !== p.eventId).map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => recategorize(p.id, e.id)}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              padding: '8px 12px',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--cream)',
                              fontSize: 11,
                              cursor: 'pointer',
                              borderRadius: 4,
                              fontFamily: 'var(--font-body)',
                            }}
                            onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(184,150,90,0.15)')}
                            onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                          >
                            Move to {e.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
        <button type="button" style={css.btnSecondary} onClick={() => setStep('upload')}>
          ← Back
        </button>
        <button type="button" style={css.btnPrimary} onClick={() => setStep('tag')}>
          Continue →
        </button>
      </div>
    </div>
  )

  // ----- STEP: TAG -----
  const renderTag = () => {
    const visible = photos.filter((p) => eventFilter === 'all' || p.eventId === eventFilter)
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Tag your <em style={css.titleEm}>best shots</em>
        </h2>
        <p style={css.subtitle}>
          Heroes get a full page (half-spread). Favorites get prominent placement. Everything else still gets placed.
        </p>

        <div style={{ display: 'flex', gap: 24, marginBottom: 18, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--cream)', letterSpacing: 1 }}>
            <IconStar width={14} height={14} /> {heroCount} / {HERO_CAP} Heroes
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--cream)', letterSpacing: 1 }}>
            <IconHeart width={14} height={14} /> {favCount} / {FAV_CAP} Favorites
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {(['all', ...EVENTS.map((e) => e.id)] as Array<EventId | 'all'>).map((id) => {
            const active = eventFilter === id
            const label = id === 'all' ? 'All' : EVENTS.find((e) => e.id === id)?.name ?? id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setEventFilter(id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 30,
                  border: `0.5px solid ${active ? GOLD : 'rgba(184,150,90,0.3)'}`,
                  background: active ? 'rgba(184,150,90,0.15)' : 'transparent',
                  color: active ? GOLD : 'var(--cream)',
                  fontSize: 9,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {visible.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <div
                style={{
                  aspectRatio: '1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border:
                    p.tagged === 'hero'
                      ? `1.5px solid ${GOLD}`
                      : p.tagged === 'favorite'
                      ? '1.5px solid #ff8a8a'
                      : '0.5px solid rgba(184,150,90,0.2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.preview}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: p.blurry ? 'blur(1.2px) brightness(0.85)' : 'none',
                  }}
                />
              </div>
              {p.blurry && (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    background: 'rgba(255,138,138,0.95)',
                    color: '#0e0c09',
                    fontSize: 8,
                    letterSpacing: 1,
                    padding: '3px 7px',
                    borderRadius: 30,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <IconBlur width={10} height={10} /> Blur
                </span>
              )}
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => toggleTag(p.id, 'hero')}
                  title="Mark as hero"
                  style={{
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: '50%',
                    background: p.tagged === 'hero' ? GOLD : 'rgba(0,0,0,0.65)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconStar width={14} height={14} fill={p.tagged === 'hero' ? '#0e0c09' : GOLD} />
                </button>
                <button
                  type="button"
                  onClick={() => toggleTag(p.id, 'favorite')}
                  title="Mark as favorite"
                  style={{
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: '50%',
                    background: p.tagged === 'favorite' ? '#ff8a8a' : 'rgba(0,0,0,0.65)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconHeart width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('group')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('pages')}>
            Continue →
          </button>
        </div>
      </div>
    )
  }

  // ----- STEP: PAGES -----
  const renderPages = () => {
    if (!size || !type) return null
    const spec = ALBUM_SPECS[size][type]
    const extraSpreads = Math.max(0, pageCount - spec.minSpreads)
    const extraCost = extraSpreads * spec.perExtraSpread
    return (
      <div style={{ ...css.container, maxWidth: 640 }}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Album <em style={css.titleEm}>length</em>
        </h2>
        <p style={css.subtitle}>
          {usefulPhotoCount} usable photos · we recommend ~{recommendedSpreads} spreads
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
            Spreads ({pageCount * 2} pages)
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: GOLD }}>{pageCount}</span>
        </div>

        <input
          type="range"
          min={spec.minSpreads}
          max={spec.maxSpreads}
          value={pageCount}
          onChange={(e) => setPageCount(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: GOLD, cursor: 'pointer' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', marginTop: 8 }}>
          <span>{spec.minSpreads} spreads</span>
          <span>{spec.maxSpreads} spreads</span>
        </div>

        {pageCount < recommendedSpreads && (
          <div style={{ ...css.notice, marginTop: 18, borderColor: '#ff8a8a' }}>
            ⚠ With {pageCount} spreads, your {usefulPhotoCount} photos will be packed{' '}
            <strong>~{Math.ceil(usefulPhotoCount / pageCount)} per spread</strong>. Consider going up to{' '}
            <strong>{recommendedSpreads}</strong> for a more breathable layout.
          </div>
        )}

        <div style={{ ...css.card, marginTop: 28 }}>
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
            {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard' : 'Layflat'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--cream)', marginBottom: 10 }}>
            <span>Base ({spec.minSpreads} spreads)</span>
            <span>${spec.base}</span>
          </div>
          {extraSpreads > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: GOLD, marginBottom: 10 }}>
              <span>{extraSpreads} extra spreads × ${spec.perExtraSpread}</span>
              <span>+${extraCost}</span>
            </div>
          )}
          <div
            style={{
              borderTop: '0.5px solid rgba(184,150,90,0.2)',
              paddingTop: 14,
              marginTop: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>Total</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: GOLD }}>${albumPrice}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('tag')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={runGenerate}>
            Generate Layout →
          </button>
        </div>
      </div>
    )
  }

  // ----- STEP: GENERATE -----
  const renderGenerate = () => (
    <div style={{ ...css.container, maxWidth: 520, textAlign: 'center', paddingTop: 80 }}>
      <div
        style={{
          width: 60,
          height: 60,
          margin: '0 auto 24px',
          borderRadius: '50%',
          border: `2px solid ${GOLD}`,
          borderTopColor: 'transparent',
          animation: 'spin 1s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <h2 style={css.title}>
        Composing your <em style={css.titleEm}>album</em>
      </h2>
      <p style={css.subtitle}>
        {generating
          ? `Placing ${heroCount} hero${heroCount === 1 ? '' : 'es'} · ${favCount} favorites · fitting ${pageCount} spreads…`
          : 'Done.'}
      </p>
    </div>
  )

  // ----- STEP: ADJUST -----
  const renderAdjust = () => {
    if (!size || !type) return null
    return (
      <div style={css.containerWide}>
        {renderStepIndicator()}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 8,
          }}
        >
          <h2 style={{ ...css.title, marginBottom: 0 }}>
            Review &amp; <em style={css.titleEm}>adjust</em>
          </h2>
          <button type="button" style={css.btnGhost} onClick={regenerate}>
            ↻ Regenerate
          </button>
        </div>
        <p style={css.subtitle}>
          Preview at {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard (with gutter)' : 'Layflat (flush)'} · click any
          photo or layout name to swap.
        </p>

        {swapSlot && (
          <div style={{ ...css.notice, marginBottom: 20, borderColor: GOLD }}>
            <strong style={{ color: GOLD }}>Pick a replacement</strong> — click a photo from your pool on the right, or{' '}
            <button
              type="button"
              onClick={() => setSwapSlot(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: GOLD,
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              cancel
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 24 }}>
          {/* Spreads */}
          <div style={{ display: 'grid', gap: 16 }}>
            {spreads.map((s, i) => (
              <SpreadView
                key={s.id}
                spread={s}
                index={i}
                photoMap={photoMap}
                albumSize={size}
                albumType={type}
                onPhotoClick={(idx) => setSwapSlot({ spreadId: s.id, idx })}
                activeSlot={swapSlot && swapSlot.spreadId === s.id ? swapSlot.idx : -1}
                layoutMenuOpen={layoutMenuId === s.id}
                onToggleLayoutMenu={() => setLayoutMenuId(layoutMenuId === s.id ? null : s.id)}
                onPickTemplate={(tplId) => swapTemplate(s.id, tplId)}
              />
            ))}
          </div>

          {/* Sidebar: used / unused */}
          <aside style={{ position: 'sticky', top: 20, alignSelf: 'start' }}>
            <div style={{ ...css.card, marginBottom: 16 }}>
              <p style={{ fontSize: 10, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 8 }}>
                Used in album
              </p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--cream)' }}>
                {usedPhotoIds.size}{' '}
                <span style={{ fontSize: 14, color: 'var(--muted2)' }}>/ {photos.length}</span>
              </p>
            </div>

            {unusedPhotos.length > 0 && (
              <div style={css.card}>
                <p
                  style={{
                    fontSize: 10,
                    letterSpacing: 2,
                    color: '#ff8a8a',
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  Unused ({unusedPhotos.length})
                </p>
                <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7, marginBottom: 12 }}>
                  Add more spreads or swap into existing ones to include these.
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
                    gap: 4,
                    maxHeight: 360,
                    overflowY: 'auto',
                  }}
                >
                  {unusedPhotos.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => swapSlot && swapPhoto(p.id)}
                      style={{
                        aspectRatio: '1',
                        borderRadius: 4,
                        overflow: 'hidden',
                        cursor: swapSlot ? 'pointer' : 'default',
                        border: '0.5px solid rgba(184,150,90,0.2)',
                      }}
                      title={swapSlot ? 'Click to use as replacement' : undefined}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* $99 hand-off upsell */}
        <div
          style={{
            ...css.card,
            background: 'linear-gradient(135deg, rgba(184,150,90,0.08), rgba(184,150,90,0.02))',
            borderColor: 'rgba(184,150,90,0.3)',
            marginTop: 32,
            marginBottom: 32,
          }}
        >
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', marginBottom: 6 }}>
            Want our team to <em style={{ color: GOLD, fontStyle: 'italic' }}>polish it?</em>
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.8, marginBottom: 14 }}>
            For an extra <strong style={{ color: GOLD }}>$99</strong>, our designers fine-tune crops, refine spread pacing,
            and balance the visual flow. Proof in 24 hours.
          </p>
          <button type="button" style={{ ...css.btnSecondary, padding: '11px 24px' }}>
            + $99 · Hand off to design team
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('pages')}>
            ← Back
          </button>
          <button type="button" style={css.btnPrimary} onClick={() => setStep('submit')}>
            Submit Order · ${albumPrice} →
          </button>
        </div>
      </div>
    )
  }

  // ----- STEP: SUBMIT -----
  const renderSubmit = () => (
    <div style={{ ...css.container, maxWidth: 560, textAlign: 'center', paddingTop: 40 }}>
      {renderStepIndicator()}
      <div
        style={{
          width: 80,
          height: 80,
          margin: '0 auto 28px',
          border: '0.5px solid rgba(184,150,90,0.4)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconCheck width={40} height={40} />
      </div>

      <h2 style={css.title}>
        Order <em style={css.titleEm}>received.</em>
      </h2>
      <p style={css.subtitle}>
        Order #{orderId} · ${albumPrice}
      </p>

      <div style={{ ...css.card, textAlign: 'left', marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          What happens next
        </p>
        <ol style={{ paddingLeft: 18, lineHeight: 2, fontSize: 12, color: 'var(--cream)' }}>
          <li>Smart engine arrangement is queued for review</li>
          <li>Design team checks crops &amp; balance (24h)</li>
          <li>You&apos;ll receive a final PDF proof to approve</li>
          <li>After approval, printing &amp; binding begins (5–7 days)</li>
        </ol>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={{ ...css.btnSecondary }} onClick={reset}>
          Start New
        </button>
        <Link
          href="/"
          style={{ ...css.btnPrimary, textDecoration: 'none', display: 'inline-block', textAlign: 'center', flex: 'unset' }}
        >
          Back to Home
        </Link>
      </div>
    </div>
  )

  // Close recat dropdown on outside click
  useEffect(() => {
    if (!recatId && !layoutMenuId) return
    const onClick = () => {
      setRecatId(null)
      setLayoutMenuId(null)
    }
    const t = setTimeout(() => document.addEventListener('click', onClick), 100)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
    }
  }, [recatId, layoutMenuId])

  return (
    <div style={css.page}>
      <nav style={css.nav}>
        <Link href="/" style={css.logo}>
          Folio &amp; Forever
        </Link>
        <Link href="/design" style={css.navBack}>
          ← Back to Design
        </Link>
      </nav>

      {step === 'setup' && renderSetup()}
      {step === 'guidance' && renderGuidance()}
      {step === 'upload' && renderUpload()}
      {step === 'group' && renderGroup()}
      {step === 'tag' && renderTag()}
      {step === 'pages' && renderPages()}
      {step === 'generate' && renderGenerate()}
      {step === 'adjust' && renderAdjust()}
      {step === 'submit' && renderSubmit()}
    </div>
  )
}

// ============== HELPERS ==============

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = URL.createObjectURL(file)
  })
}

// ============== SPREAD RENDER ==============

function SpreadView({
  spread,
  index,
  photoMap,
  albumSize,
  albumType,
  onPhotoClick,
  activeSlot,
  layoutMenuOpen,
  onToggleLayoutMenu,
  onPickTemplate,
}: {
  spread: Spread
  index: number
  photoMap: Map<string, Photo>
  albumSize: AlbumSize
  albumType: AlbumType
  onPhotoClick: (idx: number) => void
  activeSlot: number
  layoutMenuOpen: boolean
  onToggleLayoutMenu: () => void
  onPickTemplate: (tplId: string) => void
}) {
  const tpl = TEMPLATE_BY_ID.get(spread.templateId)
  if (!tpl) return null

  const eventName = EVENTS.find((e) => e.id === spread.eventId)?.name ?? ''
  const aspect = ALBUM_SPECS[albumSize].spreadAspectRatio
  const showGutter = albumType === 'standard'

  // Alternate templates that fit the same number of photos.
  const alternates = templatesForCount(spread.photoIds.length, albumType).filter(
    (t) => t.id !== spread.templateId,
  )

  return (
    <div
      style={{
        background: 'var(--dark2)',
        border: '0.5px solid rgba(184,150,90,0.2)',
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
          Spread {index + 1} · {ALBUM_SPECS[albumSize].label}
        </span>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleLayoutMenu()
            }}
            style={{
              background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.3)',
              color: GOLD,
              fontSize: 9,
              letterSpacing: 1,
              padding: '4px 10px',
              borderRadius: 30,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              textTransform: 'uppercase',
            }}
          >
            {tpl.name} ▾
          </button>
          {layoutMenuOpen && alternates.length > 0 && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                zIndex: 10,
                background: 'var(--dark3)',
                border: `0.5px solid ${GOLD}`,
                borderRadius: 8,
                padding: 6,
                minWidth: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}
            >
              <p style={{ fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', padding: '6px 10px', textTransform: 'uppercase' }}>
                Switch layout
              </p>
              {alternates.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => onPickTemplate(alt.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cream)',
                    fontSize: 11,
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontFamily: 'var(--font-body)',
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(184,150,90,0.15)')}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                >
                  {alt.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>{eventName}</span>
      </div>

      {/* Spread canvas at correct aspect ratio */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${aspect}`,
          background: 'var(--dark3)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {tpl.slots.map((slot, i) => {
          const photo = photoMap.get(spread.photoIds[i])
          const active = activeSlot === i
          return (
            <div
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                onPhotoClick(i)
              }}
              style={{
                position: 'absolute',
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                width: `${slot.w}%`,
                height: `${slot.h}%`,
                cursor: 'pointer',
                border: active ? `2px solid ${GOLD}` : '0.5px solid rgba(255,255,255,0.05)',
                overflow: 'hidden',
                borderRadius: 2,
                background: 'var(--dark)',
              }}
              title={slot.isHero ? 'Hero photo' : 'Photo'}
            >
              {photo && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.preview}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {slot.isHero && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 4,
                        left: 4,
                        fontSize: 7,
                        letterSpacing: 1.5,
                        color: '#0e0c09',
                        background: GOLD,
                        padding: '2px 6px',
                        borderRadius: 30,
                        textTransform: 'uppercase',
                        fontWeight: 700,
                      }}
                    >
                      Hero
                    </span>
                  )}
                </>
              )}
            </div>
          )
        })}
        {showGutter && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 1,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  )
}
