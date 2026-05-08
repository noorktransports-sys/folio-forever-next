# Integration guide — Smart wizard edit features

Drop the eight files into `src/app/design/smart/edit/`. Below is the exact
wiring for the existing `SmartDesignerPage` component in `page.tsx`.

## File summary

| File | What it gives you |
|---|---|
| `operations.ts` | `Op` type, op constructors, `applyOp` |
| `stack.ts` | `OperationStack` (5-deep), localStorage persistence |
| `use-undo.ts` | `useUndo` hook — wraps stack + keyboard shortcuts |
| `UndoButtons.tsx` | Header buttons + `useToast` |
| `swap.tsx` | `useTapSwap`, `useSlotDrag`, `<SwapPicker>` |
| `photo-count.ts` | `buildPhotoCountOp`, `buildAddOp`, `buildRemoveOp` (all wrap `templatesForCount`) |
| `PhotoCountDropdown.tsx` | The `2 PHOTOS ▾` pill, with disabled-with-reason support |
| `PanSlider.tsx` | `<SlotImage>` (fixes pan + adds drag-to-pan), `<PanSliders>` |

## 1. Wire the undo stack at the wizard root

In `SmartDesignerPage`, where you have `spreads` and `unusedPhotoIds` state:

```tsx
import { useUndo } from './edit/use-undo'
import { UndoButtons, useToast } from './edit/UndoButtons'

const { show: showToast, Toast } = useToast()

const undoApi = useUndo({
  albumId,
  state: { spreads, unusedPhotoIds },
  setState: ({ spreads: nextSpreads, unusedPhotoIds: nextUnused }) => {
    setSpreads(nextSpreads)
    setUnusedPhotoIds(nextUnused)
  },
  onAnnounce: showToast,
})

// In your header, wherever the title sits:
<UndoButtons
  canUndo={undoApi.canUndo}
  canRedo={undoApi.canRedo}
  nextUndoLabel={undoApi.nextUndoLabel}
  nextRedoLabel={undoApi.nextRedoLabel}
  onUndo={undoApi.undo}
  onRedo={undoApi.redo}
/>

// Render the toast somewhere near the root:
{Toast}
```

Now every place in your code that mutates `spreads` or `unusedPhotoIds` directly
must instead build an `Op` and call `undoApi.record(op)`.

## 2. Generate clears the stack — with confirm

Replace your existing Generate handler:

```tsx
const onGenerate = () => {
  if (undoApi.canUndo || undoApi.canRedo) {
    const ok = window.confirm(
      'Regenerating will clear your edit history. Continue?'
    )
    if (!ok) return
  }
  undoApi.clearStack()
  runGenerateLayout() // your existing function
}
```

(`window.confirm` is fine for v1 — replace with a styled modal later.)

## 3. Tap-to-swap — wire to your existing slot click handler

```tsx
import { useTapSwap } from './edit/swap'

const tapSwap = useTapSwap({
  state: { spreads, unusedPhotoIds },
  record: undoApi.record,
})

// On each rendered slot:
<div
  onClick={() => tapSwap.onSlotTap(spread.id, slotIndex)}
  style={{
    outline: tapSwap.armed?.spreadId === spread.id
          && tapSwap.armed.slotIndex === slotIndex
      ? '2px solid var(--gold)' : undefined,
    ...
  }}
>...</div>

// On each unused-pool thumbnail:
<img onClick={() => tapSwap.onUnusedTap(photoId)} ... />
```

The `armed` state is what gives you the "first tap selects, second tap
swaps" feel. Highlight it visibly — gold outline matches your theme.

⚠️ Conflict warning: your existing UI opens the photo toolbar on slot click.
Resolve by either:
- (a) Slot click = arm for swap; double-click or a "Swap" toolbar button = enter swap mode explicitly.
- (b) Add a "Swap" mode toggle in the header. While off, click = open toolbar. While on, click = arm/swap.

I'd ship (b). It's discoverable and doesn't hijack existing behavior.

## 4. Drag-and-drop swap

```tsx
import { useSlotDrag } from './edit/swap'

const drag = useSlotDrag({
  state: { spreads, unusedPhotoIds },
  record: undoApi.record,
  onAddRequested: (spreadId, photoId) => handleAdd(spreadId, photoId), // see #6 below
})

// On each slot:
<div draggable {...drag.slotHandlers(spread.id, slotIndex)}>...</div>

// On each unused thumbnail:
<img draggable {...drag.unusedHandlers(photoId)} />

// On the spread container (NOT the slot — the wrapping div):
<div {...drag.spreadDropHandlers(spread.id)}>
  ...slots...
</div>
```

Touch caveat: HTML5 drag doesn't work on iOS Safari without help. For phase 1,
ship the tap-to-swap path (above) on touch and drag-and-drop on desktop. For a
real touch DnD later: `react-dnd-html5-backend` + `react-dnd-touch-backend`.

## 5. Toolbar Swap picker (modal)

```tsx
import { SwapPicker } from './edit/swap'
import { makeSwapWithUnusedOp, makeCrossSwapOp } from './edit/operations'

const [pickerTarget, setPickerTarget] = useState<{spreadId: string; slotIndex: number} | null>(null)

// Add a Swap button to your existing PhotoToolbar:
<button onClick={() => setPickerTarget({ spreadId, slotIndex })}>Swap…</button>

<SwapPicker
  open={!!pickerTarget}
  target={pickerTarget}
  onClose={() => setPickerTarget(null)}
  photos={photosById}
  usedPhotoIds={new Set(spreads.flatMap(s => s.photoIds.filter(Boolean) as string[]))}
  unusedPhotoIds={unusedPhotoIds}
  onPick={(photoId) => {
    if (!pickerTarget) return
    if (unusedPhotoIds.includes(photoId)) {
      undoApi.record(
        makeSwapWithUnusedOp({ spreads, unusedPhotoIds }, pickerTarget.spreadId, pickerTarget.slotIndex, photoId)
      )
    } else {
      // Find which spread/slot the picked photo currently lives in
      for (const s of spreads) {
        const idx = s.photoIds.indexOf(photoId)
        if (idx >= 0) {
          undoApi.record(
            makeCrossSwapOp({ spreads }, s.id, idx, pickerTarget.spreadId, pickerTarget.slotIndex)
          )
          break
        }
      }
    }
  }}
/>
```

## 6. Per-spread photo count dropdown

Replace the current static "2 PHOTOS ▾" with the dropdown component:

```tsx
import { PhotoCountDropdown } from './edit/PhotoCountDropdown'
import { buildPhotoCountOp } from './edit/photo-count'
import { templatesForCount } from './engine/templates' // wherever this lives

const isHeroPhoto = (id: string) => photosById[id]?.tagged === 'hero'

const currentCount = spread.photoIds.filter(Boolean).length

// Pre-compute which counts are disabled and why
const disabled: Record<number, string> = {}
for (const n of [1,2,3,4,5]) {
  if (n === currentCount) continue
  if (n > currentCount && unusedPhotoIds.length < (n - currentCount)) {
    disabled[n] = 'Not enough unused photos'
  }
  // Could also pre-check templatesForCount(n) returns something
}

<PhotoCountDropdown
  current={currentCount}
  available={[1,2,3,4,5]}
  disabled={disabled}
  onChange={(next) => {
    const result = buildPhotoCountOp(
      { spreads, unusedPhotoIds },
      spread.id,
      next,
      { albumType, isHeroPhoto, templatesForCount }
    )
    if ('op' in result) undoApi.record(result.op)
    else showToast(`Can't change count: ${result.error}`)
  }}
/>
```

## 7. Drag unused → spread = +1 layout

The drop is wired in step 4 via `spreadDropHandlers`. The handler:

```tsx
import { buildAddOp } from './edit/photo-count'

const handleAdd = (spreadId: string, photoId: string) => {
  const result = buildAddOp(
    { spreads, unusedPhotoIds },
    spreadId,
    photoId,
    { albumType, isHeroPhoto, templatesForCount }
  )
  if ('op' in result) undoApi.record(result.op)
  else if (result.error === 'at-capacity') showToast('Spread is at max photos')
  else showToast(`Can't add: ${result.error}`)
}
```

## 8. Pan fix

In your existing slot rendering, replace whatever currently renders the `<img>`
with `<SlotImage>`:

```tsx
import { SlotImage, DEFAULT_ADJUST } from './edit/PanSlider'

const adjust = adjustments[slotIndex] ?? DEFAULT_ADJUST
const setAdjust = (next) => setAdjustments({ ...adjustments, [slotIndex]: next })

<SlotImage
  src={photo.preview}
  adjust={adjust}
  onAdjustChange={setAdjust}  // omit if you don't want drag-to-pan
/>
```

The pan fix is the `objectPosition: ${panX}% ${panY}%` line. If your current
code uses `transform: translate(...px)` instead, **that's the bug** — translate
in pixels gives near-zero movement on small slots. Switch to object-position.

In your toolbar, replace the existing pan UI:

```tsx
import { PanSliders } from './edit/PanSlider'

<PanSliders
  adjust={adjust}
  onChange={setAdjust}
  onReset={() => setAdjust(DEFAULT_ADJUST)}
/>
```

Sliders + drag are now wired together — moving either updates the same state.

## What's NOT done (deliberately, per your direction)

- No coalescing of slider drags. Per your call, sliders aren't on the undo stack at all — Reset button handles them.
- No styled confirm modal for Generate (uses `window.confirm`).
- No touch DnD polyfill.
- No "layout variant" picker UI yet — `makeLayoutVariantOp` exists in `operations.ts` but you'll need to wire it to your existing "Switch layout ▾" pill that the handoff doc mentions.

## Test sequence (5 min, before you ship)

1. Generate a 12-spread sample album.
2. Tap a slot, then tap another slot on the same spread → swap happens, undo button enables.
3. Cmd+Z → swap reverts, redo button enables. Cmd+Shift+Z → swap redoes.
4. Do 6 swaps. Try to undo all 6 → only 5 work. Confirm capacity is hit cleanly (no crash).
5. Drag a slot onto another slot → swap. Drag an unused thumbnail onto a slot → swap-with-unused.
6. Drag an unused thumbnail onto a spread background (not a slot) → spread grows by 1.
7. Open the count dropdown on a 2-photo spread → pick 4 → spread grows. Undo → reverts.
8. Refresh browser. Undo button still shows correct count for current album.
9. Switch to a different album. Undo stack is empty (per-album scope).
10. Click Generate on an album with edits → confirm dialog. Confirm. Stack clears.
11. Pan sliders move the photo (the whole point). Drag the photo directly with mouse → pans too.
