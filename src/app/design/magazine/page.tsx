'use client'

// /design/magazine — "Create Your Magazine"
//
// Fixed 20-page, 8.5 × 11 in portrait magazine at a flat $70. The layout
// is pre-designed (src/lib/magazine/pages.ts): the client uploads photos,
// we fill the pages in order (orientation-aware), and they fine-tune —
// swap, replace, remove, pan and zoom. No layout switching, no adding or
// deleting pages.
//
// Persistence mirrors the smart wizard: state in localStorage
// (`folio-mag-state:<id>`), photo blobs in IndexedDB (photo-blob-store,
// same per-album keys), and an entry in the shared My Albums index with
// mode 'magazine' so /design lists it.
//
// Cover choice + checkout arrive in the next change set.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { saveBlob, loadAlbumBlobs, deleteBlob } from '../smart/edit/photo-blob-store'
import { readJpegCaptureTime } from '@/lib/exif'
import {
  DEFAULT_MAG_STYLE,
  MAG_PAGE_COUNT,
  MAG_PRICE,
  MAG_SLOT_COUNT,
  MAG_STYLES,
  fillMagazine,
  getMagStyle,
  magSlotBox,
  magSlotCount,
  type MagPage,
  type MagStyle,
} from '@/lib/magazine/pages'
import HelpSearch from '../help/HelpSearch'
import MagPageView, {
  MAG_DEFAULT_ADJUST,
  slotDpi,
  type MagAdjust,
  type MagPhoto,
} from './MagPageView'

export const runtime = 'edge'

const GOLD = '#b8965a'
const INDEX_KEY = 'folio-albums-index'
const STATE_PREFIX = 'folio-mag-state'
const PHOTO_CAP = 80
/** Zoom ceiling (owner rule for all products: 200%). */
const MAX_ZOOM = 2

type Photo = MagPhoto & { capturedAt?: number; order: number }

type SavedState = {
  v: 1
  photos: Photo[]
  pages: (string | null)[][] | null
  adjusts: Record<string, MagAdjust>
  /** Chosen design (added with multiple styles; missing = terracotta). */
  styleId?: string
}

type IndexEntry = {
  id: string
  name: string
  createdAt: string
  lastEditedAt: string
  mode?: 'smart' | 'manual' | 'magazine'
}

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function upsertIndex(id: string, patch: Partial<IndexEntry>) {
  try {
    const list = readIndex()
    const now = new Date().toISOString()
    const e = list.find((a) => a.id === id)
    if (e) Object.assign(e, patch, { lastEditedAt: now })
    else list.unshift({ id, name: 'My Magazine', createdAt: now, lastEditedAt: now, ...patch })
    localStorage.setItem(INDEX_KEY, JSON.stringify(list))
  } catch {
    /* storage full / disabled */
  }
}
function newId(): string {
  return 'm' + Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 6)
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((res) => {
    const img = new window.Image()
    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => res({ width: 0, height: 0 })
    img.src = src
  })
}

/** Demo photos (stable URLs, no upload) so the layout can be tried fast. */
function samplePhotos(count: number = MAG_SLOT_COUNT): Photo[] {
  return Array.from({ length: count }, (_, i) => {
    const land = i % 4 === 1
    const w = land ? 6000 : 4000
    const h = land ? 4000 : 6000
    return {
      id: `sample-${i}`,
      preview: `https://picsum.photos/seed/folio-mag-${i}/${land ? 1500 : 1000}/${land ? 1000 : 1500}`,
      width: w,
      height: h,
      order: i,
    }
  })
}

/** The empty-state preview: the 20 pages filled with sample photos so
 *  clients see the finished look before uploading. Small image sizes —
 *  these are thumbnails only (never used for print). */
function previewFill(style: MagStyle): { map: Map<string, Photo>; pages: (string | null)[][] } {
  const ph = samplePhotos(magSlotCount(style)).map((p) => {
    const land = p.width > p.height
    return { ...p, preview: `https://picsum.photos/seed/folio-mag-${p.order}/${land ? 480 : 320}/${land ? 320 : 480}` }
  })
  return { map: new Map(ph.map((p) => [p.id, p] as const)), pages: fillMagazine(ph, style.pages) }
}

/* ───────────────────────────── page ───────────────────────────── */

function MagazineDesigner() {
  const router = useRouter()
  const params = useSearchParams()
  const urlId = params?.get('album') ?? null

  const [albumId, setAlbumId] = useState<string | null>(urlId)
  const [hydrated, setHydrated] = useState(false)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [pages, setPages] = useState<(string | null)[][] | null>(null)
  const [adjusts, setAdjusts] = useState<Record<string, MagAdjust>>({})
  const [styleId, setStyleId] = useState<string>(DEFAULT_MAG_STYLE)
  const style = getMagStyle(styleId)
  const SP: MagPage[] = style.pages
  const [sel, setSel] = useState<{ page: number; slot: number } | null>(null)
  const [swapFrom, setSwapFrom] = useState<{ page: number; slot: number } | null>(null)
  const [armed, setArmed] = useState<string | null>(null) // tray photo picked up
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fillTarget = useRef<{ page: number; slot: number } | null>(null)

  const flash = useCallback((m: string) => {
    setToast(m)
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600)
  }, [])

  /* ── mint / hydrate ── */
  useEffect(() => {
    let id = urlId
    if (!id) {
      id = newId()
      upsertIndex(id, { name: 'My Magazine', mode: 'magazine' })
      router.replace(`/design/magazine?album=${id}`)
      setAlbumId(id)
    }
    const aid = id
    ;(async () => {
      try {
        const raw = localStorage.getItem(`${STATE_PREFIX}:${aid}`)
        if (raw) {
          const s = JSON.parse(raw) as SavedState
          const blobs = await loadAlbumBlobs(aid)
          const ph = (s.photos || [])
            .map((p) => (p.preview.startsWith('blob:') ? { ...p, preview: blobs.get(p.id) ?? '' } : p))
            .filter((p) => p.preview)
          const alive = new Set(ph.map((p) => p.id))
          setPhotos(ph)
          setPages(s.pages ? s.pages.map((pg) => pg.map((x) => (x && alive.has(x) ? x : null))) : null)
          setAdjusts(s.adjusts || {})
          setStyleId(getMagStyle(s.styleId).id)
        }
      } catch {
        /* corrupt state → start fresh */
      }
      setHydrated(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── autosave ── */
  useEffect(() => {
    if (!hydrated || !albumId) return
    const s: SavedState = { v: 1, photos, pages, adjusts, styleId }
    try {
      localStorage.setItem(`${STATE_PREFIX}:${albumId}`, JSON.stringify(s))
    } catch {
      /* quota */
    }
    upsertIndex(albumId, { mode: 'magazine' })
  }, [hydrated, albumId, photos, pages, adjusts, styleId])

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p] as const)), [photos])
  const previews = useMemo(() => new Map(MAG_STYLES.map((st) => [st.id, previewFill(st)] as const)), [])
  const preview = previews.get(style.id) ?? previewFill(style)
  const placed = useMemo(() => new Set((pages ?? []).flat().filter(Boolean) as string[]), [pages])
  const unused = useMemo(() => photos.filter((p) => !placed.has(p.id)), [photos, placed])
  const filledSlots = placed.size

  /* ── upload ── */
  const addFiles = useCallback(
    async (files: FileList | null, target?: { page: number; slot: number } | null) => {
      if (!files || !albumId) return
      const room = PHOTO_CAP - photos.length
      const list = Array.from(files).filter((f) => /^image\//.test(f.type)).slice(0, Math.max(0, room))
      if (list.length === 0) {
        if (room <= 0) flash(`Photo limit reached (${PHOTO_CAP})`)
        return
      }
      setBusy(`Adding ${list.length} photo${list.length === 1 ? '' : 's'}…`)
      const base = photos.reduce((m, p) => Math.max(m, p.order + 1), 0)
      const added: Photo[] = []
      for (let k = 0; k < list.length; k++) {
        const f = list[k]
        const id = 'p' + Math.random().toString(36).slice(2, 10)
        const preview = URL.createObjectURL(f)
        const dims = await imageSize(preview)
        let capturedAt: number | undefined
        try {
          capturedAt = (await readJpegCaptureTime(f)) ?? undefined
        } catch {
          /* no EXIF */
        }
        await saveBlob(albumId, id, f)
        added.push({ id, preview, ...dims, capturedAt, order: base + k })
      }
      setPhotos((prev) => [...prev, ...added])
      if (target && pages && added[0]) {
        setPages((prev) => {
          if (!prev) return prev
          const next = prev.map((pg) => [...pg])
          next[target.page][target.slot] = added[0].id
          return next
        })
      }
      setBusy(null)
    },
    [albumId, photos, pages, flash],
  )

  /* ── build / rebuild ── */
  const build = useCallback((pagesDef?: MagPage[]) => {
    const ordered = [...photos].sort((a, b) => {
      if (a.capturedAt && b.capturedAt) return a.capturedAt - b.capturedAt
      return a.order - b.order
    })
    setPages(fillMagazine(ordered, pagesDef ?? SP))
    setAdjusts({})
    setSel(null)
    setSwapFrom(null)
    setArmed(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [photos, SP])

  /* ── style switch ── */
  const chooseStyle = useCallback(
    (id: string) => {
      if (id === styleId) return
      const next = getMagStyle(id)
      if (pages) {
        if (!window.confirm(`Switch to ${next.name}? Your photos will be re-placed into the new design (swaps and crops reset).`)) return
        setStyleId(next.id)
        build(next.pages)
        flash(`Now designing in ${next.name}`)
      } else {
        setStyleId(next.id)
      }
    },
    [styleId, pages, build, flash],
  )

  /* ── editing ops ── */
  const setSlot = useCallback((p: number, s: number, id: string | null) => {
    setPages((prev) => {
      if (!prev) return prev
      const next = prev.map((pg) => [...pg])
      next[p][s] = id
      return next
    })
    setAdjusts((a) => {
      const k = `${SP[p].id}::${s}`
      if (!(k in a)) return a
      const n = { ...a }
      delete n[k]
      return n
    })
  }, [SP])

  const onSlotClick = useCallback(
    (p: number, s: number) => {
      if (!pages) return
      const cur = pages[p][s]
      // 1) placing a picked-up tray photo
      if (armed) {
        setSlot(p, s, armed)
        setArmed(null)
        setSel({ page: p, slot: s })
        return
      }
      // 2) finishing a swap
      if (swapFrom) {
        if (swapFrom.page !== p || swapFrom.slot !== s) {
          const a = pages[swapFrom.page][swapFrom.slot]
          setPages((prev) => {
            if (!prev) return prev
            const next = prev.map((pg) => [...pg])
            next[swapFrom.page][swapFrom.slot] = cur
            next[p][s] = a
            return next
          })
          setAdjusts((ad) => {
            const n = { ...ad }
            delete n[`${SP[p].id}::${s}`]
            delete n[`${SP[swapFrom.page].id}::${swapFrom.slot}`]
            return n
          })
          flash('Swapped')
        }
        setSwapFrom(null)
        setSel({ page: p, slot: s })
        return
      }
      // 3) empty slot → upload into it
      if (!cur) {
        fillTarget.current = { page: p, slot: s }
        fileRef.current?.click()
        return
      }
      setSel((old) => (old && old.page === p && old.slot === s ? null : { page: p, slot: s }))
    },
    [pages, armed, swapFrom, setSlot, flash, SP],
  )

  const onAdjust = useCallback((p: number, s: number, next: MagAdjust) => {
    setAdjusts((a) => ({ ...a, [`${SP[p].id}::${s}`]: next }))
  }, [SP])

  const removePhotoEverywhere = useCallback(
    (id: string) => {
      setPages((prev) => (prev ? prev.map((pg) => pg.map((x) => (x === id ? null : x))) : prev))
      setPhotos((prev) => prev.filter((p) => p.id !== id))
      if (albumId && !id.startsWith('sample-')) deleteBlob(albumId, id)
    },
    [albumId],
  )

  const selPhotoId = sel && pages ? pages[sel.page][sel.slot] : null
  const selPhoto = selPhotoId ? photoMap.get(selPhotoId) : undefined
  const selAdj = sel ? adjusts[`${SP[sel.page].id}::${sel.slot}`] ?? MAG_DEFAULT_ADJUST : MAG_DEFAULT_ADJUST
  const selDpi =
    sel && selPhoto ? Math.round(slotDpi(selPhoto, magSlotBox(SP[sel.page].slots[sel.slot]), selAdj.zoom)) : 0

  // Spreads as they read in print: page 1 alone on the right, then pairs,
  // page 20 alone on the left.
  const spreads: [number | null, number | null][] = useMemo(() => {
    const out: [number | null, number | null][] = [[null, 0]]
    for (let i = 1; i < MAG_PAGE_COUNT - 1; i += 2) out.push([i, i + 1])
    out.push([MAG_PAGE_COUNT - 1, null])
    return out
  }, [])

  const needed = magSlotCount(style)

  if (!hydrated) {
    return <div style={{ padding: 80, textAlign: 'center', color: GOLD, letterSpacing: 2, fontSize: 11 }}>LOADING…</div>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark)', paddingBottom: sel ? 160 : 60 }}>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 5%',
          borderBottom: '0.5px solid rgba(184,150,90,0.15)',
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            letterSpacing: 4,
            color: 'var(--cream)',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          Folio Forever
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <HelpSearch app="magazine" />
          <Link href="/design" style={{ color: GOLD, fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', textDecoration: 'none' }}>
            ← All options
          </Link>
        </div>
      </nav>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const t = fillTarget.current
          fillTarget.current = null
          addFiles(e.target.files, t)
          e.target.value = ''
        }}
      />

      <header style={{ textAlign: 'center', padding: '44px 5% 28px' }}>
        <span
          style={{
            display: 'inline-block',
            border: '0.5px solid rgba(184,150,90,0.5)',
            borderRadius: 30,
            padding: '6px 18px',
            fontSize: 9,
            letterSpacing: 3,
            color: GOLD,
            textTransform: 'uppercase',
          }}
        >
          Create your magazine
        </span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 44, color: 'var(--cream)', marginTop: 18, lineHeight: 1.1 }}>
          Your story, <em style={{ color: GOLD }}>in print.</em>
        </h1>
        <p style={{ color: 'var(--muted2)', fontSize: 12, letterSpacing: 1, marginTop: 12, lineHeight: 1.8 }}>
          20 designed pages · 8.5 × 11 in portrait · <strong style={{ color: GOLD }}>${MAG_PRICE}</strong>
          <br />
          Upload about {needed} photos — we place them into the layout, you fine-tune.
        </p>
      </header>

      {/* ── style picker ── */}
      <section data-help="mag-styles" style={{ maxWidth: 980, margin: '0 auto 28px', padding: '0 16px' }}>
        <p style={{ textAlign: 'center', fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase', marginBottom: 14 }}>
          Choose your style
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          {MAG_STYLES.map((st, idx) => {
            const on = st.id === style.id
            const pv = previews.get(st.id)!
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => chooseStyle(st.id)}
                aria-pressed={on}
                style={{
                  textAlign: 'left',
                  background: on ? 'rgba(184,150,90,0.1)' : 'var(--dark2)',
                  border: on ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.25)',
                  borderRadius: 12,
                  padding: 12,
                  cursor: 'pointer',
                  color: 'var(--cream)',
                  position: 'relative',
                  transition: 'border-color .2s, background .2s',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3, marginBottom: 12, pointerEvents: 'none' }}>
                  {[0, 1, 2].map((k) => (
                    <MagPageView
                      key={k}
                      page={st.pages[k]}
                      photoIds={pv.pages[k]}
                      photoMap={pv.map}
                      adjusts={{}}
                      pageKey={st.pages[k].id}
                      selectedSlot={-1}
                      interactive={false}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 9, letterSpacing: 2.5, color: GOLD, fontWeight: 600 }}>
                  STYLE {String(idx + 1).padStart(2, '0')}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 800,
                    fontSize: 22,
                    letterSpacing: 5,
                    lineHeight: 1.2,
                    margin: '4px 0 6px',
                    color: 'var(--cream)',
                  }}
                >
                  {st.name}
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--muted2)', minHeight: 34 }}>{st.tagline}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  {st.swatches.map((c) => (
                    <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, border: '0.5px solid rgba(255,255,255,0.3)' }} />
                  ))}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted2)', letterSpacing: 0.5 }}>
                    ~{magSlotCount(st)} photos
                  </span>
                </div>
                {on && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 18,
                      right: 18,
                      background: GOLD,
                      color: '#0e0c09',
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      padding: '4px 9px',
                      borderRadius: 20,
                    }}
                  >
                    ✓ SELECTED
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* ── upload / status bar ── */}
      <section
        style={{
          maxWidth: 980,
          margin: '0 auto 28px',
          padding: '18px 22px',
          background: 'var(--dark2)',
          border: '0.5px solid rgba(184,150,90,0.2)',
          borderRadius: 10,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
            {pages ? 'Photos placed' : 'Photos uploaded'}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--cream)' }}>
            {pages ? filledSlots : photos.length} <span style={{ fontSize: 16, color: 'var(--muted2)' }}>/ {needed}</span>
          </div>
          <div style={{ height: 3, background: 'rgba(184,150,90,0.15)', borderRadius: 2, marginTop: 6 }}>
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: GOLD,
                width: `${Math.min(100, ((pages ? filledSlots : photos.length) / needed) * 100)}%`,
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button data-help="mag-upload" type="button" onClick={() => fileRef.current?.click()} style={btn(false)}>
            + Upload photos
          </button>
          {photos.length === 0 && (
            <button type="button" onClick={() => setPhotos(samplePhotos(needed))} style={btn(false)}>
              Try with sample photos
            </button>
          )}
          {photos.length > 0 && (
            <button data-help="mag-build"
              type="button"
              onClick={() => {
                if (pages && !window.confirm('Rebuild the magazine? Your swaps and crops will be reset.')) return
                build()
              }}
              style={btn(true)}
            >
              {pages ? 'Rebuild layout' : 'Build my magazine →'}
            </button>
          )}
        </div>
        {busy && <div style={{ width: '100%', fontSize: 11, color: GOLD }}>{busy}</div>}
        {!pages && photos.length > 0 && photos.length < needed && (
          <div style={{ width: '100%', fontSize: 11, color: 'var(--muted2)' }}>
            You can build now — any empty frames can be filled later.
          </div>
        )}
      </section>

      {/* ── before build: uploaded thumbnails ── */}
      {!pages && photos.length > 0 && (
        <section style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px' }}>
          {photos.map((p) => (
            <div key={p.id} style={{ position: 'relative', width: 78, height: 78 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => removePhotoEverywhere(p.id)}
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  border: 'none',
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: 11,
                  cursor: 'pointer',
                  lineHeight: '18px',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ── preview of the design before any photos ── */}
      {!pages && photos.length === 0 && (
        <section style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px' }}>
          <p style={{ textAlign: 'center', fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase', marginBottom: 4 }}>
            The 20 pages · <strong style={{ color: 'var(--cream)', letterSpacing: 3, fontWeight: 800 }}>{style.name}</strong>
          </p>
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted2)', marginBottom: 14, fontStyle: 'italic' }}>
            Shown with sample photos — yours go here.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
            {SP.map((pg, i) => (
              <div key={pg.id}>
                <MagPageView
                  page={pg}
                  photoIds={preview.pages[i] ?? pg.slots.map(() => null)}
                  photoMap={preview.map}
                  adjusts={{}}
                  pageKey={pg.id}
                  selectedSlot={-1}
                  interactive={false}
                />
                <div style={{ fontSize: 9, color: 'var(--muted2)', textAlign: 'center', marginTop: 4, letterSpacing: 1 }}>
                  {i + 1}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── editor: pages as printed spreads ── */}
      {pages && (
        <section style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px' }}>
          {(armed || swapFrom) && (
            <div
              style={{
                position: 'sticky',
                top: 8,
                zIndex: 20,
                margin: '0 auto 14px',
                width: 'fit-content',
                background: GOLD,
                color: '#0e0c09',
                borderRadius: 30,
                padding: '8px 18px',
                fontSize: 11,
                letterSpacing: 1,
                fontWeight: 600,
              }}
            >
              {armed ? 'Tap any frame to place this photo' : 'Tap another photo to swap with it'}
              <button
                type="button"
                onClick={() => {
                  setArmed(null)
                  setSwapFrom(null)
                }}
                style={{ marginLeft: 12, background: 'transparent', border: 'none', fontWeight: 700, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {spreads.map(([l, r], si) => (
              <div key={si}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
                  {[l, r].map((pi, k) =>
                    pi === null ? (
                      <div key={k} style={{ background: 'transparent' }} />
                    ) : (
                      <MagPageView
                        key={k}
                        page={SP[pi]}
                        photoIds={pages[pi]}
                        photoMap={photoMap}
                        adjusts={adjusts}
                        pageKey={SP[pi].id}
                        selectedSlot={sel && sel.page === pi ? sel.slot : -1}
                        onSlotClick={(s) => onSlotClick(pi, s)}
                        onAdjust={(s, n) => onAdjust(pi, s, n)}
                      />
                    ),
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 6 }}>
                  {[l, r].map((pi, k) => (
                    <span
                      key={k}
                      style={{ fontSize: 9, letterSpacing: 2, color: 'var(--muted2)', textAlign: 'center', textTransform: 'uppercase' }}
                    >
                      {pi === null ? '' : `Page ${pi + 1}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* unused tray */}
          <div style={{ marginTop: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
                Not in the magazine ({unused.length}) · tap one, then tap a frame
              </span>
              <button type="button" onClick={() => fileRef.current?.click()} style={btn(false)}>
                + Add photos
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {unused.length === 0 && <span style={{ fontSize: 11, color: 'var(--muted2)' }}>Every photo is placed.</span>}
              {unused.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (sel && pages[sel.page][sel.slot] !== undefined) {
                      setSlot(sel.page, sel.slot, p.id)
                      return
                    }
                    setArmed((a) => (a === p.id ? null : p.id))
                  }}
                  style={{
                    width: 72,
                    height: 72,
                    padding: 0,
                    border: armed === p.id ? `2px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.3)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: 'none',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          </div>

          {/* order — next change set */}
          <div
            style={{
              marginTop: 40,
              padding: '22px',
              textAlign: 'center',
              border: '0.5px solid rgba(184,150,90,0.25)',
              borderRadius: 10,
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--cream)' }}>
              20 pages · ${MAG_PRICE}
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 6, letterSpacing: 0.5 }}>
              Your design saves automatically on this device. Cover selection and checkout are coming next.
            </p>
            <button type="button" disabled style={{ ...btn(true), marginTop: 14, opacity: 0.45, cursor: 'not-allowed' }}>
              Choose cover & order — coming soon
            </button>
          </div>
        </section>
      )}

      {/* ── photo toolbar ── */}
      {sel && pages && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            background: 'rgba(14,12,9,0.96)',
            borderTop: '0.5px solid rgba(184,150,90,0.3)',
            padding: '12px 16px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 10, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>
            Page {sel.page + 1}
          </span>
          {selPhoto ? (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--cream)', letterSpacing: 1 }}>
                ZOOM
                <input
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={selAdj.zoom}
                  onChange={(e) => onAdjust(sel.page, sel.slot, { ...selAdj, zoom: Number(e.target.value) })}
                  style={{ accentColor: GOLD, width: 130 }}
                />
              </label>
              <span style={{ fontSize: 10, color: selDpi < 150 ? '#e57373' : 'var(--muted2)' }}>{selDpi} dpi</span>
              <span style={{ fontSize: 10, color: 'var(--muted2)' }}>Drag the photo to reposition</span>
              <button data-help="mag-swap" type="button" style={btn(false)} onClick={() => setSwapFrom(sel)}>
                Swap
              </button>
              <button type="button" style={btn(false)} onClick={() => onAdjust(sel.page, sel.slot, MAG_DEFAULT_ADJUST)}>
                Reset crop
              </button>
              <button
                type="button"
                style={btn(false)}
                onClick={() => {
                  setSlot(sel.page, sel.slot, null)
                  setSel(null)
                }}
              >
                Remove
              </button>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted2)' }}>Empty frame — tap a tray photo below or upload.</span>
          )}
          <button type="button" style={btn(true)} onClick={() => setSel(null)}>
            Done
          </button>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: sel ? 90 : 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--dark2)',
            border: `0.5px solid ${GOLD}`,
            color: 'var(--cream)',
            padding: '8px 18px',
            borderRadius: 30,
            fontSize: 11,
            zIndex: 40,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function btn(primary: boolean): CSSProperties {
  return {
    background: primary ? GOLD : 'transparent',
    color: primary ? '#0e0c09' : GOLD,
    border: `0.5px solid ${primary ? GOLD : 'rgba(184,150,90,0.5)'}`,
    borderRadius: 30,
    padding: '9px 18px',
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontWeight: primary ? 700 : 500,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  }
}

export default function MagazinePage() {
  return (
    <Suspense fallback={null}>
      <MagazineDesigner />
    </Suspense>
  )
}
