// src/lib/help/search.ts
//
// Tiny, dependency-free "smart" search over the guide library.
//   1. normalise the question (lower-case, strip punctuation, drop filler
//      words like "how do i", "pls", "my")
//   2. map every word to a canonical concept via SYNONYMS
//      ("switch", "swop", "exchange" → swap; "crooked" → straighten …)
//   3. fuzzy-match remaining words (typos: "swithc", "rotat", "backgound")
//   4. score title > keywords > steps, boost guides for the current step
// Runs entirely in the browser — instant, no server, no AI cost.

import { GUIDES, type Guide, type HelpArea } from './guides'

/** Canonical concept → words people use for it. */
const SYNONYM_GROUPS: Record<string, string[]> = {
  swap: ['swap', 'swop', 'switch', 'exchange', 'interchange', 'trade', 'swapping', 'switching'],
  replace: ['replace', 'replacing', 'change photo', 'change picture', 'change pic', 'different photo', 'another photo', 'wrong photo', 'wrong picture', 'wrong pic'],
  photo: ['photo', 'photos', 'pic', 'pics', 'picture', 'pictures', 'image', 'images', 'img', 'foto', 'fotos', 'shot', 'shots', 'snap'],
  remove: ['remove', 'delete', 'erase', 'discard', 'trash', 'bin', 'take out', 'get rid', 'removing', 'deleting'],
  rotate: ['rotate', 'rotation', 'rotating', 'turn', 'spin', 'twist', 'sideways', 'upside'],
  straighten: ['straighten', 'crooked', 'tilted', 'tilt', 'level', 'horizon', 'skew', 'skewed', 'wonky', 'slanted', 'slant', 'uneven', 'not straight'],
  zoom: ['zoom', 'zooming', 'bigger', 'enlarge', 'larger', 'closer', 'magnify', 'scale', 'smaller', 'shrink', 'zoom in', 'zoom out', 'size up'],
  move: ['move', 'moving', 'pan', 'reposition', 'position', 'shift', 'slide', 'nudge', 'adjust', 'drag', 'center', 'centre'],
  crop: ['crop', 'cropped', 'cropping', 'cut', 'cutoff', 'cut off', 'chopped', 'trim', 'head cut'],
  layout: ['layout', 'layouts', 'template', 'templates', 'arrangement', 'arrange', 'grid', 'pattern', 'design'],
  background: ['background', 'backgrounds', 'bg', 'backdrop', 'behind', 'back ground', 'colour behind', 'color behind'],
  colour: ['colour', 'color', 'colours', 'colors', 'tint', 'shade', 'hex', 'coloured', 'colored'],
  text: ['text', 'title', 'words', 'caption', 'writing', 'quote', 'heading', 'write', 'typing', 'lettering', 'wording'],
  font: ['font', 'fonts', 'typeface', 'align', 'alignment'],
  spread: ['spread', 'spreads', 'page', 'pages', 'sheet', 'sheets', 'double page'],
  add: ['add', 'insert', 'new', 'extra', 'another', 'plus', 'adding', 'put'],
  undo: ['undo', 'mistake', 'oops', 'revert', 'go back', 'accident', 'accidentally', 'ctrl z', 'undone', 'messed'],
  redo: ['redo', 'ctrl y'],
  reorder: ['reorder', 'rearrange', 're order', 'sequence', 'wrong order', 'change order', 'order of', 'move spread'],
  upload: ['upload', 'uploading', 'import', 'load', 'choose files', 'select photos', 'add photos', 'camera roll', 'gallery'],
  flip: ['flip', 'mirror', 'mirrored', 'reverse', 'backwards', 'flipped'],
  border: ['border', 'outline', 'edge', 'stroke', 'keyline'],
  empty: ['empty', 'blank', 'gap', 'hole', 'missing', 'space'],
  count: ['how many', 'number', 'count', 'fewer', 'less', 'quantity'],
  hero: ['hero', 'heroes', 'star', 'best', 'highlight', 'feature', 'featured', 'main'],
  favourite: ['favourite', 'favorite', 'favourites', 'favorites', 'heart', 'love', 'fav', 'fave'],
  event: ['event', 'events', 'group', 'grouping', 'category', 'categories', 'sort', 'tag', 'tagging', 'mehndi', 'mehendi', 'haldi', 'nikkah', 'nikah', 'wedding', 'reception', 'valima', 'walima', 'barat', 'baraat', 'sangeet'],
  cover: ['cover', 'covers', 'front'],
  pay: ['pay', 'payment', 'checkout', 'check out', 'buy', 'purchase', 'price', 'cost', 'ship', 'shipping', 'address', 'delivery', 'place order', 'order now', 'card'],
  preview: ['preview', 'flipbook', 'look through', 'see album', 'view album', 'book view'],
  approve: ['approve', 'approval', 'proof', 'confirm', 'reviewed', 'tick'],
  quality: ['dpi', 'resolution', 'blurry', 'sharp', 'soft', 'quality', 'pixelated', 'low res', 'lowres', 'grainy', 'fuzzy', 'print quality'],
  save: ['save', 'saved', 'saving', 'draft', 'autosave', 'lose', 'lost', 'resume', 'later', 'come back', 'progress'],
  rename: ['rename', 'name', 'call it'],
  magazine: ['magazine', 'mag', 'zine'],
  reset: ['reset', 'start over', 'original', 'default', 'clear'],
  whole: ['whole', 'entire', 'full photo', 'uncropped', 'no crop', 'fit', 'contain'],
  size: ['size', 'dimensions', 'format', 'inches', '17x24', '12x24', '20x30', '15x30'],
  binding: ['binding', 'layflat', 'lay flat', 'flush', 'hardcover', 'gutter', 'seam'],
  panorama: ['panorama', 'pano', 'panoramic', 'wide'],
  generate: ['generate', 'create', 'build', 'make layout', 'auto layout', 'automatic'],
  regenerate: ['regenerate', 'shuffle', 'redo layout', 'new layout', 'rebuild', 'start again'],
  eyedropper: ['eyedropper', 'eye dropper', 'dropper', 'pick colour', 'pick color', 'match colour', 'match color'],
  blur: ['blur', 'blurred', 'blurry background'],
  sample: ['sample', 'demo', 'example', 'test', 'try'],
  folder: ['folder', 'folders', 'directory', 'subfolder'],
  dropbox: ['dropbox', 'google drive', 'cloud'],
  unused: ['unused', 'pool', 'leftover', 'not used', 'sidebar', 'tray', 'spare'],
  help: ['designer', 'design team', 'professional', 'expert', 'polish', 'hand off', 'handoff'],
}

/** Words that carry no meaning for matching. */
const STOP = new Set(
  'how do i to a an the my me we our can could you your is it its in on of for with want wanna need please pls plz this that what where why does do am be are was will would should just some there here when which get got make made one via by at from as so if into up out about'.split(
    ' ',
  ),
)

const PHRASES: [RegExp, string][] = []
const WORD_TO_CANON = new Map<string, string>()
for (const [canon, words] of Object.entries(SYNONYM_GROUPS)) {
  for (const w of words) {
    if (w.includes(' ')) PHRASES.push([new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'g'), ` ${canon} `])
    else if (!WORD_TO_CANON.has(w)) WORD_TO_CANON.set(w, canon)
  }
}
// Longest phrases first so "wrong order" wins over "order".
PHRASES.sort((a, b) => b[0].source.length - a[0].source.length)

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[×]/g, 'x')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Damerau-style edit distance (handles swapped letters: "swithc"). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

const VOCAB = Array.from(WORD_TO_CANON.keys()).filter((w) => w.length >= 3)

/** Every real word used in the guides — these are never "typo-corrected". */
let KNOWN: Set<string> | null = null
function known(): Set<string> {
  if (!KNOWN) {
    KNOWN = new Set(
      normalise(GUIDES.map((g) => [g.title, g.keywords, ...g.steps, ...(g.touch ?? []), ...(g.tips ?? [])].join(' ')).join(' ')).split(' '),
    )
  }
  return KNOWN
}

/** Turn free text into a list of canonical tokens. */
export function tokenize(text: string, fuzzy = false): string[] {
  let s = ` ${normalise(text)} `
  for (const [re, canon] of PHRASES) s = s.replace(re, canon)
  const out: string[] = []
  for (const raw of s.split(' ')) {
    if (!raw || STOP.has(raw)) continue
    let w = raw
    if (!WORD_TO_CANON.has(w) && !SYNONYM_GROUPS[w]) {
      // Simple plural / -ing folding.
      const stem = w.replace(/(ing|es|s)$/, '')
      if (stem.length >= 3 && WORD_TO_CANON.has(stem)) w = stem
      else if (fuzzy && w.length >= 4 && !known().has(w)) {
        // Typo tolerance against the synonym vocabulary.
        const max = w.length >= 7 ? 2 : 1
        let best: string | null = null
        let bestD = max + 1
        for (const v of VOCAB) {
          const dd = editDistance(w, v, max)
          if (dd < bestD) {
            bestD = dd
            best = v
          }
        }
        if (best) w = best
      }
    }
    out.push(SYNONYM_GROUPS[w] ? w : WORD_TO_CANON.get(w) ?? w)
  }
  return out
}

type Indexed = { g: Guide; title: Set<string>; kw: Set<string>; body: Set<string>; titleNorm: string }

let INDEX: Indexed[] | null = null
function index(): Indexed[] {
  if (INDEX) return INDEX
  INDEX = GUIDES.map((g) => ({
    g,
    title: new Set(tokenize(g.title)),
    kw: new Set(tokenize(g.keywords)),
    body: new Set(tokenize([...g.steps, ...(g.touch ?? []), ...(g.tips ?? [])].join(' '))),
    titleNorm: normalise(g.title),
  }))
  return INDEX
}

/** Concepts that appear in most guides — low signal on their own. */
const GENERIC = new Set(['photo', 'spread', 'add', 'album', 'change'])

export type SearchContext = { app: 'smart' | 'magazine'; area?: HelpArea }

/** Which help area a smart-wizard step belongs to. */
export function areaForStep(step: string | undefined): HelpArea | undefined {
  switch (step) {
    case 'setup':
    case 'guidance':
      return 'start'
    case 'upload':
      return 'upload'
    case 'group':
      return 'group'
    case 'tag':
      return 'tag'
    case 'pages':
    case 'generate':
      return 'pages'
    case 'adjust':
      return 'adjust'
    case 'cover':
      return 'cover'
    case 'proof':
    case 'submit':
      return 'proof'
    default:
      return undefined
  }
}

function allowed(g: Guide, ctx: SearchContext): boolean {
  if (ctx.app === 'magazine') return g.area === 'magazine' || g.area === 'albums'
  return g.area !== 'magazine'
}

/** Guides to show before the client types anything. */
export function suggested(ctx: SearchContext, n = 6): Guide[] {
  const pool = GUIDES.filter((g) => allowed(g, ctx))
  const here = ctx.area ? pool.filter((g) => g.area === ctx.area) : []
  const pop = pool.filter((g) => g.popular && !here.includes(g))
  return [...here.filter((g) => g.popular), ...here.filter((g) => !g.popular), ...pop].slice(0, n)
}

export function searchGuides(query: string, ctx: SearchContext, limit = 8): Guide[] {
  const q = normalise(query)
  if (!q) return suggested(ctx)
  const tokens = Array.from(new Set(tokenize(q, true)))
  if (tokens.length === 0) return suggested(ctx)

  const hasSpecific = tokens.some((t) => !GENERIC.has(t))
  const scored: { g: Guide; s: number }[] = []
  for (const it of index()) {
    if (!allowed(it.g, ctx)) continue
    let s = 0
    let hits = 0
    let specific = 0
    for (const t of tokens) {
      let w = 0
      if (it.title.has(t)) w = 3
      else if (it.kw.has(t)) w = 2
      else if (it.body.has(t)) w = 0.6
      else if (t.length >= 3) {
        // prefix match while typing ("rot" → rotate)
        for (const set of [it.title, it.kw]) {
          for (const v of set) {
            if (v.startsWith(t)) {
              w = Math.max(w, set === it.title ? 1.6 : 1.1)
              break
            }
          }
        }
      }
      if (w > 0) hits++
      if (w > 0 && !GENERIC.has(t)) specific++
      // Generic words ("photo", "spread") help rank but mustn't dominate.
      s += GENERIC.has(t) ? w * 0.35 : w
    }
    if (s === 0) continue
    // If the client asked something specific ("crooked photo"), a guide
    // that only matched the generic word ("photo") is noise.
    if (hasSpecific && specific === 0) continue
    // Reward covering every word the client typed.
    s *= 0.6 + 0.4 * (hits / tokens.length)
    if (it.titleNorm.includes(q)) s += 3
    // Precision: prefer guides whose title is mostly what was asked
    // ("delete page" → Delete a spread, not Remove a photo from a spread).
    let tHits = 0
    for (const t of tokens) if (it.title.has(t)) tHits++
    s += 1.5 * (tHits / Math.max(1, it.title.size))
    if (ctx.area && it.g.area === ctx.area) s += 0.5
    if (it.g.popular) s += 0.3
    scored.push({ g: it.g, s })
  }
  scored.sort((a, b) => b.s - a.s)
  if (scored.length === 0) return []
  const top = scored[0].s
  return scored.filter((x) => x.s >= Math.max(1, top * 0.3)).slice(0, limit).map((x) => x.g)
}
