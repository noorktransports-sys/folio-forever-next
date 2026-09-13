/**
 * Light-touch face detection for the smart layout engine.
 *
 * Uses the browser's native FaceDetector API when available (Chrome /
 * Edge / most Android Chromiums) — zero model download, runs in tens of
 * milliseconds per photo. Falls back to "no faces" elsewhere, in which
 * case the layout engine just keeps the default centred crop.
 *
 * Returns face bounding boxes in NORMALISED photo coordinates (0..1)
 * so downstream code doesn't need to know the photo's pixel size.
 */

export interface FaceBox {
  /** Top-left in 0..1 photo space. */
  x: number
  y: number
  w: number
  h: number
}

interface NativeFaceDetector {
  detect: (src: ImageBitmap | HTMLImageElement) => Promise<
    Array<{ boundingBox: { x: number; y: number; width: number; height: number } }>
  >
}
interface FaceDetectorCtor {
  new (opts?: { maxDetectedFaces?: number; fastMode?: boolean }): NativeFaceDetector
}

/** True iff this browser exposes the native FaceDetector API. */
export function hasNativeFaceDetector(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector ===
      'function'
  )
}

/** Detect faces in an image blob. Returns [] if no faces or if the
 *  browser has no FaceDetector. Never throws — callers can treat any
 *  result as "best effort". */
export async function detectFaces(blob: Blob): Promise<FaceBox[]> {
  if (!hasNativeFaceDetector()) return []
  const Ctor = (window as unknown as { FaceDetector?: FaceDetectorCtor })
    .FaceDetector
  if (!Ctor) return []
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
    const detector = new Ctor({ fastMode: true, maxDetectedFaces: 6 })
    const found = await detector.detect(bitmap)
    const W = bitmap.width
    const H = bitmap.height
    return found.map((f) => ({
      x: f.boundingBox.x / W,
      y: f.boundingBox.y / H,
      w: f.boundingBox.width / W,
      h: f.boundingBox.height / H,
    }))
  } catch {
    return []
  } finally {
    bitmap?.close?.()
  }
}

/**
 * Given the photo's face boxes and the SLOT's display aspect (W/H), pick
 * pan-X / pan-Y percentages (0..100) so the centroid of the faces lands
 * inside the visible crop. CSS `object-fit: cover` is the model.
 *
 * Returns {50,50} when the photo has no faces or no cropping happens on
 * the relevant axis — same as leaving the default centred crop.
 */
export function computeFacePan(
  faces: FaceBox[] | undefined,
  photoW: number,
  photoH: number,
  slotAspect: number,
): { panX: number; panY: number } {
  if (!faces || faces.length === 0 || photoW <= 0 || photoH <= 0) {
    return { panX: 50, panY: 50 }
  }
  // Centroid of all faces in photo coords (0..1).
  let cx = 0
  let cy = 0
  for (const f of faces) {
    cx += f.x + f.w / 2
    cy += f.y + f.h / 2
  }
  cx /= faces.length
  cy /= faces.length

  const photoAspect = photoW / photoH
  let panX = 50
  let panY = 50
  if (photoAspect > slotAspect) {
    // Crops horizontally — slide panX so face centroid is in the window.
    const cropWFrac = slotAspect / photoAspect // 0..1 of photo width
    const denom = 1 - cropWFrac
    if (denom > 0.001) {
      const pX = (cx - cropWFrac / 2) / denom
      panX = Math.max(0, Math.min(100, pX * 100))
    }
  } else if (photoAspect < slotAspect) {
    // Crops vertically.
    const cropHFrac = photoAspect / slotAspect
    const denom = 1 - cropHFrac
    if (denom > 0.001) {
      const pY = (cy - cropHFrac / 2) / denom
      panY = Math.max(0, Math.min(100, pY * 100))
    }
  }
  return { panX, panY }
}
