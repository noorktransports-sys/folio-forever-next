// src/lib/help/guides.ts
//
// The "How do I…?" guide library for the album designer.
//
// Every entry is one task a client can do, written in plain words.
//   • title     — the easy name shown in search results
//   • keywords  — extra words people type for this task (synonyms are
//                 also expanded automatically by search.ts)
//   • steps     — mouse / computer steps
//   • touch     — phone & tablet steps, when they differ
//   • demo      — which looping mini animation to show (HelpDemo.tsx)
//   • target    — CSS selector(s) for "Show me" (first visible one wins)
//   • fallback  — what to highlight + say when the target isn't on screen
//                 yet (e.g. the photo toolbar only appears after a click)
//
// Keep this file in sync with the designer when buttons change.

export type HelpArea =
  | 'start'
  | 'upload'
  | 'group'
  | 'tag'
  | 'pages'
  | 'adjust'
  | 'cover'
  | 'proof'
  | 'albums'
  | 'magazine'

export const AREA_LABEL: Record<HelpArea, string> = {
  start: 'Getting started',
  upload: 'Upload step',
  group: 'Group by event step',
  tag: 'Heroes & favourites step',
  pages: 'Album length & style step',
  adjust: 'Review & adjust step',
  cover: 'Cover step',
  proof: 'Proof & order',
  albums: 'My Albums',
  magazine: 'Magazine designer',
}

export type DemoScene =
  | 'swapDrag'
  | 'swapButton'
  | 'tapPlace'
  | 'pan'
  | 'zoom'
  | 'pinch'
  | 'rotate'
  | 'straighten'
  | 'flip'
  | 'border'
  | 'remove'
  | 'layout'
  | 'count'
  | 'bg'
  | 'text'
  | 'reorder'
  | 'undo'
  | 'upload'
  | 'tagDrag'
  | 'star'
  | 'slider'
  | 'click'
  | 'flipbook'
  | 'cover'
  | 'addSpread'
  | 'dpi'

export type Guide = {
  id: string
  title: string
  area: HelpArea
  keywords: string
  steps: string[]
  touch?: string[]
  tips?: string[]
  demo: DemoScene
  /** Label for generic demos (button text / slider name). */
  demoLabel?: string
  target?: string[]
  fallback?: { selector: string; note: string }
  popular?: boolean
}

const PHOTO_FIRST = {
  selector: '[data-ff-slot]',
  note: 'Click any photo in a spread first — its toolbar opens right under the spread.',
}

export const GUIDES: Guide[] = [
  // ─────────────────────────── Getting started ───────────────────────────
  {
    id: 'choose-size',
    title: 'Choose album size',
    area: 'start',
    keywords: 'size dimensions 17x24 12x24 20x30 15x30 inches big small format',
    steps: [
      'On the first step, click one of the size cards: 17×24, 12×24, 20×30 or 15×30.',
      'Each card shows the starting price for Standard and Layflat.',
      'Pick a binding too, then press Continue →.',
    ],
    tips: ['The size can’t be changed after the layout is generated — start a new album instead.'],
    demo: 'click',
    demoLabel: '17×24',
  },
  {
    id: 'choose-binding',
    title: 'Choose Standard or Layflat binding',
    area: 'start',
    keywords: 'binding layflat lay flat flush mount standard hardcover gutter seam book type',
    steps: [
      'On the first step, click Standard hardcover or Layflat (flush-mount).',
      'Standard has a visible centre gutter. Layflat opens completely flat with no seam.',
      'Press Continue → once a size and binding are both chosen.',
    ],
    demo: 'click',
    demoLabel: 'Layflat',
  },
  {
    id: 'rename-album',
    title: 'Rename my album',
    area: 'start',
    keywords: 'rename name title album change name',
    steps: [
      'Click the album name (with the ✎ pencil) in the top bar.',
      'Type the new name and press OK.',
    ],
    tips: ['You can also rename it from My Albums on the Design page.'],
    demo: 'click',
    demoLabel: 'Album name ✎',
    target: ['[title="Click to rename this album"]'],
  },
  {
    id: 'autosave',
    title: 'Save my work / continue later',
    area: 'albums',
    keywords: 'save saving draft autosave lose lost progress continue later resume come back close browser',
    steps: [
      'You don’t need to press save — every change is saved automatically on this device.',
      'To come back later, open the Design page and click your album under My Albums.',
      'It reopens on the step where you left off.',
    ],
    tips: [
      'Your work is stored in this browser. Use the same computer and browser to continue.',
      'Clearing your browser data will remove saved albums.',
    ],
    demo: 'click',
    demoLabel: 'My Albums',
    popular: true,
  },
  {
    id: 'my-albums',
    title: 'Open, rename or delete an album in My Albums',
    area: 'albums',
    keywords: 'my albums open resume delete album remove album start new album list drafts',
    steps: [
      'Go to the Design page (← Back to Design in the top bar).',
      'Under My Albums, click a card to open it.',
      'Click ✎ on a card to rename it, or × to delete it (this can’t be undone).',
      'Click + Start a new album for a fresh one.',
    ],
    demo: 'click',
    demoLabel: '+ Start a new album',
  },

  // ─────────────────────────────── Upload ────────────────────────────────
  {
    id: 'upload-device',
    title: 'Upload photos from my computer or phone',
    area: 'upload',
    keywords: 'upload add photos import pictures device computer phone gallery camera roll files choose',
    steps: [
      'On the Upload step, click the Add photos box.',
      'Choose 📱 Your device, then select your photos.',
      'Wait for the “Uploading… %” bar to finish.',
    ],
    tips: [
      'Up to 100 photos per album.',
      'The first time, tick the two content boxes and press Accept & continue, then pick the photos again.',
    ],
    demo: 'upload',
    target: ['[data-help="upload-add"]'],
    popular: true,
  },
  {
    id: 'upload-folder',
    title: 'Upload a whole folder (auto-sorts events)',
    area: 'upload',
    keywords: 'folder directory upload all subfolders auto group sort events mehndi haldi nikkah wedding',
    steps: [
      'Click the Add photos box, then choose 📁 Folder.',
      'Pick the folder that holds your wedding photos.',
      'Sub-folders named Mehndi, Haldi, Nikkah, Wedding, Reception etc. are tagged to those events automatically.',
    ],
    tips: ['Photos that aren’t in a named sub-folder are grouped by the time they were taken.'],
    demo: 'upload',
    target: ['[data-help="upload-add"]'],
  },
  {
    id: 'upload-dropbox',
    title: 'Import photos from Dropbox',
    area: 'upload',
    keywords: 'dropbox cloud import google drive google photos online',
    steps: [
      'Click the Add photos box, then choose Dropbox.',
      'Sign in to Dropbox in its own window and pick your photos.',
    ],
    tips: ['Google Drive and Google Photos are coming soon.'],
    demo: 'upload',
    target: ['[data-help="upload-add"]'],
  },
  {
    id: 'upload-sample',
    title: 'Try it with sample photos',
    area: 'upload',
    keywords: 'sample demo test example try without uploading',
    steps: ['On the Upload step, click Use sample wedding photos (no upload).'],
    demo: 'click',
    demoLabel: 'Use sample photos',
    target: ['[data-help="upload-sample"]'],
  },
  {
    id: 'upload-remove',
    title: 'Remove an uploaded photo',
    area: 'upload',
    keywords: 'remove delete uploaded photo wrong photo take out upload step x',
    steps: ['Hover the photo and click the ✕ in its top-right corner.'],
    touch: ['On phones the ✕ is always showing — tap it.'],
    demo: 'remove',
    target: ['.folio-photo-remove'],
  },
  {
    id: 'upload-clear',
    title: 'Clear all uploaded photos',
    area: 'upload',
    keywords: 'clear all remove everything start over reset delete all photos',
    steps: ['On the Upload step, click Clear all under the photo grid.'],
    tips: ['There is no confirmation — all photos in this album are removed.'],
    demo: 'click',
    demoLabel: 'Clear all',
    target: ['[data-help="clear-all"]'],
  },
  {
    id: 'mark-cover',
    title: 'Pick the photo for the cover',
    area: 'upload',
    keywords: 'cover photo front choose cover candidate mark cover',
    steps: [
      'On the Upload step, click the + Cover pill on the photo you want.',
      'It changes to ✓ Cover. Only one photo can be the cover.',
      'The Cover step will start with this photo already chosen.',
    ],
    demo: 'star',
    target: ['[aria-label="Mark as cover candidate"]', '[aria-label="Cover candidate (click to unmark)"]'],
  },
  {
    id: 'mark-pano',
    title: 'Make a photo a full panorama spread',
    area: 'upload',
    keywords: 'panorama pano wide full spread across both pages landscape big',
    steps: [
      'On the Upload step, click the + Pano pill on a wide photo.',
      'It changes to ✓ Pano — that photo gets its own edge-to-edge spread.',
    ],
    demo: 'star',
    target: ['[aria-label="Mark as panorama"]', '[aria-label="Panorama (click to unmark)"]'],
  },
  {
    id: 'low-res-upload',
    title: 'What does the LOW RES warning mean?',
    area: 'upload',
    keywords: 'low res resolution small blurry pixelated warning orange badge quality 3600',
    steps: [
      'An orange LOW RES badge means the photo’s shortest side is under 3600 pixels.',
      'It can still be used, but may print soft if it is placed large.',
      'If you can, upload the original full-size file instead of a phone or WhatsApp copy.',
    ],
    demo: 'dpi',
  },

  // ─────────────────────────────── Group ─────────────────────────────────
  {
    id: 'group-drag',
    title: 'Sort photos into events (drag)',
    area: 'group',
    keywords: 'group tag event sort category mehndi haldi nikkah wedding reception valima getting ready drag move',
    steps: [
      'On the Group by event step, drag a photo from the untagged grid onto an event card.',
      'Select several photos first (click them) to drag them all at once.',
    ],
    touch: [
      'Tap photos to select them (a gold ✓ appears).',
      'Then tap the event card to move them all there.',
    ],
    demo: 'tagDrag',
    popular: true,
  },
  {
    id: 'group-move',
    title: 'Move a photo to a different event',
    area: 'group',
    keywords: 'wrong event move photo another event reassign retag change event',
    steps: [
      'Drag the small photo inside an event card onto another event card.',
      'Or click it to select it, then click the other event card.',
    ],
    demo: 'tagDrag',
  },
  {
    id: 'group-rename',
    title: 'Rename an event',
    area: 'group',
    keywords: 'rename event name label change event name other 1 other 2',
    steps: [
      'Double-click the event name on its card.',
      'Type the new name and press Enter (Esc cancels).',
    ],
    demo: 'click',
    demoLabel: 'Other 1 → Sangeet',
  },
  {
    id: 'group-smart',
    title: 'Group photos automatically by date',
    area: 'group',
    keywords: 'auto group smart group date time automatic sort exif',
    steps: [
      'On the Group step, look for the ✨ banner above the photos.',
      'Click Smart group — photos taken close together are put in the same group.',
    ],
    tips: ['The banner only shows when your photos have date information.'],
    demo: 'click',
    demoLabel: 'Smart group',
    target: ['[data-help="smart-group"]'],
  },

  // ──────────────────────── Heroes & favourites ──────────────────────────
  {
    id: 'hero',
    title: 'Mark a hero photo (big spread)',
    area: 'tag',
    keywords: 'hero star best photo big large feature highlight main important full page',
    steps: [
      'On the Tag step, click the ★ circle on a photo.',
      'Heroes get the biggest, most dramatic placement.',
      'Click again to un-mark.',
    ],
    tips: ['Up to 8 heroes. A hero must be at least 3000 × 3000 pixels.'],
    demo: 'star',
    target: ['[title="Mark as hero"]'],
  },
  {
    id: 'favourite',
    title: 'Mark a favourite photo',
    area: 'tag',
    keywords: 'favourite favorite heart love like must include priority',
    steps: [
      'On the Tag step, click the ♥ circle on a photo.',
      'Favourites are placed larger than normal photos.',
    ],
    tips: ['Up to 30 favourites. A photo can be a hero or a favourite, not both.'],
    demo: 'star',
    target: ['[title="Mark as favorite"]'],
  },
  {
    id: 'tag-filter',
    title: 'Show only one event’s photos',
    area: 'tag',
    keywords: 'filter show only event chips all mehndi wedding view',
    steps: ['On the Tag step, click an event chip (All, Mehndi, Wedding…) above the photos.'],
    demo: 'click',
    demoLabel: 'Wedding',
  },

  // ─────────────────────────── Length & style ────────────────────────────
  {
    id: 'spread-count',
    title: 'Choose how many spreads (pages)',
    area: 'pages',
    keywords: 'how many spreads pages length number of pages album length more pages fewer pages price',
    steps: [
      'On the Album length step, drag the spreads slider.',
      'The price updates live. A red note appears if it’s below the recommended number for your photos.',
    ],
    tips: ['Each spread is two facing pages. You can still add or delete spreads later.'],
    demo: 'slider',
    demoLabel: 'Spreads',
    target: ['[data-help="spreads-slider"]'],
    popular: true,
  },
  {
    id: 'album-style',
    title: 'Choose the album style (Smart / Clean / Bold)',
    area: 'pages',
    keywords: 'style mood look smart mix clean elegant bold immersive matted full bleed design theme',
    steps: [
      'On the Album length step, pick a mood card:',
      'Smart mix — a balanced mix (recommended). Clean & elegant — photos matted with a border. Bold & immersive — edge-to-edge photos.',
      'You can restyle any single spread later.',
    ],
    demo: 'click',
    demoLabel: 'Smart mix',
    target: ['[data-help="style-cards"]'],
  },
  {
    id: 'generate',
    title: 'Generate the layout',
    area: 'pages',
    keywords: 'generate create build make layout design automatic auto layout start',
    steps: ['On the Album length step, press Generate Layout →.', 'Wait a few seconds while every spread is designed.'],
    demo: 'click',
    demoLabel: 'Generate Layout →',
    target: ['[data-help="generate"]'],
  },
  {
    id: 'regenerate',
    title: 'Regenerate / shuffle the whole layout',
    area: 'adjust',
    keywords: 'regenerate shuffle redo layout start again new layout rebuild reset all different design',
    steps: ['On the Review & adjust step, click ↻ Regenerate at the top.'],
    tips: ['This replaces every spread and clears your crops, backgrounds and undo history.'],
    demo: 'click',
    demoLabel: '↻ Regenerate',
    target: ['[data-help="regenerate"]'],
  },

  // ─────────────────────── Review & adjust: photos ───────────────────────
  {
    id: 'swap-drag',
    title: 'Swap two photos (drag)',
    area: 'adjust',
    keywords: 'swap switch exchange two photos places trade positions drag photo onto another',
    steps: [
      'Drag one photo and drop it onto another photo.',
      'They trade places — on the same spread or across different spreads.',
    ],
    touch: [
      'Tap a photo to select it and press ⇄ Swap photo.',
      'Then tap the other photo you want to trade with.',
    ],
    tips: ['Changed your mind? Press Undo (Ctrl+Z).'],
    demo: 'swapDrag',
    target: ['[data-ff-slot]'],
    popular: true,
  },
  {
    id: 'swap-button',
    title: 'Replace a photo with an unused one',
    area: 'adjust',
    keywords: 'swap replace change different photo unused pool pick another switch photo replacement',
    steps: [
      'Click the photo you want to change.',
      'Press ⇄ Swap photo in the toolbar.',
      'Click a photo in the Unused list on the right — it takes that place and the old one goes back to Unused.',
    ],
    tips: [
      'While swap mode is on, clicking another photo in the album swaps those two instead.',
      'Press cancel in the gold banner (or click the photo again) to stop.',
    ],
    demo: 'swapButton',
    target: ['[data-help="swap"]'],
    fallback: PHOTO_FIRST,
    popular: true,
  },
  {
    id: 'place-unused',
    title: 'Put an unused photo into the album',
    area: 'adjust',
    keywords: 'unused pool place add photo into slot put photo leftover not used sidebar',
    steps: [
      'Drag a photo from the Unused list onto any photo or empty slot.',
      'An empty slot is filled. A filled slot is swapped — the old photo goes back to Unused.',
    ],
    touch: ['Tap the unused photo (it gets a gold border).', 'Then tap the slot where you want it.'],
    demo: 'tapPlace',
    target: ['[title^="Tap to pick up"]'],
  },
  {
    id: 'fill-empty',
    title: 'Fill an empty “+ Add photo” slot',
    area: 'adjust',
    keywords: 'empty slot blank gap hole missing photo add photo fill frame box',
    steps: [
      'Click the empty + Add photo slot.',
      'Choose ↑ Upload from computer, or pick one of your unused photos.',
    ],
    tips: ['You can also drag an unused photo straight onto the empty slot.'],
    demo: 'tapPlace',
    target: ['[title^="Click to upload or pick from unused"]'],
  },
  {
    id: 'add-to-spread',
    title: 'Add one more photo to a spread',
    area: 'adjust',
    keywords: 'add photo to spread more photos extra photo increase',
    steps: [
      'Drag an unused photo onto the spread’s background (not onto a photo).',
      'The layout grows by one photo.',
      'Or use the “N photos ▾” pill to choose a bigger number.',
    ],
    tips: ['A spread holds up to 18 photos.'],
    demo: 'count',
    target: ['[aria-haspopup="listbox"]'],
  },
  {
    id: 'remove-photo',
    title: 'Remove a photo from a spread',
    area: 'adjust',
    keywords: 'remove delete take out photo from spread get rid of',
    steps: [
      'Click the photo.',
      'Press ✕ Remove in the toolbar.',
      'The photo goes back to Unused and the slot becomes + Add photo.',
    ],
    tips: ['If it was the only photo, you’ll be asked whether to delete the whole spread.'],
    demo: 'remove',
    target: ['[data-help="remove"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'pan',
    title: 'Move a photo inside its frame (crop / reposition)',
    area: 'adjust',
    keywords: 'move reposition pan position crop cut off head cropped adjust drag inside frame center shift',
    steps: [
      'Click the photo to select it (gold outline).',
      'Drag it — the photo slides inside the frame.',
      'The faded part around the frame shows what will be cropped off.',
    ],
    touch: ['Tap the photo, then drag it with one finger.'],
    tips: ['Only works in Fill mode (the default).'],
    demo: 'pan',
    target: ['[data-help="photo-toolbar"]'],
    fallback: PHOTO_FIRST,
    popular: true,
  },
  {
    id: 'zoom',
    title: 'Zoom a photo in or out',
    area: 'adjust',
    keywords: 'zoom bigger smaller enlarge closer scale magnify zoom in zoom out crop tighter edge side top handle pull resize',
    steps: [
      'Click the photo.',
      'Pull one of the white bars on its edges (top, bottom, left or right) outward to zoom in, inward to zoom out.',
      'Or drag the Zoom slider, press − / +, or hold Ctrl (⌘ on Mac) and scroll over the photo.',
    ],
    touch: ['Tap the photo.', 'Pinch with two fingers, or pull one of the white edge bars in or out.'],
    tips: ['Zoom stops automatically where the photo would drop below 300 DPI, so it always prints sharp.'],
    demo: 'zoom',
    target: ['[title^="Drag to zoom"]', '[data-help="zoom"]'],
    fallback: PHOTO_FIRST,
    popular: true,
  },
  {
    id: 'pinch',
    title: 'Pinch to zoom (phone, tablet, trackpad)',
    area: 'adjust',
    keywords: 'pinch two fingers trackpad gesture ctrl scroll wheel zoom',
    steps: [
      'Tap the photo to select it.',
      'Pinch two fingers apart to zoom in, together to zoom out.',
      'On a computer: hold Ctrl (⌘) and scroll the mouse wheel over the photo.',
    ],
    demo: 'pinch',
    target: ['[data-help="zoom"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'rotate',
    title: 'Rotate a photo by hand',
    area: 'adjust',
    keywords: 'rotate turn spin angle tilt corner handle degrees twist',
    steps: [
      'Click the photo — white ↻ handles appear on its four corners.',
      'Drag any corner handle around to rotate.',
      'It snaps to straight (0°, 90°, 180°). Hold Shift to move in 15° steps.',
    ],
    tips: ['The photo zooms in automatically while tilted so the frame never shows gaps.'],
    demo: 'rotate',
    target: ['[title="Drag to rotate"]'],
    fallback: PHOTO_FIRST,
    popular: true,
  },
  {
    id: 'straighten',
    title: 'Straighten a crooked photo',
    area: 'adjust',
    keywords: 'straighten crooked tilted level horizon skew wonky slanted not straight fix angle',
    steps: [
      'Click the photo.',
      'Drag the Straighten slider until the photo looks level (up to ±45°).',
      'Press 0° to make it perfectly straight again.',
    ],
    demo: 'straighten',
    target: ['[data-help="straighten"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'rotate90',
    title: 'Rotate a photo 90° (sideways photo)',
    area: 'adjust',
    keywords: 'rotate 90 sideways upside down wrong way portrait landscape turn quarter',
    steps: ['Click the photo.', 'Press More ▾ in the toolbar.', 'Use ↺ or ↻ next to Rotate. Press 0° to reset.'],
    demo: 'rotate',
    target: ['[title="Rotate right 90°"]', '[data-help="more"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'flip',
    title: 'Flip / mirror a photo',
    area: 'adjust',
    keywords: 'flip mirror reverse horizontal vertical backwards',
    steps: ['Click the photo.', 'Press More ▾.', 'Press ⇄ to flip left–right, or ⇅ to flip upside down.'],
    demo: 'flip',
    target: ['[title="Flip horizontal"]', '[data-help="more"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'border',
    title: 'Add a border around a photo',
    area: 'adjust',
    keywords: 'border frame outline edge stroke white line around photo',
    steps: [
      'Click the photo, then press More ▾.',
      'Drag the Border slider (0–10) and pick a colour: White, Cream, Black, Charcoal or Gold.',
    ],
    demo: 'border',
    target: ['[data-help="more"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'fit',
    title: 'Show the whole photo without cropping',
    area: 'adjust',
    keywords: 'fit whole photo no crop original contain full image uncropped entire',
    steps: ['Click the photo, then press More ▾.', 'Choose Original to show the whole photo. Fill goes back to filling the frame.'],
    tips: ['In Original mode you can’t drag, pinch or rotate by the corners.'],
    demo: 'click',
    demoLabel: 'Original',
    target: ['[data-help="more"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'reset-photo',
    title: 'Reset a photo’s crop and rotation',
    area: 'adjust',
    keywords: 'reset photo undo crop start over original position clear zoom rotation',
    steps: ['Click the photo.', 'Press ↺ Reset — zoom, position, rotation, flip and border go back to normal.'],
    demo: 'click',
    demoLabel: '↺ Reset',
    target: ['[data-help="reset"]'],
    fallback: PHOTO_FIRST,
  },
  {
    id: 'dpi',
    title: 'What do Sharp / OK / Soft (DPI) mean?',
    area: 'adjust',
    keywords: 'dpi quality sharp soft ok blurry print quality resolution pixelated badge red green',
    steps: [
      'Select a photo — the badge in its toolbar shows print sharpness at the current zoom.',
      'Green Sharp (200+ DPI) is great. Amber OK (150+) is fine. Red Soft may look blurry in print.',
      'Zoom out, or use a bigger original photo, to improve it.',
    ],
    demo: 'dpi',
    target: ['[data-help="photo-toolbar"]'],
    fallback: PHOTO_FIRST,
  },

  // ─────────────────────── Review & adjust: spreads ──────────────────────
  {
    id: 'change-layout',
    title: 'Change a spread’s layout',
    area: 'adjust',
    keywords: 'layout template design arrangement change layout different layout grid pattern',
    steps: [
      'Find the row of small layout pictures above the spread.',
      'Click one to apply it. Hover to see it bigger.',
    ],
    tips: ['Extra photos go to Unused; new slots are left empty for you to fill.'],
    demo: 'layout',
    target: ['[title="Tap a layout to apply · hover to enlarge"]'],
    popular: true,
  },
  {
    id: 'photo-count',
    title: 'Change how many photos are on a spread',
    area: 'adjust',
    keywords: 'number of photos how many photos count more photos fewer photos less photos per page per spread',
    steps: [
      'Click the “N photos ▾” pill at the top of the spread.',
      'Choose a number (1–18). The best layout for that many photos is picked for you.',
    ],
    tips: ['Fewer photos → the extras go to Unused. More → new empty slots appear.'],
    demo: 'count',
    target: ['[aria-haspopup="listbox"]'],
  },
  {
    id: 'bleed-matted',
    title: 'Full bleed or matted (edge-to-edge vs margins)',
    area: 'adjust',
    keywords: 'full bleed matted edge to edge border margin white space mat style',
    steps: ['At the top of the spread, click Full bleed (edge-to-edge) or Matted (with margins).'],
    demo: 'layout',
    target: ['[data-help="bleed-toggle"]'],
  },
  {
    id: 'bg-colour',
    title: 'Change the background colour',
    area: 'adjust',
    keywords: 'background colour color behind backdrop paper white black cream tint bg',
    steps: [
      'Click the BG pill on the spread.',
      'Pick a swatch (Paper, Cream, Ivory, Charcoal…) or one of the colours taken from your photos.',
      'Press Done.',
    ],
    tips: ['Use Fine-tune colour for an exact shade or HEX code.'],
    demo: 'bg',
    target: ['[title="Spread background"]'],
    popular: true,
  },
  {
    id: 'bg-eyedropper',
    title: 'Pick a background colour from a photo (eyedropper)',
    area: 'adjust',
    keywords: 'eyedropper pick colour from photo match colour sample dropper',
    steps: [
      'Click BG on the spread, then ⊙ Pick.',
      'Move over the photo and click the colour you want.',
    ],
    demo: 'bg',
    target: ['[title="Spread background"]'],
  },
  {
    id: 'bg-save',
    title: 'Save a background colour for other spreads',
    area: 'adjust',
    keywords: 'save colour saved colours reuse same colour all spreads favourite colour',
    steps: [
      'Click BG and choose your colour.',
      'Press ☆ Save current. It appears under Saved colours on every spread (3 slots).',
    ],
    demo: 'bg',
    target: ['[title="Spread background"]'],
  },
  {
    id: 'bg-photo',
    title: 'Use a blurred photo as the background',
    area: 'adjust',
    keywords: 'blur blurred photo background image behind backdrop picture',
    steps: [
      'Click BG on the spread.',
      'Under Or a blurred photo, pick one of that spread’s photos.',
      'Adjust Blur, Darken and Zoom with the sliders, then press Done.',
    ],
    demo: 'bg',
    target: ['[title="Spread background"]'],
  },
  {
    id: 'add-text',
    title: 'Add text or a title to a spread',
    area: 'adjust',
    keywords: 'text title words caption name quote writing type heading add text',
    steps: [
      'Click ＋ Text or ＋ Title at the bottom of the spread.',
      'Type your words, then click outside (or press Done).',
    ],
    demo: 'text',
    target: ['[data-help="add-text"]'],
    popular: true,
  },
  {
    id: 'edit-text',
    title: 'Move, edit or restyle text',
    area: 'adjust',
    keywords: 'move text font fonts size colour bold align edit text style text position center typeface',
    steps: [
      'Drag the text to move it — a gold line shows when it snaps to the centre.',
      'Double-click to edit the words.',
      'Use the text toolbar to change font, size, alignment, bold and colour.',
    ],
    demo: 'text',
    target: ['[data-fftext]', '[data-help="add-text"]'],
  },
  {
    id: 'delete-text',
    title: 'Delete text',
    area: 'adjust',
    keywords: 'delete text remove text remove title',
    steps: ['Double-click the text to open its toolbar.', 'Press Delete.'],
    demo: 'click',
    demoLabel: 'Delete',
    target: ['[data-fftext]'],
  },
  {
    id: 'add-spread',
    title: 'Add a new spread',
    area: 'adjust',
    keywords: 'add spread new page more pages extra spread insert page',
    steps: ['Scroll to the bottom of the spreads.', 'Press + Add new spread. The price change is shown on the button.'],
    tips: ['Up to 25 spreads.'],
    demo: 'addSpread',
    target: ['[data-help="add-spread"]'],
  },
  {
    id: 'delete-spread',
    title: 'Delete a spread',
    area: 'adjust',
    keywords: 'delete spread remove page remove spread fewer pages',
    steps: [
      'Press ✕ Delete spread at the top of that spread.',
      'Confirm — its photos move to Unused.',
    ],
    tips: ['You can’t delete the last spread. Undo brings it back.'],
    demo: 'click',
    demoLabel: '✕ Delete spread',
    target: ['[aria-label="Delete this spread"]'],
  },
  {
    id: 'reorder-spreads',
    title: 'Change the order of spreads',
    area: 'adjust',
    keywords: 'reorder order rearrange move spread up down sequence wrong order earlier later position',
    steps: [
      'Drag a thumbnail in the Spreads column on the left to a new position.',
      'Or drag the ⋮⋮ handle at the top-left of a spread onto another spread.',
    ],
    tips: ['Reordering needs a mouse — use a computer for this one.'],
    demo: 'reorder',
    target: ['[aria-label="Spread navigator"]', '[title="Drag to reorder this spread"]'],
  },
  {
    id: 'jump-spread',
    title: 'Jump to a spread',
    area: 'adjust',
    keywords: 'jump go to find spread navigate scroll quickly spread number',
    steps: ['Click a thumbnail in the Spreads column on the left — the page scrolls to it.'],
    demo: 'reorder',
    target: ['[aria-label="Spread navigator"]'],
  },
  {
    id: 'undo',
    title: 'Undo a mistake',
    area: 'adjust',
    keywords: 'undo mistake oops revert go back wrong accident ctrl z cancel change',
    steps: ['Press the Undo arrow next to the title, or press Ctrl+Z (⌘+Z on Mac).', 'A message shows what was undone.'],
    tips: [
      'The last 5 changes can be undone.',
      'Undo covers swaps, layouts, photo count, remove, delete and reorder — not zoom, crop, rotate, background or text.',
    ],
    demo: 'undo',
    target: ['[aria-label="Edit history"]'],
    popular: true,
  },
  {
    id: 'redo',
    title: 'Redo',
    area: 'adjust',
    keywords: 'redo again undo undo ctrl y',
    steps: ['Press the Redo arrow next to Undo, or Ctrl+Shift+Z / Ctrl+Y (⌘ on Mac).'],
    demo: 'undo',
    target: ['[aria-label="Edit history"]'],
  },
  {
    id: 'add-photos-later',
    title: 'Add more photos after the layout is made',
    area: 'adjust',
    keywords: 'add more photos upload later forgot photos extra photos new photos',
    steps: [
      'On the Review & adjust step, press + Add photos in the Unused panel on the right.',
      'New photos land in Unused — drag them into the album.',
    ],
    demo: 'upload',
    target: ['[data-help="add-photos-later"]'],
  },
  {
    id: 'handoff',
    title: 'Get the design team to polish my album ($99)',
    area: 'adjust',
    keywords: 'design team help professional polish hand off expert designer fix it for me 99',
    steps: ['Press + $99 · Hand off to design team at the bottom of the spreads. Press again to remove it.'],
    demo: 'click',
    demoLabel: '+ $99 · Hand off',
    target: ['[data-help="handoff"]'],
  },

  // ──────────────────────────────── Cover ────────────────────────────────
  {
    id: 'go-cover',
    title: 'Go to the cover design',
    area: 'adjust',
    keywords: 'cover next step continue finish spreads done',
    steps: ['When the spreads look right, press Choose your cover → at the bottom.'],
    demo: 'click',
    demoLabel: 'Choose your cover →',
    target: ['[data-help="to-cover"]'],
  },
  {
    id: 'cover-type',
    title: 'Choose leather, acrylic or photo cover',
    area: 'cover',
    keywords: 'cover type leather acrylic photo cover material',
    steps: ['On the Cover step, click Leather, Acrylic or Photo Cover.'],
    demo: 'cover',
    target: ['.cover-type-btn'],
    popular: true,
  },
  {
    id: 'cover-colour',
    title: 'Change leather or foil colour',
    area: 'cover',
    keywords: 'leather colour foil gold silver rose gold black brown ivory burgundy cover colour',
    steps: ['On the Cover step, click a leather swatch (Black, Brown, Ivory, Burgundy).', 'Then a foil colour (Gold, Silver, Rose Gold, Black).'],
    demo: 'cover',
    target: ['.cover-swatch'],
  },
  {
    id: 'cover-text',
    title: 'Add names or a title on the cover',
    area: 'cover',
    keywords: 'cover text names title subtitle font size cover writing',
    steps: [
      'On the Cover step, type in Names / title (and Subtitle if you like).',
      'Pick a font, then use the size slider.',
    ],
    demo: 'cover',
    target: ['.cover-font-btn'],
  },
  {
    id: 'cover-text-position',
    title: 'Move the cover text',
    area: 'cover',
    keywords: 'move cover text position title placement top center lower',
    steps: [
      'Leather: choose Top, Center or Lower.',
      'Photo / acrylic: drag the gold knob on the small position pad — it snaps to the centre lines.',
    ],
    demo: 'cover',
  },
  {
    id: 'cover-photo',
    title: 'Choose or crop the cover photo',
    area: 'cover',
    keywords: 'cover photo image crop cover picture change cover photo zoom cover',
    steps: [
      'On the Cover step (photo or acrylic), press + Upload cover photo or click one of your photos.',
      'Press Adjust crop (drag photo), then drag the photo and use the zoom slider.',
      'Press Done · back to rotate when finished.',
    ],
    demo: 'cover',
    target: ['.cover-photo-thumb', '.cover-photo-upload-btn'],
  },
  {
    id: 'cover-compare',
    title: 'Compare cover designs (A / B / C)',
    area: 'cover',
    keywords: 'compare save variant a b c versions options cover',
    steps: ['Press + Save as A (then B, C) to keep versions.', 'Press ★ Variant A/B/C to load one back.'],
    demo: 'click',
    demoLabel: '+ Save as A',
  },
  {
    id: 'cover-rotate',
    title: 'Turn the 3D cover preview',
    area: 'cover',
    keywords: '3d preview rotate cover view spine back',
    steps: ['Drag the album preview to turn it around.'],
    demo: 'cover',
  },

  // ─────────────────────────── Proof & order ─────────────────────────────
  {
    id: 'flipbook',
    title: 'Preview the album like a real book',
    area: 'proof',
    keywords: 'preview flipbook view book look through see album pages turn',
    steps: [
      'On the Proof step, press 📖 Open your album.',
      'Use → / Space for the next page, ← to go back, Esc to close.',
    ],
    demo: 'flipbook',
    target: ['[data-help="open-album"]'],
  },
  {
    id: 'approve-proof',
    title: 'Approve the proof',
    area: 'proof',
    keywords: 'approve proof review spreads tick reviewed checkbox finish confirm',
    steps: [
      'Tick “I reviewed this spread” on every spread (or press Mark all reviewed).',
      'Press ✓ I Approve This Proof for Printing →.',
    ],
    tips: ['What you see in the proof is exactly what prints.'],
    demo: 'click',
    demoLabel: '✓ I Approve',
    target: ['[data-help="mark-reviewed"]', '[data-help="approve"]'],
  },
  {
    id: 'checkout',
    title: 'Order and pay',
    area: 'proof',
    keywords: 'order pay payment checkout buy purchase price cost shipping address delivery card',
    steps: [
      'After approving the proof, fill in your name, email and shipping address.',
      'Press Continue to secure payment →.',
      'Your photos upload, then you pay on the secure Square page.',
    ],
    tips: ['Keep the page open until the upload finishes.'],
    demo: 'click',
    demoLabel: 'Continue to payment →',
  },

  // ────────────────────────────── Magazine ───────────────────────────────
  {
    id: 'mag-style',
    title: 'Choose a magazine style',
    area: 'magazine',
    keywords: 'magazine style design theme look terracotta noir ivory sage change style switch design different design',
    steps: [
      'At the top of the magazine page, click a style card: TERRACOTTA, NOIR, IVORY or SAGE.',
      'The 20-page preview changes to show that design.',
      'Already built? Pick another style and confirm — your photos are re-placed into the new design.',
    ],
    tips: ['Every style is 20 pages at the same price. Switching resets swaps and crops.'],
    demo: 'layout',
    target: ['[data-help="mag-styles"]'],
    popular: true,
  },
  {
    id: 'mag-build',
    title: 'Build my magazine',
    area: 'magazine',
    keywords: 'magazine build create make upload photos rebuild',
    steps: [
      'Press + Upload photos and choose your photos (about 38 fill every page).',
      'Press Build my magazine →. Photos are placed in date order.',
      'Rebuild layout starts over (your swaps and crops are reset).',
    ],
    demo: 'upload',
    target: ['[data-help="mag-build"]', '[data-help="mag-upload"]'],
  },
  {
    id: 'mag-swap',
    title: 'Swap two magazine photos',
    area: 'magazine',
    keywords: 'magazine swap switch exchange photos',
    steps: ['Tap a photo, then press Swap.', 'Tap the other photo — they trade places.'],
    demo: 'swapButton',
  },
  {
    id: 'mag-place',
    title: 'Put a tray photo into the magazine',
    area: 'magazine',
    keywords: 'magazine tray unused place add photo empty frame fill',
    steps: [
      'Tap a photo in “Not in the magazine”, then tap a frame.',
      'Tap an empty frame to upload a new photo straight into it.',
    ],
    demo: 'tapPlace',
  },
  {
    id: 'mag-adjust',
    title: 'Zoom or move a magazine photo',
    area: 'magazine',
    keywords: 'magazine zoom move crop reposition pan photo',
    steps: ['Tap the photo.', 'Drag it to reposition, and use the ZOOM slider.', 'Reset crop puts it back.'],
    demo: 'pan',
  },
  {
    id: 'mag-remove',
    title: 'Remove a magazine photo',
    area: 'magazine',
    keywords: 'magazine remove delete photo',
    steps: ['Tap the photo, then press Remove. It goes back to the tray.'],
    demo: 'remove',
  },
]

export const GUIDE_BY_ID = new Map(GUIDES.map((g) => [g.id, g] as const))
