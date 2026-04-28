'use client';

import { useState, type CSSProperties } from 'react';
import './cover-builder.css';

/**
 * CoverBuilder — final step of the album designer.
 *
 * Renders after the client finishes their spreads. Lets them pick:
 *   - Cover type: leather (with foil stamp), acrylic (photo-inside), or photo
 *     (full-bleed photo with 3D tactile printing).
 *   - Type-specific options (leather color, photo selection for acrylic/photo).
 *   - Primary text + subtitle, font (10 options), color/foil, position.
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

const initialState: CoverState = {
  type: 'leather',
  leatherColor: 'black',
  photoSrc: null,
  primaryText: 'Sarah & James',
  subtitleText: 'September 2024',
  fontId: 'cormorant',
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

export default function CoverBuilder({ uploadedPhotos, onBack, onContinue }: CoverBuilderProps) {
  const [state, setState] = useState<CoverState>(initialState);

  const update = <K extends keyof CoverState>(key: K, value: CoverState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

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
                      fontSize: 'clamp(28px, 5vw, 56px)',
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
                      fontSize: 'clamp(11px, 1.4vw, 16px)',
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
              {uploadedPhotos.length === 0 ? (
                <p className="cover-hint">
                  No photos uploaded yet. Go back to spreads, upload some
                  photos, then return.
                </p>
              ) : (
                <div className="cover-photo-grid">
                  {uploadedPhotos.map((p) => (
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
              )}
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
