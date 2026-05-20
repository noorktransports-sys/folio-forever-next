/**
 * Device-capability heuristic for the album preview.
 *
 * "Open the Three.js 3D book view on phones / laptops that can handle
 * it; fall back to a simple CSS flipbook on cheap Android, low-RAM
 * devices, or anything that says it prefers reduced motion."
 *
 * Detection is best-effort. A manual toggle in the UI lets the user
 * override either direction — this only picks the DEFAULT.
 */

interface NavigatorExtras {
  deviceMemory?: number
  hardwareConcurrency?: number
  connection?: { saveData?: boolean; effectiveType?: string }
}

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPad on iOS 13+ reports as Mac with touch points.
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return ua.includes('Mac') && navigator.maxTouchPoints > 1
}

/**
 * True if this device/browser looks like it can comfortably render a
 * Three.js album-flip scene. Used as the DEFAULT for the preview; the
 * client can always toggle to the other view.
 */
export function is3DCapable(): boolean {
  if (typeof window === 'undefined') return false
  if (!hasWebGL()) return false

  // Respect the OS-level accessibility preference.
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false
    }
  } catch {
    /* ignore */
  }

  const n = navigator as Navigator & NavigatorExtras
  // Data saver mode → keep things light.
  if (n.connection?.saveData) return false
  if (n.connection?.effectiveType === '2g' || n.connection?.effectiveType === 'slow-2g') {
    return false
  }

  // iOS devices ship strong GPUs even on older models — always allow.
  if (isIOS()) return true

  const mem = typeof n.deviceMemory === 'number' ? n.deviceMemory : null
  const cores =
    typeof n.hardwareConcurrency === 'number' ? n.hardwareConcurrency : null

  // Either of these strong signals → capable.
  if (mem != null && mem >= 4) return true
  if (cores != null && cores >= 6) return true

  // If neither field reports anything (older browsers), give it the
  // benefit of the doubt on desktop-ish UAs; phones tend to report.
  if (mem == null && cores == null) {
    return /Win|Mac|Linux/.test(navigator.userAgent || '') &&
      !/Android|Mobile/.test(navigator.userAgent || '')
  }

  // Otherwise (low RAM AND/OR low cores reported) → fall back.
  return false
}
