/**
 * Tree View layout for React Flow.
 *
 * 4-row layout centered on a person:
 *   Row GP:  Paternal grandparents (LEFT)     Maternal grandparents (RIGHT)
 *   Row P:   Father's siblings → FATHER   +   MOTHER ← Mother's siblings
 *   Row S:   Center person + spouse, first cousins
 *   Row C:   Center person's children, cousins' children
 *
 * Father is rightmost in his sibling group, Mother is leftmost in hers.
 * They meet in the middle to form the center couple.
 */

import { type Node, type Edge } from '@xyflow/react';
import { GedcomData } from './types';
import { parseBirthDate } from './gedcom-parser';
import { calculateRelationship } from './relationship-calculator';
import type { PersonNodeData } from '@/components/PersonNode';
import type { FamilyNodeData } from '@/components/FamilyNode';

// ── Grid constants ───────────────────────────────────────────────────

const BLOCK = 40;
const NODE_WIDTH = 200;     // 5 blocks
const NODE_HEIGHT = 80;     // 2 blocks
const SIBLING_GAP = 40;     // 1 block
const PARENT_CHILD_GAP = 80; // 2 blocks
const JUNCTION_SIZE = 8;
const SPOUSE_GAP = 40;      // 1 block
const ROW_HEIGHT = NODE_HEIGHT + PARENT_CHILD_GAP; // 160px per generation

function snapToGrid(val: number): number {
  return Math.round(val / BLOCK) * BLOCK;
}

// ── Public interface ─────────────────────────────────────────────────

interface TreeViewOptions {
  centerPersonId: string;
  distance: number;
  expandedNodes: Set<string>;
  expandedSpouseFamilies: Set<string>;
  selectedPersonId?: string;
}

interface TreeViewResult { nodes: Node[]; edges: Edge[] }

// ── Helpers ──────────────────────────────────────────────────────────

function countAncestors(pid: string, data: GedcomData, v: Set<string>): number {
  if (v.has(pid)) return 0; v.add(pid);
  const p = data.persons.get(pid); if (!p?.familyAsChild) return 0;
  const f = data.families.get(p.familyAsChild); if (!f) return 0;
  let c = 0;
  for (const id of [f.husbandId, f.wifeId]) { if (id && data.persons.has(id)) c += 1 + countAncestors(id, data, v); }
  return c;
}

function countDescendants(pid: string, data: GedcomData, v: Set<string>): number {
  if (v.has(pid)) return 0; v.add(pid);
  const p = data.persons.get(pid); if (!p) return 0;
  let c = 0;
  for (const fid of p.familiesAsSpouse) {
    const f = data.families.get(fid); if (!f) continue;
    for (const cid of f.childIds) { if (!v.has(cid)) c += 1 + countDescendants(cid, data, v); }
  }
  return c;
}

/**
 * Compute relationship levels radiating from center person.
 * Level 0: direct line (ancestors, descendants, spouse, siblings)
 * Level 1: siblings' spouses + siblings' descendants
 * Level 2: parent's siblings (uncles/aunts)
 * Level 3: uncle/aunt's spouses
 * Level 4: grandparent's siblings (great-uncles)
 * Level 5: great-uncle's spouses
 * Pattern: sibling at gen G → level G*2, their family → level G*2+1
 */
function computeRelationLevels(
  centerId: string, data: GedcomData, personIds: Set<string>,
): Map<string, number> {
  const levels = new Map<string, number>();

  // Mark all descendants of a person at a given level
  function markDescendants(pid: string, level: number, visited: Set<string>) {
    if (visited.has(pid)) return;
    visited.add(pid);
    const p = data.persons.get(pid);
    if (!p) return;
    for (const fid of p.familiesAsSpouse) {
      const f = data.families.get(fid);
      if (!f) continue;
      // Spouse
      const sp = f.husbandId === pid ? f.wifeId : f.husbandId;
      if (sp && personIds.has(sp) && !levels.has(sp)) levels.set(sp, level);
      // Children + their descendants
      for (const cid of f.childIds) {
        if (personIds.has(cid) && !levels.has(cid)) {
          levels.set(cid, level);
          markDescendants(cid, level, visited);
        }
      }
    }
  }

  // Level 0: center person
  levels.set(centerId, 0);

  // Level 0: center person's spouse
  const cp = data.persons.get(centerId);
  if (cp) {
    for (const fid of cp.familiesAsSpouse) {
      const f = data.families.get(fid);
      if (!f) continue;
      const sp = f.husbandId === centerId ? f.wifeId : f.husbandId;
      if (sp && personIds.has(sp)) levels.set(sp, 0);
    }
  }

  // Level 0: center person's direct descendants
  markDescendants(centerId, 0, new Set());

  // Walk up through ancestors
  // At each generation, mark siblings and their families
  const directLine = new Set<string>([centerId]);

  function walkUp(personId: string, generation: number) {
    const person = data.persons.get(personId);
    if (!person?.familyAsChild) return;
    const fam = data.families.get(person.familyAsChild);
    if (!fam) return;

    // Both parents are on the direct line (level 0)
    const parents = [fam.husbandId, fam.wifeId].filter((id): id is string =>
      !!id && personIds.has(id));

    for (const parentId of parents) {
      if (!levels.has(parentId)) levels.set(parentId, 0);
      directLine.add(parentId);
    }

    // Siblings at this generation
    const siblingLevel = generation * 2;
    const familyLevel = siblingLevel + 1;

    for (const sibId of fam.childIds) {
      if (!personIds.has(sibId)) continue;
      if (directLine.has(sibId)) continue; // skip the direct-line person
      if (sibId === personId) continue;

      // The sibling
      if (!levels.has(sibId)) levels.set(sibId, siblingLevel);

      // Sibling's spouse + children + descendants
      const sib = data.persons.get(sibId);
      if (sib) {
        for (const sfId of sib.familiesAsSpouse) {
          const sf = data.families.get(sfId);
          if (!sf) continue;
          const spId = sf.husbandId === sibId ? sf.wifeId : sf.husbandId;
          if (spId && personIds.has(spId) && !levels.has(spId)) {
            levels.set(spId, familyLevel);
          }
          for (const cid of sf.childIds) {
            if (personIds.has(cid) && !levels.has(cid)) {
              levels.set(cid, familyLevel);
              markDescendants(cid, familyLevel, new Set());
            }
          }
        }
      }
    }

    // Recurse up through both parents
    for (const parentId of parents) {
      walkUp(parentId, generation + 1);
    }
  }

  walkUp(centerId, 0);

  // Any person not assigned gets max level
  for (const pid of personIds) {
    if (!levels.has(pid)) levels.set(pid, 6);
  }

  return levels;
}

function sortByBirth(ids: string[], data: GedcomData): string[] {
  return [...ids].sort((a, b) => {
    const da = parseBirthDate(data.persons.get(a)?.birthDate || '');
    const db = parseBirthDate(data.persons.get(b)?.birthDate || '');
    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1; if (db) return 1; return 0;
  });
}

/** Build a sibling unit: person + spouse + children + measured width */
interface SibUnit {
  leftId: string;       // male (or person if no spouse)
  rightId: string | null; // female (or null)
  familyId: string | null;
  children: string[];
  width: number;
}

/** Recursively measure how wide a person's subtree needs to be.
 *  maxDepth limits how deep to recurse (prevents over-measuring ancestors' descendants). */
function measurePersonWidth(
  personId: string, data: GedcomData,
  personIds: Set<string>, familyIds: Set<string>,
  measured: Map<string, number>,
  maxDepth: number = 4,
): number {
  const key = `${personId}:${maxDepth}`;
  if (measured.has(key)) return measured.get(key)!;

  const person = data.persons.get(personId);
  if (!person || maxDepth <= 0) { measured.set(key, NODE_WIDTH); return NODE_WIDTH; }

  // Find conjugal family
  let spouseId: string | null = null;
  let children: string[] = [];
  for (const fid of person.familiesAsSpouse) {
    if (!familyIds.has(fid)) continue;
    const fam = data.families.get(fid);
    if (!fam || (fam.husbandId !== personId && fam.wifeId !== personId)) continue;
    const sid = fam.husbandId === personId ? fam.wifeId : fam.husbandId;
    spouseId = sid && personIds.has(sid) ? sid : null;
    children = fam.childIds.filter(c => personIds.has(c));
    break;
  }

  const coupleW = spouseId ? NODE_WIDTH + SPOUSE_GAP + NODE_WIDTH : NODE_WIDTH;

  // Recursively measure children (decrement depth)
  let childW = 0;
  for (let i = 0; i < children.length; i++) {
    if (i > 0) childW += SIBLING_GAP;
    childW += measurePersonWidth(children[i], data, personIds, familyIds, measured, maxDepth - 1);
  }

  const width = Math.max(coupleW, childW);
  measured.set(key, width);
  return width;
}

function buildSibUnit(
  personId: string, data: GedcomData,
  personIds: Set<string>, familyIds: Set<string>,
  measured: Map<string, number>,
): SibUnit {
  const person = data.persons.get(personId)!;
  let spouseId: string | null = null;
  let familyId: string | null = null;
  let children: string[] = [];

  for (const fid of person.familiesAsSpouse) {
    if (!familyIds.has(fid)) continue;
    const fam = data.families.get(fid);
    if (!fam) continue;
    if (fam.husbandId !== personId && fam.wifeId !== personId) continue;
    familyId = fid;
    const sid = fam.husbandId === personId ? fam.wifeId : fam.husbandId;
    spouseId = sid && personIds.has(sid) ? sid : null;
    children = fam.childIds.filter(c => personIds.has(c));
    break;
  }

  // Male on left, female on right
  let leftId = personId;
  let rightId = spouseId;
  if (spouseId && person.sex === 'F') {
    const sp = data.persons.get(spouseId);
    if (sp && sp.sex === 'M') { leftId = spouseId; rightId = personId; }
  }

  const width = measurePersonWidth(personId, data, personIds, familyIds, measured);

  return { leftId, rightId, familyId, children, width };
}

/** Position a row of sibling units. Returns the total extent [minX, maxX].
 *  Couples are offset within their allocated width (leftOverflow) so the
 *  junction stays centered above their children's subtree. */
function positionSibRow(
  units: SibUnit[], startX: number, y: number,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
): { minX: number; maxX: number } {
  let x = startX;
  let minX = Infinity, maxX = -Infinity;

  for (const unit of units) {
    const coupleW = unit.rightId ? NODE_WIDTH + SPOUSE_GAP + NODE_WIDTH : NODE_WIDTH;
    let leftOverflow = 0;
    if (units.length > 1) {
      const junctionCenter = coupleW / 2;
      const childrenW = unit.width;
      leftOverflow = Math.max(0, childrenW / 2 - junctionCenter);
    }
    const leftX = snapToGrid(x + leftOverflow);
    positions.set(unit.leftId, { x: leftX, y: snapToGrid(y) });

    let juncX = leftX + (NODE_WIDTH - JUNCTION_SIZE) / 2;
    const juncY = snapToGrid(y) + (NODE_HEIGHT - JUNCTION_SIZE) / 2;

    if (unit.rightId && unit.familyId) {
      const rightX = snapToGrid(leftX + NODE_WIDTH + SPOUSE_GAP);
      positions.set(unit.rightId, { x: rightX, y: snapToGrid(y) });
      juncX = leftX + NODE_WIDTH + (rightX - leftX - NODE_WIDTH - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(unit.familyId);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
      minX = Math.min(minX, leftX);
      maxX = Math.max(maxX, rightX + NODE_WIDTH);
    } else {
      if (unit.familyId) {
        const jId = junctionMap.get(unit.familyId);
        if (jId) positions.set(jId, { x: juncX, y: snapToGrid(y) + NODE_HEIGHT });
      }
      minX = Math.min(minX, leftX);
      maxX = Math.max(maxX, leftX + NODE_WIDTH);
    }

    x += unit.width + SIBLING_GAP;
  }

  return { minX, maxX };
}

/** Position children centered under their parent junction, using measured widths */
function positionChildRow(
  unit: SibUnit, childY: number,
  data: GedcomData,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
  personIds: Set<string>,
  familyIds: Set<string>,
  measured: Map<string, number>,
) {
  if (unit.children.length === 0 || !unit.familyId) return;
  const jId = junctionMap.get(unit.familyId);
  const jPos = jId ? positions.get(jId) : null;
  if (!jPos) return;

  const sorted = sortByBirth(unit.children, data);
  // Use recursive measured widths for each child
  const childWidths = sorted.map(cid => measurePersonWidth(cid, data, personIds, familyIds, measured));
  const totalW = childWidths.reduce((s, w) => s + w, 0) + Math.max(0, sorted.length - 1) * SIBLING_GAP;
  const jCenterX = jPos.x + JUNCTION_SIZE / 2;
  let cx = snapToGrid(jCenterX - totalW / 2);

  for (let i = 0; i < sorted.length; i++) {
    const cid = sorted[i];
    if (!positions.has(cid)) {
      positions.set(cid, { x: cx, y: snapToGrid(childY) });
      personIds.add(cid);
    }
    cx += childWidths[i] + SIBLING_GAP;
  }
}

/** Position a couple centered at centerX, return junction X */
function positionCouple(
  husbId: string | null, wifeId: string | null,
  familyId: string, centerX: number, y: number,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
): number {
  const coupleW = (husbId && wifeId) ? NODE_WIDTH + SPOUSE_GAP + NODE_WIDTH : NODE_WIDTH;
  const leftX = snapToGrid(centerX - coupleW / 2);
  const snY = snapToGrid(y);

  if (husbId) positions.set(husbId, { x: leftX, y: snY });
  if (wifeId && husbId) {
    const rightX = snapToGrid(leftX + NODE_WIDTH + SPOUSE_GAP);
    positions.set(wifeId, { x: rightX, y: snY });
    const juncX = leftX + NODE_WIDTH + (rightX - leftX - NODE_WIDTH - JUNCTION_SIZE) / 2;
    const juncY = snY + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
    const jId = junctionMap.get(familyId);
    if (jId) positions.set(jId, { x: juncX, y: juncY });
    return juncX;
  } else if (wifeId) {
    positions.set(wifeId, { x: leftX, y: snY });
  }
  const jId = junctionMap.get(familyId);
  const juncX = leftX + (NODE_WIDTH - JUNCTION_SIZE) / 2;
  if (jId) positions.set(jId, { x: juncX, y: snY + (NODE_HEIGHT - JUNCTION_SIZE) / 2 });
  return juncX;
}

// ── Main ─────────────────────────────────────────────────────────────

export function buildTreeView(data: GedcomData, options: TreeViewOptions): TreeViewResult {
  const { centerPersonId, selectedPersonId } = options;
  const centerPerson = data.persons.get(centerPersonId);
  if (!centerPerson) return { nodes: [], edges: [] };

  const positions = new Map<string, { x: number; y: number }>();
  const measured = new Map<string, number>(); // recursive width cache
  const personIds = new Set<string>();
  const familyIds = new Set<string>();
  const junctionMap = new Map<string, string>();

  function addFamily(famId: string) {
    familyIds.add(famId);
    junctionMap.set(famId, `junc-${famId}`);
  }

  // ── Collect everyone ────────────────────────────────────────────

  personIds.add(centerPersonId);

  // Center person's spouse + children
  for (const fid of centerPerson.familiesAsSpouse) {
    const fam = data.families.get(fid);
    if (!fam || (fam.husbandId !== centerPersonId && fam.wifeId !== centerPersonId)) continue;
    addFamily(fid);
    const sid = fam.husbandId === centerPersonId ? fam.wifeId : fam.husbandId;
    if (sid) personIds.add(sid);
    for (const cid of fam.childIds) personIds.add(cid);
  }

  // Parents
  const birthFam = centerPerson.familyAsChild ? data.families.get(centerPerson.familyAsChild) : null;
  const fatherId = birthFam?.husbandId || null;
  const motherId = birthFam?.wifeId || null;
  if (birthFam) {
    addFamily(birthFam.id);
    if (fatherId) personIds.add(fatherId);
    if (motherId) personIds.add(motherId);
    for (const cid of birthFam.childIds) personIds.add(cid);
  }

  // Collect a person's spouse + children + grandchildren families
  function collectPersonFamily(pid: string, depth: number) {
    if (depth > 3) return; // safety limit
    const p = data.persons.get(pid);
    if (!p) return;
    for (const fid of p.familiesAsSpouse) {
      const fm = data.families.get(fid);
      if (!fm) continue;
      if (fm.husbandId !== pid && fm.wifeId !== pid) continue;
      addFamily(fid);
      const sp = fm.husbandId === pid ? fm.wifeId : fm.husbandId;
      if (sp) personIds.add(sp);
      for (const kidId of fm.childIds) {
        personIds.add(kidId);
        collectPersonFamily(kidId, depth + 1);
      }
    }
  }

  // Collect siblings' families (uncles/aunts from BOTH sides + all descendants)
  function collectSiblingFamilies(parentId: string | null) {
    if (!parentId) return;
    const parent = data.persons.get(parentId);
    if (!parent?.familyAsChild) return;
    const gpFam = data.families.get(parent.familyAsChild);
    if (!gpFam) return;

    // Grandparent family
    addFamily(gpFam.id);
    if (gpFam.husbandId) personIds.add(gpFam.husbandId);
    if (gpFam.wifeId) personIds.add(gpFam.wifeId);

    // All children of grandparents + their full descendant trees
    for (const sibId of gpFam.childIds) {
      personIds.add(sibId);
      collectPersonFamily(sibId, 0);
    }
  }

  collectSiblingFamilies(fatherId);
  collectSiblingFamilies(motherId);

  // ── Y positions ─────────────────────────────────────────────────

  const hasGrandparents = (fatherId && data.persons.get(fatherId)?.familyAsChild) ||
                          (motherId && data.persons.get(motherId)?.familyAsChild);
  const hasParents = fatherId || motherId;

  let rowGP = 0;
  let rowP = hasGrandparents ? ROW_HEIGHT : 0;
  let rowS = rowP + (hasParents ? ROW_HEIGHT : 0);
  let rowC = rowS + ROW_HEIGHT;

  // ── Build sibling groups ────────────────────────────────────────

  // Father's sibling group (if father exists)
  const fatherGpFam = fatherId ? (() => {
    const f = data.persons.get(fatherId);
    return f?.familyAsChild ? data.families.get(f.familyAsChild) : null;
  })() : null;

  const motherGpFam = motherId ? (() => {
    const m = data.persons.get(motherId);
    return m?.familyAsChild ? data.families.get(m.familyAsChild) : null;
  })() : null;

  // Paternal siblings: sorted by birth, father pushed to RIGHT
  let paternalUnits: SibUnit[] = [];
  if (fatherGpFam) {
    const patSibs = sortByBirth(fatherGpFam.childIds.filter(c => personIds.has(c)), data);
    // Move father to the end (rightmost)
    const fIdx = patSibs.indexOf(fatherId!);
    if (fIdx >= 0) { patSibs.splice(fIdx, 1); patSibs.push(fatherId!); }
    paternalUnits = patSibs.map(id => buildSibUnit(id, data, personIds, familyIds, measured));
  }

  // Maternal siblings: sorted by birth, mother pushed to LEFT
  let maternalUnits: SibUnit[] = [];
  if (motherGpFam) {
    const matSibs = sortByBirth(motherGpFam.childIds.filter(c => personIds.has(c)), data);
    const mIdx = matSibs.indexOf(motherId!);
    if (mIdx >= 0) { matSibs.splice(mIdx, 1); matSibs.unshift(motherId!); }
    maternalUnits = matSibs.map(id => buildSibUnit(id, data, personIds, familyIds, measured));
  }

  // If no grandparents, fall back to the simple layout (center person's siblings)
  let centerUnits: SibUnit[] = [];
  if (!fatherGpFam && !motherGpFam && birthFam) {
    const sibs = sortByBirth(birthFam.childIds.filter(c => personIds.has(c)), data);
    centerUnits = sibs.map(id => buildSibUnit(id, data, personIds, familyIds, measured));
  } else if (!birthFam) {
    centerUnits = [buildSibUnit(centerPersonId, data, personIds, familyIds, measured)];
  }

  // ── Position Row P: Parents + uncles/aunts ──────────────────────

  if (paternalUnits.length > 0 || maternalUnits.length > 0) {
    // Calculate widths
    const patTotalW = paternalUnits.reduce((s, u) => s + u.width, 0)
      + Math.max(0, paternalUnits.length - 1) * SIBLING_GAP;
    const matTotalW = maternalUnits.reduce((s, u) => s + u.width, 0)
      + Math.max(0, maternalUnits.length - 1) * SIBLING_GAP;

    // Position paternal group: ends at x=0 (father on the right edge)
    // Father couple ends at x=-SPOUSE_GAP/2 (half the gap between the two groups)
    const gapBetween = SIBLING_GAP; // gap between paternal and maternal groups
    const patStartX = -gapBetween / 2 - patTotalW;
    positionSibRow(paternalUnits, patStartX, rowP, positions, junctionMap);

    // Position maternal group: starts at x=0
    const matStartX = gapBetween / 2;
    positionSibRow(maternalUnits, matStartX, rowP, positions, junctionMap);

    // Now we need the father-mother COUPLE junction (birth family junction)
    // Father and mother are already positioned by their sibling groups
    if (fatherId && motherId && birthFam) {
      const fPos = positions.get(fatherId);
      const mPos = positions.get(motherId);
      if (fPos && mPos) {
        const jId = junctionMap.get(birthFam.id);
        if (jId) {
          // Junction between father's right edge and mother's left edge
          const fRight = fPos.x + NODE_WIDTH;
          const mLeft = mPos.x;
          const juncX = fRight + (mLeft - fRight - JUNCTION_SIZE) / 2;
          const juncY = snapToGrid(rowP) + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
          positions.set(jId, { x: juncX, y: juncY });
        }
      }
    }

    // Position grandparents centered above their children
    if (fatherGpFam) {
      // Find center of paternal sibling group
      let patMin = Infinity, patMax = -Infinity;
      for (const u of paternalUnits) {
        const p = positions.get(u.leftId);
        if (p) { patMin = Math.min(patMin, p.x); }
        const rp = u.rightId ? positions.get(u.rightId) : null;
        patMax = Math.max(patMax, (rp ? rp.x + NODE_WIDTH : (p ? p.x + NODE_WIDTH : patMax)));
      }
      const patCenter = (patMin + patMax) / 2;
      positionCouple(fatherGpFam.husbandId || null, fatherGpFam.wifeId || null,
        fatherGpFam.id, patCenter, rowGP, positions, junctionMap);
    }

    if (motherGpFam) {
      let matMin = Infinity, matMax = -Infinity;
      for (const u of maternalUnits) {
        const p = positions.get(u.leftId);
        if (p) { matMin = Math.min(matMin, p.x); }
        const rp = u.rightId ? positions.get(u.rightId) : null;
        matMax = Math.max(matMax, (rp ? rp.x + NODE_WIDTH : (p ? p.x + NODE_WIDTH : matMax)));
      }
      const matCenter = (matMin + matMax) / 2;
      positionCouple(motherGpFam.husbandId || null, motherGpFam.wifeId || null,
        motherGpFam.id, matCenter, rowGP, positions, junctionMap);
    }

    // Row S: Build full sibling units for EACH parent's children (center + cousins)
    // Each parent unit's children become sibling units with their own spouses
    const allParentUnits = [...paternalUnits, ...maternalUnits];
    const rowSUnits: SibUnit[] = []; // all sibling units on Row S

    for (const parentUnit of allParentUnits) {
      if (parentUnit.children.length === 0) continue;
      const sorted = sortByBirth(parentUnit.children, data);
      for (const childId of sorted) {
        rowSUnits.push(buildSibUnit(childId, data, personIds, familyIds, measured));
      }
    }

    // Position Row S units centered under their parent junction
    for (const parentUnit of allParentUnits) {
      if (parentUnit.children.length === 0) continue;
      const jId = parentUnit.familyId ? junctionMap.get(parentUnit.familyId) : null;
      const jPos = jId ? positions.get(jId) : null;
      if (!jPos) continue;

      const childUnits = parentUnit.children
        .map(cid => rowSUnits.find(u => u.leftId === cid || u.rightId === cid))
        .filter((u): u is SibUnit => !!u);

      const totalW = childUnits.reduce((s, u) => s + u.width, 0)
        + Math.max(0, childUnits.length - 1) * SIBLING_GAP;
      const jCenterX = jPos.x + JUNCTION_SIZE / 2;
      const startX = snapToGrid(jCenterX - totalW / 2);
      positionSibRow(childUnits, startX, rowS, positions, junctionMap);
    }

    // Row C: Build full sibling units for Row S's children (grandchildren generation)
    const rowCUnits: SibUnit[] = [];
    for (const unit of rowSUnits) {
      if (unit.children.length === 0) continue;
      const sorted = sortByBirth(unit.children, data);
      for (const childId of sorted) {
        rowCUnits.push(buildSibUnit(childId, data, personIds, familyIds, measured));
      }
    }

    // Position Row C units centered under their parent junction
    for (const unit of rowSUnits) {
      if (unit.children.length === 0) continue;
      const jId = unit.familyId ? junctionMap.get(unit.familyId) : null;
      const jPos = jId ? positions.get(jId) : null;
      if (!jPos) continue;

      const childUnits = unit.children
        .map(cid => rowCUnits.find(u => u.leftId === cid || u.rightId === cid))
        .filter((u): u is SibUnit => !!u);

      const totalW = childUnits.reduce((s, u) => s + u.width, 0)
        + Math.max(0, childUnits.length - 1) * SIBLING_GAP;
      const jCenterX = jPos.x + JUNCTION_SIZE / 2;
      const startX = snapToGrid(jCenterX - totalW / 2);
      positionSibRow(childUnits, startX, rowC, positions, junctionMap);
    }

    // Row GC: Build full sibling units for grandchildren (with spouses).
    //
    // IMPORTANT: This MUST use buildSibUnit + positionSibRow (not positionChildRow).
    // positionChildRow only places bare person nodes — no spouses, no junctions,
    // no children below. That caused a bug where grandchildren's spouses (e.g.
    // Melanie next to Ron) were in the data but never positioned, so they were
    // invisible. The pattern is: buildSibUnit → positionSibRow for every generation
    // that needs couples shown, then positionChildRow only for the final leaf row.
    const rowGC = rowC + ROW_HEIGHT;
    const rowGCUnits: SibUnit[] = [];
    for (const unit of rowCUnits) {
      if (unit.children.length === 0) continue;
      const sorted = sortByBirth(unit.children, data);
      for (const childId of sorted) {
        rowGCUnits.push(buildSibUnit(childId, data, personIds, familyIds, measured));
      }
    }

    // Position Row GC units centered under their parent junction
    for (const unit of rowCUnits) {
      if (unit.children.length === 0) continue;
      const jId = unit.familyId ? junctionMap.get(unit.familyId) : null;
      const jPos = jId ? positions.get(jId) : null;
      if (!jPos) continue;

      const childUnits = unit.children
        .map(cid => rowGCUnits.find(u => u.leftId === cid || u.rightId === cid))
        .filter((u): u is SibUnit => !!u);

      const totalW = childUnits.reduce((s, u) => s + u.width, 0)
        + Math.max(0, childUnits.length - 1) * SIBLING_GAP;
      const jCenterX = jPos.x + JUNCTION_SIZE / 2;
      const startX = snapToGrid(jCenterX - totalW / 2);
      positionSibRow(childUnits, startX, rowGC, positions, junctionMap);
    }

    // Row GGC: Great-grandchildren as bare leaf nodes (positionChildRow is OK here)
    const rowGGC = rowGC + ROW_HEIGHT;
    for (const unit of rowGCUnits) {
      positionChildRow(unit, rowGGC, data, positions, junctionMap, personIds, familyIds, measured);
    }

  } else if (centerUnits.length > 0) {
    // No grandparents — simple layout (parents + siblings)
    const totalW = centerUnits.reduce((s, u) => s + u.width, 0)
      + Math.max(0, centerUnits.length - 1) * SIBLING_GAP;
    positionSibRow(centerUnits, -totalW / 2, rowS, positions, junctionMap);

    // Parents centered above
    if (birthFam && (fatherId || motherId)) {
      let minX = Infinity, maxX = -Infinity;
      for (const u of centerUnits) {
        const p = positions.get(u.leftId);
        if (p) minX = Math.min(minX, p.x);
        const rp = u.rightId ? positions.get(u.rightId) : null;
        maxX = Math.max(maxX, (rp ? rp.x + NODE_WIDTH : (p ? p.x + NODE_WIDTH : maxX)));
      }
      const center = (minX + maxX) / 2;
      positionCouple(fatherId, motherId, birthFam.id, center, rowP, positions, junctionMap);
    }

    // Row C: Build full sibling units for children
    const rowCUnits: SibUnit[] = [];
    for (const unit of centerUnits) {
      if (unit.children.length === 0) continue;
      const sorted = sortByBirth(unit.children, data);
      for (const childId of sorted) {
        rowCUnits.push(buildSibUnit(childId, data, personIds, familyIds, measured));
      }
    }

    // Position Row C centered under parent junctions
    for (const unit of centerUnits) {
      if (unit.children.length === 0) continue;
      const jId = unit.familyId ? junctionMap.get(unit.familyId) : null;
      const jPos = jId ? positions.get(jId) : null;
      if (!jPos) continue;

      const childUnits = unit.children
        .map(cid => rowCUnits.find(u => u.leftId === cid || u.rightId === cid))
        .filter((u): u is SibUnit => !!u);

      const cTotalW = childUnits.reduce((s, u) => s + u.width, 0)
        + Math.max(0, childUnits.length - 1) * SIBLING_GAP;
      const jCenterX = jPos.x + JUNCTION_SIZE / 2;
      const cStartX = snapToGrid(jCenterX - cTotalW / 2);
      positionSibRow(childUnits, cStartX, rowC, positions, junctionMap);
    }

    // Row GC: Full sibling units for grandchildren (see comment in main path above
    // re: why this must use buildSibUnit + positionSibRow, not positionChildRow).
    const rowGC = rowC + ROW_HEIGHT;
    const rowGCUnits: SibUnit[] = [];
    for (const unit of rowCUnits) {
      if (unit.children.length === 0) continue;
      const sorted = sortByBirth(unit.children, data);
      for (const childId of sorted) {
        rowGCUnits.push(buildSibUnit(childId, data, personIds, familyIds, measured));
      }
    }

    // Position Row GC centered under their parent junction
    for (const unit of rowCUnits) {
      if (unit.children.length === 0) continue;
      const jId = unit.familyId ? junctionMap.get(unit.familyId) : null;
      const jPos = jId ? positions.get(jId) : null;
      if (!jPos) continue;

      const childUnits = unit.children
        .map(cid => rowGCUnits.find(u => u.leftId === cid || u.rightId === cid))
        .filter((u): u is SibUnit => !!u);

      const cTotalW = childUnits.reduce((s, u) => s + u.width, 0)
        + Math.max(0, childUnits.length - 1) * SIBLING_GAP;
      const jCenterX = jPos.x + JUNCTION_SIZE / 2;
      const cStartX = snapToGrid(jCenterX - cTotalW / 2);
      positionSibRow(childUnits, cStartX, rowGC, positions, junctionMap);
    }

    // Row GGC: Great-grandchildren as bare leaf nodes
    const rowGGC = rowGC + ROW_HEIGHT;
    for (const unit of rowGCUnits) {
      positionChildRow(unit, rowGGC, data, positions, junctionMap, personIds, familyIds, measured);
    }
  }

  // ── Shift so center person is at (0, 0) ─────────────────────────

  const centerPos = positions.get(centerPersonId);
  if (centerPos) {
    const sx = -centerPos.x;
    const sy = -centerPos.y;
    for (const pos of positions.values()) { pos.x += sx; pos.y += sy; }
  }

  // ── Compute relationship levels for edge thickness ──────────────
  const relLevels = computeRelationLevels(centerPersonId, data, personIds);

  // Build paternal/maternal ancestor sets for labeling grandparents
  const paternalAncestors = new Set<string>();
  const maternalAncestors = new Set<string>();
  if (birthFam) {
    function walkAncestors(pid: string, targetSet: Set<string>) {
      targetSet.add(pid);
      const p = data.persons.get(pid);
      if (!p?.familyAsChild) return;
      const f = data.families.get(p.familyAsChild);
      if (!f) return;
      if (f.husbandId) walkAncestors(f.husbandId, targetSet);
      if (f.wifeId) walkAncestors(f.wifeId, targetSet);
    }
    if (fatherId) walkAncestors(fatherId, paternalAncestors);
    if (motherId) walkAncestors(motherId, maternalAncestors);
  }

  function addLinePrefix(label: string, pid: string): string {
    // Only add prefix for grandparent+ labels
    if (!label.includes('Grand')) return label;
    // Don't double-prefix
    if (label.includes('Paternal') || label.includes('Maternal')) return label;
    const isPat = paternalAncestors.has(pid) && !maternalAncestors.has(pid);
    const isMat = maternalAncestors.has(pid) && !paternalAncestors.has(pid);
    if (isPat) return `Paternal ${label}`;
    if (isMat) return `Maternal ${label}`;
    return label;
  }

  // Level → edge style
  function edgeStyle(level: number): { stroke: string; strokeWidth: number } {
    switch (level) {
      case 0: return { stroke: '#475569', strokeWidth: 3.5 };   // direct line
      case 1: return { stroke: '#64748b', strokeWidth: 2.5 };   // sibling family
      case 2: return { stroke: '#94a3b8', strokeWidth: 2 };     // uncles/aunts
      case 3: return { stroke: '#94a3b8', strokeWidth: 1.5 };   // uncle's spouse
      case 4: return { stroke: '#cbd5e1', strokeWidth: 1.2 };   // great-uncle
      case 5: return { stroke: '#cbd5e1', strokeWidth: 1 };     // great-uncle's spouse
      default: return { stroke: '#e2e8f0', strokeWidth: 0.8 };  // distant
    }
  }

  // ── Build React Flow nodes ──────────────────────────────────────

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const addedEdges = new Set<string>();

  for (const pid of personIds) {
    const person = data.persons.get(pid);
    if (!person) continue;
    const pos = positions.get(pid);
    if (!pos) continue;

    let collapsedAncestorCount = 0;
    let collapsedDescendantCount = 0;
    if (person.familyAsChild) {
      const pf = data.families.get(person.familyAsChild);
      if (pf && ((pf.husbandId && !personIds.has(pf.husbandId)) ||
                 (pf.wifeId && !personIds.has(pf.wifeId)))) {
        collapsedAncestorCount = countAncestors(pid, data, new Set());
      }
    }
    for (const fid of person.familiesAsSpouse) {
      const fm = data.families.get(fid);
      if (fm) for (const c of fm.childIds) {
        if (!personIds.has(c)) { collapsedDescendantCount = countDescendants(pid, data, new Set()); break; }
      }
      if (collapsedDescendantCount > 0) break;
    }

    nodes.push({
      id: pid, type: 'personNode',
      position: { x: pos.x, y: pos.y },
      data: {
        personId: pid,
        label: `${person.givenName} ${person.surname}`.trim(),
        surname: person.surname,
        birthDate: person.birthDate, deathDate: person.deathDate,
        sex: person.sex, isLiving: person.isLiving,
        isSelected: pid === selectedPersonId,
        isBloodRelative: true,
        hasInLawFamily: false, isInLawExpanded: false,
        collapsedAncestorCount, collapsedDescendantCount,
        hasParents: !!person.familyAsChild,
        hasChildren: person.familiesAsSpouse.some(f => {
          const fm = data.families.get(f); return fm ? fm.childIds.length > 0 : false;
        }),
        relationshipLabel: pid === centerPersonId ? undefined
          : addLinePrefix(calculateRelationship(pid, centerPersonId, data) || '', pid) || undefined,
      } satisfies PersonNodeData as unknown as Record<string, unknown>,
    });
  }

  for (const famId of familyIds) {
    const family = data.families.get(famId);
    if (!family) continue;
    const juncId = junctionMap.get(famId)!;
    const juncPos = positions.get(juncId);
    if (!juncPos) continue;

    const husbId = family.husbandId;
    const wifeId = family.wifeId;
    const hasH = husbId && positions.has(husbId);
    const hasW = wifeId && positions.has(wifeId);
    const kids = family.childIds.filter(c => positions.has(c));
    if (!hasH && !hasW) continue;
    if (kids.length === 0 && !(hasH && hasW)) continue;

    nodes.push({
      id: juncId, type: 'familyNode',
      position: { x: juncPos.x, y: juncPos.y },
      data: { familyId: famId, marriageDate: family.marriageDate } satisfies FamilyNodeData as unknown as Record<string, unknown>,
    });

    if (hasH) {
      const eid = `${husbId}->${juncId}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        const level = Math.max(relLevels.get(husbId!) ?? 6, relLevels.get(wifeId || '') ?? 6);
        edges.push({ id: eid, source: husbId!, target: juncId, sourceHandle: 'right', targetHandle: 'left', type: 'straight', style: edgeStyle(level) });
      }
    }
    if (hasW) {
      const eid = `${wifeId}->${juncId}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        const level = Math.max(relLevels.get(husbId || '') ?? 6, relLevels.get(wifeId!) ?? 6);
        edges.push({ id: eid, source: wifeId!, target: juncId, sourceHandle: 'left', targetHandle: 'right', type: 'straight', style: edgeStyle(level) });
      }
    }
    for (const cid of kids) {
      const eid = `${juncId}->${cid}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        const level = relLevels.get(cid) ?? 6;
        edges.push({ id: eid, source: juncId, target: cid, sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: edgeStyle(level) });
      }
    }
  }

  return { nodes, edges };
}
