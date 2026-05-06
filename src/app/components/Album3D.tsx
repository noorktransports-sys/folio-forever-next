'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';
import './album3d.css';

/**
 * Album3D — real WebGL 3D rendering with Three.js.
 *
 * Replaces the previous CSS-3D and still-illustration approaches
 * because both failed at conveying "premium leather book." This
 * version renders an actual 3D book mesh with:
 *   - BoxGeometry meshes for cover, back, spine, page block.
 *   - MeshStandardMaterial with PBR shading — leather has roughness,
 *     metalness, and reacts to the lights properly so the back view
 *     no longer reads as a flat panel.
 *   - Three lights: a warm key from upper-left, a softer fill from
 *     the right, and a slight rim from below to lift the book off
 *     the dark background.
 *   - Pointer-drag rotation with inertia, clamped on X so the user
 *     can't flip it upside down.
 *   - Foil-stamped title rendered to a Canvas2D texture and applied
 *     to the front cover face — text stays sharp regardless of zoom.
 *
 * Cleanup is critical with raw Three.js in a React component: the
 * useEffect's return function disposes geometries, materials,
 * textures, and the renderer to avoid GPU memory leaks across route
 * changes.
 */
export interface Album3DProps {
  /** Title shown in foil on the cover. */
  title?: string;
  /** Optional subtitle. */
  subtitle?: string;
  /** Cover style — leather (foil text) or photo (image on cover). */
  variant?: 'leather' | 'photo';
  /** Photo source for variant="photo". */
  photoSrc?: string;
  /** Leather color hex. */
  leatherHex?: string;
  /** Foil / text color hex. */
  foilHex?: string;
  /** Display size in px (the rendered width of the canvas). */
  width?: number;
  /** Caption shown under the album. */
  caption?: string;
  /** Optional className passthrough. */
  className?: string;
}

// --- Book physical proportions, in scene units ---
// Width × height matches a 12"×17" portrait album; depth is the
// total book thickness (covers + page block).
const BOOK_W = 1.2;
const BOOK_H = 1.7;
const BOOK_D = 0.18;
// Cover board thickness (each).
const COVER_T = 0.022;
// Page block depth = total - 2 covers.
const PAGE_D = BOOK_D - COVER_T * 2;

// --- Texture builders ---

/**
 * Build a procedural leather normal map on a Canvas. Cheaper than
 * loading an image and gives us per-color tinting flexibility. The
 * pebbled look comes from layered noise at multiple frequencies.
 */
function makeLeatherNormalTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }
  // Normal map convention: r=128 + dx, g=128 + dy, b=255 (z up).
  // We start with neutral blue-purple and add per-pixel jitter.
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = 128 + (Math.random() - 0.5) * 30;
    const g = 128 + (Math.random() - 0.5) * 30;
    img.data[i + 0] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Soften with a slight blur so the grain reads as leather, not noise.
  ctx.filter = 'blur(0.6px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

/**
 * Render foil-stamped text to a transparent canvas, return a Texture
 * to be applied as a decal on the cover face.
 */
function makeFoilTextTexture(
  title: string,
  subtitle: string,
  foilHex: string,
): THREE.CanvasTexture {
  // Wide canvas matches the cover's aspect ratio so text doesn't
  // distort. Portrait album → wider than tall ratio inverted.
  const w = 1024;
  const h = 1448;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Transparent background.
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = foilHex;
  ctx.strokeStyle = foilHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Foil rules either side of the title.
  const cy = h / 2;
  const ruleY = cy;
  const ruleW = 180;
  const ruleGap = 280;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w / 2 - ruleGap, ruleY);
  ctx.lineTo(w / 2 - ruleGap + ruleW, ruleY);
  ctx.moveTo(w / 2 + ruleGap - ruleW, ruleY);
  ctx.lineTo(w / 2 + ruleGap, ruleY);
  ctx.stroke();

  // Title — italic serif, large.
  ctx.font = 'italic 110px "Cormorant Garamond", "Times New Roman", serif';
  ctx.fillText(title, w / 2, cy);

  // Subtitle — uppercase tracked.
  if (subtitle) {
    ctx.font = '500 32px "Montserrat", sans-serif';
    const tracked = subtitle.toUpperCase().split('').join('  ');
    ctx.fillText(tracked, w / 2, cy + 120);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

export default function Album3D({
  title = 'Forever',
  subtitle = '',
  variant = 'leather',
  photoSrc,
  leatherHex = '#3a2618',
  foilHex = '#d4b07a',
  width = 360,
  caption = 'Drag to rotate · Real 3D leather',
  className = '',
}: Album3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- SCENE / CAMERA / RENDERER ---
    const scene = new THREE.Scene();
    scene.background = null; // CSS handles backdrop

    const aspect = BOOK_W / BOOK_H;
    const renderHeight = Math.round(width / aspect);

    const camera = new THREE.PerspectiveCamera(28, aspect, 0.1, 100);
    camera.position.set(0, 0, 5.6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, renderHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // --- LIGHTS ---
    // Key light — warm, upper-left, the primary modeling light.
    const key = new THREE.DirectionalLight(0xfff1d4, 1.6);
    key.position.set(-2, 3, 4);
    key.castShadow = true;
    scene.add(key);

    // Fill — cool, opposite side, lifts shadows.
    const fill = new THREE.DirectionalLight(0xb8d4ff, 0.4);
    fill.position.set(3, 1, 3);
    scene.add(fill);

    // Rim — from below-back, separates album from background.
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.5);
    rim.position.set(0, -2, -3);
    scene.add(rim);

    // Soft ambient so dark sides aren't pitch black.
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // --- MATERIALS ---
    const leatherColor = new THREE.Color(leatherHex);
    const normalTex = makeLeatherNormalTexture();
    const foilTextTex = variant === 'leather'
      ? makeFoilTextTexture(title, subtitle, foilHex)
      : null;

    const leatherMaterial = new THREE.MeshStandardMaterial({
      color: leatherColor,
      roughness: 0.65,
      metalness: 0.05,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });

    const pageBlockMaterial = new THREE.MeshStandardMaterial({
      color: 0xeadbb8,
      roughness: 0.92,
      metalness: 0,
    });

    // Front-cover material: leather with foil-text overlay.
    // Implemented as a separate material so we can decal the text
    // only on the front face, not the spine or back.
    const frontMaterials: THREE.MeshStandardMaterial[] = new Array(6)
      .fill(null)
      .map(
        () =>
          new THREE.MeshStandardMaterial({
            color: leatherColor,
            roughness: 0.65,
            metalness: 0.05,
            normalMap: normalTex,
            normalScale: new THREE.Vector2(0.35, 0.35),
          }),
      );
    // BoxGeometry face order (Three.js):
    //   0: +X right, 1: -X left, 2: +Y top, 3: -Y bottom,
    //   4: +Z front, 5: -Z back
    // We want the foil/photo on +Z (face 4).
    if (variant === 'leather' && foilTextTex) {
      frontMaterials[4] = new THREE.MeshStandardMaterial({
        color: leatherColor,
        roughness: 0.55,
        metalness: 0.15,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.35, 0.35),
        emissiveMap: foilTextTex, // foil "glows" subtly
        emissive: new THREE.Color(foilHex),
        emissiveIntensity: 0.4,
        map: foilTextTex,
      });
    } else if (variant === 'photo' && photoSrc) {
      // Async load photo and swap into the front-face material.
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(photoSrc, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        frontMaterials[4] = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.6,
          metalness: 0.05,
        });
        // Replace the array entry on the mesh.
        if (cover) cover.material = frontMaterials;
      });
    }

    // --- GEOMETRY ---
    // Front cover (the visible face).
    const coverGeom = new THREE.BoxGeometry(BOOK_W, BOOK_H, COVER_T);
    const cover = new THREE.Mesh(coverGeom, frontMaterials);
    cover.position.z = PAGE_D / 2 + COVER_T / 2;
    cover.castShadow = true;
    cover.receiveShadow = true;

    // Back cover.
    const backGeom = new THREE.BoxGeometry(BOOK_W, BOOK_H, COVER_T);
    const back = new THREE.Mesh(backGeom, leatherMaterial);
    back.position.z = -(PAGE_D / 2 + COVER_T / 2);
    back.castShadow = true;
    back.receiveShadow = true;

    // Page block — slightly inset from the cover edges so the cover
    // visibly overhangs (real albums do this; it's how leather wraps
    // the boards).
    const pageGeom = new THREE.BoxGeometry(BOOK_W * 0.97, BOOK_H * 0.985, PAGE_D);
    const pages = new THREE.Mesh(pageGeom, pageBlockMaterial);
    pages.castShadow = true;
    pages.receiveShadow = true;

    // Spine — leather wrap on the left.
    const spineGeom = new THREE.BoxGeometry(0.06, BOOK_H, BOOK_D);
    const spine = new THREE.Mesh(spineGeom, leatherMaterial);
    spine.position.x = -(BOOK_W / 2 + 0.025);
    spine.castShadow = true;
    spine.receiveShadow = true;

    // Group everything so we rotate as one rigid object.
    const book = new THREE.Group();
    book.add(cover, back, pages, spine);
    book.rotation.y = -0.35; // gentle 3/4 rest pose
    book.rotation.x = 0.05;
    scene.add(book);

    // Soft ground plane to receive shadows.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.45 }),
    );
    ground.position.y = -1.4;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- POINTER DRAG ---
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let velY = 0;
    let velX = 0;
    let lastT = performance.now();

    function onPointerDown(e: PointerEvent) {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      // Drag-to-rotate: horizontal → Y-axis, vertical → X-axis.
      // Clamp X so the user can't flip it upside down.
      book.rotation.y += dx * 0.008;
      book.rotation.x = Math.max(
        -0.6,
        Math.min(0.6, book.rotation.x + dy * 0.005),
      );
      velY = dx * 0.008;
      velX = dy * 0.005;
    }
    function onPointerUp(e: PointerEvent) {
      isDragging = false;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);

    // --- RENDER LOOP ---
    let raf = 0;
    function animate() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      // Inertia decay when not dragging.
      if (!isDragging) {
        book.rotation.y += velY;
        book.rotation.x = Math.max(
          -0.6,
          Math.min(0.6, book.rotation.x + velX),
        );
        velY *= 0.94;
        velX *= 0.94;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    // --- CLEANUP ---
    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      // Dispose GPU resources.
      coverGeom.dispose();
      backGeom.dispose();
      pageGeom.dispose();
      spineGeom.dispose();
      leatherMaterial.dispose();
      pageBlockMaterial.dispose();
      frontMaterials.forEach((m) => m.dispose());
      normalTex.dispose();
      if (foilTextTex) foilTextTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    // We deliberately do NOT depend on every prop — the scene is set
    // up once on mount. Color/text changes via prop will require a
    // re-mount. For the cover-builder, that's fine; for the homepage
    // hero, props are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, leatherHex, foilHex, title, subtitle, variant, photoSrc]);

  const stageStyle: CSSProperties = { width };

  return (
    <div className={`album-three-wrap ${className}`}>
      <div ref={mountRef} className="album-three-stage" style={stageStyle} />
      {caption && <p className="album-three-caption">{caption}</p>}
    </div>
  );
}
