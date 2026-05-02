'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import './cover-builder.css';

/**
 * Optimize + upload a single file directly from the cover step.
 *
 * Mirrors the optimize logic in `public/js/album-builder.js`'s optimizeImage:
 * resize so long edge ≤ 4500 px, recompress as JPEG Q90. Skips files already
 * below 1.5 MB. Falls back to <canvas> if OffscreenCanvas is unavailable
 * (older iOS Safari).
 *
 * Endpoint contract matches /api/upload's response: { id, url, key, ... }.
 * We store the photo under designId="cover" so the R2 prefix stays separate
 * from spread photos until login attaches everything to a real user id.
 */
const MAX_LONG_EDGE = 4500;
const QUALITY = 0.9;
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;

async function optimizeForUpload(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  if (file.size < SKIP_BELOW_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const longEdge = Math.max(bitmap.width, bitmap.height);
  const ratio = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  let blob: Blob | null = null;
  try {
    if (useOffscreen) {
      blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: 'image/jpeg',
        quality: QUALITY,
      });
    } else {
      blob = await new Promise<Blob | null>((res) =>
        (canvas as HTMLCanvasElement).toBlob(res, 'image/jpeg', QUALITY),
      );
    }
  } catch {
    return file;
  }
  if (!blob || blob.size >= file.size) return file;

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'cover';
  return new File([blob], baseName + '.jpg', {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

/**
 * CoverBuilder — final step of the album designer.
 *
 * Renders after the client finishes their spreads. Lets them pick:
 *   - Cover type: leather (with foil stamp), acrylic (photo-inside), or photo
 *     (full-bleed photo with 3D tactile printing).
 *   - Type-specific options (leather color, photo selection for acrylic/photo).
 *   - Primary text + subtitle, font (10 options), font size, color/foil, position.
 *
 * The preview is a 3D scene: book with thickness, spine, page edges,
 * weight shadow, gentle mouse-tilt, and an open-cover toggle that
 * peeks at the first spread. CSS does most of the work; this component
 * just maintains state and feeds CSS variables for tilt.
 *
 * Lives in React state — independent from the legacy album-builder.js that
 * tracks spread state on window. The submit flow combines both into a
 * single payload (see onContinue callback).
 *
 * No business pricing here yet — checkout (Task #6) reads cover type +
 * option to compute the line-item price from a config file.
 */

type CoverType = 'leather' | 'acrylic' | 'photo';
type Position = 'top' | 'center' | 'lower';

export type CoverState = {
  type: CoverType;
  leatherColor: string;     // only meaningful when type === 'leather'
  photoSrc: string | null;  // only meaningful when type === 'acrylic' | 'photo'
  /**
   * Back-cover photo for the photo cover variant only. `null` means
   * "use the same photo as the front" — the most common case, so it's
   * the default. The user opts into a different back via the controls
   * panel. Acrylic covers don't read this field; their back is a leather
   * binding panel.
   */
  backPhotoSrc: string | null;
  // Cover-photo crop transforms. The photo is rendered with
  //   transform: translate(photoX px, photoY px) scale(photoScale)
  // so the user can pinch/drag/zoom to choose which part of the image
  // sits on the printed cover. Reset on every new upload.
  photoScale: number;
  photoX: number;
  photoY: number;
  primaryText: string;
  subtitleText: string;
  fontId: string;
  fontSize: number;         // primary text size in px (24-96 range)
  foilColor: string;        // only meaningful when type === 'leather'
  textColor: string;        // only meaningful when type === 'photo'
  position: Position;
};

/**
 * 10 cover fonts — loaded via Google Fonts in src/app/layout.tsx so they're
 * available everywhere on the site (including the live preview here).
 *
 * Mix is intentional: 3 classic serifs, 1 Roman caps, 4 scripts, 1 modern
 * sans, 1 traditional book serif. Covers most wedding aesthetics.
 */
const FONTS: { id: string; label: string; family: string; style?: 'normal' | 'italic' }[] = [
  { id: 'cormorant',         label: 'Cormorant',        family: '"Cormorant Garamond", serif' },
  { id: 'cormorant-italic',  label: 'Cormorant Italic', family: '"Cormorant Garamond", serif', style: 'italic' },
  { id: 'playfair',          label: 'Playfair',         family: '"Playfair Display", serif' },
  { id: 'cinzel',            label: 'Cinzel',           family: '"Cinzel", serif' },
  { id: 'italianno',         label: 'Italianno',        family: '"Italianno", cursive' },
  { id: 'great-vibes',       label: 'Great Vibes',      family: '"Great Vibes", cursive' },
  { id: 'allura',            label: 'Allura',           family: '"Allura", cursive' },
  { id: 'dancing-script',    label: 'Dancing Script',   family: '"Dancing Script", cursive' },
  { id: 'bebas-neue',        label: 'Bebas Neue',       family: '"Bebas Neue", sans-serif' },
  { id: 'old-standard',      label: 'Old Standard',     family: '"Old Standard TT", serif' },
];

const LEATHER_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'black',    label: 'Black',    hex: '#1a1816' },
  { id: 'brown',    label: 'Brown',    hex: '#5a3a1a' },
  { id: 'ivory',    label: 'Ivory',    hex: '#f0e6d2' },
  { id: 'burgundy', label: 'Burgundy', hex: '#5e1014' },
];

const FOIL_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'gold',      label: 'Gold',      hex: '#d4b07a' },
  { id: 'silver',    label: 'Silver',    hex: '#c8c8cc' },
  { id: 'rose-gold', label: 'Rose Gold', hex: '#b76e79' },
  { id: 'black',     label: 'Black',     hex: '#0e0c09' },
];

const PHOTO_TEXT_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'black', label: 'Black', hex: '#0e0c09' },
  { id: 'gold',  label: 'Gold',  hex: '#d4b07a' },
];

const FONT_SIZE_MIN = 24;
const FONT_SIZE_MAX = 96;
const FONT_SIZE_DEFAULT = 52;

// Cover photo scale floor.
// `1` = photo exactly fills the cover frame (object-fit:cover baseline).
// Anything below would shrink the photo inside the wrapper and reveal the
// dark cover background at the edges — looks like an unintentional border
// on the printed acrylic / photo cover. So scale is clamped to ≥ 1.
// Customers can still zoom IN to crop tighter (up to PHOTO_SCALE_MAX).
const PHOTO_SCALE_MIN = 1;
const PHOTO_SCALE_MAX = 3;

const initialState: CoverState = {
  type: 'leather',
  leatherColor: 'black',
  photoSrc: null,
  backPhotoSrc: null,
  photoScale: 1,
  photoX: 0,
  photoY: 0,
  primaryText: 'Sarah & James',
  subtitleText: 'September 2024',
  fontId: 'cormorant',
  fontSize: FONT_SIZE_DEFAULT,
  foilColor: 'gold',
  textColor: 'white',
  position: 'center',
};

interface CoverBuilderProps {
  /** Photos already uploaded by the client, available for acrylic/photo covers. */
  uploadedPhotos: { id: string; src: string }[];
  onBack: () => void;
  onContinue: (cover: CoverState) => void;
}

/**
 * Drag-to-rotate constants.
 *
 * Y is effectively unbounded so the user can spin the book all the way
 * around and inspect the back face (which is its own design — leather
 * for leather covers, photo for photo covers). 720° of accumulated angle
 * is a soft cap; nobody drags past two full spins.
 *
 * X stays clamped (±28°) so the book can't be flipped upside-down — that
 * looks awkward and there's no useful information past that tilt.
 */
const REST_ROTATE_X_DEG = 2;
const REST_ROTATE_Y_DEG = -12;
const ROTATE_X_RANGE_DEG = 28;
const ROTATE_Y_RANGE_DEG = 720;
const DRAG_SENSITIVITY = 0.5;

/**
 * localStorage keys.
 *   COVER_LS_KEY — cover-builder state (CoverState).
 *   PHOTOS_LS_KEY — photos uploaded directly from the cover step
 *                   (so they survive refresh in the photo grid).
 *
 * Versioning prevents stale shapes from breaking new builds: bump v on
 * incompatible schema changes and reads will fall back to defaults.
 */
const COVER_LS_KEY = 'folio-cover-v1';
const COVER_PHOTOS_LS_KEY = 'folio-cover-photos-v1';

function loadCoverState(): CoverState {
  if (typeof window === 'undefined') return initialState;
  try {
    const raw = window.localStorage.getItem(COVER_LS_KEY);
    if (!raw) return initialState;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !data.state) return initialState;
    const merged = { ...initialState, ...data.state } as CoverState;
    // Heal legacy drafts that were saved when scale < 1 was permitted.
    // Clamp to the current floor so the photo always fills the cover.
    if (typeof merged.photoScale !== 'number' || !Number.isFinite(merged.photoScale)) {
      merged.photoScale = 1;
    } else if (merged.photoScale < PHOTO_SCALE_MIN) {
      merged.photoScale = PHOTO_SCALE_MIN;
    } else if (merged.photoScale > PHOTO_SCALE_MAX) {
      merged.photoScale = PHOTO_SCALE_MAX;
    }
    return merged;
  } catch {
    return initialState;
  }
}

function loadCoverPhotos(): { id: string; src: string }[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COVER_PHOTOS_LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.photos)) return [];
    return data.photos;
  } catch {
    return [];
  }
}

export default function CoverBuilder({ uploadedPhotos, onBack, onContinue }: CoverBuilderProps) {
  // Lazy initializers read once from localStorage on mount. Subsequent
  // updates are flushed back via the useEffects below.
  const [state, setState] = useState<CoverState>(loadCoverState);
  const [coverOpen, setCoverOpen] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extraCoverPhotos, setExtraCoverPhotos] = useState<{ id: string; src: string }[]>(loadCoverPhotos);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

  // Drag-to-rotate state. Rotation lives in refs (no re-render per pointermove);
  // isDragging is state because we use it for the cursor className.
  const [isDragging, setIsDragging] = useState(false);
  const rotXRef = useRef<number>(REST_ROTATE_X_DEG);
  const rotYRef = useRef<number>(REST_ROTATE_Y_DEG);
  const dragStartRef = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);

  /**
   * Crop mode — gates whether the photo (when present) is draggable for
   * cropping or whether the entire cover acts as a rotation handle.
   *
   * Default OFF: rotate-anywhere is the dominant gesture (the user's first
   * instinct when they see a 3D book is to grab and turn it). Photo panning
   * is opt-in via the "Adjust crop" toggle. Without this gate the photo's
   * mousedown handler swallows the user's rotation drag and the photo
   * "dislocates" instead of the album rotating.
   */
  const [cropMode, setCropMode] = useState(false);

  // Persist whenever cover state changes — names, fonts, position, photo
  // crop transforms, everything. localStorage write is synchronous but
  // tiny (~1 kB) so no debounce needed at this scale.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        COVER_LS_KEY,
        JSON.stringify({ v: 1, state, savedAt: new Date().toISOString() }),
      );
    } catch {
      // Storage disabled / quota — silently fall through.
    }
  }, [state]);

  // Mirror the latest cover state onto window.__coverState so
  // album-builder.js's serializeDesign() can pick it up the moment
  // the user clicks Save & Share — even if they never went through
  // the formal "Continue from cover" transition. Without this,
  // /album/<token> would render the default "Our Story" cover for
  // anyone who designed cover then jumped straight back to spreads.
  useEffect(() => {
    try {
      (window as unknown as { __coverState?: CoverState }).__coverState = state;
    } catch {
      /* non-blocking — viewer falls back to defaults if missing */
    }
  }, [state]);

  // Persist the cover-direct upload list separately from CoverState so the
  // photo grid keeps its history even if state is reset.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        COVER_PHOTOS_LS_KEY,
        JSON.stringify({ v: 1, photos: extraCoverPhotos }),
      );
    } catch {}
  }, [extraCoverPhotos]);

  const update = <K extends keyof CoverState>(key: K, value: CoverState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * Upload a file picked from the file input or dropped on the preview.
   * Optimizes client-side, posts to /api/upload, and on success:
   *   - sets state.photoSrc so the preview reflects it immediately
   *   - adds the new photo to extraCoverPhotos so it's selectable later
   *   - if the user is currently on Leather, switches them to Photo Cover
   *     (uploading a photo on a leather cover would have no effect otherwise)
   */
  async function uploadCoverPhoto(file: File) {
    if (!file) return;
    setUploadError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setUploadError('JPG, PNG, or WEBP only');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setUploadError('Max 30 MB per photo');
      return;
    }
    setUploadingCover(true);
    try {
      const opt = await optimizeForUpload(file);
      const fd = new FormData();
      fd.append('file', opt);
      fd.append('designId', 'cover');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { id: string; url: string };
      setExtraCoverPhotos((prev) => [{ id: data.id, src: data.url }, ...prev]);
      setState((prev) => ({
        ...prev,
        photoSrc: data.url,
        // Reset crop transforms so the new photo starts cleanly fitted.
        photoScale: 1,
        photoX: 0,
        photoY: 0,
        // If user is on leather, switch to photo cover so the upload is visible.
        type: prev.type === 'leather' ? 'photo' : prev.type,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      console.warn('Cover upload failed', msg);
      setUploadError(msg);
    } finally {
      setUploadingCover(false);
    }
  }

  function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void uploadCoverPhoto(f);
    // Reset so the same file can be re-picked.
    e.target.value = '';
  }

  /**
   * Triggered by the "+" button overlaid on the cover preview. Opens the
   * native file picker; on mobile this surfaces the camera roll. If the
   * user is on Leather (no photo slot), pre-switch to Photo Cover so the
   * resulting upload is actually used.
   */
  function openCoverPicker() {
    if (state.type === 'leather') {
      setState((prev) => ({ ...prev, type: 'photo' }));
    }
    coverFileInputRef.current?.click();
  }

  /**
   * Drag-to-pan on the cover photo. Captures mousedown, tracks delta on
   * window-level mousemove (so the drag survives leaving the photo bounds),
   * releases on mouseup. While dragging we set --tx/--ty to 0 so the
   * mouse-tilt doesn't fight the pan.
   */
  function handlePhotoMouseDown(e: MouseEvent<HTMLImageElement>) {
    if (e.button !== 0) return;
    // Photo pan only fires in crop mode. In normal mode the user expects
    // dragging the photo to rotate the album.
    if (!cropMode) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPx = state.photoX;
    const startPy = state.photoY;
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty('--tx', '0deg');
      stage.style.setProperty('--ty', '0deg');
    }
    const onMove = (ev: globalThis.MouseEvent) => {
      setState((prev) => ({
        ...prev,
        photoX: startPx + (ev.clientX - startX),
        photoY: startPy + (ev.clientY - startY),
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /**
   * Wheel zoom over the photo. preventDefault so the page doesn't scroll
   * while the user is fine-tuning the crop. Step is small (4%) so it feels
   * like a precise adjustment, not a jump.
   */
  function handlePhotoWheel(e: React.WheelEvent<HTMLImageElement>) {
    e.preventDefault();
    e.stopPropagation();
    setState((prev) => {
      const next = prev.photoScale + (e.deltaY > 0 ? -0.04 : 0.04);
      return {
        ...prev,
        photoScale: Math.max(PHOTO_SCALE_MIN, Math.min(PHOTO_SCALE_MAX, next)),
      };
    });
  }

  /** Snap the photo back to fit the cover (no zoom, no pan). */
  function resetPhotoCrop() {
    setState((prev) => ({ ...prev, photoScale: 1, photoX: 0, photoY: 0 }));
  }

  // Drag-and-drop on the preview frame. We accept the first image dropped,
  // ignore non-image drops. Drop also flips type to photo if currently leather.
  function handleStageDragOver(e: DragEvent<HTMLDivElement>) {
    if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }
  function handleStageDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) void uploadCoverPhoto(file);
  }

  const font = FONTS.find((f) => f.id === state.fontId) ?? FONTS[0];

  // Derive what the preview shows based on cover type.
  const previewBackground = (() => {
    if (state.type === 'leather') {
      const c = LEATHER_COLORS.find((c) => c.id === state.leatherColor) ?? LEATHER_COLORS[0];
      return c.hex;
    }
    return '#0e0c09'; // dark fallback when no photo picked
  })();

  // Binding strip color — the leather wrap on the spine side of the cover.
  // Used for acrylic / photo covers where the binding is structurally
  // present as a thin left-edge strip. Same lookup as leather, just used
  // in a smaller surface area.
  const bindingHex =
    (LEATHER_COLORS.find((c) => c.id === state.leatherColor) ?? LEATHER_COLORS[0]).hex;

  const textHex = (() => {
    if (state.type === 'leather') {
      return FOIL_COLORS.find((f) => f.id === state.foilColor)?.hex ?? '#d4b07a';
    }
    if (state.type === 'photo') {
      return PHOTO_TEXT_COLORS.find((c) => c.id === state.textColor)?.hex ?? '#ffffff';
    }
    // acrylic — use a neutral white that contrasts with the photo behind glass
    return '#ffffff';
  })();

  // CSS-positioning of the title block within the cover preview.
  const positionStyle: CSSProperties = (() => {
    switch (state.position) {
      case 'top':    return { top: '10%',      bottom: 'auto',  transform: 'translateX(-50%)' };
      case 'lower':  return { top: 'auto',     bottom: '12%',   transform: 'translateX(-50%)' };
      case 'center':
      default:       return { top: '50%',      bottom: 'auto',  transform: 'translate(-50%, -50%)' };
    }
  })();

  /**
   * Drag-to-rotate.
   *
   * Pointer events instead of mouse events so touch + pen work too. We
   * write rotation directly to CSS variables (--tx / --ty) on the stage
   * — no React re-render per frame.
   *
   * Skipped when:
   *   - the cover is open (so the inside spread doesn't spin under the user)
   *   - the user grabs the cover photo (it has its own drag-to-pan crop;
   *     letting both fire would be a tug-of-war)
   */
  const applyRotation = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty('--tx', rotXRef.current.toFixed(2) + 'deg');
    stage.style.setProperty('--ty', rotYRef.current.toFixed(2) + 'deg');
  }, []);

  const clampX = (v: number) =>
    Math.max(REST_ROTATE_X_DEG - ROTATE_X_RANGE_DEG, Math.min(REST_ROTATE_X_DEG + ROTATE_X_RANGE_DEG, v));
  const clampY = (v: number) =>
    Math.max(REST_ROTATE_Y_DEG - ROTATE_Y_RANGE_DEG, Math.min(REST_ROTATE_Y_DEG + ROTATE_Y_RANGE_DEG, v));

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (coverOpen) return;
    // Skip ONLY when crop mode is on AND the user grabbed the photo —
    // then the photo's own pan handler should run instead. In normal
    // mode the entire cover (including the photo) is a rotate handle.
    if (cropMode) {
      const target = e.target as HTMLElement;
      if (target?.closest?.('.cover-photo-backdrop')) return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      rx: rotXRef.current,
      ry: rotYRef.current,
    };
    setIsDragging(true);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    rotYRef.current = clampY(start.ry + dx * DRAG_SENSITIVITY);
    rotXRef.current = clampX(start.rx - dy * DRAG_SENSITIVITY);
    applyRotation();
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const stage = stageRef.current;
    if (stage && stage.hasPointerCapture(e.pointerId)) {
      stage.releasePointerCapture(e.pointerId);
    }
    dragStartRef.current = null;
    setIsDragging(false);
  }

  // Acrylic + photo preview backgrounds use the picked photo. Acrylic adds a
  // subtle gloss overlay to suggest the transparent acrylic sheen on top.
  // Transform combines pan (translate) and zoom (scale) so the user can crop
  // the visible portion. transformOrigin is center so scale grows from middle.
  const photoBackdrop = state.photoSrc ? (
    <img
      src={state.photoSrc}
      alt=""
      className="cover-photo-backdrop"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `translate(${state.photoX}px, ${state.photoY}px) scale(${state.photoScale})`,
        transformOrigin: 'center center',
        // Acrylic mode: no filter, the gloss overlay is added via ::after.
        // Photo mode: subtle contrast bump to suggest the 3D tactile finish.
        filter: state.type === 'photo' ? 'contrast(1.05) saturate(1.05)' : 'none',
        cursor: 'grab',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
      draggable={false}
      onMouseDown={handlePhotoMouseDown}
      onWheel={handlePhotoWheel}
    />
  ) : (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted2)',
        fontSize: 11,
        letterSpacing: 2,
        textTransform: 'uppercase',
        textAlign: 'center',
        padding: 24,
      }}
    >
      Pick a photo from your uploads →
    </div>
  );

  // Subtitle is sized proportionally to the primary so the slider drives both.
  const subtitleSize = Math.max(10, Math.round(state.fontSize * 0.28));

  return (
    <div className="cover-builder-wrap">
      {/* TOOLBAR */}
      <div className="cover-toolbar">
        <button type="button" className="cover-back" onClick={onBack}>
          ← Back to Spreads
        </button>
        <span className="cover-step-title">Design Your Cover</span>
        <button
          type="button"
          className="cover-continue"
          onClick={() => onContinue(state)}
        >
          Preview album →
        </button>
      </div>

      <div className="cover-grid">
        {/* LIVE PREVIEW (LEFT) */}
        <div className="cover-preview-panel">
          <div
            className={
              'cover-stage' +
              (coverOpen ? ' is-open' : '') +
              (uploadingCover ? ' is-uploading' : '') +
              (isDragging ? ' is-dragging' : '') +
              (cropMode ? ' is-crop-mode' : '')
            }
            ref={stageRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDragOver={handleStageDragOver}
            onDrop={handleStageDrop}
          >
            {/* Ground shadow — sits flat under the book; outside the
             * preview-frame so it doesn't rotate with the book. */}
            <div className="cover-ground-shadow" />

            {/*
             * THE BOOK — preserve-3d rotation frame containing every face
             * (back cover, spine, three page edges, inside spread, front
             * cover). All children rotate as one solid object when the
             * user drags. This is the core of the "real 3D" rebuild.
             */}
            <div className="cover-preview-frame">
              {/*
               * BACK COVER — visible when the user rotates the book past
               * the side. Per cover type:
               *   - leather: same leather color as the front (one continuous
               *     leather wrap)
               *   - acrylic: the leather binding panel (acrylic is a framed
               *     photo-behind-glass on the front; the back is leather)
               *   - photo: another photo. Defaults to the same as the front
               *     ("photos front and back"). User can override via the
               *     back-cover picker.
               *
               * Class is `cover-backface` (not `cover-back`) because
               * `.cover-back` is already used by the "Back to Spreads"
               * toolbar button.
               */}
              <div
                className={
                  'cover-backface' +
                  // Photo cover with no back photo yet → show fabric so
                  // the empty back reads as part of the album, not a void.
                  (state.type === 'photo' && !state.backPhotoSrc
                    ? ' is-fabric'
                    : '')
                }
                style={{
                  background:
                    state.type === 'leather'
                      ? previewBackground
                      : state.type === 'acrylic'
                      ? bindingHex
                      : state.type === 'photo' && state.backPhotoSrc
                      ? '#0e0c09'  // photo: dark behind the photo (fallback)
                      : undefined,  // photo + no back: CSS .is-fabric supplies bg
                }}
              >
                {state.type === 'photo' && state.backPhotoSrc && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="cover-backface-photo"
                    src={state.backPhotoSrc}
                    alt=""
                    draggable={false}
                  />
                )}
                {/* Back-cover foil mark — small foil title flanked by
                 * thin rules. Renders for both leather AND acrylic covers
                 * since acrylic's back is also a leather binding panel
                 * (the acrylic is only on the front). Empty leather backs
                 * read as unfinished; a real album always has a stamp.
                 *
                 * Uses the user's foilColor so the back stamp is metallic
                 * (gold/silver/rose-gold/black foil), not the front-face
                 * textHex — which for acrylic is plain white text on the
                 * photo and would look wrong as a foil stamp. */}
                {(state.type === 'leather' || state.type === 'acrylic') &&
                  state.primaryText && (
                  <div
                    className="cover-back-mark"
                    style={{
                      color:
                        FOIL_COLORS.find((f) => f.id === state.foilColor)?.hex
                        ?? '#d4b07a',
                    }}
                  >
                    <span className="cover-back-rule" aria-hidden="true" />
                    <span
                      className="cover-back-title"
                      style={{
                        fontFamily: font.family,
                        fontStyle: font.style ?? 'normal',
                      }}
                    >
                      {state.primaryText}
                    </span>
                    <span className="cover-back-rule" aria-hidden="true" />
                  </div>
                )}
              </div>

              {/* SPINE — the perpendicular slab at the left.
               *
               * Per cover type:
               *   - leather: CSS default dark-leather gradient.
               *   - acrylic: leather-binding gradient (binding wraps from
               *     front-left strip onto the spine in the real product).
               *   - photo: woven fabric binding (linen/canvas material that
               *     holds two photo prints together — class is added so
               *     CSS supplies the weave texture; inline style only
               *     supplies the recessed-edge shadow.
               */}
              <div
                className={
                  'cover-spine' + (state.type === 'photo' ? ' is-fabric' : '')
                }
                style={
                  state.type === 'acrylic'
                    ? {
                        background: `linear-gradient(90deg,
                          rgba(0,0,0,0.65) 0%,
                          ${bindingHex} 40%,
                          ${bindingHex} 70%,
                          rgba(0,0,0,0.55) 100%)`,
                      }
                    : undefined
                }
              />

              {/* Page edges — three cream-paper slabs at right, top, bottom. */}
              <div className="cover-page-edge-right" />
              <div className="cover-page-edge-top" />
              <div className="cover-page-edge-bottom" />

              {/* Inside spread placeholder — visible when cover swings open. */}
              <div className="cover-inside">
                <span>Your first spread</span>
                <div className="cover-inside-title">{state.primaryText}</div>
                <span>Lay-flat binding</span>
              </div>

              {/* Front cover — what the user designs. Hinged on the left. */}
              <div
                className={'cover-preview cover-type-' + state.type}
                style={{ background: previewBackground }}
              >
                {(state.type === 'acrylic' || state.type === 'photo') && photoBackdrop}

                {/* Acrylic sheen overlay */}
                {state.type === 'acrylic' && <div className="cover-acrylic-sheen" />}

                {/* Leather grain overlay */}
                {state.type === 'leather' && <div className="cover-leather-grain" />}

                {/* 3D-touch indicator for photo cover */}
                {state.type === 'photo' && <div className="cover-tactile-overlay" />}

                {/* Leather binding strip — only on acrylic.
                    The acrylic cover is a clear photo-behind-glass with a
                    leather strip on the spine side that holds it to the
                    binding. The photo cover does NOT have a binding strip
                    (it's a full-bleed photo print, front and back).
                    z-index 2 puts it above the photo but below the title
                    so titles don't get clipped if positioned to the left.
                    pointer-events:none keeps the photo draggable behind. */}
                {state.type === 'acrylic' && (
                  <div
                    className="cover-binding-strip"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: '12%',
                      background: bindingHex,
                      boxShadow:
                        'inset -3px 0 8px rgba(0,0,0,0.5), inset 2px 0 3px rgba(255,255,255,0.06)',
                      pointerEvents: 'none',
                      zIndex: 2,
                    }}
                  />
                )}

                {/* "+ Add photo" button — rendered directly on the cover face
                    when there's no photo set, but ONLY for cover types that
                    actually use a photo (acrylic + photo). Leather is text +
                    foil only; showing + there is misleading. If the user is
                    on leather and wants to switch, they pick "Photo Cover"
                    or "Acrylic" from the controls panel. */}
                {!state.photoSrc &&
                  (state.type === 'acrylic' || state.type === 'photo') && (
                  <button
                    type="button"
                    className="cover-add-photo-btn"
                    onClick={openCoverPicker}
                    disabled={uploadingCover}
                    aria-label="Add cover photo"
                  >
                    <span className="cover-add-photo-plus">{uploadingCover ? '⋯' : '+'}</span>
                    <span className="cover-add-photo-label">
                      {uploadingCover ? 'Uploading' : 'Add photo'}
                    </span>
                  </button>
                )}

                {/* Title text. For acrylic/photo covers we shift the
                    horizontal anchor right by 6% so the title is centered
                    over the visible photo area (right 88%) instead of the
                    full cover face — otherwise the leather binding strip
                    would clip the left edge of long titles. Width is
                    reduced from 80% → 78% to keep a margin from the
                    binding edge. Leather covers stay centered as before. */}
                {(() => {
                  // Only acrylic covers have the leather binding strip on
                  // the front; the photo cover lost it in the rebuild.
                  // Title shifts right only when the binding strip is
                  // actually there.
                  const hasBinding = state.type === 'acrylic';
                  const titleLeft = hasBinding ? '56%' : '50%';
                  const titleWidth = hasBinding ? '78%' : '80%';
                  return (
                <div
                  className="cover-title-block"
                  style={{
                    position: 'absolute',
                    left: titleLeft,
                    ...positionStyle,
                    textAlign: 'center',
                    width: titleWidth,
                    pointerEvents: 'none',
                    zIndex: 3,
                  }}
                >
                  {state.primaryText && (
                    <div
                      style={{
                        fontFamily: font.family,
                        fontStyle: font.style ?? 'normal',
                        fontSize: state.fontSize + 'px',
                        fontWeight: 400,
                        color: textHex,
                        lineHeight: 1.1,
                        letterSpacing: state.fontId === 'cinzel' || state.fontId === 'bebas-neue' ? 4 : 1,
                        textShadow: state.type === 'photo'
                          ? '0 1px 4px rgba(0,0,0,0.5)'
                          : 'none',
                      }}
                    >
                      {state.primaryText}
                    </div>
                  )}
                  {state.subtitleText && (
                    <div
                      style={{
                        fontFamily: font.family,
                        fontStyle: font.style ?? 'normal',
                        fontSize: subtitleSize + 'px',
                        color: textHex,
                        letterSpacing: 3,
                        marginTop: 12,
                        opacity: 0.85,
                        textTransform: state.fontId === 'cinzel' ? 'uppercase' : 'none',
                        textShadow: state.type === 'photo'
                          ? '0 1px 3px rgba(0,0,0,0.5)'
                          : 'none',
                      }}
                    >
                      {state.subtitleText}
                    </div>
                  )}
                </div>
                  );
                })()}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="cover-open-toggle"
            onClick={() => setCoverOpen((v) => !v)}
          >
            {coverOpen ? 'Close cover' : 'Open the album'}
          </button>

          <p className="cover-preview-caption">
            Live preview · {state.type === 'leather' && 'Leather + foil stamp'}
            {state.type === 'acrylic' && 'Clear acrylic with photo inside'}
            {state.type === 'photo' && 'Full-bleed photo with 3D tactile finish'}
          </p>
        </div>

        {/* CONTROLS (RIGHT) */}
        <div className="cover-controls-panel">
          {/* Cover type */}
          <section className="cover-section">
            <h3 className="cover-section-title">Cover Type</h3>
            <div className="cover-type-grid">
              {(['leather', 'acrylic', 'photo'] as CoverType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={'cover-type-btn' + (state.type === t ? ' active' : '')}
                  onClick={() => update('type', t)}
                >
                  <span className="cover-type-name">
                    {t === 'leather' && 'Leather'}
                    {t === 'acrylic' && 'Acrylic'}
                    {t === 'photo' && 'Photo Cover'}
                  </span>
                  <span className="cover-type-desc">
                    {t === 'leather' && 'Premium hide · 4 colors · foil stamped text'}
                    {t === 'acrylic' && 'Clear acrylic · photo visible behind glass'}
                    {t === 'photo' && 'Your photo · 3D tactile printing'}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Leather / binding color picker.
              For 'leather' covers this is the leather body itself. For
              'acrylic' / 'photo' covers it controls the leather binding
              strip on the spine side of the cover (~12% of the front
              face) — same physical material, smaller surface. We reuse
              the same `leatherColor` field for both so we don't duplicate
              state, and so a customer who switches cover type doesn't
              lose their color choice. */}
          <section className="cover-section">
            <h3 className="cover-section-title">
              {state.type === 'leather' ? 'Leather Color' : 'Binding Color'}
            </h3>
            <div className="cover-swatch-row">
              {LEATHER_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'cover-swatch' + (state.leatherColor === c.id ? ' active' : '')}
                  style={{ background: c.hex }}
                  title={c.label}
                  onClick={() => update('leatherColor', c.id)}
                >
                  <span className="cover-swatch-label">{c.label}</span>
                </button>
              ))}
            </div>
          </section>

          {(state.type === 'acrylic' || state.type === 'photo') && (
            <section className="cover-section">
              <h3 className="cover-section-title">
                {state.type === 'acrylic'
                  ? 'Photo Behind Acrylic'
                  : 'Front Cover Photo'}
              </h3>

              {/* Upload button — always visible for these cover types. Triggers
                  hidden file input. Drag-drop on the preview is the alternative. */}
              <button
                type="button"
                className="cover-photo-upload-btn"
                onClick={() => coverFileInputRef.current?.click()}
                disabled={uploadingCover}
              >
                {uploadingCover ? 'Uploading…' : '+ Upload cover photo'}
              </button>
              <input
                ref={coverFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleCoverFileChange}
              />
              {uploadError && (
                <p className="cover-upload-error">{uploadError}</p>
              )}

              {/* Existing photos: spread-builder uploads first, cover-direct
                  uploads stacked above (most recent first). De-dupe by URL. */}
              {(() => {
                const merged = [...extraCoverPhotos, ...uploadedPhotos];
                const seen = new Set<string>();
                const uniq = merged.filter((p) => {
                  if (seen.has(p.src)) return false;
                  seen.add(p.src);
                  return true;
                });
                if (uniq.length === 0) {
                  return (
                    <p className="cover-hint">
                      Upload a photo above, or drag one onto the preview.
                    </p>
                  );
                }
                return (
                  <div className="cover-photo-grid">
                    {uniq.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={'cover-photo-thumb' + (state.photoSrc === p.src ? ' active' : '')}
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            photoSrc: p.src,
                            photoScale: 1,
                            photoX: 0,
                            photoY: 0,
                          }))
                        }
                      >
                        <img src={p.src} alt="" />
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* Crop controls — only show once a photo is set. By default
                  drag-on-preview rotates the album; the user toggles "Adjust
                  crop" below to put the preview into pan-and-zoom mode. */}
              {state.photoSrc && (
                <div className="cover-crop-controls">
                  <div className="cover-crop-row">
                    <span className="cover-crop-label">Zoom</span>
                    <input
                      type="range"
                      className="cover-crop-slider"
                      min={PHOTO_SCALE_MIN}
                      max={PHOTO_SCALE_MAX}
                      step={0.01}
                      value={state.photoScale}
                      onChange={(e) => update('photoScale', Number(e.target.value))}
                    />
                    <span className="cover-crop-val">
                      {Math.round(state.photoScale * 100)}%
                    </span>
                  </div>
                  <button
                    type="button"
                    className={'cover-crop-mode' + (cropMode ? ' is-on' : '')}
                    onClick={() => setCropMode((v) => !v)}
                    aria-pressed={cropMode}
                  >
                    {cropMode ? 'Done · back to rotate' : 'Adjust crop (drag photo)'}
                  </button>
                  <button
                    type="button"
                    className="cover-crop-reset"
                    onClick={resetPhotoCrop}
                    disabled={
                      state.photoScale === 1 &&
                      state.photoX === 0 &&
                      state.photoY === 0
                    }
                  >
                    Reset crop
                  </button>
                  <p className="cover-crop-hint">
                    {cropMode
                      ? 'Drag the photo to reposition. Scroll to zoom.'
                      : 'Drag the album to rotate. Toggle “Adjust crop” to pan the photo.'}
                  </p>
                </div>
              )}
            </section>
          )}

          {/*
           * Back cover photo — photo cover only.
           *
           * The photo cover is full-bleed photo on FRONT and BACK with a
           * fabric binding strip on the spine. Front and back are
           * independent picks — customer typically wants two different
           * images. Always shown alongside the front picker (not gated on
           * a front photo being set) so the customer can see the choice
           * upfront and pick in either order.
           */}
          {state.type === 'photo' && (
            <section className="cover-section">
              <h3 className="cover-section-title">Back Cover Photo</h3>
              {(() => {
                const merged = [...extraCoverPhotos, ...uploadedPhotos];
                const seen = new Set<string>();
                const uniq = merged.filter((p) => {
                  if (seen.has(p.src)) return false;
                  seen.add(p.src);
                  return true;
                });
                if (uniq.length === 0) {
                  return (
                    <p className="cover-hint">
                      Upload a photo in the front-cover section above, then
                      pick one here for the back.
                    </p>
                  );
                }
                return (
                  <div className="cover-photo-grid">
                    {uniq.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={
                          'cover-photo-thumb' +
                          (state.backPhotoSrc === p.src ? ' active' : '')
                        }
                        onClick={() => update('backPhotoSrc', p.src)}
                      >
                        <img src={p.src} alt="" />
                      </button>
                    ))}
                  </div>
                );
              })()}

              {state.backPhotoSrc && (
                <button
                  type="button"
                  className="cover-crop-reset"
                  style={{ marginTop: 10 }}
                  onClick={() => update('backPhotoSrc', null)}
                >
                  Clear back cover
                </button>
              )}

              <p className="cover-crop-hint" style={{ marginTop: 10 }}>
                {state.backPhotoSrc
                  ? 'Drag the album all the way around to see the back.'
                  : 'Pick a photo for the back of the album. It can be the same as the front, or completely different.'}
              </p>
            </section>
          )}

          {/* Text inputs */}
          <section className="cover-section">
            <h3 className="cover-section-title">Cover Text</h3>
            <label className="cover-field">
              <span>Names / title</span>
              <input
                type="text"
                value={state.primaryText}
                onChange={(e) => update('primaryText', e.target.value)}
                placeholder="Sarah &amp; James"
                maxLength={60}
              />
            </label>
            <label className="cover-field">
              <span>Subtitle (optional)</span>
              <input
                type="text"
                value={state.subtitleText}
                onChange={(e) => update('subtitleText', e.target.value)}
                placeholder="September 2024"
                maxLength={60}
              />
            </label>
          </section>

          {/* Font picker */}
          <section className="cover-section">
            <h3 className="cover-section-title">Font</h3>
            <div className="cover-font-grid">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={'cover-font-btn' + (state.fontId === f.id ? ' active' : '')}
                  onClick={() => update('fontId', f.id)}
                  style={{
                    fontFamily: f.family,
                    fontStyle: f.style ?? 'normal',
                  }}
                >
                  <span className="cover-font-sample">
                    {state.primaryText || 'Sarah & James'}
                  </span>
                  <span className="cover-font-name">{f.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Font size slider */}
          <section className="cover-section">
            <h3 className="cover-section-title">Font Size</h3>
            <div className="cover-fontsize-row">
              <input
                type="range"
                className="cover-fontsize-slider"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={state.fontSize}
                onChange={(e) => update('fontSize', Number(e.target.value))}
              />
              <span className="cover-fontsize-val">{state.fontSize}px</span>
            </div>
          </section>

          {/* Foil (leather) or text color (photo) */}
          {(state.type === 'leather' || state.type === 'acrylic') && (
            <section className="cover-section">
              <h3 className="cover-section-title">
                {state.type === 'leather' ? 'Foil Color' : 'Back Stamp Foil'}
              </h3>
              <div className="cover-swatch-row">
                {FOIL_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={'cover-swatch' + (state.foilColor === c.id ? ' active' : '')}
                    style={{ background: c.hex }}
                    title={c.label}
                    onClick={() => update('foilColor', c.id)}
                  >
                    <span className="cover-swatch-label">{c.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {state.type === 'photo' && (
            <section className="cover-section">
              <h3 className="cover-section-title">Text Color</h3>
              <div className="cover-swatch-row">
                {PHOTO_TEXT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={'cover-swatch' + (state.textColor === c.id ? ' active' : '')}
                    style={{ background: c.hex }}
                    title={c.label}
                    onClick={() => update('textColor', c.id)}
                  >
                    <span className="cover-swatch-label">{c.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Position */}
          <section className="cover-section">
            <h3 className="cover-section-title">Text Position</h3>
            <div className="cover-position-row">
              {(['top', 'center', 'lower'] as Position[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={'cover-position-btn' + (state.position === p ? ' active' : '')}
                  onClick={() => update('position', p)}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
