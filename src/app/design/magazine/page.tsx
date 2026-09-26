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
import { renderMagPage } from '@/lib/magazine/render'
import { withRetry } from '@/lib/print-image'
import { uploadToR2 } from '../smart/edit/submit-helpers'
import { LEGAL_VERSION, CLAUSE_PROOF_APPROVAL, CLAUSE_CONTENT_RIGHTS, CLAUSE_CONTENT_POLICY } from '@/lib/legal-clauses'
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
  // ── order + email preview ──
  const [orderStep, setOrderStep] = useState<null | 'review' | 'ship' | 'working'>(null)
  const [approved, setApproved] = useState(false)
  const [rightsOk, setRightsOk] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'United States', notes: '' })
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [orderErr, setOrderErr] = useState<string | null>(null)
  const [priceInfo, setPriceInfo] = useState<{ price: number; shippingUsd: number } | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailAddr, setEmailAddr] = useState('')
  const [emailState, setEmailState] = useState<'idle' | 'working' | 'sent'>('idle')
  const [emailErr, setEmailErr] = useState<string | null>(null)
  const [trayTab, setTrayTab] = useState<'unused' | 'all'>('unused')
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
  /** photo id → where it sits (first frame it appears in) */
  const placedAt = useMemo(() => {
    const m = new Map<string, { page: number; slot: number }>()
    ;(pages ?? []).forEach((pg, pi) => pg.forEach((id, si) => { if (id && !m.has(id)) m.set(id, { page: pi, slot: si }) }))
    return m
  }, [pages])

  /* ── print / preview rendering ── */
  const renderPage = useCallback(
    (pi: number, opts: { heightPx?: number; watermark?: boolean } = {}) => {
      if (!pages) throw new Error('Not built')
      const pg = SP[pi]
      return renderMagPage({
        page: pg,
        photoIds: pages[pi],
        photos: photoMap,
        adjusts,
        texts: textEdits[pg.id] ?? defaultTexts(pg.id, pg.texts),
        meta,
        heightPx: opts.heightPx,
        watermark: opts.watermark,
      })
    },
    [pages, SP, photoMap, adjusts, textEdits, meta],
  )

  const openOrder = useCallback(() => {
    setOrderErr(null)
    setApproved(false)
    setOrderStep('review')
    setSel(null)
    setSelText(null)
    fetch('/api/submit-magazine-order')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setPriceInfo({ price: j.price, shippingUsd: j.shippingUsd }))
      .catch(() => undefined)
  }, [])

  const runOrder = useCallback(async () => {
    if (!pages || !albumId) return
    const f = form
    if (!f.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setOrderErr('Please enter your name and a valid email.')
    if (!f.line1.trim() || !f.city.trim() || !f.postalCode.trim()) return setOrderErr('Please complete your shipping address.')
    setOrderErr(null)
    setOrderStep('working')
    try {
      const uploaded: { n: number; key: string; url: string }[] = []
      for (let pi = 0; pi < SP.length; pi++) {
        setProgress({ done: pi, total: SP.length, label: `Preparing page ${pi + 1} of ${SP.length} for print…` })
        let blob: Blob
        try {
          blob = await withRetry(() => renderPage(pi))
        } catch (e) {
          throw new Error(
            `Page ${pi + 1} could not be prepared for print (${e instanceof Error ? e.message : 'error'}). Nothing was charged — close other browser tabs and press the button again.`,
          )
        }
        const up = await uploadToR2(blob, albumId, `page-${String(pi + 1).padStart(2, '0')}.jpg`)
        uploaded.push({ n: pi + 1, key: up.key, url: up.url })
      }
      setProgress({ done: SP.length, total: SP.length, label: 'Saving your order…' })
      const now = new Date().toISOString()
      const res = await fetch('/api/submit-magazine-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          styleId: style.id,
          meta,
          customer: { name: f.name.trim(), email: f.email.trim() },
          shipping: { recipientName: f.name.trim(), phone: f.phone, line1: f.line1, line2: f.line2, city: f.city, region: f.region, postalCode: f.postalCode, country: f.country, notes: f.notes },
          pages: uploaded,
          photoCount: filledSlots,
          emptyFrames: pages.flat().filter((x) => x === null).length,
          proofApproval: { acceptedAt: now, clauseVersion: LEGAL_VERSION, clauseText: CLAUSE_PROOF_APPROVAL },
          contentRights: { acceptedAt: now, clauseVersion: LEGAL_VERSION, copyrightClause: CLAUSE_CONTENT_RIGHTS, policyClause: CLAUSE_CONTENT_POLICY },
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.token) throw new Error(j.error || 'Could not save your order')
      setProgress({ done: SP.length, total: SP.length, label: 'Opening secure payment…' })
      const pay = await fetch('/api/square-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: j.token }),
      })
      const pj = await pay.json().catch(() => ({}))
      if (!pay.ok || !pj.url) throw new Error(pj.error || 'Payment could not start — please try again')
      window.location.href = pj.url
    } catch (e) {
      setOrderErr(e instanceof Error ? e.message : 'Something went wrong — please try again')
      setOrderStep('ship')
      setProgress(null)
    }
  }, [pages, albumId, form, SP, renderPage, style, meta, filledSlots])

  const sendPreview = useCallback(async () => {
    if (!pages || !albumId) return
    const email = emailAddr.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setEmailErr('Please enter a valid email address.')
    setEmailErr(null)
    setEmailState('working')
    try {
      const urls: string[] = []
      for (let pi = 0; pi < SP.length; pi++) {
        setProgress({ done: pi, total: SP.length, label: `Making preview page ${pi + 1} of ${SP.length}…` })
        const blob = await withRetry(() => renderPage(pi, { heightPx: 1400, watermark: true }))
        const up = await uploadToR2(blob, albumId, `preview-${String(pi + 1).padStart(2, '0')}.jpg`)
        urls.push(up.url)
      }
      setProgress({ done: SP.length, total: SP.length, label: 'Sending…' })
      const res = await fetch('/api/email-magazine-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, albumId, styleName: style.name, names: resolveText('{bride} & {groom}', meta), pageUrls: urls }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Email could not be sent')
      setEmailState('sent')
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : 'Email could not be sent')
      setEmailState('idle')
    } finally {
      setProgress(null)
    }
  }, [pages, albumId, emailAddr, SP, renderPage, style, meta])


  /* ── build / rebuild ── */
  const build = useCallback((pagesDef?: MagPage[], list?: Photo[]) => {
    const ordered = [...(list ?? photos)].sort((a, b) => {
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
      // Real uploads replace the demo photos entirely.
      const isSample = (p: Photo) => p.id.startsWith('sample-')
      const hadSamples = photos.some(isSample)
      const all = [...(hadSamples ? photos.filter((p) => !isSample(p)) : photos), ...added]
      setPhotos(all)
      setBusy(null)

      if (target && pages && !hadSamples && added[0]) {
        // Uploading straight into one empty frame.
        setPages((prev) => {
          if (!prev) return prev
          const next = prev.map((pg) => [...pg])
          next[target.page][target.slot] = added[0].id
          return next
        })
        return
      }
      if (!pages || hadSamples) {
        // One click: upload → designed magazine.
        build(undefined, all)
        flash(`Your magazine is designed with ${Math.min(all.length, magSlotCount(style))} photos ✨`)
        return
      }
      // Already designed with real photos: fill any empty frames first,
      // the rest wait in the tray (✨ Auto-design uses them all).
      let k = 0
      setPages((prev) => {
        if (!prev) return prev
        return prev.map((pg) => pg.map((x) => (x === null && k < added.length ? added[k++].id : x)))
      })
      const placedNow = Math.min(k, added.length)
      flash(
        placedNow
          ? `${placedNow} photo${placedNow === 1 ? '' : 's'} placed in empty frames — press ✨ Auto-design to use them all`
          : `${added.length} photos added — press ✨ Auto-design to redesign with every photo`,
      )
    },
    [albumId, photos, pages, flash, build, style],
  )

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

  const deletePhoto = useCallback(
    (id: string) => {
      const at = placedAt.get(id)
      if (at && !window.confirm(`Delete this photo? Its frame on page ${at.page + 1} will be left empty.`)) return
      setArmed((a) => (a === id ? null : a))
      setSel((cur) => (cur && pages && pages[cur.page][cur.slot] === id ? null : cur))
      removePhotoEverywhere(id)
    },
    [placedAt, pages, removePhotoEverywhere],
  )

  /** Scroll the magazine to a page and select that frame. */
  const jumpTo = useCallback((at: { page: number; slot: number }) => {
    setSelText(null)
    setSwapFrom(null)
    setArmed(null)
    setSel(at)
    const si = at.page === 0 ? 0 : Math.floor((at.page + 1) / 2)
    document.getElementById(`mag-spread-${si}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const trayClick = useCallback(
    (id: string) => {
      if (!pages) return
      const at = placedAt.get(id)
      if (at) return jumpTo(at)
      if (sel && pages && pages[sel.page][sel.slot] !== undefined) {
        setSlot(sel.page, sel.slot, id)
        return
      }
      setArmed((a) => (a === id ? null : id))
    },
    [placedAt, jumpTo, sel, pages, setSlot],
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

      <style>{RAIL_CSS}</style>
      <div className="mag-shell has-rails">
      {/* ── left rail: styles (wide screens) ── */}
      {(
        <aside className="mag-rail" aria-label="Magazine styles">
          <div style={railHead}>Style</div>
          {MAG_STYLES.map((st, idx) => {
            const on = st.id === style.id
            const pv = previews.get(st.id)!
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => chooseStyle(st.id)}
                aria-pressed={on}
                title={st.tagline}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  background: on ? 'rgba(184,150,90,0.12)' : 'transparent',
                  border: on ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.2)',
                  borderRadius: 10,
                  padding: 8,
                  marginBottom: 8,
                  cursor: 'pointer',
                  color: 'var(--cream)',
                }}
              >
                <div style={{ width: 56, flex: 'none', pointerEvents: 'none' }}>
                  <MagPageView
                    page={st.pages[0]}
                    photoIds={on && pages ? pages[0] : pv.pages[0]}
                    photoMap={on && pages ? photoMap : pv.map}
                    adjusts={on && pages ? adjusts : {}}
                    pageKey={st.pages[0].id}
                    selectedSlot={-1}
                    interactive={false}
                    texts={pageTexts(st.pages[0], textEdits, meta)}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 8.5, letterSpacing: 2, color: GOLD, fontWeight: 600 }}>
                    STYLE {String(idx + 1).padStart(2, '0')}{on ? ' · ✓' : ''}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13, letterSpacing: 2.2, margin: '2px 0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.name}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {st.swatches.map((c) => (
                      <span key={c} style={{ width: 9, height: 9, borderRadius: 5, background: c, border: '0.5px solid rgba(255,255,255,0.3)' }} />
                    ))}
                  </div>
                </div>
              </button>
            )
          })}
        </aside>
      )}
      <div className="mag-main">

      {/* ── style picker ── */}
      <section className="mag-bigstyles" data-help="mag-styles" style={{ maxWidth: 980, margin: '0 auto 28px', padding: '0 16px' }}>
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
            <button type="button" onClick={() => {
                const s = samplePhotos(needed)
                setPhotos(s)
                build(undefined, s)
              }} style={btn(false)}>
              Try with sample photos
            </button>
          )}
          {photos.length > 0 && (
            <button data-help="mag-build"
              type="button"
              onClick={() => {
                if (pages && !window.confirm(`Auto-design the magazine with all ${photos.length} photos? Your swaps and crops will be reset (your text stays).`)) return
                build()
              }}
              style={btn(true)}
            >
              {pages ? (unused.length ? `✨ Auto-design with all ${photos.length} photos` : '✨ Re-design') : '✨ Auto-design my magazine'}
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
        <section className="mag-tray-inline" style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px' }}>
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
      {!pages && (
        <section style={{ maxWidth: 980, margin: '18px auto 0', padding: '0 16px' }}>
          <p style={{ textAlign: 'center', fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase', marginBottom: 4 }}>
            The 20 pages · <strong style={{ color: 'var(--cream)', letterSpacing: 3, fontWeight: 800 }}>{style.name}</strong>
          </p>
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted2)', marginBottom: 14, fontStyle: 'italic' }}>
            {style.tagline} Shown with sample photos — yours go here.
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
              <div key={si} id={`mag-spread-${si}`} style={{ scrollMarginTop: 20 }}>
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

          {/* unused tray (small screens; wide screens use the right rail) */}
          <div className="mag-tray-inline" style={{ marginTop: 36 }}>
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

          {/* ── order + email preview ── */}
          <div
            data-help="mag-order"
            style={{
              marginTop: 40,
              padding: '22px',
              textAlign: 'center',
              border: '0.5px solid rgba(184,150,90,0.35)',
              borderRadius: 10,
              background: 'var(--dark2)',
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)' }}>
              20 pages · ${MAG_PRICE}
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 6, letterSpacing: 0.5 }}>
              Printed at 300 DPI · 8.5 × 11 in · page 1 is your cover · shipping arranged separately
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
              <button type="button" data-help="mag-email" onClick={() => { setEmailOpen(true); setEmailState('idle'); setEmailErr(null) }} style={btn(false)}>
                ✉ Email me a preview
              </button>
              <button type="button" onClick={openOrder} style={btn(true)}>
                Review &amp; order · ${MAG_PRICE} →
              </button>
            </div>
          </div>
        </section>
      )}

      </div>
      {/* ── right rail: photos (wide screens) ── */}
      {(
        <aside className="mag-rail" aria-label="Your photos">
          <div style={railHead}>Your photos · {photos.length}</div>
          <button type="button" data-help="mag-upload" onClick={() => fileRef.current?.click()} style={{ ...btn(false), width: '100%' }}>
            + Add photos
          </button>
          {pages && <div style={{ display: 'flex', gap: 6, margin: '12px 0 8px' }}>
            {(['unused', 'all'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTrayTab(t)} style={{ ...toggleBtn(trayTab === t), flex: 1, fontSize: 10, letterSpacing: 0.5, padding: '0 6px' }}>
                {t === 'unused' ? `Not placed · ${unused.length}` : `All · ${photos.length}`}
              </button>
            ))}
          </div>}
          <p style={{ fontSize: 10.5, color: 'var(--muted2)', lineHeight: 1.5, margin: pages ? '0 0 10px' : '12px 0 10px' }}>
            {!pages
              ? `Upload about ${needed} photos, then press ✨ Auto-design. × removes a photo.`
              : trayTab === 'unused'
                ? 'Tap a photo, then tap a frame to place it.'
                : 'Tap a placed photo to jump to its page. × deletes a photo.'}
          </p>
          {(pages && trayTab === 'unused' ? unused : photos).length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--muted2)' }}>{photos.length ? 'Every photo is placed.' : 'No photos yet.'}</span>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {(pages && trayTab === 'unused' ? unused : photos).map((p) => {
              const at = placedAt.get(p.id)
              return (
                <div key={p.id} style={{ position: 'relative', aspectRatio: '1 / 1' }}>
                  <button
                    type="button"
                    onClick={() => trayClick(p.id)}
                    title={at ? `On page ${at.page + 1}` : 'Tap, then tap a frame'}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      padding: 0,
                      border: armed === p.id ? `2px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.3)',
                      borderRadius: 4,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: 'none',
                      opacity: at && trayTab === 'all' ? 0.75 : 1,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                  {at && trayTab === 'all' && <span style={pageBadge}>p{at.page + 1}</span>}
                  <button type="button" aria-label="Delete photo" title="Delete photo" onClick={() => deletePhoto(p.id)} style={xDot}>
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </aside>
      )}
      </div>

      {/* ── order modal: review → shipping → working ── */}
      {orderStep && pages && (
        <div style={modalBackdrop} onMouseDown={(e) => e.target === e.currentTarget && orderStep !== 'working' && setOrderStep(null)}>
          <div style={{ ...modalPanel, maxWidth: orderStep === 'review' ? 980 : 620 }} role="dialog" aria-modal="true" aria-label="Order your magazine">
            {orderStep === 'review' && (
              <>
                <div style={modalHead}>
                  <span>Step 1 of 2 · Review your pages</span>
                  <button type="button" onClick={() => setOrderStep(null)} style={xBtn} aria-label="Close">✕</button>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--muted2)', margin: '0 0 12px', lineHeight: 1.6 }}>
                  This is exactly what will print. Check names, dates, spelling and crops on every page.
                </p>
                {(() => {
                  const empty = pages.flat().filter((x) => x === null).length
                  return empty > 0 ? (
                    <div style={warnBox}>⚠ {empty} empty frame{empty === 1 ? '' : 's'} — they will print blank. Close this and add photos, or order as is.</div>
                  ) : null
                })()}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {SP.map((pg, pi) => (
                    <div key={pg.id}>
                      <MagPageView
                        page={pg}
                        photoIds={pages[pi]}
                        photoMap={photoMap}
                        adjusts={adjusts}
                        pageKey={pg.id}
                        selectedSlot={-1}
                        interactive={false}
                        texts={pageTexts(pg, textEdits, meta)}
                      />
                      <div style={{ fontSize: 9, color: 'var(--muted2)', textAlign: 'center', marginTop: 3, letterSpacing: 1 }}>{pi === 0 ? 'COVER' : pi + 1}</div>
                    </div>
                  ))}
                </div>
                <label style={checkRow}>
                  <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
                  <span>
                    I have checked all 20 pages and <strong>approve them for printing</strong>. I understand that after approval the magazine cannot be changed or cancelled.{' '}
                    <details style={{ display: 'inline' }}><summary style={{ cursor: 'pointer', color: GOLD, display: 'inline' }}>Read clause 2.3</summary><pre style={clausePre}>{CLAUSE_PROOF_APPROVAL}</pre></details>
                  </span>
                </label>
                <label style={checkRow}>
                  <input type="checkbox" checked={rightsOk} onChange={(e) => setRightsOk(e.target.checked)} />
                  <span>
                    I own these photos or have permission to print them, and they meet the content policy.{' '}
                    <details style={{ display: 'inline' }}><summary style={{ cursor: 'pointer', color: GOLD, display: 'inline' }}>Read clauses 2.2 &amp; 2.4</summary><pre style={clausePre}>{CLAUSE_CONTENT_RIGHTS + '\n\n' + CLAUSE_CONTENT_POLICY}</pre></details>
                  </span>
                </label>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" style={btn(false)} onClick={() => setOrderStep(null)}>← Keep editing</button>
                  <button type="button" style={{ ...btn(true), opacity: approved && rightsOk ? 1 : 0.45, cursor: approved && rightsOk ? 'pointer' : 'not-allowed' }} disabled={!approved || !rightsOk} onClick={() => setOrderStep('ship')}>
                    Approve &amp; continue →
                  </button>
                </div>
              </>
            )}
            {orderStep === 'ship' && (
              <>
                <div style={modalHead}>
                  <span>Step 2 of 2 · Shipping details</span>
                  <button type="button" onClick={() => setOrderStep(null)} style={xBtn} aria-label="Close">✕</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {(
                    [
                      ['name', 'Full name *', 2],
                      ['email', 'Email *', 1],
                      ['phone', 'Phone', 1],
                      ['line1', 'Address line 1 *', 2],
                      ['line2', 'Address line 2', 2],
                      ['city', 'City *', 1],
                      ['region', 'State / region', 1],
                      ['postalCode', 'Postal code *', 1],
                      ['country', 'Country', 1],
                      ['notes', 'Delivery notes', 2],
                    ] as const
                  ).map(([k, label, span]) => (
                    <label key={k} style={{ gridColumn: span === 2 ? '1 / -1' : undefined, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9.5, letterSpacing: 1.4, color: 'var(--muted2)', textTransform: 'uppercase' }}>
                      {label}
                      <input
                        value={form[k]}
                        type={k === 'email' ? 'email' : 'text'}
                        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                        style={fieldStyle}
                      />
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 14, padding: '12px 14px', border: '0.5px solid rgba(184,150,90,0.3)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.8, color: 'var(--cream)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Wedding magazine · {style.name} · 20 pages</span><span>${priceInfo?.price ?? MAG_PRICE}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted2)' }}>
                    <span>Shipping</span>
                    <span>{priceInfo && priceInfo.shippingUsd > 0 ? `$${priceInfo.shippingUsd.toFixed(2)}` : 'arranged separately'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '0.5px solid rgba(184,150,90,0.25)', marginTop: 4, paddingTop: 4 }}>
                    <span>Total today</span>
                    <span>${((priceInfo?.price ?? MAG_PRICE) + (priceInfo?.shippingUsd ?? 0)).toFixed(2)}</span>
                  </div>
                </div>
                {orderErr && <div style={{ ...warnBox, marginTop: 12 }}>{orderErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" style={btn(false)} onClick={() => setOrderStep('review')}>← Back to review</button>
                  <button type="button" style={btn(true)} onClick={runOrder}>
                    Continue to secure payment · ${((priceInfo?.price ?? MAG_PRICE) + (priceInfo?.shippingUsd ?? 0)).toFixed(0)} →
                  </button>
                </div>
              </>
            )}
            {orderStep === 'working' && (
              <div style={{ padding: '30px 10px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--cream)' }}>Preparing your print files</div>
                <p style={{ fontSize: 12, color: 'var(--muted2)', margin: '8px 0 18px' }}>Please keep this page open — about a minute.</p>
                <div style={{ height: 4, background: 'rgba(184,150,90,0.18)', borderRadius: 2 }}>
                  <div style={{ height: 4, borderRadius: 2, background: GOLD, width: `${progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 5}%`, transition: 'width .3s' }} />
                </div>
                <div style={{ fontSize: 11, color: GOLD, marginTop: 10, letterSpacing: 0.5 }}>{progress?.label ?? 'Starting…'}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── email preview modal ── */}
      {emailOpen && pages && (
        <div style={modalBackdrop} onMouseDown={(e) => e.target === e.currentTarget && emailState !== 'working' && setEmailOpen(false)}>
          <div style={{ ...modalPanel, maxWidth: 480 }} role="dialog" aria-modal="true" aria-label="Email me a preview">
            <div style={modalHead}>
              <span>Email me a preview</span>
              <button type="button" onClick={() => emailState !== 'working' && setEmailOpen(false)} style={xBtn} aria-label="Close">✕</button>
            </div>
            {emailState === 'sent' ? (
              <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--cream)' }}>Sent ✓</div>
                <p style={{ fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>Check {emailAddr} for your watermarked preview. Come back on this device to order.</p>
                <button type="button" style={{ ...btn(true), marginTop: 10 }} onClick={() => setEmailOpen(false)}>Done</button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6, marginTop: 0 }}>
                  We&apos;ll email all 20 pages as small preview images with a <strong style={{ color: 'var(--cream)' }}>FOLIO FOREVER · PREVIEW</strong> watermark — perfect for sharing with family. Your printed magazine has no watermark.
                </p>
                <input value={emailAddr} onChange={(e) => setEmailAddr(e.target.value)} type="email" placeholder="you@example.com" style={{ ...fieldStyle, width: '100%' }} aria-label="Email address" />
                {emailErr && <div style={{ ...warnBox, marginTop: 10 }}>{emailErr}</div>}
                {emailState === 'working' && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 3, background: 'rgba(184,150,90,0.18)', borderRadius: 2 }}>
                      <div style={{ height: 3, background: GOLD, borderRadius: 2, width: `${progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 5}%` }} />
                    </div>
                    <div style={{ fontSize: 11, color: GOLD, marginTop: 6 }}>{progress?.label ?? 'Starting…'}</div>
                  </div>
                )}
                <button type="button" style={{ ...btn(true), marginTop: 14, width: '100%', opacity: emailState === 'working' ? 0.5 : 1 }} disabled={emailState === 'working'} onClick={sendPreview}>
                  {emailState === 'working' ? 'Preparing…' : 'Send my preview ✉'}
                </button>
              </>
            )}
          </div>
        </div>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--cream)', letterSpacing: 1 }}>
                STRAIGHTEN
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={0.5}
                  value={Math.max(-45, Math.min(45, selAdj.rotate ?? 0))}
                  onChange={(e) => onAdjust(sel.page, sel.slot, { ...selAdj, rotate: Number(e.target.value) })}
                  style={{ accentColor: GOLD, width: 110 }}
                />
                <span style={{ minWidth: 30, color: 'var(--muted2)' }}>{Math.round(selAdj.rotate ?? 0)}°</span>
              </label>
              <span style={{ fontSize: 10, color: 'var(--muted2)' }}>Drag to move · ↻ corners rotate · pull edges or pinch to zoom</span>
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

const modalBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9000,
  background: 'rgba(8,6,4,0.72)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '40px 12px',
  overflowY: 'auto',
}
const modalPanel: CSSProperties = {
  width: '100%',
  background: '#17120e',
  border: '0.5px solid rgba(184,150,90,0.45)',
  borderRadius: 14,
  padding: '18px 20px 20px',
  boxShadow: '0 24px 70px rgba(0,0,0,0.7)',
  color: 'var(--cream)',
}
const modalHead: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 10.5,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: GOLD,
  fontWeight: 600,
  marginBottom: 12,
}
const xBtn: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--muted2)', fontSize: 16, cursor: 'pointer' }
const warnBox: CSSProperties = {
  background: 'rgba(229,115,115,0.1)',
  border: '0.5px solid rgba(229,115,115,0.5)',
  color: '#f3c3c3',
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 12,
  marginBottom: 12,
}
const checkRow: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.6, color: 'var(--cream)', marginTop: 10 }
const clausePre: CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontFamily: 'var(--font-body)',
  fontSize: 11,
  color: 'var(--muted2)',
  background: 'rgba(0,0,0,0.25)',
  padding: 10,
  borderRadius: 6,
  marginTop: 6,
}
const fieldStyle: CSSProperties = {
  background: 'rgba(0,0,0,0.3)',
  border: '0.5px solid rgba(184,150,90,0.4)',
  borderRadius: 6,
  padding: '9px 10px',
  color: 'var(--cream)',
  fontSize: 13.5,
  fontFamily: 'var(--font-body)',
  letterSpacing: 0.2,
  textTransform: 'none',
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

/* Side rails: only on wide screens (before and after design). The
   rails are sticky, so only the magazine scrolls. Narrow screens keep the
   single-column layout (big style cards + inline photo tray). */
const RAIL_CSS = `
.mag-rail{display:none}
@media (min-width:1200px){
  .mag-shell.has-rails{display:grid;grid-template-columns:230px minmax(0,1fr) 270px;gap:22px;padding:0 18px;align-items:start}
  .mag-shell.has-rails .mag-rail{display:block;position:sticky;top:14px;max-height:calc(100vh - 28px);overflow-y:auto;padding:14px;background:var(--dark2);border:0.5px solid rgba(184,150,90,0.2);border-radius:12px;scrollbar-width:thin}
  .mag-shell.has-rails .mag-main{min-width:0}
  .mag-shell.has-rails .mag-bigstyles,.mag-shell.has-rails .mag-tray-inline{display:none}
}`

const railHead: CSSProperties = { fontSize: 10, letterSpacing: 2.5, color: GOLD, textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }
const xDot: CSSProperties = {
  position: 'absolute',
  top: 3,
  right: 3,
  width: 18,
  height: 18,
  borderRadius: 9,
  border: 'none',
  background: 'rgba(0,0,0,0.7)',
  color: '#fff',
  fontSize: 12,
  lineHeight: '18px',
  padding: 0,
  cursor: 'pointer',
}
const pageBadge: CSSProperties = {
  position: 'absolute',
  left: 3,
  bottom: 3,
  background: 'rgba(0,0,0,0.7)',
  color: GOLD,
  fontSize: 8.5,
  letterSpacing: 0.5,
  padding: '1px 4px',
  borderRadius: 3,
  pointerEvents: 'none',
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
