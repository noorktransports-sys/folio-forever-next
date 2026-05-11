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

/** POST a blob to the existing /api/upload endpoint. */
export async function uploadToR2(
  blob: Blob,
  designId: string,
  filename: string,
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('designId', designId)
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: string }
      detail = j.error ?? ''
    } catch {
      /* ignore */
    }
    throw new Error(`Upload failed (${res.status})${detail ? ': ' + detail : ''}`)
  }
  return (await res.json()) as UploadResult
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
  onProgress,
}: SubmissionInput): Promise<{
  photos: PhotoUploadResult[]
  spreadComposites: SpreadCompositeResult[]
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

  // ─── Pass 1: per-photo originals + watermarked previews ─────────────
  for (const p of photos) {
    onProgress?.(done, total, `Uploading photo ${done + 1} of ${photoSteps}`)

    // 1. Get the source blob
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

    // 2. Upload original
    const origUpload = await uploadToR2(source, designId, `${p.id}-orig.jpg`)

    // 3. Generate + 4. upload preview (watermarked, compressed)
    const previewBlob = await makePreviewBlob(source)
    const previewUpload = await uploadToR2(
      previewBlob,
      designId,
      `${p.id}-preview.jpg`,
    )

    photoResults.push({
      photoId: p.id,
      originalKey: origUpload.key,
      originalUrl: origUpload.url,
      previewKey: previewUpload.key,
      previewUrl: previewUpload.url,
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
    onProgress?.(done, total, `Uploaded ${done}/${photoSteps} photos`)
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

  return { photos: photoResults, spreadComposites: composites }
}
