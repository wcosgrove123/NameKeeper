# NameKeeper

A patrilineal surname-succession tracker and family-tree viewer built on
top of standard GEDCOM data. Originally a research tool for tracing the
"name keeper" (the eldest-son line carrying a surname) across a family
tree, it has grown into a richer Family-Echo-style editor with godparent
relationships, multi-step add wizards, and live in-browser editing.

## Highlights

- **Three views** — *Name Keeper* (succession-line analysis per surname),
  *Tree View* (general-purpose family tree centered on any person), and
  *Relationship* (calculate kinship between any two people).
- **Tabbed side panel** with Personal / Contact / Biography sections,
  drag-and-drop photo, tree-stats plaque, marriages list with inline
  divorce toggle, godparents, and (where applicable) NameKeeper / Matriarch
  stats. Click any person on the tree to open it.
- **Full editor** — every Person field is editable through a tabbed dialog.
  Title, given names, middle names, nickname, surname now / at birth, suffix,
  contact info, biography. Survives GEDCOM round-trip.
- **Multi-step relationships wizard** — Add Partner, Sibling, Child, Parents,
  or Godparent. Each flow lets you pick an existing person OR create a new
  one inline. Add Child first asks which other parent. Marriages can be
  flagged Current or Ex.
- **Godparents** — a custom relationship type with a "linked" branch
  (existing person on the tree, gets a bolder sex-tinted border when their
  godchild is selected) and an "external" branch (standalone name, only
  visible on the godchild's card).
- **GEDCOM round-trip** — load any standard `.ged` file, edit, export back
  out. Supports the major Family Echo / Gramps quirks (`_MARNM`, `_CURRENT`,
  `RESI` block, `OCCU` + `PLAC` for company).
- **Local-first** — everything is stored in IndexedDB. Photos are stored as
  blobs (no base64 bloat). Auto-saves on every change; survives reloads.

## Stack

- Next.js 16 (Turbopack)
- React 19
- TypeScript
- Tailwind CSS v4
- Zustand (state)
- React Flow (`@xyflow/react`) for the Tree View
- Cytoscape for the Name Keeper succession layout
- IndexedDB via `idb`

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. On first load you can either upload a
GEDCOM file via the toolbar or — if you have the bundled sample data — it
auto-loads from `public/data/family.json`.

## Project layout

```
src/
  app/
    page.tsx                 → Name Keeper page (succession analysis)
    tree-view-2/page.tsx     → Tree View page (general family tree)
    relationship/page.tsx    → Relationship calculator
  components/
    PersonSidePanel.tsx      → Tabbed side panel (used by all pages)
    PersonFormDialog.tsx     → Tabbed edit dialog
    RelationshipDialog.tsx   → Multi-step add-relative wizard
    PersonNode.tsx           → React Flow node renderer
    TreeView2Landing.tsx     → Tree View landing / search overlay
  lib/
    gedcom-parser.ts         → GEDCOM → in-memory data model
    serialization.ts         → in-memory data model → GEDCOM / JSON
    store.ts                 → Zustand store + CRUD helpers
    family-status.ts         → isExFamily() — single source of truth for divorce
    person-graph-stats.ts    → ancestor / descendant counts, name formatter
    person-search.ts         → token-based search matcher
    photo-storage.ts         → IndexedDB blob storage for photos
    namekeeper.ts            → succession analysis (per surname)
    namekeeper-stats.ts      → per-person prime-line / generation stats
    matriarch-stats.ts       → matriarch analysis (per female)
    relationship-calculator.ts → kinship label for any two people
    tree-view-layout-v2.ts   → Tree View layout algorithm
    migrations/              → one-shot data normalization migrations
  app/globals.css            → Tailwind v4 theme + small reset overrides
public/data/                 → bundled GEDCOM / JSON sample
docs/                        → CHANGELOG, lessons-learned, architecture, issues
```

## Documentation

- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — version history
- [`docs/lessons-learned.md`](./docs/lessons-learned.md) — engineering notes
  on GEDCOM quirks, React effect ordering, divorce semantics
- [`docs/tree-view-architecture.md`](./docs/tree-view-architecture.md) —
  layout algorithm design
- [`docs/tree-view-issues.md`](./docs/tree-view-issues.md) — known issues
  + status

## Development notes

- The Next.js setup is intentionally non-standard — see `AGENTS.md` and
  `CLAUDE.md` for AI-assisted development conventions.
- The `READ_ONLY` flag in `lib/site-config.ts` switches the deployed
  GitHub Pages build into a read-only viewer. Editing tools are gated on it.

## License

Private project — not currently licensed for redistribution.
