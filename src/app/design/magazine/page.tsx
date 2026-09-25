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
import {
  MAG_FONTS,
  MAG_FONTS_HREF,
  MAG_FONT_FAMILY,
  SAMPLE_META,
  defaultTexts,
  resolveText,
  type MagMeta,
  type MagText,
} from '@/lib/magazine/text'
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
  /** Couple's names + date — auto-fill every page's text. */
  meta?: MagMeta
  /** Edited text per page id (pages not listed use the design's text). */
  textEdits?: Record<string, MagText[]>
}

const EMPTY_META: MagMeta = { bride: '', groom: '', date: '' }

/** Text blocks for a page with names/date filled in. */
function pageTexts(pg: MagPage, edits: Record<string, MagText[]>, meta: MagMeta): MagText[] {
  const list = edits[pg.id] ?? defaultTexts(pg.id, pg.texts)
  return list.map((t) => ({ ...t, text: resolveText(t.text, meta) }))
}

/** Is a colour light? (for picking readable default text colour). */
function isLight(hex: string): boolean {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
  if (!m) return false
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}

const TEXT_COLOURS = ['#ffffff', '#f4ede8', '#2a1a12', '#111111', '#8f2e0d', '#b8965a', '#3f4a36', '#8a7d6b']

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

/** Sample photos — served from /public/magazine-samples (cut from the
 *  owner's own magazine reference pages). Self-hosted so the preview
 *  never depends on a third-party image service.
 *  [width, height] of each file; reported ×3 so the demo doesn't show
 *  LOW RES badges (these are only for trying the layout, never printed). */
const SAMPLE_DIMS: [number, number][] = [[1163, 1400], [983, 1400], [1142, 1400], [1182, 1400], [905, 1400], [990, 1400], [981, 1400], [1400, 526], [1400, 616], [1400, 525], [931, 1400], [959, 1330], [1030, 1400], [1030, 1400], [1278, 1400], [1400, 1308], [1245, 1400], [1041, 1400], [916, 1400], [1378, 875], [1400, 875], [1400, 755], [1400, 1000], [971, 1400]]
const SAMPLE_DIR = '/magazine-samples'

function samplePhotos(count: number = MAG_SLOT_COUNT, thumbs = false): Photo[] {
  return Array.from({ length: count }, (_, i) => {
    const k = i % SAMPLE_DIMS.length
    const [w, h] = SAMPLE_DIMS[k]
    const file = `${String(k).padStart(2, '0')}.jpg`
    return {
      id: `sample-${i}`,
      preview: thumbs ? `${SAMPLE_DIR}/t/${file}` : `${SAMPLE_DIR}/${file}`,
      width: w * 3,
      height: h * 3,
      order: i,
    }
  })
}

/** The empty-state preview: the 20 pages filled with sample photos so
 *  clients see the finished look before uploading. Small image sizes —
 *  these are thumbnails only (never used for print). */
function previewFill(style: MagStyle): { map: Map<string, Photo>; pages: (string | null)[][] } {
  const ph = samplePhotos(magSlotCount(style), true)
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
  const [meta, setMeta] = useState<MagMeta>(EMPTY_META)
  const [textEdits, setTextEdits] = useState<Record<string, MagText[]>>({})
  const [selText, setSelText] = useState<{ page: number; id: string } | null>(null)
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
          setMeta({ ...EMPTY_META, ...(s.meta ?? {}) })
          setTextEdits(s.textEdits ?? {})
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
    const s: SavedState = { v: 1, photos, pages, adjusts, styleId, meta, textEdits }
    try {
      localStorage.setItem(`${STATE_PREFIX}:${albumId}`, JSON.stringify(s))
    } catch {
      /* quota */
    }
    upsertIndex(albumId, { mode: 'magazine' })
  }, [hydrated, albumId, photos, pages, adjusts, styleId, meta, textEdits])

  /* ── magazine fonts (loaded only on this page) ── */
  useEffect(() => {
    if (document.querySelector('link[data-mag-fonts]')) return
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = MAG_FONTS_HREF
    l.setAttribute('data-mag-fonts', '1')
    document.head.appendChild(l)
  }, [])

  /* ── text editing ── */
  const editList = useCallback(
    (pi: number, fn: (list: MagText[]) => MagText[]) => {
      const pg = SP[pi]
      setTextEdits((prev) => ({ ...prev, [pg.id]: fn(prev[pg.id] ?? defaultTexts(pg.id, pg.texts)) }))
    },
    [SP],
  )
  const updateText = useCallback(
    (pi: number, id: string, patch: Partial<MagText>) => editList(pi, (l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [editList],
  )
  const deleteText = useCallback(
    (pi: number, id: string) => {
      editList(pi, (l) => l.filter((t) => t.id !== id))
      setSelText(null)
    },
    [editList],
  )
  const addText = useCallback(
    (pi: number) => {
      const pg = SP[pi]
      const light = pg.bg.kind === 'color' ? isLight(pg.bg.color) : false
      const id = `${pg.id}-u${Date.now().toString(36)}`
      editList(pi, (l) => [
        ...l,
        { id, text: 'Your words here', x: 50, y: 50, w: 70, size: 3.4, font: 'playfair', color: light ? '#2a1a12' : '#ffffff', italic: true, shadow: !light },
      ])
      setSel(null)
      setSelText({ page: pi, id })
    },
    [SP, editList],
  )
  const restoreTexts = useCallback(
    (pi: number) => {
      const pg = SP[pi]
      setTextEdits((prev) => {
        const n = { ...prev }
        delete n[pg.id]
        return n
      })
      setSelText(null)
      flash(`Page ${pi + 1} text restored`)
    },
    [SP, flash],
  )

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
        setSelText(null)
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
      setSelText(null)
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
    <div style={{ minHeight: '100vh', background: 'var(--dark)', paddingBottom: sel ? 160 : selText ? 300 : 60 }}>
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
                      texts={pageTexts(st.pages[k], textEdits, meta)}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 9, letterSpacing: 2.5, color: GOLD, fontWeight: 600 }}>
                  STYLE {String(idx + 1).padStart(2, '0')}
                  {on && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        background: GOLD,
                        color: '#0e0c09',
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: 1.5,
                        padding: '3px 8px',
                        borderRadius: 20,
                      }}
                    >
                      ✓ SELECTED
                    </span>
                  )}
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
              </button>
            )
          })}
        </div>
      </section>

      {/* ── names & date (auto-fill all text) ── */}
      <section
        style={{
          maxWidth: 980,
          margin: '0 auto 18px',
          padding: '14px 22px',
          background: 'var(--dark2)',
          border: '0.5px solid rgba(184,150,90,0.2)',
          borderRadius: 10,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', fontWeight: 600 }}>Your names & date</div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 3 }}>Fills in every headline and caption. Click any text on a page to edit it.</div>
        </div>
        {(
          [
            ['bride', 'Bride', SAMPLE_META.bride],
            ['groom', 'Groom', SAMPLE_META.groom],
            ['date', 'Wedding date', SAMPLE_META.date],
          ] as const
        ).map(([k, label, ph]) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, letterSpacing: 1.5, color: 'var(--muted2)', textTransform: 'uppercase' }}>
            {label}
            <input
              value={meta[k]}
              placeholder={ph}
              maxLength={40}
              onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))}
              style={{
                background: 'rgba(0,0,0,0.25)',
                border: '0.5px solid rgba(184,150,90,0.4)',
                borderRadius: 6,
                padding: '8px 10px',
                color: 'var(--cream)',
                fontSize: 13,
                width: k === 'date' ? 170 : 130,
                fontFamily: 'var(--font-body)',
                letterSpacing: 0.3,
                textTransform: 'none',
              }}
            />
          </label>
        ))}
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
                  texts={pageTexts(pg, textEdits, meta)}
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
                        texts={pageTexts(SP[pi], textEdits, meta)}
                        selectedTextId={selText && selText.page === pi ? selText.id : null}
                        onTextSelect={(id) => {
                          setSel(null)
                          setSwapFrom(null)
                          setArmed(null)
                          setSelText({ page: pi, id })
                        }}
                        onTextMove={(id, x, y) => updateText(pi, id, { x, y })}
                      />
                    ),
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 6 }}>
                  {[l, r].map((pi, k) => (
                    <div
                      key={k}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 9, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}
                    >
                      {pi !== null && (
                        <>
                          <span>Page {pi + 1}</span>
                          <button type="button" data-help="mag-add-text" onClick={() => addText(pi)} style={miniBtn}>
                            + Text
                          </button>
                          {textEdits[SP[pi].id] && (
                            <button type="button" onClick={() => restoreTexts(pi)} style={miniBtn} title="Put back this page's original text">
                              ↺ Restore text
                            </button>
                          )}
                        </>
                      )}
                    </div>
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

      {/* ── text toolbar ── */}
      {selText && pages && (() => {
        const list = textEdits[SP[selText.page].id] ?? defaultTexts(SP[selText.page].id, SP[selText.page].texts)
        const tx = list.find((x) => x.id === selText.id)
        if (!tx) return null
        const up = (patch: Partial<MagText>) => updateText(selText.page, tx.id, patch)
        const shown = resolveText(tx.text, meta)
        return (
          <div
            data-help="mag-text-toolbar"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 30,
              background: 'rgba(14,12,9,0.97)',
              borderTop: '0.5px solid rgba(184,150,90,0.35)',
              padding: '12px 16px 14px',
              maxHeight: '55vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>Text · Page {selText.page + 1}</span>
                <span style={{ fontSize: 10, color: 'var(--muted2)' }}>Drag the text on the page to move it</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" style={{ ...btn(false), color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.45)' }} onClick={() => deleteText(selText.page, tx.id)}>
                    Delete text
                  </button>
                  <button type="button" style={btn(true)} onClick={() => setSelText(null)}>
                    Done
                  </button>
                </span>
              </div>
              <textarea
                value={shown}
                onChange={(e) => up({ text: e.target.value })}
                rows={shown.length > 70 ? 3 : 2}
                aria-label="Text"
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.3)',
                  border: '0.5px solid rgba(184,150,90,0.45)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  color: 'var(--cream)',
                  fontSize: 14,
                  fontFamily: MAG_FONT_FAMILY[tx.font],
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                {MAG_FONTS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    title={f.note}
                    onClick={() => up({ font: f.id })}
                    style={{
                      flexShrink: 0,
                      minWidth: 92,
                      background: tx.font === f.id ? 'rgba(184,150,90,0.2)' : 'transparent',
                      border: tx.font === f.id ? `1px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.35)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      color: 'var(--cream)',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontFamily: MAG_FONT_FAMILY[f.id], fontSize: 18, lineHeight: 1.2 }}>{f.label}</div>
                    <div style={{ fontSize: 8.5, letterSpacing: 1, color: 'var(--muted2)', textTransform: 'uppercase', marginTop: 2 }}>{f.note}</div>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <label style={tbLabel}>
                  Size
                  <input type="range" min={0.8} max={14} step={0.1} value={tx.size} onChange={(e) => up({ size: Number(e.target.value) })} style={{ accentColor: GOLD, width: 110 }} />
                </label>
                <label style={tbLabel}>
                  Width
                  <input type="range" min={10} max={100} step={1} value={tx.w} onChange={(e) => up({ w: Number(e.target.value) })} style={{ accentColor: GOLD, width: 90 }} />
                </label>
                <label style={tbLabel}>
                  Spacing
                  <input type="range" min={0} max={0.5} step={0.01} value={tx.spacing ?? 0} onChange={(e) => up({ spacing: Number(e.target.value) })} style={{ accentColor: GOLD, width: 80 }} />
                </label>
                <span style={{ display: 'flex', gap: 4 }}>
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button key={a} type="button" onClick={() => up({ align: a })} style={toggleBtn((tx.align ?? 'center') === a)} aria-label={`Align ${a}`}>
                      {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                    </button>
                  ))}
                  <button type="button" onClick={() => up({ weight: (tx.weight ?? 400) >= 600 ? 400 : 700 })} style={{ ...toggleBtn((tx.weight ?? 400) >= 600), fontWeight: 800 }}>
                    B
                  </button>
                  <button type="button" onClick={() => up({ italic: !tx.italic })} style={{ ...toggleBtn(!!tx.italic), fontStyle: 'italic' }}>
                    I
                  </button>
                  <button type="button" onClick={() => up({ upper: !tx.upper })} style={toggleBtn(!!tx.upper)} title="Capital letters">
                    AA
                  </button>
                  <button type="button" onClick={() => up({ shadow: !tx.shadow })} style={toggleBtn(!!tx.shadow)} title="Soft shadow (for text on photos)">
                    ◐
                  </button>
                </span>
                <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {TEXT_COLOURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      onClick={() => up({ color: c })}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        background: c,
                        border: tx.color.toLowerCase() === c ? `2px solid ${GOLD}` : '0.5px solid rgba(255,255,255,0.35)',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  ))}
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(tx.color) ? tx.color : '#ffffff'} onChange={(e) => up({ color: e.target.value })} aria-label="Custom colour" style={{ width: 26, height: 22, padding: 0, border: 'none', background: 'none' }} />
                </span>
              </div>
            </div>
          </div>
        )
      })()}

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

const miniBtn: CSSProperties = {
  background: 'transparent',
  border: '0.5px solid rgba(184,150,90,0.4)',
  color: GOLD,
  borderRadius: 20,
  padding: '3px 9px',
  fontSize: 8.5,
  letterSpacing: 1.2,
  cursor: 'pointer',
  textTransform: 'uppercase',
}

const tbLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 9.5,
  letterSpacing: 1.5,
  color: 'var(--cream)',
  textTransform: 'uppercase',
}

function toggleBtn(on: boolean): CSSProperties {
  return {
    minWidth: 30,
    height: 28,
    borderRadius: 6,
    border: on ? `1px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.4)',
    background: on ? 'rgba(184,150,90,0.25)' : 'transparent',
    color: 'var(--cream)',
    cursor: 'pointer',
    fontSize: 12,
  }
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
