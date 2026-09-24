// src/lib/smart-layout/rotate-cover.ts
//
// Auto-fill for rotated photos. A photo is cover-fitted into its frame;
// rotating it would expose white wedges in the frame's corners. The
// editor, proof and print renderer all zoom the photo to
//   max(userZoom, rotationCoverZoom(...))
// so the frame always stays full, and rotating back to 0° returns to the
// client's own zoom (their zoom value is never overwritten).
//
// Units: slot height = 1, slot width = slotAspect (slot px W / px H).

export function rotationCoverZoom(
  imgAspect: number,
  slotAspect: number,
  rotateDeg: number,
): number {
  if (!rotateDeg || !Number.isFinite(imgAspect) || imgAspect <= 0 || !Number.isFinite(slotAspect) || slotAspect <= 0) {
    return 1
  }
  const sw = slotAspect
  const sh = 1
  // Cover-fit size of the photo at zoom 1.
  let cw: number
  let ch: number
  if (imgAspect > sw / sh) {
    ch = sh
    cw = sh * imgAspect
  } else {
    cw = sw
    ch = sw / imgAspect
  }
  const t = (rotateDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  // Bounding box of the frame expressed in the photo's (rotated) axes.
  const needW = sw * c + sh * s
  const needH = sw * s + sh * c
  return Math.max(1, needW / cw, needH / ch)
}

/** Zoom actually drawn: the client's zoom, raised if rotation needs it. */
export function effectiveZoom(
  userZoom: number,
  imgAspect: number,
  slotAspect: number,
  rotateDeg: number,
): number {
  return Math.max(userZoom || 1, rotationCoverZoom(imgAspect, slotAspect, rotateDeg))
}
