'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';
import './album3d.css';

/**
 * Album3D — real WebGL 3D leather album with reactive props.
 *
 * v5 architecture: scene is built ONCE on mount. All other prop
 * changes (title text, leather color, foil color, photo URL, photo
 * zoom, photo position, variant, back photo) update the existing
 * scene in place — no re-mount, no GPU re-allocation, no jitter
 * when the user types or drags a slider.
 *
 * What's reactive:
 *   - title, subtitle, foilHex → regenerate foil texture, swap onto
 *     front (leather variant) and back (all variants).
 *   - leatherHex → set color on every leather material in place.
 *   - variant → show/hide acrylic strip + sheen, swap spine to
 *     fabric for photo cover.
 *   - photoSrc → load texture, apply to front +Z face.
 *   - backPhotoSrc → load texture, apply to back -Z face (overrides
 *     the leather+foil mark).
 *   - photoScale, photoX, photoY → adjust texture.repeat and
 *     texture.offset on the photo texture (zoom + pan, no rebuild).
 */
export interface Album3DProps {
  title?: string;
  subtitle?: string;
  variant?: 'leather' | 'photo' | 'acrylic';
  photoSrc?: string;
  /** Back-cover photo (only used for photo variant; falls back to leather + foil). */
  backPhotoSrc?: string;
  /** Photo zoom — 1 = fit, 2 = 2× zoom, etc. */
  photoScale?: number;
  /** Photo pan offset in CSS pixels (matches cover-builder's translate). */
  photoX?: number;
  photoY?: number;
  leatherHex?: string;
  foilHex?: string;
  width?: number;
  caption?: string;
  className?: string;
}

// --- Book proportions in scene units. ---
const BOOK_W = 1.2;
const BOOK_H = 1.7;
const BOOK_D = 0.09;
const COVER_T = 0.014;
const PAGE_D = BOOK_D - COVER_T * 2;
// Approximate cover render size in CSS px — used to convert
// photoX/photoY from pixel space to UV offset (0..1).
const CSS_COVER_REF_PX = 480;

function makeLeatherNormalTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i + 0] = 128 + (Math.random() - 0.5) * 60;
    img.data[i + 1] = 128 + (Math.random() - 0.5) * 60;
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.filter = 'blur(0.4px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  return tex;
}

// Render foil text to a canvas. Returns a CanvasTexture that can be
// disposed and re-created when title/subtitle changes.
function paintFoilCanvas(
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
  foilHex: string,
  size: 'large' | 'small' = 'large',
) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = foilHex;
  ctx.strokeStyle = foilHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = h / 2;
  const titleSize = size === 'large' ? 110 : 64;
  const ruleW = size === 'large' ? 180 : 110;
  const ruleGap = size === 'large' ? 280 : 180;
  const subSize = size === 'large' ? 32 : 22;
  const subGap = size === 'large' ? 120 : 80;
  ctx.lineWidth = size === 'large' ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - ruleGap, cy);
  ctx.lineTo(w / 2 - ruleGap + ruleW, cy);
  ctx.moveTo(w / 2 + ruleGap - ruleW, cy);
  ctx.lineTo(w / 2 + ruleGap, cy);
  ctx.stroke();
  ctx.font = `italic ${titleSize}px "Cormorant Garamond", "Times New Roman", serif`;
  ctx.fillText(title, w / 2, cy);
  if (subtitle) {
    ctx.font = `500 ${subSize}px "Montserrat", sans-serif`;
    const tracked = subtitle.toUpperCase().split('').join('  ');
    ctx.fillText(tracked, w / 2, cy + subGap);
  }
}

// Build a fabric (linen weave) texture for photo-cover spines.
// Two perpendicular thread directions on a dark base.
function makeFabricTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.fillStyle = '#2a2520';
  ctx.fillRect(0, 0, size, size);
  // Horizontal threads
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.7;
  for (let y = 0; y < size; y += 2) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // Vertical threads
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < size; x += 2) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

// All the persistent things stored in a ref so subsequent useEffects
// can mutate them without rebuilding the scene.
type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  book: THREE.Group;
  cover: THREE.Mesh;
  back: THREE.Mesh;
  spine: THREE.Mesh;
  pages: THREE.Mesh;
  // Material refs
  frontFaceMat: THREE.MeshStandardMaterial; // +Z of cover
  backFaceMat: THREE.MeshStandardMaterial;  // -Z of back (the visible back face)
  spineMat: THREE.MeshStandardMaterial;
  sideLeatherMats: THREE.MeshStandardMaterial[]; // sides of cover + back that share leather
  // Texture refs
  normalTex: THREE.CanvasTexture;
  fabricTex: THREE.CanvasTexture;
  foilFrontCanvas: HTMLCanvasElement;
  foilFrontTex: THREE.CanvasTexture;
  foilBackCanvas: HTMLCanvasElement;
  foilBackTex: THREE.CanvasTexture;
  photoTex: THREE.Texture | null;
  backPhotoTex: THREE.Texture | null;
  // Acrylic-specific meshes (created lazily, toggled visible)
  acrylicStrip: THREE.Mesh | null;
  acrylicSheen: THREE.Mesh | null;
  // Animation
  raf: number;
  cleanupHandlers: () => void;
};

export default function Album3D({
  title = 'Forever',
  subtitle = '',
  variant = 'leather',
  photoSrc,
  backPhotoSrc,
  photoScale = 1,
  photoX = 0,
  photoY = 0,
  leatherHex = '#3a2618',
  foilHex = '#d4b07a',
  width = 360,
  caption = 'Drag to rotate · Real 3D leather',
  className = '',
}: Album3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);

  // ─── ONE-TIME SCENE SETUP ────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = null;
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

    // Lights
    const key = new THREE.DirectionalLight(0xfff1d4, 1.6);
    key.position.set(-2, 3, 4);
    key.castShadow = true;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8d4ff, 0.4);
    fill.position.set(3, 1, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.5);
    rim.position.set(0, -2, -3);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // Textures
    const normalTex = makeLeatherNormalTexture();
    const fabricTex = makeFabricTexture();
    const foilFrontCanvas = document.createElement('canvas');
    foilFrontCanvas.width = 1024;
    foilFrontCanvas.height = 1448;
    const foilFrontTex = new THREE.CanvasTexture(foilFrontCanvas);
    foilFrontTex.anisotropy = 8;
    const foilBackCanvas = document.createElement('canvas');
    foilBackCanvas.width = 1024;
    foilBackCanvas.height = 1448;
    const foilBackTex = new THREE.CanvasTexture(foilBackCanvas);
    foilBackTex.anisotropy = 8;

    const initialColor = new THREE.Color(leatherHex);
    const initialFoil = new THREE.Color(foilHex);

    const mkLeatherMat = () =>
      new THREE.MeshStandardMaterial({
        color: initialColor.clone(),
        roughness: 0.55,
        metalness: 0.05,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
      });

    // FRONT cover face material — gets photo OR foil text overlay.
    const frontFaceMat = new THREE.MeshStandardMaterial({
      color: initialColor.clone(),
      roughness: 0.5,
      metalness: 0.1,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
      emissive: initialFoil.clone(),
      emissiveIntensity: 0.4,
      // map and emissiveMap set per-variant by reactive useEffects
    });

    // BACK -Z face material — gets back-photo OR foil mark.
    const backFaceMat = new THREE.MeshStandardMaterial({
      color: initialColor.clone(),
      roughness: 0.55,
      metalness: 0.1,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
      emissive: initialFoil.clone(),
      emissiveIntensity: 0.3,
    });

    // SPINE material — leather by default, swapped to fabric for
    // photo variant via reactive useEffect.
    const spineMat = mkLeatherMat();

    // Side leather mats (top/bottom/right edges of front + back +
    // inner faces) all share — saves disposal.
    const sideMats: THREE.MeshStandardMaterial[] = [];
    const mkSide = () => {
      const m = mkLeatherMat();
      sideMats.push(m);
      return m;
    };

    // FRONT cover — 6-face material array.
    const frontMaterials = [
      mkSide(),  // 0 +X
      mkSide(),  // 1 -X
      mkSide(),  // 2 +Y
      mkSide(),  // 3 -Y
      frontFaceMat,  // 4 +Z (visible front)
      mkSide(),  // 5 -Z (inner face)
    ];

    // BACK cover — 6-face material array.
    const backMaterials = [
      mkSide(),  // 0 +X
      mkSide(),  // 1 -X
      mkSide(),  // 2 +Y
      mkSide(),  // 3 -Y
      mkSide(),  // 4 +Z (inner face)
      backFaceMat,  // 5 -Z (visible back)
    ];

    // Geometry
    const coverGeom = new THREE.BoxGeometry(BOOK_W, BOOK_H, COVER_T);
    const cover = new THREE.Mesh(coverGeom, frontMaterials);
    cover.position.z = PAGE_D / 2 + COVER_T / 2;
    cover.castShadow = true;
    cover.receiveShadow = true;

    const backGeom = new THREE.BoxGeometry(BOOK_W, BOOK_H, COVER_T);
    const back = new THREE.Mesh(backGeom, backMaterials);
    back.position.z = -(PAGE_D / 2 + COVER_T / 2);
    back.castShadow = true;
    back.receiveShadow = true;

    const pageGeom = new THREE.BoxGeometry(BOOK_W * 0.97, BOOK_H * 0.985, PAGE_D);
    const pageMat = new THREE.MeshStandardMaterial({
      color: 0xeadbb8,
      roughness: 0.92,
      metalness: 0,
    });
    const pages = new THREE.Mesh(pageGeom, pageMat);
    pages.castShadow = true;
    pages.receiveShadow = true;

    const spineGeom = new THREE.BoxGeometry(0.05, BOOK_H, BOOK_D);
    const spine = new THREE.Mesh(spineGeom, spineMat);
    spine.position.x = -(BOOK_W / 2 + 0.02);
    spine.castShadow = true;
    spine.receiveShadow = true;

    const book = new THREE.Group();
    book.add(cover, back, pages, spine);
    book.rotation.y = -0.35;
    book.rotation.x = 0.05;
    scene.add(book);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.45 }),
    );
    ground.position.y = -1.4;
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Drag-to-rotate
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let velY = 0;
    let velX = 0;
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
      book.rotation.y += dx * 0.008;
      book.rotation.x = Math.max(-0.6, Math.min(0.6, book.rotation.x + dy * 0.005));
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

    let raf = 0;
    function animate() {
      if (!isDragging) {
        book.rotation.y += velY;
        book.rotation.x = Math.max(-0.6, Math.min(0.6, book.rotation.x + velX));
        velY *= 0.94;
        velX *= 0.94;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    const cleanup = () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      coverGeom.dispose();
      backGeom.dispose();
      pageGeom.dispose();
      spineGeom.dispose();
      pageMat.dispose();
      frontFaceMat.dispose();
      backFaceMat.dispose();
      spineMat.dispose();
      sideMats.forEach((m) => m.dispose());
      normalTex.dispose();
      fabricTex.dispose();
      foilFrontTex.dispose();
      foilBackTex.dispose();
      if (refs.current?.photoTex) refs.current.photoTex.dispose();
      if (refs.current?.backPhotoTex) refs.current.backPhotoTex.dispose();
      if (refs.current?.acrylicStrip) {
        (refs.current.acrylicStrip.geometry as THREE.BufferGeometry).dispose();
        (refs.current.acrylicStrip.material as THREE.Material).dispose();
      }
      if (refs.current?.acrylicSheen) {
        (refs.current.acrylicSheen.geometry as THREE.BufferGeometry).dispose();
        (refs.current.acrylicSheen.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };

    refs.current = {
      renderer,
      scene,
      camera,
      book,
      cover,
      back,
      spine,
      pages,
      frontFaceMat,
      backFaceMat,
      spineMat,
      sideLeatherMats: sideMats,
      normalTex,
      fabricTex,
      foilFrontCanvas,
      foilFrontTex,
      foilBackCanvas,
      foilBackTex,
      photoTex: null,
      backPhotoTex: null,
      acrylicStrip: null,
      acrylicSheen: null,
      raf,
      cleanupHandlers: cleanup,
    };

    return () => {
      cleanup();
      refs.current = null;
    };
    // Width drives canvas size — that's a structural rebuild, so we
    // accept the re-mount when width changes. Other props are reactive.
  }, [width]);

  // ─── REACT TO LEATHER COLOR ──────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const c = new THREE.Color(leatherHex);
    r.frontFaceMat.color.copy(c);
    r.backFaceMat.color.copy(c);
    r.spineMat.color.copy(c);
    r.sideLeatherMats.forEach((m) => m.color.copy(c));
    if (r.acrylicStrip) {
      (r.acrylicStrip.material as THREE.MeshStandardMaterial).color.copy(c);
    }
  }, [leatherHex]);

  // ─── REACT TO FOIL COLOR ─────────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const c = new THREE.Color(foilHex);
    r.frontFaceMat.emissive.copy(c);
    r.backFaceMat.emissive.copy(c);
    // Repaint foil canvases too (text color changes)
    paintFoilCanvas(r.foilFrontCanvas, title, subtitle, foilHex, 'large');
    paintFoilCanvas(r.foilBackCanvas, title, '', foilHex, 'small');
    r.foilFrontTex.needsUpdate = true;
    r.foilBackTex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foilHex]);

  // ─── REACT TO TITLE / SUBTITLE ───────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    paintFoilCanvas(r.foilFrontCanvas, title, subtitle, foilHex, 'large');
    paintFoilCanvas(r.foilBackCanvas, title, '', foilHex, 'small');
    r.foilFrontTex.needsUpdate = true;
    r.foilBackTex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle]);

  // ─── REACT TO VARIANT ────────────────────────────────────────
  // - leather: front face has foil texture (no photo).
  // - photo: front face has photo, spine wraps in fabric.
  // - acrylic: front face has photo with acrylic sheen + binding strip.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;

    if (variant === 'leather') {
      // Foil text on front face, no photo.
      r.frontFaceMat.map = r.foilFrontTex;
      r.frontFaceMat.emissiveMap = r.foilFrontTex;
      r.frontFaceMat.needsUpdate = true;
      // Spine = leather.
      r.spine.material = r.spineMat;
      r.spineMat.map = null;
      r.spineMat.normalMap = r.normalTex;
      r.spineMat.needsUpdate = true;
    } else {
      // photo / acrylic — front face uses photo (loaded in separate
      // useEffect). Don't blow away the foil texture if photo isn't
      // loaded yet — show foil as a placeholder until photo lands.
      if (!r.photoTex) {
        r.frontFaceMat.map = r.foilFrontTex;
        r.frontFaceMat.emissiveMap = r.foilFrontTex;
      }
      r.frontFaceMat.needsUpdate = true;
      // Spine: photo cover uses linen fabric, acrylic stays leather.
      if (variant === 'photo') {
        r.spineMat.map = r.fabricTex;
        r.spineMat.normalMap = null;
        r.spineMat.color.set(0x2a2520);
      } else {
        r.spineMat.map = null;
        r.spineMat.normalMap = r.normalTex;
        r.spineMat.color.set(leatherHex);
      }
      r.spineMat.needsUpdate = true;
    }

    // ACRYLIC strip + sheen — created lazily, then shown/hidden.
    const needsAcrylic = variant === 'acrylic';
    if (needsAcrylic && !r.acrylicStrip) {
      const stripW = BOOK_W * 0.12;
      const stripGeom = new THREE.BoxGeometry(stripW, BOOK_H, COVER_T * 0.5);
      const stripMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(leatherHex),
        roughness: 0.45,
        metalness: 0.2,
        normalMap: r.normalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
      });
      const strip = new THREE.Mesh(stripGeom, stripMat);
      strip.position.set(
        -(BOOK_W / 2) + stripW / 2,
        0,
        PAGE_D / 2 + COVER_T + COVER_T * 0.25,
      );
      r.book.add(strip);
      r.acrylicStrip = strip;

      const sheenW = BOOK_W - stripW;
      const sheenGeom = new THREE.PlaneGeometry(sheenW, BOOK_H);
      const sheenMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.10,
        roughness: 0.05,
        metalness: 0.6,
        side: THREE.DoubleSide,
      });
      const sheen = new THREE.Mesh(sheenGeom, sheenMat);
      sheen.position.set(
        stripW / 2,
        0,
        PAGE_D / 2 + COVER_T + COVER_T * 0.5,
      );
      r.book.add(sheen);
      r.acrylicSheen = sheen;
    }
    if (r.acrylicStrip) r.acrylicStrip.visible = needsAcrylic;
    if (r.acrylicSheen) r.acrylicSheen.visible = needsAcrylic;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  // ─── REACT TO PHOTO SRC ──────────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (!photoSrc || variant === 'leather') {
      // Strip the photo, fall back to foil.
      if (r.photoTex) {
        r.photoTex.dispose();
        r.photoTex = null;
      }
      r.frontFaceMat.map = r.foilFrontTex;
      r.frontFaceMat.emissiveMap = r.foilFrontTex;
      r.frontFaceMat.needsUpdate = true;
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(photoSrc, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      // Apply current zoom + pan immediately on load.
      tex.repeat.set(1 / photoScale, 1 / photoScale);
      tex.offset.set(
        0.5 - 0.5 / photoScale - photoX / CSS_COVER_REF_PX,
        0.5 - 0.5 / photoScale + photoY / CSS_COVER_REF_PX,
      );
      tex.needsUpdate = true;
      // Dispose old photo tex.
      if (r.photoTex) r.photoTex.dispose();
      r.photoTex = tex;
      r.frontFaceMat.map = tex;
      r.frontFaceMat.emissiveMap = null;
      r.frontFaceMat.emissiveIntensity = 0;
      r.frontFaceMat.needsUpdate = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSrc, variant]);

  // ─── REACT TO BACK PHOTO SRC ─────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (!backPhotoSrc || variant === 'leather' || variant === 'acrylic') {
      // Restore leather + foil mark on back.
      if (r.backPhotoTex) {
        r.backPhotoTex.dispose();
        r.backPhotoTex = null;
      }
      r.backFaceMat.map = r.foilBackTex;
      r.backFaceMat.emissiveMap = r.foilBackTex;
      r.backFaceMat.emissiveIntensity = 0.3;
      r.backFaceMat.needsUpdate = true;
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(backPhotoSrc, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      if (r.backPhotoTex) r.backPhotoTex.dispose();
      r.backPhotoTex = tex;
      r.backFaceMat.map = tex;
      r.backFaceMat.emissiveMap = null;
      r.backFaceMat.emissiveIntensity = 0;
      r.backFaceMat.needsUpdate = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backPhotoSrc, variant]);

  // ─── REACT TO PHOTO ZOOM / PAN (smooth, no rebuild) ──────────
  useEffect(() => {
    const r = refs.current;
    if (!r?.photoTex) return;
    const tex = r.photoTex;
    tex.repeat.set(1 / photoScale, 1 / photoScale);
    tex.offset.set(
      0.5 - 0.5 / photoScale - photoX / CSS_COVER_REF_PX,
      0.5 - 0.5 / photoScale + photoY / CSS_COVER_REF_PX,
    );
    tex.needsUpdate = true;
  }, [photoScale, photoX, photoY]);

  // Initial render: setup the foil textures with current title/foil
  // so first frame isn't blank. Done in a final useEffect that runs
  // after the setup useEffect has populated refs.current.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    paintFoilCanvas(r.foilFrontCanvas, title, subtitle, foilHex, 'large');
    paintFoilCanvas(r.foilBackCanvas, title, '', foilHex, 'small');
    r.foilFrontTex.needsUpdate = true;
    r.foilBackTex.needsUpdate = true;
    // Make sure variant materials are wired on first paint.
    if (variant === 'leather') {
      r.frontFaceMat.map = r.foilFrontTex;
      r.frontFaceMat.emissiveMap = r.foilFrontTex;
      r.frontFaceMat.needsUpdate = true;
    }
    r.backFaceMat.map = r.foilBackTex;
    r.backFaceMat.emissiveMap = r.foilBackTex;
    r.backFaceMat.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]); // re-init on full rebuild only

  const stageStyle: CSSProperties = { width };

  return (
    <div className={`album-three-wrap ${className}`}>
      <div ref={mountRef} className="album-three-stage" style={stageStyle} />
      {caption && <p className="album-three-caption">{caption}</p>}
    </div>
  );
}
