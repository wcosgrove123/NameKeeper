# Tree View — Known Issues & Status

Updated 2026-04-14.

## Resolved (2026-04-14)

### Family Distance dropdown didn't work → REMOVED
The `Family Distance` dropdown on the toolbar was wired to a state value the
layout algorithm didn't actually use. It's been removed. The layout always
uses the default distance now.

### Click-on-node refits the whole tree → FIXED
Every node click rebuilt the layout (`selectedPersonId` was a memo dep) and
called `fitView()`, which jarred the user back to "whole tree" zoom on every
click. Selection is now decoupled from the layout build and patched onto the
existing nodes. Clicking a node smoothly fits the view to that person + their
parents + spouse + children instead.

### Tree didn't update after edits → FIXED
The `treeResult` `useMemo` only re-ran when its `data` reference changed, but
the store mutates `data` in place (`Map.set`, `Object.assign`). Adding a
child or editing a person silently failed to re-layout until the user
manually recentered. Fixed by including `lastModified` in the memo deps.

### Click-on-name from Name Keeper opened the wrong person → FIXED
Two cooperating bugs: (1) the auto-select-first-person effect was declared
*after* the deep-link effect, so its `setCenterPersonId` clobbered the deep
link in the same render commit. (2) The deep-link effect didn't dismiss the
landing overlay. Both fixed; the auto-select also now bails out when a
`?person=` query param is present.

### Search required exact full-name substring → FIXED
The matcher did `"${givenName} ${surname}".includes(query)`, so searching
"wil cosgrove" failed because the middle name "James" broke the substring.
Replaced with token-based AND matching in `lib/person-search.ts` that hits
given parts, surname, surname-at-birth, and nickname independently. Both the
landing search overlay and the toolbar search use it now.

### Centered person wasn't highlighted gold → FIXED
"Centered" and "selected" were two independent states. Centering on someone
(via search, double-click, or recenter button) didn't auto-select them, so
the gold highlight never appeared. Added a sync effect that auto-selects the
center person whenever it changes.

### Edge thicknesses looked random → DOCUMENTED IN LEGEND
The layout has been scaling edge stroke width by generational distance from
the centered person all along (3.5px immediate family → 0.8px distant
ancestors). Users assumed it was a bug. Added a stacked depth swatch + caption
to the Legend panel so the cue is discoverable.

### Side panel wasn't bounded by the viewport → FIXED
Long panels (Matriarch Stats + Marriages + Godparents) overflowed off the
bottom of the screen. The panel is now `flex flex-col max-h-full` with the
header / tab bar / footer pinned and only the tab content scrolling.
Wrapper is `top-3 bottom-3` so the max bound is "viewport minus 24px".

---

## Still on the list

### 1. Distance 1+ great-grandparents flatten into one row
Inherited from the original layout — at higher generations, multiple root
subtrees end up at the same Y level. Less critical now that the Family
Distance dropdown is gone (default distance keeps the tree narrow), but the
underlying layout still has this property. See the "Proposed fix" in the
architecture doc.

### 2. Cross-subtree spouse connections
Same root cause as #1. When a person appears as a spouse in one subtree
and as a child in another, the connecting edge spans the entire layout.

### 3. Centering on a person with a spouse can cause visual overlap
The connecting child reordering helps in most cases; rare edge case at
distance 0+ where edges cross over the spouse node.

### 4. Godparents don't survive a GEDCOM round-trip
Godparent refs are stored in JSON / IndexedDB but the exporter doesn't write
them. There's no standard tag, so this needs a custom `_GODP` schema.
Following Family Echo's pattern of `_TAG_NAME` for custom data is fine;
queue this for a Pass 2.5.

### 5. No distinction between divorced and widowed
A spouse who *died* and a spouse who *divorced* are currently both modelled
the same way (the marriage either has `divorced: true` or it doesn't). The
side panel and the tree both show "ex" / dashed line for any non-current
marriage, which is wrong for widowed couples — a widow's marriage was real
right up until the death and shouldn't render the same as a divorce.

**Proposed fix:** add a `Family.endedBy?: 'divorce' | 'death' | 'separation'`
field. The renderer keeps using `isExFamily()` for the "should this be
de-emphasized" question, but the side-panel toggle becomes a 3-state
selector (current / divorced / widowed). Widowed marriages stay solid in
the tree but get a small "†" or similar marker on the partner side.

When `_DIV` / `_SEPR` is present in the GEDCOM, set `endedBy='divorce'`.
When the spouse has a `DEAT` date that predates the centered marriage date
ranges, default to `'death'`. Otherwise leave undefined.

### 6. Some Family Echo data quirks need a manual cleanup pass
- `_MARNM "Stewart Cosgrove"` etc. on male records leaves middle names
  jammed into surnames. The edit dialog now exposes a Middle Names field,
  but existing records have to be cleaned up by hand.
- `_MARNM "McDonnell Jr."` style suffixes are similarly stuck in surnames.
  No auto-strip because of false positives like `Jane /McDonnell Jr./`.
- Empty placeholder `FAM` records are filtered from the side panel but
  still exist in the data. A one-shot cleanup migration would remove them
  for good — not yet built.
