# Changelog

## 2026-04-14 — Side panel parity, relationships wizard, godparents

A two-pass overhaul that brought the Tree View page up to feature parity with
Family Echo's side panel, replaced the entire relationship-add UX with a
stateful wizard, and introduced a brand-new godparent relationship type.

---

### Side panel (PersonSidePanel)

- **New tabbed card** with **Personal / Contact / Biography** tabs that mirrors
  Family Echo's edit panel. Replaces the legacy `PersonDetail.tsx` everywhere
  it was mounted.
- **Photo slot** with drag-and-drop. Local images are stored as blobs in
  IndexedDB (`namekeeper-photos` DB), referenced by an `idb://<personId>`
  sentinel on `Person.photoUrl`. Click to open in a lightbox.
- **Sex-tinted gradient header strip** (blue / pink / slate) with the photo,
  full name, year span, and `née <surname>` for women whose surname changed.
- **Tree stats plaque** — live ancestor and descendant counts computed
  via cycle-safe BFS in `lib/person-graph-stats.ts`.
- **Marriages section** lists each spouse with an inline **mark divorced /
  mark current** toggle. Reads true ex-state from the shared `isExFamily()`
  helper; writing flips the explicit `Family.divorced` flag.
- **Godparents section** — new (see below).
- **NameKeeper Status** (males) and **Matriarch Stats** (females) sections
  computed lazily for the selected person's surname. Previously only available
  on the Name Keeper page.
- **Appears In** chips clickable on the Tree View page → navigates to the
  Name Keeper succession tree for that surname.
- **Action footer collapsed from 7 buttons to 4**:
  `[Edit] [Center] [Add ▾] ........... [Delete]`.
  The `Add ▾` popover lists Partner / Sibling / Child / Parents / Godparent.
  `Delete` is right-aligned and visually separated from the additive actions.
- **Collapsible** — chevron in the top-right collapses the card down to its
  header strip (matches the Legend collapse pattern). Esc fully dismisses.
- **Layered shadow** (3-stop) so the floating card actually feels above the
  canvas.
- **Date row redesign** — birth/death place rendered in smaller, lighter type
  on its own line beneath the date.
- Bound to **viewport height** with internal scroll only on the tab content;
  header / tabs / footer stay pinned.

### Edit dialog (PersonFormDialog)

Full rewrite with the same Personal / Contact / Biography tabs as the side
panel. New fields:

- **Personal**: title, given names, **middle names** (new), nickname,
  surname now, surname at birth, **suffix** (new), sex, birth date / place,
  living toggle, death date / place, photo URL.
- **Contact**: email, website, home / mobile / work phones, address.
- **Biography**: profession, company, interests, activities, bio notes,
  free-text other notes.

### GEDCOM round-trip

The exporter (`lib/serialization.ts`) now writes:

- `NPFX` (title), `NSFX` (suffix), `_MARNM` (surname now)
- Combined `GIVN` for given + middle names
- `OCCU` + level-2 `PLAC` (Family Echo's company convention)
- `RESI` block with `ADDR/CONT`, `PHON×N`, `EMAIL`, `WWW`
- `1 DIV Y` for divorced families
- `1 _CURRENT Y/N` preserved as a display flag (not a relationship status)
- Interests / Activities / Bio notes as `NOTE` lines so Family Echo can
  re-import them

The parser (`lib/gedcom-parser.ts`) gained matching support for `NPFX`,
`NSFX`, `RESI` children, and `OCCU.PLAC` → company.

### Relationships wizard

`RelationshipDialog.tsx` was rewritten as a **stateful multi-step wizard**:

- **Add Partner** — pick existing or create new person, marriage date / place,
  current vs ex segmented toggle.
- **Add Child** — first pick the *other parent* (existing spouse / new partner /
  solo), then pick or create the child. Child surname auto-fills from the male
  parent and updates reactively when the parent choice changes.
- **Add Sibling** — links to the anchor's birth family, creates a placeholder
  if no parents are recorded.
- **Add Parents** — pick or create father and mother (either or both), with
  optional marriage date. If the anchor already has a birth family, missing
  slots get patched in instead of creating a new family.
- **Add Godparent** — pick someone on the tree OR add an unrelated person.

A shared `PickOrCreate` sub-component switches between `Create new` (mini name
form) and `Link existing` (PersonSelector search). All flows go through store
helpers — no callbacks are threaded through from the page.

New store actions: `addSibling`, `linkSibling`, `addParents`, `addGodparent`,
`removeGodparent`, plus a `partnerType` parameter on `createMarriage`.

### Godparents (new relationship type)

Standard GEDCOM has no godparent tag, so this is custom:

- New `GodparentRef` union: either `{ kind: 'linked', personId }` (refers to a
  Person on the tree) or `{ kind: 'external', givenName, surname, sex }`
  (standalone — only visible on the godchild's card, no node added).
- New `Person.godparents?: GodparentRef[]` field.
- **Bolder border on godparent nodes** when the godchild is selected:
  3px `blue-600` for godfathers, 3px `pink-600` for godmothers. Visible only
  for *linked* godparents (external ones have no node).
- Toggle in the Legend's customize footer to hide / show the markers.
- Round-trip: stored in JSON / IndexedDB only; not yet emitted to GEDCOM.
  Marked as a follow-up.

### Divorce semantics overhaul

Previously the renderer treated Family Echo's `_CURRENT N` flag as "divorced",
which mis-marked many real marriages. New model:

- New `Family.divorced?: boolean` parsed from standard `DIV` and `_SEPR` tags.
- New `lib/family-status.ts` with two helpers:
  - `isExFamily(famId, data)` — single source of truth. Priority:
    explicit `divorced` → sibling-`_CURRENT Y` heuristic (only when the same
    person has another family marked `_CURRENT Y`) → marriage-date fallback.
  - `isIrrelevantExFamily` — adds the *"ex marriage only counts if it produced
    children"* rule.
- `_CURRENT` is kept on the type with a comment clarifying it's a Family Echo
  display flag, **not** a relationship status.
- The tree renderer (`tree-view-layout-v2.ts`) and the relationship calculator
  (`relationship-calculator.ts`) both consume `isExFamily()` so they can't
  drift apart.
- Direct spouse check returns `Ex-Husband` / `Ex-Wife` / `Ex-Spouse` labels
  instead of falling through to the LCA path (which used to mislabel exes as
  "Self (by marriage)").
- Step-parent detection: an ex-spouse of a bio parent is not a step-parent.

### Relationship-calculator gender bug

`regender()` in `relationship-calculator.ts` had its male/female slots
**flipped** for every female-leading entry (`Daughter`, `Mother`, `Sister`,
`Aunt`, `Niece`, `Wife`, `Granddaughter`, `Grandmother`). The result: any path
that recursively re-gendered a female label for a male relative left it as
the female form. Visible on labels like "Daughter (by marriage)" applied to
sons-in-law. Fixed by re-pairing the slots correctly.

### Tree View page (tree-view-2)

- **Floating zoom toolbar** at bottom-right: zoom out / live percent / zoom
  in, fit-to-screen, center-on-selected, re-anchor. Custom-built (replaces
  React Flow's default `<Controls />`).
- **Legend panel** at bottom-left: collapsible, with sex swatches, deceased
  variant, godfather / godmother thick swatches, marriage / ex-marriage edge
  swatches, and a stacked "Closer = thicker" depth-of-field swatch. Customize
  footer with a Godparent markers toggle.
- **Click-to-fit-immediate-family** — clicking a node smoothly fits the view
  to that person + their parents + spouse + children, instead of refitting
  the whole tree.
- **Search → auto-select + center** so picking from search opens the panel.
- **Auto-select on center change** so the centered person is always the
  highlighted person.
- **Removed Family Distance dropdown** (didn't actually work).
- Edit / Add / Delete now wire through `PersonFormDialog`, `RelationshipDialog`,
  and `ConfirmDialog`. `Ctrl+Z` / `Ctrl+Y` undo / redo.

### Search

New shared util `lib/person-search.ts` with token-based AND matching:

- Splits on whitespace; every token must match somewhere
- Hits any of: given-name parts, current surname, surname at birth, nickname
- Strongest hit per token wins (exact word > word prefix > substring > fuzzy)
- Bonus for full-name prefix match and 4-digit birth-year token match
- Used by both the landing search overlay and the in-tree toolbar search,
  replacing two divergent matchers

### Cross-page navigation

- **Tree View → Name Keeper**: clicking a surname chip in `Appears In`
  navigates to `/?surname=<name>&person=<id>`. The Name Keeper page reads
  these query params on mount and pre-selects the surname tree + the person.
- **Name Keeper → Tree View**: clicking the person name in the panel header
  navigates to `/tree-view-2?person=<id>`. The Tree View page reads `?person=`
  on mount, dismisses the landing overlay, centers on the person, and opens
  their card.

### Migrations

`lib/migrations/pass1-surname-biography.ts` — runs idempotently on every load:

- **Surname semantics flip**: makes `Person.surname` mean "surname now" and
  `Person.surnameAtBirth` mean maiden. Only flips for women (men keep their
  birth surname, fixing a bug where male records with `_MARNM "Stewart Cosgrove"`
  ended up with surname = "Stewart Cosgrove").
- **Biography lift**: parses legacy `notes[]` entries like
  `"Interests: …"`, `"Activities: …"`, `"Bio notes: …"` into typed
  `interests`, `activities`, `bioNotes` fields.

### Other

- **Removed the Family Tree tab** from the header nav and from the
  `TreeView2Landing` overlay nav. The route file remains for old bookmarks.
- **Cursor pointer** restored globally in `globals.css` (Tailwind v4's
  preflight resets `button { cursor: default }`).
- **Empty-placeholder marriages filtered** from the side panel's marriages
  list (some Gramps exports leave dangling FAM records).
- **Tree-stats memo bug fixed** — the layout `useMemo` reference-checked
  `data` which never changed across in-place store mutations. Added
  `lastModified` to the deps so adds / edits / deletes invalidate the
  layout immediately.
- **Selection patch decoupled from layout build** so clicking around no longer
  rebuilds and refits the entire tree on every selection change. Selection is
  now patched onto existing nodes via a single merged effect.

---

See also:

- [`lessons-learned.md`](./lessons-learned.md) — engineering takeaways
- [`tree-view-issues.md`](./tree-view-issues.md) — known issues + status
