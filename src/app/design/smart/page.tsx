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

type Step = 'upload' | 'group' | 'tag' | 'pages' | 'generate' | 'adjust' | 'submit'

type SpreadType = 'hero-full' | 'pair' | 'triple' | 'quad'

type Spread = {
  id: string
  type: SpreadType
  photoIds: string[]
  eventId: EventId
}

// ============== LAYOUT ENGINE ==============
// Pure function: photos + pageCount → ordered list of spreads.
// Rules: heroes get full-bleed solo spreads; favorites pair up; others
// fill remaining spreads in chunks of 3–4. Order follows the event arc.

function generateLayout(photos: Photo[], pageCount: number): Spread[] {
  const eventOrder: EventId[] = ['prep', 'ceremony', 'portraits', 'reception', 'other']
  const spreads: Spread[] = []
  let idx = 0

  const useable = photos.filter((p) => !p.blurry)

  for (const eventId of eventOrder) {
    if (spreads.length >= pageCount) break

    const inEvent = useable.filter((p) => p.eventId === eventId)
    const heroes = inEvent.filter((p) => p.tagged === 'hero')
    const favs = inEvent.filter((p) => p.tagged === 'favorite')
    const others = inEvent.filter((p) => p.tagged === 'none')

    // Heroes: each gets a full-bleed spread.
    for (const h of heroes) {
      if (spreads.length >= pageCount) break
      spreads.push({
        id: `s-${idx++}`,
        type: 'hero-full',
        photoIds: [h.id],
        eventId,
      })
    }

    // Favorites: pair them up (2 per spread). Odd one becomes a hero-style.
    for (let i = 0; i < favs.length; i += 2) {
      if (spreads.length >= pageCount) break
      const pair = favs.slice(i, i + 2)
      if (pair.length === 2) {
        spreads.push({
          id: `s-${idx++}`,
          type: 'pair',
          photoIds: pair.map((p) => p.id),
          eventId,
        })
      } else {
        spreads.push({
          id: `s-${idx++}`,
          type: 'hero-full',
          photoIds: [pair[0].id],
          eventId,
        })
      }
    }

    // Others: chunks of 3–4 per spread.
    let oi = 0
    while (oi < others.length && spreads.length < pageCount) {
      const remaining = others.length - oi
      const take = remaining >= 4 ? 4 : remaining >= 3 ? 3 : remaining >= 2 ? 2 : 1
      const chunk = others.slice(oi, oi + take)
      if (chunk.length === 0) break
      const type: SpreadType =
        chunk.length === 4 ? 'quad' : chunk.length === 3 ? 'triple' : chunk.length === 2 ? 'pair' : 'hero-full'
      spreads.push({
        id: `s-${idx++}`,
        type,
        photoIds: chunk.map((p) => p.id),
        eventId,
      })
      oi += take
    }
  }

  return spreads.slice(0, pageCount)
}

// ============== DEMO DATA ==============

function buildSampleWeddingPhotos(): Photo[] {
  const eventMap: EventId[] = [
    'prep', 'prep', 'prep', 'prep', 'prep',
    'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony', 'ceremony',
    'portraits', 'portraits', 'portraits',
    'reception', 'reception', 'reception', 'reception', 'reception',
  ]
  // Pre-flagged blurries — deterministic for demo (so it's the same every time).
  const blurryIdxs = new Set([3, 11, 17])
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
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 5vw, 56px)',
    fontWeight: 300,
    lineHeight: 1.1,
    color: 'var(--cream)',
    marginBottom: 16,
  },
  titleEm: { color: GOLD, fontStyle: 'italic' },
  subtitle: {
    fontSize: 12,
    letterSpacing: 1,
    color: 'var(--muted2)',
    lineHeight: 2,
    marginBottom: 32,
  },
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
  const [step, setStep] = useState<Step>('upload')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [pageCount, setPageCount] = useState(15)
  const [spreads, setSpreads] = useState<Spread[]>([])
  const [eventFilter, setEventFilter] = useState<EventId | 'all'>('all')
  const [recatId, setRecatId] = useState<string | null>(null)
  const [swapSlot, setSwapSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [orderId] = useState(() => `FF-${Math.floor(100000 + Math.random() * 900000)}`)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const heroCount = photos.filter((p) => p.tagged === 'hero').length
  const favCount = photos.filter((p) => p.tagged === 'favorite').length

  const loadSamples = useCallback(() => {
    setPhotos(buildSampleWeddingPhotos())
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    if (photos.length + files.length > PHOTO_CAP) {
      alert(`Maximum ${PHOTO_CAP} photos allowed`)
      return
    }
    const newPhotos: Photo[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
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
    }
    setPhotos([...photos, ...newPhotos])
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
          `This photo is ${photo.width}×${photo.height}px. Heroes get full-spread placement, ` +
            `so they need at least ${HERO_MIN_PX}×${HERO_MIN_PX}px to print sharp. Try a higher-res shot, ` +
            `or tag this one as a Favorite instead.`,
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
    setGenerating(true)
    setStep('generate')
    setTimeout(() => {
      setSpreads(generateLayout(photos, pageCount))
      setGenerating(false)
      setStep('adjust')
    }, 1400)
  }, [photos, pageCount])

  const regenerate = () => {
    setSpreads(generateLayout([...photos].sort(() => Math.random() - 0.5), pageCount))
  }

  const swapPhoto = (newPhotoId: string) => {
    if (!swapSlot) return
    setSpreads(
      spreads.map((s) => {
        if (s.id !== swapSlot.spreadId) return s
        const newIds = [...s.photoIds]
        newIds[swapSlot.idx] = newPhotoId
        return { ...s, photoIds: newIds }
      }),
    )
    setSwapSlot(null)
  }

  const reset = () => {
    setStep('upload')
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

  // ============== RENDERS ==============

  const renderStepIndicator = () => {
    const stepOrder: Step[] = ['upload', 'group', 'tag', 'pages', 'adjust', 'submit']
    const idx = Math.max(0, stepOrder.indexOf(step === 'generate' ? 'adjust' : step))
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, justifyContent: 'center' }}>
        {stepOrder.map((s, i) => (
          <div
            key={s}
            style={{
              width: 28,
              height: 3,
              background: i <= idx ? GOLD : 'rgba(184,150,90,0.2)',
              borderRadius: 2,
            }}
          />
        ))}
      </div>
    )
  }

  const renderUpload = () => (
    <div style={css.container}>
      {renderStepIndicator()}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <span style={css.betaPill}>⚡ Smart Auto-Layout · Beta</span>
        <h1 style={css.title}>
          Upload your <em style={css.titleEm}>photos</em>
        </h1>
        <p style={css.subtitle}>
          Up to {PHOTO_CAP} photos · Heroes need {HERO_MIN_PX}×{HERO_MIN_PX}px to print sharp
        </p>
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        style={css.uploadZone}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = GOLD)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(184,150,90,0.4)')}
      >
        <IconUpload width={36} height={36} style={{ marginBottom: 12 }} />
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)' }}>
          Click to select photos
        </p>
        <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, marginTop: 8 }}>
          {photos.length} / {PHOTO_CAP} uploaded
        </p>
      </div>

      <div style={{ textAlign: 'center', margin: '24px 0' }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
          or
        </span>
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
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
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

  const renderGroup = () => (
    <div style={css.container}>
      {renderStepIndicator()}
      <h2 style={css.title}>
        Group by <em style={css.titleEm}>event</em>
      </h2>
      <p style={css.subtitle}>
        Auto-grouped from filename clues. Click any photo to recategorize.
      </p>

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
                      onClick={() => setRecatId(p.id === recatId ? null : p.id)}
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

  const renderTag = () => {
    const visible = photos.filter((p) => eventFilter === 'all' || p.eventId === eventFilter)
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Tag your <em style={css.titleEm}>best shots</em>
        </h2>
        <p style={css.subtitle}>Heroes get full spreads. Favorites get prominent placement.</p>

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

        <div style={{ ...css.notice, marginBottom: 24 }}>
          <strong style={{ color: 'var(--cream)' }}>Heroes</strong> ({HERO_CAP} max): full-spread worthy.{' '}
          <strong style={{ color: 'var(--cream)' }}>Favorites</strong> ({FAV_CAP} max): featured prominently. Others fill the gaps.
          <br />
          <span style={{ color: '#ff8a8a' }}>⚠ Blurry-flagged photos</span> are skipped from layouts unless you tag them.
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
          <button
            type="button"
            style={{ ...css.btnPrimary, opacity: heroCount === 0 ? 0.4 : 1, cursor: heroCount === 0 ? 'not-allowed' : 'pointer' }}
            disabled={heroCount === 0}
            onClick={() => setStep('pages')}
          >
            {heroCount === 0 ? 'Tag at least 1 hero' : 'Continue →'}
          </button>
        </div>
      </div>
    )
  }

  const renderPages = () => {
    const basePrice = 450
    const extraSpreads = Math.max(0, pageCount - 10)
    const extraCost = extraSpreads * 35
    const total = basePrice + extraCost
    return (
      <div style={{ ...css.container, maxWidth: 640 }}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Album <em style={css.titleEm}>length</em>
        </h2>
        <p style={css.subtitle}>Base price includes 10 spreads (20 pages).</p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>Spreads</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: GOLD }}>{pageCount}</span>
        </div>

        <input
          type="range"
          min="10"
          max="25"
          value={pageCount}
          onChange={(e) => setPageCount(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: GOLD, cursor: 'pointer' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', marginTop: 8 }}>
          <span>10 spreads</span>
          <span>25 spreads</span>
        </div>

        <div style={{ ...css.card, marginTop: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--cream)', marginBottom: 10 }}>
            <span>Base album (10 spreads)</span>
            <span>${basePrice}</span>
          </div>
          {extraSpreads > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: GOLD, marginBottom: 10 }}>
              <span>{extraSpreads} extra spreads × $35</span>
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
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: GOLD }}>${total}</span>
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
          ? `Placing ${heroCount} hero${heroCount === 1 ? '' : 'es'}, ${favCount} favorites, fitting ${pageCount} spreads…`
          : 'Done.'}
      </p>
    </div>
  )

  const renderAdjust = () => {
    const usedPhotoIds = new Set(spreads.flatMap((s) => s.photoIds))
    const swapPool = photos.filter((p) => !p.blurry && !usedPhotoIds.has(p.id))
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
          <h2 style={{ ...css.title, marginBottom: 0 }}>
            Review &amp; <em style={css.titleEm}>adjust</em>
          </h2>
          <button type="button" style={css.btnGhost} onClick={regenerate}>
            ↻ Regenerate
          </button>
        </div>
        <p style={css.subtitle}>
          {spreads.length} spreads · click any photo to swap
        </p>

        {swapSlot && (
          <div style={{ ...css.notice, marginBottom: 20, borderColor: GOLD }}>
            <strong style={{ color: GOLD }}>Pick a replacement</strong> — click a photo from your pool below, or{' '}
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

        {/* Spreads */}
        <div style={{ display: 'grid', gap: 16, marginBottom: 32 }}>
          {spreads.map((s, i) => (
            <SpreadView
              key={s.id}
              spread={s}
              index={i}
              photoMap={photoMap}
              onPhotoClick={(idx) => setSwapSlot({ spreadId: s.id, idx })}
              activeSlot={swapSlot && swapSlot.spreadId === s.id ? swapSlot.idx : -1}
            />
          ))}
        </div>

        {/* Swap pool */}
        {swapSlot && swapPool.length > 0 && (
          <div style={{ ...css.card, marginBottom: 24 }}>
            <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 12 }}>
              Replacement options
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {swapPool.map((p) => (
                <div
                  key={p.id}
                  onClick={() => swapPhoto(p.id)}
                  style={{ aspectRatio: '1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: '0.5px solid rgba(184,150,90,0.2)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* $99 hand-off upsell */}
        <div
          style={{
            ...css.card,
            background: 'linear-gradient(135deg, rgba(184,150,90,0.08), rgba(184,150,90,0.02))',
            borderColor: 'rgba(184,150,90,0.3)',
            marginBottom: 32,
          }}
        >
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', marginBottom: 6 }}>
            Want our team to <em style={{ color: GOLD, fontStyle: 'italic' }}>polish it?</em>
          </p>
          <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.8, marginBottom: 14 }}>
            For an extra <strong style={{ color: GOLD }}>$99</strong>, our designers fine-tune crops, refine
            spread pacing, and balance the visual flow. Proof in 24 hours.
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
            Submit Order →
          </button>
        </div>
      </div>
    )
  }

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
      <p style={css.subtitle}>Order #{orderId}</p>

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
    if (!recatId) return
    const onClick = () => setRecatId(null)
    const t = setTimeout(() => document.addEventListener('click', onClick), 100)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
    }
  }, [recatId])

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
  onPhotoClick,
  activeSlot,
}: {
  spread: Spread
  index: number
  photoMap: Map<string, Photo>
  onPhotoClick: (idx: number) => void
  activeSlot: number
}) {
  const photos = spread.photoIds.map((id) => photoMap.get(id)).filter(Boolean) as Photo[]
  const eventName = EVENTS.find((e) => e.id === spread.eventId)?.name ?? ''

  const cellStyle = (idx: number): React.CSSProperties => ({
    cursor: 'pointer',
    overflow: 'hidden',
    borderRadius: 4,
    border: activeSlot === idx ? `2px solid ${GOLD}` : '0.5px solid transparent',
    background: 'var(--dark3)',
    transition: 'border-color 0.2s',
  })

  let body: React.ReactNode
  if (spread.type === 'hero-full') {
    body = (
      <div onClick={() => onPhotoClick(0)} style={{ ...cellStyle(0), aspectRatio: '24/10' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[0]?.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  } else if (spread.type === 'pair') {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, aspectRatio: '24/10' }}>
        {photos.map((p, i) => (
          <div key={p.id} onClick={() => onPhotoClick(i)} style={cellStyle(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>
    )
  } else if (spread.type === 'triple') {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, aspectRatio: '24/10' }}>
        <div onClick={() => onPhotoClick(0)} style={cellStyle(0)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0]?.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div onClick={() => onPhotoClick(1)} style={cellStyle(1)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[1]?.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div onClick={() => onPhotoClick(2)} style={cellStyle(2)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[2]?.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </div>
    )
  } else {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 8, aspectRatio: '24/10' }}>
        {photos.map((p, i) => (
          <div key={p.id} onClick={() => onPhotoClick(i)} style={cellStyle(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ))}
      </div>
    )
  }

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
          Spread {index + 1}
        </span>
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>{eventName}</span>
      </div>
      {body}
    </div>
  )
}
