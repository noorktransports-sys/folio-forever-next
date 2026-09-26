// src/lib/print-image.ts
//
// Memory-safe image loading + sanity checks for PRINT renders (magazine
// pages, album spreads, covers).
//
// Why: camera photos are ~24 MP. Decoding every one at full size onto a
// large GPU-backed canvas exhausts graphics memory on ordinary PCs part
// way through an order — photos then silently fail to draw (white frames)
// or the canvas context is lost (black pages). So for print we:
//   1. decode ONE photo at a time, immediately downscale it to the pixel
//      size the page actually needs, and free the full-size decode;
//   2. draw on CPU-backed canvases (willReadFrequently) — no GPU limits;
//   3. verify every filled frame really changed and the page is not
//      blank/lost, and THROW (never silently skip) so the caller can retry
//      the page or stop the order with a clear message.

export type PrintSource = {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Create a CPU-backed 2D canvas (avoids GPU memory limits + context loss). */
export function makePrintCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

type Full = { img: CanvasImageSource; w: number; h: number; close: () => void }

async function decodeFull(src: string): Promise<Full> {
  if (!src) throw new Error('Photo is missing')
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions)
      if (bmp.width && bmp.height) return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
      bmp.close()
    } catch {
      /* fall back to <img> below */
    }
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    if (/^https?:\/\//.test(src)) el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Photo failed to load'))
    el.src = src
  })
  try {
    await img.decode()
  } catch {
    /* onload already fired; drawImage will still work in most browsers */
  }
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('Photo failed to decode')
  return {
    img,
    w: img.naturalWidth,
    h: img.naturalHeight,
    close: () => {
      img.removeAttribute('src')
    },
  }
}

/**
 * Load `src` for print, downscaled so it is only as large as needed.
 * `scaleFor(naturalW, naturalH)` returns the draw scale the caller needs
 * (drawn px / natural px); anything ≥ 1 keeps full size. Retries, then
 * throws — never returns a silently broken image.
 */
export async function loadPrintImage(src: string, scaleFor: (w: number, h: number) => number, tries = 3): Promise<PrintSource> {
  let last: unknown = null
  for (let attempt = 0; attempt < tries; attempt++) {
    let full: Full | null = null
    try {
      full = await decodeFull(src)
      const need = scaleFor(full.w, full.h)
      // 10% head-room so pan/zoom edges stay sharp.
      const k = Math.min(1, Math.max(0.02, (Number.isFinite(need) ? need : 1) * 1.1))
      if (k >= 0.9) {
        const f = full
        full = null
        return { source: f.img, width: f.w, height: f.h, release: f.close }
      }
      const w = Math.max(1, Math.round(full.w * k))
      const h = Math.max(1, Math.round(full.h * k))
      const { canvas, ctx } = makePrintCanvas(w, h)
      ctx.drawImage(full.img, 0, 0, w, h)
      full.close()
      full = null
      // A decode that silently failed draws nothing → fully transparent.
      const probe = ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data
      const probe2 = ctx.getImageData(Math.floor(w / 4), Math.floor(h / 4), 1, 1).data
      if (probe[3] === 0 && probe2[3] === 0) throw new Error('Photo decoded empty')
      return {
        source: canvas,
        width: w,
        height: h,
        release: () => {
          canvas.width = 0
          canvas.height = 0
        },
      }
    } catch (e) {
      last = e
      full?.close()
      await sleep(350 * (attempt + 1))
    }
  }
  throw new Error(`A photo could not be prepared for print (${last instanceof Error ? last.message : 'unknown error'})`)
}

/** 5×5 grid of packed RGBA samples inside a box (10% inset). */
export function sampleBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = []
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const px = Math.min(cw - 1, Math.max(0, Math.round(x + w * (0.1 + 0.2 * i))))
      const py = Math.min(ch - 1, Math.max(0, Math.round(y + h * (0.1 + 0.2 * j))))
      const d = ctx.getImageData(px, py, 1, 1).data
      out.push(((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0)
    }
  }
  return out
}

/** True when drawing changed at least one sampled pixel. */
export function boxChanged(before: number[], after: number[]): boolean {
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return true
  return false
}

/** Throw if the page canvas was lost or came out blank/transparent. */
export function assertPageRendered(ctx: CanvasRenderingContext2D, label = 'Page'): void {
  const c = ctx as CanvasRenderingContext2D & { isContextLost?: () => boolean }
  if (c.isContextLost?.()) throw new Error(`${label} could not be drawn (graphics memory ran out)`)
  const s = sampleBox(ctx, 0, 0, ctx.canvas.width, ctx.canvas.height)
  if (s.every((v) => (v & 0xff) === 0)) throw new Error(`${label} came out blank`)
}

/** Run a render, retrying once after a short pause if it throws. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      await sleep(800)
    }
  }
  throw last instanceof Error ? last : new Error('Render failed')
}

/**
 * Guard against false alarms in boxChanged: true when the SOURCE photo
 * itself is essentially one flat colour equal to `packed` (e.g. a
 * blown-out white photo on a white page) — then "unchanged" is legit.
 */
export function sourceMatchesColor(src: PrintSource, packed: number): boolean {
  const { ctx } = makePrintCanvas(8, 8)
  ctx.drawImage(src.source, 0, 0, 8, 8)
  const d = ctx.getImageData(0, 0, 8, 8).data
  const r = packed >>> 24
  const g = (packed >>> 16) & 0xff
  const b = (packed >>> 8) & 0xff
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - r) > 4 || Math.abs(d[i + 1] - g) > 4 || Math.abs(d[i + 2] - b) > 4) return false
  }
  return true
}
