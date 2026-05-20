/**
 * Tiny EXIF reader — pulls just the original capture time out of a
 * JPEG (DateTimeOriginal, tag 0x9003 in the Exif IFD). No npm dep:
 * we read the first ~256 KB as a DataView and walk the IFD structure.
 *
 * The album's layout engine uses this to order each event's photos
 * chronologically so the album reads like a story instead of upload
 * order. If anything fails we just return null — the engine then
 * falls back to filename sequence, then to upload order.
 */

const MAX_READ = 256 * 1024 // 256 KB — covers virtually any APP1 segment

/** Returns ms-since-epoch of EXIF DateTimeOriginal, or null. */
export async function readJpegCaptureTime(source: Blob): Promise<number | null> {
  if (!source) return null
  try {
    const slice =
      source.size > MAX_READ ? source.slice(0, MAX_READ) : source
    const buf = await slice.arrayBuffer()
    return parseExifCaptureTime(buf)
  } catch {
    return null
  }
}

function parseExifCaptureTime(buf: ArrayBuffer): number | null {
  const dv = new DataView(buf)
  if (dv.byteLength < 4) return null
  // JPEG SOI
  if (dv.getUint16(0) !== 0xffd8) return null

  let off = 2
  while (off < dv.byteLength) {
    // Markers all start with 0xFF; skip any padding 0xFFs.
    if (dv.getUint8(off) !== 0xff) return null
    while (off < dv.byteLength && dv.getUint8(off) === 0xff) off++
    if (off >= dv.byteLength) return null
    const marker = dv.getUint8(off)
    off++
    // SOS = scan; image data starts here, no more metadata segments.
    if (marker === 0xda) return null
    // Markers without a length field.
    if (marker === 0xd8 || marker === 0xd9) continue
    if (off + 2 > dv.byteLength) return null
    const segLen = dv.getUint16(off)
    if (segLen < 2 || off + segLen > dv.byteLength) return null

    if (marker === 0xe1) {
      // APP1 — could be EXIF or XMP. Check the identifier.
      const id = readAscii(dv, off + 2, 6)
      if (id === 'Exif\0\0') {
        const dt = scanExifSegment(dv, off + 2 + 6, segLen - 2 - 6)
        if (dt != null) return dt
      }
    }
    off += segLen
  }
  return null
}

function readAscii(dv: DataView, at: number, n: number): string {
  let s = ''
  for (let i = 0; i < n && at + i < dv.byteLength; i++) {
    s += String.fromCharCode(dv.getUint8(at + i))
  }
  return s
}

function scanExifSegment(dv: DataView, tiffStart: number, len: number): number | null {
  if (len < 8) return null
  const byteOrder = dv.getUint16(tiffStart)
  const little = byteOrder === 0x4949
  if (!little && byteOrder !== 0x4d4d) return null
  const u16 = (o: number) => dv.getUint16(o, little)
  const u32 = (o: number) => dv.getUint32(o, little)
  if (u16(tiffStart + 2) !== 0x002a) return null
  const ifd0 = tiffStart + u32(tiffStart + 4)

  // Walk IFD0; find SubIFD pointer (0x8769) or DateTime (0x0132) as
  // a fallback. Then walk SubIFD for DateTimeOriginal (0x9003).
  const readIfdValue = (
    ifdEntryOff: number,
  ): { tag: number; type: number; count: number; value: number } => {
    return {
      tag: u16(ifdEntryOff),
      type: u16(ifdEntryOff + 2),
      count: u32(ifdEntryOff + 4),
      value: u32(ifdEntryOff + 8),
    }
  }
  const entriesIfd0 = u16(ifd0)
  let subIfdOff = 0
  let fallbackDtOff = 0
  let fallbackDtCount = 0
  for (let i = 0; i < entriesIfd0; i++) {
    const e = readIfdValue(ifd0 + 2 + i * 12)
    if (e.tag === 0x8769) subIfdOff = tiffStart + e.value
    if (e.tag === 0x0132 && e.type === 2) {
      // DateTime — same format. Stored inline when count<=4; otherwise
      // value is an offset relative to the TIFF header.
      fallbackDtOff = tiffStart + e.value
      fallbackDtCount = e.count
    }
  }

  if (subIfdOff > 0 && subIfdOff + 2 <= dv.byteLength) {
    const subEntries = u16(subIfdOff)
    for (let i = 0; i < subEntries; i++) {
      const e = readIfdValue(subIfdOff + 2 + i * 12)
      if (e.tag === 0x9003 && e.type === 2) {
        // DateTimeOriginal — ASCII string at e.value (offset).
        const s = readAscii(dv, tiffStart + e.value, e.count)
        const ts = parseExifDate(s)
        if (ts) return ts
      }
    }
  }
  if (fallbackDtOff > 0) {
    const s = readAscii(dv, fallbackDtOff, fallbackDtCount)
    const ts = parseExifDate(s)
    if (ts) return ts
  }
  return null
}

/** EXIF dates are "YYYY:MM:DD HH:MM:SS" in the camera's local time. */
function parseExifDate(s: string): number | null {
  if (!s) return null
  const m = /^(\d{4}):(\d{2}):(\d{2})[\sT]+(\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  const t = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  )
  return Number.isFinite(t) ? t : null
}

/** Pull the largest run of digits out of a filename (IMG_0123.jpg → 123). */
export function extractFilenameSeq(name: string | null | undefined): number | null {
  if (!name) return null
  const m = name.match(/\d+/g)
  if (!m || !m.length) return null
  // Use the LAST numeric group (sequence number is usually at the end).
  const last = m[m.length - 1]
  const n = parseInt(last, 10)
  return Number.isFinite(n) ? n : null
}
