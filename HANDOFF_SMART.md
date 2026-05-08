# Smart Auto-Layout Wizard — Handoff

This document is the cold-pickup for the `/design/smart` wizard. Anyone (dev or
AI session) reading this should be able to continue without re-asking the owner
for context.

> **For a new AI session**: read this file first, then read [`src/app/design/smart/page.tsx`](src/app/design/smart/page.tsx) before suggesting any change.

---

## Where the code lives on disk

The repo is on the owner's Windows machine at:

```
C:\Users\fufck\Documents\GitHub\folio-forever-next
```

GitHub remote: https://github.com/noorktransports-sys/folio-forever-next

Backup zips (don't touch unless restoring):

```
C:\Users\fufck\Documents\GitHub\backup\
  ├── folio-forever-main-2026-05-07.zip            (live main branch snapshot)
  ├── folio-forever-smart-rewrite-2026-05-07.zip   (smart wizard branch snapshot)
  └── folio-forever-full-history-2026-05-07.bundle (entire git history)
```

Restore from the bundle: `git clone <bundle-path> restored-repo`

---

## What was built

A 9-step wizard at `/design/smart` that produces a multi-spread photo album
using a smart layout engine — the user uploads photos, tags some as Heroes /
Favorites, picks size + binding type + page count, and the engine arranges
**every photo** across spreads with a strict pacing rule.

Routes:
- `/design` → existing path-choice page (Smart / Manual / Expert) — Smart card is the recommended option
- `/design/smart` → mints a new album (prompts for name)
- `/design/smart?album=<id>` → resumes an existing album
- Smart albums appear in the "My Albums" list on `/design` with a gold "Smart" pill

The 9 steps inside the wizard:
1. **Setup** — pick album size (17×24 or 20×30) and binding (Standard / Layflat)
2. **Guidance** — pre-upload explainer (3–5 photos per page, photos÷4 ≈ pages)
3. **Upload** — file input or "Use sample wedding photos" button. Capacity bar 0–100%, hard cap 100.
4. **Group** — auto-grouped by event (Prep / Ceremony / Portraits / Reception / Other) with click-to-recategorize
5. **Tag** — Heroes (8 max) and Favorites (30 max). Event filter pills. Resolution gate on Hero (3000px min). Blur warnings on auto-flagged demo photos.
6. **Pages** — slider 10–25 spreads with live pricing
7. **Generate** — animation, runs the layout engine
8. **Adjust** — preview at correct album aspect ratio, photo toolbar, swap pool sidebar, $99 hand-off-to-team upsell card
9. **Submit** — order confirmation

---

## File map

| File | Purpose |
|------|---------|
| [`src/app/design/smart/page.tsx`](src/app/design/smart/page.tsx) | The whole wizard. ~2000 lines. Single-file React component with inline styles. |
| [`src/app/design/smart/edit/operations.ts`](src/app/design/smart/edit/operations.ts) | Op types + op constructors (`makeSwapOp`, `makeRemoveOp`, etc.) + `applyOp` for the undo stack. Each op carries before/after snapshots so apply / undo is a snapshot restore — no recomputation. |
| [`src/app/design/smart/edit/stack.ts`](src/app/design/smart/edit/stack.ts) | `OperationStack` (5-deep) with localStorage persistence per album. |
| [`src/app/design/smart/edit/use-undo.ts`](src/app/design/smart/edit/use-undo.ts) | `useUndo` hook: wraps the stack, dispatches state updates via `applyOp`, wires Cmd/Ctrl+Z keyboard shortcuts. |
| [`src/app/design/smart/edit/UndoButtons.tsx`](src/app/design/smart/edit/UndoButtons.tsx) | Header undo/redo buttons + `useToast` for op announcements. |
| [`src/app/design/smart/edit/PanSlider.tsx`](src/app/design/smart/edit/PanSlider.tsx) | `SlotImage` component (the pan-fix: `objectPosition: panX% panY%` is the canonical way to pan a fitted image — translate(px) was the bug). Also includes drag-to-pan when `onAdjustChange` is wired. |
| [`src/app/design/smart/edit/photo-blob-store.ts`](src/app/design/smart/edit/photo-blob-store.ts) | IndexedDB helpers for storing uploaded photo `File` blobs so they survive a refresh. Per-album scoped via composite keys. `saveBlob`, `loadAlbumBlobs`, `deleteBlob`, `clearAlbumBlobs`. |
| [`src/app/design/smart/edit/swap.tsx`](src/app/design/smart/edit/swap.tsx) | **NOT YET WIRED.** Hooks for tap-to-swap, drag-and-drop swap, and modal swap picker. See "Deferred features" §1. |
| [`src/app/design/smart/edit/photo-count.ts`](src/app/design/smart/edit/photo-count.ts) | **NOT YET WIRED.** Builders for photo-count dropdown + drag-to-add. Needs my engine's `templatesForCount` signature changed first. See "Deferred features" §2. |
| [`src/app/design/smart/edit/PhotoCountDropdown.tsx`](src/app/design/smart/edit/PhotoCountDropdown.tsx) | **NOT YET WIRED.** "2 PHOTOS ▾" dropdown component. See "Deferred features" §2. |
| [`src/app/design/smart/edit/INTEGRATION.md`](src/app/design/smart/edit/INTEGRATION.md) | The integration guide that came bundled with this `edit/` package. Reference doc for wiring the deferred features. |
| [`src/app/design/[[...step]]/page.tsx`](src/app/design/[[...step]]/page.tsx) | Existing `/design` path-picker. Modified: `AlbumIndexEntry` type extended with `mode: 'smart' \| 'manual'`; My Albums click handler routes smart albums to `/design/smart`; smart-mode entries show a "Smart" pill. |
| [`src/app/design/album-builder.css`](src/app/design/album-builder.css) | Existing styles for the manual builder. Smart wizard does NOT use these — it uses CSS variables from `globals.css` plus inline styles. |
| [`src/app/globals.css`](src/app/globals.css) | Brand tokens: `--dark`, `--gold`, `--cream`, font families. Smart wizard reads these. |

### Sections inside `page.tsx`

```
Lines  1–15    'use client', imports, runtime export
Lines 17–80    Album storage layer (localStorage helpers)
Lines 82–135   Type definitions (AlbumSize, AlbumType, Photo, Spread, etc.)
Lines 137–180  Album specs (pricing, aspect ratios, min/max spreads)
Lines 182–460  TEMPLATES (19 layout templates) + pickFitTemplate / pickTemplate / templatesForCount
Lines 462–680  generateLayout (the engine — see "Architecture" below)
Lines 682–705  buildSampleWeddingPhotos (demo data)
Lines 707–840  Style objects (css.page, css.title, css.btnPrimary, etc.)
Lines 842–870  SVG icon components
Lines 872–end  SmartDesignerPage (main component) + SpreadView + PhotoToolbar
```

---

## Edit features (`edit/` package) — what's wired vs deferred

The `src/app/design/smart/edit/` folder contains a 9-file integration package that adds an undo/redo system, multiple swap gestures, photo-count editing, and a pan fix. **Not all of it is wired yet.**

### ✅ Wired and working

1. **Undo / redo system (5-deep, per-album, persisted)**. Every swap, remove, template-switch, **and spread reorder** goes through an `Op` that captures before/after snapshots. The stack lives at `localStorage` key `folio-smart-undo:<id>`. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z work. Buttons in the adjust-step header.
2. **Toast announcements** when an op resolves ("Undid: Swap on Spread 7", "Move Spread 1 → position 3", "Added 5 photos to unused pool").
3. **Generate-with-confirm**: regenerating now warns and clears the undo stack if the user has edits.
4. **Pan fix** (`SlotImage`): photos render via `objectPosition: X% Y%` instead of `transform: translate(px)`. Sliders work AND the user can drag the photo directly inside the slot to reposition it.
5. **Fit Fill / Fit Original** mode passed through to `SlotImage`.
6. **`unusedPhotoIds` is now an explicit state slice** (not just derived). This is what lets ops move photos in and out of the unused pool without recomputing.
7. **Drag-to-reorder spreads**. Each spread header has a `⋮⋮` grip on the "Spread N · 17×24" label — drag from there to a different spread to reposition (insert-before semantics). Gold drop-indicator line appears above the target. Recorded as a `reorder-spread` op so undo works.
8. **Add more photos** button in the unused-panel sidebar. Opens a file picker; new photos go straight into the unused pool with `eventId: 'other'`, ready to be swapped into a spread. Honors the 100-photo cap.
9. **IndexedDB photo persistence**. Uploaded blobs survive page refresh (was Bug #1). Saved per-album under `folio-smart-photos / blobs` IDB store with composite key `<albumId>::<photoId>`. On hydrate, fresh object URLs are minted and patched into the photos array. Cleared on Start New / reset.

### ⏸ Deferred (see commit history + `edit/INTEGRATION.md` for full guide)

1. **Tap-to-swap and drag-and-drop** (`edit/swap.tsx`)
   - Not wired because the existing UI uses click-to-open-toolbar. The integration's tap-to-swap conflicts with that.
   - Suggested fix from `INTEGRATION.md`: add a "Swap mode" header toggle. When OFF, click = open toolbar. When ON, click = arm/swap.
   - Drag-and-drop has a separate touch caveat: works on desktop, breaks on iOS Safari without `react-dnd-touch-backend`.

2. **Per-spread photo-count dropdown** (`edit/PhotoCountDropdown.tsx`, `edit/photo-count.ts`)
   - Needs my engine's `templatesForCount` signature changed from `(count, type)` to `(count, { type, hasHero })` because the integration picker chooses hero vs non-hero templates differently.
   - About 30 lines of engine refactor + 30 lines of UI wiring.

3. **Modal swap picker** (`SwapPicker` in `edit/swap.tsx`)
   - Works as-is, but adding it alongside the existing "click photo → swap → pick from sidebar" gives 4 ways to swap. Pick a primary UX before adding.

4. **Drag-to-grow-spread** (drop unused photo on spread background → +1 layout)
   - Bundled with item #1's drag-and-drop. Same conflict.

## Known bugs (priority order)

### 1. ~~Uploaded photos vanish after refresh~~ ✅ FIXED

Each uploaded `File` is now persisted to IndexedDB (database `folio-smart-photos`, store `blobs`, key `${albumId}::${photoId}`). On hydrate, the wizard reads every blob belonging to the current album, creates fresh object URLs, and patches the `preview` field on the photos that had stale `blob:` URLs.

Helpers live in [`src/app/design/smart/edit/photo-blob-store.ts`](src/app/design/smart/edit/photo-blob-store.ts) — `saveBlob`, `loadAlbumBlobs`, `deleteBlob`, `clearAlbumBlobs`. All silent-fail if IndexedDB is unavailable (private browsing modes etc.). `clearAlbumBlobs` runs on Start New / reset() so storage doesn't leak.

Sample wedding photos (stable HTTPS URLs from picsum) bypass IDB entirely.

### 2. ~~No active drag-to-pan on photo crops~~ ✅ FIXED

The `SlotImage` component from the `edit/` package now handles drag-to-pan when the user is editing a slot. Cursor shows `grab` / `grabbing`. Sliders still work too.

### 3. Edge case in template downgrade after Remove

**Symptom**: Click "Remove" on a photo from a hero spread → spread tries to find a template for `count - 1` photos. If no exact match, falls back gracefully — but the hero badge may end up on the wrong slot if the new template's hero slot is at a different index.

**Fix**: After template change, re-anchor the hero photo to the new template's `isHero` slot.

### 4. Generate animation can feel slow on small albums

**Symptom**: The 1.4s artificial delay on Generate is fine for "feel" but redundant on a 5-spread album.

**Fix** (optional): Scale delay with photo count, e.g. `Math.min(1400, photos.length * 50)`.

---

## Deferred features (in suggested order)

| # | Feature | Estimated size | Notes |
|---|---------|---------------|-------|
| 1 | ~~IndexedDB photo persistence~~ | — | ✅ Done — see "Known bugs §1". |
| 2 | **Filter strip** | ~80 lines | B&W, Sepia, Bright, Vivid, Moody, Warm, Cool, Fade. CSS `filter` per slot. Already present in manual builder's album-builder.js — port the values. |
| 3 | **Background color picker per spread** | ~60 lines | Currently spread bg is fixed white. Manual builder lets you change it per page. |
| 4 | **Add-text overlay** | ~150 lines | Manual builder has `addTextOverlay`. User adds text, drags it on a spread, sets font/size/colour. |
| 5 | **Drag-to-pan** photo inside slot | ~50 lines | See Bug #2. |
| 6 | **Drag-to-reorder spreads** | ~100 lines | User wants to swap spread 3 with spread 7. |
| 7 | **EXIF chronological sort** within events | ~40 lines | Read EXIF DateTimeOriginal from uploaded JPEGs (use `exifr` package). |
| 8 | **Real Stripe checkout on Submit** | ~150 lines | Currently submit is a fake confirmation. Wire to existing Stripe code in the repo. |
| 9 | **$99 hand-off button actually does something** | ~80 lines | Currently the upsell button is a no-op. Should add $99 to total and route to expert-design intake. |
| 10 | **Cover builder integration** | ~100 lines | Manual builder has a cover step (`/design/cover`). Smart wizard skips it — should add. |

---

## How the layout engine works (architecture)

`generateLayout(photos, pageCount, type)` in [`src/app/design/smart/page.tsx`](src/app/design/smart/page.tsx) (around line 462).

### Inputs
- `photos: Photo[]` — every photo with `tagged`, `eventId`, `blurry` flags
- `pageCount: number` — user-chosen spread count from the slider
- `type: AlbumType` — `'standard'` or `'layflat'`

### Output
- `Spread[]` — array of spreads, each with a templateId and an array of photoIds in slot order

### Algorithm (current)

1. Filter out blurry photos (they're skipped from layout entirely).
2. Group remaining photos by event (`prep`, `ceremony`, `portraits`, `reception`, `other`). Empty buckets are dropped.
3. Allocate the spread budget proportionally per event by photo count, then nudge so `sum === pageCount`.
4. **For each event** independently (strict event grouping — no cross-event mixing):
   - **Pass 1: PLAN** — decide which spread positions are heroes. Rule: every 3rd position (`i % 3 === 2`) becomes a hero spread, capped at the number of heroes available. If extra heroes remain, append additional hero positions.
   - Compute target photo count per spread. Default = 2 (pair). Adjust up if math forces it (more photos than `2 × budget`), or down if math allows (fewer photos than `2 × budget`).
   - **Pass 2: ASSIGN** — walk the planned positions. For hero spreads, place the hero in the `isHero` slot of a `hero-Nr` / `hero-Nl` template (alternating left/right between heroes for visual rhythm). For pair spreads, fill with non-hero photos in order.
5. Orphan-safety pass: any photos not yet placed get appended to the last spread by upgrading its template to fit them.

### Why this design

- **Strict event grouping** was an explicit owner requirement. Mixing events on a single spread looked random and the owner rejected it.
- **Every 3rd spread = hero** is the owner's pacing rule. They tested with mixed templates and found the rhythm dull. The 3rd-spread cadence creates a "rise and rest" feel as you flip through.
- **Pair-default body** keeps photos breathable. The owner explicitly does NOT want dense quad-grids unless math forces it.
- **All photos placed** is a hard constraint. Heroes/favorites are *priority flags*, not filters.
- **Hero = half-spread, not full-spread** — heroes occupy one page (half of a spread) paired with another photo or photos on the opposite page. Heroes never get a full spread alone (except in `panorama` template, which is layflat-only).

### Template library

19 templates in `TEMPLATES`. Each defines `slots: Slot[]` (positions in 0–100 % within the spread) and `compat: AlbumType[]` (`'standard'` only respects the gutter at x=50; `'layflat'` allows slots that cross the gutter).

Coordinates use 0.5 % edge padding and 1 % gutter (0.5 % each side of x=50). All slot maths preserve "half width = 49 %, gutter gap = 1 %".

Hero templates are named `hero-Nr` (hero on left, N small photos on right) or `hero-Nl` (mirror). N = 0 to 4. Non-hero templates are named by photo count + arrangement (e.g. `pair`, `pair-pair`, `trio-pair`, `quad-trio`).

---

## Persistence model

Album state lives in **localStorage**, keyed per album by UUID.

| Key | Value | Owner |
|-----|-------|-------|
| `folio-albums-index` | `AlbumIndexEntry[]` — the My Albums list, shared with the manual builder. Smart entries have `mode: 'smart'`. | Both wizards |
| `folio-smart-state:<id>` | The serialised wizard state: size, type, pageCount, step, photos, spreads, adjusts, **unusedPhotoIds**. | Smart wizard only |
| `folio-smart-undo:<id>` | The 5-deep undo stack (forward + backward ops). Per-album. | Smart wizard only |
| **IndexedDB** `folio-smart-photos` / `blobs` / key `<id>::<photoId>` | The actual `File` blob for each uploaded photo. Restored on refresh. | Smart wizard only |
| `folio-design-state-v3:<id>` | Manual builder state. | Manual builder only |
| `folio-cover-v1:<id>`, `folio-cover-photos-v1:<id>` | Manual builder cover. | Manual builder only |
| `folio-submitted:<id>` | Order submission marker (locks the album from edits). | Both wizards |

Auto-save fires on every state change after hydration, throttled by React's batching. `lastEditedAt` updates each save so the album rises in the My Albums list.

`step: 'generate'` is never persisted — if a user refreshes during the spinner, they land on the `pages` step instead of getting stuck.

---

## Test plan

### Sample wedding flow (works end-to-end)
1. Open `/design/smart` (in incognito, no `?album=` in URL)
2. When prompted, name it "Test Wedding"
3. Setup → pick 17×24 + Standard, click Continue
4. Guidance → click "Got it", upload step appears
5. Upload → click "Use sample wedding photos" — 30 photos load
6. Continue through Group, Tag (tag 6 heroes, 10 favorites), Pages (set to 12 spreads)
7. Click Generate → spinner shows for ~1.4s → Adjust step appears
8. **Verify**: every spread shows photos from a single event (label in top-right). Spreads 3, 6, 9, 12 should be hero spreads (gold "Hero" badge on one photo).
9. Click any photo → toolbar appears below the spread with all tools (Fit, Zoom, Pan, Flip, Rotate, Reset, Swap, Remove)
10. Click "Switch layout ▾" pill → dropdown shows alternates → click one → layout swaps
11. Click Submit Order → confirmation page
12. Refresh the browser — sample photos still there, lands on Adjust step

### Known-broken flow
- **Real upload + refresh**: drag any local image into the upload step, complete the wizard to Adjust, then refresh. Photos are now broken thumbnails. This is Bug #1.

### Smoke tests for new contributors
1. Visit `/design` — Smart card should be visible as the "Recommended" option.
2. Click Smart card → should land at `/design/smart`, prompt for name, mint album.
3. Visit `/design` again → your new album appears in My Albums with a gold "Smart" pill.
4. Click the album → routes to `/design/smart?album=<id>`, restores state.

---

## How to keep working with AI on this

1. **Always start a session with**: *"Read HANDOFF_SMART.md first, confirm you understand the state, then I'll tell you what I want."*
2. **Plan-before-code rule**: ask the AI to produce a plan first. Approve or push back before any code lands.
3. **One commit per change set, not per chat turn**: ask the AI to bundle related fixes.
4. **Test in browser after every commit**, not at the end.
5. **Keep the local backup zips fresh** — re-run `git archive` weekly:
   ```sh
   DATE=$(date +%Y-%m-%d) && git archive --format=zip --output="C:/Users/fufck/Documents/GitHub/backup/folio-forever-main-$DATE.zip" --prefix="folio-forever-main/" origin/main
   ```

### Prompt template to start a new AI session

```
I'm working on the Smart Auto-Layout wizard at folioforever.com/design/smart.
The repo is at C:\Users\fufck\Documents\GitHub\folio-forever-next on my
Windows machine.

Before doing anything:
1. Read HANDOFF_SMART.md
2. Read src/app/design/smart/page.tsx
3. Confirm you understand the architecture, the known bugs, and the
   deferred-features list

Then I'll tell you what I want to change. Don't code anything until I
approve a plan.
```

---

## Recent commits on this branch (newest first)

```
f16330f  fix(design/smart): pacing rule, white gaps, full photo toolbar, swap fix
c986252  feat(design/smart): album persistence — name prompt, save, resume
88e4756  fix(design/smart): tighter gaps, strict events, hero+4, layout swap, photo zoom/pan
16dc1e3  feat(design/smart): album setup + size-aware layouts + all-photos placement
4643151  feat(design/smart): full 9-step wizard with real layout engine
0572d19  style(design/smart): match folioforever brand theme
1bd7818  fix(design/smart): clean up unused vars and lint warnings
e7bae52  feat(design): add Smart Auto-Layout as third path option
b6edd54  feat(design/smart): replace Smart Auto-Layout page with new wizard UI
```

For full history: `git log --oneline src/app/design/smart/page.tsx`

---

## Quick reference: who to ask if you're stuck

- **About the algorithm**: this doc, "How the layout engine works" section
- **About a specific template's slot positions**: open page.tsx and search the template id (e.g. `'hero-4r'`)
- **About persistence**: this doc, "Persistence model" section
- **About what was deferred and why**: this doc, "Deferred features" section
- **About anything else**: open a PR with your question in the description; the owner can review

Last updated: 2026-05-07
