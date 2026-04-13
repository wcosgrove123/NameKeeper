# Tree View - Known Issues & Next Steps

## Current State (working)

**Distance 0 (1st Cousins) works perfectly:**
- Grandparents at top, all their descendants below
- Paternal side on the LEFT, maternal side on the RIGHT
- Connecting child (ancestor of center person) positioned closest to center at each level
- Spouses shown, children centered below junctions
- No edge crossings within each root subtree

## Known Issues

### 1. Distance 1+ (2nd Cousins) - Great-grandparents flatten into one row

**Problem:** At distance 1+, multiple root subtrees (great-grandparents) all appear at Y=0 in a flat horizontal line. It's impossible to tell which great-grandparent belongs to which grandparent without tracing the edges.

**Example:** Centered on William at distance 1:
- Roland Richard Cosgrove (paternal-paternal great-grandpa)
- Peter Charles Yuska (paternal-maternal great-grandpa)
- John Mitropolous (maternal-paternal great-grandpa)
- All sit at the same Y=0 level with no visual grouping

**Root cause:** The layout uses independent root subtrees placed side-by-side. Each root starts at Y=0.

**Proposed fix:** Change `collectByDistance` to follow Family Echo's approach:
- Only collect DIRECT ANCESTOR COUPLES above the grandparent level (no siblings)
- Only expand siblings/descendants at the grandparent level and below
- This keeps the tree narrow at higher generations and avoids the flat-row problem

See `docs/tree-view-architecture.md` for details on why this simpler approach was chosen.

### 2. Cross-subtree spouse connections

**Problem:** When a person appears as a spouse in one root subtree and as a child in another, the connecting edge spans across the entire layout.

**Example:** Melanie James is Ronald Cosgrove's wife (in the Cosgrove subtree) AND a child of John James (in the James subtree). The edge from John James's junction to Melanie spans the full width between the two subtrees.

**Proposed fix:** This is inherent to the flat root-subtree approach. The Family Echo approach (showing only direct ancestors at higher levels) naturally reduces this problem since there are fewer cross-subtree connections.

### 3. Centering on a person with a spouse can cause visual overlap

**Problem:** When centered on a person who has a spouse, the spouse is positioned inline between the center person and their siblings. This can cause connecting lines to cross over the spouse node.

**Current mitigation:** Child reordering pushes the center person to the inner edge (closest to maternal/paternal dividing line), which helps in most cases. Works well at distance 0.

## Priority Order

1. **Fix `collectByDistance` for distance 1+** - Adopt Family Echo's approach of showing only direct ancestor couples above the grandparent level
2. **Improve root subtree ordering** - Better sub-sorting within paternal/maternal groups
3. **Consider center-outward layout** - For a future major refactor (see architecture doc for why this was deferred)
