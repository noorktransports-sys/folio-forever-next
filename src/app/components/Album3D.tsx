'use client';

import { type CSSProperties } from 'react';
import './album3d.css';

/**
 * Album3D — was: drag-to-rotate CSS 3D book mockup with six painted
 * faces, leather grain, page-edge slabs, the works. Looked OK at the
 * rest pose but exposed its flat-math nature on rotation, especially
 * the back view (read as "open box" instead of "closed leather book").
 *
 * Now: a deliberate editorial still composition. Front face only,
 * no rotation, no fake 3D. Works because:
 *   1. It doesn't try to be a photograph, so it doesn't fail at being
 *      one (no uncanny valley).
 *   2. Inspired by Apple / Hermès product pages — single beautiful
 *      pose, generous whitespace, soft shadow, foil-stamped title.
 *   3. Renders fast on mobile (no SVG fractal noise, no preserve-3d).
 *
 * Prop shape kept identical to the previous component so callers
 * don't need to change. `caption` default is updated; the old
 * "Drag to rotate" copy no longer applies.
 */
export interface Album3DProps {
  /** Title shown in foil on the cover. */
  title?: string;
  /** Optional subtitle (date, names, …). */
  subtitle?: string;
  /** Cover style — leather (default) shows foil text; photo shows a photo backdrop. */
  variant?: 'leather' | 'photo';
  /** Photo source for variant="photo". Ignored for leather. */
  photoSrc?: string;
  /** Leather color. Defaults to a deep brown. */
  leatherHex?: string;
  /** Foil / text color hex. */
  foilHex?: string;
  /** Display size in px (the rendered width of the cover). */
  width?: number;
  /** Caption shown under the book. */
  caption?: string;
  /** Optional className passthrough for layout glue. */
  className?: string;
}

export default function Album3D({
  title = 'Forever',
  subtitle = '',
  variant = 'leather',
  photoSrc,
  leatherHex = '#3a2618',
  foilHex = '#d4b07a',
  width = 360,
  caption = 'Hand-bound · Heirloom-grade leather',
  className = '',
}: Album3DProps) {
  const stageStyle: CSSProperties = {
    width,
    ...({
      '--album-leather': leatherHex,
      '--album-foil': foilHex,
    } as Record<string, string>),
  };

  return (
    <div className={`album-still-wrap ${className}`}>
      <div className="album-still" style={stageStyle}>
        {/* Soft floor shadow under the album — sells the weight of the
            object without faking 3D angles. */}
        <div className="album-still-shadow" aria-hidden="true" />

        {/* The cover itself. Single rectangle. Studio-light gradient
            painted as background; foil text or photo overlaid on top. */}
        <div className="album-still-cover" aria-hidden="true">
          {variant === 'photo' && photoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="album-still-photo" src={photoSrc} alt="" draggable={false} />
          ) : (
            <div className="album-still-foil-block">
              <span className="album-still-rule" aria-hidden="true" />
              <span className="album-still-title">{title}</span>
              <span className="album-still-rule" aria-hidden="true" />
              {subtitle && <div className="album-still-subtitle">{subtitle}</div>}
            </div>
          )}

          {/* Spine highlight: a thin inset along the left edge so the
              cover doesn't read as a flat card — it suggests the
              binding without trying to render a real 3D spine. */}
          <div className="album-still-spine-hint" aria-hidden="true" />
          {/* Embossed border: a slightly darker ring just inside the
              perimeter, the way a real leather album has a debossed
              line where the leather wraps the boards. */}
          <div className="album-still-deboss" aria-hidden="true" />
        </div>
      </div>

      {caption && <p className="album-still-caption">{caption}</p>}
    </div>
  );
}
