'use client';

import { useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
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

const initialState: CoverState = {
  type: 'leather',
  leatherColor: 'black',
  photoSrc: null,
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
 * Mouse-tilt: clamp how far the cover rotates so colors stay readable.
 * ±8 degrees is the sweet spot — enough to feel responsive, not enough
 * to obscure leather color or photo content.
 */
const TILT_MAX_DEG = 8;

export default function CoverBuilder({ uploadedPhotos, onBack, onContinue }: CoverBuilderProps) {
  const [state, setState] = useState<CoverState>(initialState);
  const [coverOpen, setCoverOpen] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extraCoverPhotos, setExtraCoverPhotos] = useState<{ id: string; src: string }[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

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
   * Mouse-tilt handler. Maps cursor position within the stage to
   * rotateX / rotateY values written to CSS custom properties. The
   * rotation is gentle (±TILT_MAX_DEG) and skipped while the cover is
   * open so the user can read the inside placeholder.
   */
  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (coverOpen) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5..+0.5
    const dy = (e.clientY - rect.top) / rect.height - 0.5;
    const ry = dx * TILT_MAX_DEG * 2;        // rotate Y from horizontal cursor pos
    const rx = -dy * TILT_MAX_DEG * 2;       // rotate X from vertical (negate so up = up)
    stage.style.setProperty('--tx', rx.toFixed(2) + 'deg');
    stage.style.setProperty('--ty', ry.toFixed(2) + 'deg');
  }

  function handleMouseLeave() {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty('--tx', '0deg');
    stage.style.setProperty('--ty', '0deg');
  }

  // Acrylic + photo preview backgrounds use the picked photo. Acrylic adds a
  // subtle gloss overlay to suggest the transparent acrylic sheen on top.
  const photoBackdrop = state.photoSrc ? (
    <img
      src={state.photoSrc}
      alt=""
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        // Acrylic mode: no filter, the gloss overlay is added via ::after.
        // Photo mode: subtle contrast bump to suggest the 3D tactile finish.
        filter: state.type === 'photo' ? 'contrast(1.05) saturate(1.05)' : 'none',
      }}
      draggable={false}
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
          Continue to Submit →
        </button>
      </div>

      <div className="cover-grid">
        {/* LIVE PREVIEW (LEFT) */}
        <div className="cover-preview-panel">
          <div
            className={'cover-stage' + (coverOpen ? ' is-open' : '') + (uploadingCover ? ' is-uploading' : '')}
            ref={stageRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onDragOver={handleStageDragOver}
            onDrop={handleStageDrop}
          >
            {/* Ground shadow — sits under the book, suggests weight. */}
            <div className="cover-ground-shadow" />

            {/* Inside spread placeholder — visible when cover swings open. */}
            <div className="cover-inside">
              <span>Your first spread</span>
              <div className="cover-inside-title">{state.primaryText}</div>
              <span>Lay-flat binding</span>
            </div>

            {/* Spine — the book's left edge, rotated into 3D. */}
            <div className="cover-spine" />

            {/* Page edges — the stacked-paper look at the right & bottom. */}
            <div className="cover-page-edge-right" />
            <div className="cover-page-edge-bottom" />

            {/* The cover itself, hinged on the left so it can swing open. */}
            <div className="cover-preview-frame">
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

                {/* "+ Add photo" button — rendered directly on the cover face
                    when there's no photo set. Click opens the native file
                    picker (iOS surfaces the camera roll, desktop opens the
                    file dialog). On Leather we pre-switch to Photo Cover so
                    the upload actually lands somewhere visible. */}
                {!state.photoSrc && (
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

                {/* Title text */}
                <div
                  className="cover-title-block"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    ...positionStyle,
                    textAlign: 'center',
                    width: '80%',
                    pointerEvents: 'none',
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

          {/* Type-specific options */}
          {state.type === 'leather' && (
            <section className="cover-section">
              <h3 className="cover-section-title">Leather Color</h3>
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
          )}

          {(state.type === 'acrylic' || state.type === 'photo') && (
            <section className="cover-section">
              <h3 className="cover-section-title">
                {state.type === 'acrylic' ? 'Photo Behind Acrylic' : 'Cover Photo'}
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
                        onClick={() => update('photoSrc', p.src)}
                      >
                        <img src={p.src} alt="" />
                      </button>
                    ))}
                  </div>
                );
              })()}
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
          {state.type === 'leather' && (
            <section className="cover-section">
              <h3 className="cover-section-title">Foil Color</h3>
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
