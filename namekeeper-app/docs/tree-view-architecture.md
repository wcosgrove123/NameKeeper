# Tree View - Architecture & Design Decisions

## Algorithm: Simple Top-Down Layout

The tree view uses a straightforward 3-phase algorithm:

1. **Find roots** - Persons whose parents are NOT in the collected set
2. **Measure widths** (bottom-up) - Each person's width = max(couple width, children's total width)
3. **Position nodes** (top-down) - From each root, position couple + children recursively

### Why Simple > Complex

We tried two alternative approaches and reverted to the simple one:

#### Attempt 1: Center-Person-Outward with Band Allocation
- **Idea:** Place center person at bottom, build upward with each ancestry branch getting exclusive horizontal bands. Father LEFT, mother RIGHT at every level.
- **Problem:** The "ancestry spine" concept (tracking connecting children, spouse branches) created a parallel data structure that fought with the GEDCOM data model. When a person is a wife (not the "primary parent" in GEDCOM terms), the spine missed their family. Children appeared under the wrong parent. The algorithm required too many special cases.
- **Lesson:** The GEDCOM data model is husband-centric (husband = primary parent). Any algorithm that tries to walk upward through both parents needs to handle the asymmetry carefully.

#### Attempt 2: Band Allocation with Ancestry Branch Width Measurement
- **Idea:** Measure upward branch widths recursively, split horizontal bands proportionally.
- **Problem:** Band widths didn't account for the actual spatial needs at each generation level. Bands were either too wide (wasting space) or too narrow (causing overlaps). The proportional splitting created unpredictable layouts that were hard to debug.
- **Lesson:** Width measurement and positioning need to work in the same direction (top-down). Trying to measure upward and position downward creates misalignment.

#### Current Approach: Simple Root-Subtree Layout
- **What it does:** Find all root ancestors, lay them out left-to-right, position each subtree top-down.
- **Why it works:** It's the same approach as every working family tree renderer. The GEDCOM data model naturally forms a forest of trees rooted at the oldest ancestors. Top-down positioning is simple and predictable.
- **Limitation:** At distance 1+, multiple root subtrees flatten to the same Y level. This is solvable by limiting what's collected (the Family Echo approach) rather than changing the layout algorithm.

## Key Components

### `collectByDistance(centerId, data, distance)`
Collects persons and families within the given cousin distance from the center person.

- Distance 0: Up to grandparents (2 generations), all descendants = 1st cousins
- Distance 1: Up to great-grandparents (3 generations), all descendants = 2nd cousins
- Distance N: Up to (N+2) generations, all descendants

**Next improvement:** At distance 1+, only collect direct ancestor COUPLES above the grandparent level. Don't expand siblings of great-grandparents. This matches Family Echo's behavior.

### `measureWidth(personId, ...)`
Bottom-up width measurement. For each person:
- Couple width = person + spouse gap + spouse (if any)
- Children width = sum of each child's subtree width + sibling gaps
- Result = max(couple width, children width)

### `positionNode(personId, centerX, y, ...)`
Top-down positioning. For each person:
1. Position person at (centerX - coupleWidth/2, y)
2. Position spouse to the right
3. Position junction between them
4. Reorder children (connecting child closest to center)
5. Position children centered below junction
6. Recurse for each child

### Child Reordering
At each level, if a child is an ancestor of the center person, they're pushed to the inner edge:
- **Paternal subtree:** Connecting child goes RIGHTMOST (closest to maternal side)
- **Maternal subtree:** Connecting child goes LEFTMOST (closest to paternal side)

This creates a "butterfly" effect where collateral relatives fan outward from the center.

### Lineage Tagging
Each root is tagged as `paternal`, `maternal`, or `none`:
- **Paternal:** Reachable from center person's father through recursive ancestor walk
- **Maternal:** Reachable from center person's mother
- Uses DFS through BOTH parents at each level (so grandmother's parents are correctly tagged as paternal)

Roots are sorted: paternal LEFT, maternal RIGHT.

### Center Path
A set of person IDs on the direct path from center to all ancestors. Used by child reordering to determine which child is the "connecting" child at each level. Includes the center person themselves.

## Data Flow

```
collectByDistance() → {personIds, familyIds}
       ↓
findRoots() + tagLineages() + buildCenterPath()
       ↓
measureWidth() for each root → widths Map
       ↓
positionNode() for each root → positions Map
       ↓
React Flow nodes + edges generation
```

## File Structure

- `src/lib/tree-view-layout.ts` - All layout logic (collection, measurement, positioning, React Flow generation)
- `src/app/tree-view/page.tsx` - React page with controls (distance dropdown, search, detail panel)
- `src/components/PersonNode.tsx` - Person card with handles (top, left, right, bottom)
- `src/components/FamilyNode.tsx` - Junction dot with handles (left, right, top = targets; bottom = source)

## React Flow Integration

- **Person nodes:** 4 handles (top target, left/right/bottom sources)
- **Family junction nodes:** 3 target handles (left, right, top) + 1 source (bottom)
- **Spouse edges:** Person right handle → junction left handle (straight lines)
- **Parent-child edges:** Junction bottom handle → child top handle (smoothstep curves)
