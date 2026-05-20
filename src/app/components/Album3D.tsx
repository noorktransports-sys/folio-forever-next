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
  /**
   * CSS font-family stack for the cover title (e.g.
   * `'"Cormorant Garamond", serif'`). Drives the canvas-rendered foil
   * text — must match a font loaded in the document so canvas can
   * actually render it. The cover-builder loads all 10 picker fonts
   * via Google Fonts in src/app/layout.tsx.
   */
  fontFamily?: string;
  fontStyle?: 'normal' | 'italic';
  /**
   * Title size in CSS pixels (24..96 range from the slider). Scaled
   * internally to canvas pixels.
   */
  fontSizePx?: number;
  /** Vertical anchor for the title block on the cover. */
  position?: 'top' | 'center' | 'lower';
  width?: number;
  caption?: string;
  className?: string;
  /**
   * When true, pointer drag inside the WebGL canvas pans the cover photo
   * instead of rotating the book. Use to flip between "rotate the album"
   * and "crop the photo" modes — the same canvas handles both, but only
   * one gesture meaning at a time. Toggled by the parent's "Edit photo /
   * Done · back to rotate" button.
   */
  cropMode?: boolean;
  /**
   * Called when the user pans the photo while in crop mode. Receives the
   * cumulative photoX/photoY values (CSS pixels) so the parent's React
   * state stays the source of truth — the texture offset is recomputed
   * via the existing photoScale/photoX/photoY useEffect after parent
   * re-renders. This avoids two-way data binding between Three.js and React.
   */
  onPhotoPan?: (x: number, y: number) => void;
  /**
   * Called on wheel events while in crop mode.
   *
   * direction: +1 for zoom-in (wheel-up), -1 for zoom-out.
   * cu, cv: cursor position normalized to the canvas (each in [0, 1]),
   *   where (0, 0) is top-left and (1, 1) is bottom-right. The parent
   *   uses this to pivot the zoom around the cursor so the photo pixel
   *   under the mouse stays under the mouse through the zoom — without
   *   it, zooming on the groom drifts him off-cursor toward the center.
   *
   * The parent decides step size and clamping (so we don't have to know
   * PHOTO_SCALE_MIN/MAX here).
   */
  onPhotoZoom?: (direction: 1 | -1, cu: number, cv: number) => void;
}

// --- Book proportions in scene units. ---
const BOOK_W = 1.2;
const BOOK_H = 1.7;
const BOOK_D = 0.09;
const COVER_T = 0.014;
const PAGE_D = BOOK_D - COVER_T * 2;
const FACE_ASPECT = BOOK_W / BOOK_H; // ≈ 0.706 (portrait cover)
// Approximate cover render size in CSS px — used to convert
// photoX/photoY from pixel space to UV offset (0..1).
const CSS_COVER_REF_PX = 480;

/**
 * Apply object-fit:cover semantics to a Three.js texture, optionally
 * combined with a user-driven zoom + pan (front cover only). Without
 * this, BoxGeometry stretches the photo to the face's UV (1.2 × 1.7
 * portrait), which squashes any non-portrait photo. With this, the
 * photo fills the face proportionally and the excess is cropped on the
 * dominant axis (matching how `object-fit: cover` works in CSS).
 *
 * Pan is scaled-corrected: at 2× zoom, the visible window is half-width,
 * so a 1-screen-pixel drag must produce a UV shift half as large to feel
 * 1:1. The earlier formula didn't divide by zoom — that's why panning at
 * higher zoom felt like the photo "jumped one way."
 *
 * Pan clamping is the parent's job (cover-builder.tsx) so this stays
 * pure and reusable for back-cover + future spread tiles.
 */
function applyPhotoTransform(
  tex: THREE.Texture,
  photoScale = 1,
  photoX = 0,
  photoY = 0,
) {
  const img = tex.image as { width?: number; height?: number } | null;
  if (!img || !img.width || !img.height) return;

  const photoAspect = img.width / img.height;

  // Object-fit:cover base mapping. We compute the visible UV window
  // size that, when stretched onto the face's 1×1 UVs, preserves the
  // photo's aspect.
  let baseRepX: number;
  let baseRepY: number;
  let baseOffX: number;
  let baseOffY: number;
  if (photoAspect > FACE_ASPECT) {
    // Photo is wider than face — fit height, crop sides.
    baseRepX = FACE_ASPECT / photoAspect;
    baseRepY = 1;
    baseOffX = (1 - baseRepX) / 2;
    baseOffY = 0;
  } else {
    // Photo is taller than face — fit width, crop top/bottom.
    baseRepX = 1;
    baseRepY = photoAspect / FACE_ASPECT;
    baseOffX = 0;
    baseOffY = (1 - baseRepY) / 2;
  }

  const repX = baseRepX / photoScale;
  const repY = baseRepY / photoScale;

  // Pan in UV space — divide by photoScale so screen-px feel is 1:1
  // at any zoom level. baseRep* multiplier keeps pan proportional to
  // the cropped axis (no over-pan when one axis is letterboxed).
  const panUVX = (photoX / CSS_COVER_REF_PX) * baseRepX / photoScale;
  const panUVY = (photoY / CSS_COVER_REF_PX) * baseRepY / photoScale;

  tex.repeat.set(repX, repY);
  tex.offset.set(
    baseOffX + (baseRepX - repX) / 2 - panUVX,
    baseOffY + (baseRepY - repY) / 2 + panUVY,
  );
  tex.needsUpdate = true;
}

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

/**
 * Render foil text to a canvas.
 *
 * Honors EVERY user pick from the cover-builder controls — fontFamily,
 * fontStyle, fontSizePx, position, foilHex, title, subtitle. Earlier
 * versions hardcoded Cormorant Garamond / 110px / center, which made the
 * font picker, size slider, and position picker decorative. This is the
 * regression the user filed: "font selection is not working ... font
 * location is not working."
 *
 * Sizing math: the cover-builder shows the album at ~560 CSS-px wide
 * (Album3D's `width` prop). The canvas we paint here is 1024 px wide, so
 * 1 CSS px ≈ canvas.width / 560 ≈ 1.83 canvas px. Scaling the user's
 * fontSizePx by this factor keeps the on-screen size honest.
 *
 * Decorative rules (the small foil dashes flanking the title) and the
 * subtitle scale relative to the title size, so picking a 90 px title
 * keeps the layout proportionate instead of swimming in whitespace.
 */
const FOIL_CANVAS_REF_PX = 560; // matches Album3D's `width` prop in cover-builder

function paintFoilCanvas(
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
  foilHex: string,
  fontFamily = '"Cormorant Garamond", serif',
  fontStyle: 'normal' | 'italic' = 'italic',
  fontSizePx = 52,
  position: 'top' | 'center' | 'lower' = 'center',
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

  // Convert CSS px → canvas px so the rendered size matches what the
  // user expects from the slider's px label.
  const scale = w / FOIL_CANVAS_REF_PX;
  const titleSize = fontSizePx * scale;
  const subSize = Math.max(14, Math.round(titleSize * 0.30));
  // Subtitle sits this far below the title, scaled with title size so
  // the spacing stays balanced across the 24..96px range.
  const subGap = titleSize * 1.15;

  // Vertical anchor based on the user's position choice. 18%/50%/82% of
  // canvas height — matches the 'top' / 'center' / 'lower' offsets that
  // the cover-builder previously used for its CSS-3D preview.
  let cy: number;
  switch (position) {
    case 'top':   cy = h * 0.18; break;
    case 'lower': cy = h * 0.82; break;
    case 'center':
    default:      cy = h * 0.5;
  }

  // Earlier versions of this function painted decorative dashes on
  // either side of the title at vertical-center cy. Long names ("Sana
  // & Areeb" on a 45px slider, "Christopher & Alexandra", etc.) ran
  // wider than the dash gap and overlapped the text — looked like a
  // strikethrough. Removed entirely; titles read cleaner without the
  // flourish anyway.

  // Title — uses the user-picked font + style.
  // Note: the font must be loaded in the document for canvas to render
  // it (we load all 10 via Google Fonts in src/app/layout.tsx). If the
  // font hasn't loaded yet on the very first paint, canvas falls back
  // to the next family in the stack — usually fine, and fixed on the
  // next repaint after fonts.ready.
  ctx.font = `${fontStyle} ${titleSize}px ${fontFamily}`;
  ctx.fillText(title, w / 2, cy);

  if (subtitle) {
    // Subtitle uses Montserrat with letter-spaced caps for the classic
    // wedding-album look, regardless of title font choice.
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
//
// Materials are split by VARIANT, not by face. Each variant owns its own
// front + back material with its own complete config. The variant effect
// swaps which material is bound to the cover/back's +Z / -Z slot. Each
// prop effect (leatherHex, foilHex, photoSrc, backPhotoSrc) only mutates
// the material set it's responsible for, so e.g. changing foilHex while a
// photo cover is active no longer silently re-colors the photo material.
type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  book: THREE.Group;
  cover: THREE.Mesh;
  back: THREE.Mesh;
  spine: THREE.Mesh;
  pages: THREE.Mesh;
  // Material refs — one per variant per face.
  leatherFrontMat: THREE.MeshStandardMaterial; // +Z of cover, leather variant
  photoFrontMat: THREE.MeshStandardMaterial;   // +Z of cover, photo + acrylic variants
  leatherBackMat: THREE.MeshStandardMaterial;  // -Z of back, leather + acrylic variants
  photoBackMat: THREE.MeshStandardMaterial;    // -Z of back, photo variant when backPhotoSrc set
  spineMat: THREE.MeshStandardMaterial;
  sideLeatherMats: THREE.MeshStandardMaterial[]; // shared edge leather (color follows leatherHex)
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
  // Foil text overlay — sits just in front of the cover face. Used to
  // render the title/subtitle on top of photo + acrylic covers (leather
  // bakes the foil into the cover material directly so doesn't need this).
  foilOverlay: THREE.Mesh;
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
  fontFamily = '"Cormorant Garamond", serif',
  fontStyle = 'italic',
  fontSizePx = 52,
  position = 'center',
  width = 360,
  caption = 'Drag to rotate · Real 3D leather',
  className = '',
  cropMode = false,
  onPhotoPan,
  onPhotoZoom,
}: Album3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);
  /**
   * Latest copies of crop-mode props, kept in refs so the pointer
   * handlers (which are bound ONCE in the setup useEffect) always see the
   * current values without needing to re-bind on every prop change.
   * Re-binding listeners on prop change would drop in-flight drags
   * between mousedown and mouseup.
   */
  const cropModeRef = useRef(cropMode);
  const onPhotoPanRef = useRef(onPhotoPan);
  const onPhotoZoomRef = useRef(onPhotoZoom);
  const photoXRef = useRef(photoX);
  const photoYRef = useRef(photoY);
  useEffect(() => { cropModeRef.current = cropMode; }, [cropMode]);
  useEffect(() => { onPhotoPanRef.current = onPhotoPan; }, [onPhotoPan]);
  useEffect(() => { onPhotoZoomRef.current = onPhotoZoom; }, [onPhotoZoom]);
  useEffect(() => { photoXRef.current = photoX; }, [photoX]);
  useEffect(() => { photoYRef.current = photoY; }, [photoY]);

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

    // LEATHER FRONT — pure leather. Color + grain only; foil text is
    // rendered separately on the foilOverlay plane (see below).
    //
    // History: earlier this material carried the foil canvas as
    // emissiveMap. That worked for light foil on dark leather (gold on
    // black) but broke for dark foil on light leather (black on ivory) —
    // emissive can only ADD light, never subtract, so a black canvas
    // pixel contributes 0 and the dark foil rendered invisibly. Moving
    // foil to the overlay plane (transparent BasicMaterial drawn on top
    // of the cover face) makes any foil color visible against any leather
    // color, with a single rendering path shared across leather, photo,
    // and acrylic variants.
    const leatherFrontMat = new THREE.MeshStandardMaterial({
      color: initialColor.clone(),
      roughness: 0.5,
      metalness: 0.1,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });

    // PHOTO FRONT — unlit emissive photo. color=black + emissiveMap=photo
    // means the photo prints at its true colors regardless of how the
    // book is rotated. Used by both photo and acrylic variants. The
    // photoSrc useEffect sets the texture and bumps emissiveIntensity to 1;
    // until then it's 0 so the empty material doesn't render as solid
    // white (emissive*null === pure white when no map masks the emit).
    const photoFrontMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 1,
      metalness: 0,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });

    // LEATHER BACK — plain leather panel. NO foil text (per the bug the
    // user filed earlier: "back side shows name need to remove"). Used by
    // leather + acrylic variants, and by photo variant when no
    // backPhotoSrc is set.
    const leatherBackMat = new THREE.MeshStandardMaterial({
      color: initialColor.clone(),
      roughness: 0.55,
      metalness: 0.1,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });

    // PHOTO BACK — unlit emissive, same treatment as photoFrontMat. Bound
    // to the back's -Z slot only when variant === 'photo' AND backPhotoSrc
    // is set. Otherwise leatherBackMat takes the slot. emissiveIntensity
    // starts at 0 to avoid the "all-white empty material" bug; the back-
    // photo useEffect raises it to 1 on texture load.
    const photoBackMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 1,
      metalness: 0,
      emissive: 0xffffff,
      emissiveIntensity: 0,
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

    // FRONT cover — 6-face material array. Slot 4 (+Z) is the visible
    // front. We start with leatherFrontMat there; the variant useEffect
    // swaps it to photoFrontMat for photo/acrylic. We never *mutate*
    // the material at this slot — only swap references.
    const frontMaterials = [
      mkSide(),         // 0 +X
      mkSide(),         // 1 -X
      mkSide(),         // 2 +Y
      mkSide(),         // 3 -Y
      leatherFrontMat,  // 4 +Z (visible front) — swapped per variant
      mkSide(),         // 5 -Z (inner face)
    ];

    // BACK cover — same pattern, slot 5 (-Z) is the visible back.
    const backMaterials = [
      mkSide(),        // 0 +X
      mkSide(),        // 1 -X
      mkSide(),        // 2 +Y
      mkSide(),        // 3 -Y
      mkSide(),        // 4 +Z (inner face)
      leatherBackMat,  // 5 -Z (visible back) — swapped per variant
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

    // Foil-text overlay plane — sits just in front of the cover face and
    // carries the same foilFrontTex used for leather covers. For photo /
    // acrylic covers we can't bake the foil into the cover material
    // (those slots hold the user's photo), so the title rides on this
    // plane instead. Material is BasicMaterial: tone-mapped off so the
    // foil stays its true color and unlit so rotation doesn't dim the
    // text. depthWrite:false prevents the transparent quad from
    // occluding the acrylic sheen behind it.
    const foilOverlayGeom = new THREE.PlaneGeometry(BOOK_W, BOOK_H);
    const foilOverlayMat = new THREE.MeshBasicMaterial({
      map: foilFrontTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    const foilOverlay = new THREE.Mesh(foilOverlayGeom, foilOverlayMat);
    // Z position: cover front face is at PAGE_D/2 + COVER_T (= ~0.045).
    // Sit a hair in front of it. Acrylic sheen lives at +0.007 further
    // out so the title shows *between* photo and glass, which matches
    // real "photo behind acrylic" production.
    foilOverlay.position.set(0, 0, PAGE_D / 2 + COVER_T + 0.001);
    // Hidden by default; the variant useEffect toggles it.
    foilOverlay.visible = false;

    const book = new THREE.Group();
    book.add(cover, back, pages, spine, foilOverlay);
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

    // Drag handler — branches at pointerdown into ROTATE or PAN based on
    // cropModeRef. The chosen mode sticks for the duration of the gesture
    // so a mid-drag cropMode toggle can't switch modes under the user.
    let isDragging = false;
    let dragMode: 'rotate' | 'pan' = 'rotate';
    let prevX = 0;
    let prevY = 0;
    let velY = 0;
    let velX = 0;
    let panStartPhotoX = 0;
    let panStartPhotoY = 0;
    let panStartClientX = 0;
    let panStartClientY = 0;
    function onPointerDown(e: PointerEvent) {
      isDragging = true;
      dragMode = cropModeRef.current ? 'pan' : 'rotate';
      prevX = e.clientX;
      prevY = e.clientY;
      panStartClientX = e.clientX;
      panStartClientY = e.clientY;
      panStartPhotoX = photoXRef.current;
      panStartPhotoY = photoYRef.current;
      // Kill any inertial spin so the book doesn't drift during a pan.
      if (dragMode === 'pan') {
        velY = 0;
        velX = 0;
      }
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDragging) return;
      if (dragMode === 'pan') {
        // Pan: report cumulative offset to the parent. Pixel-for-pixel
        // mapping in the CSS_COVER_REF_PX coordinate space — the parent
        // owns the value and feeds it back via photoX/photoY props.
        const px = panStartPhotoX + (e.clientX - panStartClientX);
        const py = panStartPhotoY + (e.clientY - panStartClientY);
        onPhotoPanRef.current?.(px, py);
        return;
      }
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

    // Wheel-zoom for the photo, but only while the user is in crop mode.
    // Outside crop mode the wheel is left alone so the page can scroll
    // normally over the canvas. Native listener with passive:false because
    // calling preventDefault() inside React's synthetic onWheel is a
    // silent no-op since React 17.
    function onWheelNative(ev: WheelEvent) {
      if (!cropModeRef.current) return;
      if (!onPhotoZoomRef.current) return;
      ev.preventDefault();
      // Cursor position normalized to the canvas — used by the parent to
      // pivot the zoom around the mouse instead of around photo-center.
      const rect = renderer.domElement.getBoundingClientRect();
      const cu = (ev.clientX - rect.left) / rect.width;
      const cv = (ev.clientY - rect.top) / rect.height;
      const direction = ev.deltaY > 0 ? -1 : 1;
      onPhotoZoomRef.current(direction, cu, cv);
    }
    renderer.domElement.addEventListener('wheel', onWheelNative, { passive: false });

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
      renderer.domElement.removeEventListener('wheel', onWheelNative);
      coverGeom.dispose();
      backGeom.dispose();
      pageGeom.dispose();
      spineGeom.dispose();
      foilOverlayGeom.dispose();
      foilOverlayMat.dispose();
      pageMat.dispose();
      leatherFrontMat.dispose();
      photoFrontMat.dispose();
      leatherBackMat.dispose();
      photoBackMat.dispose();
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
      leatherFrontMat,
      photoFrontMat,
      leatherBackMat,
      photoBackMat,
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
      foilOverlay,
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
  // Touches every leather-bearing material, but NEVER the photo materials
  // — those have their own color (black) that mustn't be tinted.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const c = new THREE.Color(leatherHex);
    r.leatherFrontMat.color.copy(c);
    r.leatherBackMat.color.copy(c);
    r.spineMat.color.copy(c);
    r.sideLeatherMats.forEach((m) => m.color.copy(c));
    if (r.acrylicStrip) {
      (r.acrylicStrip.material as THREE.MeshStandardMaterial).color.copy(c);
    }
  }, [leatherHex]);

  // ─── FOIL CANVAS REPAINT ─────────────────────────────────────
  // The foil canvas drives the foilOverlay plane's texture (a transparent
  // BasicMaterial with map=foilFrontTex). Repaint triggers on any user
  // pick that affects the rendered title — text, font, size, position, or
  // color. The overlay handles foil for ALL three cover variants, so this
  // effect doesn't care which variant is active.
  // Single source of truth for the title texture. ANY user pick that
  // affects the rendered title (text, font, size, position, color) goes
  // through here. Earlier we had multiple useEffects each with partial
  // deps, which is how the font/size/position pickers ended up dead —
  // their deps weren't listed anywhere, so canvas never got repainted
  // when they changed. Consolidating prevents that whole class of bug.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    paintFoilCanvas(
      r.foilFrontCanvas,
      title,
      subtitle,
      foilHex,
      fontFamily,
      fontStyle,
      fontSizePx,
      position,
    );
    r.foilFrontTex.needsUpdate = true;
  }, [title, subtitle, foilHex, fontFamily, fontStyle, fontSizePx, position]);

  // ─── REACT TO VARIANT ────────────────────────────────────────
  // Variant effect ONLY swaps which material is bound to the visible
  // slot. It does NOT mutate the materials themselves — that's owned by
  // each prop effect. Net result: switching from photo → leather no
  // longer "carries over" black base color or null normal-map state.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const coverMats = r.cover.material as THREE.Material[];
    const backMats = r.back.material as THREE.Material[];

    if (variant === 'leather') {
      coverMats[4] = r.leatherFrontMat;
      backMats[5] = r.leatherBackMat;
      // Spine = leather (color/normal already set by leatherHex effect).
      r.spineMat.map = null;
      r.spineMat.normalMap = r.normalTex;
      r.spineMat.color.set(leatherHex);
      r.spineMat.needsUpdate = true;
    } else if (variant === 'photo') {
      coverMats[4] = r.photoFrontMat;
      // Back: photo if user uploaded one, else leather.
      backMats[5] = r.backPhotoTex ? r.photoBackMat : r.leatherBackMat;
      // Spine = linen fabric (photo books typically have a fabric spine).
      r.spineMat.map = r.fabricTex;
      r.spineMat.normalMap = null;
      r.spineMat.color.set(0x2a2520);
      r.spineMat.needsUpdate = true;
    } else {
      // acrylic
      coverMats[4] = r.photoFrontMat;
      backMats[5] = r.leatherBackMat;
      // Spine = leather (acrylic books have a leather binding panel).
      r.spineMat.map = null;
      r.spineMat.normalMap = r.normalTex;
      r.spineMat.color.set(leatherHex);
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
      // Owner spec: the acrylic gloss was washing photos out. Shrink the
      // highlight to a thin top band and drop opacity to ~4%, so the
      // photo prints/previews with its true colour and the "glass" cue
      // is just a faint top edge instead of a face-wide wash.
      const sheenH = BOOK_H * 0.22;
      const sheenGeom = new THREE.PlaneGeometry(sheenW, sheenH);
      const sheenMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const sheen = new THREE.Mesh(sheenGeom, sheenMat);
      sheen.position.set(
        stripW / 2,
        BOOK_H / 2 - sheenH / 2 - BOOK_H * 0.04,
        PAGE_D / 2 + COVER_T + COVER_T * 0.5,
      );
      r.book.add(sheen);
      r.acrylicSheen = sheen;
    }
    if (r.acrylicStrip) r.acrylicStrip.visible = needsAcrylic;
    if (r.acrylicSheen) r.acrylicSheen.visible = needsAcrylic;

    // Foil title overlay: visible for ALL variants. Leather no longer
    // carries the foil on its own material (the emissive approach broke
    // for dark foil on light leather), so the overlay is the single
    // rendering path for foil text across leather, photo, and acrylic.
    r.foilOverlay.visible = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  // ─── REACT TO PHOTO SRC ──────────────────────────────────────
  // Only touches photoFrontMat. When photoSrc is cleared, we drop the
  // texture from photoFrontMat — but leatherFrontMat is untouched, so
  // switching back to the leather variant Just Works.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (!photoSrc || variant === 'leather') {
      if (r.photoTex) {
        r.photoTex.dispose();
        r.photoTex = null;
      }
      r.photoFrontMat.map = null;
      r.photoFrontMat.emissiveMap = null;
      // Drop intensity to 0 so the empty material renders as black,
      // not solid white. (See photoFrontMat construction comment.)
      r.photoFrontMat.emissiveIntensity = 0;
      r.photoFrontMat.needsUpdate = true;
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(
      photoSrc,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        applyPhotoTransform(tex, photoScale, photoX, photoY);
        if (r.photoTex) r.photoTex.dispose();
        r.photoTex = tex;
        r.photoFrontMat.map = null;
        r.photoFrontMat.emissiveMap = tex;
        r.photoFrontMat.emissiveIntensity = 1;
        r.photoFrontMat.needsUpdate = true;
      },
      undefined,
      (err) => {
        // Texture load failed — surface to console so the dev can see
        // the photo never made it. Common cause: the image URL 404s, or
        // CORS headers are missing on the /api/photo proxy.
        console.warn('Album3D: failed to load cover photo', photoSrc, err);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSrc, variant]);

  // ─── REACT TO BACK PHOTO SRC ─────────────────────────────────
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const backMats = r.back.material as THREE.Material[];

    if (!backPhotoSrc || variant === 'leather' || variant === 'acrylic') {
      // Drop the back photo texture; bind the leather back material.
      // photoBackMat retains its (now unused) settings — no mutation of
      // leatherBackMat needed.
      if (r.backPhotoTex) {
        r.backPhotoTex.dispose();
        r.backPhotoTex = null;
      }
      r.photoBackMat.map = null;
      r.photoBackMat.emissiveMap = null;
      r.photoBackMat.emissiveIntensity = 0;
      r.photoBackMat.needsUpdate = true;
      backMats[5] = r.leatherBackMat;
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(
      backPhotoSrc,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 8;
        // Aspect-correct (no zoom/pan UI for back yet).
        applyPhotoTransform(tex, 1, 0, 0);
        if (r.backPhotoTex) r.backPhotoTex.dispose();
        r.backPhotoTex = tex;
        r.photoBackMat.map = null;
        r.photoBackMat.emissiveMap = tex;
        r.photoBackMat.emissiveIntensity = 1;
        r.photoBackMat.needsUpdate = true;
        // Bind photoBackMat into the back face slot.
        backMats[5] = r.photoBackMat;
      },
      undefined,
      (err) => {
        console.warn('Album3D: failed to load back-cover photo', backPhotoSrc, err);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backPhotoSrc, variant]);

  // ─── REACT TO PHOTO ZOOM / PAN (smooth, no rebuild) ──────────
  useEffect(() => {
    const r = refs.current;
    if (!r?.photoTex) return;
    applyPhotoTransform(r.photoTex, photoScale, photoX, photoY);
  }, [photoScale, photoX, photoY]);

  // Initial render is handled by the consolidated FOIL CANVAS REPAINT
  // effect above — every dep is fresh on mount, so it paints the foil
  // canvas exactly once before the first render commits.

  const stageStyle: CSSProperties = { width };

  return (
    <div className={`album-three-wrap ${className}`}>
      <div ref={mountRef} className="album-three-stage" style={stageStyle} />
      {caption && <p className="album-three-caption">{caption}</p>}
    </div>
  );
}
