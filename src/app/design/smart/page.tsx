'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUndo } from './edit/use-undo'
import { UndoButtons, useToast } from './edit/UndoButtons'
import {
  makeSwapOp,
  makeSwapWithUnusedOp,
  makeCrossSwapOp,
  makeRemoveOp,
  makeLayoutVariantOp,
  makeReorderSpreadOp,
  makeDeleteSpreadOp,
  type Spread as OpSpread,
} from './edit/operations'
import { SlotImage, type SlotAdjust } from './edit/PanSlider'
import {
  saveBlob,
  deleteBlob,
  loadAlbumBlobs,
  clearAlbumBlobs,
} from './edit/photo-blob-store'
import { useSlotDrag } from './edit/swap'
import { PhotoCountDropdown } from './edit/PhotoCountDropdown'
import { buildPhotoCountOp, buildAddOp } from './edit/photo-count'
import { renderCoverComposite } from './edit/render-cover'

// Lazy: pulls the two composite renderers + render math only when the
// client actually opens the album preview modal.
const AlbumPreviewModal = dynamic(() => import('./edit/AlbumPreviewModal'), {
  ssr: false,
})
import { readJpegCaptureTime, extractFilenameSeq } from '@/lib/exif'
import {
  pathToEvent,
  clusterByTimeGaps,
  type EventId as GroupEventId,
} from '@/lib/smart-group'
import { detectFaces, type FaceBox } from '@/lib/face-detect'
import dynamic from 'next/dynamic'
import { type CoverState } from '../cover-builder'

// Lazy: pulls Three.js (Album3D). Only load when the client actually
// reaches the Cover step — keeps the main designer bundle lean.
const CoverBuilder = dynamic(() => import('../cover-builder'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#b8965a',
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
      }}
    >
      Loading cover studio…
    </div>
  ),
})

/** Cover add-on price by style (owner spec): photo included, leather
 *  +$25, acrylic +$39. Used in displayed totals + the order. */
const COVER_PRICE: Record<CoverState['type'], number> = {
  photo: 0,
  leather: 25,
  acrylic: 39,
}

import {
  TEMPLATES,
  TEMPLATE_BY_ID,
  templatesForCount,
  templateFamily,
  renderSlots,
  scoreTemplateForPhotos,
} from '@/lib/smart-layout/templates'
import type {
  AlbumType,
  EventId,
  Slot,
  LayoutTemplate,
  Spread,
  LayoutFamily,
  AspectClass,
  AlbumStyle,
  LayoutPhoto,
} from '@/lib/smart-layout/templates'

// Client-only view-model type (the engine doesn't need it).
type EventDef = { id: EventId; name: string }

export const runtime = 'edge'

// ============== ALBUM STORAGE ==============
// Smart albums share the `folio-albums-index` localStorage key with the
// manual builder so they appear in the same "My Albums" list on /design.
// The `mode: 'smart'` field on each entry tells the picker to route
// back to /design/smart instead of /design/build on resume.

const ALBUMS_INDEX_KEY = 'folio-albums-index'
const SMART_STATE_PREFIX = 'folio-smart-state'

type AlbumIndexEntry = {
  id: string
  name: string
  createdAt: string
  lastEditedAt: string
  mode?: 'smart' | 'manual'
}

function readAlbumsIndex(): AlbumIndexEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ALBUMS_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAlbumsIndex(list: AlbumIndexEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ALBUMS_INDEX_KEY, JSON.stringify(list))
  } catch {
    /* quota or disabled — ignore */
  }
}

function upsertAlbumIndex(id: string, patch: Partial<AlbumIndexEntry>) {
  const list = readAlbumsIndex()
  const existing = list.find((a) => a.id === id)
  const now = new Date().toISOString()
  if (existing) {
    Object.assign(existing, patch, { lastEditedAt: now })
  } else {
    list.unshift({
      id,
      name: 'Untitled',
      createdAt: now,
      lastEditedAt: now,
      ...patch,
    })
  }
  writeAlbumsIndex(list)
}

function generateAlbumId(): string {
  return 'a' + Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 6)
}

// What we persist per album. We always save metadata; photo previews are
// kept too — sample photos use stable HTTPS URLs (survive refresh), while
// uploaded photos use blob: URLs which are invalidated on reload. We
// fall back gracefully if a preview won't load.

// ============== CONSTANTS ==============

const GOLD = '#b8965a'
const HERO_MIN_PX = 3000
const PHOTO_CAP = 100
const HERO_CAP = 8
const FAV_CAP = 30

// ============== TYPES ==============

type AlbumSize = '17x24' | '20x30' | '12x24' | '15x30'


// Tag list shown in the Group step + used by the layout engine's
// chronological ordering. Order matches typical Pakistani / Indian
// wedding flow (Mehndi → Haldi → Getting Ready → Nikkah → Wedding →
// Reception → Valima → spillover slots).
const EVENTS: EventDef[] = [
  { id: 'mehndi', name: 'Mehndi' },
  { id: 'haldi', name: 'Haldi' },
  { id: 'prep', name: 'Getting Ready' },
  { id: 'nikkah', name: 'Nikkah' },
  { id: 'wedding', name: 'Wedding' },
  { id: 'reception', name: 'Reception' },
  { id: 'valima', name: 'Valima' },
  { id: 'other1', name: 'Other 1' },
  { id: 'other2', name: 'Other 2' },
]

/**
 * Map any legacy EventId (from albums saved with the old 5-tag list)
 * to a current one. Run on hydrated photos so the Group step doesn't
 * end up with photos in a no-longer-rendered bucket.
 */
function migrateLegacyEvent(eid: EventId): EventId {
  switch (eid) {
    case 'ceremony':
      return 'wedding'
    case 'portraits':
      return 'other1'
    case 'other':
      return 'other1'
    default:
      return eid
  }
}

type Photo = {
  id: string
  preview: string
  width: number
  height: number
  tagged: 'hero' | 'favorite' | 'none'
  eventId: EventId
  blurry: boolean
  /** EXIF DateTimeOriginal in ms since epoch (camera local clock).
   *  Used by the layout engine to put each event's photos in real
   *  chronological order instead of upload order. */
  capturedAt?: number
  /** Largest digit run in the original filename — used as a fallback
   *  ordering signal when EXIF is missing. */
  seqNum?: number
  /** Face bounding boxes (normalised 0..1) from native FaceDetector.
   *  Used to auto-pan the photo inside its slot so faces aren't cropped
   *  off. Browsers without FaceDetector simply have no faces here. */
  faces?: FaceBox[]
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
  | 'cover'
  | 'proof'
  | 'submit'

// ───── Legal clauses (PDF: Album_Legal_Clauses_and_Dev_Instructions.pdf) ─────
// Stored as constants so the EXACT text shown to the user is the EXACT text
// captured in the audit record. Versioned — bump the suffix if clause text
// changes so old acceptances stay traceable to the version they accepted.
//
// [ATTORNEY REVIEW PENDING] — placeholders [Company], [STATE/COUNTRY],
// [JURISDICTION] left intentionally so the attorney can finalize before
// these appear on payment-enabled production.
const LEGAL_VERSION = 'v1-2026-05-11'

const CLAUSE_PROOF_APPROVAL = `2.3  PROOF APPROVAL — FINAL RESPONSIBILITY OF CUSTOMER

You will receive a digital proof of every spread before printing. By approving the proof, you confirm that:

  (a) you have reviewed every spread carefully and the design reflects what you want printed;
  (b) the order of photos, crops, layout, and any visible text are correct;
  (c) you understand that once you approve the proof, the album enters production and CANNOT be cancelled, modified, refunded, or recalled for any reason other than a manufacturing defect attributable to [Company];
  (d) any error you fail to identify in the proof — including but not limited to misplaced photos, color shifts within normal tolerance, spelling, cropping, or sequence — is your responsibility, not [Company]'s;
  (e) reprints requested due to customer-side errors will be billed at full price.

This approval is the single most important decision in the order. Please take your time.`

const CLAUSE_CONTENT_RIGHTS = `2.4  CONTENT OWNERSHIP & COPYRIGHT — INDEMNIFICATION

By uploading photos to [Company], you represent and warrant that:

  (a) you own the photos, OR you have explicit written or verbal permission from the photographer / rights-holder to use them in a printed album for personal use;
  (b) the photos do not infringe upon any copyright, trademark, publicity right, privacy right, or other intellectual-property right of any third party;
  (c) you will defend, indemnify, and hold harmless [Company], its agents, and its production partners against any claim, demand, or liability (including reasonable attorney's fees) arising from a breach of (a) or (b).

[Company] does not verify ownership and is not liable for content uploaded by the customer.`

const CLAUSE_CONTENT_POLICY = `2.2  CONTENT QUALITY & POLICY

You agree not to upload content that is illegal, sexually explicit, hateful, defamatory, or that depicts minors in any inappropriate way. [Company] reserves the right to refuse to print any content that violates this policy at our sole discretion, and to refund the order minus any work already performed.

You are responsible for the quality of the source files you upload. Low-resolution photos (under 1500 px on the shortest edge) may print soft or pixelated. We will not stop the order for resolution reasons unless you ask us to — but you accept the print result.`

// Threshold for the "low resolution" soft-warning shown at upload +
// on each photo card. We target 200 DPI for the printed album, so the
// shortest edge needs ~2400 px to fill a single 12" page or a 17×24
// matted slot crisply. Below this, the warning fires and the legal
// "I accept soft print" acknowledgement reuses the same number so the
// client knows what they're consenting to.
const LOW_RES_PX = 2400



type PhotoAdjust = {
  zoom: number
  panX: number
  panY: number
  flipH: boolean
  flipV: boolean
  /** Rotation in degrees, any value (was constrained to 90° snaps). */
  rotate: number
  fit: 'fill' | 'contain'
  /** Photo frame: 0 = none … 10 = thick. Rendered as a % of slot so it
   *  looks consistent in the editor, proof preview, and print composite. */
  borderWidth: number
  borderColor: string
}
const DEFAULT_ADJUST: PhotoAdjust = {
  zoom: 1,
  panX: 50,
  panY: 50,
  flipH: false,
  flipV: false,
  rotate: 0,
  fit: 'fill',
  borderWidth: 0,
  borderColor: '#ffffff',
}

/** Curated frame colours. */
const BORDER_PALETTE: { id: string; label: string; hex: string }[] = [
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'cream', label: 'Cream', hex: '#f5f0e8' },
  { id: 'black', label: 'Black', hex: '#0e0c09' },
  { id: 'charcoal', label: 'Charcoal', hex: '#3a342c' },
  { id: 'gold', label: 'Gold', hex: '#b8965a' },
]

/** Frame thickness in px for a given level + the element's rendered
 *  width, so the frame is the SAME relative weight everywhere
 *  (editor / proof / print composite). level 10 ≈ 2.2% of width. */
function borderPx(level: number | undefined, renderedWidthPx: number): number {
  if (!level || level <= 0) return 0
  return Math.max(1, (level / 10) * 0.022 * renderedWidthPx)
}
const adjustKey = (spreadId: string, slotIdx: number) => `${spreadId}::${slotIdx}`

// ============== SPREAD BACKGROUNDS ==============
// Per-spread background. Stored in its OWN state map keyed by spread id
// (NOT on the Spread object) so it never touches the undo/op system —
// same pattern as `adjusts`. Persisted to localStorage alongside it.

type SpreadBg = {
  mode: 'paper' | 'color' | 'photo'
  /** hex, when mode==='color' */
  color?: string
  /** photo id, when mode==='photo' (Phase 2) */
  photoId?: string
  /** 0..40 px gaussian blur for the bg photo (Phase 2) */
  blur?: number
  /** 0..0.7 black overlay opacity over the bg photo (Phase 2) */
  dim?: number
  /** bg-photo zoom 1..2 — HARD-CAPPED at 2.0 (200%) per owner */
  zoom?: number
  panX?: number
  panY?: number
}

/** A free-positioned text block on a spread (titles, names, dates,
 *  quotes). Coords are % of the spread box so they scale identically in
 *  the editor, the proof preview and the print composite. */
type SpreadText = {
  id: string
  text: string
  /** centre X / Y as % of the spread (clamped to a safe print margin) */
  xPct: number
  yPct: number
  /** text-box width as % of spread width */
  widthPct: number
  /** font size as % of spread HEIGHT (resolution-independent) */
  sizePct: number
  color: string
  align: 'left' | 'center' | 'right'
  font:
    | 'display'
    | 'serif'
    | 'sans'
    | 'elegant'
    | 'script'
    | 'hand'
    | 'castellar'
    | 'copperplate'
  weight: 400 | 700
}
// CSS font stacks (editor / proof). Canvas can't use CSS vars so it has
// its own concrete stack — kept visually equivalent. Script/Hand/Elegant
// are Google fonts loaded by ensureTextFonts().
const TEXT_FONT_CSS: Record<SpreadText['font'], string> = {
  display: 'var(--font-display), Georgia, serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  elegant: '"Playfair Display", Georgia, serif',
  script: '"Great Vibes", "Snell Roundhand", cursive',
  hand: '"Dancing Script", "Segoe Script", cursive',
  // Real licensed font first (if the device has it), else Cinzel — a
  // free engraved-caps face that's visually very close.
  castellar: 'Castellar, "Cinzel", Georgia, serif',
  copperplate:
    '"Copperplate Gothic Light", "Copperplate Gothic", Copperplate, "Cinzel", serif',
}
const TEXT_FONT_CANVAS: Record<SpreadText['font'], string> = {
  display: 'Georgia, "Times New Roman", serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, sans-serif',
  elegant: '"Playfair Display", Georgia, serif',
  script: '"Great Vibes", cursive',
  hand: '"Dancing Script", cursive',
  castellar: 'Castellar, "Cinzel", Georgia, serif',
  copperplate:
    '"Copperplate Gothic Light", "Copperplate Gothic", Copperplate, "Cinzel", serif',
}
const TEXT_FONT_LABEL: Record<SpreadText['font'], string> = {
  display: 'Display',
  serif: 'Serif',
  sans: 'Sans',
  elegant: 'Elegant',
  script: 'Script ✒',
  hand: 'Handwriting',
  castellar: 'Castellar',
  copperplate: 'Copperplate Gothic',
}
/** Inject the Google Fonts stylesheet once (client only). */
function ensureTextFonts() {
  if (typeof document === 'undefined') return
  if (document.getElementById('ff-text-fonts')) return
  const l = document.createElement('link')
  l.id = 'ff-text-fonts'
  l.rel = 'stylesheet'
  l.href =
    'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Dancing+Script:wght@400;700&family=Playfair+Display:wght@400;700&family=Cinzel:wght@400;700&display=swap'
  document.head.appendChild(l)
}
const TEXT_COLOR_PRESETS = ['#ffffff', '#0e0c09', '#b8965a', '#7a1f1f', '#3a3a3a']
// Keep text inside the trim-safe area so nothing prints off the edge.
const TEXT_SAFE_MIN = 6
const TEXT_SAFE_MAX = 94
function makeSpreadText(partial?: Partial<SpreadText>): SpreadText {
  return {
    id: `txt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: 'Your text',
    xPct: 50,
    yPct: 50,
    widthPct: 70,
    sizePct: 6,
    color: '#ffffff',
    align: 'center',
    font: 'display',
    weight: 700,
    ...partial,
  }
}

const EMPTY_TEXTS: SpreadText[] = []

const DEFAULT_SPREAD_BG: SpreadBg = { mode: 'paper' }
// Softer default blur for photo backgrounds — the old 18px was a heavy
// frosted-glass look; ~9px keeps the subject readable as a tasteful
// "blurred mirror" behind the matted photos.
const DEFAULT_BG_BLUR = 9

/** Max zoom for a background photo — 200%, owner spec. */
const BG_PHOTO_MAX_ZOOM = 2

// ============== SMART ZOOM CAP (print-resolution aware) ==============
// Minimum acceptable print resolution. Owner spec: 200 DPI.
const MIN_PRINT_DPI = 200
// Global hard ceiling on zoom regardless of resolution (owner: 200%).
const GLOBAL_MAX_ZOOM = 2

/** Open-spread physical inches for an album size. Key is `${h}x${w}`
 *  (e.g. '17x24' = 17″ tall × 24″ wide open). */
function spreadInches(size: AlbumSize): { wIn: number; hIn: number } {
  const [h, w] = size.split('x').map(Number)
  return { wIn: w || 24, hIn: h || 17 }
}

/**
 * Sharpness of a photo cover-fitted into a slot at zoom 1, in DPI.
 *   coverDPI = min(photoW / slotWidthInches, photoH / slotHeightInches)
 * Effective DPI at any zoom = coverDPI / zoom.
 */
function coverDpi(
  photo: { width: number; height: number },
  slot: { w: number; h: number },
  size: AlbumSize,
): number {
  if (!photo.width || !photo.height) return 0
  const { wIn, hIn } = spreadInches(size)
  const slotWin = (slot.w / 100) * wIn
  const slotHin = (slot.h / 100) * hIn
  if (slotWin <= 0 || slotHin <= 0) return 0
  return Math.min(photo.width / slotWin, photo.height / slotHin)
}

/**
 * The maximum zoom this photo can take in this slot+album before it
 * drops below MIN_PRINT_DPI. Clamped to [1, GLOBAL_MAX_ZOOM]. If the
 * photo can't even hit 200 DPI at zoom 1, returns 1 (and effDpi at 1
 * will read red so the UI warns).
 */
function smartMaxZoom(
  photo: { width: number; height: number },
  slot: { w: number; h: number },
  size: AlbumSize,
): number {
  const cd = coverDpi(photo, slot, size)
  if (cd <= 0) return GLOBAL_MAX_ZOOM
  const raw = cd / MIN_PRINT_DPI
  return Math.max(1, Math.min(GLOBAL_MAX_ZOOM, +raw.toFixed(2)))
}

const PAPER_HEX = '#ffffff'

/* ── Colour maths for the RGB / brightness editor ── */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return { r: 245, g: 240, b: 232 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
/** amt -100..100 → toward black / toward white */
function shiftBrightness(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex)
  if (amt >= 0) {
    const t = amt / 100
    return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t)
  }
  const t = 1 + amt / 100 // 0..1
  return rgbToHex(r * t, g * t, b * t)
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx }
}
function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/** Photoshop-style colour picker: saturation/brightness square + hue
 *  bar + HEX / RGB / HSB fields. `value` is hex, onChange gives hex. */
function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  const init = (() => {
    const { r, g, b } = hexToRgb(value)
    return rgbToHsv(r, g, b)
  })()
  const [h, setH] = useState(init.h)
  const [s, setS] = useState(init.s)
  const [v, setV] = useState(init.v)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const lastHex = useRef(value)

  // Re-sync when the colour is changed from OUTSIDE (e.g. eyedropper).
  useEffect(() => {
    if (value.toLowerCase() === lastHex.current.toLowerCase()) return
    const { r, g, b } = hexToRgb(value)
    const hsv = rgbToHsv(r, g, b)
    setH(hsv.h)
    setS(hsv.s)
    setV(hsv.v)
    lastHex.current = value
  }, [value])

  const emit = (nh: number, ns: number, nv: number) => {
    const { r, g, b } = hsvToRgb(nh, ns, nv)
    const hex = rgbToHex(r, g, b)
    lastHex.current = hex
    onChange(hex)
  }

  const dragSV = (clientX: number, clientY: number) => {
    const el = svRef.current
    if (!el) return
    const rc = el.getBoundingClientRect()
    const ns = Math.min(1, Math.max(0, (clientX - rc.left) / rc.width))
    const nv = 1 - Math.min(1, Math.max(0, (clientY - rc.top) / rc.height))
    setS(ns)
    setV(nv)
    emit(h, ns, nv)
  }
  const dragHue = (clientY: number) => {
    const el = hueRef.current
    if (!el) return
    const rc = el.getBoundingClientRect()
    const nh = Math.min(359.99, Math.max(0, ((clientY - rc.top) / rc.height) * 360))
    setH(nh)
    emit(nh, s, v)
  }
  const startDrag = (
    move: (x: number, y: number) => void,
    e: React.PointerEvent,
  ) => {
    move(e.clientX, e.clientY)
    const mv = (ev: PointerEvent) => move(ev.clientX, ev.clientY)
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }

  const { r, g, b } = hsvToRgb(h, s, v)
  const hex = rgbToHex(r, g, b)
  const hueHex = (() => {
    const c = hsvToRgb(h, 1, 1)
    return rgbToHex(c.r, c.g, c.b)
  })()
  const numStyle: React.CSSProperties = {
    width: 38,
    fontSize: 11,
    fontFamily: 'monospace',
    padding: '3px 4px',
    color: '#0e0c09',
    background: '#fff',
    border: `0.5px solid ${GOLD}`,
    borderRadius: 3,
  }
  const lbl: React.CSSProperties = {
    fontSize: 9,
    color: 'var(--muted2)',
    width: 12,
  }

  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Saturation / Brightness square */}
        <div
          ref={svRef}
          onPointerDown={(e) => startDrag(dragSV, e)}
          style={{
            position: 'relative',
            width: 168,
            height: 132,
            borderRadius: 4,
            cursor: 'crosshair',
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: `${s * 100}%`,
              top: `${(1 - v) * 100}%`,
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #fff',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        </div>
        {/* Hue bar */}
        <div
          ref={hueRef}
          onPointerDown={(e) => startDrag(dragHue, e)}
          style={{
            position: 'relative',
            width: 16,
            height: 132,
            borderRadius: 4,
            cursor: 'ns-resize',
            background:
              'linear-gradient(to bottom,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: `${(h / 360) * 100}%`,
              left: -2,
              right: -2,
              height: 4,
              border: '1px solid #fff',
              borderRadius: 2,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* HEX + RGB + HSB fields */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: hex,
            border: '1px solid rgba(255,255,255,0.4)',
          }}
        />
        <input
          type="text"
          value={hex.toUpperCase()}
          onChange={(e) => {
            const val = e.target.value.trim()
            if (/^#?[0-9a-f]{6}$/i.test(val)) {
              const hx = val.startsWith('#') ? val : `#${val}`
              const rgb = hexToRgb(hx)
              const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
              setH(hsv.h)
              setS(hsv.s)
              setV(hsv.v)
              lastHex.current = hx
              onChange(hx)
            }
          }}
          style={{ ...numStyle, width: 84 }}
        />
        <button
          type="button"
          onClick={() => emit(h, s, Math.max(0, v - 0.07))}
          style={{
            ...numStyle,
            width: 'auto',
            cursor: 'pointer',
            color: GOLD,
            background: 'transparent',
          }}
        >
          − Dark
        </button>
        <button
          type="button"
          onClick={() => emit(h, s, Math.min(1, v + 0.07))}
          style={{
            ...numStyle,
            width: 'auto',
            cursor: 'pointer',
            color: GOLD,
            background: 'transparent',
          }}
        >
          + Light
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(
            [
              ['R', r, (n: number) => {
                const hsv = rgbToHsv(clamp255(n), g, b)
                setH(hsv.h); setS(hsv.s); setV(hsv.v); emit(hsv.h, hsv.s, hsv.v)
              }],
              ['G', g, (n: number) => {
                const hsv = rgbToHsv(r, clamp255(n), b)
                setH(hsv.h); setS(hsv.s); setV(hsv.v); emit(hsv.h, hsv.s, hsv.v)
              }],
              ['B', b, (n: number) => {
                const hsv = rgbToHsv(r, g, clamp255(n))
                setH(hsv.h); setS(hsv.s); setV(hsv.v); emit(hsv.h, hsv.s, hsv.v)
              }],
            ] as [string, number, (n: number) => void][]
          ).map(([k, val, on]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={lbl}>{k}</span>
              <input
                type="number"
                min={0}
                max={255}
                value={val}
                onChange={(e) => on(Number(e.target.value))}
                style={numStyle}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(
            [
              ['H', Math.round(h), (n: number) => { setH(n); emit(n, s, v) }, 360],
              ['S', Math.round(s * 100), (n: number) => { const ns = n / 100; setS(ns); emit(h, ns, v) }, 100],
              ['B', Math.round(v * 100), (n: number) => { const nv = n / 100; setV(nv); emit(h, s, nv) }, 100],
            ] as [string, number, (n: number) => void, number][]
          ).map(([k, val, on, mx]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={lbl}>{k}</span>
              <input
                type="number"
                min={0}
                max={mx}
                value={val}
                onChange={(e) => on(Number(e.target.value))}
                style={numStyle}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Eyedropper cursor (gold pen/dropper SVG as a data-URI cursor).
const DROPPER_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><g fill='none' stroke='%23b8965a' stroke-width='2'><path d='M18 4l6 6-9 9-6 1 1-6z'/><path d='M3 25l6-6' stroke-linecap='round'/></g></svg>\") 2 26, crosshair"

const BG_PALETTE: { id: string; label: string; hex: string }[] = [
  { id: 'cream', label: 'Cream', hex: '#f5f0e8' },
  { id: 'ivory', label: 'Ivory', hex: '#efe7d6' },
  { id: 'warmgrey', label: 'Warm grey', hex: '#b9b2a4' },
  { id: 'charcoal', label: 'Charcoal', hex: '#3a342c' },
  { id: 'black', label: 'Black', hex: '#0e0c09' },
  { id: 'blush', label: 'Blush', hex: '#e8d6d2' },
]

/** Resolve the solid fill colour for a spread's background (paper/color).
 *  For mode==='photo' callers handle the image separately. */
function bgFillColor(bg: SpreadBg | undefined): string {
  if (!bg || bg.mode === 'paper') return PAPER_HEX
  if (bg.mode === 'color') return bg.color || BG_PALETTE[0].hex
  return PAPER_HEX
}

/** Auto frame colour for a MATTED photo: a thin border so the photo
 *  edge always reads as intentional (never a stray seam). White on
 *  dark / photo backgrounds; dark on light/white backgrounds so it
 *  stays visible (per owner spec). */
function frameColorForBg(bg: SpreadBg | undefined): string {
  if (bg && bg.mode === 'photo') return '#ffffff' // classic mat over imagery
  const hex = bgFillColor(bg)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return L > 0.7 ? '#1a1a1a' : '#ffffff'
}

// ============== ALBUM SPECS ==============

const ALBUM_SPECS: Record<
  AlbumSize,
  Record<AlbumType, { base: number; perExtraSpread: number; minSpreads: number; maxSpreads: number }> & {
    spreadAspectRatio: number
    label: string
    desc: string
  }
> = {
  '17x24': {
    spreadAspectRatio: 24 / 17,
    label: '17×24',
    desc: 'Coffee-table size · the classic format',
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: 25 },
  },
  '12x24': {
    // Same pricing as 17×24 per owner. 12 tall × 24 wide open → 24/12 = 2.0
    spreadAspectRatio: 24 / 12,
    label: '12×24',
    desc: 'Panoramic · slim landscape format',
    standard: { base: 240, perExtraSpread: 8, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 275, perExtraSpread: 10, minSpreads: 10, maxSpreads: 25 },
  },
  '20x30': {
    spreadAspectRatio: 30 / 20,
    label: '20×30',
    desc: 'Oversized poster · premium hero format',
    standard: { base: 340, perExtraSpread: 12, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 375, perExtraSpread: 15, minSpreads: 10, maxSpreads: 25 },
  },
  '15x30': {
    // Owner: $300 base, +$15 per sheet (standard). Layflat assumed at the
    // same +$35 base / +$3 per-spread delta as the other sizes — CONFIRM.
    spreadAspectRatio: 30 / 15,
    label: '15×30',
    desc: 'Grand panoramic · wide statement format',
    standard: { base: 300, perExtraSpread: 15, minSpreads: 10, maxSpreads: 25 },
    layflat: { base: 335, perExtraSpread: 18, minSpreads: 10, maxSpreads: 25 },
  },
}

function computePrice(size: AlbumSize, type: AlbumType, spreads: number): number {
  const spec = ALBUM_SPECS[size][type]
  const extra = Math.max(0, spreads - spec.minSpreads)
  return spec.base + extra * spec.perExtraSpread
}

// ============== LAYOUT TEMPLATES ==============
// Half-mm-thin gaps: 0.5% edge, 1% gutter (0.5% each side of x=50),
// 0.5% inter-photo. All slot %ages within the spread.
// HALF_W = 49 (left half: 0.5 to 49.5, right half: 50.5 to 99.5).















// ============== DEMO DATA ==============

function buildSampleWeddingPhotos(): Photo[] {
  // Sample photos start in the UNASSIGNED bucket — same as real uploads.
  // The Group step is meant to teach the user how to drag-and-tag, so
  // presenting them already-tagged would skip the lesson and feel
  // confusing ("why are these in Other 1?").
  const blurryIdxs = new Set([4, 13, 22])
  // Realistic, VARIED dimensions so the orientation scorer and the smart
  // DPI zoom-cap behave like real wedding photos. ~60% portrait, ~30%
  // landscape, ~10% square — and the picsum URL aspect matches the
  // reported width/height so previews aren't distorted.
  return Array.from({ length: 30 }, (_, i) => {
    const kind = i % 10 === 0 ? 'square' : i % 3 === 1 ? 'landscape' : 'portrait'
    const dims =
      kind === 'portrait'
        ? { width: 4000, height: 6000, pw: 1000, ph: 1500 }
        : kind === 'landscape'
        ? { width: 6000, height: 4000, pw: 1500, ph: 1000 }
        : { width: 4000, height: 4000, pw: 1200, ph: 1200 }
    return {
      id: `sample-${i}`,
      preview: `https://picsum.photos/seed/wedding${i}/${dims.pw}/${dims.ph}`,
      width: dims.width,
      height: dims.height,
      tagged: 'none' as const,
      eventId: 'unassigned' as EventId,
      blurry: blurryIdxs.has(i),
    }
  })
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

function SmartDesignerInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlAlbumId = searchParams?.get('album') ?? null

  const [albumId, setAlbumId] = useState<string | null>(urlAlbumId)
  const [albumName, setAlbumName] = useState<string>('')
  const [hydrated, setHydrated] = useState(false) // true once we've read localStorage on mount
  const [step, setStep] = useState<Step>('setup')
  const [size, setSize] = useState<AlbumSize | null>(null)
  const [type, setType] = useState<AlbumType | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [pageCount, setPageCount] = useState(15)
  // Album "mood" the client picks once before generation. Smart mix is the
  // recommended default so a non-designer gets a well-paced album for free.
  const [albumStyle, setAlbumStyle] = useState<AlbumStyle>('mix')
  const [spreads, setSpreads] = useState<Spread[]>([])
  // Unused-pool state — explicit (not derived) so undo/redo ops can move
  // photos between spreads and unused without recomputing. Initialized
  // when generateLayout runs; maintained by ops afterwards.
  const [unusedPhotoIds, setUnusedPhotoIds] = useState<string[]>([])
  const [eventFilter, setEventFilter] = useState<EventId | 'all'>('all')
  const [recatId, setRecatId] = useState<string | null>(null)
  // Tracks which event card is currently a drag-over target (for the
  // gold-highlight feedback while the user drags a photo onto a tag).
  const [recatDragOverEvent, setRecatDragOverEvent] = useState<EventId | null>(null)
  // Multi-select for the Group step. Click a photo to toggle its selection;
  // dragging any selected photo carries the whole set. The action bar at the
  // bottom of the screen gives quick "Move all to <tag>" buttons.
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set())
  // Per-album custom names for the event tags. Keyed by EventId. Persisted
  // alongside the rest of the wizard state. Falls back to the default name
  // from the EVENTS array.
  const [customEventNames, setCustomEventNames] = useState<Record<string, string>>({})
  const [editingTagId, setEditingTagId] = useState<EventId | null>(null)
  // Empty-slot picker — when a user clicks a "+ Add" empty slot in the
  // adjust step, this opens a small popover with two options:
  //   1. Pick from unused photos
  //   2. Upload a new file
  const [emptySlotPicker, setEmptySlotPicker] = useState<{ spreadId: string; slotIdx: number } | null>(null)
  const emptySlotFileInputRef = useRef<HTMLInputElement>(null)

  // ---------- Final submit flow ----------
  // Customer info form (modal shown when "Submit Order" is clicked).
  const [submitModalOpen, setSubmitModalOpen] = useState(false)
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'United States',
    notes: '',
  })
  // Submission progress: uploadIdx of total when uploading photos.
  const [submitting, setSubmitting] = useState<{
    stage: 'idle' | 'uploading' | 'persisting' | 'done' | 'error'
    done: number
    total: number
    label: string
    error?: string
  }>({ stage: 'idle', done: 0, total: 0, label: '' })
  // Real order ID returned by /api/submit-smart-order (replaces the
  // session-only random one we generate at mount time).
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null)
  const [polishHandoff, setPolishHandoff] = useState(false)
  // Album cover (leather / acrylic / photo). null until the client
  // completes the required Cover step.
  const [coverState, setCoverState] = useState<CoverState | null>(null)
  // Flat-rendered cover preview URLs (front + back) shown on the proof
  // step. Generated on-the-fly client-side from the same render-cover
  // used at submit, so what they approve = what prints.
  const [proofCoverImgs, setProofCoverImgs] = useState<{
    front: string | null
    back: string | null
  }>({ front: null, back: null })
  // Full-screen flipbook preview ("open your album"). Opens lazily.
  const [showAlbumPreview, setShowAlbumPreview] = useState(false)

  // Render the flat cover preview(s) for the proof step. Front always
  // (every type), back as well for photo covers — the owner asked for
  // both. Uses the SAME render-cover the print composite uses, so the
  // proof image matches the printed cover.
  useEffect(() => {
    if (step !== 'proof' || !coverState) {
      setProofCoverImgs({ front: null, back: null })
      return
    }
    let cancelled = false
    const made: string[] = []
    ;(async () => {
      const common = {
        type: coverState.type,
        leatherColor: coverState.leatherColor,
        foilColor: coverState.foilColor,
        customTextHex: coverState.customTextHex,
        fontId: coverState.fontId,
        fontSize: coverState.fontSize,
        primaryText: coverState.primaryText,
        subtitleText: coverState.subtitleText,
        position: coverState.position,
        photoSrc: coverState.photoSrc,
        backPhotoSrc: coverState.backPhotoSrc,
        photoScale: coverState.photoScale,
        photoX: coverState.photoX,
        photoY: coverState.photoY,
        titleX: coverState.titleX,
        titleY: coverState.titleY,
      }
      try {
        const fb = await renderCoverComposite({ ...common, side: 'front' })
        if (cancelled) return
        const fUrl = URL.createObjectURL(fb)
        made.push(fUrl)
        let bUrl: string | null = null
        if (coverState.type === 'photo') {
          const bb = await renderCoverComposite({ ...common, side: 'back' })
          if (cancelled) return
          bUrl = URL.createObjectURL(bb)
          made.push(bUrl)
        }
        setProofCoverImgs({ front: fUrl, back: bUrl })
      } catch {
        /* silent — proof falls back to the summary card */
      }
    })()
    return () => {
      cancelled = true
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [step, coverState])

  // ────── Phase 1: Proof approval (clause 2.3) ──────
  // Tracks which spreads the customer has personally reviewed. Required
  // before they can hit "Approve This Proof for Printing."
  // Cleared whenever the user navigates back to adjust (so any subsequent
  // edit forces a fresh review).
  const [reviewedSpreadIds, setReviewedSpreadIds] = useState<Set<string>>(new Set())
  // The full audit record we send to the server when proof is approved.
  // Server adds IP + UA + orderId on its side.
  const [proofApproval, setProofApproval] = useState<{
    acceptedAt: string
    clauseVersion: string
    clauseText: string
    reviewedSpreadIds: string[]
  } | null>(null)

  // ────── Phase 2: Content rights modal (clauses 2.2 + 2.4) ──────
  // Shown the first time photos enter the album. Stored in localStorage
  // tied to the album so resuming a saved album doesn't re-prompt.
  const [contentRightsModalOpen, setContentRightsModalOpen] = useState(false)
  // Two-checkbox state inside the modal.
  const [crCopyrightOk, setCrCopyrightOk] = useState(false)
  const [crPolicyOk, setCrPolicyOk] = useState(false)
  const [contentRights, setContentRights] = useState<{
    acceptedAt: string
    clauseVersion: string
    copyrightClause: string
    policyClause: string
  } | null>(null)
  const [swapSlot, setSwapSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  // Tap-to-place: an unused photo the user "picked up" by tapping it.
  // While set, tapping any slot drops this photo into it. This is the
  // touch-friendly alternative to HTML5 drag-and-drop (which is
  // mouse-only and silently does nothing on touchscreens).
  const [pickedUnusedId, setPickedUnusedId] = useState<string | null>(null)
  // Universal pointer-drag (mouse + touch + pen). Native HTML5 DnD is
  // mouse-only; this works on every device. A floating ghost follows the
  // pointer; on release we hit-test the slot under it via
  // document.elementFromPoint + data-ff-slot attributes.
  const pointerDragRef = useRef<{
    photoId: string
    startX: number
    startY: number
    active: boolean
    suppressClick: boolean
  } | null>(null)
  const [dragGhost, setDragGhost] = useState<{
    preview: string
    x: number
    y: number
  } | null>(null)
  const [editSlot, setEditSlot] = useState<{ spreadId: string; idx: number } | null>(null)
  const [adjusts, setAdjusts] = useState<Record<string, PhotoAdjust>>({})
  // Per-spread backgrounds (paper/color/photo). Keyed by spread id.
  // Separate from the op system, persisted like `adjusts`.
  const [spreadBgs, setSpreadBgs] = useState<Record<string, SpreadBg>>({})
  const [spreadTexts, setSpreadTexts] = useState<Record<string, SpreadText[]>>({})
  // Reusable saved background colours (e.g. picked from a photo) — shared
  // across every spread so the client keeps a consistent palette.
  const [savedColors, setSavedColors] = useState<string[]>(['', '', ''])
  const saveColor = useCallback((hex: string) => {
    setSavedColors((prev) => {
      if (!hex || prev.includes(hex)) return prev
      const empty = prev.indexOf('')
      const next = [...prev]
      if (empty >= 0) next[empty] = hex
      else {
        next.shift()
        next.push(hex)
      }
      return next
    })
  }, [])
  const [layoutMenuId, setLayoutMenuId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [orderId] = useState(() => `FF-${Math.floor(100000 + Math.random() * 900000)}`)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Folder picker — uses webkitdirectory so we read each file's
  // relative path and auto-tag photos by their event folder.
  const folderInputRef = useRef<HTMLInputElement>(null)

  // ----- Undo / redo (5-deep, per-album, persisted) -----
  const { show: showToast, Toast } = useToast()
  const undoApi = useUndo({
    albumId,
    state: {
      spreads: spreads as unknown as OpSpread[],
      unusedPhotoIds,
    },
    setState: ({ spreads: nextSpreads, unusedPhotoIds: nextUnused }) => {
      setSpreads(nextSpreads as unknown as Spread[])
      setUnusedPhotoIds(nextUnused)
    },
    onAnnounce: showToast,
  })

  // -------- Album hydrate / mint on mount --------
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (urlAlbumId) {
      // Resume an existing smart album: load saved state.
      const indexEntry = readAlbumsIndex().find((a) => a.id === urlAlbumId)
      if (indexEntry) {
        setAlbumName(indexEntry.name)
      }
      let loadedPhotos: Photo[] | null = null
      try {
        const raw = window.localStorage.getItem(`${SMART_STATE_PREFIX}:${urlAlbumId}`)
        if (raw) {
          const s = JSON.parse(raw) as Partial<{
            size: AlbumSize
            type: AlbumType
            pageCount: number
            albumStyle: AlbumStyle
            step: Step
            photos: Photo[]
            spreads: Spread[]
            adjusts: Record<string, PhotoAdjust>
            spreadBgs: Record<string, SpreadBg>
            spreadTexts: Record<string, SpreadText[]>
            savedColors: string[]
            coverState: CoverState
            unusedPhotoIds: string[]
            customEventNames: Record<string, string>
          }>
          if (s.size) setSize(s.size)
          if (s.type) setType(s.type)
          if (typeof s.pageCount === 'number') setPageCount(s.pageCount)
          if (s.albumStyle) setAlbumStyle(s.albumStyle)
          if (s.step) setStep(s.step)
          if (Array.isArray(s.photos)) {
            // Migrate any legacy eventIds (ceremony / portraits / other)
            // from albums saved with the old 5-tag list.
            const migrated = s.photos.map((p) =>
              p.eventId !== migrateLegacyEvent(p.eventId)
                ? { ...p, eventId: migrateLegacyEvent(p.eventId) }
                : p,
            )
            loadedPhotos = migrated
            setPhotos(migrated)
          }
          if (Array.isArray(s.spreads)) setSpreads(s.spreads)
          if (s.adjusts && typeof s.adjusts === 'object') setAdjusts(s.adjusts)
          if (s.spreadBgs && typeof s.spreadBgs === 'object') setSpreadBgs(s.spreadBgs)
          if (s.spreadTexts && typeof s.spreadTexts === 'object') setSpreadTexts(s.spreadTexts)
          if (Array.isArray(s.savedColors)) setSavedColors(s.savedColors)
          if (s.coverState && typeof s.coverState === 'object') setCoverState(s.coverState)
          if (Array.isArray(s.unusedPhotoIds)) setUnusedPhotoIds(s.unusedPhotoIds)
          if (s.customEventNames && typeof s.customEventNames === 'object') {
            setCustomEventNames(s.customEventNames)
          }
        }
      } catch {
        /* ignore corrupt state */
      }

      // Phase 2: hydrate content-rights acceptance from localStorage so the
      // modal doesn't re-prompt on every visit.
      try {
        const crRaw = window.localStorage.getItem(`folio-content-rights:${urlAlbumId}`)
        if (crRaw) {
          const cr = JSON.parse(crRaw) as {
            acceptedAt: string
            clauseVersion: string
            copyrightClause: string
            policyClause: string
          }
          if (cr.acceptedAt && cr.clauseVersion) setContentRights(cr)
        }
      } catch {
        /* ignore */
      }

      // Restore uploaded photo blobs from IndexedDB.
      // Saved blob: URLs are invalidated by the browser on reload, so we
      // look them up by photoId in IDB and replace with fresh object URLs.
      // Sample photos (https://picsum.photos/...) keep their stable URLs.
      if (loadedPhotos && loadedPhotos.some((p) => p.preview.startsWith('blob:'))) {
        loadAlbumBlobs(urlAlbumId).then((blobMap) => {
          if (blobMap.size === 0) return
          setPhotos((prev) =>
            prev.map((p) => {
              if (!p.preview.startsWith('blob:')) return p
              const fresh = blobMap.get(p.id)
              return fresh ? { ...p, preview: fresh } : p
            }),
          )
        })
      }

      setHydrated(true)
      return
    }

    // No album in URL — mint a new one. Prompt for name first.
    const raw = window.prompt(
      'Name this album (you can rename later from the My Albums list):',
      '',
    )
    if (raw === null) {
      // User cancelled — return to design picker
      router.push('/design')
      return
    }
    const trimmed = raw.trim().slice(0, 80)
    const fallback = (() => {
      try {
        return 'Smart · ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      } catch {
        return 'Smart album'
      }
    })()
    const name = trimmed || fallback
    const newId = generateAlbumId()
    upsertAlbumIndex(newId, { name, mode: 'smart' })
    setAlbumId(newId)
    setAlbumName(name)
    // Push the album id into the URL so refresh resumes correctly
    router.replace(`/design/smart?album=${newId}`)
    setHydrated(true)
  }, [urlAlbumId, router])

  // -------- Auto-save on state changes --------
  useEffect(() => {
    if (!hydrated || !albumId || typeof window === 'undefined') return
    try {
      const payload = {
        size,
        type,
        pageCount,
        albumStyle,
        step: step === 'generate' ? 'pages' : step, // don't get stuck mid-generate
        photos,
        spreads,
        adjusts,
        spreadBgs,
        spreadTexts,
        savedColors,
        coverState,
        unusedPhotoIds,
        customEventNames,
      }
      window.localStorage.setItem(`${SMART_STATE_PREFIX}:${albumId}`, JSON.stringify(payload))
      upsertAlbumIndex(albumId, {})
    } catch {
      /* quota exceeded or disabled — silently drop */
    }
  }, [hydrated, albumId, size, type, pageCount, albumStyle, step, photos, spreads, adjusts, spreadBgs, spreadTexts, savedColors, coverState, unusedPhotoIds, customEventNames])

  const renameAlbum = () => {
    if (!albumId) return
    const next = window.prompt('Rename album:', albumName)
    if (next === null) return
    const trimmed = next.trim().slice(0, 80)
    if (!trimmed || trimmed === albumName) return
    upsertAlbumIndex(albumId, { name: trimmed })
    setAlbumName(trimmed)
  }

  const heroCount = photos.filter((p) => p.tagged === 'hero').length
  const favCount = photos.filter((p) => p.tagged === 'favorite').length
  const usefulPhotoCount = photos.filter((p) => !p.blurry).length

  // Recommended spreads = photos ÷ 4 (breathable, ~4 photos per spread).
  // Floor of 10, ceiling of 25 to fit album-spec range.
  const recommendedSpreads = Math.max(10, Math.min(25, Math.ceil(usefulPhotoCount / 4)))

  // BILLABLE spread count = the number actually in the album.
  // Before generation, `spreads` is empty so we charge against the
  // client's target `pageCount`. Once the spreads exist, we charge
  // against `spreads.length` so the price reflects edits — including
  // deleting whole spreads.
  const billedSpreads = spreads.length > 0 ? spreads.length : pageCount
  const albumPrice = useMemo(() => {
    if (!size || !type) return 0
    return computePrice(size, type, billedSpreads)
  }, [size, type, billedSpreads])

  // Cover add-on (0 until they've chosen on the Cover step).
  const coverPrice = coverState ? COVER_PRICE[coverState.type] : 0
  // Everything-in total shown at proof / submit / payment.
  const orderTotal = albumPrice + (polishHandoff ? 99 : 0) + coverPrice

  // Phase 2: gate any path that adds photos behind the content-rights modal.
  // Returns true if photos may be added now; false if the modal was opened
  // and the caller should bail (the user will retry after accepting).
  const ensureContentRights = useCallback((): boolean => {
    if (contentRights) return true
    setCrCopyrightOk(false)
    setCrPolicyOk(false)
    setContentRightsModalOpen(true)
    return false
  }, [contentRights])

  const loadSamples = useCallback(() => {
    if (!ensureContentRights()) return
    setPhotos(buildSampleWeddingPhotos())
  }, [ensureContentRights])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    if (!ensureContentRights()) {
      // Clear the input so opening it again triggers another change event.
      e.target.value = ''
      return
    }
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
    const faceJobs: { id: string; file: Blob }[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      const dim = await getImageDimensions(file)
      // EXIF capture time + filename sequence — the layout engine uses
      // them to order each event's photos chronologically.
      const capturedAt = (await readJpegCaptureTime(file)) ?? undefined
      const seqNum = extractFilenameSeq(file.name) ?? undefined
      const photoId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
      newPhotos.push({
        id: photoId,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: 'unassigned',
        blurry: false,
        capturedAt,
        seqNum,
      })
      faceJobs.push({ id: photoId, file })
      // Persist the blob to IndexedDB so it survives a refresh.
      // Fire-and-forget; failure is handled inside saveBlob.
      if (albumId) saveBlob(albumId, photoId, file)
      setUploadProgress((i + 1) / toProcess.length)
    }
    setPhotos([...photos, ...newPhotos])
    kickoffFaceDetect(faceJobs)
    setTimeout(() => setUploadProgress(0), 600)
  }

  /**
   * Folder upload — uses <input type="file" webkitdirectory>. Each
   * file carries a `webkitRelativePath` like "Mehndi/IMG_001.jpg" which
   * we mine for ceremony names (Mehndi/Haldi/Nikkah/...) so photos
   * arrive already grouped — no manual tagging needed for clients who
   * organise their cards into folders (most photographers do).
   */
  const handleFolderSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files
    if (!files) return
    if (!ensureContentRights()) {
      e.target.value = ''
      return
    }
    // Filter to images only (folder picker accepts everything).
    const imgFiles = Array.from(files).filter((f) =>
      /^image\//i.test(f.type),
    )
    const remaining = PHOTO_CAP - photos.length
    if (remaining <= 0) {
      alert(`You've reached the ${PHOTO_CAP}-photo limit.`)
      e.target.value = ''
      return
    }
    const toProcess = imgFiles.slice(0, remaining)
    if (imgFiles.length > remaining) {
      alert(
        `Only ${remaining} more photos can fit (limit ${PHOTO_CAP}). Adding the first ${remaining}.`,
      )
    }

    setUploadProgress(0)
    const newPhotos: Photo[] = []
    const folderHits = new Set<GroupEventId>()
    const faceJobs: { id: string; file: Blob }[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      const dim = await getImageDimensions(file)
      const capturedAt = (await readJpegCaptureTime(file)) ?? undefined
      const seqNum = extractFilenameSeq(file.name) ?? undefined
      // Tag from folder name if we recognise it.
      const rel = (file as File & { webkitRelativePath?: string })
        .webkitRelativePath
      const fromFolder = pathToEvent(rel) ?? undefined
      if (fromFolder) folderHits.add(fromFolder)
      const photoId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
      newPhotos.push({
        id: photoId,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: (fromFolder as EventId) ?? 'unassigned',
        blurry: false,
        capturedAt,
        seqNum,
      })
      faceJobs.push({ id: photoId, file })
      if (albumId) saveBlob(albumId, photoId, file)
      setUploadProgress((i + 1) / toProcess.length)
    }

    // For any photos the folder pass DIDN'T tag, try EXIF time-gap
    // clustering — fills in gaps for clients who half-organised.
    const stillUntagged = newPhotos.filter((p) => p.eventId === 'unassigned')
    if (stillUntagged.length > 0) {
      const clusters = clusterByTimeGaps(stillUntagged, 6, folderHits)
      for (const p of newPhotos) {
        if (p.eventId === 'unassigned') {
          const eid = clusters.get(p.id)
          if (eid) p.eventId = eid as EventId
        }
      }
    }
    setPhotos([...photos, ...newPhotos])
    kickoffFaceDetect(faceJobs)
    setTimeout(() => setUploadProgress(0), 600)
    e.target.value = ''
  }

  /** Fire-and-forget face detection. Updates each photo's `faces` as
   *  the detector resolves; the layout engine reads those at generate
   *  time and auto-pans crops so faces aren't cut off. */
  const kickoffFaceDetect = (items: { id: string; file: Blob }[]) => {
    for (const { id, file } of items) {
      detectFaces(file).then((faces) => {
        if (!faces.length) return
        setPhotos((prev) =>
          prev.map((p) => (p.id === id ? { ...p, faces } : p)),
        )
      })
    }
  }

  /** Smart re-group all current photos by EXIF time gaps. Manual escape
   *  hatch on the Group step for clients who didn't upload by folder
   *  but want auto-tagging. Only touches photos still 'unassigned'. */
  const runSmartGroup = () => {
    const used = new Set<GroupEventId>(
      photos
        .map((p) => p.eventId as GroupEventId)
        .filter((e) => e && e !== 'unassigned'),
    )
    const targets = photos.filter((p) => p.eventId === 'unassigned')
    if (targets.length === 0) return
    const clusters = clusterByTimeGaps(targets, 6, used)
    if (clusters.size === 0) {
      alert(
        'No EXIF dates on those photos, so we can’t auto-group them. Try uploading a folder, or tag them manually.',
      )
      return
    }
    setPhotos((prev) =>
      prev.map((p) => {
        if (p.eventId !== 'unassigned') return p
        const eid = clusters.get(p.id)
        return eid ? { ...p, eventId: eid as EventId } : p
      }),
    )
  }

  /**
   * Shared ingest used by device upload AND cloud sources (Dropbox /
   * Google). Takes already-fetched blobs and runs the exact same
   * pipeline: measure dimensions, make a preview URL, persist the blob
   * to IndexedDB, append to `photos`. Caller is responsible for the
   * content-rights gate (same as handleFileSelect).
   */
  const ingestImageBlobs = async (
    items: { blob: Blob; name: string }[],
  ): Promise<void> => {
    const remaining = PHOTO_CAP - photos.length
    if (remaining <= 0) {
      alert(`You've reached the ${PHOTO_CAP}-photo limit.`)
      return
    }
    const toProcess = items.slice(0, remaining)
    if (items.length > remaining) {
      alert(
        `Only ${remaining} more photos can fit (limit ${PHOTO_CAP}). Adding the first ${remaining}.`,
      )
    }
    setUploadProgress(0.0001)
    const newPhotos: Photo[] = []
    const faceJobs: { id: string; file: Blob }[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const { blob, name } = toProcess[i]
      const file =
        blob instanceof File
          ? blob
          : new File([blob], name || `cloud-${i}.jpg`, {
              type: blob.type || 'image/jpeg',
            })
      let dim: { width: number; height: number }
      try {
        dim = await getImageDimensions(file)
      } catch {
        continue // skip anything that isn't a decodable image
      }
      const capturedAt = (await readJpegCaptureTime(file)) ?? undefined
      const seqNum = extractFilenameSeq(file.name) ?? undefined
      const photoId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
      newPhotos.push({
        id: photoId,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: 'unassigned',
        blurry: false,
        capturedAt,
        seqNum,
      })
      faceJobs.push({ id: photoId, file })
      if (albumId) saveBlob(albumId, photoId, file)
      setUploadProgress((i + 1) / toProcess.length)
    }
    if (newPhotos.length) {
      setPhotos([...photos, ...newPhotos])
      kickoffFaceDetect(faceJobs)
    }
    setTimeout(() => setUploadProgress(0), 600)
  }

  /**
   * Dropbox Chooser (official drop-in). Loads dropins.js once with the
   * public app key, opens Dropbox's own trusted popup, then downloads
   * the chosen files and feeds them through the same ingest pipeline.
   * Needs NEXT_PUBLIC_DROPBOX_APP_KEY (Dropbox App Console → Chooser).
   */
  const openDropboxChooser = useCallback(() => {
    const appKey = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY
    if (!appKey) {
      alert(
        'Dropbox is not configured yet. (Owner: set NEXT_PUBLIC_DROPBOX_APP_KEY.)',
      )
      return
    }
    type DbxFile = { link: string; name: string }
    interface DbxChooser {
      choose: (opts: {
        success: (files: DbxFile[]) => void
        cancel?: () => void
        linkType: 'direct' | 'preview'
        multiselect: boolean
        extensions?: string[]
      }) => void
    }
    const w = window as unknown as { Dropbox?: DbxChooser }

    const run = () => {
      if (!w.Dropbox) {
        alert('Dropbox could not load. Please try again.')
        return
      }
      w.Dropbox.choose({
        linkType: 'direct',
        multiselect: true,
        extensions: ['.jpg', '.jpeg', '.png', '.heic', '.webp'],
        cancel: () => {},
        success: async (files) => {
          try {
            setUploadProgress(0.0001)
            const items: { blob: Blob; name: string }[] = []
            for (const f of files) {
              const r = await fetch(f.link)
              if (!r.ok) continue
              items.push({ blob: await r.blob(), name: f.name })
            }
            await ingestImageBlobs(items)
          } catch {
            alert('Could not import from Dropbox. Please try again.')
            setUploadProgress(0)
          }
        },
      })
    }

    if (w.Dropbox) {
      run()
      return
    }
    const existing = document.getElementById(
      'dropboxjs',
    ) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', run, { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = 'https://www.dropbox.com/static/api/2/dropins.js'
    s.id = 'dropboxjs'
    s.setAttribute('data-app-key', appKey)
    s.onload = run
    s.onerror = () => alert('Dropbox could not load. Check your connection.')
    document.body.appendChild(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, albumId])

  // Functional update so the helper composes correctly when called in a
  // loop (e.g. multi-drag drop on a tag fires recategorize once per id).
  // The old version read `photos` from closure → only the last call won
  // → user saw "only one photo moved" with multi-select.
  const recategorize = (photoId: string, eventId: EventId) => {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, eventId } : p)))
    setRecatId(null)
  }

  const toggleTag = (photoId: string, tag: 'hero' | 'favorite') => {
    const photo = photos.find((p) => p.id === photoId)
    if (!photo) return

    if (tag === 'hero' && photo.tagged !== 'hero') {
      if (photo.width < HERO_MIN_PX || photo.height < HERO_MIN_PX) {
        alert(
          `This photo is ${photo.width}×${photo.height}px. Hero photos take a full page (half-spread) ` +
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

  /**
   * After running generateLayout, install the spreads AND recompute the
   * unused pool as photos that didn't make it into any spread (blurry
   * photos are deliberately excluded from both layouts and the pool).
   */
  const installLayout = useCallback(
    (newSpreads: Spread[]) => {
      const placed = new Set(newSpreads.flatMap((s) => s.photoIds))
      const newUnused = photos.filter((p) => !p.blurry && !placed.has(p.id)).map((p) => p.id)
      setSpreads(newSpreads)
      setUnusedPhotoIds(newUnused)
      // Auto-style backgrounds: a MATTED spread looks flat on plain paper,
      // so we mirror one of its own photos behind it, softly blurred and
      // gently dimmed — the "blurred mirror" look. Full-bleed spreads keep
      // paper (the photos cover the page anyway). Fresh on every generate.
      const bgs: Record<string, SpreadBg> = {}
      for (const s of newSpreads) {
        if (templateFamily({ id: s.templateId }) === 'mat') {
          const firstPhoto = s.photoIds.find((id): id is string => Boolean(id))
          if (firstPhoto) {
            bgs[s.id] = {
              mode: 'photo',
              photoId: firstPhoto,
              blur: DEFAULT_BG_BLUR,
              dim: 0.18,
              zoom: 1,
              panX: 50,
              panY: 50,
            }
          }
        }
      }
      setSpreadBgs(bgs)

      // Crops start at the neutral 50/50 centre for every slot. We used
      // to auto-pan each photo around detected faces here, but that
      // moved crops in ways clients found unpredictable (and it fought
      // their manual zoom/pan edits). Photos now keep a clean centre
      // crop; the client pans/zooms only where they want to.
      setAdjusts({})
    },
    [photos],
  )

  // The smart engine runs on the SERVER (/api/smart-layout) so the
  // auto-hero / pacing / layout logic never ships to the browser. We
  // send only tiny photo metadata, never image bytes.
  const requestSmartLayout = useCallback(
    async (shuffle: boolean): Promise<Spread[]> => {
      if (!type) return []
      const aspect = size ? ALBUM_SPECS[size].spreadAspectRatio : 24 / 17
      const meta: LayoutPhoto[] = photos.map((p) => ({
        id: p.id,
        width: p.width,
        height: p.height,
        tagged: p.tagged,
        blurry: p.blurry,
        eventId: p.eventId,
        capturedAt: p.capturedAt,
        seqNum: p.seqNum,
      }))
      const res = await fetch('/api/smart-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photos: meta,
          pageCount,
          type,
          spreadAspectRatio: aspect,
          style: albumStyle,
          shuffle,
        }),
      })
      if (!res.ok) {
        let detail = ''
        try {
          detail = ((await res.json()) as { error?: string }).error ?? ''
        } catch {
          /* ignore */
        }
        throw new Error(detail || `Layout request failed (${res.status})`)
      }
      const json = (await res.json()) as { spreads: Spread[] }
      return json.spreads
    },
    [photos, pageCount, type, size, albumStyle],
  )

  const runGenerate = useCallback(() => {
    if (!type) return
    if (undoApi.canUndo || undoApi.canRedo) {
      const ok = window.confirm('Regenerating will clear your edit history. Continue?')
      if (!ok) return
    }
    undoApi.clearStack()
    setGenerating(true)
    setStep('generate')
    setAdjusts({})
    requestSmartLayout(false)
      .then((spreads) => {
        installLayout(spreads)
        setGenerating(false)
        setStep('adjust')
      })
      .catch((err) => {
        setGenerating(false)
        setStep('pages')
        alert(
          `Could not build the layout: ${
            err instanceof Error ? err.message : 'unknown error'
          }. Please try again.`,
        )
      })
  }, [type, undoApi, requestSmartLayout, installLayout])

  const regenerate = () => {
    if (!type) return
    if (undoApi.canUndo || undoApi.canRedo) {
      const ok = window.confirm('Regenerating will clear your edit history. Continue?')
      if (!ok) return
    }
    undoApi.clearStack()
    setGenerating(true)
    requestSmartLayout(true)
      .then((spreads) => {
        installLayout(spreads)
        setAdjusts({})
        setGenerating(false)
      })
      .catch((err) => {
        setGenerating(false)
        alert(
          `Could not regenerate: ${
            err instanceof Error ? err.message : 'unknown error'
          }. Please try again.`,
        )
      })
  }

  // Swap a slot photo with a replacement (could be from another spread,
  // could be from unused pool). Records the right Op so it goes on the
  // undo stack.
  const swapPhoto = (newPhotoId: string) => {
    if (!swapSlot) return
    const replacingSpreadId = swapSlot.spreadId
    const replacingIdx = swapSlot.idx

    const opState = {
      spreads: spreads as unknown as OpSpread[],
      unusedPhotoIds,
    }

    if (unusedPhotoIds.includes(newPhotoId)) {
      // Swap with unused
      undoApi.record(makeSwapWithUnusedOp(opState, replacingSpreadId, replacingIdx, newPhotoId))
    } else {
      // Cross-spread swap: find which spread/slot the new photo currently lives in
      const sourceSpread = spreads.find((s) => s.photoIds.includes(newPhotoId))
      if (sourceSpread) {
        const sourceIdx = sourceSpread.photoIds.indexOf(newPhotoId)
        if (sourceSpread.id === replacingSpreadId) {
          // In-spread reorder
          undoApi.record(makeSwapOp(opState, replacingSpreadId, sourceIdx, replacingIdx))
        } else {
          // Cross-spread swap
          undoApi.record(
            makeCrossSwapOp(opState, sourceSpread.id, sourceIdx, replacingSpreadId, replacingIdx),
          )
        }
      }
    }
    // Reset adjustment for this slot since the photo changed
    setAdjusts((prev) => {
      const next = { ...prev }
      delete next[adjustKey(replacingSpreadId, replacingIdx)]
      return next
    })
    setSwapSlot(null)
  }

  const swapTemplate = (spreadId: string, newTemplateId: string) => {
    const current = spreads.find((s) => s.id === spreadId)
    if (!current) return
    const newTpl = TEMPLATE_BY_ID.get(newTemplateId)
    if (!newTpl) return

    let newIds: (string | null)[] = [...current.photoIds]
    let nextUnused = [...unusedPhotoIds]

    if (newTpl.slots.length < newIds.length) {
      // shrink: surplus photos go BACK to unused (so user doesn't lose them)
      const surplus = newIds
        .slice(newTpl.slots.length)
        .filter((id): id is string => Boolean(id))
      newIds = newIds.slice(0, newTpl.slots.length)
      nextUnused = [...nextUnused, ...surplus]
    } else if (newTpl.slots.length > newIds.length) {
      // grow: leave new slots EMPTY (per owner's spec — don't auto-fill).
      // User clicks the empty slot's + Add button to fill it manually.
      while (newIds.length < newTpl.slots.length) {
        newIds.push(null)
      }
    }

    const op = makeLayoutVariantOp(
      { spreads: spreads as unknown as OpSpread[] },
      spreadId,
      newTemplateId,
      newIds,
    )
    // Layout variant op only knows about the spread; if we shifted the
    // unused pool above, sync it manually after recording.
    undoApi.record(op)
    if (nextUnused.length !== unusedPhotoIds.length) {
      setUnusedPhotoIds(nextUnused)
    }
    setLayoutMenuId(null)
    setAdjusts((prev) => {
      const next: Record<string, PhotoAdjust> = {}
      Object.entries(prev).forEach(([k, v]) => {
        if (!k.startsWith(`${spreadId}::`)) next[k] = v
      })
      return next
    })
  }

  const updateAdjust = (key: string, patch: Partial<PhotoAdjust>) => {
    setAdjusts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? DEFAULT_ADJUST), ...patch },
    }))
  }

  // ---------- Add a new (empty) spread to the album from the adjust step ----------
  // Inserts at the end. Uses the 'pair' template so the new spread has 2 empty
  // slots, each with a "+ Add photo" affordance. Increments pageCount so the
  // price recalculates and persists. Capped at the album spec's maxSpreads.
  const handleAddSpread = useCallback(() => {
    if (!size || !type) return
    const spec = ALBUM_SPECS[size][type]
    // Cap against the ACTUAL spread count, not the original pageCount
    // target — otherwise after a delete the cap is wrong (room was
    // freed up but the button stays "max reached").
    const currentCount = spreads.length || pageCount
    if (currentCount >= spec.maxSpreads) {
      showToast(`Max ${spec.maxSpreads} spreads for ${ALBUM_SPECS[size].label}`)
      return
    }
    const pairTpl =
      TEMPLATES.find((t) => t.compat.includes(type) && t.id === 'pair') ?? TEMPLATES[0]
    const newSpread: Spread = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      templateId: pairTpl.id,
      photoIds: new Array(pairTpl.slots.length).fill(null),
      eventId: 'unassigned',
    }
    setSpreads((prev) => [...prev, newSpread])
    setPageCount((prev) => prev + 1)
    showToast(`+1 spread · $${spec.perExtraSpread} added to total`)
  }, [size, type, spreads.length, pageCount, showToast])

  // ---------- Empty-slot fillers (called from SpreadView's "+ Add" overlay) ----------
  /** Place a specific photo id into an empty slot. Used by both pick-from-unused
   *  and upload-new flows. */
  const fillEmptySlot = useCallback(
    (spreadId: string, slotIdx: number, photoId: string) => {
      setSpreads((prev) =>
        prev.map((s) => {
          if (s.id !== spreadId) return s
          const newIds = [...s.photoIds]
          newIds[slotIdx] = photoId
          return { ...s, photoIds: newIds }
        }),
      )
      setUnusedPhotoIds((prev) => prev.filter((id) => id !== photoId))
      setEmptySlotPicker(null)
    },
    [],
  )

  // Shared placement: drop an unused photo into a slot. Empty slot →
  // fill; filled slot → swap (old photo back to unused, undoable).
  // Used by BOTH tap-to-place and the universal pointer-drag.
  const placeUnusedIntoSlot = useCallback(
    (spreadId: string, slotIdx: number, photoId: string) => {
      const target = spreads.find((s) => s.id === spreadId)
      const filled = target ? Boolean(target.photoIds[slotIdx]) : false
      if (filled) {
        undoApi.record(
          makeSwapWithUnusedOp(
            { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
            spreadId,
            slotIdx,
            photoId,
          ),
        )
      } else {
        fillEmptySlot(spreadId, slotIdx, photoId)
      }
      setPickedUnusedId(null)
      setEditSlot({ spreadId, idx: slotIdx })
    },
    [spreads, unusedPhotoIds, undoApi, fillEmptySlot],
  )

  // Drag-to-background: drop a photo on a spread's empty/matted area to
  // make it the blurred background. Sensible defaults if first time.
  const setSpreadBgPhoto = useCallback(
    (spreadId: string, photoId: string) => {
      setSpreadBgs((prev) => {
        const cur = prev[spreadId]
        return {
          ...prev,
          [spreadId]: {
            mode: 'photo',
            photoId,
            blur: cur?.blur ?? DEFAULT_BG_BLUR,
            dim: cur?.dim ?? 0.25,
            zoom: Math.min(BG_PHOTO_MAX_ZOOM, cur?.zoom ?? 1),
            panX: cur?.panX ?? 50,
            panY: cur?.panY ?? 50,
          },
        }
      })
      setPickedUnusedId(null)
    },
    [],
  )

  // ----- Universal pointer-drag for unused photos -----
  const beginPointerDrag = useCallback(
    (e: React.PointerEvent, photoId: string, preview: string) => {
      // Left button / primary touch only
      if (e.button !== 0 && e.pointerType === 'mouse') return
      pointerDragRef.current = {
        photoId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        suppressClick: false,
      }

      const DRAG_THRESHOLD = 7 // px before it counts as a drag (vs a tap)

      const onMove = (ev: PointerEvent) => {
        const st = pointerDragRef.current
        if (!st) return
        const dx = ev.clientX - st.startX
        const dy = ev.clientY - st.startY
        if (!st.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        if (!st.active) {
          st.active = true
          st.suppressClick = true
        }
        ev.preventDefault()
        setDragGhost({ preview, x: ev.clientX, y: ev.clientY })
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const st = pointerDragRef.current
        setDragGhost(null)
        if (!st || !st.active) {
          // No real movement → it was a tap; let onClick handle it.
          pointerDragRef.current = null
          return
        }
        // Hit-test whatever is under the release point.
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const slotEl = el?.closest('[data-ff-slot]') as HTMLElement | null
        if (slotEl) {
          // Dropped on a photo slot → fill / swap.
          const sId = slotEl.getAttribute('data-ff-spread')
          const sIdx = slotEl.getAttribute('data-ff-slot')
          if (sId && sIdx !== null) {
            placeUnusedIntoSlot(sId, Number(sIdx), st.photoId)
          }
        } else {
          // Not on a slot — dropped on the spread's background/margin
          // area → use this photo as the blurred background.
          const bgEl = el?.closest('[data-ff-bgzone]') as HTMLElement | null
          const bgSpread = bgEl?.getAttribute('data-ff-bgspread')
          if (bgSpread) {
            setSpreadBgPhoto(bgSpread, st.photoId)
          }
        }
        // keep suppressClick true until the click fires, then it resets
        setTimeout(() => {
          if (pointerDragRef.current === st) pointerDragRef.current = null
        }, 0)
      }

      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
    },
    [placeUnusedIntoSlot, setSpreadBgPhoto],
  )

  const onEmptySlotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!emptySlotPicker) return
    const file = e.target.files?.[0]
    if (!file) return
    if (!ensureContentRights()) {
      e.target.value = ''
      return
    }
    const dim = await getImageDimensions(file)
    const photoId = `${Date.now()}-empty-${Math.random().toString(36).slice(2, 8)}`
    const newPhoto: Photo = {
      id: photoId,
      preview: URL.createObjectURL(file),
      width: dim.width,
      height: dim.height,
      tagged: 'none',
      eventId: 'unassigned',
      blurry: false,
    }
    setPhotos((prev) => [...prev, newPhoto])
    if (albumId) saveBlob(albumId, photoId, file)
    fillEmptySlot(emptySlotPicker.spreadId, emptySlotPicker.slotIdx, photoId)
    e.target.value = ''
  }

  // ---------- Final submit (customer info → upload to R2 → API call) ----------
  // Validates the form, runs the photo-upload pipeline (orig + watermarked
  // preview to R2), then POSTs everything to /api/submit-smart-order which
  // persists to KV + emails owner + customer. On success we land on the
  // submit step with the REAL order ID returned by the server.
  const runFinalSubmit = useCallback(async () => {
    if (!size || !type) return
    const c = customerForm
    if (!c.name.trim() || !c.email.trim()) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Name and email are required' })
      return
    }
    if (!c.line1.trim() || !c.city.trim() || !c.postalCode.trim()) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Shipping address line 1, city and postal code are required' })
      return
    }
    if (!albumId) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Album id missing — please refresh and try again' })
      return
    }
    // Legal gate (clause 2.3 + clause 2.4). If either record is missing we
    // refuse — the customer must have walked through both checkpoints.
    if (!proofApproval) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Proof not approved. Please review every spread before submitting (clause 2.3).' })
      return
    }
    if (!contentRights) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Content rights not accepted (clauses 2.2 and 2.4). Please re-open the rights confirmation.' })
      return
    }
    // Only photos that are actually placed in spreads get uploaded.
    const usedIds = new Set(
      spreads.flatMap((s) => s.photoIds).filter((id): id is string => Boolean(id)),
    )
    const photosToUpload = photos.filter((p) => usedIds.has(p.id))
    if (photosToUpload.length === 0) {
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: 'Album has no photos placed' })
      return
    }

    setSubmitting({
      stage: 'uploading',
      done: 0,
      total: photosToUpload.length + spreads.length,
      label: 'Preparing upload…',
    })
    try {
      const { prepareSubmission } = await import('./edit/submit-helpers')
      const designId = albumId // use albumId as the R2 designId folder
      // Build the template map for spread compositing
      const templateMap = new Map(
        TEMPLATES.map((t) => [
          t.id,
          { id: t.id, name: t.name, slots: t.slots },
        ]),
      )
      // 200 DPI is our final-print target. Spread + cover composites
      // are rendered to canvases sized so the JPEG hits 200 DPI for the
      // album's PHYSICAL inches — e.g. a 17×24 album has a 24" wide
      // spread, so the composite long edge is 24 × 200 = 4800 px. The
      // closed-book cover is the album's short side (17" for 17×24).
      const PRINT_DPI = 200
      const sizeDims = size.split('x').map((n) => Number.parseInt(n, 10))
      const coverFaceInch = Number.isFinite(sizeDims[0]) ? sizeDims[0] : 17
      const spreadLongInch = Number.isFinite(sizeDims[1]) ? sizeDims[1] : 24
      const printSpreadLongEdgePx = spreadLongInch * PRINT_DPI
      const printCoverLongEdgePx = coverFaceInch * PRINT_DPI
      const result = await prepareSubmission({
        albumId,
        designId,
        photos: photosToUpload.map((p) => ({
          id: p.id,
          preview: p.preview,
          width: p.width,
          height: p.height,
        })),
        spreads: spreads.map((s) => ({
          id: s.id,
          templateId: s.templateId,
          photoIds: s.photoIds as (string | null)[],
        })),
        templates: templateMap,
        adjusts,
        spreadAspectRatio: ALBUM_SPECS[size].spreadAspectRatio,
        showGutter: type === 'standard',
        spreadBgs,
        spreadTexts,
        printSpreadLongEdgePx,
        printCoverLongEdgePx,
        // Only upload the per-photo ORIGINALS when the client has
        // opted into the polish-handoff add-on — the design team
        // needs the raw files to re-crop / fine-tune. For standard
        // orders the print lab only needs the spread composites
        // (which bake every photo in already), so uploading originals
        // on top is pure bandwidth + R2 waste.
        uploadOriginals: polishHandoff,
        cover: coverState
          ? {
              type: coverState.type,
              leatherColor: coverState.leatherColor,
              foilColor: coverState.foilColor,
              customTextHex: coverState.customTextHex,
              fontId: coverState.fontId,
              fontSize: coverState.fontSize,
              primaryText: coverState.primaryText,
              subtitleText: coverState.subtitleText,
              position: coverState.position,
              photoSrc: coverState.photoSrc,
              backPhotoSrc: coverState.backPhotoSrc,
              photoScale: coverState.photoScale,
              photoX: coverState.photoX,
              photoY: coverState.photoY,
              titleX: coverState.titleX,
              titleY: coverState.titleY,
            }
          : null,
        onProgress: (done, total, label) =>
          setSubmitting({ stage: 'uploading', done, total, label }),
      })

      setSubmitting({
        stage: 'persisting',
        done: photosToUpload.length + spreads.length,
        total: photosToUpload.length + spreads.length,
        label: 'Saving order…',
      })

      // Map photo tag + event back onto each upload result
      const photoById = new Map(photos.map((p) => [p.id, p]))
      const photosPayload = result.photos.map((u) => {
        const meta = photoById.get(u.photoId)
        return {
          ...u,
          tagged: meta?.tagged ?? 'none',
          eventId: meta?.eventId ?? 'unassigned',
        }
      })

      // Resolve the cover photo(s) to real uploaded URLs. If the client
      // picked a SPREAD photo, its src is a local blob: preview — swap it
      // for the uploaded original so the printer/admin can fetch it.
      // CoverBuilder's own uploads are already https URLs → kept as-is.
      const previewToOriginal = new Map<string, string>()
      for (const p of photos) {
        const up = result.photos.find((r) => r.photoId === p.id)
        if (up) previewToOriginal.set(p.preview, up.originalUrl)
      }
      const resolveCover = (src: string | null): string | null =>
        src ? previewToOriginal.get(src) ?? src : null
      const coverPayload = coverState
        ? {
            ...coverState,
            photoSrc: resolveCover(coverState.photoSrc),
            backPhotoSrc: resolveCover(coverState.backPhotoSrc),
            priceAdd: coverPrice,
            renderedFrontUrl: result.coverFrontUrl,
            renderedBackUrl: result.coverBackUrl,
          }
        : null

      const res = await fetch('/api/submit-smart-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId,
          albumName: albumName || 'Untitled Smart Album',
          customer: { name: c.name.trim(), email: c.email.trim() },
          shipping: {
            recipientName: c.name.trim(),
            phone: c.phone.trim(),
            line1: c.line1.trim(),
            line2: c.line2.trim() || undefined,
            city: c.city.trim(),
            region: c.region.trim(),
            postalCode: c.postalCode.trim(),
            country: c.country.trim() || 'United States',
            notes: c.notes.trim() || undefined,
          },
          album: {
            size,
            type,
            pageCount,
            totalPrice: orderTotal,
          },
          cover: coverPayload,
          photos: photosPayload,
          spreads,
          spreadComposites: result.spreadComposites,
          customEventNames,
          polishHandoff,
          // ── Legal audit records (Phase 1 + Phase 2) ──
          proofApproval,
          contentRights,
          // Summary of low-res photos so the owner can flag them on the
          // print order (clause 2.2 — customer bears responsibility for
          // resolution, but the printer wants to know in advance).
          lowResPhotos: photosToUpload
            .filter((p) => Math.min(p.width, p.height) < LOW_RES_PX)
            .map((p) => ({ id: p.id, width: p.width, height: p.height })),
        }),
      })
      if (!res.ok) {
        let detail = ''
        try {
          const j = (await res.json()) as { error?: string }
          detail = j.error ?? ''
        } catch {
          /* ignore */
        }
        throw new Error(`Server rejected the order${detail ? ': ' + detail : ''}`)
      }
      const json = (await res.json()) as { orderId: string; token: string }
      setSubmittedOrderId(json.orderId)

      // ── Payment hand-off (Square) ──
      // submit-smart-order has persisted the order at pending_payment and
      // sent us the owner heads-up. Now we ask /api/square-checkout to
      // build a Payment Link and redirect the customer to Square's hosted
      // checkout. The confirmation emails (customer + owner PAID) fire
      // from the webhook on payment success.
      setSubmitting({
        stage: 'persisting',
        done: photosToUpload.length + spreads.length,
        total: photosToUpload.length + spreads.length,
        label: 'Opening secure checkout…',
      })
      const checkoutRes = await fetch('/api/square-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: json.token }),
      })
      if (!checkoutRes.ok) {
        let detail = ''
        try {
          const j = (await checkoutRes.json()) as { error?: string }
          detail = j.error ?? ''
        } catch {
          /* ignore */
        }
        throw new Error(`Couldn't start payment${detail ? ': ' + detail : ''}`)
      }
      const checkoutJson = (await checkoutRes.json()) as { url: string }
      // Hard navigation — Stripe's hosted checkout takes over from here.
      // The customer comes back to /design/smart/success on success or to
      // /design/smart?payment=cancelled if they bail.
      window.location.href = checkoutJson.url
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSubmitting({ stage: 'error', done: 0, total: 0, label: '', error: msg })
    }
  }, [
    size,
    type,
    albumId,
    albumName,
    pageCount,
    albumPrice,
    photos,
    spreads,
    customerForm,
    customEventNames,
    polishHandoff,
    proofApproval,
    contentRights,
    adjusts,
  ])

  // ---------- DnD: slot↔slot swap, unused→slot swap, unused→spread (+1) ----------
  // Adapter so templatesForCount matches the integration's signature
  // (count, { type, hasHero }).
  const templatesForCountAdapter = useCallback(
    (count: number, opts: { type: AlbumType; hasHero: boolean }) =>
      templatesForCount(count, opts.type).filter((t) =>
        opts.hasHero ? t.slots.some((s) => s.isHero) : !t.slots.some((s) => s.isHero),
      ),
    [],
  )
  const isHeroPhoto = useCallback(
    (id: string) => photos.find((p) => p.id === id)?.tagged === 'hero',
    [photos],
  )
  const handleAddUnusedToSpread = useCallback(
    (spreadId: string, photoId: string) => {
      if (!type) return
      const result = buildAddOp(
        { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
        spreadId,
        photoId,
        { albumType: type, isHeroPhoto, templatesForCount: templatesForCountAdapter, maxPhotosPerSpread: 18 },
      )
      if ('op' in result) {
        undoApi.record(result.op)
      } else if (result.error === 'at-capacity') {
        showToast('Spread is at the 18-photo cap')
      } else {
        showToast(`Couldn't add: ${result.error}`)
      }
    },
    [type, spreads, unusedPhotoIds, isHeroPhoto, templatesForCountAdapter, undoApi, showToast],
  )
  // Custom count-change that mirrors swapTemplate's "leave-empty" behavior:
  //   - GROW: keep current photos, pad with null slots (user fills via + button or drag)
  //   - SHRINK: keep first N photos, push surplus back to unused
  // The integration's buildPhotoCountOp blocks growing without unused photos,
  // which the owner explicitly does NOT want — they want to grow even with
  // an empty pool and fill manually.
  const handlePhotoCountChange = useCallback(
    (spreadId: string, newCount: number) => {
      if (!type) return
      const spread = spreads.find((s) => s.id === spreadId)
      if (!spread) return
      const filled = spread.photoIds.filter((id): id is string => Boolean(id))
      const currentCount = filled.length
      if (newCount === currentCount) return

      // Pick a template with the new slot count. Prefer same hero/non-hero
      // kind, then pick the best ORIENTATION match among those for the
      // spread's actual photos (Part B).
      const currentTpl = TEMPLATE_BY_ID.get(spread.templateId)
      const wantsHero = currentTpl?.slots.some((s) => s.isHero) && newCount >= 2
      const aspect = size ? ALBUM_SPECS[size].spreadAspectRatio : 24 / 17
      const spreadPhotos = filled
        .map((id) => photos.find((p) => p.id === id))
        .filter((p): p is Photo => Boolean(p))
      const candidates = TEMPLATES.filter(
        (t) => t.compat.includes(type) && t.slots.length === newCount,
      )
      const sameKind = candidates.filter(
        (t) => t.slots.some((s) => s.isHero) === wantsHero,
      )
      const pool = sameKind.length > 0 ? sameKind : candidates
      let newTpl = pool[0]
      if (spreadPhotos.length > 0) {
        let bestScore = -1
        for (const c of pool) {
          const sc = scoreTemplateForPhotos(c, spreadPhotos, aspect)
          if (sc > bestScore) {
            bestScore = sc
            newTpl = c
          }
        }
      }
      if (!newTpl) {
        showToast(`No layout available for ${newCount} photos`)
        return
      }

      let newIds: (string | null)[]
      let nextUnused = [...unusedPhotoIds]
      if (newCount > currentCount) {
        // Grow: keep filled + pad with nulls (empty slots show "+ Add")
        newIds = [...filled]
        while (newIds.length < newCount) newIds.push(null)
      } else {
        // Shrink: keep first N, push surplus back to unused pool
        newIds = filled.slice(0, newCount)
        const surplus = filled.slice(newCount)
        nextUnused = [...nextUnused, ...surplus]
      }

      const op = makeLayoutVariantOp(
        { spreads: spreads as unknown as OpSpread[] },
        spreadId,
        newTpl.id,
        newIds,
      )
      undoApi.record(op)
      if (nextUnused.length !== unusedPhotoIds.length) {
        setUnusedPhotoIds(nextUnused)
      }
    },
    [type, size, photos, spreads, unusedPhotoIds, undoApi, showToast],
  )
  // useSlotDrag gives us slot draggability + drop targets + spread-bg
  // drop handler. record + state are passed in; the hooks call our op
  // constructors directly for the simple swap cases. The +1 layout case
  // routes through onAddRequested → handleAddUnusedToSpread.
  const slotDrag = useSlotDrag({
    state: { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
    record: undoApi.record,
    onAddRequested: handleAddUnusedToSpread,
  })

  // ---------- Drag-to-reorder spreads ----------
  // Lightweight HTML5 drag. The dragged spread's index is stashed in
  // dataTransfer; the drop target computes the new index.
  const [draggingSpreadIdx, setDraggingSpreadIdx] = useState<number | null>(null)
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)

  const onSpreadDragStart = (idx: number) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-folio-spread', String(idx))
    e.dataTransfer.effectAllowed = 'move'
    setDraggingSpreadIdx(idx)
  }
  const onSpreadDragOver = (idx: number) => (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-folio-spread')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetIdx(idx)
    }
  }
  const onSpreadDrop = (idx: number) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-folio-spread')) return
    e.preventDefault()
    const fromIdx = parseInt(e.dataTransfer.getData('application/x-folio-spread'), 10)
    if (Number.isNaN(fromIdx) || fromIdx === idx) {
      setDraggingSpreadIdx(null)
      setDropTargetIdx(null)
      return
    }
    // Insert-before semantics: dragging FROM index X TO index Y means
    // "remove from X, insert at Y". If X < Y, that's "after Y-1"; we
    // pass `idx` as-is and the op handles it correctly (splice + insert).
    const targetIdx = fromIdx < idx ? idx - 1 : idx
    const op = makeReorderSpreadOp(
      { spreads: spreads as unknown as OpSpread[] },
      fromIdx,
      targetIdx,
    )
    undoApi.record(op)
    setDraggingSpreadIdx(null)
    setDropTargetIdx(null)
  }
  const onSpreadDragEnd = () => {
    setDraggingSpreadIdx(null)
    setDropTargetIdx(null)
  }

  // ---------- Add more photos (from the unused-panel sidebar) ----------
  // Adds new uploads straight into the unused pool with default tags.
  // User is past the group/tag steps so we don't ask for an event —
  // photos go to 'other1' and the user can drag/swap them in. Honors
  // the global PHOTO_CAP.
  const addMorePhotosInputRef = useRef<HTMLInputElement>(null)
  const onAddMorePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    if (!ensureContentRights()) {
      e.target.value = ''
      return
    }
    const remaining = PHOTO_CAP - photos.length
    if (remaining <= 0) {
      alert(`You're at the ${PHOTO_CAP}-photo limit.`)
      return
    }
    const toProcess = Array.from(files).slice(0, remaining)
    if (files.length > remaining) {
      alert(`Only ${remaining} more photos can fit. Adding the first ${remaining}.`)
    }
    const newPhotos: Photo[] = []
    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i]
      const dim = await getImageDimensions(file)
      const photoId = `${Date.now()}-add-${i}-${Math.random().toString(36).slice(2, 8)}`
      newPhotos.push({
        id: photoId,
        preview: URL.createObjectURL(file),
        width: dim.width,
        height: dim.height,
        tagged: 'none',
        eventId: 'unassigned',
        blurry: false,
      })
      if (albumId) saveBlob(albumId, photoId, file)
    }
    setPhotos((prev) => [...prev, ...newPhotos])
    setUnusedPhotoIds((prev) => [...prev, ...newPhotos.map((p) => p.id)])
    showToast(`Added ${newPhotos.length} photo${newPhotos.length === 1 ? '' : 's'} to unused pool`)
    // Reset input so selecting the same files again would re-trigger
    if (addMorePhotosInputRef.current) addMorePhotosInputRef.current.value = ''
  }

  const reset = () => {
    // Clear stored photo blobs for this album so storage doesn't leak.
    // Fire-and-forget — don't block the reset.
    if (albumId) clearAlbumBlobs(albumId)
    setStep('setup')
    setSize(null)
    setType(null)
    setPhotos([])
    setSpreads([])
    setUnusedPhotoIds([])
    undoApi.clearStack()
    setPageCount(15)
    setEventFilter('all')
    setAdjusts({})
  }

  /**
   * Remove a single photo on the upload stage (before grouping /
   * layout). Frees its object URL, drops it from the IndexedDB blob
   * cache, and strips it out of any state that referenced it so it
   * can't resurface later in grouping or the unused pool.
   */
  const removePhoto = (photoId: string) => {
    const target = photos.find((p) => p.id === photoId)
    if (target?.preview?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(target.preview)
      } catch {
        /* ignore */
      }
    }
    if (albumId) deleteBlob(albumId, photoId)
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    setUnusedPhotoIds((prev) => prev.filter((id) => id !== photoId))
    setSelectedPhotoIds((prev) => {
      if (!prev.has(photoId)) return prev
      const next = new Set(prev)
      next.delete(photoId)
      return next
    })
  }

  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>()
    photos.forEach((p) => m.set(p.id, p))
    return m
  }, [photos])

  // usedPhotoIds and unusedPhotos are now derived from explicit
  // unusedPhotoIds state (maintained via ops) rather than computed
  // from spreads. This is what lets undo/redo move photos in and out
  // of the unused pool cleanly.
  const usedPhotoIds = useMemo(() => new Set(spreads.flatMap((s) => s.photoIds.filter(Boolean))), [spreads])
  const unusedPhotos = useMemo(
    () => {
      const result: Photo[] = []
      for (const id of unusedPhotoIds) {
        const p = photos.find((x) => x.id === id)
        if (p && !p.blurry) result.push(p)
      }
      return result
    },
    [unusedPhotoIds, photos],
  )

  // Hydrate-time backfill: if we restored saved state but unusedPhotoIds
  // is empty (because the persistence format was older or got out of
  // sync), recompute it from photos minus used. Only runs once after
  // hydration.
  useEffect(() => {
    if (!hydrated) return
    if (spreads.length === 0) return
    if (unusedPhotoIds.length > 0) return
    const used = new Set(spreads.flatMap((s) => s.photoIds.filter(Boolean) as string[]))
    const computed = photos.filter((p) => !p.blurry && !used.has(p.id)).map((p) => p.id)
    if (computed.length > 0) setUnusedPhotoIds(computed)
    // Only run once per hydration — empty stays empty after intentional clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // ============== RENDERS ==============

  const renderStepIndicator = () => {
    const stepOrder: Step[] = ['setup', 'guidance', 'upload', 'group', 'tag', 'pages', 'adjust', 'cover', 'proof', 'submit']
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
          {(['17x24', '12x24', '20x30', '15x30'] as AlbumSize[]).map((s) => {
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
                  {spec.desc}
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
            Each spread fits up to <strong style={{ color: GOLD }}>5 photos</strong>.
          </p>
          <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.9 }}>
            Rule of thumb: <strong style={{ color: GOLD }}>photos ÷ 4 ≈ spreads</strong> for a breathable layout.
            <br />
            100 photos → ~25 spreads. 50 photos → ~13 spreads.
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
          <strong style={{ color: 'var(--cream)' }}>Heroes</strong> = main photos. They take a full page (half a spread) — paired with 4 smaller photos on the other side.
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

        {uploadProgress > 0 && uploadProgress < 1 && (
          <div style={{ ...css.notice, marginBottom: 16, borderColor: GOLD }}>
            Uploading… {Math.round(uploadProgress * 100)}%
          </div>
        )}

        <div
          onClick={() => {
            if (photos.length >= PHOTO_CAP) return
            setShowSourcePicker(true)
          }}
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
            {photos.length >= PHOTO_CAP ? 'Photo limit reached' : 'Add photos'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, marginTop: 8 }}>
            Device · Dropbox · Google · up to {PHOTO_CAP - photos.length} more
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
        {/* Folder picker — webkitdirectory exposes webkitRelativePath on
            each file so we can auto-tag photos by their sub-folder name. */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          onChange={handleFolderSelect}
          style={{ display: 'none' }}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />

        {showSourcePicker && (
          <div
            onClick={() => setShowSourcePicker(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 420,
                background: '#1a1611',
                border: '1px solid rgba(184,150,90,0.25)',
                borderRadius: 16,
                padding: 28,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 18,
                }}
              >
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    color: 'var(--cream)',
                    margin: 0,
                  }}
                >
                  Add images
                </h2>
                <button
                  type="button"
                  onClick={() => setShowSourcePicker(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted2)',
                    fontSize: 20,
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {(() => {
                const row: React.CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 16px',
                  marginBottom: 10,
                  background: '#0e0c09',
                  border: '1px solid rgba(184,150,90,0.25)',
                  borderRadius: 10,
                  color: 'var(--cream)',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }
                const soon: React.CSSProperties = {
                  ...row,
                  cursor: 'not-allowed',
                  opacity: 0.5,
                }
                const tag: React.CSSProperties = {
                  marginLeft: 'auto',
                  fontSize: 9,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: 'var(--muted2)',
                }
                return (
                  <>
                    <button
                      type="button"
                      style={row}
                      onClick={() => {
                        setShowSourcePicker(false)
                        if (!ensureContentRights()) return
                        fileInputRef.current?.click()
                      }}
                    >
                      <span style={{ fontSize: 18 }}>📱</span> Your device
                    </button>

                    <button
                      type="button"
                      style={row}
                      onClick={() => {
                        setShowSourcePicker(false)
                        if (!ensureContentRights()) return
                        folderInputRef.current?.click()
                      }}
                      title="Pick a folder. Sub-folders named Mehndi / Haldi / Nikkah / Wedding etc. are auto-tagged."
                    >
                      <span style={{ fontSize: 18 }}>📁</span> Folder
                      <span style={tag}>auto-group</span>
                    </button>

                    <button
                      type="button"
                      style={row}
                      onClick={() => {
                        setShowSourcePicker(false)
                        if (!ensureContentRights()) return
                        openDropboxChooser()
                      }}
                    >
                      <span style={{ fontSize: 18, color: '#0061FF' }}>▾</span>{' '}
                      Dropbox
                    </button>

                    <button type="button" style={soon} disabled>
                      <span style={{ fontSize: 18 }}>🟢</span> Google Drive
                      <span style={tag}>Coming soon</span>
                    </button>

                    <button type="button" style={soon} disabled>
                      <span style={{ fontSize: 18 }}>🟡</span> Google Photos
                      <span style={tag}>Coming soon</span>
                    </button>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {photos.length > 0 && (
          <>
            {(() => {
              const lowResCount = photos.filter((p) => Math.min(p.width, p.height) < LOW_RES_PX).length
              if (lowResCount === 0) return null
              return (
                <div
                  style={{
                    marginTop: 24,
                    padding: '10px 14px',
                    background: 'rgba(255,183,77,0.08)',
                    border: '0.5px solid rgba(255,183,77,0.5)',
                    borderRadius: 6,
                    fontSize: 11,
                    color: 'var(--cream)',
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ color: '#ffb74d' }}>{lowResCount} photo{lowResCount === 1 ? '' : 's'} below {LOW_RES_PX}px on the shortest edge.</strong>
                  {' '}These may print soft. You can continue — per clause 2.2 the print quality of low-resolution photos is the customer's responsibility.
                </div>
              )
            })()}
            <div
              style={{
                marginTop: 32,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
              }}
            >
              {photos.map((p) => {
                const lowRes = Math.min(p.width, p.height) < LOW_RES_PX
                return (
                  <div
                    key={p.id}
                    className="folio-photo-tile"
                    style={{
                      position: 'relative',
                      aspectRatio: '1',
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: lowRes
                        ? '0.5px solid rgba(255,170,80,0.7)'
                        : '0.5px solid rgba(184,150,90,0.2)',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {lowRes && (
                      <span
                        title={`This photo's shortest edge is ${Math.min(p.width, p.height)} px (under ${LOW_RES_PX}). It may print soft. See clause 2.2.`}
                        style={{
                          position: 'absolute',
                          top: 4,
                          left: 4,
                          fontSize: 8,
                          letterSpacing: 1,
                          color: '#1a1108',
                          background: '#ffb74d',
                          padding: '2px 6px',
                          borderRadius: 3,
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          pointerEvents: 'none',
                        }}
                      >
                        Low res
                      </span>
                    )}
                    {/* Remove this photo. Visible on hover (desktop) and
                        always tappable on touch. */}
                    <button
                      type="button"
                      className="folio-photo-remove"
                      aria-label="Remove this photo"
                      title="Remove this photo"
                      onClick={() => removePhoto(p.id)}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 24,
                        height: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(14,12,9,0.72)',
                        color: '#fff',
                        fontSize: 14,
                        lineHeight: 1,
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
            {/* Touch devices can't hover, so the remove (✕) button is
                always visible there; on hover-capable devices it
                fades in only when you hover the photo so the grid
                stays clean. */}
            <style>{`
              .folio-photo-remove { opacity: 1; transition: opacity 0.15s ease; }
              @media (hover: hover) {
                .folio-photo-remove { opacity: 0; }
                .folio-photo-tile:hover .folio-photo-remove,
                .folio-photo-remove:focus-visible { opacity: 1; }
              }
            `}</style>

            <div style={{ display: 'flex', gap: 12, marginTop: 32, alignItems: 'center' }}>
              <button type="button" style={css.btnSecondary} onClick={() => setPhotos([])}>
                Clear all
              </button>
              <button type="button" style={css.btnPrimary} onClick={() => setStep('group')}>
                Continue →
              </button>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  letterSpacing: 1,
                  color: 'var(--muted2)',
                  textTransform: 'uppercase',
                }}
              >
                {photos.length} photo{photos.length === 1 ? '' : 's'} · hover a photo to remove it
              </span>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderGroup = () => {
    const RECAT_MIME = 'application/x-folio-recat'
    const unassignedCount = photos.filter((p) => p.eventId === 'unassigned').length
    const tagDisplayName = (id: EventId): string =>
      customEventNames[id] ?? EVENTS.find((e) => e.id === id)?.name ?? id

    const togglePhotoSelection = (photoId: string) => {
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev)
        if (next.has(photoId)) next.delete(photoId)
        else next.add(photoId)
        return next
      })
    }
    const clearSelection = () => setSelectedPhotoIds(new Set())
    const moveSelectedTo = (eventId: EventId) => {
      selectedPhotoIds.forEach((id) => {
        setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, eventId } : p)))
      })
      clearSelection()
    }
    // dataTransfer payload for the drag — JSON array of ids so multi-drag works
    const dragPayload = (sourceId: string): string => {
      const ids = selectedPhotoIds.has(sourceId)
        ? Array.from(selectedPhotoIds)
        : [sourceId]
      return JSON.stringify(ids)
    }
    const parseDropPayload = (data: string): string[] => {
      if (!data) return []
      try {
        const parsed = JSON.parse(data)
        return Array.isArray(parsed) ? parsed : [data]
      } catch {
        return [data]
      }
    }

    return (
      <div style={{ ...css.container, maxWidth: 1280 }}>
        {renderStepIndicator()}
        <h2 style={{ ...css.title, marginBottom: 8 }}>
          Group by <em style={css.titleEm}>event</em>
        </h2>
        <p style={{ ...css.subtitle, marginBottom: 10 }}>
          Drag each photo onto its tag. Tagged photos get a label so you can re-assign them anytime.
        </p>

        {/* Smart group — clusters Untagged photos by EXIF time gaps
            into ceremonies. Shown only when there's something to do. */}
        {(() => {
          const untagged = photos.filter((p) => p.eventId === 'unassigned')
          const eligible = untagged.filter(
            (p) => typeof p.capturedAt === 'number',
          )
          if (eligible.length < 2) return null
          return (
            <div
              style={{
                marginBottom: 18,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'rgba(184,150,90,0.08)',
                border: '0.5px solid rgba(184,150,90,0.35)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--cream)',
              }}
            >
              <span>
                ✨ <strong>{eligible.length}</strong> untagged photos have
                date info — auto-group them into ceremonies by time?
              </span>
              <button
                type="button"
                onClick={runSmartGroup}
                style={{
                  marginLeft: 'auto',
                  background: GOLD,
                  color: '#0e0c09',
                  border: 'none',
                  borderRadius: 30,
                  padding: '5px 12px',
                  fontSize: 10,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Smart group
              </button>
            </div>
          )
        })()}

        {/* TAG CARDS — small cards with thumbnail strips inside. 5 cols on desktop.
            - Empty card: just header + dashed drop zone
            - Populated card: header + horizontal scroll strip of thumbnails
            - Drop on the card = move dragged photo(s) into this tag
            - Click thumbnail = toggle selection (same as bottom grid)
            - Double-click tag name = rename. Click chip = move selected. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 8,
            marginBottom: 14,
          }}
        >
          {EVENTS.map((ev) => {
            const inTag = photos.filter((p) => p.eventId === ev.id)
            const count = inTag.length
            const isDropTarget = recatDragOverEvent === ev.id
            const isEditing = editingTagId === ev.id
            const hasSelection = selectedPhotoIds.size > 0
            return (
              <div
                key={ev.id}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(RECAT_MIME)) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (recatDragOverEvent !== ev.id) setRecatDragOverEvent(ev.id)
                  }
                }}
                onDragLeave={() => setRecatDragOverEvent(null)}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(RECAT_MIME)) return
                  e.preventDefault()
                  const ids = parseDropPayload(e.dataTransfer.getData(RECAT_MIME))
                  ids.forEach((id) => recategorize(id, ev.id))
                  if (ids.length > 1) clearSelection()
                  setRecatDragOverEvent(null)
                }}
                onClick={(e) => {
                  if (isEditing) return
                  // If anything is selected, clicking the card = move selection to this tag.
                  // Inner thumbnail clicks stop propagation so they don't trigger this.
                  if (hasSelection) {
                    e.stopPropagation()
                    moveSelectedTo(ev.id)
                  }
                }}
                style={{
                  background: isDropTarget ? 'rgba(184,150,90,0.12)' : 'var(--dark2)',
                  border: `1px solid ${isDropTarget ? GOLD : hasSelection ? 'rgba(184,150,90,0.5)' : 'rgba(184,150,90,0.2)'}`,
                  borderRadius: 8,
                  padding: 8,
                  height: 90,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  transition: 'border-color 0.15s, background 0.15s',
                  cursor: hasSelection ? 'pointer' : 'default',
                }}
                title={hasSelection ? `Click to move ${selectedPhotoIds.size} selected to ${tagDisplayName(ev.id)}` : 'Double-click name to rename'}
              >
                {/* Header: name + count */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      defaultValue={tagDisplayName(ev.id)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim()
                        setCustomEventNames((prev) => {
                          const next = { ...prev }
                          if (v && v !== ev.name) next[ev.id] = v
                          else delete next[ev.id]
                          return next
                        })
                        setEditingTagId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                        if (e.key === 'Escape') {
                          ;(e.currentTarget as HTMLInputElement).value = tagDisplayName(ev.id)
                          setEditingTagId(null)
                        }
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: `0.5px dashed ${GOLD}`,
                        color: 'var(--cream)',
                        fontFamily: 'var(--font-display)',
                        fontSize: 13,
                        outline: 'none',
                        flex: 1,
                        minWidth: 0,
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setEditingTagId(ev.id)
                      }}
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 13,
                        color: 'var(--cream)',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {tagDisplayName(ev.id)}
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 10,
                      letterSpacing: 0.5,
                      background: count > 0 ? GOLD : 'rgba(184,150,90,0.15)',
                      color: count > 0 ? '#0e0c09' : 'var(--muted2)',
                      padding: '2px 8px',
                      borderRadius: 30,
                      minWidth: 22,
                      textAlign: 'center',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {count}
                  </span>
                </div>

                {/* Body: thumbnails OR empty drop zone */}
                {count === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      border: `0.5px dashed ${isDropTarget ? GOLD : 'rgba(184,150,90,0.25)'}`,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 8,
                      letterSpacing: 1.2,
                      color: isDropTarget ? GOLD : 'var(--muted2)',
                      textTransform: 'uppercase',
                    }}
                  >
                    Drop
                  </div>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      gap: 4,
                      overflowX: 'auto',
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(184,150,90,0.4) transparent',
                    }}
                  >
                    {inTag.map((p) => {
                      const isSelected = selectedPhotoIds.has(p.id)
                      return (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation()
                            e.dataTransfer.setData(RECAT_MIME, dragPayload(p.id))
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePhotoSelection(p.id)
                          }}
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 4,
                            overflow: 'hidden',
                            cursor: 'grab',
                            border: isSelected ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.25)',
                            flexShrink: 0,
                            position: 'relative',
                          }}
                          title="Drag to another tag, or click to select"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.preview}
                            alt=""
                            draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* HAND GUIDANCE — animated finger pointing UP at the chips */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 18px',
            marginBottom: 18,
            background: 'rgba(184,150,90,0.06)',
            border: `0.5px solid rgba(184,150,90,0.35)`,
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--cream)',
          }}
        >
          <span
            style={{
              fontSize: 24,
              animation: 'handPointUp 1.6s ease-in-out infinite',
              display: 'inline-block',
            }}
            aria-hidden
          >
            👆
          </span>
          <span>
            <strong style={{ color: GOLD }}>Click photos to select multiple</strong>, then drag any one — or click a chip — to move the whole batch.
            {unassignedCount > 0 && (
              <span style={{ color: 'var(--muted2)' }}> · {unassignedCount} untagged</span>
            )}
            {selectedPhotoIds.size > 0 && (
              <span style={{ color: GOLD, marginLeft: 8 }}> · {selectedPhotoIds.size} selected</span>
            )}
          </span>
          <style>{`
            @keyframes handPointUp {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-8px); }
            }
          `}</style>
        </div>

        {/* BIG UNASSIGNED PHOTO GRID — only photos that haven't been tagged yet.
            Once tagged, the photo moves up into its tag card and disappears here. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          {photos.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 60,
                color: 'var(--muted2)',
                fontSize: 12,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              No photos to tag
            </div>
          )}
          {photos.length > 0 && unassignedCount === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 50,
                color: GOLD,
                fontSize: 13,
                letterSpacing: 1,
              }}
            >
              ✓ All photos tagged · Continue to the next step
            </div>
          )}
          {photos
            .filter((p) => p.eventId === 'unassigned')
            .map((p) => {
              const isSelected = selectedPhotoIds.has(p.id)
              return (
                <div key={p.id} style={{ position: 'relative' }}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(RECAT_MIME, dragPayload(p.id))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePhotoSelection(p.id)
                    }}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: 'grab',
                      border: isSelected
                        ? `2px solid ${GOLD}`
                        : '0.5px solid rgba(184,150,90,0.18)',
                      boxShadow: isSelected ? `0 0 0 2px rgba(184,150,90,0.3)` : 'none',
                      transition: 'box-shadow 0.2s',
                    }}
                    title={
                      isSelected
                        ? `${selectedPhotoIds.size} selected — drag any one to a tag, or click a tag card`
                        : 'Click to select, drag onto a tag above'
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.preview}
                      alt=""
                      draggable={false}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                  </div>
                  {/* Selection ✓ badge */}
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: GOLD,
                        color: '#0e0c09',
                        fontSize: 13,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                      aria-hidden
                    >
                      ✓
                    </span>
                  )}
                </div>
              )
            })}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
          <button type="button" style={css.btnSecondary} onClick={() => setStep('upload')}>
            ← Back
          </button>
          {selectedPhotoIds.size > 0 && (
            <button type="button" style={css.btnGhost} onClick={clearSelection}>
              Clear selection ({selectedPhotoIds.size})
            </button>
          )}
          <button type="button" style={css.btnPrimary} onClick={() => setStep('tag')}>
            {unassignedCount > 0 ? `Continue (${unassignedCount} untagged) →` : 'Continue →'}
          </button>
        </div>
      </div>
    )
  }

  const renderTag = () => {
    const visible = photos.filter((p) => eventFilter === 'all' || p.eventId === eventFilter)
    return (
      <div style={css.container}>
        {renderStepIndicator()}
        <h2 style={css.title}>
          Tag your <em style={css.titleEm}>best shots</em>
        </h2>
        <p style={css.subtitle}>
          Heroes get a full page (paired with 4 photos on the other side). Favorites get prominent placement. Everything else still gets placed.
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
          <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 6 }}>
            Album style
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted2)', marginBottom: 16, lineHeight: 1.5 }}>
            Not sure which look you want? Pick a mood — we&apos;ll design every
            spread for you. You can still restyle any single spread later.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(
              [
                {
                  key: 'mix' as AlbumStyle,
                  title: 'Smart mix',
                  tag: 'Recommended',
                  desc: 'Opens bold edge-to-edge, then alternates dramatic full-bleed pages with calm matted ones — and varies the layout every spread so no two pages look the same.',
                },
                {
                  key: 'clean' as AlbumStyle,
                  title: 'Clean & elegant',
                  tag: '',
                  desc: 'Every photo matted with white space around it. Soft, timeless, gallery feel.',
                },
                {
                  key: 'bold' as AlbumStyle,
                  title: 'Bold & immersive',
                  tag: '',
                  desc: 'Edge-to-edge, full-bleed photos. Dramatic and modern.',
                },
              ] as const
            ).map((opt) => {
              const active = albumStyle === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setAlbumStyle(opt.key)}
                  style={{
                    textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: active ? 'rgba(184,150,90,0.12)' : 'transparent',
                    border: `1px solid ${active ? GOLD : 'rgba(184,150,90,0.25)'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: `2px solid ${active ? GOLD : 'rgba(184,150,90,0.4)'}`,
                        background: active ? GOLD : 'transparent',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 14, color: 'var(--cream)', fontWeight: 600 }}>
                      {opt.title}
                    </span>
                    {opt.tag && (
                      <span
                        style={{
                          fontSize: 9,
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                          color: '#0e0c09',
                          background: GOLD,
                          padding: '2px 7px',
                          borderRadius: 30,
                          fontWeight: 700,
                        }}
                      >
                        {opt.tag}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.5, margin: 0, paddingLeft: 22 }}>
                    {opt.desc}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UndoButtons
              canUndo={undoApi.canUndo}
              canRedo={undoApi.canRedo}
              nextUndoLabel={undoApi.nextUndoLabel}
              nextRedoLabel={undoApi.nextRedoLabel}
              onUndo={undoApi.undo}
              onRedo={undoApi.redo}
            />
            <button type="button" style={css.btnGhost} onClick={regenerate}>
              ↻ Regenerate
            </button>
          </div>
        </div>
        <p style={css.subtitle}>
          {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard (with gutter)' : 'Layflat (flush)'} · click a photo for tools ·
          drag photos between slots to swap · drag from Unused onto a spread to add a photo · use the count pill to grow / shrink ·
          Cmd+Z to undo.
        </p>

        {swapSlot && (
          <div style={{ ...css.notice, marginBottom: 20, borderColor: GOLD }}>
            <strong style={{ color: GOLD }}>Pick a replacement</strong> — click an unused photo on the right, or{' '}
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

        {/* Three-column adjust layout:
              [ sticky thumbnail rail | spreads list | unused photos ]
            The rail sits to the LEFT (not floating, not at top), uses
            sticky positioning so it scrolls with the user, and each
            mini-card enlarges 2× on hover so the client can clearly
            see what they edited without leaving their place. */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <SpreadNavRail
            spreads={spreads}
            previewFor={(id) => photos.find((p) => p.id === id)?.preview}
            aspect={ALBUM_SPECS[size].spreadAspectRatio}
            onDragStart={onSpreadDragStart}
            onDragOver={onSpreadDragOver}
            onDrop={onSpreadDrop}
            onDragEnd={onSpreadDragEnd}
            draggingIdx={draggingSpreadIdx}
            dropTargetIdx={dropTargetIdx}
          />
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 24 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            {spreads.map((s, i) => (
              <SpreadView
                key={s.id}
                spread={s}
                index={i}
                isDragging={draggingSpreadIdx === i}
                isDropTarget={dropTargetIdx === i && draggingSpreadIdx !== null && draggingSpreadIdx !== i}
                onDragStart={onSpreadDragStart(i)}
                onDragOver={onSpreadDragOver(i)}
                onDrop={onSpreadDrop(i)}
                onDragEnd={onSpreadDragEnd}
                slotDragHandlers={slotDrag.slotHandlers}
                spreadDropHandlers={slotDrag.spreadDropHandlers}
                onPhotoCountChange={(n) => handlePhotoCountChange(s.id, n)}
                onDeleteSpread={() => {
                  // Confirm before a destructive whole-spread action.
                  // Photos on the spread return to the unused pool; undo
                  // restores both the spread and the photos.
                  const filled = s.photoIds.filter(Boolean).length
                  const summary =
                    filled > 0
                      ? `Delete this spread? Its ${filled} photo${filled === 1 ? '' : 's'} will move to the unused pool.`
                      : 'Delete this empty spread?'
                  if (!window.confirm(summary)) return
                  if (spreads.length <= 1) {
                    showToast("Can't delete the last spread")
                    return
                  }
                  undoApi.record(
                    makeDeleteSpreadOp(
                      { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
                      s.id,
                    ),
                  )
                  // Clear any per-slot UI focused on the deleted spread.
                  if (editSlot?.spreadId === s.id) setEditSlot(null)
                  if (swapSlot?.spreadId === s.id) setSwapSlot(null)
                  if (emptySlotPicker?.spreadId === s.id) setEmptySlotPicker(null)
                }}
                onEmptySlotClick={(slotIdx) => setEmptySlotPicker({ spreadId: s.id, slotIdx })}
                photoMap={photoMap}
                albumSize={size}
                albumType={type}
                adjusts={adjusts}
                bg={spreadBgs[s.id] ?? DEFAULT_SPREAD_BG}
                onBgChange={(next) =>
                  setSpreadBgs((prev) => ({ ...prev, [s.id]: next }))
                }
                texts={spreadTexts[s.id] ?? EMPTY_TEXTS}
                onTextsChange={(next) =>
                  setSpreadTexts((prev) => ({ ...prev, [s.id]: next }))
                }
                savedColors={savedColors}
                onSaveColor={saveColor}
                photoListForBg={photos}
                onPhotoClick={(idx) => {
                  // Tap-to-place: a picked-up unused photo drops into the
                  // tapped slot. Works on touch where drag-drop can't.
                  if (pickedUnusedId) {
                    const targetHasPhoto = Boolean(s.photoIds[idx])
                    if (targetHasPhoto) {
                      // Filled slot → swap (old photo returns to unused),
                      // recorded on the undo stack.
                      const opState = {
                        spreads: spreads as unknown as OpSpread[],
                        unusedPhotoIds,
                      }
                      undoApi.record(
                        makeSwapWithUnusedOp(opState, s.id, idx, pickedUnusedId),
                      )
                    } else {
                      // Empty slot → makeSwapWithUnusedOp has nothing to
                      // swap out and no-ops. Use the proven fill path.
                      fillEmptySlot(s.id, idx, pickedUnusedId)
                    }
                    setPickedUnusedId(null)
                    setEditSlot({ spreadId: s.id, idx })
                    return
                  }
                  // Swap mode: clicking ANOTHER slot performs the swap.
                  // Clicking the SAME slot (the armed one) cancels the swap.
                  if (swapSlot) {
                    if (swapSlot.spreadId === s.id && swapSlot.idx === idx) {
                      // Same slot tapped twice — cancel
                      setSwapSlot(null)
                    } else {
                      // Different slot — perform cross-slot swap via op
                      const opState = {
                        spreads: spreads as unknown as OpSpread[],
                        unusedPhotoIds,
                      }
                      if (swapSlot.spreadId === s.id) {
                        undoApi.record(makeSwapOp(opState, s.id, swapSlot.idx, idx))
                      } else {
                        undoApi.record(
                          makeCrossSwapOp(opState, swapSlot.spreadId, swapSlot.idx, s.id, idx),
                        )
                      }
                      setSwapSlot(null)
                      setEditSlot({ spreadId: s.id, idx })
                    }
                    return
                  }
                  // Normal click — open the toolbar (or close if same slot already open)
                  setEditSlot(
                    editSlot && editSlot.spreadId === s.id && editSlot.idx === idx
                      ? null
                      : { spreadId: s.id, idx },
                  )
                }}
                editingSlot={editSlot && editSlot.spreadId === s.id ? editSlot.idx : -1}
                swappingSlot={swapSlot && swapSlot.spreadId === s.id ? swapSlot.idx : -1}
                onStartSwap={(idx) => {
                  // Toggle swap mode but KEEP the toolbar visible so the
                  // user keeps access to zoom/flip/etc.
                  if (swapSlot && swapSlot.spreadId === s.id && swapSlot.idx === idx) {
                    setSwapSlot(null)
                  } else {
                    setSwapSlot({ spreadId: s.id, idx })
                    setEditSlot({ spreadId: s.id, idx })
                  }
                }}
                onResetAdjust={(idx) => {
                  setAdjusts((prev) => {
                    const next = { ...prev }
                    delete next[adjustKey(s.id, idx)]
                    return next
                  })
                }}
                onRemovePhoto={(idx) => {
                  // Photo returns to the unused pool, BUT the layout
                  // keeps its shape — the emptied slot becomes a
                  // "+ Add photo" placeholder instead of the template
                  // shrinking to a smaller layout. Lets clients swap
                  // one photo for another without losing their spread.
                  const filledOthers = s.photoIds.filter(
                    (id, k) => k !== idx && !!id,
                  ).length
                  if (filledOthers === 0) {
                    showToast('Spread must have at least 1 photo')
                    return
                  }
                  const newIds: (string | null)[] = [...s.photoIds]
                  newIds[idx] = null
                  undoApi.record(
                    makeRemoveOp(
                      { spreads: spreads as unknown as OpSpread[], unusedPhotoIds },
                      s.id,
                      idx,
                      s.templateId, // unchanged — keep the same layout
                      newIds,
                    ),
                  )
                  setAdjusts((prev) => {
                    const next = { ...prev }
                    delete next[adjustKey(s.id, idx)]
                    return next
                  })
                  setEditSlot(null)
                  setSwapSlot(null)
                }}
                onAdjustChange={(idx, patch) => updateAdjust(adjustKey(s.id, idx), patch)}
                onPickTemplate={(tplId) => swapTemplate(s.id, tplId)}
                placementArmed={!!pickedUnusedId}
              />
            ))}
          </div>

          <aside style={{ position: 'sticky', top: 20, alignSelf: 'start' }}>
            <div style={{ ...css.card, marginBottom: 16 }}>
              <p style={{ fontSize: 10, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 8 }}>
                Used in album
              </p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--cream)' }}>
                {usedPhotoIds.size}{' '}
                <span style={{ fontSize: 14, color: 'var(--muted2)' }}>/ {usefulPhotoCount}</span>
              </p>
            </div>

            <div style={css.card}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 10,
                  gap: 8,
                }}
              >
                <p
                  style={{
                    fontSize: 10,
                    letterSpacing: 2,
                    color: unusedPhotos.length > 0 ? '#ff8a8a' : 'var(--muted2)',
                    textTransform: 'uppercase',
                  }}
                >
                  Unused ({unusedPhotos.length})
                </p>
                <button
                  type="button"
                  onClick={() => addMorePhotosInputRef.current?.click()}
                  disabled={photos.length >= PHOTO_CAP}
                  title={
                    photos.length >= PHOTO_CAP
                      ? `Photo limit reached (${PHOTO_CAP})`
                      : `Add more photos to the album (${PHOTO_CAP - photos.length} slots left)`
                  }
                  style={{
                    background: 'transparent',
                    border: `0.5px solid ${photos.length >= PHOTO_CAP ? 'rgba(184,150,90,0.2)' : GOLD}`,
                    color: photos.length >= PHOTO_CAP ? 'var(--muted2)' : GOLD,
                    fontSize: 9,
                    letterSpacing: 1.5,
                    padding: '5px 10px',
                    borderRadius: 30,
                    cursor: photos.length >= PHOTO_CAP ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-body)',
                    textTransform: 'uppercase',
                  }}
                >
                  + Add photos
                </button>
              </div>
              <input
                ref={addMorePhotosInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onAddMorePhotos}
                style={{ display: 'none' }}
              />
              {unusedPhotos.length === 0 ? (
                <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7 }}>
                  All your photos are placed. Click <strong style={{ color: GOLD }}>+ Add photos</strong> above to upload more.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7, marginBottom: 12 }}>
                    {swapSlot
                      ? 'Click one to drop into the selected slot.'
                      : pickedUnusedId
                      ? 'Now tap any photo in a spread to place it there. Tap this photo again to cancel.'
                      : 'Tap a photo, then tap a slot to place it. (On a mouse you can also drag it onto a slot, or onto a spread for +1.)'}
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
                        draggable
                        onDragStart={slotDrag.unusedHandlers(p.id).onDragStart}
                        onDragEnd={slotDrag.unusedHandlers(p.id).onDragEnd}
                        onPointerDown={(e) => beginPointerDrag(e, p.id, p.preview)}
                        onClick={() => {
                          // If a pointer-drag just happened, swallow the
                          // click so we don't also toggle pick-up state.
                          if (pointerDragRef.current?.suppressClick) {
                            pointerDragRef.current = null
                            return
                          }
                          // Legacy path: a slot's swap button is armed →
                          // this click fills it (unchanged behaviour).
                          if (swapSlot) {
                            swapPhoto(p.id)
                            return
                          }
                          // Tap-to-place: toggle "picked up" state. Tapping
                          // the same photo again puts it back down.
                          setPickedUnusedId((prev) => (prev === p.id ? null : p.id))
                        }}
                        style={{
                          aspectRatio: '1',
                          borderRadius: 4,
                          overflow: 'hidden',
                          cursor: 'grab',
                          touchAction: 'none',
                          border:
                            pickedUnusedId === p.id
                              ? `2px solid ${GOLD}`
                              : '0.5px solid rgba(184,150,90,0.2)',
                          boxShadow:
                            pickedUnusedId === p.id
                              ? `0 0 0 2px rgba(184,150,90,0.35)`
                              : 'none',
                          opacity: pickedUnusedId && pickedUnusedId !== p.id ? 0.5 : 1,
                          transition: 'opacity 0.15s, border-color 0.15s',
                        }}
                        title={
                          swapSlot
                            ? 'Click to use as replacement, or drag to a slot'
                            : pickedUnusedId === p.id
                            ? 'Picked up — tap a slot to place it, or tap here to cancel'
                            : 'Tap to pick up, then tap a slot. Or drag onto a slot/spread.'
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.preview}
                          alt=""
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
          </div>
        </div>

        {/* Add spread button — appends a fresh empty spread + bumps pageCount.
            Live price preview shows the per-spread surcharge. */}
        {size && type && (() => {
          const spec = ALBUM_SPECS[size][type]
          // Cap reflects the ACTUAL spread count so the button re-opens
          // after the client deletes a spread.
          const atMax = billedSpreads >= spec.maxSpreads
          // ACTUAL delta to add one more — zero when we're still under
          // the minSpreads "included in base" range, so the label
          // doesn't lie about a fee that won't be charged.
          const addDelta =
            computePrice(size, type, billedSpreads + 1) -
            computePrice(size, type, billedSpreads)
          return (
            <div
              style={{
                marginTop: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={handleAddSpread}
                disabled={atMax}
                style={{
                  background: atMax ? 'transparent' : 'rgba(184,150,90,0.08)',
                  border: `0.5px dashed ${atMax ? 'rgba(184,150,90,0.3)' : GOLD}`,
                  color: atMax ? 'var(--muted2)' : GOLD,
                  padding: '14px 32px',
                  borderRadius: 30,
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600,
                  cursor: atMax ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
                title={atMax ? `Max ${spec.maxSpreads} spreads reached` : 'Append an empty spread to the album'}
              >
                {atMax
                  ? `Max spreads reached (${spec.maxSpreads})`
                  : addDelta > 0
                  ? `+ Add new spread · +$${addDelta}`
                  : '+ Add new spread · no extra cost'}
              </button>
              {!atMax && (
                <span style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: 1 }}>
                  Currently {billedSpreads} of {spec.maxSpreads} spreads · ${albumPrice} total
                  {billedSpreads <= spec.minSpreads &&
                    ` · first ${spec.minSpreads} included in base`}
                </span>
              )}
            </div>
          )
        })()}

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
          <button
            type="button"
            onClick={() => setPolishHandoff((v) => !v)}
            style={{
              ...css.btnSecondary,
              padding: '11px 24px',
              background: polishHandoff ? GOLD : 'transparent',
              color: polishHandoff ? '#0e0c09' : GOLD,
              borderColor: GOLD,
            }}
            title={polishHandoff ? 'Click to remove the polish add-on' : 'Click to add the $99 polish service to your order'}
          >
            {polishHandoff ? '✓ $99 · Hand-off added' : '+ $99 · Hand off to design team'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={css.btnSecondary} onClick={() => setStep('pages')}>
              ← Back
            </button>
            <button
              type="button"
              style={css.btnPrimary}
              onClick={() => {
                // Proof review (clause 2.3) is required before submit. Any
                // edits since last review must be re-acknowledged, so reset
                // it here. Next stop is the required Cover step → then proof.
                setReviewedSpreadIds(new Set())
                setProofApproval(null)
                setStep('cover')
              }}
            >
              Choose your cover → ${orderTotal}
            </button>
          </div>
          {/* Price breakdown — shown whenever the total ≠ albumPrice so
              the client can see WHERE the extra dollars come from
              (a previously-picked cover and/or the polish-handoff
              add-on). Without this they see "$275 album" + "$300
              total" and can't tell why. */}
          {orderTotal !== albumPrice && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--muted2)',
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              ${albumPrice} album
              {coverPrice > 0 && coverState
                ? ` + $${coverPrice} ${coverState.type} cover`
                : ''}
              {polishHandoff ? ' + $99 design polish' : ''}
            </span>
          )}
        </div>

        {/* Customer info + Submit modal */}
        {submitModalOpen && size && type && (
          <div
            onClick={() => {
              if (submitting.stage !== 'uploading' && submitting.stage !== 'persisting') {
                setSubmitModalOpen(false)
              }
            }}
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              zIndex: 10000,
              padding: 24,
              overflowY: 'auto',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--dark2)',
                border: `0.5px solid ${GOLD}`,
                borderRadius: 12,
                padding: 32,
                maxWidth: 540,
                width: '100%',
                marginTop: 40,
                marginBottom: 40,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)', margin: 0 }}>
                  Shipping &amp; <em style={{ color: GOLD, fontStyle: 'italic' }}>contact</em>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (submitting.stage === 'uploading' || submitting.stage === 'persisting') return
                    setSubmitModalOpen(false)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cream)',
                    fontSize: 24,
                    cursor: 'pointer',
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Order summary */}
              <div
                style={{
                  background: 'rgba(184,150,90,0.06)',
                  border: '0.5px solid rgba(184,150,90,0.2)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  marginBottom: 20,
                  fontSize: 11,
                  color: 'var(--cream)',
                  lineHeight: 1.8,
                }}
              >
                {ALBUM_SPECS[size].label} · {type === 'standard' ? 'Standard' : 'Layflat'} · {pageCount} spreads · {photos.length} photos
                <br />
                <strong style={{ color: GOLD, fontSize: 14 }}>
                  Total: ${orderTotal}
                  {polishHandoff && (
                    <span style={{ fontSize: 10, color: 'var(--muted2)', fontWeight: 400 }}> (incl. $99 polish hand-off)</span>
                  )}
                </strong>
              </div>

              {/* Form fields */}
              {(() => {
                const inputStyle: React.CSSProperties = {
                  width: '100%',
                  background: 'var(--dark3)',
                  border: '0.5px solid rgba(184,150,90,0.25)',
                  borderRadius: 4,
                  padding: '10px 12px',
                  color: 'var(--cream)',
                  fontSize: 12,
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                }
                const labelStyle: React.CSSProperties = {
                  display: 'block',
                  fontSize: 9,
                  letterSpacing: 2,
                  color: GOLD,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                  marginTop: 10,
                }
                const setField = (field: keyof typeof customerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setCustomerForm((prev) => ({ ...prev, [field]: e.target.value }))
                const busy = submitting.stage === 'uploading' || submitting.stage === 'persisting'
                return (
                  <>
                    <label style={labelStyle}>Full name *</label>
                    <input
                      style={inputStyle}
                      value={customerForm.name}
                      onChange={setField('name')}
                      disabled={busy}
                      placeholder="Sarah Khan"
                    />
                    <label style={labelStyle}>Email *</label>
                    <input
                      style={inputStyle}
                      value={customerForm.email}
                      onChange={setField('email')}
                      disabled={busy}
                      type="email"
                      placeholder="you@email.com"
                    />
                    <label style={labelStyle}>Phone</label>
                    <input
                      style={inputStyle}
                      value={customerForm.phone}
                      onChange={setField('phone')}
                      disabled={busy}
                      placeholder="+1 555 000 0000"
                    />
                    <label style={labelStyle}>Address line 1 *</label>
                    <input
                      style={inputStyle}
                      value={customerForm.line1}
                      onChange={setField('line1')}
                      disabled={busy}
                      placeholder="123 Main St"
                    />
                    <label style={labelStyle}>Address line 2</label>
                    <input
                      style={inputStyle}
                      value={customerForm.line2}
                      onChange={setField('line2')}
                      disabled={busy}
                      placeholder="Apt / Suite (optional)"
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 10 }}>
                      <div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>City *</label>
                        <input style={inputStyle} value={customerForm.city} onChange={setField('city')} disabled={busy} />
                      </div>
                      <div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>State</label>
                        <input style={inputStyle} value={customerForm.region} onChange={setField('region')} disabled={busy} />
                      </div>
                      <div>
                        <label style={{ ...labelStyle, marginTop: 0 }}>Postal *</label>
                        <input style={inputStyle} value={customerForm.postalCode} onChange={setField('postalCode')} disabled={busy} />
                      </div>
                    </div>
                    <label style={labelStyle}>Country</label>
                    <input style={inputStyle} value={customerForm.country} onChange={setField('country')} disabled={busy} />
                    <label style={labelStyle}>Delivery notes (optional)</label>
                    <textarea
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 60, fontFamily: 'var(--font-body)' }}
                      value={customerForm.notes}
                      onChange={setField('notes')}
                      disabled={busy}
                      placeholder="e.g. Leave at door / Apartment buzzer code"
                    />
                  </>
                )
              })()}

              {/* Progress / error / submit */}
              {submitting.stage === 'uploading' && (
                <div style={{ marginTop: 20 }}>
                  <div
                    style={{
                      width: '100%',
                      height: 8,
                      background: 'var(--dark3)',
                      borderRadius: 4,
                      overflow: 'hidden',
                      border: '0.5px solid rgba(184,150,90,0.2)',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((submitting.done / Math.max(1, submitting.total)) * 100)}%`,
                        height: '100%',
                        background: GOLD,
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 10, letterSpacing: 1, color: 'var(--muted2)', marginTop: 6, textAlign: 'center' }}>
                    {submitting.label}
                  </p>
                </div>
              )}
              {submitting.stage === 'persisting' && (
                <p style={{ fontSize: 11, color: GOLD, textAlign: 'center', marginTop: 16 }}>
                  Photos uploaded · saving your order…
                </p>
              )}
              {submitting.stage === 'error' && submitting.error && (
                <div
                  style={{
                    marginTop: 16,
                    padding: '10px 12px',
                    background: 'rgba(255,138,138,0.1)',
                    border: '0.5px solid rgba(255,138,138,0.4)',
                    borderRadius: 6,
                    fontSize: 11,
                    color: '#ff8a8a',
                  }}
                >
                  {submitting.error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                <button
                  type="button"
                  style={{ ...css.btnSecondary, opacity: submitting.stage === 'uploading' || submitting.stage === 'persisting' ? 0.4 : 1 }}
                  disabled={submitting.stage === 'uploading' || submitting.stage === 'persisting'}
                  onClick={() => setSubmitModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ ...css.btnPrimary, opacity: submitting.stage === 'uploading' || submitting.stage === 'persisting' ? 0.6 : 1 }}
                  disabled={submitting.stage === 'uploading' || submitting.stage === 'persisting'}
                  onClick={runFinalSubmit}
                >
                  {submitting.stage === 'uploading' || submitting.stage === 'persisting'
                    ? 'Submitting…'
                    : `Continue to secure payment · $${orderTotal} →`}
                </button>
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted2)', lineHeight: 1.7, marginTop: 14 }}>
                Photo upload takes ~1 second per photo. You&apos;ll be redirected to Square to enter card details — your order is held under your email and confirmed by email once payment lands. Please don&apos;t close this tab while uploading.
              </p>
            </div>
          </div>
        )}

        {/* Empty-slot picker modal — opens when user clicks "+ Add" on an empty slot */}
        {emptySlotPicker && (
          <div
            onClick={() => setEmptySlotPicker(null)}
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              padding: 24,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--dark2)',
                border: `0.5px solid ${GOLD}`,
                borderRadius: 12,
                padding: 24,
                maxWidth: 720,
                width: '100%',
                maxHeight: '80vh',
                overflow: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cream)', margin: 0 }}>
                  Add a photo
                </h3>
                <button
                  type="button"
                  onClick={() => setEmptySlotPicker(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cream)',
                    fontSize: 24,
                    cursor: 'pointer',
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Upload from computer */}
              <button
                type="button"
                onClick={() => emptySlotFileInputRef.current?.click()}
                style={{
                  ...css.btnSecondary,
                  width: '100%',
                  marginBottom: 16,
                }}
              >
                ↑ Upload from computer
              </button>
              <input
                ref={emptySlotFileInputRef}
                type="file"
                accept="image/*"
                onChange={onEmptySlotUpload}
                style={{ display: 'none' }}
              />

              {/* Pick from unused */}
              <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 10 }}>
                Or pick from unused ({unusedPhotos.length})
              </p>
              {unusedPhotos.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.7, padding: '20px 0', textAlign: 'center' }}>
                  No unused photos right now. Upload a new one above, or shrink another spread to free some up.
                </p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: 6,
                  }}
                >
                  {unusedPhotos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => fillEmptySlot(emptySlotPicker.spreadId, emptySlotPicker.slotIdx, p.id)}
                      style={{
                        aspectRatio: '1',
                        padding: 0,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: '0.5px solid rgba(184,150,90,0.25)',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.preview}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────
  //  PROOF APPROVAL STEP (clause 2.3)
  //
  //  This is the legal checkpoint. The customer scrolls every spread,
  //  ticks "Reviewed" on each, then clicks the final approve button.
  //  Once approved, the order locks (no further edits, no cancellations
  //  except for manufacturing defects per clause 2.9).
  //
  //  Audit record captured here is sent to the server with the
  //  submission and stored in KV at `proof_approval:{orderId}`.
  // ─────────────────────────────────────────────────────────────────────

  // Required Cover step — reuses the manual builder's CoverBuilder so the
  // smart album shares the exact same cover engine (leather / acrylic /
  // photo, 3D preview, fonts, foil). They cannot skip it.
  const renderCover = () => (
    <CoverBuilder
      uploadedPhotos={photos.map((p) => ({ id: p.id, src: p.preview }))}
      onBack={() => setStep('adjust')}
      onContinue={(cover) => {
        setCoverState(cover)
        setStep('proof')
      }}
    />
  )

  const renderProof = () => {
    if (!size || !type) return null
    const aspect = ALBUM_SPECS[size].spreadAspectRatio
    const showGutter = type === 'standard'
    const photoMap = new Map(photos.map((p) => [p.id, p]))
    const allReviewed = spreads.length > 0 && spreads.every((s) => reviewedSpreadIds.has(s.id))

    const toggleReview = (id: string) => {
      setReviewedSpreadIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    const markAll = () => setReviewedSpreadIds(new Set(spreads.map((s) => s.id)))

    const onApprove = () => {
      if (!allReviewed) return
      const approval = {
        acceptedAt: new Date().toISOString(),
        clauseVersion: LEGAL_VERSION,
        clauseText: CLAUSE_PROOF_APPROVAL,
        reviewedSpreadIds: spreads.map((s) => s.id),
      }
      setProofApproval(approval)
      // The shipping modal's JSX lives inside renderAdjust(), so we
      // navigate BACK to the adjust step before opening it. Without this,
      // the modal markup is never mounted (step='proof' doesn't render
      // renderAdjust's JSX) and the click silently fails.
      // TODO: move the shipping modal to the root render so it works
      // independently of which step is active.
      setStep('adjust')
      setSubmitting({ stage: 'idle', done: 0, total: 0, label: '' })
      setSubmitModalOpen(true)
    }

    return (
      <div style={{ ...css.container, maxWidth: 720 }}>
        {renderStepIndicator()}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1 style={css.title}>
            Review your <em style={css.titleEm}>proof</em>
          </h1>
          <p style={css.subtitle}>
            This is your final chance to catch anything before we print. Tick each spread once you've reviewed it.
          </p>
        </div>

        {/* Clause 2.3 banner — visible before, during, and after review */}
        <div
          style={{
            background: 'rgba(184,150,90,0.08)',
            border: `0.5px solid ${GOLD}`,
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 24,
            fontSize: 11,
            lineHeight: 1.75,
            color: 'var(--cream)',
            whiteSpace: 'pre-wrap',
          }}
        >
          <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 10 }}>
            Clause 2.3 — Proof Approval [attorney review pending]
          </strong>
          <div style={{ marginTop: 8 }}>{CLAUSE_PROOF_APPROVAL}</div>
        </div>

        {/* Cover summary + rendered preview(s) — the client confirms the
            cover as part of the proof. Photo covers show front AND back
            so the back can't be missed. */}
        {coverState && (
          <div style={{ ...css.card, marginBottom: 24 }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
                alignItems: 'center',
                marginBottom: proofCoverImgs.front ? 14 : 0,
              }}
            >
              <div style={{ flex: '1 1 200px' }}>
                <p
                  style={{
                    fontSize: 10,
                    letterSpacing: 2,
                    color: GOLD,
                    textTransform: 'uppercase',
                    margin: '0 0 6px',
                  }}
                >
                  Your cover
                </p>
                <p style={{ fontSize: 14, color: 'var(--cream)', margin: '0 0 4px' }}>
                  {coverState.type === 'leather'
                    ? 'Leather'
                    : coverState.type === 'acrylic'
                    ? 'Acrylic'
                    : 'Photo cover'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--muted2)', margin: '0 0 8px' }}>
                  {coverState.primaryText || '(no title)'}
                  {coverState.subtitleText ? ` · ${coverState.subtitleText}` : ''}
                </p>
                {/* Order grand total — cover add-on already folded in.
                    Shown here so the client sees the bottom-line before
                    approving the proof. */}
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--muted2)',
                    margin: 0,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  Order total{' '}
                  <span
                    style={{
                      color: GOLD,
                      fontFamily: 'var(--font-display)',
                      fontSize: 22,
                      marginLeft: 6,
                      letterSpacing: 0,
                      textTransform: 'none',
                    }}
                  >
                    ${orderTotal}
                  </span>
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    ...css.btnPrimary,
                    padding: '10px 16px',
                    fontSize: 11,
                  }}
                  onClick={() => setShowAlbumPreview(true)}
                >
                  📖 Open your album
                </button>
                <button
                  type="button"
                  style={{ ...css.btnGhost, padding: '8px 16px', fontSize: 10 }}
                  onClick={() => setStep('cover')}
                >
                  ← Edit cover
                </button>
              </div>
            </div>
            {(proofCoverImgs.front || proofCoverImgs.back) && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {proofCoverImgs.front && (
                  <figure style={{ margin: 0, textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proofCoverImgs.front}
                      alt="Cover front"
                      style={{
                        maxHeight: 280,
                        border: '1px solid rgba(184,150,90,0.3)',
                        borderRadius: 4,
                      }}
                    />
                    <figcaption
                      style={{
                        fontSize: 9,
                        letterSpacing: 2,
                        color: 'var(--muted2)',
                        textTransform: 'uppercase',
                        marginTop: 6,
                      }}
                    >
                      Front
                    </figcaption>
                  </figure>
                )}
                {proofCoverImgs.back && (
                  <figure style={{ margin: 0, textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={proofCoverImgs.back}
                      alt="Cover back"
                      style={{
                        maxHeight: 280,
                        border: '1px solid rgba(184,150,90,0.3)',
                        borderRadius: 4,
                      }}
                    />
                    <figcaption
                      style={{
                        fontSize: 9,
                        letterSpacing: 2,
                        color: 'var(--muted2)',
                        textTransform: 'uppercase',
                        marginTop: 6,
                      }}
                    >
                      Back
                    </figcaption>
                  </figure>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reviewed counter + mark-all helper */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            fontSize: 11,
            color: 'var(--cream)',
            letterSpacing: 1,
          }}
        >
          <span>
            <strong style={{ color: allReviewed ? GOLD : 'var(--cream)' }}>
              {reviewedSpreadIds.size}
            </strong>{' '}
            of {spreads.length} spreads reviewed
          </span>
          <button
            type="button"
            onClick={markAll}
            style={{
              background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.4)',
              color: 'var(--cream)',
              padding: '6px 12px',
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Mark all reviewed
          </button>
        </div>

        {/* Spread list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {spreads.map((s, idx) => {
            const tpl = TEMPLATE_BY_ID.get(s.templateId)
            if (!tpl) return null
            const reviewed = reviewedSpreadIds.has(s.id)
            const eventName = s.eventId === 'unassigned'
              ? 'Untagged'
              : customEventNames[s.eventId] ?? EVENTS.find((e) => e.id === s.eventId)?.name ?? ''
            return (
              <div
                key={s.id}
                style={{
                  background: 'var(--dark2)',
                  border: `0.5px solid ${reviewed ? GOLD : 'rgba(184,150,90,0.2)'}`,
                  borderRadius: 10,
                  padding: 14,
                  transition: 'border-color 0.2s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--muted2)', textTransform: 'uppercase' }}>
                    Spread {idx + 1} of {spreads.length} · {eventName}
                  </span>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 11,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                      color: reviewed ? GOLD : 'var(--cream)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={() => toggleReview(s.id)}
                      style={{ accentColor: GOLD, width: 16, height: 16, cursor: 'pointer' }}
                    />
                    {reviewed ? 'Reviewed ✓' : 'I reviewed this spread'}
                  </label>
                </div>

                {/* Mini read-only preview of the spread */}
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: `${aspect}`,
                    background: bgFillColor(spreadBgs[s.id]),
                    overflow: 'hidden',
                    borderRadius: 6,
                  }}
                >
                  {(() => {
                    const pbg = spreadBgs[s.id]
                    if (!pbg || pbg.mode !== 'photo' || !pbg.photoId) return null
                    const bgP = photos.find((p) => p.id === pbg.photoId)
                    if (!bgP) return null
                    const z = Math.min(BG_PHOTO_MAX_ZOOM, Math.max(1, pbg.zoom ?? 1))
                    return (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={bgP.preview}
                          alt=""
                          aria-hidden
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            objectPosition: `${pbg.panX ?? 50}% ${pbg.panY ?? 50}%`,
                            transform: `scale(${z})`,
                            filter: `blur(${pbg.blur ?? DEFAULT_BG_BLUR}px)`,
                            pointerEvents: 'none',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: `rgba(0,0,0,${pbg.dim ?? 0.25})`,
                            pointerEvents: 'none',
                          }}
                        />
                      </>
                    )
                  })()}
                  {renderSlots(tpl).map((slot, i) => {
                    const photoId = s.photoIds[i]
                    const photo = photoId ? photoMap.get(photoId) : undefined
                    const adj = adjusts[adjustKey(s.id, i)] ?? DEFAULT_ADJUST
                    const slotAdjust: SlotAdjust = {
                      panX: adj.panX,
                      panY: adj.panY,
                      zoom: adj.zoom,
                      rotate: adj.rotate,
                      flipH: adj.flipH,
                      flipV: adj.flipV,
                    }
                    return (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          left: `${slot.x}%`,
                          top: `${slot.y}%`,
                          width: `calc(${slot.w}% + 1px)`,
                          height: `calc(${slot.h}% + 1px)`,
                          overflow: 'hidden',
                          background: photo ? 'transparent' : '#f5f0e8',
                        }}
                      >
                        {photo && (
                          <SlotImage
                            src={photo.preview}
                            adjust={slotAdjust}
                            fit={adj.fit}
                            style={{
                              width: 'calc(100% + 4px)',
                              height: 'calc(100% + 4px)',
                              margin: '-2px',
                            }}
                          />
                        )}
                        {photo && adj.borderWidth > 0 ? (
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute',
                              inset: 0,
                              border: `${(adj.borderWidth / 10) * 6}px solid ${adj.borderColor}`,
                              boxSizing: 'border-box',
                              pointerEvents: 'none',
                            }}
                          />
                        ) : photo && templateFamily(tpl) === 'mat' ? (
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute',
                              inset: 0,
                              border: `1px solid ${frameColorForBg(spreadBgs[s.id])}`,
                              boxSizing: 'border-box',
                              pointerEvents: 'none',
                            }}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                  {/* Gutter line for standard hardcover */}
                  {showGutter && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: '50%',
                        width: 1,
                        background: 'rgba(0,0,0,0.18)',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {/* Text blocks — read-only proof render */}
                  {(spreadTexts[s.id] ?? EMPTY_TEXTS).length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        containerType: 'size',
                        pointerEvents: 'none',
                      }}
                    >
                      {(spreadTexts[s.id] ?? EMPTY_TEXTS).map((t) => (
                        <div
                          key={t.id}
                          style={{
                            position: 'absolute',
                            left: `${t.xPct}%`,
                            top: `${t.yPct}%`,
                            width: `${t.widthPct}%`,
                            transform: 'translate(-50%, -50%)',
                            textAlign: t.align,
                            color: t.color,
                            fontFamily: TEXT_FONT_CSS[t.font],
                            fontWeight: t.weight,
                            fontSize: `${t.sizePct}cqh`,
                            lineHeight: 1.15,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            textShadow:
                              t.color.toLowerCase() === '#ffffff'
                                ? '0 1px 4px rgba(0,0,0,0.45)'
                                : 'none',
                          }}
                        >
                          {t.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer: back to edit + approve & continue */}
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--dark)',
            paddingTop: 18,
            paddingBottom: 18,
            marginTop: 24,
            borderTop: '0.5px solid rgba(184,150,90,0.2)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            style={css.btnSecondary}
            onClick={() => {
              // Going back to edit clears the review checks — any subsequent
              // edit invalidates the previous review per clause 2.3.
              setReviewedSpreadIds(new Set())
              setStep('adjust')
            }}
          >
            ← Back to edit
          </button>
          <button
            type="button"
            disabled={!allReviewed}
            onClick={onApprove}
            style={{
              ...css.btnPrimary,
              opacity: allReviewed ? 1 : 0.4,
              cursor: allReviewed ? 'pointer' : 'not-allowed',
            }}
            title={allReviewed ? 'Approve and continue to shipping' : 'Tick every spread first'}
          >
            ✓ I Approve This Proof for Printing →
          </button>
        </div>

        <p style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 10, lineHeight: 1.7, textAlign: 'center' }}>
          By clicking the button above you accept clause 2.3 in full. Your acceptance is timestamped and stored with your order.
        </p>
      </div>
    )
  }

  // Note: under the Stripe Checkout flow the wizard's "Place order" button
  // redirects out of this tab to Stripe, and the post-payment landing is
  // the standalone /design/smart/success page. This in-app submit step is
  // kept as a fallback for the rare case where the redirect to Stripe
  // fails (network drop between submit-smart-order and stripe-checkout)
  // and we still need to give the customer a visible "we have your order
  // — check email" state.
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
        Order <em style={css.titleEm}>placed.</em>
      </h2>
      <p style={css.subtitle}>
        Order #{submittedOrderId ?? orderId} · ${orderTotal}
        <br />
        <span style={{ fontSize: 11, color: 'var(--muted2)' }}>
          We&apos;ll email {customerForm.email || 'you'} once payment is confirmed.
        </span>
      </p>

      <div style={{ ...css.card, textAlign: 'left', marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: GOLD, textTransform: 'uppercase', marginBottom: 14 }}>
          What happens next
        </p>
        <ol style={{ paddingLeft: 18, lineHeight: 2, fontSize: 12, color: 'var(--cream)' }}>
          <li>Complete payment on Stripe (you&apos;ll be redirected back)</li>
          <li>Our design team reviews crops &amp; pacing (24 h)</li>
          <li>Printing &amp; binding begins (5–7 business days)</li>
          <li>We ship to the address on file with tracking</li>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {albumName && (
            <button
              type="button"
              onClick={renameAlbum}
              title="Click to rename this album"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--cream)',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                cursor: 'pointer',
                fontStyle: 'italic',
                padding: 0,
                borderBottom: '0.5px dashed rgba(184,150,90,0.4)',
              }}
            >
              {albumName} ✎
            </button>
          )}
          <Link href="/design" style={css.navBack}>
            ← Back to Design
          </Link>
        </div>
      </nav>

      {step === 'setup' && renderSetup()}
      {step === 'guidance' && renderGuidance()}
      {step === 'upload' && renderUpload()}
      {step === 'group' && renderGroup()}
      {step === 'tag' && renderTag()}
      {step === 'pages' && renderPages()}
      {step === 'generate' && renderGenerate()}
      {step === 'adjust' && renderAdjust()}
      {step === 'cover' && renderCover()}
      {step === 'proof' && renderProof()}
      {step === 'submit' && renderSubmit()}

      {showAlbumPreview && size && type && coverState && (
        <AlbumPreviewModal
          spreads={spreads}
          photoMap={new Map(photos.map((p) => [p.id, p]))}
          adjusts={adjusts}
          spreadBgs={spreadBgs}
          spreadTexts={spreadTexts}
          cover={{
            type: coverState.type,
            leatherColor: coverState.leatherColor,
            foilColor: coverState.foilColor,
            customTextHex: coverState.customTextHex,
            fontId: coverState.fontId,
            fontSize: coverState.fontSize,
            primaryText: coverState.primaryText,
            subtitleText: coverState.subtitleText,
            position: coverState.position,
            photoSrc: coverState.photoSrc,
            backPhotoSrc: coverState.backPhotoSrc,
            photoScale: coverState.photoScale,
            photoX: coverState.photoX,
            photoY: coverState.photoY,
            titleX: coverState.titleX,
            titleY: coverState.titleY,
          }}
          spreadAspect={ALBUM_SPECS[size].spreadAspectRatio}
          isStandard={type === 'standard'}
          coverAspect={0.8}
          sizeLabel={ALBUM_SPECS[size].label}
          onClose={() => setShowAlbumPreview(false)}
        />
      )}

      {/* Phase 2 — Content rights modal (clauses 2.2 + 2.4).
          Shown the first time photos enter the album, gated above any
          upload path (file picker, samples, drag-and-drop). */}
      {contentRightsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setContentRightsModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 24,
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--dark2)',
              border: `0.5px solid ${GOLD}`,
              borderRadius: 12,
              padding: 28,
              maxWidth: 580,
              width: '100%',
              marginTop: 40,
              marginBottom: 40,
            }}
          >
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--cream)', margin: 0, marginBottom: 8 }}>
              Before you upload <em style={{ color: GOLD, fontStyle: 'italic' }}>photos</em>
            </h3>
            <p style={{ fontSize: 11, color: 'var(--muted2)', margin: 0, marginBottom: 16, lineHeight: 1.7 }}>
              Please confirm two things. These protect both you and us, and your
              acknowledgement is timestamped and stored with the order.
            </p>

            {/* Copyright clause */}
            <div
              style={{
                background: 'rgba(184,150,90,0.06)',
                border: '0.5px solid rgba(184,150,90,0.25)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 14,
                fontSize: 11,
                lineHeight: 1.7,
                color: 'var(--cream)',
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 9 }}>
                Clause 2.4 — Copyright [attorney review pending]
              </strong>
              <div style={{ marginTop: 6 }}>{CLAUSE_CONTENT_RIGHTS}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 11, lineHeight: 1.6, color: 'var(--cream)', marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={crCopyrightOk}
                onChange={(e) => setCrCopyrightOk(e.target.checked)}
                style={{ accentColor: GOLD, width: 16, height: 16, marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
              />
              <span>
                I own these photos, or I have permission from the photographer or rights-holder to use them in this album.
              </span>
            </label>

            {/* Content policy clause */}
            <div
              style={{
                background: 'rgba(184,150,90,0.06)',
                border: '0.5px solid rgba(184,150,90,0.25)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 14,
                fontSize: 11,
                lineHeight: 1.7,
                color: 'var(--cream)',
                whiteSpace: 'pre-wrap',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              <strong style={{ color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 9 }}>
                Clause 2.2 — Content quality &amp; policy [attorney review pending]
              </strong>
              <div style={{ marginTop: 6 }}>{CLAUSE_CONTENT_POLICY}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 11, lineHeight: 1.6, color: 'var(--cream)', marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={crPolicyOk}
                onChange={(e) => setCrPolicyOk(e.target.checked)}
                style={{ accentColor: GOLD, width: 16, height: 16, marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
              />
              <span>
                My photos meet the content policy. I understand low-resolution photos (under {LOW_RES_PX} px on the shortest edge) may print soft and I accept that result.
              </span>
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                style={css.btnSecondary}
                onClick={() => setContentRightsModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!crCopyrightOk || !crPolicyOk}
                style={{
                  ...css.btnPrimary,
                  opacity: crCopyrightOk && crPolicyOk ? 1 : 0.4,
                  cursor: crCopyrightOk && crPolicyOk ? 'pointer' : 'not-allowed',
                }}
                onClick={() => {
                  if (!(crCopyrightOk && crPolicyOk)) return
                  const record = {
                    acceptedAt: new Date().toISOString(),
                    clauseVersion: LEGAL_VERSION,
                    copyrightClause: CLAUSE_CONTENT_RIGHTS,
                    policyClause: CLAUSE_CONTENT_POLICY,
                  }
                  setContentRights(record)
                  setContentRightsModalOpen(false)
                  if (albumId) {
                    try {
                      window.localStorage.setItem(
                        `folio-content-rights:${albumId}`,
                        JSON.stringify(record),
                      )
                    } catch {
                      /* ignore quota / private mode */
                    }
                  }
                }}
              >
                Accept &amp; continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating ghost for the universal pointer-drag (mouse + touch). */}
      {dragGhost && (
        <img
          src={dragGhost.preview}
          alt=""
          aria-hidden
          style={{
            position: 'fixed',
            left: dragGhost.x,
            top: dragGhost.y,
            width: 96,
            height: 96,
            objectFit: 'cover',
            transform: 'translate(-50%, -50%) rotate(-3deg)',
            borderRadius: 6,
            border: `2px solid ${GOLD}`,
            boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
            zIndex: 99999,
            opacity: 0.92,
          }}
        />
      )}

      {/* Toast for op announcements (undo/redo/etc.) */}
      {Toast}
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

/**
 * LayoutThumb (Part C + D) — a mini visual diagram of a template's slots,
 * drawn proportionally to the album's spread aspect ratio. Hovering
 * enlarges it (scale + raised z-index + shadow) so the arrangement is
 * easy to read on a small screen before picking.
 */
function LayoutThumb({
  tpl,
  aspect,
  active,
  onClick,
}: {
  tpl: LayoutTemplate
  aspect: number
  active: boolean
  onClick: () => void
}) {
  const W = 56
  const H = Math.max(28, Math.round(W / aspect))
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`${tpl.name}${active ? ' (current)' : ''}`}
      style={{
        position: 'relative',
        width: W,
        height: H,
        padding: 0,
        background: '#0e0c09',
        border: active ? `1.5px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.3)',
        borderRadius: 3,
        cursor: 'pointer',
        flexShrink: 0,
        // Grow DOWNWARD into the open spread area on hover — growing up
        // gets clipped by the card's top edge / rounded corner.
        transformOrigin: 'center top',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(2.4)'
        e.currentTarget.style.zIndex = '50'
        e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.7)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.zIndex = '1'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {renderSlots(tpl).map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.w}%`,
            height: `${s.h}%`,
            background: s.isHero ? 'rgba(184,150,90,0.6)' : 'rgba(184,150,90,0.28)',
            border: '0.5px solid rgba(184,150,90,0.55)',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </button>
  )
}

/**
 * SpreadNavRail — sticky LEFT-side thumbnail column. One small card
 * per spread (number + mini preview matching the live template +
 * photos). Click jumps to that spread; drag to reorder. On HOVER
 * each thumbnail enlarges so the client can clearly see the spread
 * they edited without leaving their place.
 *
 * Sticky (not fixed) so it sits inside the page flow and scrolls
 * with content past the page header — no overlap with the title or
 * logo. CSS-only hover enlarge keeps it cheap.
 */
function SpreadNavRail({
  spreads,
  previewFor,
  aspect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  draggingIdx,
  dropTargetIdx,
}: {
  spreads: Spread[]
  previewFor: (photoId: string) => string | undefined
  aspect: number
  onDragStart: (idx: number) => (e: React.DragEvent) => void
  onDragOver: (idx: number) => (e: React.DragEvent) => void
  onDrop: (idx: number) => (e: React.DragEvent) => void
  onDragEnd: () => void
  draggingIdx: number | null
  dropTargetIdx: number | null
}) {
  if (spreads.length < 2) return null
  return (
    <>
      {/* Hover-enlarge effect for the mini cards. CSS rules use the
          tile class so it's GPU-accelerated and doesn't need React
          re-renders. The transform-origin pins the enlargement to the
          left edge of the card so it grows INTO the spread editor
          area, never off-screen to the left. */}
      <style>{`
        .ff-nav-tile {
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
          transform-origin: left center;
        }
        .ff-nav-tile:hover {
          transform: scale(2.1);
          z-index: 60;
          box-shadow: 0 16px 40px rgba(0,0,0,0.7);
          border-color: ${GOLD} !important;
        }
      `}</style>
      <nav
        aria-label="Spread navigator"
        style={{
          position: 'sticky',
          // Sits at this offset from the top of the SCROLL container
          // (the page). Once the user scrolls past the page title the
          // rail follows them down the viewport.
          top: 24,
          alignSelf: 'flex-start',
          flexShrink: 0,
          width: 100,
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 8px',
          background: 'rgba(20,16,12,0.55)',
          border: '0.5px solid rgba(184,150,90,0.2)',
          borderRadius: 10,
          overflowY: 'auto',
          overflowX: 'visible',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(184,150,90,0.3) transparent',
        }}
      >
        {spreads.map((s, i) => {
          const tpl = TEMPLATE_BY_ID.get(s.templateId)
          const miniSlots = tpl ? renderSlots(tpl) : []
          const isMat = tpl ? templateFamily(tpl) === 'mat' : false
          return (
            <button
              key={s.id}
              type="button"
              className="ff-nav-tile"
              title={`Jump to spread ${i + 1} · hover to enlarge · drag to reorder`}
              draggable
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
              onClick={() => {
                document
                  .getElementById(`ff-spread-${s.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: 4,
                background: 'transparent',
                border:
                  dropTargetIdx === i && draggingIdx !== i
                    ? `1.5px solid ${GOLD}`
                    : '0.5px solid rgba(184,150,90,0.25)',
                borderRadius: 6,
                cursor: draggingIdx === i ? 'grabbing' : 'grab',
                flexShrink: 0,
                opacity: draggingIdx === i ? 0.4 : 1,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: `${aspect}`,
                  borderRadius: 3,
                  overflow: 'hidden',
                  background: isMat ? '#1f1813' : '#1a1410',
                }}
              >
                {miniSlots.map((slot, si) => {
                  const pid = s.photoIds[si]
                  const src = pid ? previewFor(pid) : undefined
                  return (
                    <div
                      key={si}
                      style={{
                        position: 'absolute',
                        left: `${slot.x}%`,
                        top: `${slot.y}%`,
                        width: `calc(${slot.w}% + 0.5px)`,
                        height: `calc(${slot.h}% + 0.5px)`,
                        overflow: 'hidden',
                        background: '#2a211a',
                      }}
                    >
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={src}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: 1,
                  color: 'var(--muted2)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {i + 1}
              </span>
            </button>
          )
        })}
      </nav>
    </>
  )
}

/**
 * SpreadBgControl — per-spread background picker in the header.
 * Modes: Paper · Colour swatches · Photo (blurred, dimmed, zoom ≤200%).
 */
function SpreadBgControl({
  bg,
  onChange,
  spreadPhotos,
  savedColors,
  onSaveColor,
}: {
  bg: SpreadBg
  onChange: (next: SpreadBg) => void
  spreadPhotos: Photo[]
  savedColors: string[]
  onSaveColor: (hex: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [photoColors, setPhotoColors] = useState<string[]>([])
  const [picking, setPicking] = useState(false)

  // Sample a few representative colours from this spread's photos so the
  // client can match the background to the imagery in one click.
  useEffect(() => {
    if (!open || spreadPhotos.length === 0) {
      setPhotoColors([])
      return
    }
    let cancelled = false
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    const sampleOne = (src: string) =>
      new Promise<string | null>((resolve) => {
        const img = new window.Image()
        if (/^https?:\/\//.test(src)) img.crossOrigin = 'anonymous'
        img.onload = () => {
          try {
            const c = document.createElement('canvas')
            c.width = 20
            c.height = 20
            const ctx = c.getContext('2d')
            if (!ctx) return resolve(null)
            ctx.drawImage(img, 0, 0, 20, 20)
            const d = ctx.getImageData(0, 0, 20, 20).data
            let r = 0
            let g = 0
            let b = 0
            let n = 0
            for (let i = 0; i < d.length; i += 4) {
              r += d[i]
              g += d[i + 1]
              b += d[i + 2]
              n++
            }
            resolve(
              `#${toHex(Math.round(r / n))}${toHex(Math.round(g / n))}${toHex(
                Math.round(b / n),
              )}`,
            )
          } catch {
            resolve(null) // tainted canvas — skip
          }
        }
        img.onerror = () => resolve(null)
        img.src = src
      })
    Promise.all(spreadPhotos.slice(0, 6).map((p) => sampleOne(p.preview))).then(
      (cols) => {
        if (cancelled) return
        const uniq = Array.from(
          new Set(cols.filter((c): c is string => Boolean(c))),
        )
        setPhotoColors(uniq)
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, spreadPhotos])

  // Custom photo eyedropper (works in EVERY browser). Opens a modal
  // with the spread's photos enlarged; click/tap anywhere on a photo
  // to grab that exact pixel's colour.
  const [dropper, setDropper] = useState(false)
  // Cached drawn photos so we can sample any pixel instantly on hover.
  const srcCanvases = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const [dropReady, setDropReady] = useState(0) // bump when a photo loads
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const [loupe, setLoupe] = useState<{ hex: string; x: number; y: number } | null>(
    null,
  )

  // Pre-draw the spread's photos to offscreen canvases when the dropper
  // opens — sampling/zoom then needs no per-move image decode.
  useEffect(() => {
    if (!dropper) return
    let cancelled = false
    srcCanvases.current.clear()
    setDropReady(0)
    for (const p of spreadPhotos) {
      const img = new window.Image()
      if (/^https?:\/\//.test(p.preview)) img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (cancelled) return
        const W = Math.min(1400, img.naturalWidth || 1400)
        const H = Math.round(
          W * ((img.naturalHeight || 1) / (img.naturalWidth || 1)),
        )
        const c = document.createElement('canvas')
        c.width = W
        c.height = H
        const cx = c.getContext('2d')
        if (!cx) return
        try {
          cx.drawImage(img, 0, 0, W, H)
          srcCanvases.current.set(p.preview, c)
          setDropReady((n) => n + 1)
        } catch {
          /* tainted — skip */
        }
      }
      img.src = p.preview
    }
    return () => {
      cancelled = true
    }
  }, [dropper, spreadPhotos])

  const sampleAt = (
    src: string,
    rx: number,
    ry: number,
  ): { hex: string; px: number; py: number; cv: HTMLCanvasElement } | null => {
    const cv = srcCanvases.current.get(src)
    if (!cv) return null
    const px = Math.min(cv.width - 1, Math.max(0, Math.floor(rx * cv.width)))
    const py = Math.min(cv.height - 1, Math.max(0, Math.floor(ry * cv.height)))
    const cx = cv.getContext('2d')
    if (!cx) return null
    try {
      const d = cx.getImageData(px, py, 1, 1).data
      const toHex = (n: number) => n.toString(16).padStart(2, '0')
      return { hex: `#${toHex(d[0])}${toHex(d[1])}${toHex(d[2])}`, px, py, cv }
    } catch {
      return null
    }
  }

  const onDropperMove = (
    e: React.MouseEvent<HTMLImageElement>,
    src: string,
  ) => {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const rx = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ry = Math.min(0.999, Math.max(0, (e.clientY - rect.top) / rect.height))
    const s = sampleAt(src, rx, ry)
    if (!s) return
    setLoupe({ hex: s.hex, x: e.clientX, y: e.clientY })
    // Draw a magnified, pixelated patch into the loupe canvas.
    const lc = loupeRef.current
    if (lc) {
      const g = lc.getContext('2d')
      if (g) {
        const span = 11 // source px sampled (odd → centred)
        const size = lc.width
        g.imageSmoothingEnabled = false
        g.clearRect(0, 0, size, size)
        g.drawImage(
          s.cv,
          s.px - (span - 1) / 2,
          s.py - (span - 1) / 2,
          span,
          span,
          0,
          0,
          size,
          size,
        )
        // crosshair on the centre pixel
        const cell = size / span
        g.strokeStyle = '#000'
        g.lineWidth = 1
        g.strokeRect(
          Math.floor((size - cell) / 2) + 0.5,
          Math.floor((size - cell) / 2) + 0.5,
          cell,
          cell,
        )
        g.strokeStyle = '#fff'
        g.strokeRect(
          Math.floor((size - cell) / 2) - 0.5,
          Math.floor((size - cell) / 2) - 0.5,
          cell + 2,
          cell + 2,
        )
      }
    }
  }

  const eyedrop = async () => {
    interface EyeDropperCtor {
      new (): { open: () => Promise<{ sRGBHex: string }> }
    }
    const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    if (ED) {
      // Native screen picker when available — fastest, whole screen.
      try {
        setPicking(true)
        const res = await new ED().open()
        if (res?.sRGBHex) {
          onChange({ mode: 'color', color: res.sRGBHex })
          onSaveColor(res.sRGBHex)
        }
      } catch {
        /* cancelled */
      } finally {
        setPicking(false)
      }
      return
    }
    // Fallback: our own click-on-photo picker.
    if (spreadPhotos.length === 0) {
      alert('Add a photo to this spread first, then pick a colour from it.')
      return
    }
    setDropper(true)
  }

  const pickFromImage = (e: React.MouseEvent<HTMLImageElement>, src: string) => {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const rx = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ry = Math.min(0.999, Math.max(0, (e.clientY - rect.top) / rect.height))
    const s = sampleAt(src, rx, ry)
    if (!s) {
      alert('That photo is still loading — try again in a second.')
      return
    }
    onChange({ mode: 'color', color: s.hex })
    onSaveColor(s.hex)
    setLoupe(null)
    setDropper(false) // close — refine it in the RGB editor next
  }
  const swatch =
    bg.mode === 'paper'
      ? PAPER_HEX
      : bg.mode === 'color'
      ? bg.color || BG_PALETTE[0].hex
      : '#b8965a'
  const pillSm: React.CSSProperties = {
    background: 'transparent',
    border: `0.5px solid ${GOLD}`,
    color: GOLD,
    borderRadius: 30,
    padding: '3px 9px',
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    cursor: 'pointer',
  }
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        title="Spread background"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: '0.5px solid rgba(184,150,90,0.3)',
          borderRadius: 30,
          padding: '4px 10px',
          cursor: 'pointer',
          color: GOLD,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: 'uppercase',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            background: bg.mode === 'photo' ? 'linear-gradient(135deg,#b8965a,#3a342c)' : swatch,
            border: '0.5px solid rgba(184,150,90,0.5)',
            display: 'inline-block',
          }}
        />
        BG
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            background: 'var(--dark3)',
            border: `0.5px solid ${GOLD}`,
            borderRadius: 8,
            padding: 12,
            width: 300,
            maxHeight: '80vh',
            overflowY: 'auto',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          }}
        >
          <p style={{ fontSize: 9, letterSpacing: 1.5, color: 'var(--muted2)', textTransform: 'uppercase', margin: '0 0 8px' }}>
            Spread background
          </p>

          {/* Paper + colour swatches */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => onChange({ mode: 'paper' })}
              title="Paper (white)"
              style={{
                width: 26, height: 26, borderRadius: 4, cursor: 'pointer',
                background: PAPER_HEX,
                border: bg.mode === 'paper' ? `2px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.4)',
              }}
            />
            {BG_PALETTE.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => onChange({ mode: 'color', color: c.hex })}
                style={{
                  width: 26, height: 26, borderRadius: 4, cursor: 'pointer',
                  background: c.hex,
                  border:
                    bg.mode === 'color' && bg.color === c.hex
                      ? `2px solid ${GOLD}`
                      : '0.5px solid rgba(184,150,90,0.4)',
                }}
              />
            ))}
          </div>

          {/* Colour FROM your photos + eyedropper */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '0 0 6px',
            }}
          >
            <span
              style={{
                fontSize: 9,
                letterSpacing: 1.5,
                color: 'var(--muted2)',
                textTransform: 'uppercase',
              }}
            >
              From your photos
            </span>
            <button
              type="button"
              onClick={eyedrop}
              title="Pick any colour from the screen"
              style={{
                background: 'transparent',
                border: `0.5px solid ${GOLD}`,
                color: GOLD,
                borderRadius: 30,
                padding: '2px 8px',
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {picking ? 'Picking…' : '⊙ Pick'}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {photoColors.length === 0 ? (
              <span style={{ fontSize: 9, color: 'var(--muted2)' }}>
                {spreadPhotos.length
                  ? 'Reading colours…'
                  : 'Add photos to sample colours.'}
              </span>
            ) : (
              photoColors.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={`Use ${hex} · click ☆ to save`}
                  onClick={() => onChange({ mode: 'color', color: hex })}
                  onDoubleClick={() => onSaveColor(hex)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: hex,
                    border:
                      bg.mode === 'color' && bg.color === hex
                        ? `2px solid ${GOLD}`
                        : '0.5px solid rgba(184,150,90,0.4)',
                  }}
                />
              ))
            )}
          </div>

          {/* Saved colours — kept across every spread */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '0 0 6px',
            }}
          >
            <span
              style={{
                fontSize: 9,
                letterSpacing: 1.5,
                color: 'var(--muted2)',
                textTransform: 'uppercase',
              }}
            >
              Saved colours
            </span>
            <button
              type="button"
              onClick={() => onSaveColor(bgFillColor(bg))}
              title="Save the current colour"
              style={{
                background: 'transparent',
                border: `0.5px solid ${GOLD}`,
                color: GOLD,
                borderRadius: 30,
                padding: '2px 8px',
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ☆ Save current
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {savedColors.map((hex, i) => (
              <button
                key={i}
                type="button"
                disabled={!hex}
                title={hex ? `Use ${hex}` : 'Empty slot'}
                onClick={() => hex && onChange({ mode: 'color', color: hex })}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 4,
                  cursor: hex ? 'pointer' : 'default',
                  background: hex || 'transparent',
                  border:
                    bg.mode === 'color' && bg.color === hex && hex
                      ? `2px solid ${GOLD}`
                      : '1px dashed rgba(184,150,90,0.4)',
                }}
              />
            ))}
          </div>

          {/* Full colour picker (Photoshop-style) */}
          {bg.mode === 'color' && (
            <div style={{ margin: '2px 0 12px' }}>
              <p style={{ fontSize: 9, letterSpacing: 1.5, color: 'var(--muted2)', textTransform: 'uppercase', margin: '0 0 8px' }}>
                Fine-tune colour
              </p>
              <ColorPicker
                value={bgFillColor(bg)}
                onChange={(hex) => onChange({ mode: 'color', color: hex })}
              />
            </div>
          )}

          {/* Photo background */}
          <p style={{ fontSize: 9, letterSpacing: 1.5, color: 'var(--muted2)', textTransform: 'uppercase', margin: '0 0 6px' }}>
            Or a blurred photo
          </p>
          {spreadPhotos.length === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--muted2)', margin: 0 }}>
              Add photos to this spread to use one as a background.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {spreadPhotos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      mode: 'photo',
                      photoId: p.id,
                      blur: bg.blur ?? DEFAULT_BG_BLUR,
                      dim: bg.dim ?? 0.25,
                      zoom: Math.min(BG_PHOTO_MAX_ZOOM, bg.zoom ?? 1),
                      panX: bg.panX ?? 50,
                      panY: bg.panY ?? 50,
                    })
                  }
                  style={{
                    width: 34, height: 34, borderRadius: 4, overflow: 'hidden', padding: 0,
                    cursor: 'pointer',
                    border:
                      bg.mode === 'photo' && bg.photoId === p.id
                        ? `2px solid ${GOLD}`
                        : '0.5px solid rgba(184,150,90,0.4)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}

          {bg.mode === 'photo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Blur {bg.blur ?? DEFAULT_BG_BLUR}px
                <input
                  type="range" min={0} max={40} step={1}
                  value={bg.blur ?? DEFAULT_BG_BLUR}
                  onChange={(e) => onChange({ ...bg, blur: Number(e.target.value) })}
                  style={{ width: '100%', accentColor: GOLD }}
                />
              </label>
              <label style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Darken {Math.round((bg.dim ?? 0.25) * 100)}%
                <input
                  type="range" min={0} max={70} step={5}
                  value={Math.round((bg.dim ?? 0.25) * 100)}
                  onChange={(e) => onChange({ ...bg, dim: Number(e.target.value) / 100 })}
                  style={{ width: '100%', accentColor: GOLD }}
                />
              </label>
              <label style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Zoom {Math.round((bg.zoom ?? 1) * 100)}% (max 200%)
                <input
                  type="range" min={100} max={200} step={5}
                  value={Math.round((bg.zoom ?? 1) * 100)}
                  onChange={(e) =>
                    onChange({ ...bg, zoom: Math.min(BG_PHOTO_MAX_ZOOM, Number(e.target.value) / 100) })
                  }
                  style={{ width: '100%', accentColor: GOLD }}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              marginTop: 10, width: '100%', background: 'transparent',
              border: '0.5px solid rgba(184,150,90,0.3)', color: GOLD,
              borderRadius: 4, padding: '5px 0', fontSize: 10, cursor: 'pointer',
              letterSpacing: 1.5, textTransform: 'uppercase',
            }}
          >
            Done
          </button>
        </div>
      )}

      {dropper && (
        <div
          onClick={() => setDropper(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <p
            style={{
              color: GOLD,
              fontSize: 13,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 16,
            }}
          >
            {dropReady < spreadPhotos.length
              ? 'Loading photos…'
              : 'Hover to preview · click to pick the colour'}
          </p>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              gap: 14,
              flexWrap: 'wrap',
              justifyContent: 'center',
              maxWidth: '90vw',
              maxHeight: '70vh',
              overflow: 'auto',
            }}
          >
            {spreadPhotos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.preview}
                alt=""
                onMouseMove={(e) => onDropperMove(e, p.preview)}
                onMouseLeave={() => setLoupe(null)}
                onClick={(e) => pickFromImage(e, p.preview)}
                style={{
                  maxHeight: '60vh',
                  maxWidth: '42vw',
                  objectFit: 'contain',
                  cursor: DROPPER_CURSOR,
                  border: `1px solid ${GOLD}`,
                  borderRadius: 6,
                }}
              />
            ))}
          </div>

          {/* Magnifier loupe that follows the cursor */}
          {loupe && (
            <div
              style={{
                position: 'fixed',
                left: Math.min(window.innerWidth - 130, loupe.x + 20),
                top: Math.max(10, loupe.y - 130),
                pointerEvents: 'none',
                zIndex: 210,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <canvas
                ref={loupeRef}
                width={108}
                height={108}
                style={{
                  width: 108,
                  height: 108,
                  borderRadius: '50%',
                  border: `2px solid ${GOLD}`,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
                  background: '#000',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(14,12,9,0.95)',
                  border: `1px solid ${GOLD}`,
                  borderRadius: 30,
                  padding: '3px 10px',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: loupe.hex,
                    border: '1px solid rgba(255,255,255,0.4)',
                  }}
                />
                <span
                  style={{
                    color: '#fff',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    letterSpacing: 1,
                  }}
                >
                  {loupe.hex.toUpperCase()}
                </span>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setDropper(false)}
            style={{
              marginTop: 18,
              background: 'transparent',
              border: `0.5px solid ${GOLD}`,
              color: GOLD,
              borderRadius: 30,
              padding: '8px 22px',
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

type SlotDragHandlers = ReturnType<typeof useSlotDrag>['slotHandlers']
type SpreadDropHandlers = ReturnType<typeof useSlotDrag>['spreadDropHandlers']

/**
 * SpreadTextLayer — free-positioned text blocks over a spread. Fills the
 * spread box (position:absolute inset:0). Font size is in container-query
 * height units (cqh) so 1 unit == 1% of the spread height — identical to
 * how the print composite sizes it (sizePct% of H) → proof = print.
 */
function SpreadTextLayer({
  texts,
  onChange,
}: {
  texts: SpreadText[]
  onChange: (next: SpreadText[]) => void
}) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [selId, setSelId] = useState<string | null>(null)
  // editId = the text whose textarea is open (double-click to edit).
  const [editId, setEditId] = useState<string | null>(null)

  // Click ANYWHERE outside a text block or its toolbar → auto-finish
  // (no "Done" needed). Pointerdown so it fires before slot handlers.
  useEffect(() => {
    if (!selId && !editId) return
    const onDocDown = (ev: PointerEvent) => {
      const el = ev.target as HTMLElement | null
      if (el && (el.closest('[data-fftext]') || el.closest('[data-fftb]'))) return
      setSelId(null)
      setEditId(null)
    }
    document.addEventListener('pointerdown', onDocDown, true)
    return () => document.removeEventListener('pointerdown', onDocDown, true)
  }, [selId, editId])
  // Snap guides (Photoshop-style): while dragging, snap X to the nearest
  // of LEFT-PAGE centre (25), SPREAD centre (50), RIGHT-PAGE centre (75)
  // and Y to the middle (50); highlight the active line in bright gold.
  const [guide, setGuide] = useState<{ x: number | null; h: boolean }>({ x: null, h: false })
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null)
  const SNAP = 2 // % distance that snaps
  const SNAP_XS = [25, 50, 75]

  useEffect(() => {
    ensureTextFonts()
  }, [])

  const update = (id: string, patch: Partial<SpreadText>) =>
    onChange(texts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const clamp = (v: number) => Math.min(TEXT_SAFE_MAX, Math.max(TEXT_SAFE_MIN, v))

  const onPointerDownText = (e: React.PointerEvent, t: SpreadText) => {
    e.stopPropagation()
    // If this text is in edit mode, let the textarea handle the pointer
    // (caret placement / selection) — don't start a drag.
    if (editId === t.id) return
    setSelId(t.id)
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      id: t.id,
      startX: e.clientX,
      startY: e.clientY,
      ox: t.xPct,
      oy: t.yPct,
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    const rect = layerRef.current?.getBoundingClientRect()
    if (!d || !rect) return
    const dx = ((e.clientX - d.startX) / rect.width) * 100
    const dy = ((e.clientY - d.startY) / rect.height) * 100
    let nx = clamp(d.ox + dx)
    let ny = clamp(d.oy + dy)
    let snapX: number | null = null
    for (const gx of SNAP_XS) {
      if (Math.abs(nx - gx) <= SNAP) {
        nx = gx
        snapX = gx
        break
      }
    }
    const nearH = Math.abs(ny - 50) <= SNAP
    if (nearH) ny = 50
    setGuide({ x: snapX, h: nearH })
    update(d.id, { xPct: nx, yPct: ny })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    setGuide({ x: null, h: false })
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const add = (preset: 'text' | 'title') => {
    const created =
      preset === 'title'
        ? makeSpreadText({ text: 'Title', sizePct: 11, widthPct: 84, weight: 700 })
        : makeSpreadText()
    onChange([...texts, created])
    // Select + open it for editing right away so they can just type.
    setSelId(created.id)
    setEditId(created.id)
  }

  const sel = texts.find((t) => t.id === selId) || null
  const pill: React.CSSProperties = {
    background: 'rgba(14,12,9,0.85)',
    color: GOLD,
    border: `0.5px solid ${GOLD}`,
    borderRadius: 30,
    padding: '4px 12px',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    cursor: 'pointer',
    pointerEvents: 'auto',
    fontFamily: 'var(--font-body)',
  }

  return (
    <div
      ref={layerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        // cqh = 1% of this layer's height → matches composite sizing.
        containerType: 'size',
        pointerEvents: 'none',
        zIndex: 6,
      }}
    >
      {/* Bright snap line — appears while dragging onto a page/spread centre */}
      {guide.x != null && (
        <div
          style={{
            position: 'absolute',
            left: `${guide.x}%`,
            top: 0,
            bottom: 0,
            width: 0,
            borderLeft: `1.5px solid ${GOLD}`,
            transform: 'translateX(-0.75px)',
            pointerEvents: 'none',
            zIndex: 8,
          }}
        />
      )}
      {guide.h && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 0,
            borderTop: `1.5px solid ${GOLD}`,
            transform: 'translateY(-0.75px)',
            pointerEvents: 'none',
            zIndex: 8,
          }}
        />
      )}
      {texts.map((t) => {
        const selected = t.id === selId
        const editing = t.id === editId
        return (
          <div
            key={t.id}
            data-fftext
            onPointerDown={(e) => onPointerDownText(e, t)}
            onClick={(e) => {
              e.stopPropagation()
              setSelId(t.id)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setSelId(t.id)
              setEditId(t.id) // double-click = rewrite
            }}
            title={editing ? '' : 'Drag to move · double-click to edit text'}
            style={{
              position: 'absolute',
              left: `${t.xPct}%`,
              top: `${t.yPct}%`,
              width: `${t.widthPct}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              cursor: editing ? 'text' : 'move',
              textAlign: t.align,
              outline: selected ? `1px dashed ${GOLD}` : 'none',
              outlineOffset: 4,
            }}
          >
            {editing ? (
              <textarea
                value={t.text}
                autoFocus
                onChange={(e) => update(t.id, { text: e.target.value })}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setEditId(null)} // click away = done editing
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.15)',
                  border: 'none',
                  resize: 'none',
                  outline: 'none',
                  textAlign: t.align,
                  color: t.color,
                  fontFamily: TEXT_FONT_CSS[t.font],
                  fontWeight: t.weight,
                  fontSize: `${t.sizePct}cqh`,
                  lineHeight: 1.15,
                  overflow: 'hidden',
                  height: `${Math.max(1, t.text.split('\n').length) * t.sizePct * 1.2}cqh`,
                }}
              />
            ) : (
              <div
                style={{
                  color: t.color,
                  fontFamily: TEXT_FONT_CSS[t.font],
                  fontWeight: t.weight,
                  fontSize: `${t.sizePct}cqh`,
                  lineHeight: 1.15,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  userSelect: 'none',
                  textShadow:
                    t.color.toLowerCase() === '#ffffff'
                      ? '0 1px 4px rgba(0,0,0,0.45)'
                      : 'none',
                }}
              >
                {t.text || ' '}
              </div>
            )}
          </div>
        )
      })}

      {/* Add buttons — bottom centre */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 8,
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 6,
          pointerEvents: 'none',
        }}
      >
        <button type="button" style={pill} onClick={() => add('text')}>
          ＋ Text
        </button>
        <button type="button" style={pill} onClick={() => add('title')}>
          ＋ Title
        </button>
      </div>

      {/* Style toolbar — shown when a text is selected */}
      {sel && (
        <div
          data-fftb
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: 8,
            top: 8,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            padding: 8,
            background: 'rgba(14,12,9,0.92)',
            border: `0.5px solid ${GOLD}`,
            borderRadius: 8,
            pointerEvents: 'auto',
            maxWidth: '92%',
            zIndex: 7,
          }}
        >
          <select
            value={sel.font}
            onChange={(e) => update(sel.id, { font: e.target.value as SpreadText['font'] })}
            style={{
              fontSize: 11,
              padding: '3px 6px',
              color: '#0e0c09',
              background: '#ffffff',
              border: `0.5px solid ${GOLD}`,
              borderRadius: 4,
            }}
          >
            {(
              [
                'display',
                'elegant',
                'castellar',
                'copperplate',
                'serif',
                'sans',
                'script',
                'hand',
              ] as SpreadText['font'][]
            ).map((f) => (
              <option key={f} value={f} style={{ color: '#0e0c09', background: '#fff' }}>
                {TEXT_FONT_LABEL[f]}
              </option>
            ))}
          </select>
          <input
            type="range"
            min={2}
            max={20}
            step={0.5}
            value={sel.sizePct}
            onChange={(e) => update(sel.id, { sizePct: Number(e.target.value) })}
            title="Size"
            style={{ width: 80, accentColor: GOLD }}
          />
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => update(sel.id, { align: a })}
              style={{
                ...pill,
                padding: '2px 8px',
                background: sel.align === a ? GOLD : 'transparent',
                color: sel.align === a ? '#0e0c09' : GOLD,
              }}
            >
              {a === 'left' ? '⬅' : a === 'center' ? '⬌' : '➡'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => update(sel.id, { weight: sel.weight === 700 ? 400 : 700 })}
            style={{
              ...pill,
              padding: '2px 8px',
              fontWeight: sel.weight === 700 ? 700 : 400,
            }}
          >
            B
          </button>
          {TEXT_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => update(sel.id, { color: c })}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: c,
                border:
                  sel.color === c ? `2px solid ${GOLD}` : '1px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(texts.filter((x) => x.id !== sel.id))
              setSelId(null)
              setEditId(null)
            }}
            style={{ ...pill, color: '#ff8a8a', borderColor: '#ff8a8a', padding: '2px 8px' }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              setSelId(null)
              setEditId(null)
            }}
            style={{ ...pill, padding: '2px 8px' }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}

function SpreadView({
  spread,
  index,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  slotDragHandlers,
  spreadDropHandlers,
  onPhotoCountChange,
  onDeleteSpread,
  onEmptySlotClick,
  photoMap,
  albumSize,
  albumType,
  adjusts,
  bg,
  onBgChange,
  photoListForBg,
  onPhotoClick,
  editingSlot,
  swappingSlot,
  onStartSwap,
  onResetAdjust,
  onRemovePhoto,
  onAdjustChange,
  onPickTemplate,
  placementArmed,
  texts,
  onTextsChange,
  savedColors,
  onSaveColor,
}: {
  spread: Spread
  index: number
  isDragging: boolean
  isDropTarget: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  slotDragHandlers: SlotDragHandlers
  spreadDropHandlers: SpreadDropHandlers
  onPhotoCountChange: (n: number) => void
  onDeleteSpread: () => void
  onEmptySlotClick: (slotIdx: number) => void
  photoMap: Map<string, Photo>
  albumSize: AlbumSize
  albumType: AlbumType
  adjusts: Record<string, PhotoAdjust>
  bg: SpreadBg
  onBgChange: (next: SpreadBg) => void
  photoListForBg: Photo[]
  onPhotoClick: (idx: number) => void
  editingSlot: number
  swappingSlot: number
  onStartSwap: (idx: number) => void
  onResetAdjust: (idx: number) => void
  onRemovePhoto: (idx: number) => void
  onAdjustChange: (idx: number, patch: Partial<PhotoAdjust>) => void
  onPickTemplate: (tplId: string) => void
  /** True when an unused photo is "picked up" (tap-to-place). When set,
   *  tapping an empty slot PLACES the picked photo instead of opening
   *  the upload/pick picker. */
  placementArmed: boolean
  texts: SpreadText[]
  onTextsChange: (next: SpreadText[]) => void
  savedColors: string[]
  onSaveColor: (hex: string) => void
}) {
  // Layout-picker family tab. Hook MUST be before any early return
  // (rules of hooks). Defaults to the family of the current template.
  const [pickerFamily, setPickerFamily] = useState<LayoutFamily>(
    TEMPLATE_BY_ID.get(spread.templateId)?.id.startsWith('mat-') ? 'mat' : 'bleed',
  )
  const tpl = TEMPLATE_BY_ID.get(spread.templateId)
  if (!tpl) return null
  // Edge-to-edge slots for bleed layouts (no white gaps); mat unchanged.
  const rslots = renderSlots(tpl)
  // Matted photos get an automatic thin frame (contrast-aware) so the
  // edge always looks intentional — never a stray cream/white seam.
  const matFrame = templateFamily(tpl) === 'mat' ? frameColorForBg(bg) : null

  const eventName = spread.eventId === 'unassigned'
    ? 'Untagged'
    : EVENTS.find((e) => e.id === spread.eventId)?.name ?? ''
  const aspect = ALBUM_SPECS[albumSize].spreadAspectRatio
  const showGutter = albumType === 'standard'

  return (
    <div
      id={`ff-spread-${spread.id}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        position: 'relative',
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s',
        scrollMarginTop: 80,
      }}
    >
      {/* Drop indicator (gold line above the spread when this is the drop target) */}
      {isDropTarget && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            left: 0,
            right: 0,
            height: 3,
            background: GOLD,
            borderRadius: 2,
            pointerEvents: 'none',
            boxShadow: `0 0 8px ${GOLD}`,
          }}
        />
      )}

    <div
      style={{
        background: 'var(--dark2)',
        border: '0.5px solid rgba(184,150,90,0.2)',
        borderRadius: 10,
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder this spread"
          style={{
            fontSize: 9,
            letterSpacing: 2,
            color: 'var(--muted2)',
            textTransform: 'uppercase',
            cursor: 'grab',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            userSelect: 'none',
          }}
          onMouseDown={(e) => (e.currentTarget.style.cursor = 'grabbing')}
          onMouseUp={(e) => (e.currentTarget.style.cursor = 'grab')}
        >
          <span style={{ color: GOLD, fontSize: 11, fontWeight: 700 }}>⋮⋮</span>
          Spread {index + 1} · {ALBUM_SPECS[albumSize].label}
        </span>

        {/* Photo count pill — reflects the LAYOUT'S slot count, not how
            many are filled. Picking a 5-slot layout via the visual
            picker must show "5 photos" (with empties to fill), not "2"
            just because only 2 slots have photos so far. */}
        <PhotoCountDropdown
          current={tpl.slots.length}
          // 1–8 cover the everyday compositions. 12 and 18 unlock the
          // big matted grids (contact-sheet pages) — useful for
          // ceremony group shots, candids, or a portraits-session
          // page. The smart-layout engine itself still tops out at 5
          // per auto-spread; bigger counts are for manual control.
          available={[1, 2, 3, 4, 5, 6, 7, 8, 12, 18]}
          onChange={onPhotoCountChange}
        />

        {/* Delete whole spread. Destructive — the click handler in the
            parent confirms before recording the op so a stray tap
            won't drop a spread. Photos on the spread return to the
            unused pool; the op is on the undo stack so a confirmed
            delete is still reversible until the user navigates away. */}
        <button
          type="button"
          onClick={onDeleteSpread}
          aria-label="Delete this spread"
          title="Delete this spread — its photos return to the unused pool"
          style={{
            background: 'transparent',
            border: '1px solid rgba(220,90,90,0.35)',
            color: '#e08585',
            padding: '6px 10px',
            fontSize: 10,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          ✕ Delete spread
        </button>

        {/* Visual layout picker — Full-bleed vs Background (matted)
            families, best ORIENTATION match first. Hover to enlarge,
            click to apply. */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxWidth: 560,
          }}
        >
          {/* Family toggle — ONE CLICK switches this spread's whole look:
              it both filters the picker AND immediately applies the best
              matching layout of that family to the spread. */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {(['bleed', 'mat'] as LayoutFamily[]).map((fam) => {
              const on = pickerFamily === fam
              return (
                <button
                  key={fam}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPickerFamily(fam)
                    // Apply the best layout of the chosen family right away
                    // so the switch is truly one-click.
                    const spreadPhotos = spread.photoIds
                      .filter((id): id is string => Boolean(id))
                      .map((id) => photoMap.get(id))
                      .filter((p): p is Photo => Boolean(p))
                    const famTpls = templatesForCount(
                      spread.photoIds.length,
                      albumType,
                    ).filter((t) => templateFamily(t) === fam)
                    if (famTpls.length > 0) {
                      const best = famTpls
                        .map((t) => ({
                          t,
                          s: spreadPhotos.length
                            ? scoreTemplateForPhotos(t, spreadPhotos, aspect)
                            : 0,
                        }))
                        .sort((a, b) => b.s - a.s)[0].t
                      if (best.id !== spread.templateId) onPickTemplate(best.id)
                    }
                  }}
                  style={{
                    background: on ? GOLD : 'transparent',
                    color: on ? '#0e0c09' : GOLD,
                    border: `0.5px solid ${on ? GOLD : 'rgba(184,150,90,0.35)'}`,
                    borderRadius: 30,
                    padding: '4px 14px',
                    fontSize: 9,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    fontWeight: on ? 700 : 400,
                  }}
                >
                  {fam === 'bleed' ? 'Full bleed' : 'Matted'}
                </button>
              )
            })}
            <span style={{ fontSize: 8, letterSpacing: 1, color: 'var(--muted2)', textTransform: 'uppercase' }}>
              one-click switch
            </span>
          </div>
          <div
            title="Tap a layout to apply · hover to enlarge"
            style={{
              display: 'flex',
              gap: 5,
              alignItems: 'center',
              flexWrap: 'wrap',
              // overflow stays visible so the hover-zoom isn't clipped.
              overflow: 'visible',
              padding: '12px 2px',
            }}
          >
            {(() => {
              const spreadPhotosForScore = spread.photoIds
                .filter((id): id is string => Boolean(id))
                .map((id) => photoMap.get(id))
                .filter((p): p is Photo => Boolean(p))
              const all = templatesForCount(spread.photoIds.length, albumType).filter(
                (t) => templateFamily(t) === pickerFamily,
              )
              const scored = all
                .map((t) => ({
                  t,
                  s: spreadPhotosForScore.length
                    ? scoreTemplateForPhotos(t, spreadPhotosForScore, aspect)
                    : 0,
                }))
                .sort((a, b) => b.s - a.s)
              const ordered = scored.map((x) => x.t).slice(0, 14)
              if (ordered.length === 0) {
                return (
                  <span style={{ fontSize: 9, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    No {pickerFamily === 'bleed' ? 'full-bleed' : 'matted'} layouts for {spread.photoIds.length} photos
                  </span>
                )
              }
              return ordered.map((t) => (
                <LayoutThumb
                  key={t.id}
                  tpl={t}
                  aspect={aspect}
                  active={t.id === spread.templateId}
                  onClick={() => onPickTemplate(t.id)}
                />
              ))
            })()}
          </div>
        </div>
        <SpreadBgControl
          bg={bg}
          onChange={onBgChange}
          savedColors={savedColors}
          onSaveColor={onSaveColor}
          spreadPhotos={spread.photoIds
            .filter((id): id is string => Boolean(id))
            .map((id) => photoListForBg.find((p) => p.id === id))
            .filter((p): p is Photo => Boolean(p))}
        />
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>{eventName}</span>
      </div>

      <div
        // Spread-level drop target. HTML5 drop here = +1 layout (legacy).
        // The universal pointer-drag hit-tests data-ff-bgzone: dropping
        // a photo on the empty/matted area sets it as the blurred bg.
        data-ff-bgzone
        data-ff-bgspread={spread.id}
        onDragOver={spreadDropHandlers(spread.id).onDragOver}
        onDrop={spreadDropHandlers(spread.id).onDrop}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${aspect}`,
          background: bgFillColor(bg), // paper / chosen colour
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {/* Blurred-photo background layer (Phase 2). Sits behind slots,
            blurred + dimmed; zoom hard-capped at 200% per owner. */}
        {bg.mode === 'photo' && bg.photoId && (() => {
          const bgPhoto = photoListForBg.find((p) => p.id === bg.photoId)
          if (!bgPhoto) return null
          const z = Math.min(BG_PHOTO_MAX_ZOOM, Math.max(1, bg.zoom ?? 1))
          return (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgPhoto.preview}
                alt=""
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${bg.panX ?? 50}% ${bg.panY ?? 50}%`,
                  transform: `scale(${z})`,
                  filter: `blur(${bg.blur ?? DEFAULT_BG_BLUR}px)`,
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `rgba(0,0,0,${bg.dim ?? 0.25})`,
                  pointerEvents: 'none',
                }}
              />
            </>
          )
        })()}
        {rslots.map((slot, i) => {
          const id = spread.photoIds[i]
          const photo = id ? photoMap.get(id) : undefined
          const editing = editingSlot === i
          const adj = adjusts[adjustKey(spread.id, i)] ?? DEFAULT_ADJUST
          const slotAdjust: SlotAdjust = {
            panX: adj.panX,
            panY: adj.panY,
            zoom: adj.zoom,
            rotate: adj.rotate,
            flipH: adj.flipH,
            flipV: adj.flipV,
          }
          // Slot-level DnD: each slot is BOTH draggable (drag a photo
          // to another slot to swap) AND a drop target (drop a slot
          // photo or unused thumbnail here to swap).
          // Only photo-bearing slots are draggable — empty slots can
          // still receive drops but you can't drag from them.
          const slotDH = slotDragHandlers(spread.id, i)
          return (
            <div
              key={i}
              data-ff-spread={spread.id}
              data-ff-slot={i}
              onClick={(e) => {
                e.stopPropagation()
                onPhotoClick(i)
              }}
              draggable={!!photo}
              onDragStart={photo ? slotDH.onDragStart : undefined}
              onDragOver={slotDH.onDragOver}
              onDrop={(e) => {
                slotDH.onDrop(e)
                // Stop the spread-level drop from also firing
                e.stopPropagation()
              }}
              onDragEnd={slotDH.onDragEnd}
              style={{
                position: 'absolute',
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                // +1px on width/height so adjacent full-bleed slots overlap
                // by a hairline instead of leaving a sub-pixel seam that
                // reveals the white page between photos. Invisible in
                // matted layouts (it just grows 1px into the mat gap).
                width: `calc(${slot.w}% + 1px)`,
                height: `calc(${slot.h}% + 1px)`,
                cursor: photo ? 'grab' : 'pointer',
                outline: editing ? `2px solid ${GOLD}` : 'none',
                outlineOffset: -2,
                overflow: 'hidden',
                // Transparent (not cream): any residual sub-pixel gap shows
                // the spread background, never a contrasting white line.
                background: photo ? 'transparent' : '#f5f0e8',
              }}
              title={slot.isHero ? 'Hero photo · drag to swap' : 'Photo · drag to swap'}
            >
              {photo ? (
                <>
                  <SlotImage
                    src={photo.preview}
                    adjust={slotAdjust}
                    fit={adj.fit}
                    // Overscan ~2px each side so the photo ALWAYS fully
                    // covers its slot — kills the hairline margin the
                    // owner kept seeing. Clipped by the slot's overflow.
                    style={{
                      width: 'calc(100% + 4px)',
                      height: 'calc(100% + 4px)',
                      margin: '-2px',
                    }}
                    // No onAdjustChange → SlotImage's pointer capture is
                    // disabled, leaving HTML5 drag-to-swap unblocked. Pan
                    // and zoom continue to work via the toolbar sliders.
                  />
                  {adj.borderWidth > 0 ? (
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        border: `${(adj.borderWidth / 10) * 16}px solid ${adj.borderColor}`,
                        boxSizing: 'border-box',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : matFrame ? (
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        border: `1.5px solid ${matFrame}`,
                        boxSizing: 'border-box',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : null}
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
                        pointerEvents: 'none',
                      }}
                    >
                      Hero
                    </span>
                  )}
                </>
              ) : (
                // Empty slot: dashed gold border + "+ Add" hint.
                // Drop targets work the same as filled slots (above).
                // Click → if a photo is "picked up" (tap-to-place), drop
                // it into this empty slot; otherwise open the upload /
                // pick-from-unused picker.
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    if (placementArmed) {
                      onPhotoClick(i)
                    } else {
                      onEmptySlotClick(i)
                    }
                  }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: '#f5f0e8',
                    border: `1.5px dashed rgba(184,150,90,0.5)`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    color: GOLD,
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#ede5d3')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#f5f0e8')}
                  title="Click to upload or pick from unused · Or drag a photo here"
                >
                  <span style={{ fontSize: 28, fontWeight: 300, lineHeight: 1 }}>+</span>
                  <span style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
                    Add photo
                  </span>
                </div>
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
              background: 'rgba(0,0,0,0.18)',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* Always-on guide: ONLY the spread centre line (editor only,
            never printed). The page-centre (25% / 75%) + horizontal
            guides are transient — they appear while dragging text and
            disappear when you let go (rendered inside SpreadTextLayer). */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 0,
            borderLeft: '1px dashed rgba(184,150,90,0.28)',
            transform: 'translateX(-0.5px)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
        <SpreadTextLayer texts={texts} onChange={onTextsChange} />
      </div>

      {/* Photo edit toolbar (full set, mirrors manual builder) */}
      {editingSlot >= 0 && (() => {
        const editAdj = adjusts[adjustKey(spread.id, editingSlot)] ?? DEFAULT_ADJUST
        const editPhotoId = spread.photoIds[editingSlot]
        const editPhoto = editPhotoId ? photoMap.get(editPhotoId) : undefined
        const editSlotDef = rslots[editingSlot]
        // Smart cap: how far THIS photo can zoom in THIS slot at THIS
        // album size before dropping under 200 DPI.
        const cap =
          editPhoto && editSlotDef
            ? smartMaxZoom(editPhoto, editSlotDef, albumSize)
            : GLOBAL_MAX_ZOOM
        const cd =
          editPhoto && editSlotDef ? coverDpi(editPhoto, editSlotDef, albumSize) : 0
        const effDpi = cd > 0 ? Math.round(cd / Math.max(1, editAdj.zoom)) : 0
        return (
          <PhotoToolbar
            adj={editAdj}
            onChange={(patch) => onAdjustChange(editingSlot, patch)}
            onSwap={() => onStartSwap(editingSlot)}
            onReset={() => onResetAdjust(editingSlot)}
            onRemove={() => onRemovePhoto(editingSlot)}
            slotIdx={editingSlot}
            inSwapMode={swappingSlot === editingSlot}
            maxZoom={cap}
            effDpi={effDpi}
          />
        )
      })()}
    </div>
    </div>
  )
}

// ============== PHOTO TOOLBAR ==============
// Mirrors the manual builder's photoFloatToolbar: zoom, pan, fit-fill /
// fit-original, flip H/V, rotate ±90°, reset, swap, remove.

function PhotoToolbar({
  adj,
  onChange,
  onSwap,
  onReset,
  onRemove,
  slotIdx,
  inSwapMode,
  maxZoom,
  effDpi,
}: {
  adj: PhotoAdjust
  onChange: (patch: Partial<PhotoAdjust>) => void
  onSwap: () => void
  onReset: () => void
  onRemove: () => void
  slotIdx: number
  inSwapMode: boolean
  /** Smart per-photo zoom ceiling (keeps ≥200 DPI at this album size). */
  maxZoom: number
  /** Effective print DPI at the current zoom (for the quality badge). */
  effDpi: number
}) {
  // Slider/buttons never let the customer zoom past the smart cap.
  const zCap = Math.max(1, maxZoom)
  const dpiColor = effDpi >= 200 ? '#7fd18f' : effDpi >= 150 ? '#e0b15a' : '#ff8a8a'
  const dpiLabel = effDpi >= 200 ? 'Sharp' : effDpi >= 150 ? 'OK' : 'Soft'
  const btn: React.CSSProperties = {
    background: 'transparent',
    border: '0.5px solid rgba(184,150,90,0.35)',
    color: GOLD,
    fontSize: 10,
    padding: '6px 10px',
    borderRadius: 30,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    letterSpacing: 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }
  const btnActive: React.CSSProperties = { ...btn, background: GOLD, color: '#0e0c09', borderColor: GOLD }
  const btnDanger: React.CSSProperties = { ...btn, color: '#ff8a8a', borderColor: 'rgba(255,138,138,0.45)' }
  const groupLabel: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: 1.5,
    color: 'var(--muted2)',
    textTransform: 'uppercase',
    marginRight: 4,
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 10,
        padding: '14px 16px',
        background: 'var(--dark3)',
        border: `0.5px solid ${inSwapMode ? GOLD : 'rgba(184,150,90,0.25)'}`,
        borderRadius: 8,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 9, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>
          Slot {slotIdx + 1} · Photo tools
        </span>

        {/* FIT mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Fit</span>
          <button type="button" style={adj.fit === 'fill' ? btnActive : btn} onClick={() => onChange({ fit: 'fill' })}>
            Fill
          </button>
          <button type="button" style={adj.fit === 'contain' ? btnActive : btn} onClick={() => onChange({ fit: 'contain' })}>
            Original
          </button>
        </div>

        {/* ZOOM — smart-capped so it never pixelates at print */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Zoom</span>
          <button
            type="button"
            style={btn}
            onClick={() => onChange({ zoom: Math.max(1, +(adj.zoom - 0.1).toFixed(2)) })}
          >
            −
          </button>
          <input
            type="range"
            min="100"
            max={Math.round(zCap * 100)}
            step="5"
            value={Math.round(Math.min(adj.zoom, zCap) * 100)}
            onChange={(e) =>
              onChange({ zoom: Math.min(zCap, parseInt(e.target.value) / 100) })
            }
            style={{ width: 100, accentColor: GOLD }}
          />
          <button
            type="button"
            style={btn}
            onClick={() =>
              onChange({ zoom: Math.min(zCap, +(adj.zoom + 0.1).toFixed(2)) })
            }
          >
            +
          </button>
          <span style={{ fontSize: 10, color: GOLD, minWidth: 42, textAlign: 'center' }}>
            {Math.round(adj.zoom * 100)}%
          </span>
          {/* Live print-quality badge + smart cap note */}
          {effDpi > 0 && (
            <span
              title={`Effective ${effDpi} DPI at this zoom. Zoom is auto-limited to ${Math.round(
                zCap * 100,
              )}% so this photo stays at least 200 DPI at this album size.`}
              style={{
                fontSize: 9,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: dpiColor,
                border: `0.5px solid ${dpiColor}`,
                borderRadius: 30,
                padding: '2px 8px',
              }}
            >
              {effDpi} DPI · {dpiLabel}
            </span>
          )}
          {zCap < GLOBAL_MAX_ZOOM && (
            <span style={{ fontSize: 9, color: 'var(--muted2)' }}>
              max {Math.round(zCap * 100)}%
            </span>
          )}
        </div>

        {/* FLIP */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Flip</span>
          <button
            type="button"
            style={adj.flipH ? btnActive : btn}
            title="Flip horizontal"
            onClick={() => onChange({ flipH: !adj.flipH })}
          >
            ⇄
          </button>
          <button
            type="button"
            style={adj.flipV ? btnActive : btn}
            title="Flip vertical"
            onClick={() => onChange({ flipV: !adj.flipV })}
          >
            ⇅
          </button>
        </div>

        {/* ROTATE — buttons handle the big 90° jumps; slider is a fine-
            tune ±15° around the current coarse angle. Splitting like this
            means a small slider drag only tilts a tiny amount (good for
            straightening a horizon) instead of rotating dramatically. */}
        {(() => {
          const total = adj.rotate ?? 0
          // Nearest 90° "coarse" component; remainder is the fine tilt.
          const coarse = Math.round(total / 90) * 90
          const fine = total - coarse
          const displayTotal = (((Math.round(total) % 360) + 540) % 360) - 180
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={groupLabel}>Rotate</span>
              <button
                type="button"
                style={btn}
                title="Rotate left 90°"
                onClick={() => onChange({ rotate: total - 90 })}
              >
                ↺
              </button>
              <button
                type="button"
                style={btn}
                title="Rotate right 90°"
                onClick={() => onChange({ rotate: total + 90 })}
              >
                ↻
              </button>
              <span style={{ fontSize: 9, color: 'var(--muted2)', marginLeft: 4 }}>fine</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={1}
                value={Math.round(Math.max(-15, Math.min(15, fine)))}
                onChange={(e) => onChange({ rotate: coarse + parseInt(e.target.value) })}
                title="Fine tilt — ±15°"
                style={{ width: 90, accentColor: GOLD }}
              />
              <button
                type="button"
                style={btn}
                title="Reset to 0°"
                onClick={() => onChange({ rotate: 0 })}
              >
                0°
              </button>
              <span style={{ fontSize: 10, color: GOLD, minWidth: 38, textAlign: 'right' }}>
                {displayTotal}°
              </span>
            </div>
          )
        })()}

        {/* BORDER — photo frame: thickness 0-10 + colour */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={groupLabel}>Border</span>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={adj.borderWidth ?? 0}
            onChange={(e) => onChange({ borderWidth: parseInt(e.target.value) })}
            style={{ width: 84, accentColor: GOLD }}
          />
          <span style={{ fontSize: 10, color: GOLD, minWidth: 22, textAlign: 'center' }}>
            {adj.borderWidth ?? 0}
          </span>
          <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
            {BORDER_PALETTE.map((c) => {
              const on = (adj.borderColor ?? '#ffffff') === c.hex
              return (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() =>
                    onChange({
                      borderColor: c.hex,
                      // turning a colour on with no thickness yet → give it one
                      borderWidth: (adj.borderWidth ?? 0) === 0 ? 4 : adj.borderWidth,
                    })
                  }
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background: c.hex,
                    cursor: 'pointer',
                    border: on ? `2px solid ${GOLD}` : '0.5px solid rgba(184,150,90,0.4)',
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* PAN sliders (only meaningful when fit=fill).
          Sliders are in SCREEN coordinates — "X" always moves left/right on
          screen, "Y" always moves up/down. When the image is rotated 90°/180°/
          270°, internally we map screen-X/Y to the image's coordinate axes so
          the pan still matches what the user sees. */}
      {adj.fit === 'fill' && (() => {
        // Snap to nearest 90° step for axis mapping. Fine tilts (e.g. ±15°)
        // map to step 0 — pan stays in image coords, which is close enough to
        // visual coords for small angles.
        const r = ((Math.round(adj.rotate ?? 0) % 360) + 360) % 360
        const step = Math.round(r / 90) % 4
        // imageToScreen: convert stored image-coord pan → what the user sees.
        // screenToImage: convert slider value → image-coord pan to store.
        const inv = (v: number) => 100 - v
        const imageToScreen = (px: number, py: number) => {
          switch (step) {
            case 1: return { sx: inv(py), sy: px }       // 90° CW
            case 2: return { sx: inv(px), sy: inv(py) }  // 180°
            case 3: return { sx: py, sy: inv(px) }       // 270° CW
            default: return { sx: px, sy: py }
          }
        }
        const screenToImage = (sx: number, sy: number) => {
          switch (step) {
            case 1: return { px: sy, py: inv(sx) }
            case 2: return { px: inv(sx), py: inv(sy) }
            case 3: return { px: inv(sy), py: sx }
            default: return { px: sx, py: sy }
          }
        }
        const { sx, sy } = imageToScreen(adj.panX, adj.panY)
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
            <span style={groupLabel}>Pan</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--cream)' }}>X</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(sx)}
                onChange={(e) => {
                  const newSx = parseInt(e.target.value)
                  const { px, py } = screenToImage(newSx, sy)
                  onChange({ panX: px, panY: py })
                }}
                style={{ width: 100, accentColor: GOLD }}
              />
              <span style={{ fontSize: 9, color: 'var(--muted2)', minWidth: 32, textAlign: 'right' }}>
                {Math.round(sx)}%
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--cream)' }}>Y</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(sy)}
                onChange={(e) => {
                  const newSy = parseInt(e.target.value)
                  const { px, py } = screenToImage(sx, newSy)
                  onChange({ panX: px, panY: py })
                }}
                style={{ width: 100, accentColor: GOLD }}
              />
              <span style={{ fontSize: 9, color: 'var(--muted2)', minWidth: 32, textAlign: 'right' }}>
                {Math.round(sy)}%
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--muted2)', fontStyle: 'italic' }}>
              tip: zoom in first to see pan have more effect
            </span>
          </div>
        )
      })()}

      {/* ACTIONS */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 6, borderTop: '0.5px solid rgba(184,150,90,0.15)' }}>
        <button type="button" style={btn} onClick={onReset}>
          ↺ Reset adjustments
        </button>
        <button
          type="button"
          style={inSwapMode ? btnActive : btn}
          onClick={onSwap}
          title="Pick a different photo from the unused pool"
        >
          {inSwapMode ? 'Swap mode active — pick from pool →' : '⇄ Swap photo'}
        </button>
        <button type="button" style={btnDanger} onClick={onRemove} title="Remove from spread (photo returns to unused pool)">
          ✕ Remove
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────
 * NEW-CLIENT EMAIL GATE
 *
 * Before anyone can use the designer they register with name + email +
 * phone and verify the email with a 6-digit code. This both protects
 * the tool and gives the owner a list of every lead.
 * ──────────────────────────────────────────────────────────────────── */

const FF_CLIENT_LS = 'ff_client_v1'

function ClientRegister({ onVerified }: { onVerified: (name: string) => void }) {
  const [phase, setPhase] = useState<'form' | 'code'>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resentAt, setResentAt] = useState(0)

  const sendCode = async () => {
    setError('')
    if (!name.trim()) return setError('Please enter your name')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError('Please enter a valid email address')
    if (phone.replace(/\D/g, '').length < 7)
      return setError('Please enter a valid phone number')
    setBusy(true)
    try {
      const r = await fetch('/api/client/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (!j.ok) {
        setError(j.error || 'Could not send the code. Please try again.')
      } else {
        setPhase('code')
        setResentAt(Date.now())
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setError('')
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code')
    setBusy(true)
    try {
      const r = await fetch('/api/client/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      const j = (await r.json()) as { ok: boolean; name?: string; error?: string }
      if (!j.ok) {
        setError(j.error || 'Invalid code.')
      } else {
        try {
          window.localStorage.setItem(
            FF_CLIENT_LS,
            JSON.stringify({ name: j.name || name, email: email.trim().toLowerCase() }),
          )
        } catch {
          /* ignore */
        }
        onVerified(j.name || name)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const wrap: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0e0c09',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  }
  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 440,
    background: '#1a1611',
    border: '1px solid rgba(184,150,90,0.25)',
    borderRadius: 16,
    padding: 36,
  }
  const input: React.CSSProperties = {
    width: '100%',
    background: '#0e0c09',
    border: '1px solid rgba(184,150,90,0.3)',
    borderRadius: 9,
    padding: '12px 14px',
    color: 'var(--cream)',
    fontSize: 14,
    fontFamily: 'var(--font-body)',
    marginBottom: 12,
    boxSizing: 'border-box',
  }
  const primary: React.CSSProperties = {
    width: '100%',
    background: GOLD,
    color: '#0e0c09',
    border: 'none',
    borderRadius: 30,
    padding: '13px 0',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <p style={{ fontSize: 11, letterSpacing: 3, color: GOLD, textTransform: 'uppercase', margin: '0 0 14px' }}>
          Folio &amp; Forever
        </p>
        {phase === 'form' ? (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)', margin: '0 0 8px' }}>
              Let&apos;s start your album
            </h1>
            <p style={{ fontSize: 13, color: 'var(--muted2)', lineHeight: 1.6, margin: '0 0 22px' }}>
              Quick sign-up so we can save your design and send your proof. We&apos;ll email you a code to confirm your address.
            </p>
            <input
              style={input}
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <input
              style={input}
              placeholder="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              style={input}
              placeholder="Phone number"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
            {error && (
              <p style={{ color: '#ff8a8a', fontSize: 12, margin: '4px 0 14px' }}>{error}</p>
            )}
            <button style={primary} disabled={busy} onClick={sendCode}>
              {busy ? 'Sending…' : 'Send verification code'}
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--cream)', margin: '0 0 8px' }}>
              Check your email
            </h1>
            <p style={{ fontSize: 13, color: 'var(--muted2)', lineHeight: 1.6, margin: '0 0 22px' }}>
              We sent a 6-digit code to <strong style={{ color: 'var(--cream)' }}>{email}</strong>. Enter it below.
            </p>
            <input
              style={{ ...input, letterSpacing: 8, textAlign: 'center', fontSize: 22 }}
              placeholder="••••••"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {error && (
              <p style={{ color: '#ff8a8a', fontSize: 12, margin: '4px 0 14px' }}>{error}</p>
            )}
            <button style={primary} disabled={busy} onClick={verify}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => {
                  setPhase('form')
                  setCode('')
                  setError('')
                }}
                style={{ background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 11, cursor: 'pointer' }}
              >
                ← Change details
              </button>
              <button
                type="button"
                disabled={busy || Date.now() - resentAt < 20000}
                onClick={sendCode}
                style={{
                  background: 'none',
                  border: 'none',
                  color: Date.now() - resentAt < 20000 ? 'var(--muted2)' : GOLD,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Resend code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function SmartDesignerPage() {
  const [gate, setGate] = useState<'checking' | 'need' | 'ok'>('checking')

  useEffect(() => {
    let cancelled = false
    // Fast path: a verified flag in localStorage unlocks instantly.
    try {
      if (window.localStorage.getItem(FF_CLIENT_LS)) {
        setGate('ok')
        return
      }
    } catch {
      /* ignore */
    }
    // Otherwise ask the server if a valid signed cookie exists.
    fetch('/api/client/session')
      .then((r) => r.json())
      .then((j: { ok?: boolean }) => {
        if (cancelled) return
        setGate(j && j.ok ? 'ok' : 'need')
      })
      .catch(() => {
        if (!cancelled) setGate('need')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (gate === 'checking') {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0e0c09',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#b8965a',
          fontSize: 12,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        Loading…
      </div>
    )
  }

  if (gate === 'need') {
    return <ClientRegister onVerified={() => setGate('ok')} />
  }

  return <SmartDesignerInner />
}
