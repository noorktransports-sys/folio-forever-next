'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import './album3d.css';

/**
 * Album3D — draggable, pseudo-3D album showcase.
 *
 * Built with CSS 3D transforms (no Three.js, no WebGL). Stays cheap on mobile
 * and keeps Lighthouse happy.
 *
 * Why drag-to-rotate, not auto-spin: an auto-rotating book reads as a 2010s
 * gimmick. Letting the visitor *do* something feels editorial — they can
 * inspect the cover, swing it to peek at the spine and page edges, and
 * release it wherever they want. Keeps the interaction in the user's hands
 * (literally), which suits a luxury physical-product brand.
 *
 * The book starts pre-tilted on the Y axis so the spine + page edges are
 * already visible (the "you can see corners" requirement). The user drags
 * to push it further within a clamped range; X tilt is also clamped so the
 * cover face stays readable. Keyboard arrow keys mirror the drag for a11y.
 */

const REST_ROTATE_X_DEG = 4;     // gentle downward tilt at rest
const REST_ROTATE_Y_DEG = -16;   // turned slightly so spine + page edges show
const ROTATE_X_RANGE_DEG = 28;   // ±28° around rest on X axis (no upside-down)
const ROTATE_Y_RANGE_DEG = 720;  // effectively unbounded — full spin both ways
const DRAG_SENSITIVITY = 0.5;    // pixels of pointer movement → degrees of rotation
const KEY_STEP_DEG = 6;          // arrow-key nudge per press

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
  /** Caption shown under the book — e.g. "Drag to rotate". */
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
  caption = 'Drag to rotate · See every angle',
  className = '',
}: Album3DProps) {
  // Stored in refs (not state) so drag updates don't re-render the React tree.
  // We push values straight to CSS variables on the stage element.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rotXRef = useRef<number>(REST_ROTATE_X_DEG);
  const rotYRef = useRef<number>(REST_ROTATE_Y_DEG);
  const dragStartRef = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const applyRotation = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty('--rx', rotXRef.current.toFixed(2) + 'deg');
    stage.style.setProperty('--ry', rotYRef.current.toFixed(2) + 'deg');
  }, []);

  // Apply the rest pose on mount.
  useEffect(() => {
    applyRotation();
  }, [applyRotation]);

  const clampX = (v: number) =>
    Math.max(REST_ROTATE_X_DEG - ROTATE_X_RANGE_DEG, Math.min(REST_ROTATE_X_DEG + ROTATE_X_RANGE_DEG, v));
  const clampY = (v: number) =>
    Math.max(REST_ROTATE_Y_DEG - ROTATE_Y_RANGE_DEG, Math.min(REST_ROTATE_Y_DEG + ROTATE_Y_RANGE_DEG, v));

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    // Capture so we keep getting move/up events even if the pointer leaves the element.
    stage.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      rx: rotXRef.current,
      ry: rotYRef.current,
    };
    setIsDragging(true);
    setHasInteracted(true);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      // Horizontal drag → Y rotation (book spins on vertical axis).
      // Vertical drag → X rotation (book tilts forward/back). Negate dy
      // so dragging UP tilts the top toward the viewer (natural).
      rotYRef.current = clampY(start.ry + dx * DRAG_SENSITIVITY);
      rotXRef.current = clampX(start.rx - dy * DRAG_SENSITIVITY);
      applyRotation();
    },
    [applyRotation]
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const stage = stageRef.current;
      if (stage && stage.hasPointerCapture(e.pointerId)) {
        stage.releasePointerCapture(e.pointerId);
      }
      dragStartRef.current = null;
      setIsDragging(false);
    },
    []
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      let handled = false;
      switch (e.key) {
        case 'ArrowLeft':
          rotYRef.current = clampY(rotYRef.current - KEY_STEP_DEG);
          handled = true;
          break;
        case 'ArrowRight':
          rotYRef.current = clampY(rotYRef.current + KEY_STEP_DEG);
          handled = true;
          break;
        case 'ArrowUp':
          rotXRef.current = clampX(rotXRef.current + KEY_STEP_DEG);
          handled = true;
          break;
        case 'ArrowDown':
          rotXRef.current = clampX(rotXRef.current - KEY_STEP_DEG);
          handled = true;
          break;
        case 'Home':
        case '0':
          rotXRef.current = REST_ROTATE_X_DEG;
          rotYRef.current = REST_ROTATE_Y_DEG;
          handled = true;
          break;
      }
      if (handled) {
        e.preventDefault();
        applyRotation();
        setHasInteracted(true);
      }
    },
    [applyRotation]
  );

  // Aspect ratio: 17×12 → 0.7059 height per width. Keep the ratio in CSS.
  const stageStyle: CSSProperties = {
    width,
  };

  return (
    <div className={`album3d-wrap ${className}`}>
      <div
        ref={stageRef}
        className={`album3d-stage${isDragging ? ' is-dragging' : ''}`}
        style={stageStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        role="img"
        aria-label={`Album cover titled ${title}. Drag or use arrow keys to rotate.`}
        tabIndex={0}
      >
        {/* Soft ground shadow — sits flat under the book, gives weight. */}
        <div className="album3d-ground" aria-hidden="true" />

        {/* The book itself — preserve-3d so spine + page edges stay co-planar. */}
        <div className="album3d-book" aria-hidden="true">
          {/* Back cover — gives the book real thickness on Y rotation. */}
          <div
            className="album3d-back"
            style={{ background: variant === 'leather' ? leatherHex : '#1a1816' }}
          />

          {/* Spine — left edge, rotated 90° into 3D space. */}
          <div
            className="album3d-spine"
            style={{
              background: `linear-gradient(90deg,
                rgba(0,0,0,0.85) 0%,
                ${variant === 'leather' ? leatherHex : '#1a1816'} 45%,
                rgba(0,0,0,0.65) 100%)`,
            }}
          >
            <span className="album3d-spine-text" style={{ color: foilHex }}>
              {title}
            </span>
          </div>

          {/* Right edge — visible page block. */}
          <div className="album3d-edge-right" />
          {/* Bottom edge — page block. */}
          <div className="album3d-edge-bottom" />
          {/* Top edge — page block. */}
          <div className="album3d-edge-top" />

          {/* Front cover — what the user designed. */}
          <div
            className={`album3d-cover album3d-cover-${variant}`}
            style={{
              background: variant === 'leather' ? leatherHex : '#0e0c09',
            }}
          >
            {variant === 'photo' && photoSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="album3d-cover-photo" src={photoSrc} alt="" draggable={false} />
            )}
            {variant === 'leather' && <div className="album3d-leather-grain" aria-hidden="true" />}

            <div className="album3d-cover-text">
              <div className="album3d-title" style={{ color: foilHex }}>
                {title}
              </div>
              {subtitle && (
                <div className="album3d-subtitle" style={{ color: foilHex }}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Drag hint — auto-fades after first interaction. */}
        <div
          className={`album3d-hint${hasInteracted ? ' is-hidden' : ''}`}
          aria-hidden="true"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 10h14M3 10l4-4M3 10l4 4M17 10l-4-4M17 10l-4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Drag</span>
        </div>
      </div>

      {caption && <p className="album3d-caption">{caption}</p>}
    </div>
  );
}
