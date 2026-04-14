# Relationship Mapper — State & Roadmap

Updated 2026-04-14. Covers `src/app/relationship/page.tsx` and
`src/lib/relationship-path-layout.ts`.

---

## What it does (today)

The Relationship page takes two people (Start + End) and draws the chart
of everyone blood-related *between* them, centered on their Lowest
Common Ancestor (LCA). The layout engine lives in
`relationship-path-layout.ts` and is what we call **Medium mode**.

At each spine row from LCA down to endpoint it shows:

- The spine couple (spine + path-spouse) — male-left, female-right.
- Every other child of the spine's parents (the spine's siblings),
  with their first-marriage spouse, flanking outward from the chain's
  center.
- Each of those siblings' first-marriage children, one row below their
  parent couple. These are the endpoint's first cousins (of that
  generation). **Capped at one level** — no grandkids of siblings.

At the endpoint row it shows the endpoint + all of their siblings in
birth order, centered under the parent couple's junction.

Every node except the start person is labeled with its relationship to
the start person via `calculateRelationship`. The start gets an amber
highlight; the end gets a violet highlight.

Blood-path edges are sex-colored solid lines (blue for male, pink for
female). Collateral (sibling / cousin) drops are dashed neutral grey.

---

## Architecture — pieces

The layout is built in labeled stages, each one additive. They were
built incrementally (each "piece" was a checkpoint the user reviewed):

**Piece 1 — Basic cousin layout.**
Male-left / female-right couples, birth-ordered kids centered under
parent junction, dynamic chain spacing driven by endpoint kid widths.

**Piece 2 — Spine siblings.**
At each non-endpoint spine row, place the spine's other siblings
(with spouses) flanking outward. Dashed collateral-descent edge from
the parent couple's junction above into each sibling's top-center.

**Piece 3 — Spine siblings' kids.**
One row below each placed sibling, lay out that sibling's own kids in
a small fan. Mini sibling-bus pattern (invisible bus junction above
the kid row, dashed drops to each kid). Capped at this depth.

**Piece 4 — Collision-aware packing.**
Bottom-up iteration with row-level occupancy tracking and two-gen
collision-aware `findFreeCenter`. See lessons-learned.md for the
algorithm description. Without this, spine siblings from row N and
spine siblings from row N+1 collide at their kid rows.

**Piece 5 — (not implemented) Direct-line parent parity.**
The direct-line case (center side) works but has cosmetic rough
edges — see "Known issues" below.

---

## Done

- ✅ Path finding via LCA (`relationship-path.ts`, unchanged)
- ✅ Spouse-connector handle swap bug (pink boxes used to look struck-through)
- ✅ Smoothstep edges bend inside row-gap via `pathOptions.offset`
- ✅ Male-left / female-right couple ordering
- ✅ Birth-order sibling placement (with birth-year sort)
- ✅ Dynamic chain spacing based on actual endpoint kid widths
- ✅ Endpoint kids bus (centered under parent couple junction)
- ✅ Spine siblings + spouses at every non-endpoint row (Piece 2)
- ✅ Spine siblings' kids one row below (Piece 3)
- ✅ Bottom-up + two-gen collision-aware packing (Piece 4)
- ✅ Relationship labels from start's perspective on every node
- ✅ Start (amber) + end (violet) highlight variants
- ✅ Descent out = junction bottom, descent in = spine top (matches user's
     "line emerges from the marriage midpoint, plants into the child's head")

---

## Not done yet

### Full mode

What we've built is "Medium" — a path-centric view. The user's long-term
ask is also a **Full expanded** mode that's LCA-centric. Differences:

| | Medium (current) | Full |
|---|---|---|
| Up from LCA | nothing | LCA's parents + parents' siblings (+spouses) + their **full** descendant subtrees; then direct-line ancestors going up as far as data allows, no siblings above LCA+1 |
| At LCA row | LCA only (or LCA couple for 2-LCA paths) | LCA couple always |
| Down from LCA | spine chain(s) + each spine's siblings + those siblings' first-generation kids | LCA's **full** descendant tree — every descendant, not just the path |

The trigger for Full is still open. Possibilities: toggle in the toolbar,
or auto-trigger when the query is a single-person ("click on an ancestor
→ see full descent from there").

Also pending for Full:

- LCA's own wife/husband always rendered (even for direct-line LCA where
  she isn't technically a common ancestor).
- LCA's parents row above the LCA.
- LCA's own siblings at the LCA row.
- Full descendant tree below the LCA, not just the path endpoints.

### Compact mode

We decided to drop Compact when we built Medium. If we want a "just the
blood line, no collaterals" view back, it's easy — wire a toggle that
skips `placeSpineSiblings` and the endpoint kid bus becomes just the
endpoint alone.

### Single-person / ancestor-click queries

The page only supports Start + End today. The user mentioned wanting
"click on great-great-grandpa → see his full descendant tree". That's
a new query type that bypasses `findRelationshipPath` and feeds a
single-person subtree into Full mode.

### In-laws

`findRelationshipPath` only walks blood ancestors. Queries like
"my wife's cousin" produce no result. Extending it requires walking
marriage edges as well — separate piece of work.

---

## Known issues / rough edges

### Direct-line spine zigzag when sex alternates

When the blood path walks through alternating-sex parents (common in
real families: mother → mother's father → father's mother → ...), the
spine column zig-zags between `+INNER_OFFSET` and `-INNER_OFFSET` at
each row because male-left / female-right flips the spine's position
within the couple. For a long direct-line chain like Wil → 6th
great-grandfather, this produces small horizontal jogs in the blood
line. Functionally correct but visually noisy.

*Fix sketch*: for direct-line chains, keep the spine in a consistent
column regardless of sex (pick left or right), and let the spouse
shift instead. Only apply male-left / female-right to cousin chains
where the two chains are symmetric.

### Single LCA position is fixed at `+INNER_OFFSET`

The direct-line LCA is placed at `+INNER_OFFSET` on the assumption that
the first spine below is female (so both align on the +INNER column).
When the first spine is male, the LCA → first-row descent edge has a
240px horizontal offset and bends in the gap. Cosmetic, small.

*Fix sketch*: look at the first spine's sex and pick the LCA x to
match.

### LCA couple isn't recentered over a widened descent

The LCA couple is always centered on x=0 (for 2-LCA) or `+INNER_OFFSET`
(for 1-LCA). When Piece 2/3/4 push siblings and cousins very wide at
lower rows, the LCA sits off-center relative to the whole tree's
bounding box. `fitView` handles visual centering at render time, so
it's only noticeable when you pan manually.

*Fix sketch*: after building all rows, compute the bounding box of
the lowest row, center the LCA over that midpoint, and reflow the
row-0 → row-1 descent edge.

### Row width can grow unboundedly for wide families

Piece 4 pushes each upper row's siblings further out to clear the
lower row's occupancy. For very branchy families (lots of kids at
every generation), this cumulative outward push can produce rows
that are thousands of pixels wide. The React Flow viewport handles
it fine (fitView scales), but at high zoom levels the user has to
pan a lot.

*Fix sketch*: optionally cap the collateral breadth — e.g., show
only the nearest N siblings, with a "+K more" indicator. Or add a
"Compact / Medium / Full" zoom toggle.

### Spine-sibling's spouse = always first-marriage

`placeSibCouple` and `spineSibKidsWidth` only look at
`familiesAsSpouse[0]`. If a spine sibling was married twice, the
second spouse and any second-marriage kids aren't shown. Matches
what the side panel's "first marriage wins" default behavior does
on other pages, so consistent — but worth noting.

### Relationship label computation is per-node, not batched

Every `addPerson` call does `calculateRelationship(personId, startId)`.
Cached per-person, so no duplicate calls, but the path-finding walk
inside `calculateRelationship` is O(ancestors) per person. For a deep
direct-line view with hundreds of placed nodes it could add a
perceptible layout delay. No measurable slowness today; flagged for
future profiling.

### Dead code that could go

- `COUPLE_SLOT_W` is still referenced via a `void` in one place to
  silence an unused-variable warning left over from the old fixed-pitch
  packing. Can be cleaned up.
- The `noGoHalfW` variable is now less meaningful with two-gen
  collision-aware packing — it's used as an anchor offset but the
  real work is done by `findFreeCenter`. Could be dropped.

---

## File map

- `src/app/relationship/page.tsx` — React Flow canvas + start/end
  person pickers + chain calculation wiring.
- `src/lib/relationship-path.ts` — BFS LCA path finder (unchanged).
- `src/lib/relationship-path-layout.ts` — the layout engine described
  above. Everything Medium-mode lives here.
- `src/lib/relationship-calculator.ts` — computes "Father",
  "6th Great-Uncle", etc. labels (unchanged, pre-existing).
- `src/components/PersonNode.tsx` — renders each person box. Now
  supports `isEndSelection` for the violet highlight.
- `src/components/FamilyNode.tsx` — renders the junction dots
  (unchanged).
