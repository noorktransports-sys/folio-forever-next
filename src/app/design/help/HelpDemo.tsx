'use client'

// HelpDemo — tiny looping "live view" animations for the guide cards.
//
// Pure SVG + CSS keyframes (no video, no library) so every guide gets a
// moving picture for a few KB. Each scene is a mini spread with a cursor
// (computer) or fingertip (phone) acting out the task.
//
// Scenes share primitives: <Spread>, <Pic> (a stylised photo), <Pointer>.
// Keyframes are generated from point lists with kf() so scenes stay short.

import { useId } from 'react'
import type { DemoScene } from '@/lib/help/guides'

const D = 5 // seconds per loop
const GOLD = '#b8965a'
const CREAM = '#f4ede8'
const INK = '#1a1511'

type Frame = [number, string]
/** Build a @keyframes rule from [percent, css] pairs. */
function kf(name: string, frames: Frame[]): string {
  return `@keyframes ${name}{${frames.map(([p, c]) => `${p}%{${c}}`).join('')}}`
}
/** Pointer path: [percent, x, y, pressed?] */
function path(name: string, pts: [number, number, number, boolean?][]): string {
  return kf(
    name,
    pts.map(([p, x, y, down]) => [p, `transform:translate(${x}px,${y}px) scale(${down ? 0.82 : 1})`]),
  )
}
/** Visible between two percentages (with short fades). */
function show(name: string, from: number, to: number, max = 1): string {
  const a = Math.max(0, from - 2)
  const b = Math.min(100, to + 2)
  return kf(name, [
    [0, `opacity:${from <= 0 ? max : 0}`],
    [a, `opacity:${from <= 0 ? max : 0}`],
    [from, `opacity:${max}`],
    [to, `opacity:${max}`],
    [b, `opacity:${to >= 100 ? max : 0}`],
    [100, `opacity:${to >= 100 ? max : 0}`],
  ])
}
const anim = (n: string, extra = '') => ({ animation: `${n} ${D}s ${extra || 'ease-in-out'} infinite` })
const box: React.CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' }

const PALS: [string, string, string, string][] = [
  ['#e9c9a8', '#b97c55', '#6d4a33', '#fff3dc'], // warm sunset
  ['#bcd3d9', '#7f9fa8', '#3e5a61', '#f6fbff'], // cool sky
  ['#e8b7b5', '#b86b6f', '#6a3438', '#ffe9e4'], // rose
  ['#d6d2a4', '#9a9a5a', '#55552d', '#fffbe0'], // olive
]

/** A stylised photo: sky gradient, sun, two hills. Drawn in a 100×75 box. */
function Art({ pal, id }: { pal: number; id: string }) {
  const [sky, mid, dark, sun] = PALS[pal % PALS.length]
  return (
    <>
      <defs>
        <linearGradient id={`${id}g${pal}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
      </defs>
      <rect x="-50" y="-40" width="200" height="155" fill={`url(#${id}g${pal})`} />
      <circle cx="70" cy="22" r="9" fill={sun} opacity="0.9" />
      <path d="M-50 60 L10 34 L38 52 L62 30 L150 66 L150 115 L-50 115Z" fill={dark} opacity="0.85" />
      <path d="M-50 75 L30 56 L80 70 L150 60 L150 115 L-50 115Z" fill={mid} />
    </>
  )
}

/** A photo in a frame. `inner` lets scenes animate the picture inside. */
function Pic({
  x, y, w, h, pal, id, innerStyle, innerClass, selected, frameStyle,
}: {
  x: number; y: number; w: number; h: number; pal: number; id: string
  innerStyle?: React.CSSProperties; innerClass?: string; selected?: boolean; frameStyle?: React.CSSProperties
}) {
  return (
    <g style={frameStyle}>
      <svg x={x} y={y} width={w} height={h} viewBox="0 0 100 75" preserveAspectRatio="xMidYMid slice">
        <g className={innerClass} style={{ ...box, ...innerStyle }}>
          <Art pal={pal} id={id} />
        </g>
      </svg>
      {selected && <rect x={x - 1.5} y={y - 1.5} width={w + 3} height={h + 3} fill="none" stroke={GOLD} strokeWidth="2.5" />}
    </g>
  )
}

function Spread({ x = 40, y = 26, w = 240, h = 128, fill = CREAM }: { x?: number; y?: number; w?: number; h?: number; fill?: string }) {
  return (
    <g>
      <rect x={x + 3} y={y + 4} width={w} height={h} fill="rgba(0,0,0,0.45)" rx="2" />
      <rect x={x} y={y} width={w} height={h} fill={fill} rx="2" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
    </g>
  )
}

function Pointer({ name, touch }: { name: string; touch: boolean }) {
  return (
    <g style={anim(name)}>
      {touch ? (
        <g>
          <circle r="11" fill="rgba(255,255,255,0.25)" stroke="#fff" strokeWidth="1.5" />
          <circle r="4" fill="#fff" />
        </g>
      ) : (
        <path
          d="M0 0 L0 17 L4.5 13 L7.5 20 L10.5 18.6 L7.6 12 L13 12 Z"
          fill="#fff"
          stroke="#111"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      )}
    </g>
  )
}

function Btn({ x, y, w, label, name, on }: { x: number; y: number; w: number; label: string; name?: string; on?: boolean }) {
  const t = (fill: string) => (
    <text x={x + w / 2} y={y + 11.6} textAnchor="middle" fontSize="8" letterSpacing="0.6" fill={fill} fontFamily="system-ui, sans-serif" fontWeight={600}>
      {label}
    </text>
  )
  return (
    <g>
      <rect x={x} y={y} width={w} height={17} rx="8.5" fill={on ? GOLD : 'rgba(184,150,90,0.12)'} stroke={GOLD} strokeWidth="1" />
      {t(on ? INK : GOLD)}
      {name && (
        <g style={anim(name)}>
          <rect x={x} y={y} width={w} height={17} rx="8.5" fill={GOLD} />
          {t(INK)}
        </g>
      )}
    </g>
  )
}

function Caption({ text }: { text: string }) {
  return (
    <text x="160" y="173" textAnchor="middle" fontSize="8.5" letterSpacing="1.4" fill="rgba(244,237,232,0.55)" fontFamily="system-ui, sans-serif">
      {text.toUpperCase()}
    </text>
  )
}

function EmptySlot({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#efe7dc" stroke="rgba(184,150,90,0.7)" strokeDasharray="3 2" />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize="13" fill={GOLD}>+</text>
    </g>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function Scene({ scene, label, touch, id }: { scene: DemoScene; label?: string; touch: boolean; id: string }) {
  const n = (s: string) => `${id}-${s}`
  const css: string[] = []
  let body: React.ReactNode = null

  // Two photo slots on a standard spread (left & right page).
  const A = { x: 48, y: 34, w: 104, h: 112 }
  const B = { x: 168, y: 34, w: 104, h: 112 }

  switch (scene) {
    case 'swapDrag': {
      css.push(
        path(n('p'), [[0, 230, 175], [15, 100, 90], [22, 100, 90, true], [50, 220, 90, true], [56, 220, 90], [80, 250, 170], [100, 230, 175]]),
        path(n('ghost'), [[0, 100, 90], [22, 100, 90], [50, 220, 90], [100, 220, 90]]),
        show(n('gv'), 22, 50, 0.85),
        show(n('before'), 0, 55),
        show(n('after'), 55, 94),
      )
      body = (
        <>
          <Spread />
          <g style={anim(n('before'))}>
            <Pic {...A} pal={0} id={id} />
            <Pic {...B} pal={1} id={id} />
          </g>
          <g style={anim(n('after'))}>
            <Pic {...A} pal={1} id={id} />
            <Pic {...B} pal={0} id={id} />
          </g>
          <g style={anim(n('gv'))}>
            <g style={anim(n('ghost'))}>
              <Pic x={-22} y={-18} w={44} h={40} pal={0} id={id} frameStyle={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))' }} />
            </g>
          </g>
          <Pointer name={n('p')} touch={touch} />
          <Caption text="Drag a photo onto another" />
        </>
      )
      break
    }
    case 'swapButton':
    case 'tapPlace': {
      const withBtn = scene === 'swapButton'
      const S = { x: 22, y: 22, w: 200, h: 112 }
      const a = { x: 30, y: 30, w: 88, h: 96 }
      const b = { x: 126, y: 30, w: 88, h: 96 }
      const t1 = { x: 244, y: 30, w: 56, h: 42 }
      const t2 = { x: 244, y: 80, w: 56, h: 42 }
      const target = withBtn ? a : b
      const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
      if (withBtn) {
        css.push(
          path(n('p'), [[0, 160, 170], [12, tc.x, tc.y], [16, tc.x, tc.y, true], [20, tc.x, tc.y], [32, 60, 146], [36, 60, 146, true], [40, 60, 146], [55, 272, 51], [60, 272, 51, true], [64, 272, 51], [85, 200, 170], [100, 160, 170]]),
          show(n('sel'), 17, 90),
          show(n('bar'), 17, 90),
          show(n('btn'), 36, 62),
          show(n('ring'), 40, 62),
          show(n('after'), 62, 94),
        )
      } else {
        css.push(
          path(n('p'), [[0, 160, 170], [14, 272, 51], [19, 272, 51, true], [23, 272, 51], [46, tc.x, tc.y], [51, tc.x, tc.y, true], [55, tc.x, tc.y], [80, 200, 170], [100, 160, 170]]),
          show(n('ring'), 20, 54),
          show(n('after'), 54, 94),
        )
      }
      body = (
        <>
          <Spread {...S} />
          <Pic {...a} pal={0} id={id} />
          {withBtn ? <Pic {...b} pal={1} id={id} /> : <EmptySlot {...b} />}
          <g style={anim(n('after'))}>
            <Pic {...target} pal={2} id={id} />
          </g>
          <text x="272" y="22" textAnchor="middle" fontSize="7" letterSpacing="1" fill="rgba(244,237,232,0.5)" fontFamily="system-ui">UNUSED</text>
          <Pic {...t1} pal={2} id={id} />
          <g style={anim(n('after'))}>
            {withBtn ? (
              <Pic {...t1} pal={0} id={id} />
            ) : (
              <rect x={t1.x} y={t1.y} width={t1.w} height={t1.h} fill="#110d0a" stroke="rgba(184,150,90,0.35)" strokeDasharray="3 2" />
            )}
          </g>
          <Pic {...t2} pal={3} id={id} />
          <rect x={t1.x - 2} y={t1.y - 2} width={t1.w + 4} height={t1.h + 4} fill="none" stroke={GOLD} strokeWidth="2.5" style={anim(n('ring'))} />
          {withBtn && (
            <>
              <rect x={a.x - 1.5} y={a.y - 1.5} width={a.w + 3} height={a.h + 3} fill="none" stroke={GOLD} strokeWidth="2.5" style={anim(n('sel'))} />
              <g style={anim(n('bar'))}>
                <rect x="22" y="138" width="200" height="23" rx="4" fill="#241d16" stroke="rgba(184,150,90,0.3)" />
                <Btn x={26} y={141} w={72} label="⇄ Swap photo" name={n("btn")} />
                <Btn x={102} y={141} w={46} label="↺ Reset" />
                <Btn x={152} y={141} w={62} label="✕ Remove" />
              </g>
            </>
          )}
          <Pointer name={n('p')} touch={touch} />
          <Caption text={withBtn ? 'Photo → Swap → pick from Unused' : 'Tap unused photo · then tap a slot'} />
        </>
      )
      break
    }
    case 'pan': {
      css.push(
        path(n('p'), [[0, 250, 170], [15, 220, 90], [22, 220, 90, true], [45, 196, 90, true], [70, 244, 90, true], [85, 220, 90, true], [90, 220, 90], [100, 250, 170]]),
        kf(n('img'), [[0, 'transform:translate(0px,0)'], [22, 'transform:translate(0px,0)'], [45, 'transform:translate(-20px,0)'], [70, 'transform:translate(20px,0)'], [85, 'transform:translate(0px,0)'], [100, 'transform:translate(0px,0)']]),
        kf(n('ghost'), [[0, 'transform:translate(0px,0)'], [22, 'transform:translate(0px,0)'], [45, 'transform:translate(-24px,0)'], [70, 'transform:translate(24px,0)'], [85, 'transform:translate(0px,0)'], [100, 'transform:translate(0px,0)']]),
      )
      body = (
        <>
          <Spread />
          <Pic {...A} pal={3} id={id} />
          {/* ghost = the part of the photo outside the frame */}
          <g opacity="0.3" style={anim(n('ghost'))}>
            <svg x={146} y={34} width={148} height={112} viewBox="0 0 132 100" preserveAspectRatio="none">
              <Art pal={0} id={id} />
            </svg>
          </g>
          <Pic {...B} pal={0} id={id} innerStyle={anim(n('img'))} selected />
          <Pointer name={n('p')} touch={touch} />
          <Caption text="Select the photo · drag to reposition" />
        </>
      )
      break
    }
    case 'zoom':
    case 'pinch':
    case 'dpi': {
      const pinch = scene === 'pinch'
      const dpi = scene === 'dpi'
      css.push(
        kf(n('img'), [[0, 'transform:scale(1)'], [20, 'transform:scale(1)'], [55, 'transform:scale(1.55)'], [80, 'transform:scale(1.55)'], [95, 'transform:scale(1)'], [100, 'transform:scale(1)']]),
        kf(n('thumb'), [[0, 'transform:translate(0px,0)'], [20, 'transform:translate(0px,0)'], [55, 'transform:translate(58px,0)'], [80, 'transform:translate(58px,0)'], [95, 'transform:translate(0px,0)'], [100, 'transform:translate(0px,0)']]),
      )
      if (pinch) {
        css.push(
          path(n('f1'), [[0, 214, 96], [20, 214, 96, true], [55, 190, 116, true], [80, 190, 116, true], [95, 214, 96], [100, 214, 96]]),
          path(n('f2'), [[0, 226, 84], [20, 226, 84, true], [55, 250, 64, true], [80, 250, 64, true], [95, 226, 84], [100, 226, 84]]),
        )
      } else {
        css.push(path(n('p'), [[0, 150, 175], [15, 104, 162], [20, 104, 162, true], [55, 162, 162, true], [80, 162, 162, true], [95, 104, 162], [100, 150, 175]]))
      }
      css.push(show(n('sharp'), 0, 38), show(n('soft'), 42, 88))
      body = (
        <>
          <Spread y={16} h={120} />
          <Pic x={48} y={24} w={104} h={104} pal={2} id={id} />
          <Pic x={168} y={24} w={104} h={104} pal={1} id={id} innerStyle={anim(n('img'))} selected />
          {!pinch && (
            <g>
              <text x="60" y="165" fontSize="7.5" letterSpacing="1.2" fill="rgba(244,237,232,0.6)" fontFamily="system-ui">ZOOM</text>
              <rect x="100" y="160" width="70" height="3" rx="1.5" fill="rgba(184,150,90,0.3)" />
              <g style={anim(n('thumb'))}>
                <circle cx="104" cy="161.5" r="5" fill={GOLD} />
              </g>
            </g>
          )}
          {(dpi || !pinch) && (
            <g>
              <g style={anim(n('sharp'))}>
                <rect x="196" y="154" width="76" height="15" rx="7.5" fill="rgba(76,175,80,0.2)" stroke="#4caf50" />
                <text x="234" y="164" textAnchor="middle" fontSize="7.5" fill="#8fdc92" fontFamily="system-ui" fontWeight={600}>{dpi ? '320 DPI · Sharp' : '310 DPI · Sharp'}</text>
              </g>
              <g style={anim(n('soft'))}>
                <rect x="196" y="154" width="76" height="15" rx="7.5" fill={dpi ? 'rgba(229,57,53,0.2)' : 'rgba(76,175,80,0.2)'} stroke={dpi ? '#e53935' : '#4caf50'} />
                <text x="234" y="164" textAnchor="middle" fontSize="7.5" fill={dpi ? '#ff9a97' : '#8fdc92'} fontFamily="system-ui" fontWeight={600}>{dpi ? '140 DPI · Soft' : '305 DPI · Sharp'}</text>
              </g>
            </g>
          )}
          {pinch ? (
            <>
              <Pointer name={n('f1')} touch />
              <Pointer name={n('f2')} touch />
            </>
          ) : (
            <Pointer name={n('p')} touch={touch} />
          )}
          {pinch && <Caption text="Pinch two fingers apart to zoom" />}
        </>
      )
      break
    }
    case 'rotate':
    case 'straighten': {
      const str = scene === 'straighten'
      if (str) {
        css.push(
          kf(n('img'), [[0, 'transform:rotate(-9deg) scale(1.25)'], [25, 'transform:rotate(-9deg) scale(1.25)'], [60, 'transform:rotate(0deg) scale(1)'], [90, 'transform:rotate(0deg) scale(1)'], [100, 'transform:rotate(-9deg) scale(1.25)']]),
          kf(n('thumb'), [[0, 'transform:translate(-18px,0)'], [25, 'transform:translate(-18px,0)'], [60, 'transform:translate(0px,0)'], [90, 'transform:translate(0px,0)'], [100, 'transform:translate(-18px,0)']]),
          path(n('p'), [[0, 200, 178], [18, 117, 162], [25, 117, 162, true], [60, 135, 162, true], [66, 135, 162], [90, 220, 178], [100, 200, 178]]),
        )
      } else {
        // corner handle travels an arc around the photo centre (220, 90)
        const pts: [number, number, number, boolean?][] = [[0, 290, 170], [15, 272, 34], [22, 272, 34, true]]
        for (let k = 1; k <= 6; k++) {
          const a = (-47 + k * 2.2) * (Math.PI / 180)
          const r = 76
          pts.push([22 + k * 6, 220 + r * Math.cos(a), 90 + r * Math.sin(a), true])
        }
        pts.push([62, 272, 44], [85, 290, 170], [100, 290, 170])
        css.push(
          path(n('p'), pts),
          kf(n('img'), [[0, 'transform:rotate(0deg) scale(1)'], [22, 'transform:rotate(0deg) scale(1)'], [58, 'transform:rotate(12deg) scale(1.32)'], [88, 'transform:rotate(12deg) scale(1.32)'], [100, 'transform:rotate(0deg) scale(1)']]),
          show(n('lbl'), 30, 88),
        )
      }
      body = (
        <>
          <Spread />
          <Pic {...A} pal={2} id={id} />
          <Pic {...B} pal={0} id={id} innerStyle={anim(n('img'))} selected />
          {!str &&
            [[B.x, B.y], [B.x + B.w, B.y], [B.x, B.y + B.h], [B.x + B.w, B.y + B.h]].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r="4.5" fill="#fff" stroke={GOLD} strokeWidth="1.5" />
            ))}
          {!str && (
            <g style={anim(n('lbl'))}>
              <rect x="199" y="80" width="42" height="18" rx="9" fill="rgba(14,12,9,0.8)" />
              <text x="220" y="92.5" textAnchor="middle" fontSize="9" fill="#fff" fontFamily="system-ui" fontWeight={600}>12°</text>
            </g>
          )}
          {str && (
            <g>
              <text x="40" y="165" fontSize="7.5" letterSpacing="1.2" fill="rgba(244,237,232,0.6)" fontFamily="system-ui">STRAIGHTEN</text>
              <rect x="100" y="160" width="70" height="3" rx="1.5" fill="rgba(184,150,90,0.3)" />
              <line x1="135" y1="156" x2="135" y2="167" stroke="rgba(244,237,232,0.4)" />
              <g style={anim(n('thumb'))}>
                <circle cx="135" cy="161.5" r="5" fill={GOLD} />
              </g>
            </g>
          )}
          <Pointer name={n('p')} touch={touch} />
          {!str && <Caption text="Drag a corner handle to rotate" />}
        </>
      )
      break
    }
    case 'flip': {
      css.push(
        kf(n('img'), [[0, 'transform:scaleX(1)'], [40, 'transform:scaleX(1)'], [50, 'transform:scaleX(-1)'], [88, 'transform:scaleX(-1)'], [98, 'transform:scaleX(1)'], [100, 'transform:scaleX(1)']]),
        path(n('p'), [[0, 150, 178], [25, 121, 164], [36, 121, 164, true], [42, 121, 164], [80, 150, 178], [100, 150, 178]]),
        show(n('btn'), 36, 46),
      )
      body = (
        <>
          <Spread y={18} h={124} />
          <Pic x={48} y={26} w={104} h={108} pal={3} id={id} />
          <Pic x={168} y={26} w={104} h={108} pal={0} id={id} innerStyle={anim(n('img'))} selected />
          <Btn x={48} y={155} w={52} label="More ▴" on />
          <Btn x={106} y={155} w={32} label="⇄" name={n('btn')} />
          <Btn x={142} y={155} w={32} label="⇅" />
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'border': {
      css.push(
        kf(n('fr'), [[0, 'stroke-width:0'], [25, 'stroke-width:0'], [60, 'stroke-width:9'], [90, 'stroke-width:9'], [100, 'stroke-width:0']]),
        kf(n('thumb'), [[0, 'transform:translate(0px,0)'], [25, 'transform:translate(0px,0)'], [60, 'transform:translate(50px,0)'], [90, 'transform:translate(50px,0)'], [100, 'transform:translate(0px,0)']]),
        path(n('p'), [[0, 160, 178], [18, 104, 164], [25, 104, 164, true], [60, 154, 164, true], [66, 154, 164], [90, 200, 178], [100, 160, 178]]),
      )
      body = (
        <>
          <Spread x={40} y={14} w={240} h={128} fill="#3a342c" />
          <Pic x={62} y={30} w={84} h={96} pal={1} id={id} />
          <rect x={62} y={30} width={84} height={96} fill="none" stroke={CREAM} style={anim(n('fr'))} />
          <Pic x={174} y={30} w={84} h={96} pal={2} id={id} />
          <text x="40" y="167" fontSize="7.5" letterSpacing="1.2" fill="rgba(244,237,232,0.6)" fontFamily="system-ui">BORDER</text>
          <rect x="100" y="162" width="70" height="3" rx="1.5" fill="rgba(184,150,90,0.3)" />
          <g style={anim(n('thumb'))}>
            <circle cx="104" cy="163.5" r="5" fill={GOLD} />
          </g>
          {['#fff', CREAM, '#111', '#444', GOLD].map((c, i) => (
            <circle key={i} cx={196 + i * 15} cy={163.5} r="5.5" fill={c} stroke="rgba(184,150,90,0.6)" />
          ))}
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'remove': {
      css.push(
        path(n('p'), [[0, 150, 178], [14, 220, 90], [18, 220, 90, true], [22, 220, 90], [36, 250, 162], [41, 250, 162, true], [45, 250, 162], [80, 150, 178], [100, 150, 178]]),
        show(n('sel'), 19, 46),
        show(n('bar'), 19, 50),
        kf(n('fly'), [[0, 'transform:translate(0,0) scale(1);opacity:1'], [44, 'transform:translate(0,0) scale(1);opacity:1'], [62, 'transform:translate(70px,40px) scale(.2);opacity:0'], [94, 'transform:translate(70px,40px) scale(.2);opacity:0'], [100, 'transform:translate(0,0) scale(1);opacity:1']]),
      )
      body = (
        <>
          <Spread y={14} h={124} />
          <Pic x={48} y={22} w={104} h={108} pal={1} id={id} />
          <EmptySlot x={168} y={22} w={104} h={108} />
          <g style={{ ...anim(n('fly')), ...box }}>
            <Pic x={168} y={22} w={104} h={108} pal={0} id={id} />
          </g>
          <rect x={166.5} y={20.5} width={107} height={111} fill="none" stroke={GOLD} strokeWidth="2.5" style={anim(n('sel'))} />
          <g style={anim(n('bar'))}>
            <rect x="118" y="148" width="160" height="23" rx="4" fill="#241d16" stroke="rgba(184,150,90,0.3)" />
            <Btn x={124} y={151} w={70} label="⇄ Swap photo" />
            <Btn x={200} y={151} w={70} label="✕ Remove" on />
          </g>
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'layout':
    case 'count': {
      const isCount = scene === 'count'
      if (isCount) {
        css.push(
          path(n('p'), [[0, 250, 178], [14, 82, 16], [19, 82, 16, true], [23, 82, 16], [38, 72, 61], [43, 72, 61, true], [47, 72, 61], [80, 250, 178], [100, 250, 178]]),
          show(n('menu'), 20, 46),
        )
      } else {
        css.push(path(n('p'), [[0, 250, 178], [16, 158, 22], [26, 158, 22, true], [30, 158, 22], [80, 250, 178], [100, 250, 178]]))
      }
      css.push(show(n('before'), 0, isCount ? 46 : 28), show(n('after'), isCount ? 46 : 28, 94))
      const sp = { x: 40, y: 38, w: 240, h: 120 }
      body = (
        <>
          <Spread {...sp} />
          <g style={anim(n('before'))}>
            <Pic x={48} y={46} w={104} h={104} pal={1} id={id} />
            <Pic x={168} y={46} w={104} h={104} pal={0} id={id} />
          </g>
          <g style={anim(n('after'))}>
            <Pic x={48} y={46} w={104} h={104} pal={1} id={id} />
            <Pic x={168} y={46} w={104} h={50} pal={0} id={id} />
            <EmptySlot x={168} y={100} w={104} h={50} />
          </g>
          {isCount ? (
            <g>
              <Btn x={50} y={8} w={64} label="2 photos ▾" />
              <g style={anim(n('menu'))}>
                <rect x="50" y="28" width="64" height="62" rx="4" fill="#241d16" stroke={GOLD} />
                {['1', '2', '3', '4'].map((t, i) => (
                  <g key={t}>
                    {t === '3' && <rect x="52" y={30 + i * 15} width="60" height="14" rx="3" fill="rgba(184,150,90,0.3)" />}
                    <text x="82" y={40 + i * 15} textAnchor="middle" fontSize="8" fill={CREAM} fontFamily="system-ui">{t}</text>
                  </g>
                ))}
              </g>
            </g>
          ) : (
            <g>
              {[0, 1, 2].map((i) => {
                const x = 60 + i * 66
                return (
                  <g key={i}>
                    <rect x={x} y={8} width={52} height={24} rx="2" fill="#3a2f22" stroke={i === 0 ? GOLD : 'rgba(184,150,90,0.35)'} strokeWidth={i === 0 ? 1.5 : 1} />
                    <line x1={x + 26} y1={8} x2={x + 26} y2={32} stroke="rgba(184,150,90,0.5)" />
                    {i === 1 && <line x1={x + 26} y1={20} x2={x + 52} y2={20} stroke="rgba(184,150,90,0.5)" />}
                    {i === 2 && <line x1={x} y1={20} x2={x + 26} y2={20} stroke="rgba(184,150,90,0.5)" />}
                  </g>
                )
              })}
              <rect x={124} y={6} width={56} height={28} rx="3" fill="none" stroke={GOLD} strokeWidth="2" style={anim(n('after'))} />
            </g>
          )}
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'bg': {
      css.push(
        path(n('p'), [[0, 160, 178], [14, 58, 16], [19, 58, 16, true], [23, 58, 16], [40, 146, 16], [45, 146, 16, true], [49, 146, 16], [80, 250, 178], [100, 160, 178]]),
        show(n('sw'), 20, 60),
        show(n('after'), 47, 94),
      )
      body = (
        <>
          <Spread x={40} y={34} w={240} h={124} />
          <g style={anim(n('after'))}>
            <rect x={40} y={34} width={240} height={124} fill="#3a342c" rx="2" />
          </g>
          <Pic x={58} y={50} w={86} h={92} pal={0} id={id} />
          <Pic x={176} y={50} w={86} h={92} pal={2} id={id} />
          <Btn x={40} y={8} w={36} label="BG" />
          <g style={anim(n('sw'))}>
            <rect x="84" y="4" width="120" height="25" rx="4" fill="#241d16" stroke="rgba(184,150,90,0.4)" />
            {['#ffffff', CREAM, '#efe6d2', '#3a342c', '#111', '#e8c9c5'].map((c, i) => (
              <circle key={i} cx={98 + i * 18} cy={16.5} r="6.5" fill={c} stroke={i === 3 ? GOLD : 'rgba(184,150,90,0.5)'} strokeWidth={i === 3 ? 2 : 1} />
            ))}
          </g>
          <Pointer name={n('p')} touch={touch} />
          <Caption text="BG → pick a colour" />
        </>
      )
      break
    }
    case 'text': {
      css.push(
        path(n('p'), [[0, 250, 178], [12, 133, 150], [17, 133, 150, true], [21, 133, 150], [35, 96, 60], [40, 96, 60, true], [65, 160, 60, true], [72, 160, 60], [90, 250, 178], [100, 250, 178]]),
        show(n('txt'), 20, 94),
        kf(n('mv'), [[0, 'transform:translate(0px,0)'], [40, 'transform:translate(0px,0)'], [65, 'transform:translate(64px,0)'], [100, 'transform:translate(64px,0)']]),
        show(n('guide'), 60, 72),
      )
      body = (
        <>
          <Spread />
          <Pic x={48} y={76} w={224} h={62} pal={1} id={id} />
          <line x1="160" y1="30" x2="160" y2="150" stroke={GOLD} strokeWidth="1.5" strokeDasharray="4 3" style={anim(n('guide'))} />
          <g style={anim(n('txt'))}>
            <g style={anim(n('mv'))}>
              <text x="96" y="64" textAnchor="middle" fontSize="16" fill="#3a2a1d" fontFamily="Georgia, serif" fontStyle="italic">Our Day</text>
            </g>
          </g>
          <Btn x={110} y={142} w={46} label="＋ Text" />
          <Btn x={164} y={142} w={46} label="＋ Title" />
          <Pointer name={n('p')} touch={touch} />
          <Caption text="Add text · drag · snaps to centre" />
        </>
      )
      break
    }
    case 'reorder': {
      css.push(
        path(n('p'), [[0, 150, 178], [15, 46, 132], [22, 46, 132, true], [55, 46, 36, true], [60, 46, 36], [85, 150, 178], [100, 150, 178]]),
        kf(n('t3'), [[0, 'transform:translate(0,0)'], [22, 'transform:translate(0,0)'], [55, 'transform:translate(0,-96px)'], [92, 'transform:translate(0,-96px)'], [100, 'transform:translate(0,0)']]),
        kf(n('t12'), [[0, 'transform:translate(0,0)'], [35, 'transform:translate(0,0)'], [55, 'transform:translate(0,48px)'], [92, 'transform:translate(0,48px)'], [100, 'transform:translate(0,0)']]),
        show(n('line'), 40, 56),
      )
      const tile = (y: number, pal: number, label: string) => (
        <g>
          <rect x="20" y={y} width="56" height="40" rx="3" fill="#1f1812" stroke="rgba(184,150,90,0.4)" />
          <Pic x={24} y={y + 4} w={48} h={24} pal={pal} id={id} />
          <text x="48" y={y + 36} textAnchor="middle" fontSize="6.5" letterSpacing="1" fill={GOLD} fontFamily="system-ui" fontWeight={700}>{label}</text>
        </g>
      )
      body = (
        <>
          <rect x="12" y="6" width="72" height="160" rx="6" fill="rgba(20,16,12,0.8)" stroke="rgba(184,150,90,0.35)" />
          <g style={anim(n('t12'))}>
            {tile(16, 0, 'SPREAD 1')}
            {tile(64, 1, 'SPREAD 2')}
          </g>
          <line x1="18" y1="12" x2="78" y2="12" stroke={GOLD} strokeWidth="2" style={anim(n('line'))} />
          <g style={{ ...anim(n('t3')), filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.6))' }}>{tile(112, 2, 'SPREAD 3')}</g>
          <Spread x={104} y={30} w={200} h={108} />
          <Pic x={112} y={38} w={88} h={92} pal={2} id={id} />
          <Pic x={208} y={38} w={88} h={92} pal={3} id={id} />
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'undo': {
      css.push(
        show(n('a'), 0, 30),
        show(n('b'), 30, 62),
        show(n('c'), 62, 100),
        path(n('p'), [[0, 200, 178], [40, 76, 16], [55, 76, 16], [60, 76, 16, true], [64, 76, 16], [90, 200, 178], [100, 200, 178]]),
        show(n('key'), 58, 80),
      )
      body = (
        <>
          <Spread y={34} h={120} />
          <g style={anim(n('a'))}>
            <Pic x={48} y={42} w={104} h={104} pal={0} id={id} />
            <Pic x={168} y={42} w={104} h={104} pal={1} id={id} />
          </g>
          <g style={anim(n('b'))}>
            <Pic x={48} y={42} w={104} h={104} pal={3} id={id} />
            <Pic x={168} y={42} w={104} h={104} pal={1} id={id} />
          </g>
          <g style={anim(n('c'))}>
            <Pic x={48} y={42} w={104} h={104} pal={0} id={id} />
            <Pic x={168} y={42} w={104} h={104} pal={1} id={id} />
          </g>
          <Btn x={60} y={8} w={32} label="↶" />
          <Btn x={96} y={8} w={32} label="↷" />
          <g style={anim(n('key'))}>
            <rect x="200" y="7" width="80" height="19" rx="4" fill="#241d16" stroke={GOLD} />
            <text x="240" y="20" textAnchor="middle" fontSize="8.5" fill={CREAM} fontFamily="system-ui" fontWeight={600}>Ctrl + Z</text>
          </g>
          <Pointer name={n('p')} touch={touch} />
          <Caption text="Undo puts it back" />
        </>
      )
      break
    }
    case 'upload': {
      css.push(path(n('p'), [[0, 150, 178], [14, 80, 90], [20, 80, 90, true], [24, 80, 90], [60, 150, 178], [100, 150, 178]]))
      const cells = [0, 1, 2, 3, 4, 5]
      cells.forEach((i) => css.push(show(n(`c${i}`), 28 + i * 8, 94)))
      body = (
        <>
          <rect x="24" y="30" width="112" height="112" rx="8" fill="rgba(184,150,90,0.06)" stroke={GOLD} strokeDasharray="5 4" />
          <text x="80" y="84" textAnchor="middle" fontSize="20" fill={GOLD}>↑</text>
          <text x="80" y="102" textAnchor="middle" fontSize="8" letterSpacing="1.4" fill={GOLD} fontFamily="system-ui" fontWeight={700}>ADD PHOTOS</text>
          {cells.map((i) => (
            <g key={i} style={anim(n(`c${i}`))}>
              <Pic x={156 + (i % 3) * 48} y={40 + Math.floor(i / 3) * 52} w={42} h={46} pal={i} id={id} />
            </g>
          ))}
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'tagDrag': {
      css.push(
        path(n('p'), [[0, 160, 178], [15, 62, 132], [22, 62, 132, true], [55, 220, 40, true], [60, 220, 40], [85, 160, 178], [100, 160, 178]]),
        path(n('g'), [[0, 62, 132], [22, 62, 132], [55, 220, 40], [100, 220, 40]]),
        show(n('gv'), 22, 55, 0.9),
        show(n('hit'), 55, 94),
        show(n('orig'), 0, 22),
      )
      body = (
        <>
          {[['MEHNDI', 30], ['WEDDING', 170]].map(([t, x]) => (
            <g key={t as string}>
              <rect x={x as number} y="12" width="120" height="56" rx="6" fill="#1f1812" stroke="rgba(184,150,90,0.5)" />
              <text x={(x as number) + 12} y="28" fontSize="8" letterSpacing="1.4" fill={GOLD} fontFamily="system-ui" fontWeight={700}>{t}</text>
            </g>
          ))}
          <rect x="170" y="12" width="120" height="56" rx="6" fill="rgba(184,150,90,0.15)" stroke={GOLD} strokeWidth="2" style={anim(n('hit'))} />
          <g style={anim(n('hit'))}>
            <Pic x={182} y={36} w={26} h={24} pal={1} id={id} />
          </g>
          {[0, 1, 2, 3].map((i) => (
            <g key={i} style={i === 0 ? anim(n('orig')) : undefined}>
              <Pic x={40 + i * 62} y={108} w={50} h={48} pal={i === 0 ? 1 : i + 1} id={id} />
            </g>
          ))}
          <g style={anim(n('gv'))}>
            <g style={anim(n('g'))}>
              <Pic x={-20} y={-18} w={40} h={38} pal={1} id={id} />
            </g>
          </g>
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'star': {
      css.push(
        path(n('p'), [[0, 160, 178], [18, 118, 50], [24, 118, 50, true], [28, 118, 50], [52, 250, 50], [58, 250, 50, true], [62, 250, 50], [88, 160, 178], [100, 160, 178]]),
        show(n('s'), 25, 94),
        show(n('h'), 59, 94),
      )
      body = (
        <>
          <Pic x={30} y={36} w={112} h={112} pal={0} id={id} />
          <Pic x={162} y={36} w={112} h={112} pal={2} id={id} />
          {[[118, 50], [250, 50]].map(([cx, cy], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r="10" fill="rgba(14,12,9,0.65)" stroke="rgba(255,255,255,0.7)" />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fill="#fff">{i === 0 ? '☆' : '♡'}</text>
            </g>
          ))}
          <g style={anim(n('s'))}>
            <circle cx="118" cy="50" r="10" fill={GOLD} />
            <text x="118" y="54" textAnchor="middle" fontSize="11" fill={INK}>★</text>
            <rect x="36" y="128" width="40" height="14" rx="7" fill={GOLD} />
            <text x="56" y="138" textAnchor="middle" fontSize="7.5" letterSpacing="1" fill={INK} fontFamily="system-ui" fontWeight={700}>HERO</text>
          </g>
          <g style={anim(n('h'))}>
            <circle cx="250" cy="50" r="10" fill="#c2185b" />
            <text x="250" y="54" textAnchor="middle" fontSize="11" fill="#fff">♥</text>
          </g>
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'slider': {
      css.push(
        kf(n('thumb'), [[0, 'transform:translate(0px,0)'], [22, 'transform:translate(0px,0)'], [60, 'transform:translate(110px,0)'], [88, 'transform:translate(110px,0)'], [100, 'transform:translate(0px,0)']]),
        path(n('p'), [[0, 160, 178], [15, 90, 96], [22, 90, 96, true], [60, 200, 96, true], [65, 200, 96], [88, 160, 178], [100, 160, 178]]),
        show(n('v1'), 0, 40),
        show(n('v2'), 40, 92),
      )
      body = (
        <>
          <text x="160" y="52" textAnchor="middle" fontSize="9" letterSpacing="2" fill="rgba(244,237,232,0.6)" fontFamily="system-ui">{(label ?? 'Amount').toUpperCase()}</text>
          <rect x="84" y="93" width="152" height="5" rx="2.5" fill="rgba(184,150,90,0.3)" />
          <g style={anim(n('thumb'))}>
            <circle cx="90" cy="95.5" r="8" fill={GOLD} />
          </g>
          <text x="160" y="134" textAnchor="middle" fontSize="18" fill={CREAM} fontFamily="Georgia, serif" style={anim(n('v1'))}>10</text>
          <text x="160" y="134" textAnchor="middle" fontSize="18" fill={CREAM} fontFamily="Georgia, serif" style={anim(n('v2'))}>18</text>
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'flipbook': {
      css.push(
        kf(n('pg'), [[0, 'transform:scaleX(1)'], [25, 'transform:scaleX(1)'], [55, 'transform:scaleX(-1)'], [90, 'transform:scaleX(-1)'], [100, 'transform:scaleX(1)']]),
      )
      body = (
        <>
          <Spread x={40} y={26} w={240} h={128} />
          <Pic x={48} y={34} w={104} h={112} pal={1} id={id} />
          <Pic x={168} y={34} w={104} h={112} pal={3} id={id} />
          <g style={{ ...anim(n('pg')), transformBox: 'view-box', transformOrigin: '160px 90px' }}>
            <rect x={160} y={26} width={120} height={128} fill={CREAM} />
            <Pic x={168} y={34} w={104} h={112} pal={0} id={id} />
          </g>
          <Caption text="→ next page · ← back · Esc close" />
        </>
      )
      break
    }
    case 'cover': {
      css.push(
        kf(n('rot'), [[0, 'transform:skewY(-4deg) scaleX(0.92)'], [50, 'transform:skewY(4deg) scaleX(0.92)'], [100, 'transform:skewY(-4deg) scaleX(0.92)']]),
        show(n('c2'), 40, 90),
        path(n('p'), [[0, 250, 178], [30, 247, 156], [36, 247, 156, true], [40, 247, 156], [80, 250, 178], [100, 250, 178]]),
      )
      body = (
        <>
          <g style={{ ...anim(n('rot')), ...box }}>
            <rect x="112" y="16" width="100" height="130" rx="4" fill="#2a1f19" />
            <rect x="112" y="16" width="100" height="130" rx="4" fill="#5c1a24" style={anim(n('c2'))} />
            <rect x="112" y="16" width="8" height="130" fill="rgba(0,0,0,0.3)" />
            <text x="166" y="84" textAnchor="middle" fontSize="14" fill={GOLD} fontFamily="Georgia, serif" fontStyle="italic">A &amp; S</text>
            <text x="166" y="98" textAnchor="middle" fontSize="6" letterSpacing="2" fill={GOLD} fontFamily="system-ui">2026</text>
          </g>
          {['#111', '#5a3b28', '#eee4d0', '#5c1a24'].map((c, i) => (
            <circle key={i} cx={196 + i * 17} cy={160} r="6.5" fill={c} stroke={i === 3 ? GOLD : 'rgba(184,150,90,0.6)'} strokeWidth={i === 3 ? 2 : 1} />
          ))}
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'addSpread': {
      css.push(
        path(n('p'), [[0, 250, 178], [18, 160, 160], [24, 160, 160, true], [28, 160, 160], [70, 250, 178], [100, 250, 178]]),
        kf(n('new'), [[0, 'transform:translateY(12px);opacity:0'], [26, 'transform:translateY(12px);opacity:0'], [40, 'transform:translateY(0);opacity:1'], [92, 'transform:translateY(0);opacity:1'], [100, 'transform:translateY(12px);opacity:0']]),
      )
      body = (
        <>
          <Spread x={80} y={6} w={160} h={40} />
          <Pic x={86} y={10} w={70} h={32} pal={0} id={id} />
          <Pic x={164} y={10} w={70} h={32} pal={1} id={id} />
          <Spread x={80} y={54} w={160} h={40} />
          <Pic x={86} y={58} w={70} h={32} pal={2} id={id} />
          <Pic x={164} y={58} w={70} h={32} pal={3} id={id} />
          <g style={anim(n('new'))}>
            <Spread x={80} y={102} w={160} h={40} />
            <EmptySlot x={86} y={106} w={70} h={32} />
            <EmptySlot x={164} y={106} w={70} h={32} />
          </g>
          <Btn x={104} y={152} w={112} label="+ Add new spread" />
          <Pointer name={n('p')} touch={touch} />
        </>
      )
      break
    }
    case 'click':
    default: {
      const text = label ?? 'Click'
      const w = Math.min(220, Math.max(70, text.length * 6.4 + 26))
      css.push(
        path(n('p'), [[0, 250, 178], [25, 160, 100], [34, 160, 100, true], [38, 160, 100], [80, 250, 178], [100, 250, 178]]),
        show(n('on'), 34, 70),
        kf(n('rip'), [[0, 'transform:scale(0.2);opacity:0'], [34, 'transform:scale(0.2);opacity:0.9'], [55, 'transform:scale(2.4);opacity:0'], [100, 'transform:scale(2.4);opacity:0']]),
      )
      body = (
        <>
          <rect x="30" y="24" width="260" height="132" rx="10" fill="#1d1712" stroke="rgba(184,150,90,0.25)" />
          <rect x="50" y="42" width="120" height="6" rx="3" fill="rgba(244,237,232,0.12)" />
          <rect x="50" y="56" width="180" height="6" rx="3" fill="rgba(244,237,232,0.08)" />
          <g>
            <rect x={160 - w / 2} y={88} width={w} height={24} rx="12" fill="rgba(184,150,90,0.12)" stroke={GOLD} />
            <text x="160" y="104" textAnchor="middle" fontSize="9.5" letterSpacing="0.6" fill={GOLD} fontFamily="system-ui" fontWeight={600}>
              {text}
            </text>
            <g style={anim(n('on'))}>
              <rect x={160 - w / 2} y={88} width={w} height={24} rx="12" fill={GOLD} />
              <text x="160" y="104" textAnchor="middle" fontSize="9.5" letterSpacing="0.6" fill={INK} fontFamily="system-ui" fontWeight={600}>
                {text}
              </text>
            </g>
          </g>
          <circle cx="160" cy="100" r="14" fill="none" stroke={GOLD} strokeWidth="2" style={{ ...anim(n('rip'), 'ease-out'), ...box }} />
          <Pointer name={n('p')} touch={touch} />
        </>
      )
    }
  }

  return (
    <>
      <style>{css.join('\n') + `@media (prefers-reduced-motion: reduce){.hd-root *{animation-duration:${D * 3}s !important}}`}</style>
      {body}
    </>
  )
}

export default function HelpDemo({ scene, label, touch }: { scene: DemoScene; label?: string; touch: boolean }) {
  const raw = useId()
  const id = 'hd' + raw.replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg
      className="hd-root"
      viewBox="0 0 320 180"
      role="img"
      aria-label="Animated demo"
      style={{ width: '100%', height: 'auto', display: 'block', background: '#110d0a', borderRadius: 8 }}
    >
      <Scene key={scene + (label ?? '')} scene={scene} label={label} touch={touch} id={id} />
    </svg>
  )
}
