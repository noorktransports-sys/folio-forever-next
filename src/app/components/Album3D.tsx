'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';
import './album3d.css';

/**
 * Album3D — real WebGL 3D album mockup using Three.js.
 *
 * v4 — addresses user feedback on the cover-builder swap:
 *   - book is thinner (BOOK_D 0.18 → 0.09 — matches real album
 *     proportions ~8% of cover width, was reading too "novel-thick"
 *     before),
 *   - leather material has stronger normal-map scale and lower
 *     roughness so the pebble grain is visibly leathery,
 *   - 'acrylic' variant — front cover renders the photo behind a
 *     subtle clear-acrylic sheen with a leather binding strip on the
 *     spine side (matching the real product),
 *   - back cover always wraps in leather with a small foil mark,
 *     even on photo/acrylic covers, so rotating the book doesn't
 *     reveal the photo on the back.
 */
export interface Album3DProps {
  title?: string;
  subtitle?: string;
  variant?: 'leather' | 'photo' | 'acrylic';
  photoSrc?: string;
  leatherHex?: string;
  foilHex?: string;
  width?: number;
  caption?: string;
  className?: string;
}

// --- Book proportions in scene units. BOOK_D was 0.18, now 0.09
// (8% of width) which matches real wedding-album proportions and
// stops the book from reading as a phone book. ---
const BOOK_W = 1.2;
const BOOK_H = 1.7;
const BOOK_D = 0.09;
const COVER_T = 0.014;
const PAGE_D = BOOK_D - COVER_T * 2;

// Procedural leather normal map. Tighter grain + stronger contrast
// than v1 so the leather actually reads as pebbled leather under the
// 3-light setup.
function makeLeatherNormalTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // Slight per-pixel jitter on the X/Y components → bumpy surface.
    const r = 128 + (Math.random() - 0.5) * 60;
    const g = 128 + (Math.random() - 0.5) * 60;
    img.data[i + 0] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Light blur softens the noise into pebbling.
  ctx.filter = 'blur(0.4px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  return tex;
}

// Foil-stamped title rendered to canvas, returned as a texture
// applied to the leather. Used for leather variant front, all
// variant backs (so even photo covers have a leather back stamp).
function makeFoilTextTexture(
  title: string,
  subtitle: string,
  foilHex: string,
  size: 'large' | 'small' = 'large',
): THREE.CanvasTexture {
  const w = 1024;
  const h = 1448;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
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

    // --- LIGHTS — three-point setup. ---
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

    // --- MATERIALS ---
    const leatherColor = new THREE.Color(leatherHex);
    const normalTex = makeLeatherNormalTexture();
    const foilFrontTex = variant === 'leather'
      ? makeFoilTextTexture(title, subtitle, foilHex, 'large')
      : null;
    // Back foil mark — smaller, always rendered (photo+acrylic backs
    // also wrap in leather, so they get a small foil mark too — keeps
    // the back from looking like a void or a duplicate front photo).
    const foilBackTex = title
      ? makeFoilTextTexture(title, '', foilHex, 'small')
      : null;

    const leatherMatBase = (extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({
        color: leatherColor,
        roughness: 0.55,
        metalness: 0.05,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
        ...extra,
      });

    const pageBlockMaterial = new THREE.MeshStandardMaterial({
      color: 0xeadbb8,
      roughness: 0.92,
      metalness: 0,
    });

    // FRONT cover materials: 6-face array. +Z (face 4) gets the
    // variant-specific overlay. Other 5 faces stay leather.
    const frontMaterials: THREE.MeshStandardMaterial[] = [
      leatherMatBase(), // +X right
      leatherMatBase(), // -X left
      leatherMatBase(), // +Y top
      leatherMatBase(), // -Y bottom
      leatherMatBase(), // +Z front (overridden below per variant)
      leatherMatBase(), // -Z (inside of front cover; user only sees if open)
    ];
    if (variant === 'leather' && foilFrontTex) {
      frontMaterials[4] = new THREE.MeshStandardMaterial({
        color: leatherColor,
        roughness: 0.5,
        metalness: 0.1,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
        emissiveMap: foilFrontTex,
        emissive: new THREE.Color(foilHex),
        emissiveIntensity: 0.4,
        map: foilFrontTex,
      });
    } else if ((variant === 'photo' || variant === 'acrylic') && photoSrc) {
      // Async load photo → swap front face material in place.
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(photoSrc, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const photoMat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: variant === 'acrylic' ? 0.2 : 0.55,
          metalness: variant === 'acrylic' ? 0.4 : 0.05,
        });
        frontMaterials[4] = photoMat;
        cover.material = frontMaterials;
        cover.material.forEach((m) => { m.needsUpdate = true; });
      });
    }

    // BACK cover materials: 6-face array, leather everywhere except
    // -Z (face 5) which is what the user sees from behind. That face
    // gets a small foil stamp so the back never reads as bare void.
    const backMaterials: THREE.MeshStandardMaterial[] = [
      leatherMatBase(),
      leatherMatBase(),
      leatherMatBase(),
      leatherMatBase(),
      leatherMatBase(), // +Z (inside of back cover; faces page block)
      leatherMatBase(), // -Z (the visible back face when rotated 180°)
    ];
    if (foilBackTex) {
      backMaterials[5] = new THREE.MeshStandardMaterial({
        color: leatherColor,
        roughness: 0.55,
        metalness: 0.1,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
        emissiveMap: foilBackTex,
        emissive: new THREE.Color(foilHex),
        emissiveIntensity: 0.3,
        map: foilBackTex,
      });
    }

    // --- GEOMETRY ---
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
    const pages = new THREE.Mesh(pageGeom, pageBlockMaterial);
    pages.castShadow = true;
    pages.receiveShadow = true;

    const spineGeom = new THREE.BoxGeometry(0.04, BOOK_H, BOOK_D);
    const spine = new THREE.Mesh(spineGeom, leatherMatBase());
    spine.position.x = -(BOOK_W / 2 + 0.015);
    spine.castShadow = true;
    spine.receiveShadow = true;

    const book = new THREE.Group();
    book.add(cover, back, pages, spine);

    // ACRYLIC: add a leather binding strip on the spine side of the
    // FRONT cover (~12% wide), and a thin clear-acrylic sheen layer
    // in front of the photo. These are extra meshes on top of the
    // base front cover — keeps the rest of the rendering clean.
    if (variant === 'acrylic') {
      // Binding strip mesh — slightly in front of the cover face.
      const stripW = BOOK_W * 0.12;
      const stripGeom = new THREE.BoxGeometry(stripW, BOOK_H, COVER_T * 0.5);
      const stripMat = leatherMatBase({
        roughness: 0.45,
        metalness: 0.2,
      });
      const strip = new THREE.Mesh(stripGeom, stripMat);
      strip.position.set(
        -(BOOK_W / 2) + stripW / 2,
        0,
        PAGE_D / 2 + COVER_T + COVER_T * 0.25,
      );
      book.add(strip);

      // Acrylic sheen — thin transparent reflective plane in front
      // of the photo, sized to the photo area (cover minus binding).
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
      book.add(sheen);
    }

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

    // --- POINTER DRAG (with X-clamp + Y-clamp so user can't see
    // a "wrong" angle that exposes mesh seams). ---
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
      const now = performance.now();
      lastT = now;
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

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      coverGeom.dispose();
      backGeom.dispose();
      pageGeom.dispose();
      spineGeom.dispose();
      pageBlockMaterial.dispose();
      frontMaterials.forEach((m) => m.dispose());
      backMaterials.forEach((m) => m.dispose());
      normalTex.dispose();
      if (foilFrontTex) foilFrontTex.dispose();
      if (foilBackTex) foilBackTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
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
