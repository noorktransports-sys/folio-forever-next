// src/app/design/smart/edit/submit-helpers.ts
//
// End-of-flow helpers for the smart wizard's Submit step:
//
//   makePreviewBlob   — Canvas-based downscale + watermark + JPEG encode.
//                       Used to generate client-friendly previews that are
//                       readable but useless for printing.
//
//   uploadToR2        — POST a blob to /api/upload (existing endpoint),
//                       scoped under the order's designId.
//
//   prepareSubmission — orchestrates the above for every photo in the album.
//                       Yields progress so the UI can show a live percentage.

import { loadAlbumBlobs } from './photo-blob-store'
import { renderSpreadComposite } from './render-spread'
import { renderCoverComposite } from './render-cover'

/* ─── Image processing ──────────────────────────────────────────────── */

const PREVIEW_MAX_DIM = 1200     // long edge for client preview
const PREVIEW_QUALITY = 0.65     // JPEG quality 0..1
const WATERMARK_TEXT = 'FOLIO & FOREVER · PREVIEW'

/**
 * Generate a small, watermarked JPEG from a source File/Blob using Canvas.
 * Returns a new Blob; never mutates the input. Watermark is a single
 * diagonal line of repeated text at low opacity so the preview is readable
 * but unusable for print.
 *
 * Throws if Canvas isn't available (SSR) or the source can't be decoded.
 */
export async function makePreviewBlob(source: Blob): Promise<Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Canvas unavailable on server')
  }
  const bitmap = await createImageBitmap(source).catch(() => {
    // Fallback path for older browsers: use <img>
    return null
  })

  let width: number
  let height: number
  let drawSource: CanvasImageSource

  if (bitmap) {
    width = bitmap.width
    height = bitmap.height
    drawSource = bitmap
  } else {
    const url = URL.createObjectURL(source)
    try {
      drawSource = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Image decode failed'))
        img.src = url
      })
      width = (drawSource as HTMLImageElement).naturalWidth
      height = (drawSource as HTMLImageElement).naturalHeight
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Scale to PREVIEW_MAX_DIM on the long edge
  const scale = Math.min(1, PREVIEW_MAX_DIM / Math.max(width, height))
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context unavailable')

  // Draw the photo (scaled)
  ctx.drawImage(drawSource, 0, 0, w, h)
  if (bitmap) bitmap.close?.()

  // Diagonal watermark — three lines repeated across the image.
  const fontSize = Math.max(20, Math.round(Math.min(w, h) / 22))
  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.lineWidth = 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate(-Math.PI / 6) // ~-30°
  const lineGap = fontSize * 4
  for (let i = -2; i <= 2; i++) {
    const text = WATERMARK_TEXT
    ctx.strokeText(text, 0, i * lineGap)
    ctx.fillText(text, 0, i * lineGap)
  }
  ctx.restore()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error('Canvas toBlob returned null'))
        else resolve(b)
      },
      'image/jpeg',
      PREVIEW_QUALITY,
    )
  })
}

/* ─── R2 upload via existing /api/upload ────────────────────────────── */

export interface UploadResult {
  id: string         // r2 nanoid filename
  key: string        // full r2 key: designs/{designId}/{id}.{ext}
  url: string        // public proxy URL: /api/photo/...
  size: number
  contentType: string
}

/**
 * POST a blob to /api/upload. Retries on transient failures (5xx and
 * network errors) up to 3 times with exponential backoff so a single
 * R2 hiccup doesn't blow up the whole submit. 4xx (413 too-large,
 * 415 wrong-type, 400 bad-form) are NOT retried — they're real
 * client errors and retrying won't help.
 */
export async function uploadToR2(
  blob: Blob,
  designId: string,
  filename: string,
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('designId', designId)

  const MAX_TRIES = 3
  let lastErr: Error | null = null

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let res: Response
    try {
      res = await fetch('/api/upload', { method: 'POST', body: form })
    } catch (e) {
      // Network error (offline, DNS, dropped connection) — retry.
      lastErr = e instanceof Error ? e : new Error('network error')
      if (attempt < MAX_TRIES) {
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      throw new Error(`Upload failed (network): ${lastErr.message} — file: ${filename}`)
    }

    if (res.ok) {
      return (await res.json()) as UploadResult
    }

    // Pull the JSON error detail if any. The server now wraps R2 errors
    // and returns proper JSON, so this should almost always have detail.
    let detail = ''
    try {
      const j = (await res.json()) as { error?: string }
      detail = j.error ?? ''
    } catch {
      /* server returned non-JSON (bare 5xx from a worker crash) */
    }

    // 4xx = client error, don't retry — re-export the file or fix the
    // input. 5xx = transient server error, retry with backoff.
    const isClientError = res.status >= 400 && res.status < 500
    if (isClientError || attempt === MAX_TRIES) {
      throw new Error(
        `Upload failed (${res.status})${detail ? ': ' + detail : ''} — file: ${filename}`,
      )
    }
    // Transient — back off and retry.
    await new Promise((r) => setTimeout(r, 400 * attempt))
  }

  // Unreachable, but TS wants a definite return path.
  throw lastErr ?? new Error('Upload failed after retries')
}

/* ─── Orchestrator ──────────────────────────────────────────────────── */

export interface PhotoUploadResult {
  photoId: string
  /** Original (high-resolution, no watermark) — for print + admin */
  originalKey: string
  originalUrl: string
  /** Preview (compressed, watermarked) — for customer-facing email */
  previewKey: string
  previewUrl: string
  width: number
  height: number
}

export interface SpreadCompositeResult {
  spreadId: string
  key: string
  url: string
}

export interface SubmissionInput {
  albumId: string
  designId: string
  photos: Array<{
    id: string
    /** External (https) preview URL — used for sample photos to skip upload */
    preview: string
    width: number
    height: number
  }>
  /** Spreads to render as composite previews. Optional — if absent we
   *  skip composite rendering and the email won't have layout pictures. */
  spreads?: Array<{
    id: string
    templateId: string
    photoIds: (string | null)[]
  }>
  /** Lookup `templateId` → slots + name. Caller passes the TEMPLATES map. */
  templates?: Map<
    string,
    {
      id: string
      name: string
      slots: { x: number; y: number; w: number; h: number; isHero?: boolean }[]
    }
  >
  /** Per-slot adjustments keyed `${spreadId}::${slotIdx}` */
  adjusts?: Record<
    string,
    {
      zoom: number
      panX: number
      panY: number
      flipH: boolean
      flipV: boolean
      rotate: number
      fit: 'fill' | 'contain'
    }
  >
  /** Album spread aspect (e.g. 24/17 for 17×24). Required if composites are rendered. */
  spreadAspectRatio?: number
  /** Whether to draw the gutter line (standard = true, layflat = false). */
  showGutter?: boolean
  /** Per-spread backgrounds keyed by spread id (paper/color/photo). So
   *  the rendered composite matches the editor (proof = print). */
  spreadBgs?: Record<
    string,
    {
      mode: 'paper' | 'color' | 'photo'
      color?: string
      photoId?: string
      blur?: number
      dim?: number
      zoom?: number
      panX?: number
      panY?: number
    }
  >
  /** Per-spread free text blocks keyed by spread id. Baked into the
   *  composite so the printed album matches the approved proof. */
  spreadTexts?: Record<
    string,
    Array<{
      id: string
      text: string
      xPct: number
      yPct: number
      widthPct: number
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
    }>
  >
  /** Cover spec — rendered to a flat JPEG (front, + back for photo
   *  covers) so the proof + emails SHOW the cover. */
  cover?: {
    type: 'leather' | 'acrylic' | 'photo'
    leatherColor: string
    foilColor: string
    customTextHex: string
    fontId: string
    fontSize: number
    primaryText: string
    subtitleText: string
    position: string
    photoSrc: string | null
    backPhotoSrc: string | null
    photoScale: number
    photoX: number
    photoY: number
    titleX?: number
    titleY?: number
  } | null
  /** Print-quality target for spread composites — long edge in pixels.
   *  Caller passes album_long_inch × 200 (DPI). Falls back to the
   *  renderer's default preview size when omitted. */
  printSpreadLongEdgePx?: number
  /** Print-quality target for cover composite — height in pixels.
   *  Caller passes cover_face_height_inch × 200 (DPI). */
  printCoverLongEdgePx?: number
  /**
   * Whether to upload the per-photo ORIGINALS + watermarked previews
   * to R2. The composites (which is what the print lab actually
   * receives) bake every photo in already — so for standard orders
   * uploading the raw originals on top is pure waste of bandwidth +
   * R2 storage. Default: FALSE.
   *
   * Pass TRUE only when the polish-handoff add-on is on: the design
   * team needs the originals to re-crop / re-pace / fine-tune. The
   * client already paid $99 to opt into that work, so we accept the
   * extra upload time only in that path.
   */
  uploadOriginals?: boolean
  /** Called as each photo finishes; total = photos.length */
  onProgress?: (done: number, total: number, label: string) => void
}

/**
 * For each photo:
 *   1. Read the original blob from IndexedDB (or fetch the sample URL).
 *   2. Upload the original to R2 → originalKey.
 *   3. Generate a watermarked preview via Canvas.
 *   4. Upload the preview to R2 → previewKey.
 *
 * Returns the array of upload results in the same order as input.
 * Throws if any individual photo fails; caller can retry. Photos that
 * skip IDB (sample photos with stable HTTPS URLs) are downloaded once
 * via fetch.
 */
export async function prepareSubmission({
  albumId,
  designId,
  photos,
  spreads,
  templates,
  adjusts,
  spreadAspectRatio,
  showGutter,
  spreadBgs,
  spreadTexts,
  cover,
  printSpreadLongEdgePx,
  printCoverLongEdgePx,
  uploadOriginals = false,
  onProgress,
}: SubmissionInput): Promise<{
  photos: PhotoUploadResult[]
  spreadComposites: SpreadCompositeResult[]
  coverFrontUrl: string | null
  coverBackUrl: string | null
}> {
  // Hydrate uploaded photo blobs from IDB so we can read the originals.
  // Sample photos won't be in IDB — we fetch their HTTPS URL instead.
  const idbBlobs = await loadAlbumBlobs(albumId)
  const photoResults: PhotoUploadResult[] = []
  const composites: SpreadCompositeResult[] = []

  // Photo lookup that the spread composite renderer can use later.
  // We rebuild it as we go (mapping photoId → loaded preview).
  const photoLookup = new Map<
    string,
    { id: string; preview: string; width: number; height: number }
  >()

  const photoSteps = photos.length
  const spreadSteps = spreads && templates && spreadAspectRatio ? spreads.length : 0
  const total = photoSteps + spreadSteps
  let done = 0

  // ─── Pass 1: per-photo source load (+ optional R2 upload) ─────────
  // For every order we have to LOAD the photo blobs locally so the
  // spread composite renderer (Pass 2) can draw them onto the canvas.
  // What's OPTIONAL is uploading those originals to R2: the printed
  // album only needs the composites, so by default we skip that and
  // save the bandwidth / R2 storage. The polish-handoff add-on flips
  // `uploadOriginals` on so the design team has the raw files.
  for (const p of photos) {
    const verb = uploadOriginals
      ? `Uploading photo ${done + 1} of ${photoSteps}`
      : `Loading photo ${done + 1} of ${photoSteps}`
    onProgress?.(done, total, verb)

    // 1. Load the source blob (always — needed for composite render)
    let source: Blob
    const idbUrl = idbBlobs.get(p.id)
    if (idbUrl) {
      const r = await fetch(idbUrl)
      source = await r.blob()
    } else {
      // HTTPS sample OR a still-alive blob: URL from the current session
      const r = await fetch(p.preview)
      source = await r.blob()
    }

    // 2. (Conditional) upload original + watermarked preview to R2.
    let originalKey = ''
    let originalUrl = ''
    let previewKey = ''
    let previewUrl = ''
    if (uploadOriginals) {
      const origUpload = await uploadToR2(source, designId, `${p.id}-orig.jpg`)
      originalKey = origUpload.key
      originalUrl = origUpload.url
      const previewBlob = await makePreviewBlob(source)
      const previewUpload = await uploadToR2(
        previewBlob,
        designId,
        `${p.id}-preview.jpg`,
      )
      previewKey = previewUpload.key
      previewUrl = previewUpload.url
    }

    photoResults.push({
      photoId: p.id,
      originalKey,
      originalUrl,
      previewKey,
      previewUrl,
      width: p.width,
      height: p.height,
    })
    // Save the LOCAL preview URL so spread compositing can use it without
    // re-fetching (faster + avoids CORS issues with the R2 public proxy).
    photoLookup.set(p.id, {
      id: p.id,
      preview: URL.createObjectURL(source),
      width: p.width,
      height: p.height,
    })
    done++
    onProgress?.(
      done,
      total,
      uploadOriginals
        ? `Uploaded ${done}/${photoSteps} photos`
        : `Loaded ${done}/${photoSteps} photos`,
    )
  }

  // ─── Pass 2: per-spread composite renders ──────────────────────────
  if (spreads && templates && spreadAspectRatio !== undefined && spreadSteps > 0) {
    for (let i = 0; i < spreads.length; i++) {
      const s = spreads[i]
      onProgress?.(done, total, `Rendering spread ${i + 1} of ${spreadSteps}`)
      const tpl = templates.get(s.templateId)
      if (!tpl) {
        done++
        continue
      }
      try {
        const blob = await renderSpreadComposite({
          spread: s,
          template: tpl,
          photos: photoLookup,
          adjusts: adjusts ?? {},
          spreadAspectRatio,
          showGutter: !!showGutter,
          bg: spreadBgs?.[s.id],
          texts: spreadTexts?.[s.id],
          outputLongEdgePx: printSpreadLongEdgePx,
        })
        const up = await uploadToR2(blob, designId, `${s.id}-spread.jpg`)
        composites.push({ spreadId: s.id, key: up.key, url: up.url })
      } catch (err) {
        console.warn('[submit-helpers] composite render failed for spread', s.id, err)
        // Continue — partial composite set is still useful.
      }
      done++
      onProgress?.(done, total, `Rendered ${composites.length}/${spreadSteps} spreads`)
    }
  }

  // ─── Cover composite (front, + back for photo covers) ──────────────
  let coverFrontUrl: string | null = null
  let coverBackUrl: string | null = null
  if (cover) {
    onProgress?.(total, total, 'Rendering cover')
    // The cover composite renders RIGHT NOW (still in this browser
    // session), so any of these source forms work as long as the
    // canvas can fetch them:
    //   1) An R2 URL we just uploaded (uploadOriginals=true path), or
    //   2) The local blob URL the submit-helpers just rebuilt for
    //      every photo (always available in photoLookup), or
    //   3) The page's own blob URL (still alive — this session).
    // Prefer the R2 URL when present so the saved cover.photoSrc is
    // long-lived; otherwise fall back to the local blob URL so the
    // composite still renders even when uploadOriginals=false.
    const prevToFinal = new Map<string, string>()
    for (const p of photos) {
      const uploaded = photoResults.find((r) => r.photoId === p.id)
      const lookup = photoLookup.get(p.id)
      const final = uploaded?.originalUrl || lookup?.preview || p.preview
      prevToFinal.set(p.preview, final)
    }
    const rsv = (s: string | null) => (s ? prevToFinal.get(s) ?? s : null)
    cover = {
      ...cover,
      photoSrc: rsv(cover.photoSrc),
      backPhotoSrc: rsv(cover.backPhotoSrc),
    }
    try {
      const frontBlob = await renderCoverComposite({
        type: cover.type,
        side: 'front',
        leatherColor: cover.leatherColor,
        foilColor: cover.foilColor,
        customTextHex: cover.customTextHex,
        fontId: cover.fontId,
        fontSize: cover.fontSize,
        primaryText: cover.primaryText,
        subtitleText: cover.subtitleText,
        position: cover.position,
        photoSrc: cover.photoSrc,
        backPhotoSrc: cover.backPhotoSrc,
        photoScale: cover.photoScale,
        photoX: cover.photoX,
        photoY: cover.photoY,
        titleX: cover.titleX,
        titleY: cover.titleY,
        outputLongEdgePx: printCoverLongEdgePx,
      })
      const up = await uploadToR2(frontBlob, designId, 'cover-front.jpg')
      coverFrontUrl = up.url
    } catch (err) {
      console.warn('[submit-helpers] cover front render failed', err)
    }
    if (cover.type === 'photo') {
      try {
        const backBlob = await renderCoverComposite({
          type: cover.type,
          side: 'back',
          leatherColor: cover.leatherColor,
          foilColor: cover.foilColor,
          customTextHex: cover.customTextHex,
          fontId: cover.fontId,
          fontSize: cover.fontSize,
          primaryText: cover.primaryText,
          subtitleText: cover.subtitleText,
          position: cover.position,
          photoSrc: cover.photoSrc,
          backPhotoSrc: cover.backPhotoSrc,
          photoScale: cover.photoScale,
          photoX: cover.photoX,
          photoY: cover.photoY,
          outputLongEdgePx: printCoverLongEdgePx,
        })
        const up = await uploadToR2(backBlob, designId, 'cover-back.jpg')
        coverBackUrl = up.url
      } catch (err) {
        console.warn('[submit-helpers] cover back render failed', err)
      }
    }
  }

  return {
    photos: photoResults,
    spreadComposites: composites,
    coverFrontUrl,
    coverBackUrl,
  }
}
