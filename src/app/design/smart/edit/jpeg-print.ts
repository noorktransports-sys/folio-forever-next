// src/app/design/smart/edit/jpeg-print.ts
//
// Print-file JPEG encoding for the composites the print lab receives.
//
// Two fixes over a plain canvas.toBlob(..., 0.85):
//   1. QUALITY — print files are encoded at 0.95 (was 0.85). If a very
//      detailed spread would exceed the upload cap, step down a little
//      (0.92 → 0.90) rather than fail the order.
//   2. DPI TAG — browsers write JPEGs with no resolution (JFIF units=0),
//      so Photoshop / RIP software opens a 7200-px spread as "72 ppi,
//      100 inches wide". We stamp the real print resolution (300 DPI)
//      into the JFIF header so the file opens at its true physical size.
//      Pixels are untouched — only the 5 header bytes change.

/** Keep composites comfortably under /api/upload's 35 MB cap. */
const MAX_PRINT_BYTES = 33 * 1024 * 1024
const PRINT_QUALITIES = [0.95, 0.92, 0.9]

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Write `dpi` into the JPEG's JFIF APP0 header (units = dots per inch).
 * If the file has no JFIF segment, one is inserted right after SOI.
 */
export async function withJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const d = Math.max(1, Math.min(65535, Math.round(dpi)))
  const isJfif =
    buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[3] === 0xe0 &&
    buf[6] === 0x4a && buf[7] === 0x46 && buf[8] === 0x49 && buf[9] === 0x46 && buf[10] === 0x00
  if (isJfif) {
    buf[13] = 1 // units: dots per inch
    buf[14] = d >> 8
    buf[15] = d & 0xff
    buf[16] = d >> 8
    buf[17] = d & 0xff
    return new Blob([buf], { type: 'image/jpeg' })
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return blob // not a JPEG — leave as is
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    0x01, d >> 8, d & 0xff, d >> 8, d & 0xff, 0x00, 0x00,
  ])
  const out = new Uint8Array(buf.length + app0.length)
  out.set(buf.subarray(0, 2), 0)
  out.set(app0, 2)
  out.set(buf.subarray(2), 2 + app0.length)
  return new Blob([out], { type: 'image/jpeg' })
}

/** High-quality, DPI-tagged JPEG for a print composite. */
export async function encodePrintJpeg(canvas: HTMLCanvasElement, dpi = 300): Promise<Blob> {
  let blob: Blob | null = null
  for (const q of PRINT_QUALITIES) {
    blob = await toBlob(canvas, q)
    if (blob.size <= MAX_PRINT_BYTES) break
  }
  return withJpegDpi(blob as Blob, dpi)
}
