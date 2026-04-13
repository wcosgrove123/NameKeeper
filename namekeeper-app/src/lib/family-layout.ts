import { GedcomData } from './types';
import { getSons, getChildren, parseBirthDate } from './gedcom-parser';

const BLOCK = 40; // one grid block in pixels
const PARENT_CHILD_GAP = 2 * BLOCK; // 2 blocks between parent and child rows
const SIBLING_GAP = 2 * BLOCK;  // 2 blocks between siblings (base gap)
const NODE_SIZE = BLOCK;         // node is 1 block wide

/**
 * Dynamic spouse gap based on child count parity.
 * Even children (0, 2, 4): 2 blocks — junction at 1.5 blocks (between grid points)
 * Odd children (1, 3, 5): 3 blocks — junction at 2 blocks (on grid point)
 * This ensures children always snap to grid correctly.
 */
function getSpouseGap(childCount: number): number {
  return (childCount % 2 === 1) ? 3 * BLOCK : 2 * BLOCK;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number; // total horizontal space this subtree needs
}

/**
 * Compute positions for all nodes in a patrilineal tree.
 * Uses rule-based spacing: 3 blocks between spouses, 2 blocks parent-child,
 * 1 block between siblings (expanding for their own families).
 *
 * Returns a map of nodeId -> {x, y} positions.
 */
export function computeFamilyLayout(
  patriarchId: string,
  data: GedcomData,
  patriarchSurname: string,
  junctionIds: Map<string, string>, // familyId -> junctionNodeId
  successionIds?: Set<string> // IDs on the golden succession line
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const visited = new Set<string>();

  // Phase 1: Measure widths bottom-up
  const widths = new Map<string, number>();
  measureWidth(patriarchId, data, patriarchSurname, widths, visited, junctionIds);
  visited.clear();

  // Phase 2: Position top-down starting from patriarch at (0, 0)
  positionNode(patriarchId, 0, 0, data, patriarchSurname, widths, positions, visited, junctionIds, successionIds);

  return positions;
}

/**
 * Measure the total horizontal width a person's subtree needs.
 * Width = max(own couple width, sum of children's widths + gaps)
 */
function measureWidth(
  personId: string,
  data: GedcomData,
  surname: string,
  widths: Map<string, number>,
  visited: Set<string>,
  junctionIds: Map<string, string>
): number {
  if (visited.has(personId)) return widths.get(personId) || NODE_SIZE;
  visited.add(personId);

  const person = data.persons.get(personId);
  if (!person) { widths.set(personId, NODE_SIZE); return NODE_SIZE; }

  // Collect ALL families where this person is the husband
  let coupleWidth = NODE_SIZE;
  const parentFamIds: string[] = [];
  let spouseCount = 0;

  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family || family.husbandId !== personId) continue;
    // Skip empty families (no wife AND no children)
    if (!family.wifeId && family.childIds.length === 0) continue;
    parentFamIds.push(famId);
    if (family.wifeId) spouseCount++;
  }

  // Collect children from ALL families first (need count for spouse gap)
  const allChildren: import('./types').Person[] = [];
  for (const famId of parentFamIds) {
    const family = data.families.get(famId);
    if (!family) continue;
    for (const cid of family.childIds) {
      const child = data.persons.get(cid);
      if (child && !allChildren.some(c => c.id === child.id)) {
        allChildren.push(child);
      }
    }
  }

  // Dynamic spouse gap: even children = 2 blocks, odd = 3 blocks
  const spouseGap = getSpouseGap(allChildren.length);

  if (spouseCount >= 2) {
    coupleWidth = NODE_SIZE + spouseCount * (spouseGap + NODE_SIZE);
  } else if (spouseCount === 1) {
    coupleWidth = NODE_SIZE + spouseGap + NODE_SIZE;
  }

  // Children's total width
  let childrenWidth = 0;

  // Sort by birth date
  allChildren.sort((a, b) => {
    const da = parseBirthDate(a.birthDate || '');
    const db = parseBirthDate(b.birthDate || '');
    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1;
    if (db) return 1;
    return 0;
  });

  for (let i = 0; i < allChildren.length; i++) {
    const child = allChildren[i];
    if (child.sex === 'M' && child.surname === surname) {
      const childWidth = measureWidth(child.id, data, surname, widths, visited, junctionIds);
      childrenWidth += childWidth;
    } else {
      childrenWidth += NODE_SIZE;
    }
    if (i < allChildren.length - 1) {
      childrenWidth += SIBLING_GAP;
      // Extra padding after married surname sons — based on actual wife overshoot
      if (child.sex === 'M' && child.surname === surname) {
        const thisWidth = widths.get(child.id) || NODE_SIZE;
        let maxWifeExtent = 0;
        for (const fid of child.familiesAsSpouse) {
          const f = data.families.get(fid);
          if (f && f.husbandId === child.id && f.wifeId) {
            const childChildCount = f.childIds.length;
            const sg = getSpouseGap(childChildCount);
            // Wife extends sg + NODE_SIZE right of husband center; right edge = sg + 1.5*NODE_SIZE
            maxWifeExtent = Math.max(maxWifeExtent, sg + NODE_SIZE + NODE_SIZE / 2);
          }
        }
        if (maxWifeExtent > 0) {
          const overshoot = maxWifeExtent - thisWidth / 2;
          if (overshoot > 0) childrenWidth += overshoot;
        }
      }
    }
  }

  const totalWidth = Math.max(coupleWidth, childrenWidth);
  widths.set(personId, totalWidth);
  return totalWidth;
}

/**
 * Position a person and their family recursively.
 * x is the CENTER x of this person's allocated space.
 */
function positionNode(
  personId: string,
  centerX: number,
  y: number,
  data: GedcomData,
  surname: string,
  widths: Map<string, number>,
  positions: Record<string, { x: number; y: number }>,
  visited: Set<string>,
  junctionIds: Map<string, string>,
  successionIds?: Set<string>
): void {
  if (visited.has(personId)) return;
  visited.add(personId);

  const person = data.persons.get(personId);
  if (!person) return;

  // Collect ALL families where this person is the husband
  const allFamIds: string[] = [];
  let primaryFamId: string | null = null;
  let wifeId: string | null = null;
  let actualSpouseCount = 0;

  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family || family.husbandId !== personId) continue;
    // Skip empty families (no wife AND no children) — they shouldn't affect layout
    if (!family.wifeId && family.childIds.length === 0) continue;
    allFamIds.push(famId);
    if (family.wifeId) actualSpouseCount++;
    if (!primaryFamId) {
      primaryFamId = famId;
      wifeId = family.wifeId || null;
    }
    // Default junction positions (overwritten below once we know the gap)
    const jId = junctionIds.get(famId);
    if (jId && !positions[jId]) {
      positions[jId] = { x: snapToGrid(centerX), y: snapToGrid(y) };
    }
  }

  // Collect children from ALL families FIRST (need count for spouse gap)
  const allChildren: import('./types').Person[] = [];
  for (const famId of allFamIds) {
    const family = data.families.get(famId);
    if (!family) continue;
    for (const cid of family.childIds) {
      const child = data.persons.get(cid);
      if (child && !allChildren.some(c => c.id === child.id)) {
        allChildren.push(child);
      }
    }
  }

  // Dynamic spouse gap: even children = 2 blocks, odd = 3 blocks
  const spouseGap = getSpouseGap(allChildren.length);

  if (actualSpouseCount >= 2) {
    // Multiple wives: wife1 LEFT, husband CENTER, wife2 RIGHT
    positions[personId] = { x: snapToGrid(centerX), y: snapToGrid(y) };

    const fam1 = data.families.get(allFamIds[0]);
    if (fam1?.wifeId) {
      positions[fam1.wifeId] = { x: snapToGrid(centerX - spouseGap - NODE_SIZE), y: snapToGrid(y) };
      const j1 = junctionIds.get(allFamIds[0]);
      if (j1) positions[j1] = { x: snapToGrid(centerX - (spouseGap + NODE_SIZE) / 2), y: snapToGrid(y) };
    }

    let rightX = centerX + spouseGap + NODE_SIZE;
    for (let fi = 1; fi < allFamIds.length; fi++) {
      const fam = data.families.get(allFamIds[fi]);
      if (fam?.wifeId && !positions[fam.wifeId]) {
        positions[fam.wifeId] = { x: snapToGrid(rightX), y: snapToGrid(y) };
        const jX = centerX + (rightX - centerX) / 2;
        const jId = junctionIds.get(allFamIds[fi]);
        if (jId) positions[jId] = { x: snapToGrid(jX), y: snapToGrid(y) };
        rightX += spouseGap + NODE_SIZE;
      }
    }
  } else if (wifeId) {
    // Single wife: husband at centerX, wife to the right
    // Junction at exact midpoint of SNAPPED positions (not raw centerX)
    const husbSnapped = snapToGrid(centerX);
    const wifeSnapped = snapToGrid(centerX + spouseGap + NODE_SIZE);
    positions[personId] = { x: husbSnapped, y: snapToGrid(y) };
    positions[wifeId] = { x: wifeSnapped, y: snapToGrid(y) };
    const junctionId = junctionIds.get(primaryFamId!);
    if (junctionId) {
      positions[junctionId] = { x: (husbSnapped + wifeSnapped) / 2, y: snapToGrid(y) };
    }
  } else {
    // No spouse
    positions[personId] = { x: snapToGrid(centerX), y: snapToGrid(y) };
    const junctionId = primaryFamId ? junctionIds.get(primaryFamId) : null;
    if (junctionId) {
      positions[junctionId] = { x: snapToGrid(centerX), y: snapToGrid(y) };
    }
  }

  // Position children
  if (allFamIds.length > 0) {

    if (allChildren.length > 0) {
      const childY = y + 3 * BLOCK;

      // Sort by birth date
      allChildren.sort((a, b) => {
        const da = parseBirthDate(a.birthDate || '');
        const db = parseBirthDate(b.birthDate || '');
        if (da && db) return da.getTime() - db.getTime();
        if (da) return -1;
        if (db) return 1;
        return 0;
      });

      // Get junction position for centering
      const junctionId = primaryFamId ? junctionIds.get(primaryFamId) : null;
      const junctionX = junctionId && positions[junctionId]
        ? positions[junctionId].x
        : positions[personId]?.x || centerX;

      if (allChildren.length === 1) {
        // Single child: place directly below junction (straight line down)
        const child = allChildren[0];
        if (child.sex === 'M' && child.surname === surname) {
          positionNode(child.id, junctionX, childY, data, surname, widths, positions, visited, junctionIds, successionIds);
        } else {
          positions[child.id] = { x: snapToGrid(junctionX), y: snapToGrid(childY) };
        }
      } else {
        // Multiple children: position from x=0, then shift to center under junction
        const childWidths: number[] = allChildren.map(child => {
          if (child.sex === 'M' && child.surname === surname) {
            return widths.get(child.id) || NODE_SIZE;
          }
          return NODE_SIZE;
        });

        // Track which position keys are added during children positioning
        const posKeysBefore = new Set(Object.keys(positions));

        // Phase 1: position children sequentially from x=0
        let currentX = 0;
        for (let i = 0; i < allChildren.length; i++) {
          const child = allChildren[i];
          const childWidth = childWidths[i];
          const childCenterX = currentX + childWidth / 2;

          // Snapshot keys before positioning this child's subtree
          const keysBeforeChild = new Set(Object.keys(positions));

          if (child.sex === 'M' && child.surname === surname) {
            positionNode(child.id, childCenterX, childY, data, surname, widths, positions, visited, junctionIds, successionIds);
          } else {
            positions[child.id] = { x: snapToGrid(childCenterX), y: snapToGrid(childY) };
          }

          // Find the actual rightmost AND leftmost extent of this child's
          // entire subtree (grandchildren, great-grandchildren, their wives, etc.)
          let rightEdge = -Infinity;
          let leftEdge = Infinity;
          for (const key of Object.keys(positions)) {
            if (!keysBeforeChild.has(key)) {
              rightEdge = Math.max(rightEdge, positions[key].x + NODE_SIZE / 2);
              leftEdge = Math.min(leftEdge, positions[key].x - NODE_SIZE / 2);
            }
          }
          if (rightEdge === -Infinity) {
            rightEdge = (positions[child.id]?.x ?? childCenterX) + NODE_SIZE / 2;
          }

          // If the subtree extends left of currentX, shift the entire
          // subtree right so it doesn't overlap with the previous sibling
          if (leftEdge !== Infinity && leftEdge < currentX && i > 0) {
            const shift = currentX - leftEdge;
            for (const key of Object.keys(positions)) {
              if (!keysBeforeChild.has(key)) {
                positions[key].x += shift;
              }
            }
            rightEdge += shift;
          }

          currentX = rightEdge + SIBLING_GAP;
        }

        // Phase 2: find actual span and shift to center under junction
        const newKeys = Object.keys(positions).filter(k => !posKeysBefore.has(k));
        if (newKeys.length > 0) {
          let minX = Infinity, maxX = -Infinity;
          for (const key of newKeys) {
            minX = Math.min(minX, positions[key].x);
            maxX = Math.max(maxX, positions[key].x);
          }
          const actualCenter = (minX + maxX) / 2;
          // Snap offset to grid so children stay on grid points after shift
          const offset = snapToGrid(junctionX - actualCenter);
          for (const key of newKeys) {
            positions[key].x += offset;
          }
        }
      }
    }
  }
}

function snapToGrid(val: number): number {
  return Math.round(val / BLOCK) * BLOCK;
}

function snapToHalfGrid(val: number): number {
  const half = BLOCK / 2;
  return Math.round(val / half) * half;
}
