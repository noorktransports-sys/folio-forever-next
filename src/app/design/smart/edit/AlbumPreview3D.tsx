'use client'

/**
 * AlbumPreview3D — real-3D version of the "open your album" preview.
 *
 * Each page (cover-front → spreads → cover-back) becomes a thin plane
 * mesh, hinged at the spine. The current leaf rotates 180° around the
 * spine on every "turn," revealing the next leaf underneath. The base
 * box behind the leaves gives the closed-book "thickness" cue. Drag
 * the canvas to tilt the camera for a 3D look-around. The textures
 * are taken straight from the parent modal's pre-rendered composites,
 * so proof = print.
 *
 * Loaded lazily by AlbumPreviewModal. Three.js itself is already in
 * the smart-designer chunk (the Album3D cover preview uses it), so
 * the marginal download is small.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

interface Page {
  url: string
  kind: 'cover-front' | 'spread' | 'cover-back'
  label: string
}

export interface AlbumPreview3DProps {
  pages: Page[]
  /** Spread W/H — used to size the page meshes. */
  spreadAspect: number
  /** Cover face W/H — used for the cover leaves. */
  coverAspect: number
  /** Standard hardcover gets a thicker base book; layflat is thinner. */
  isStandard: boolean
}

// Book height in world units. Width derives from each leaf's aspect.
const BOOK_H = 1.0
const LEAF_THICKNESS = 0.0008 // world units (very thin per page)
const FLIP_MS = 700

export default function AlbumPreview3D({
  pages,
  spreadAspect,
  coverAspect,
  isStandard,
}: AlbumPreview3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [idx, setIdx] = useState(0)
  // Index of the leaf currently mid-flip (so clicks don't double-fire).
  const flippingRef = useRef<number | null>(null)
  // Scene refs — re-bound in the setup effect.
  const refs = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    leaves: THREE.Group[] // one per page; rotation.y = 0 (closed) … -π (flipped)
    targetRot: number[] // current target rotation per leaf
    raf: number
    cleanup: () => void
  } | null>(null)

  // Build the scene once when pages arrive.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const W0 = mount.clientWidth
    const H0 = mount.clientHeight
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(W0, H0, false)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, W0 / H0, 0.05, 50)
    camera.position.set(0, 0.55, 2.8)
    camera.lookAt(0, 0, 0)

    // Soft lighting that flatters the page textures (which are already
    // colour-correct). Strong directional from upper-front for depth.
    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const dir = new THREE.DirectionalLight(0xffffff, 0.55)
    dir.position.set(0.6, 1.2, 1.0)
    scene.add(dir)

    // Texture loader — each page is a JPEG blob URL from the modal.
    const loader = new THREE.TextureLoader()
    const loadTex = (url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
          url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace
            t.anisotropy = renderer.capabilities.getMaxAnisotropy()
            resolve(t)
          },
          undefined,
          reject,
        )
      })

    const leafW = (pageKind: Page['kind']) =>
      BOOK_H * (pageKind === 'spread' ? spreadAspect : coverAspect)

    // ── Closed-book base ────────────────────────────────────────────
    // A flat-ish box behind the leaves to suggest the album's paper
    // thickness when viewed at an angle. Standard hardcover = thicker;
    // layflat = noticeably thinner.
    const baseDepth = LEAF_THICKNESS * pages.length + (isStandard ? 0.06 : 0.03)
    const baseW = leafW(pages[0]?.kind ?? 'cover-front')
    const baseGeom = new THREE.BoxGeometry(baseW, BOOK_H, baseDepth)
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x141008,
      roughness: 0.85,
    })
    const base = new THREE.Mesh(baseGeom, baseMat)
    // Sit so the leaves are at z=0 (top of stack); base extends BACK.
    base.position.set(0, 0, -baseDepth / 2)
    scene.add(base)

    // ── Leaves ──────────────────────────────────────────────────────
    // One Group per page. Plane positioned with its LEFT edge at the
    // group origin so the group's Y-rotation pivots around the spine.
    // Group X position = 0 (spine at world origin x).
    const leafGroups: THREE.Group[] = []
    const targetRot: number[] = []
    pages.forEach((p, i) => {
      const w = leafW(p.kind)
      const geom = new THREE.PlaneGeometry(w, BOOK_H)
      // Move so left edge sits at the group origin.
      geom.translate(w / 2, 0, 0)
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        // Texture set asynchronously below.
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geom, mat)
      const g = new THREE.Group()
      g.add(mesh)
      // Stack near the spine with a hair of depth so paper edges show
      // when the book is closed/tilted. Top leaf at z just above 0.
      g.position.set(0, 0, (pages.length - i) * LEAF_THICKNESS)
      g.rotation.y = 0 // not flipped yet
      scene.add(g)
      leafGroups.push(g)
      targetRot.push(0)

      // Load this page's texture asynchronously.
      loadTex(p.url)
        .then((t) => {
          mat.map = t
          mat.needsUpdate = true
        })
        .catch(() => {
          /* leave as white plane on failure */
        })
    })

    // ── Camera tilt drag ───────────────────────────────────────────
    // Drag with the pointer to orbit the book a bit; release returns
    // to a slight default tilt so the depth always reads.
    const REST_RX = -0.18 // looking slightly DOWN at the book
    const REST_RY = 0.0
    const cameraTarget = new THREE.Vector3(0, 0, 0)
    let rx = REST_RX
    let ry = REST_RY
    let dragStart: { x: number; y: number; rx: number; ry: number } | null = null

    const applyCamera = () => {
      const r = 2.8
      camera.position.x = r * Math.sin(ry) * Math.cos(rx)
      camera.position.y = r * Math.sin(-rx) + 0.4
      camera.position.z = r * Math.cos(ry) * Math.cos(rx)
      camera.lookAt(cameraTarget)
    }
    applyCamera()

    const canvasEl = renderer.domElement
    const onDown = (e: PointerEvent) => {
      dragStart = { x: e.clientX, y: e.clientY, rx, ry }
      canvasEl.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragStart) return
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      ry = Math.max(-0.45, Math.min(0.45, dragStart.ry + dx * 0.005))
      rx = Math.max(-0.45, Math.min(0.1, dragStart.rx - dy * 0.005))
      applyCamera()
    }
    const onUp = (e: PointerEvent) => {
      dragStart = null
      canvasEl.releasePointerCapture?.(e.pointerId)
    }
    canvasEl.addEventListener('pointerdown', onDown)
    canvasEl.addEventListener('pointermove', onMove)
    canvasEl.addEventListener('pointerup', onUp)
    canvasEl.addEventListener('pointercancel', onUp)

    // ── Resize handler ─────────────────────────────────────────────
    const onResize = () => {
      const W = mount.clientWidth
      const H = mount.clientHeight
      renderer.setSize(W, H, false)
      camera.aspect = W / H
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // ── Animation loop (eases each leaf toward its target rotation) ─
    const animate = () => {
      for (let i = 0; i < leafGroups.length; i++) {
        const g = leafGroups[i]
        const t = targetRot[i]
        const cur = g.rotation.y
        if (Math.abs(cur - t) > 0.001) {
          g.rotation.y = cur + (t - cur) * 0.16
          // Lift the flipping leaf slightly off the stack so it doesn't
          // z-fight with the base / underlying leaves.
          g.position.z =
            (pages.length - i) * LEAF_THICKNESS +
            0.02 * Math.sin(Math.abs(g.rotation.y))
        }
      }
      renderer.render(scene, camera)
      refs.current!.raf = requestAnimationFrame(animate)
    }
    let raf = requestAnimationFrame(animate)

    const cleanup = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      canvasEl.removeEventListener('pointerdown', onDown)
      canvasEl.removeEventListener('pointermove', onMove)
      canvasEl.removeEventListener('pointerup', onUp)
      canvasEl.removeEventListener('pointercancel', onUp)
      for (const g of leafGroups) {
        for (const m of g.children) {
          const mesh = m as THREE.Mesh
          mesh.geometry?.dispose?.()
          const mat = mesh.material as THREE.MeshStandardMaterial
          mat.map?.dispose?.()
          mat.dispose?.()
        }
      }
      baseGeom.dispose()
      baseMat.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }

    refs.current = {
      renderer,
      scene,
      camera,
      leaves: leafGroups,
      targetRot,
      raf,
      cleanup,
    }

    return () => {
      cleanup()
      refs.current = null
    }
  }, [pages, spreadAspect, coverAspect, isStandard])

  // Drive leaf rotations from idx — leaves[0..idx-1] are flipped, the
  // rest are flat. (Animation eases there inside the render loop.)
  useEffect(() => {
    const r = refs.current
    if (!r) return
    for (let i = 0; i < r.leaves.length; i++) {
      r.targetRot[i] = i < idx ? -Math.PI : 0
    }
  }, [idx])

  // Click-zone navigation — left half = back, right half = forward.
  const onZoneClick = (dir: -1 | 1) => {
    if (flippingRef.current != null) return
    setIdx((cur) => {
      const next = cur + dir
      if (next < 0 || next > pages.length) return cur
      flippingRef.current = next
      window.setTimeout(() => {
        flippingRef.current = null
      }, FLIP_MS)
      return next
    })
  }

  return (
    <div
      style={{
        position: 'relative',
        width: 'min(96vw, 1100px)',
        height: 'min(76vh, 700px)',
        userSelect: 'none',
      }}
    >
      <div
        ref={mountRef}
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* Navigation zones overlaid on the WebGL canvas — they sit ABOVE
          the canvas only at the bottom 80% so the top is reserved for
          drag-to-orbit interaction. */}
      <button
        type="button"
        onClick={() => onZoneClick(-1)}
        aria-label="Previous page"
        style={{
          position: 'absolute',
          left: 0,
          top: '15%',
          bottom: 0,
          width: '38%',
          background: 'transparent',
          border: 'none',
          cursor: idx > 0 ? 'w-resize' : 'default',
        }}
      />
      <button
        type="button"
        onClick={() => onZoneClick(1)}
        aria-label="Next page"
        style={{
          position: 'absolute',
          right: 0,
          top: '15%',
          bottom: 0,
          width: '38%',
          background: 'transparent',
          border: 'none',
          cursor: idx < pages.length ? 'e-resize' : 'default',
        }}
      />
      {/* Caption with current page label */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 6,
          textAlign: 'center',
          color: '#8a7c66',
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        {pages[Math.min(idx, pages.length - 1)]?.label}
        {' · '}
        drag to tilt · click edges to turn pages
      </div>
    </div>
  )
}
