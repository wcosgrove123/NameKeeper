import { Person, Family, GedcomData } from './types';
import { parseBirthDate } from './gedcom-parser';

const BLOCK = 40;
const SPOUSE_GAP = 3 * BLOCK;
const SIBLING_GAP = 2 * BLOCK;
const PARENT_CHILD_GAP = 3 * BLOCK;
const NODE_SIZE = BLOCK;

function snapToGrid(val: number): number {
  return Math.round(val / BLOCK) * BLOCK;
}
function snapToHalfGrid(val: number): number {
  return Math.round(val / (BLOCK / 2)) * (BLOCK / 2);
}

// --- Element types ---

export interface PersonTreeNode {
  data: {
    id: string;
    label: string;
    fullName: string;
    surname: string;
    birthDate: string;
    deathDate: string;
    sex: string;
    isLiving: boolean;
    isCenterPerson: boolean;
    nodeType: 'person' | 'family-junction';
  };
}

export interface PersonTreeEdge {
  data: {
    id: string;
    source: string;
    target: string;
    edgeType: 'spouse-to-junction' | 'junction-to-child' | 'spouse';
  };
}

export type PersonTreeElement = PersonTreeNode | PersonTreeEdge;

export interface PersonTreeResult {
  elements: PersonTreeElement[];
  junctionIds: Map<string, string>;
  positions: Record<string, { x: number; y: number }>;
}

// --- Main function ---

export function computePersonTree(
  centerId: string,
  data: GedcomData,
  ancestorDepth: number = 3,
  descendantDepth: number = 3
): PersonTreeResult {
  // Step 1: Find the topmost ancestor by walking up
  const topAncestorId = findTopAncestor(centerId, data, ancestorDepth);

  // Step 2: Determine total depth from top ancestor to deepest descendant
  const centerGenFromTop = countGenerationsUp(centerId, topAncestorId, data);
  const totalDescendantDepth = centerGenFromTop + descendantDepth;

  // Step 3: Extract all persons in range
  const personIds = new Set<string>();
  const familyIds = new Set<string>();
  collectDescendants(topAncestorId, data, totalDescendantDepth, personIds, familyIds, 0);

  // Step 4: Build elements (nodes + edges)
  const elements: PersonTreeElement[] = [];
  const addedNodes = new Set<string>();
  const addedEdges = new Set<string>();
  const junctionIds = new Map<string, string>();

  for (const pid of personIds) {
    if (addedNodes.has(pid)) continue;
    const person = data.persons.get(pid);
    if (!person) continue;
    addedNodes.add(pid);
    elements.push(createPersonNode(person, pid === centerId));
  }

  // Build junction nodes and edges for each family
  for (const famId of familyIds) {
    const family = data.families.get(famId);
    if (!family) continue;

    const husbId = family.husbandId;
    const wifeId = family.wifeId;
    const hasHusb = husbId && personIds.has(husbId);
    const hasWife = wifeId && personIds.has(wifeId);
    const childrenInTree = family.childIds.filter(cid => personIds.has(cid));

    if (!hasHusb && !hasWife) continue;
    if (childrenInTree.length === 0 && !(hasHusb && hasWife)) continue;

    const junctionId = `junction-${famId}`;
    if (!addedNodes.has(junctionId)) {
      addedNodes.add(junctionId);
      junctionIds.set(famId, junctionId);
      elements.push({
        data: {
          id: junctionId, label: '', fullName: '', surname: '', birthDate: '', deathDate: '',
          sex: '', isLiving: false, isCenterPerson: false, nodeType: 'family-junction',
        },
      });

      if (hasHusb) {
        const eid = `stj-${husbId}-${junctionId}`;
        if (!addedEdges.has(eid)) { addedEdges.add(eid); elements.push({ data: { id: eid, source: husbId!, target: junctionId, edgeType: 'spouse-to-junction' } }); }
      }
      if (hasWife) {
        const eid = `stj-${wifeId}-${junctionId}`;
        if (!addedEdges.has(eid)) { addedEdges.add(eid); elements.push({ data: { id: eid, source: wifeId!, target: junctionId, edgeType: 'spouse-to-junction' } }); }
      }
      for (const childId of childrenInTree) {
        const eid = `jtc-${junctionId}-${childId}`;
        if (!addedEdges.has(eid)) { addedEdges.add(eid); elements.push({ data: { id: eid, source: junctionId, target: childId, edgeType: 'junction-to-child' } }); }
      }
    }
  }

  // Step 5: Compute positions using top-down layout (same as NameKeeper)
  const positions: Record<string, { x: number; y: number }> = {};
  const widths = new Map<string, number>();
  const visited = new Set<string>();

  measureWidth(topAncestorId, data, widths, visited, personIds, familyIds);
  visited.clear();
  positionNode(topAncestorId, 0, 0, data, widths, positions, visited, junctionIds, personIds, familyIds);

  return { elements, junctionIds, positions };
}

// --- Helpers ---

function findTopAncestor(personId: string, data: GedcomData, maxDepth: number): string {
  let current = personId;
  let depth = 0;
  while (depth < maxDepth) {
    const person = data.persons.get(current);
    if (!person?.familyAsChild) break;
    const fam = data.families.get(person.familyAsChild);
    if (!fam) break;
    const parentId = fam.husbandId || fam.wifeId;
    if (!parentId || !data.persons.has(parentId)) break;
    current = parentId;
    depth++;
  }
  return current;
}

function countGenerationsUp(fromId: string, toId: string, data: GedcomData): number {
  if (fromId === toId) return 0;
  let current = fromId;
  let count = 0;
  while (current !== toId && count < 20) {
    const person = data.persons.get(current);
    if (!person?.familyAsChild) break;
    const fam = data.families.get(person.familyAsChild);
    if (!fam) break;
    current = fam.husbandId || fam.wifeId || '';
    count++;
  }
  return count;
}

function collectDescendants(
  personId: string, data: GedcomData, maxDepth: number,
  personIds: Set<string>, familyIds: Set<string>, depth: number
): void {
  if (depth > maxDepth) return;
  const person = data.persons.get(personId);
  if (!person) return;
  personIds.add(personId);

  for (const famId of person.familiesAsSpouse) {
    const fam = data.families.get(famId);
    if (!fam) continue;

    // Add this family and spouse
    familyIds.add(famId);
    if (fam.husbandId) personIds.add(fam.husbandId);
    if (fam.wifeId) personIds.add(fam.wifeId);

    // Recurse into children
    for (const childId of fam.childIds) {
      collectDescendants(childId, data, maxDepth, personIds, familyIds, depth + 1);
    }
  }
}

function measureWidth(
  personId: string, data: GedcomData, widths: Map<string, number>,
  visited: Set<string>, personIds: Set<string>, familyIds: Set<string>
): number {
  if (visited.has(personId)) return widths.get(personId) || NODE_SIZE;
  visited.add(personId);

  const person = data.persons.get(personId);
  if (!person || !personIds.has(personId)) { widths.set(personId, NODE_SIZE); return NODE_SIZE; }

  let coupleWidth = NODE_SIZE;
  let primaryFamId: string | null = null;

  for (const famId of person.familiesAsSpouse) {
    if (!familyIds.has(famId)) continue;
    const fam = data.families.get(famId);
    if (!fam) continue;
    // Process from husband's perspective (or wife if no husband)
    const isParent = fam.husbandId === personId || (!fam.husbandId && fam.wifeId === personId);
    if (!isParent) continue;
    primaryFamId = famId;
    const spouseId = fam.husbandId === personId ? fam.wifeId : fam.husbandId;
    if (spouseId && personIds.has(spouseId)) {
      coupleWidth = NODE_SIZE + SPOUSE_GAP + NODE_SIZE;
    }
    break;
  }

  let childrenWidth = 0;
  if (primaryFamId) {
    const fam = data.families.get(primaryFamId);
    if (fam) {
      const children = fam.childIds.filter(cid => personIds.has(cid));
      for (let i = 0; i < children.length; i++) {
        childrenWidth += measureWidth(children[i], data, widths, visited, personIds, familyIds);
        if (i < children.length - 1) childrenWidth += SIBLING_GAP;
      }
    }
  }

  const total = Math.max(coupleWidth, childrenWidth);
  widths.set(personId, total);
  return total;
}

function positionNode(
  personId: string, centerX: number, y: number,
  data: GedcomData, widths: Map<string, number>,
  positions: Record<string, { x: number; y: number }>,
  visited: Set<string>, junctionIds: Map<string, string>,
  personIds: Set<string>, familyIds: Set<string>
): void {
  if (visited.has(personId)) return;
  visited.add(personId);

  const person = data.persons.get(personId);
  if (!person || !personIds.has(personId)) return;

  let primaryFamId: string | null = null;
  let spouseId: string | null = null;

  for (const famId of person.familiesAsSpouse) {
    if (!familyIds.has(famId)) continue;
    const fam = data.families.get(famId);
    if (!fam) continue;
    const isParent = fam.husbandId === personId || (!fam.husbandId && fam.wifeId === personId);
    if (!isParent) continue;
    primaryFamId = famId;
    const sid = fam.husbandId === personId ? fam.wifeId : fam.husbandId;
    spouseId = sid && personIds.has(sid) ? sid : null;
    break;
  }

  if (spouseId) {
    const husbX = centerX;
    const wifeX = centerX + SPOUSE_GAP + NODE_SIZE;
    const juncX = centerX + (SPOUSE_GAP + NODE_SIZE) / 2;

    positions[personId] = { x: snapToGrid(husbX), y: snapToGrid(y) };
    positions[spouseId] = { x: snapToGrid(wifeX), y: snapToGrid(y) };
    visited.add(spouseId);

    const juncId = junctionIds.get(primaryFamId!);
    if (juncId) positions[juncId] = { x: snapToHalfGrid(juncX), y: snapToGrid(y) };
  } else {
    positions[personId] = { x: snapToGrid(centerX), y: snapToGrid(y) };
    if (primaryFamId) {
      const juncId = junctionIds.get(primaryFamId);
      if (juncId) positions[juncId] = { x: snapToGrid(centerX), y: snapToGrid(y) };
    }
  }

  // Position all junction nodes for this person's families
  for (const famId of person.familiesAsSpouse) {
    if (!familyIds.has(famId)) continue;
    const juncId = junctionIds.get(famId);
    if (juncId && !positions[juncId]) {
      positions[juncId] = { x: snapToGrid(centerX), y: snapToGrid(y) };
    }
  }

  // Position children
  if (primaryFamId) {
    const fam = data.families.get(primaryFamId);
    if (fam) {
      const children = fam.childIds.filter(cid => personIds.has(cid));
      if (children.length === 0) return;

      const childY = y + PARENT_CHILD_GAP;
      const juncId = junctionIds.get(primaryFamId);
      const juncX = juncId && positions[juncId] ? positions[juncId].x : positions[personId]?.x || centerX;

      if (children.length === 1) {
        positionNode(children[0], juncX, childY, data, widths, positions, visited, junctionIds, personIds, familyIds);
      } else {
        const childWidths = children.map(cid => widths.get(cid) || NODE_SIZE);

        // Track all keys added during children positioning for Phase 2 centering
        const posKeysBefore = new Set(Object.keys(positions));

        // Phase 1: position children sequentially from x=0
        let currentX = 0;
        for (let i = 0; i < children.length; i++) {
          const childCenterX = currentX + childWidths[i] / 2;

          // Snapshot keys before this child's subtree
          const keysBeforeChild = new Set(Object.keys(positions));

          positionNode(children[i], childCenterX, childY, data, widths, positions, visited, junctionIds, personIds, familyIds);

          // Find actual rightmost and leftmost extent of this child's subtree
          let rightEdge = -Infinity;
          let leftEdge = Infinity;
          for (const key of Object.keys(positions)) {
            if (!keysBeforeChild.has(key)) {
              rightEdge = Math.max(rightEdge, positions[key].x + NODE_SIZE / 2);
              leftEdge = Math.min(leftEdge, positions[key].x - NODE_SIZE / 2);
            }
          }
          if (rightEdge === -Infinity) {
            rightEdge = childCenterX + NODE_SIZE / 2;
          }

          // Shift subtree right if it overflows left into previous sibling
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

        // Phase 2: shift all children to center under junction
        const newKeys = Object.keys(positions).filter(k => !posKeysBefore.has(k));
        if (newKeys.length > 0) {
          let minX = Infinity, maxX = -Infinity;
          for (const key of newKeys) {
            minX = Math.min(minX, positions[key].x);
            maxX = Math.max(maxX, positions[key].x);
          }
          const actualCenter = (minX + maxX) / 2;
          // Snap offset to grid so children stay on grid points after shift
          const offset = snapToGrid(juncX - actualCenter);
          for (const key of newKeys) {
            positions[key].x += offset;
          }
        }
      }
    }
  }
}

function createPersonNode(person: Person, isCenter: boolean): PersonTreeNode {
  const displayName = person.nickname
    ? `${person.nickname} ${person.surname}`
    : `${person.givenName.split(' ')[0]} ${person.surname}`;
  const years = [
    person.birthDate ? parseDateYear(person.birthDate) : '?',
    person.isLiving ? '' : (person.deathDate ? parseDateYear(person.deathDate) : '?'),
  ].filter(Boolean).join('-');

  return {
    data: {
      id: person.id,
      label: `${displayName}\n${years}`,
      fullName: `${person.givenName} ${person.surname}`,
      surname: person.surname,
      birthDate: person.birthDate || '',
      deathDate: person.deathDate || '',
      sex: person.sex,
      isLiving: person.isLiving,
      isCenterPerson: isCenter,
      nodeType: 'person',
    },
  };
}

function parseDateYear(dateStr: string): string {
  const match = dateStr.match(/(\d{4})/);
  return match ? match[1] : '?';
}
