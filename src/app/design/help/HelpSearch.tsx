'use client'

// HelpSearch — the "🔍 How do I…?" guide search for the designers.
//
//  • Pill button in the top bar; also opens with Ctrl/⌘+K or "/".
//  • Type in plain words ("switch pic", "photo is crooked") → smart
//    results (synonyms + typo tolerance, current step first).
//  • Click a result → guide card: looping live demo, numbered steps
//    (computer / phone), tips, and "Show me" which scrolls to the real
//    control on the page and rings it in gold.
//
// Everything runs locally from src/lib/help — no network calls.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HelpDemo from './HelpDemo'
import { AREA_LABEL, type Guide } from '@/lib/help/guides'
import { areaForStep, searchGuides, suggested, type SearchContext } from '@/lib/help/search'

const GOLD = '#b8965a'
const CREAM = '#f4ede8'

type Spot = { el: Element; note: string; title: string }

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const st = window.getComputedStyle(el)
  return st.display !== 'none' && st.visibility !== 'hidden'
}

function findFirst(selectors: string[] | undefined): Element | null {
  for (const sel of selectors ?? []) {
    let list: NodeListOf<Element>
    try {
      list = document.querySelectorAll(sel)
    } catch {
      continue
    }
    for (const el of Array.from(list)) if (isVisible(el)) return el
  }
  return null
}

export default function HelpSearch({ app, step }: { app: 'smart' | 'magazine'; step?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [guide, setGuide] = useState<Guide | null>(null)
  const [touch, setTouch] = useState(false)
  const [mode, setMode] = useState<'mouse' | 'touch'>('mouse')
  const [notHere, setNotHere] = useState<string | null>(null)
  const [spot, setSpot] = useState<Spot | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ctx: SearchContext = useMemo(
    () => ({ app, area: app === 'magazine' ? 'magazine' : areaForStep(step) }),
    [app, step],
  )
  const results = useMemo(() => (q.trim() ? searchGuides(q, ctx) : suggested(ctx, 7)), [q, ctx])

  useEffect(() => {
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    setTouch(!!coarse)
    setMode(coarse ? 'touch' : 'mouse')
  }, [])

  const openPanel = useCallback(() => {
    setOpen(true)
    setQ('')
    setGuide(null)
    setNotHere(null)
    setSpot(null)
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setNotHere(null)
  }, [])

  // Global shortcuts: Ctrl/⌘+K, "/" (when not typing), Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) close()
        else openPanel()
      } else if (e.key === '/' && !typing && !open) {
        e.preventDefault()
        openPanel()
      } else if (e.key === 'Escape') {
        if (open) {
          e.preventDefault()
          if (guide) setGuide(null)
          else close()
        } else if (spot) setSpot(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, guide, spot, close, openPanel])

  useEffect(() => setActive(0), [q])

  const pick = (g: Guide) => {
    setGuide(g)
    setNotHere(null)
  }

  const showMe = (g: Guide) => {
    let el = findFirst(g.target)
    let note = (mode === 'touch' && g.touch ? g.touch : g.steps)[0]
    if (!el && g.fallback) {
      el = findFirst([g.fallback.selector])
      if (el) note = g.fallback.note
    }
    if (!el) {
      const here = ctx.area === g.area
      setNotHere(
        here
          ? 'It isn’t on screen right now — follow the steps above and it will appear.'
          : `You’ll find this on the ${AREA_LABEL[g.area]}. Follow the steps above when you get there.`,
      )
      return
    }
    setOpen(false)
    setNotHere(null)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setSpot({ el, note, title: g.title })
  }

  // Spotlight follows its element (scrolling, layout shifts) and clears
  // itself after a few seconds or on the next click anywhere.
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!spot) {
      setRect(null)
      return
    }
    let raf = 0
    const tick = () => {
      setRect(spot.el.getBoundingClientRect())
      raf = requestAnimationFrame(tick)
    }
    tick()
    const done = setTimeout(() => setSpot(null), 7000)
    const onDown = () => setSpot(null)
    const arm = setTimeout(() => window.addEventListener('pointerdown', onDown, { once: true }), 400)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
      clearTimeout(arm)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [spot])

  const steps = guide ? (mode === 'touch' && guide.touch ? guide.touch : guide.steps) : []
  const related = useMemo(() => {
    if (!guide) return []
    return searchGuides(guide.title + ' ' + guide.keywords, ctx, 6)
      .filter((g) => g.id !== guide.id)
      .slice(0, 3)
  }, [guide, ctx])

  const badge = (g: Guide) =>
    ctx.area === g.area ? (
      <span style={{ ...S.badge, color: '#0e0c09', background: GOLD, borderColor: GOLD }}>This step</span>
    ) : (
      <span style={S.badge}>{AREA_LABEL[g.area]}</span>
    )

  return (
    <>
      <style>{CSS}</style>
      <button type="button" className="ffh-pill" onClick={openPanel} aria-haspopup="dialog" title="Search the guide (Ctrl+K)">
        <span aria-hidden>🔍</span>
        <span className="ffh-pill-long">How do I…?</span>
        <span className="ffh-pill-short">Help</span>
        <kbd className="ffh-kbd">Ctrl K</kbd>
      </button>

      {open && (
        <div className="ffh-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="ffh-panel" role="dialog" aria-modal="true" aria-label="Design guide">
            <div style={S.head}>
              <span aria-hidden style={{ fontSize: 15, opacity: 0.8 }}>🔍</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setGuide(null)
                }}
                onKeyDown={(e) => {
                  if (guide) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(results.length - 1, a + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(0, a - 1))
                  } else if (e.key === 'Enter' && results[active]) {
                    e.preventDefault()
                    pick(results[active])
                  }
                }}
                placeholder="How do I… (e.g. swap a photo, rotate, change background)"
                aria-label="Search the guide"
                style={S.input}
              />
              <button type="button" onClick={close} style={S.close} aria-label="Close guide">
                ✕
              </button>
            </div>

            <div className="ffh-body">
              {!guide && (
                <>
                  <div style={S.section}>{q.trim() ? `Results for “${q.trim()}”` : 'Popular questions'}</div>
                  {results.length === 0 && (
                    <div style={{ padding: '18px 18px 26px', color: 'var(--muted2, #a89c8c)', fontSize: 13, lineHeight: 1.6 }}>
                      No guide matches that yet. Try simpler words like <em>swap</em>, <em>rotate</em>, <em>background</em>,{' '}
                      <em>text</em> or <em>undo</em>.
                    </div>
                  )}
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 8px 10px' }} role="listbox" aria-label="Guides">
                    {results.map((g, i) => (
                      <li key={g.id} role="option" aria-selected={i === active}>
                        <button
                          type="button"
                          className="ffh-row"
                          data-active={i === active || undefined}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => pick(g)}
                        >
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', color: CREAM, fontSize: 14 }}>{g.title}</span>
                            <span style={{ display: 'block', color: 'var(--muted2, #a89c8c)', fontSize: 11.5, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {(touch && g.touch ? g.touch : g.steps)[0]}
                            </span>
                          </span>
                          {badge(g)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {guide && (
                <div style={{ padding: '6px 18px 20px' }}>
                  <button type="button" onClick={() => setGuide(null)} style={S.back}>
                    ← All results
                  </button>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '6px 0 12px', flexWrap: 'wrap' }}>
                    <h3 style={S.title}>{guide.title}</h3>
                    {badge(guide)}
                  </div>

                  <HelpDemo scene={guide.demo} label={guide.demoLabel} touch={mode === 'touch'} />

                  {guide.touch && (
                    <div style={{ display: 'flex', gap: 6, margin: '14px 0 4px' }} role="tablist">
                      {(['mouse', 'touch'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="tab"
                          aria-selected={mode === m}
                          onClick={() => setMode(m)}
                          style={{ ...S.tab, ...(mode === m ? S.tabOn : null) }}
                        >
                          {m === 'mouse' ? '🖱 On a computer' : '📱 On a phone / tablet'}
                        </button>
                      ))}
                    </div>
                  )}

                  <ol style={S.steps}>
                    {steps.map((s, i) => (
                      <li key={i} style={S.step}>
                        <span style={S.num}>{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>

                  {guide.tips && guide.tips.length > 0 && (
                    <div style={S.tips}>
                      {guide.tips.map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8 }}>
                          <span aria-hidden>💡</span>
                          <span>{t}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(guide.target || guide.fallback) && (
                    <button type="button" onClick={() => showMe(guide)} style={S.showMe}>
                      👉 Show me on the page
                    </button>
                  )}
                  {notHere && <div style={S.notHere}>{notHere}</div>}

                  {related.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <div style={{ ...S.section, padding: '0 0 6px' }}>Related</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {related.map((g) => (
                          <button key={g.id} type="button" onClick={() => pick(g)} style={S.chip}>
                            {g.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ffh-foot">
              <span>
                <kbd className="ffh-kbd">↑</kbd> <kbd className="ffh-kbd">↓</kbd> to move · <kbd className="ffh-kbd">Enter</kbd> to open ·{' '}
                <kbd className="ffh-kbd">Esc</kbd> to close
              </span>
            </div>
          </div>
        </div>
      )}

      {spot && rect && (
        <div aria-live="polite">
          <div
            className="ffh-spot"
            style={{
              left: rect.left - 8,
              top: rect.top - 8,
              width: rect.width + 16,
              height: rect.height + 16,
            }}
          />
          <div
            className="ffh-bubble"
            style={{
              left: Math.max(12, Math.min(window.innerWidth - 292, rect.left)),
              top: rect.bottom + 14 + 90 > window.innerHeight ? Math.max(12, rect.top - 96) : rect.bottom + 14,
            }}
          >
            <div style={{ color: GOLD, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
              {spot.title}
            </div>
            <div>{spot.note}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setSpot(null)
                  setOpen(true)
                }}
                style={S.bubbleBtn}
              >
                ← Back to guide
              </button>
              <button type="button" onClick={() => setSpot(null)} style={S.bubbleBtn}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const S: Record<string, React.CSSProperties> = {
  head: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '0.5px solid rgba(184,150,90,0.25)' },
  input: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: CREAM,
    fontSize: 16,
    fontFamily: 'var(--font-body, system-ui)',
  },
  close: { background: 'transparent', border: 'none', color: 'var(--muted2, #a89c8c)', fontSize: 16, cursor: 'pointer', padding: 4 },
  section: { fontSize: 9.5, letterSpacing: 2, textTransform: 'uppercase', color: GOLD, fontWeight: 700, padding: '14px 18px 8px' },
  badge: {
    flexShrink: 0,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GOLD,
    border: '0.5px solid rgba(184,150,90,0.5)',
    borderRadius: 20,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
    alignSelf: 'center',
    fontWeight: 600,
  },
  back: { background: 'transparent', border: 'none', color: GOLD, fontSize: 11, letterSpacing: 1, cursor: 'pointer', padding: '8px 0' },
  title: { margin: 0, flex: 1, minWidth: 200, color: CREAM, fontFamily: 'var(--font-display, Georgia, serif)', fontWeight: 400, fontSize: 22, lineHeight: 1.25 },
  tab: {
    flex: 1,
    background: 'transparent',
    border: '0.5px solid rgba(184,150,90,0.4)',
    color: 'var(--muted2, #a89c8c)',
    borderRadius: 20,
    padding: '7px 10px',
    fontSize: 11.5,
    cursor: 'pointer',
  },
  tabOn: { background: 'rgba(184,150,90,0.18)', color: CREAM, borderColor: GOLD },
  steps: { listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 10 },
  step: { display: 'flex', gap: 12, color: CREAM, fontSize: 14, lineHeight: 1.55 },
  num: {
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: GOLD,
    color: '#0e0c09',
    fontSize: 11,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tips: {
    marginTop: 14,
    padding: '10px 12px',
    background: 'rgba(184,150,90,0.08)',
    border: '0.5px solid rgba(184,150,90,0.25)',
    borderRadius: 8,
    display: 'grid',
    gap: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: 'var(--muted2, #cfc4b4)',
  },
  showMe: {
    marginTop: 16,
    width: '100%',
    background: GOLD,
    color: '#0e0c09',
    border: 'none',
    borderRadius: 30,
    padding: '12px 16px',
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: 'pointer',
  },
  notHere: { marginTop: 10, fontSize: 12.5, lineHeight: 1.5, color: CREAM, background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '9px 12px' },
  chip: {
    background: 'transparent',
    border: '0.5px solid rgba(184,150,90,0.45)',
    color: CREAM,
    borderRadius: 20,
    padding: '6px 11px',
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },
  bubbleBtn: { background: 'transparent', border: 'none', color: GOLD, fontSize: 11, letterSpacing: 1, cursor: 'pointer', padding: 0, fontWeight: 600 },
}

const CSS = `
.ffh-pill{display:inline-flex;align-items:center;gap:8px;background:rgba(184,150,90,0.1);border:0.5px solid rgba(184,150,90,0.55);
  color:${CREAM};border-radius:30px;padding:7px 12px 7px 12px;font-size:12px;cursor:pointer;font-family:var(--font-body,system-ui);
  transition:background .2s,border-color .2s;white-space:nowrap}
.ffh-pill:hover{background:rgba(184,150,90,0.22);border-color:${GOLD}}
.ffh-pill-short{display:none}
.ffh-kbd{font:600 9.5px/1 system-ui,sans-serif;color:${GOLD};border:0.5px solid rgba(184,150,90,0.5);border-radius:4px;padding:3px 5px;background:rgba(0,0,0,0.25)}
.ffh-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(8,6,4,0.6);backdrop-filter:blur(2px);display:flex;justify-content:center;align-items:flex-start;padding:64px 12px 24px}
.ffh-panel{width:min(640px,100%);max-height:calc(100vh - 88px);display:flex;flex-direction:column;background:#17120e;border:0.5px solid rgba(184,150,90,0.45);
  border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,0.7);overflow:hidden;font-family:var(--font-body,system-ui)}
.ffh-body{overflow-y:auto;flex:1;min-height:0}
.ffh-row{width:100%;display:flex;align-items:center;gap:12px;text-align:left;background:transparent;border:none;border-radius:8px;padding:10px 10px;cursor:pointer}
.ffh-row[data-active]{background:rgba(184,150,90,0.12)}
.ffh-foot{border-top:0.5px solid rgba(184,150,90,0.2);padding:8px 16px;font-size:10.5px;color:var(--muted2,#a89c8c)}
.ffh-spot{position:fixed;z-index:10001;pointer-events:none;border:2.5px solid ${GOLD};border-radius:10px;
  box-shadow:0 0 0 9999px rgba(8,6,4,0.45),0 0 24px rgba(184,150,90,0.8);animation:ffhPulse 1.1s ease-in-out infinite}
@keyframes ffhPulse{0%,100%{outline:0 solid rgba(184,150,90,0.6);outline-offset:0}50%{outline:6px solid rgba(184,150,90,0.25);outline-offset:4px}}
.ffh-bubble{position:fixed;z-index:10002;width:280px;background:#17120e;border:0.5px solid ${GOLD};border-radius:10px;padding:10px 12px;
  color:${CREAM};font-size:12.5px;line-height:1.5;box-shadow:0 12px 30px rgba(0,0,0,0.6);font-family:var(--font-body,system-ui)}
@media (max-width:700px){
  .ffh-pill-long,.ffh-kbd{display:none}
  .ffh-pill-short{display:inline}
  .ffh-pill .ffh-kbd{display:none}
  .ffh-backdrop{padding:0}
  .ffh-panel{width:100%;max-height:100vh;height:100%;border-radius:0;border:none}
  .ffh-foot{display:none}
}
@media (pointer:coarse){.ffh-foot{display:none}.ffh-pill .ffh-kbd{display:none}}
`
