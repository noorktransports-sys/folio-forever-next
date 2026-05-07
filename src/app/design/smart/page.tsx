'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import '../album-builder.css'

export const runtime = 'edge'

// Types
type PhotoUpload = {
  file: File
  preview: string
  id: string
  width: number
  height: number
  tagged: 'hero' | 'favorite' | 'none'
}

type PathType = 'engagement' | 'wedding' | 'family' | 'custom'

type EventGroup = {
  id: string
  name: string
  photos: PhotoUpload[]
}

type Step = 'path' | 'upload' | 'group' | 'tag' | 'pages' | 'adjust' | 'submit'

const GOLD = '#b8965a'

// Brand-aligned styles. Inline so this page doesn't have to fight Tailwind
// resets — matches the pattern used elsewhere in /design.
const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--dark)',
    color: 'var(--cream)',
    fontFamily: 'var(--font-body)',
    paddingBottom: 80,
  } as React.CSSProperties,
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 5%',
    borderBottom: '0.5px solid rgba(184,150,90,0.15)',
    marginBottom: 40,
  } as React.CSSProperties,
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    letterSpacing: 4,
    color: 'var(--cream)',
    textDecoration: 'none',
    textTransform: 'uppercase' as const,
  },
  navBack: {
    background: 'transparent',
    border: 'none',
    color: 'var(--gold)',
    fontSize: 9,
    letterSpacing: 3,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  },
  container: { maxWidth: 980, margin: '0 auto', padding: '0 5%' } as React.CSSProperties,
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 5vw, 56px)',
    fontWeight: 300,
    lineHeight: 1.1,
    color: 'var(--cream)',
    marginBottom: 16,
  } as React.CSSProperties,
  titleEm: { color: 'var(--gold)', fontStyle: 'italic' } as React.CSSProperties,
  subtitle: {
    fontSize: 12,
    letterSpacing: 1,
    color: 'var(--muted2)',
    lineHeight: 2,
    marginBottom: 36,
  } as React.CSSProperties,
  betaPill: {
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: 3,
    color: GOLD,
    border: '0.5px solid rgba(184,150,90,0.4)',
    padding: '6px 16px',
    borderRadius: 30,
    textTransform: 'uppercase' as const,
    marginBottom: 18,
  },
  card: {
    background: 'var(--dark2)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 12,
    padding: '32px 28px',
    cursor: 'pointer',
    transition: 'all 0.35s',
    textAlign: 'left' as const,
    width: '100%',
    fontFamily: 'var(--font-body)',
    color: 'var(--cream)',
  },
  cardHover: { borderColor: 'rgba(184,150,90,0.5)', transform: 'translateY(-4px)' },
  cardTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 400,
    color: 'var(--cream)',
    marginBottom: 6,
  } as React.CSSProperties,
  cardDesc: { fontSize: 11, color: 'var(--muted2)', lineHeight: 1.8, letterSpacing: 0.3 },
  btnPrimary: {
    background: GOLD,
    color: 'var(--dark)',
    border: 'none',
    padding: '15px 32px',
    borderRadius: 40,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    width: '100%',
  } as React.CSSProperties,
  btnSecondary: {
    background: 'transparent',
    color: GOLD,
    border: `0.5px solid ${GOLD}`,
    padding: '13px 28px',
    borderRadius: 40,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties,
  notice: {
    background: 'rgba(184,150,90,0.06)',
    border: '0.5px solid rgba(184,150,90,0.2)',
    borderRadius: 10,
    padding: '16px 20px',
    fontSize: 11,
    color: 'var(--muted2)',
    lineHeight: 1.8,
  } as React.CSSProperties,
  uploadZone: {
    border: '0.5px dashed rgba(184,150,90,0.4)',
    borderRadius: 12,
    padding: 60,
    textAlign: 'center' as const,
    cursor: 'pointer',
    background: 'var(--dark2)',
    transition: 'border-color 0.3s',
  },
}

// Inline icons — minimal stroke, matches the gold-on-dark feel.
const IconUpload = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill="none" viewBox="0 0 24 24" stroke={GOLD}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
)
const IconStar = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} fill={GOLD} viewBox="0 0 20 20">
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

export default function SmartDesignerPage() {
  const [step, setStep] = useState<Step>('path')
  const [pathType, setPathType] = useState<PathType | null>(null)
  const [photos, setPhotos] = useState<PhotoUpload[]>([])
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([])
  const [pageCount, setPageCount] = useState(15)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadSampleWeddingPhotos = useCallback(() => {
    const samplePhotos: PhotoUpload[] = []
    for (let i = 0; i < 20; i++) {
      samplePhotos.push({
        file: new File([], `wedding-${i}.jpg`),
        preview: `https://picsum.photos/seed/wedding${i}/800/600`,
        id: `sample-${i}`,
        width: 800,
        height: 600,
        tagged: 'none',
      })
    }
    setPhotos(samplePhotos)
    setEventGroups([
      { id: 'prep', name: 'Getting Ready', photos: samplePhotos.slice(0, 5) },
      { id: 'ceremony', name: 'Ceremony', photos: samplePhotos.slice(5, 12) },
      { id: 'reception', name: 'Reception', photos: samplePhotos.slice(12, 20) },
    ])
  }, [])

  useEffect(() => {
    if (pathType === 'wedding' && photos.length === 0) {
      loadSampleWeddingPhotos()
    }
  }, [pathType, photos.length, loadSampleWeddingPhotos])

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      const img = new window.Image()
      img.onload = () => resolve({ width: img.width, height: img.height })
      img.src = URL.createObjectURL(file)
    })

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    if (photos.length + files.length > 100) {
      alert('Maximum 100 photos allowed')
      return
    }
    const newPhotos: PhotoUpload[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const dim = await getImageDimensions(file)
      if (dim.width < 3000 || dim.height < 3000) {
        alert(`${file.name} is below 3000x3000px minimum`)
        continue
      }
      newPhotos.push({
        file,
        preview: URL.createObjectURL(file),
        id: `${Date.now()}-${i}`,
        width: dim.width,
        height: dim.height,
        tagged: 'none',
      })
    }
    setPhotos([...photos, ...newPhotos])
  }

  const toggleTag = (photoId: string, tag: 'hero' | 'favorite') => {
    const heroCount = photos.filter((p) => p.tagged === 'hero').length
    const favCount = photos.filter((p) => p.tagged === 'favorite').length
    const photo = photos.find((p) => p.id === photoId)
    if (!photo) return
    if (tag === 'hero' && photo.tagged !== 'hero' && heroCount >= 8) {
      alert('Maximum 8 hero photos')
      return
    }
    if (tag === 'favorite' && photo.tagged !== 'favorite' && favCount >= 30) {
      alert('Maximum 30 favorite photos')
      return
    }
    setPhotos(
      photos.map((p) =>
        p.id === photoId ? { ...p, tagged: p.tagged === tag ? 'none' : tag } : p,
      ),
    )
  }

  // ---------- STEP RENDERS ----------

  const renderPath = () => (
    <div style={styles.container}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <span style={styles.betaPill}>⚡ Beta · Smart Layout Engine</span>
        <h1 style={styles.title}>
          How would you<br />
          <em style={styles.titleEm}>tell the story?</em>
        </h1>
        <p style={{ ...styles.subtitle, maxWidth: 520, margin: '0 auto' }}>
          Pick a path. Our smart layout engine will arrange your album for you.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {(
          [
            { type: 'engagement', title: 'Engagement', desc: 'Romantic couple session' },
            { type: 'wedding', title: 'Wedding Day', desc: 'Full ceremony & reception' },
            { type: 'family', title: 'Family Portrait', desc: 'Generations together' },
            { type: 'custom', title: 'Custom Event', desc: 'Any special occasion' },
          ] as { type: PathType; title: string; desc: string }[]
        ).map((o) => (
          <button
            key={o.type}
            type="button"
            onClick={() => {
              setPathType(o.type)
              setStep('upload')
            }}
            style={styles.card}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, styles.cardHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(184,150,90,0.2)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <p style={styles.cardTitle}>{o.title}</p>
            <p style={styles.cardDesc}>{o.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )

  const renderUpload = () => (
    <div style={styles.container}>
      <h2 style={styles.title}>
        Upload your <em style={styles.titleEm}>photos</em>
      </h2>
      <p style={styles.subtitle}>Maximum 100 photos · Heroes need 3000×3000px minimum</p>

      <div
        onClick={() => fileInputRef.current?.click()}
        style={styles.uploadZone}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = GOLD)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(184,150,90,0.4)')}
      >
        <IconUpload width={36} height={36} style={{ marginBottom: 12 }} />
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)' }}>
          Click to select photos
        </p>
        <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, marginTop: 8 }}>
          {photos.length} / 100 photos uploaded
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {photos.length > 0 && (
        <div
          style={{
            marginTop: 32,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          {photos.map((photo) => (
            <div
              key={photo.id}
              style={{
                aspectRatio: '1',
                borderRadius: 8,
                overflow: 'hidden',
                border: '0.5px solid rgba(184,150,90,0.2)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={styles.btnSecondary} onClick={() => setStep('path')}>
            ← Back
          </button>
          <button type="button" style={styles.btnPrimary} onClick={() => setStep('group')}>
            Continue →
          </button>
        </div>
      )}
    </div>
  )

  const renderGroup = () => (
    <div style={styles.container}>
      <h2 style={styles.title}>
        Group by <em style={styles.titleEm}>event</em>
      </h2>
      <p style={styles.subtitle}>Organize photos into ceremony, reception, etc.</p>

      <div style={{ display: 'grid', gap: 20 }}>
        {eventGroups.map((g) => (
          <div
            key={g.id}
            style={{
              background: 'var(--dark2)',
              border: '0.5px solid rgba(184,150,90,0.2)',
              borderRadius: 12,
              padding: 20,
            }}
          >
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', marginBottom: 12 }}>
              {g.name}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
              {g.photos.map((photo) => (
                <div key={photo.id} style={{ aspectRatio: '1', borderRadius: 4, overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, marginTop: 10 }}>
              {g.photos.length} photos
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
        <button type="button" style={styles.btnSecondary} onClick={() => setStep('upload')}>
          ← Back
        </button>
        <button type="button" style={styles.btnPrimary} onClick={() => setStep('tag')}>
          Continue →
        </button>
      </div>
    </div>
  )

  const renderTag = () => {
    const heroCount = photos.filter((p) => p.tagged === 'hero').length
    const favCount = photos.filter((p) => p.tagged === 'favorite').length

    return (
      <div style={styles.container}>
        <h2 style={styles.title}>
          Tag your <em style={styles.titleEm}>best shots</em>
        </h2>
        <p style={styles.subtitle}>Heroes get full spreads. Favorites get prominent placement.</p>

        <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconStar width={16} height={16} />
            <span style={{ fontSize: 11, letterSpacing: 1, color: 'var(--cream)' }}>
              {heroCount} / 8 Heroes
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconHeart width={16} height={16} />
            <span style={{ fontSize: 11, letterSpacing: 1, color: 'var(--cream)' }}>
              {favCount} / 30 Favorites
            </span>
          </div>
        </div>

        <div style={{ ...styles.notice, marginBottom: 28 }}>
          <strong style={{ color: 'var(--cream)' }}>Heroes</strong> (8 max): full-spread worthy.{' '}
          <strong style={{ color: 'var(--cream)' }}>Favorites</strong> (30 max): featured prominently. Others fill the gaps.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {photos.map((photo) => (
            <div key={photo.id} style={{ position: 'relative' }}>
              <div
                style={{
                  aspectRatio: '1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border:
                    photo.tagged === 'hero'
                      ? `1.5px solid ${GOLD}`
                      : photo.tagged === 'favorite'
                      ? '1.5px solid #ff8a8a'
                      : '0.5px solid rgba(184,150,90,0.2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => toggleTag(photo.id, 'hero')}
                  title="Mark as hero"
                  style={{
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: '50%',
                    background: photo.tagged === 'hero' ? GOLD : 'rgba(0,0,0,0.6)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconStar width={14} height={14} fill={photo.tagged === 'hero' ? '#0e0c09' : GOLD} />
                </button>
                <button
                  type="button"
                  onClick={() => toggleTag(photo.id, 'favorite')}
                  title="Mark as favorite"
                  style={{
                    width: 28,
                    height: 28,
                    border: 'none',
                    borderRadius: '50%',
                    background: photo.tagged === 'favorite' ? '#ff8a8a' : 'rgba(0,0,0,0.6)',
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
          <button type="button" style={styles.btnSecondary} onClick={() => setStep('group')}>
            ← Back
          </button>
          <button
            type="button"
            style={{ ...styles.btnPrimary, opacity: heroCount === 0 ? 0.4 : 1, cursor: heroCount === 0 ? 'not-allowed' : 'pointer' }}
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
    const totalPrice = basePrice + extraCost

    return (
      <div style={{ ...styles.container, maxWidth: 640 }}>
        <h2 style={styles.title}>
          Album <em style={styles.titleEm}>length</em>
        </h2>
        <p style={styles.subtitle}>Base price includes 10 spreads (20 pages).</p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
            Spreads
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: GOLD }}>{pageCount}</span>
        </div>

        <input
          type="range"
          min="10"
          max="25"
          value={pageCount}
          onChange={(e) => setPageCount(parseInt(e.target.value))}
          style={{
            width: '100%',
            height: 4,
            accentColor: GOLD,
            cursor: 'pointer',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: 1, color: 'var(--muted2)', marginTop: 8 }}>
          <span>10 spreads</span>
          <span>25 spreads</span>
        </div>

        <div
          style={{
            background: 'var(--dark2)',
            border: '0.5px solid rgba(184,150,90,0.2)',
            borderRadius: 12,
            padding: 24,
            marginTop: 32,
          }}
        >
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
            <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
              Total
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: GOLD }}>${totalPrice}</span>
          </div>
        </div>

        <div style={{ ...styles.notice, marginTop: 24 }}>
          <strong style={{ color: 'var(--cream)' }}>How the engine arranges:</strong>
          <ul style={{ marginTop: 8, paddingLeft: 18, lineHeight: 2 }}>
            <li>Heroes get full-spread layouts</li>
            <li>Favorites paired (2 per spread)</li>
            <li>Other photos fill remaining space</li>
            <li>Optimized for visual flow & story arc</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
          <button type="button" style={styles.btnSecondary} onClick={() => setStep('tag')}>
            ← Back
          </button>
          <button type="button" style={styles.btnPrimary} onClick={() => setStep('adjust')}>
            Generate Preview →
          </button>
        </div>
      </div>
    )
  }

  const renderAdjust = () => (
    <div style={styles.container}>
      <h2 style={styles.title}>
        Review &amp; <em style={styles.titleEm}>adjust</em>
      </h2>
      <p style={styles.subtitle}>Smart-generated layout · Drag to reorder before finalizing.</p>

      <div style={{ ...styles.notice, marginBottom: 28 }}>
        <strong style={{ color: 'var(--cream)' }}>⚡ Beta:</strong> Layout engine in active testing.
        Drag-to-reorder coming soon.
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {Array.from({ length: Math.min(3, pageCount) }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--dark2)',
              border: '0.5px solid rgba(184,150,90,0.2)',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <p style={{ fontSize: 9, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase', marginBottom: 12 }}>
              Spread {i + 1}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ aspectRatio: '3/2', background: 'var(--dark3)', borderRadius: 4 }} />
              <div style={{ aspectRatio: '3/2', background: 'var(--dark3)', borderRadius: 4 }} />
            </div>
          </div>
        ))}
        {pageCount > 3 && (
          <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted2)', letterSpacing: 1 }}>
            … and {pageCount - 3} more spreads
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
        <button type="button" style={styles.btnSecondary} onClick={() => setStep('pages')}>
          ← Back
        </button>
        <button type="button" style={styles.btnPrimary} onClick={() => setStep('submit')}>
          Submit Order →
        </button>
      </div>
    </div>
  )

  const renderSubmit = () => (
    <div style={{ ...styles.container, maxWidth: 560, textAlign: 'center', paddingTop: 40 }}>
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

      <h2 style={styles.title}>
        Design <em style={styles.titleEm}>submitted.</em>
      </h2>
      <p style={styles.subtitle}>Order #FF-{Date.now().toString().slice(-6)}</p>

      <div
        style={{
          background: 'var(--dark2)',
          border: '0.5px solid rgba(184,150,90,0.2)',
          borderRadius: 12,
          padding: '24px 28px',
          textAlign: 'left',
          marginBottom: 32,
        }}
      >
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          What happens next
        </p>
        <ol style={{ paddingLeft: 18, lineHeight: 2, fontSize: 12, color: 'var(--cream)' }}>
          <li>Smart engine processes your tags &amp; groups</li>
          <li>Design team reviews the auto-generated layout</li>
          <li>You&apos;ll receive a final PDF proof within 48 hours</li>
          <li>After approval, printing begins (5–7 business days)</li>
        </ol>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={styles.btnSecondary}
          onClick={() => {
            setStep('path')
            setPathType(null)
            setPhotos([])
            setEventGroups([])
            setPageCount(15)
          }}
        >
          Start New
        </button>
        <Link href="/" style={{ ...styles.btnPrimary, textDecoration: 'none', display: 'inline-block', textAlign: 'center', width: 'auto' }}>
          Back to Home
        </Link>
      </div>
    </div>
  )

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <Link href="/" style={styles.logo}>
          Folio &amp; Forever
        </Link>
        <Link href="/design" style={styles.navBack}>
          ← Back to Design
        </Link>
      </nav>

      {step === 'path' && renderPath()}
      {step === 'upload' && renderUpload()}
      {step === 'group' && renderGroup()}
      {step === 'tag' && renderTag()}
      {step === 'pages' && renderPages()}
      {step === 'adjust' && renderAdjust()}
      {step === 'submit' && renderSubmit()}
    </div>
  )
}
