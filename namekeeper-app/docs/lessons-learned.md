# Lessons Learned

A running collection of non-obvious things uncovered while building NameKeeper.
Each entry is short on purpose — the *why* matters more than the *what*.

---

## Relationship mapper layout

### React Flow smoothstep bends at midY by default — that's where your boxes are

`smoothstep` edges route as `source → down → horizontal at midY → down → target`.
If the two rows are back-to-back (small gap), the horizontal segment lands
INSIDE the lower row and cuts straight through the node boxes. Two fixes
needed: (a) widen the row gap, (b) set `pathOptions: { offset, borderRadius }`
on the edge so the bend happens at `source + offset` instead of midY. This
keeps the horizontal inside the inter-row gap.

**Rule:** any smoothstep edge between rows in a family-tree-style layout
needs `pathOptions.offset` set. Defaults are wrong for this shape.

### Zero-width invisible handles + unchecked left/right swap = line through text

The original spouse-connector code had a swapped argument:
`addSpouseConnEdge(personId, junctionId, !spineIsLeft)` when it should have
been `spineIsLeft`. With zero-width invisible handles, React Flow doesn't
complain — it just routes from the wrong edge, and a "straight" edge type
ends up going all the way through the node body to reach the opposite side
handle. The "pink box struck-through" symptom was this — there was no CSS
text-decoration, just a straight edge crossing the box.

**Rule:** derive handle selection from actual x positions
(`personCenterX < junctionCenterX`), not from a side flag that can invert.
Writing `source handle` based on geometry instead of intent is
bug-resistant.

### `edge.pathOptions` IS forwarded to the edge component, but not in the exported `Edge` type

`@xyflow/react`'s internal `EdgeWrapper` does
`pathOptions: 'pathOptions' in edge ? edge.pathOptions : undefined` when
rendering, so setting `pathOptions` on an edge object in your `edges` array
works at runtime. But the exported `Edge` type doesn't include it, so TS
complains. The typed `SmoothStepEdge` helper exists but is named the same
as the runtime component export, so importing it as a type collides.

**Rule:** declare a local type `type SmoothStepEdgeInput = Edge & { type:
'smoothstep'; pathOptions?: {...} }` and cast when pushing.

### GEDCOM `childIds` isn't guaranteed to be in birth order

File order usually matches birth order because that's how most tools
write GEDCOM, but it's not a requirement and real files break this.
Sibling ordering logic based on array index gives the wrong answer
whenever a child record was inserted out of order.

**Rule:** sort by parsed birth year ascending with file order as a
stable tiebreaker. There's a `sortByBirth` helper at the top of
`relationship-path-layout.ts`. See also the comment in `lib/cascadeWaves.ts`.

### Row packing for trees with variable-width subtrees needs two-gen collision checks

Piece 2 (spine siblings at row N) and Piece 3 (row N sibling's kids at
row N+1) both place nodes on shared row-Ys. Naively top-down iteration
with per-row occupancy still collides, because a row N sibling's IDEAL
position depends on what's at row N+1 — and at the time row N is
processed, row N+1 hasn't been packed yet.

Two fixes together:
1. Iterate **bottom-up**, so the lower row's Piece 2 slots are reserved
   before upper-row Piece 2 places its slots.
2. When finding a free slot for a sibling at row N, check occupancy at
   BOTH row N (the sibling couple slot) and row N+1 (the kid row one
   below). Forbidden center ranges on the center x-axis get inflated
   by `slotW/2 + gap` for same-row conflicts and `kidsW/2 + gap` for
   kid-row conflicts, then merged, then walked from the anchor.

**Rule:** any tree layout with collateral subtrees of variable depth
needs a bottom-up pass with multi-row collision checks, not a fixed
per-row packing.

### Proximity of "center-under-parent" vs. "no-overlap" is the whole ballgame

The visual anchor for a tree layout is "each child box is centered
under its parent couple's junction". That's non-negotiable for
readability. But when two sibling subtrees both want that ideal
position, they collide. The Piece 4 algorithm resolves this by
keeping center-under-parent as the default and only pushing outward
when a collision is actually detected — first-come-first-served by
bottom-up order.

Alternate approaches considered and rejected: Walker's algorithm
(too heavy for this shape), dagre (loses the "spine column" constraint),
manual fixed offsets (breaks as soon as sibling count varies).

---

## GEDCOM data-source quirks (Family Echo / Gramps exports)

### `_CURRENT` is a display flag, not a relationship status

Family Echo exports a `_CURRENT Y/N` tag on every `FAM` record. It looks like
"is this couple currently together" but it actually means "is this the
relationship Echo wants to show first in its UI". Many real, lifelong
marriages are exported as `_CURRENT N` (Robert Stewart + Barbara, for example),
and Jessica's two marriages were both `_CURRENT N` even though one was real
and one was an ex.

**Rule:** never treat `_CURRENT N` as divorce. Use `DIV` / `_SEPR`. If the data
has neither, fall back to a heuristic gated on a sibling family also being
`_CURRENT Y` (which IS a meaningful signal, because it means the data preparer
*chose* one). See `lib/family-status.ts` `isExFamily()`.

### `_MARNM` is abused for non-married-name data

Echo / Gramps stuffs middle names AND name suffixes into `_MARNM` on male
records:

```
NAME Robert /Cosgrove/
2 SURN Cosgrove
2 _MARNM Stewart Cosgrove   ← Robert's middle name "Stewart"
```

```
NAME Patrick /McDonnell/
2 _MARNM McDonnell Jr.      ← suffix
```

If you treat `_MARNM` as "surname now" naively, men end up with surnames like
"Stewart Cosgrove" (which then displays as "née Cosgrove" because it differs
from the SURN). **Rule:** only flip `surname ← _MARNM` when `sex === 'F'`.
And: don't auto-strip suffix tokens from surnames — the source data has
women like `Jane /McDonnell Jr./` which is upstream-broken, and stripping
on her record would silently change her name without context.

### Suffixes aren't in `NSFX`

Standard GEDCOM has `2 NSFX Jr.`. Family Echo doesn't emit it. Suffixes live
inside `_MARNM` as text. Parser handles `NSFX` in case other tools use it,
but for Echo data the user has to migrate by hand via the edit dialog.

### Empty placeholder `FAM` records

Some exports leave dangling `FAM` records with one spouse and no children
(e.g., `HUSB @I35@`, no `WIFE`, no `CHIL`). They show up as "Unknown spouse"
in the side panel until you filter them out. **Rule:** drop families from the
panel where there's no other spouse AND no children; they're placeholders.

---

## React effect ordering bites you exactly once

`useEffect` callbacks in the same component run in **declaration order**. If
two effects respond to the same state change and both call `setState`, the
*second* effect's update wins (for non-functional updaters within the same
render commit).

I shipped a deep-link `?person=` handler that called
`setCenterPersonId(linkPersonId)`. It mysteriously got clobbered to "first
person in data" because the auto-select-first-person effect was declared
*after* it. The auto-select effect ran second, saw `centerPersonId` was still
null in the closure, and overrode the deep link.

**Fixes that work:**
1. Declare the higher-priority effect *after* the default-fallback effect, so
   it queues its update last.
2. Have the default-fallback effect bail out when the precondition for the
   higher-priority one is met (e.g., check the URL param yourself).

I did both. The order-dependence is fragile; the bail-out is the durable fix.

## The other `useEffect` trap: stale memoized layouts

The Tree View page kept its layout in a `useMemo([data, centerId, ...])`. The
store mutates `data` *in place* (`Map.set`, `Object.assign`) and bumps a
`lastModified` timestamp via `set({ lastModified: Date.now() })`. The
component re-renders — but `data`'s reference is unchanged, so the memo
returns the cached layout. The tree silently went stale until something else
forced a recompute.

**Fix:** include `lastModified` in the memo deps. Or rewrite the store to be
immutable. We picked the cheap fix.

## State patches that survive layout rebuilds

The Tree View has two state changes that should affect the same nodes:

1. *Layout change* (centerPerson moved, expansion toggled): full rebuild via
   `buildTreeViewV2()` → `setNodes(treeResult.nodes)`. New node objects.
2. *Selection change* (clicked a different person): just patch
   `data.isSelected` on existing nodes.

Original implementation: two separate effects, one for each. They drifted out
of sync because the layout rebuild produced nodes with `isSelected: false`
everywhere, and the selection-patch effect only re-ran when
`selectedPersonId` *changed* — not when the layout was re-applied. So
clicking-the-same-node-after-an-edit silently dropped the highlight.

**Fix:** merge into one effect that knows how to handle three cases (layout
changed, selection changed, both). When applying a fresh layout, bake the
current selection into the nodes as you build them.

---

## React Flow's edge-thickness as depth-of-field

`tree-view-layout-v2.ts` had a hidden visual feature: edges scale from 3.5px
slate-600 (immediate family) down to 0.8px slate-200 (distant ancestors)
based on generational distance from the centered person. It wasn't documented
in the legend, so users assumed the random-looking thickness was a bug.

**Lesson:** if a visual cue isn't in the legend, users will read it as noise.
Added a stacked `DepthSwatch` to the legend.

---

## Family Echo's UI conventions you have to copy or annoy users

- **Click on a name** opens that person's tree. It's the primary navigation
  gesture. We had to add a clickable header in the side panel so the user
  could jump from Name Keeper → Tree View.
- **Surname chips link to the surname tree.** The "Appears In" chips on the
  side panel needed to be clickable for the same reason.
- **Add Child should ask which parent first.** Family Echo's wizard always
  starts by picking the *other parent* from the existing spouses (or "+ New
  partner"), then picks the child. We initially shipped a flat "type a name
  to search" — the user immediately complained because it forced you to
  link an existing person and gave no way to create a new one.
- **Pick-or-create** is one toggle, not two screens. Inside any "select a
  person" step, expose `Create new` and `Link existing` as a small tab pair.
  Default to `Create new` because that's the common case.

---

## CSS reset gotchas in Tailwind v4

Tailwind v4's preflight resets `button { cursor: default }`. Native `<button>`
elements no longer show the pointer cursor on hover. You have to add it
back globally:

```css
button:not(:disabled),
[role="button"]:not([aria-disabled="true"]),
summary,
label[for] {
  cursor: pointer;
}
```

We added this once to `globals.css` after every action button felt vaguely
"dead" on hover.

---

## Flexbox stretch is the default — say `items-start` or your child fills

A wrapper `<div className="absolute top-3 right-3 bottom-3 z-10 flex">`
constrains its child to the viewport (good — that was the goal: max-height).
But the panel inside *also* stretched to fill that height even when collapsed,
because flex's default cross-axis alignment is `stretch`.

**Fix:** add `items-start` to the wrapper. The panel sizes to its content
*up to* the wrapper's max height.

---

## Spacing algorithms react to data, not props

When the user adds a person via the wizard, the tree spacing algorithm
(`tree-view-layout-v2.ts`) needs to recalculate. We were worried about wiring
that up — but it works for free because `treeResult` is a `useMemo` whose
deps include `data` (and `lastModified`, see above). Any store mutation
triggers re-layout. No need to thread "tree changed" callbacks anywhere.

**Lesson:** when you have a reactive layout pipeline keyed on the source
data, you only ever need to invalidate the source. Don't manually push
"layout dirty" signals.

---

## Match the relationship calculator's gender helpers carefully

`relationship-calculator.ts` had a `regender(rel, sex)` helper with this
signature:

```ts
const swaps: [RegExp, string, string][] = [
  // [pattern, maleForm, femaleForm]
  [/\bSon\b/, 'Son', 'Daughter'],          // correct
  [/\bDaughter\b/, 'Daughter', 'Son'],     // BACKWARDS — swaps slots
  [/\bMother\b/, 'Mother', 'Father'],      // BACKWARDS
  ...
];
```

The author paired each entry with the form that *matched the pattern*, not
with the male slot. Result: feeding `"Daughter"` with `sex='M'` returned
`"Daughter"` because slot 2 was `"Daughter"`.

This was undetectable on the Name Keeper page (which doesn't use the in-law
fallback path much) but obvious on the Tree View when sons-in-law showed up
labeled "DAUGHTER (BY MARRIAGE)". **Lesson:** when a data-driven helper has a
"slot ordering" convention, write the slots in a fixed order (always
`[male, female]`) and document it in a comment, not by mirroring whichever
form the input contained.
