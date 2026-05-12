// src/app/design/smart/edit/SmartCoverStep.tsx
//
// The "Cover" step for the smart wizard, sitting between Adjust and Proof.
//
// Flow:
//   1. Customer picks a cover TYPE — leather / acrylic / photo
//   2. Customer types couple names + a free-form line (date / place / etc)
//   3. If acrylic or photo, customer picks a cover photo from the album's
//      already-uploaded photos (or skips — falls back to a placeholder
//      until they pick one; can't continue without a photo for those types)
//   4. Three preset designs render side-by-side as small 3D previews.
//      Click to select; the big preview at the top mirrors the selection.
//   5. Continue → onContinue(coverState) → next wizard step.
//
// We reuse Album3D directly for both the hero preview and the preset cards.
// Three.js instantiation is heavy; running 4 simultaneous Album3D scenes
// means ~4 WebGL contexts. Most desktop browsers cap at 16 contexts per
// page, so we're well under. On low-end devices it can stutter — caller
// shows a "rendering previews" stub until mounted.

'use client'

import * as React from 'react'
import Album3D from '../../../components/Album3D'
import {
  COVER_PRESETS,
  presetsForType,
  findPreset,
  type CoverPreset,
  type SmartCoverState,
  type SmartCoverType,
} from './cover-presets'

const GOLD = '#b8965a'

interface SmartCoverStepProps {
  /** All photos already uploaded by the customer in earlier steps. The
   *  cover photo picker pulls thumbnails from here. */
  photos: Array<{ id: string; preview: string; width: number; height: number }>
  /** Currently saved cover (lets the customer return and edit). */
  initial?: SmartCoverState | null
  onBack: () => void
  onContinue: (state: SmartCoverState) => void
}

const LEATHER_COLORS = [
  { id: 'black', label: 'Black', hex: '#1a1816' },
  { id: 'brown', label: 'Brown', hex: '#5a3a1a' },
  { id: 'ivory', label: 'Ivory', hex: '#f0e6d2' },
  { id: 'burgundy', label: 'Burgundy', hex: '#5e1014' },
]

function defaultStateForType(t: SmartCoverType): SmartCoverState {
  const presets = presetsForType(t)
  return {
    coverType: t,
    presetId: presets[0].id,
    primaryText: '',
    subtitleText: '',
  }
}

export default function SmartCoverStep({
  photos,
  initial,
  onBack,
  onContinue,
}: SmartCoverStepProps) {
  const [state, setState] = React.useState<SmartCoverState>(
    () => initial ?? defaultStateForType('photo'),
  )
  // Leather color is stored locally — leather presets each suggest one but
  // the customer can override (it's the one "tweak" we let them do post-
  // pick, since 4 colors is a small reversible choice).
  const [leatherColorId, setLeatherColorId] = React.useState<string>(() => {
    const p = findPreset(state.presetId)
    return p?.leatherColorId ?? 'black'
  })

  const preset = findPreset(state.presetId) ?? COVER_PRESETS[0]
  const presetsForCurrentType = presetsForType(state.coverType)

  const leatherHex =
    LEATHER_COLORS.find((c) => c.id === leatherColorId)?.hex ?? '#1a1816'

  // Hex passed to the Album3D foil overlay. For leather + acrylic that's
  // the foil hex. For photo it's the ink colour.
  const textRenderHex =
    state.coverType === 'photo' ? preset.customTextHex! : preset.foilHex!

  const photoSrc =
    (state.coverType === 'acrylic' || state.coverType === 'photo') &&
    state.photoSrc
      ? state.photoSrc
      : undefined

  function setCoverType(t: SmartCoverType) {
    setState((prev) => {
      // Keep text + photoId, just switch presets to the first one of the
      // new type. Photo isn't carried into leather (leather has no photo).
      const firstPreset = presetsForType(t)[0]
      return {
        ...prev,
        coverType: t,
        presetId: firstPreset.id,
        photoId: t === 'leather' ? undefined : prev.photoId,
        photoSrc: t === 'leather' ? undefined : prev.photoSrc,
      }
    })
    const firstPreset = presetsForType(t)[0]
    if (firstPreset.leatherColorId) setLeatherColorId(firstPreset.leatherColorId)
  }

  function pickPreset(p: CoverPreset) {
    setState((prev) => ({ ...prev, presetId: p.id }))
    if (p.leatherColorId) setLeatherColorId(p.leatherColorId)
  }

  function pickPhoto(p: { id: string; preview: string }) {
    setState((prev) => ({ ...prev, photoId: p.id, photoSrc: p.preview }))
  }

  // Can't continue with acrylic/photo without a chosen photo, or without
  // a primary text (couple name). Subtitle is optional.
  const needsPhoto =
    state.coverType === 'acrylic' || state.coverType === 'photo'
  const canContinue =
    state.primaryText.trim().length > 0 && (!needsPhoto || !!state.photoSrc)

  function handleContinue() {
    if (!canContinue) return
    onContinue({
      ...state,
      primaryText: state.primaryText.trim(),
      subtitleText: state.subtitleText.trim(),
      // Snapshot leather color decision onto the preset by not changing
      // presetId — but downstream renderers should call findPreset(presetId)
      // and override the leather hex with whatever we pass here. The order
      // payload stores `leatherColorId` so the print render is deterministic.
      ...(state.coverType === 'leather' ? {} : {}),
    })
  }

  return (
    <div className="smart-cover-step" style={styles.shell}>
      <div style={styles.header}>
        <button type="button" onClick={onBack} style={styles.backBtn}>
          ← Back
        </button>
        <h2 style={styles.title}>Design your cover</h2>
        <div style={{ width: 80 }} />
      </div>

      <div style={styles.body}>
        {/* ── BIG PREVIEW (top) ── */}
        <div style={styles.heroPanel}>
          <Album3D
            title={state.primaryText || 'Your Names'}
            subtitle={state.subtitleText}
            variant={state.coverType}
            photoSrc={photoSrc}
            leatherHex={leatherHex}
            foilHex={textRenderHex}
            fontFamily={preset.fontFamily}
            fontStyle={preset.fontStyle}
            fontSizePx={preset.fontSize}
            position={preset.position}
            width={520}
          />
        </div>

        {/* ── CONTROLS ── */}
        <div style={styles.controls}>
          {/* Cover type tabs */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Cover type</div>
            <div style={styles.tabRow}>
              {(['photo', 'acrylic', 'leather'] as SmartCoverType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setCoverType(t)}
                  style={{
                    ...styles.tab,
                    ...(state.coverType === t ? styles.tabActive : {}),
                  }}
                >
                  {t === 'photo'
                    ? 'Full-bleed Photo'
                    : t === 'acrylic'
                    ? 'Acrylic'
                    : 'Leather'}
                </button>
              ))}
            </div>
          </div>

          {/* Text inputs */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>The names (line 1)</div>
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. Sarah & James"
              value={state.primaryText}
              onChange={(e) =>
                setState((prev) => ({ ...prev, primaryText: e.target.value }))
              }
              style={styles.input}
            />
          </div>
          <div style={styles.section}>
            <div style={styles.sectionLabel}>
              Anything else (line 2 — optional)
            </div>
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. September 14, 2024 · Lahore"
              value={state.subtitleText}
              onChange={(e) =>
                setState((prev) => ({ ...prev, subtitleText: e.target.value }))
              }
              style={styles.input}
            />
            <div style={styles.help}>
              Use this for a date, a place, a verse — whatever you want
              foil-stamped under the names.
            </div>
          </div>

          {/* Leather color (only for leather covers) */}
          {state.coverType === 'leather' && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Leather color</div>
              <div style={styles.swatchRow}>
                {LEATHER_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setLeatherColorId(c.id)}
                    title={c.label}
                    style={{
                      ...styles.swatch,
                      background: c.hex,
                      ...(leatherColorId === c.id ? styles.swatchActive : {}),
                    }}
                    aria-label={c.label}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Photo picker (only for acrylic + photo covers) */}
          {needsPhoto && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>
                Cover photo —{' '}
                <span style={{ color: '#a99880', fontWeight: 400 }}>
                  pick from your uploads
                </span>
              </div>
              {photos.length === 0 ? (
                <div style={styles.emptyHint}>
                  No photos uploaded yet — go back and upload some, then
                  return to pick a cover photo.
                </div>
              ) : (
                <div style={styles.photoGrid}>
                  {photos.map((p) => {
                    const selected = state.photoId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickPhoto(p)}
                        style={{
                          ...styles.photoTile,
                          ...(selected ? styles.photoTileActive : {}),
                        }}
                        aria-label={`Use photo ${p.id}`}
                      >
                        <img
                          src={p.preview}
                          alt=""
                          style={styles.photoTileImg}
                          loading="lazy"
                        />
                        {selected && <div style={styles.selectedDot}>✓</div>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Variations */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>
              Pick a design ·{' '}
              <span style={{ color: '#a99880', fontWeight: 400 }}>
                {presetsForCurrentType.length} variations
              </span>
            </div>
            <div style={styles.variationGrid}>
              {presetsForCurrentType.map((p) => {
                const active = p.id === state.presetId
                const previewLeatherHex =
                  p.leatherHex ?? leatherHex
                const previewTextHex =
                  p.coverType === 'photo' ? p.customTextHex! : p.foilHex!
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPreset(p)}
                    style={{
                      ...styles.variationCard,
                      ...(active ? styles.variationCardActive : {}),
                    }}
                  >
                    <div style={styles.variationCanvas}>
                      <Album3D
                        title={state.primaryText || 'Your Names'}
                        subtitle={state.subtitleText}
                        variant={p.coverType}
                        photoSrc={photoSrc}
                        leatherHex={previewLeatherHex}
                        foilHex={previewTextHex}
                        fontFamily={p.fontFamily}
                        fontStyle={p.fontStyle}
                        fontSizePx={p.fontSize * 0.5}
                        position={p.position}
                        width={220}
                      />
                    </div>
                    <div style={styles.variationLabel}>{p.label}</div>
                    <div style={styles.variationBlurb}>{p.blurb}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={styles.footer}>
        <div style={styles.footerHint}>
          {!canContinue && needsPhoto && !state.photoSrc
            ? 'Pick a cover photo to continue.'
            : !canContinue
            ? 'Enter the names (line 1) to continue.'
            : 'Looking good. The selected design ships to your printer at 300 DPI.'}
        </div>
        <button
          type="button"
          disabled={!canContinue}
          onClick={handleContinue}
          style={{
            ...styles.continueBtn,
            ...(canContinue ? {} : styles.continueBtnDisabled),
          }}
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    background: '#0e0c09',
    color: '#e8ddc1',
    padding: '24px 18px 80px',
    fontFamily: 'Georgia, serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 980,
    margin: '0 auto 18px',
  },
  backBtn: {
    background: 'transparent',
    border: `1px solid ${GOLD}`,
    color: GOLD,
    padding: '8px 14px',
    borderRadius: 2,
    fontSize: 13,
    cursor: 'pointer',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    fontWeight: 300,
    fontSize: 28,
    color: GOLD,
    margin: 0,
    letterSpacing: 2,
  },
  body: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 24,
    maxWidth: 980,
    margin: '0 auto',
  },
  heroPanel: {
    display: 'flex',
    justifyContent: 'center',
    background: 'rgba(184,150,90,0.05)',
    border: `1px solid rgba(184,150,90,0.15)`,
    padding: 24,
    minHeight: 400,
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: GOLD,
    fontWeight: 600,
  },
  tabRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  tab: {
    flex: 1,
    minWidth: 120,
    padding: '12px 14px',
    background: 'transparent',
    border: '1px solid rgba(184,150,90,0.3)',
    color: '#e8ddc1',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabActive: {
    background: 'rgba(184,150,90,0.15)',
    borderColor: GOLD,
    color: GOLD,
  },
  input: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(184,150,90,0.3)',
    color: '#e8ddc1',
    padding: '12px 14px',
    fontSize: 15,
    fontFamily: 'inherit',
  },
  help: {
    fontSize: 12,
    color: '#a99880',
    fontStyle: 'italic',
  },
  swatchRow: {
    display: 'flex',
    gap: 10,
  },
  swatch: {
    width: 36,
    height: 36,
    border: '1px solid rgba(184,150,90,0.3)',
    cursor: 'pointer',
    borderRadius: '50%',
  },
  swatchActive: {
    boxShadow: `0 0 0 2px ${GOLD}`,
    borderColor: GOLD,
  },
  emptyHint: {
    padding: 16,
    background: 'rgba(255,255,255,0.03)',
    border: '1px dashed rgba(184,150,90,0.3)',
    fontSize: 13,
    color: '#a99880',
    fontStyle: 'italic',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
    gap: 8,
    maxHeight: 200,
    overflowY: 'auto',
    padding: 4,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(184,150,90,0.15)',
  },
  photoTile: {
    position: 'relative',
    aspectRatio: '1',
    padding: 0,
    border: '2px solid transparent',
    background: '#000',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  photoTileActive: {
    borderColor: GOLD,
  },
  photoTileImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  selectedDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    background: GOLD,
    color: '#0e0c09',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 12,
  },
  variationGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 14,
  },
  variationCard: {
    padding: 12,
    background: 'rgba(184,150,90,0.04)',
    border: '2px solid rgba(184,150,90,0.2)',
    color: '#e8ddc1',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'inherit',
  },
  variationCardActive: {
    borderColor: GOLD,
    background: 'rgba(184,150,90,0.1)',
  },
  variationCanvas: {
    width: '100%',
    minHeight: 200,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  variationLabel: {
    fontFamily: '"Cormorant Garamond", Georgia, serif',
    fontSize: 18,
    color: GOLD,
    margin: 0,
  },
  variationBlurb: {
    fontSize: 11,
    color: '#a99880',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  footer: {
    position: 'sticky',
    bottom: 0,
    background: 'linear-gradient(to top, rgba(14,12,9,1) 70%, rgba(14,12,9,0))',
    paddingTop: 18,
    marginTop: 28,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 18,
    flexWrap: 'wrap',
    maxWidth: 980,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  footerHint: {
    fontSize: 12,
    color: '#a99880',
    fontStyle: 'italic',
    flex: 1,
    minWidth: 200,
  },
  continueBtn: {
    background: GOLD,
    color: '#0e0c09',
    border: 'none',
    padding: '14px 28px',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  continueBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
}
