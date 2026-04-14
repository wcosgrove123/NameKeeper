/**
 * Tree View layout V2 for React Flow — CURSOR-PER-ROW, CENTER-OUT positioning.
 *
 * 4-row layout centered on a person:
 *   Row GP:  Paternal grandparents (LEFT)     Maternal grandparents (RIGHT)
 *   Row P:   Father's siblings → FATHER   +   MOTHER ← Mother's siblings
 *   Row S:   Center person + spouse, first cousins
 *   Row C:   Center person's children, cousins' children
 *   (+ additional rows for grandchildren, great-grandchildren as needed)
 *
 * KEY INNOVATION: Maintain left/right cursors for EACH generation row (Y level).
 * When placing a family unit, advance cursors on ALL rows that family occupies.
 * This prevents overlaps across all rows simultaneously, even when uncle's
 * grandchildren would collide with center person's children.
 *
 * Algorithm:
 *   1. Place center person's family at x=0 (couple on rowS, children on rowC)
 *   2. Center person's siblings expand RIGHT on rowS
 *   3. Parents centered above all siblings on rowP
 *   4a. Father's siblings expand LEFT on rowP (their children on rowS, gc on rowC)
 *   4b. Mother's siblings expand RIGHT on rowP
 *   5. Grandparents centered above each side on rowGP
 *   6. Shift so center person = (0, 0)
 */

import { type Node, type Edge } from '@xyflow/react';
import { GedcomData } from './types';
import { parseBirthDate } from './gedcom-parser';
import { calculateRelationship } from './relationship-calculator';
import { isExFamily } from './family-status';
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

// ── Row Cursors — tracks occupied extents per row ────────────────────

class RowCursors {
  private leftEdge = new Map<number, number>();
  private rightEdge = new Map<number, number>();

  getLeft(y: number): number { return this.leftEdge.get(y) ?? 0; }
  getRight(y: number): number { return this.rightEdge.get(y) ?? 0; }

  /** Returns true if a row has been marked at least once. */
  hasRow(y: number): boolean {
    return this.leftEdge.has(y) || this.rightEdge.has(y);
  }

  /** Mark a horizontal range as occupied on a row. */
  markOccupied(y: number, left: number, right: number) {
    const curLeft = this.leftEdge.get(y);
    if (curLeft === undefined || left < curLeft) this.leftEdge.set(y, left);
    const curRight = this.rightEdge.get(y);
    if (curRight === undefined || right > curRight) this.rightEdge.set(y, right);
  }
}

// ── FamilyInfo — flat 2-level-deep family descriptor ─────────────────

interface MarriageInfo {
  spouseId: string | null;
  familyId: string | null;
  children: ChildInfo[];
}

interface ChildInfo {
  personId: string;
  spouseId: string | null;
  familyId: string | null;
  /** Left ID in couple (male or person if no spouse) */
  leftId: string;
  /** Right ID in couple (female or null) */
  rightId: string | null;
  grandchildren: GrandchildInfo[];
}

interface GrandchildInfo {
  personId: string;
  spouseId: string | null;
  familyId: string | null;
  leftId: string;
  rightId: string | null;
}

interface FamilyInfo {
  personId: string;
  sex: string;           // 'M', 'F', or 'U'
  marriages: MarriageInfo[];
  // For backward compat with existing code, convenience getters:
  // The "primary" marriage (first one) fields
  /** Left ID in couple (male on left) — computed from first marriage */
  leftId: string;
  /** Right ID in couple (female on right, or null) — computed from first marriage */
  rightId: string | null;
  familyId: string | null;
  /** Children from ALL marriages combined, sorted by birth */
  children: ChildInfo[];
}

// ── Helpers (reused from v1) ─────────────────────────────────────────

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

function computeRelationLevels(
  centerId: string, data: GedcomData, personIds: Set<string>,
): Map<string, number> {
  const levels = new Map<string, number>();

  function markDescendants(pid: string, level: number, visited: Set<string>) {
    if (visited.has(pid)) return;
    visited.add(pid);
    const p = data.persons.get(pid);
    if (!p) return;
    for (const fid of p.familiesAsSpouse) {
      const f = data.families.get(fid);
      if (!f) continue;
      const sp = f.husbandId === pid ? f.wifeId : f.husbandId;
      if (sp && personIds.has(sp) && !levels.has(sp)) levels.set(sp, level);
      for (const cid of f.childIds) {
        if (personIds.has(cid) && !levels.has(cid)) {
          levels.set(cid, level);
          markDescendants(cid, level, visited);
        }
      }
    }
  }

  levels.set(centerId, 0);

  const cp = data.persons.get(centerId);
  if (cp) {
    for (const fid of cp.familiesAsSpouse) {
      const f = data.families.get(fid);
      if (!f) continue;
      const sp = f.husbandId === centerId ? f.wifeId : f.husbandId;
      if (sp && personIds.has(sp)) levels.set(sp, 0);
    }
  }

  markDescendants(centerId, 0, new Set());

  const directLine = new Set<string>([centerId]);

  function walkUp(personId: string, generation: number) {
    const person = data.persons.get(personId);
    if (!person?.familyAsChild) return;
    const fam = data.families.get(person.familyAsChild);
    if (!fam) return;

    const parents = [fam.husbandId, fam.wifeId].filter((id): id is string =>
      !!id && personIds.has(id));

    for (const parentId of parents) {
      if (!levels.has(parentId)) levels.set(parentId, 0);
      directLine.add(parentId);
    }

    const siblingLevel = generation * 2;
    const familyLevel = siblingLevel + 1;

    for (const sibId of fam.childIds) {
      if (!personIds.has(sibId)) continue;
      if (directLine.has(sibId)) continue;
      if (sibId === personId) continue;

      if (!levels.has(sibId)) levels.set(sibId, siblingLevel);

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

    for (const parentId of parents) {
      walkUp(parentId, generation + 1);
    }
  }

  walkUp(centerId, 0);

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

// ── Width computation helpers ────────────────────────────────────────

/** Width of a couple (or single person). */
function coupleWidth(hasSpouse: boolean): number {
  return hasSpouse ? NODE_WIDTH + SPOUSE_GAP + NODE_WIDTH : NODE_WIDTH;
}

/** Width of a multi-marriage couple unit. */
function multiCoupleWidth(info: FamilyInfo): number {
  const spouseCount = info.marriages.filter(m => m.spouseId).length;
  if (spouseCount === 0) return NODE_WIDTH;
  // Person + each spouse: NODE_WIDTH * (1 + spouseCount) + SPOUSE_GAP * spouseCount
  return NODE_WIDTH + spouseCount * (SPOUSE_GAP + NODE_WIDTH);
}

/** Total width of a row of couples with gaps between them. */
function rowWidth(items: { hasSpouse: boolean }[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + coupleWidth(item.hasSpouse), 0)
    + (items.length - 1) * SIBLING_GAP;
}

// ── Ordering helpers: male on left, female on right ──────────────────

function orderCouple(
  personId: string, spouseId: string | null, data: GedcomData,
): { leftId: string; rightId: string | null } {
  if (!spouseId) return { leftId: personId, rightId: null };
  const person = data.persons.get(personId);
  const spouse = data.persons.get(spouseId);
  // Male on left, female on right
  if (person?.sex === 'F' && spouse?.sex === 'M') {
    return { leftId: spouseId, rightId: personId };
  }
  return { leftId: personId, rightId: spouseId };
}

// ── buildChildrenForFamily — extract child-building into a helper ────

function buildChildrenForFamily(
  childIds: string[],
  data: GedcomData,
  personIds: Set<string>,
  familyIds: Set<string>,
): ChildInfo[] {
  const sortedChildren = sortByBirth(childIds, data);

  return sortedChildren.map(cid => {
    const child = data.persons.get(cid);
    let cSpouseId: string | null = null;
    let cFamilyId: string | null = null;
    let gcIds: string[] = [];

    if (child) {
      for (const cfid of child.familiesAsSpouse) {
        if (!familyIds.has(cfid)) continue;
        const cfam = data.families.get(cfid);
        if (!cfam || (cfam.husbandId !== cid && cfam.wifeId !== cid)) continue;
        cFamilyId = cfid;
        const csid = cfam.husbandId === cid ? cfam.wifeId : cfam.husbandId;
        cSpouseId = csid && personIds.has(csid) ? csid : null;
        gcIds = cfam.childIds.filter(gc => personIds.has(gc));
        break;
      }
    }

    const cOrdered = orderCouple(cid, cSpouseId, data);
    const sortedGc = sortByBirth(gcIds, data);

    // Build grandchild info (check if each gc has a spouse in scope)
    const grandchildren: GrandchildInfo[] = sortedGc.map(gcid => {
      const gc = data.persons.get(gcid);
      let gcSpouseId: string | null = null;
      let gcFamilyId: string | null = null;

      if (gc) {
        for (const gfid of gc.familiesAsSpouse) {
          if (!familyIds.has(gfid)) continue;
          const gfam = data.families.get(gfid);
          if (!gfam || (gfam.husbandId !== gcid && gfam.wifeId !== gcid)) continue;
          gcFamilyId = gfid;
          const gsid = gfam.husbandId === gcid ? gfam.wifeId : gfam.husbandId;
          gcSpouseId = gsid && personIds.has(gsid) ? gsid : null;
          break;
        }
      }

      const gcOrdered = orderCouple(gcid, gcSpouseId, data);
      return {
        personId: gcid,
        spouseId: gcSpouseId,
        familyId: gcFamilyId,
        leftId: gcOrdered.leftId,
        rightId: gcOrdered.rightId,
      };
    });

    return {
      personId: cid,
      spouseId: cSpouseId,
      familyId: cFamilyId,
      leftId: cOrdered.leftId,
      rightId: cOrdered.rightId,
      grandchildren,
    };
  });
}

// ── buildFamilyInfo — flat 2-level family descriptor (multi-marriage) ─

function buildFamilyInfo(
  personId: string,
  data: GedcomData,
  personIds: Set<string>,
  familyIds: Set<string>,
): FamilyInfo {
  const person = data.persons.get(personId);
  const sex = person?.sex || 'U';
  const marriages: MarriageInfo[] = [];

  if (person) {
    for (const fid of person.familiesAsSpouse) {
      if (!familyIds.has(fid)) continue;
      const fam = data.families.get(fid);
      if (!fam || (fam.husbandId !== personId && fam.wifeId !== personId)) continue;

      const sid = fam.husbandId === personId ? fam.wifeId : fam.husbandId;
      const spouseId = sid && personIds.has(sid) ? sid : null;
      const childIds = fam.childIds.filter(c => personIds.has(c));

      // Build ChildInfo for each child using extracted helper
      const children = buildChildrenForFamily(childIds, data, personIds, familyIds);

      marriages.push({ spouseId, familyId: fid, children });
    }
  }

  // Compute convenience fields from first marriage
  const firstMarriage = marriages[0];
  const primarySpouseId = firstMarriage?.spouseId ?? null;
  const primaryFamilyId = firstMarriage?.familyId ?? null;
  const { leftId, rightId } = orderCouple(personId, primarySpouseId, data);

  // All children combined from all marriages, sorted by birth
  const allChildIds = marriages.flatMap(m => m.children.map(c => c.personId));
  const sortedAllChildIds = sortByBirth(allChildIds, data);
  const allChildren = sortedAllChildIds.map(cid => {
    for (const m of marriages) {
      const found = m.children.find(c => c.personId === cid);
      if (found) return found;
    }
    return marriages[0]?.children[0]; // fallback, shouldn't happen
  }).filter(Boolean) as ChildInfo[];

  return {
    personId, sex, marriages,
    leftId, rightId,
    familyId: primaryFamilyId,
    children: allChildren,
  };
}

// ── Positioning: place a couple + junction at absolute coords ────────

function placeCouple(
  leftId: string,
  rightId: string | null,
  familyId: string | null,
  leftX: number,
  y: number,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
): void {
  const snY = snapToGrid(y);
  const snLeftX = snapToGrid(leftX);

  if (!positions.has(leftId)) {
    positions.set(leftId, { x: snLeftX, y: snY });
  }

  if (rightId && familyId) {
    const rightX = snapToGrid(snLeftX + NODE_WIDTH + SPOUSE_GAP);
    if (!positions.has(rightId)) {
      positions.set(rightId, { x: rightX, y: snY });
    }
    const juncX = snLeftX + NODE_WIDTH
      + (rightX - snLeftX - NODE_WIDTH - JUNCTION_SIZE) / 2;
    const juncY = snY + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
    const jId = junctionMap.get(familyId);
    if (jId) positions.set(jId, { x: juncX, y: juncY });
  } else if (familyId) {
    const jId = junctionMap.get(familyId);
    if (jId) {
      positions.set(jId, {
        x: snLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
        y: snY + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
      });
    }
  }
}

// ── placeMultiCouple — place a multi-marriage couple unit ────────────

function placeMultiCouple(
  info: FamilyInfo,
  leftX: number,    // leftmost X of the entire multi-couple unit
  y: number,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
  data: GedcomData,
): { junctionXByFamily: Map<string, number> } {
  const snY = snapToGrid(y);
  const juncY = snY + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
  const junctionXByFamily = new Map<string, number>();

  if (info.marriages.length <= 1) {
    // Single marriage or no marriage — use existing placeCouple logic
    placeCouple(info.leftId, info.rightId, info.familyId, leftX, y, positions, junctionMap);
    if (info.familyId) {
      if (info.rightId) {
        const snLeftX = snapToGrid(leftX);
        const rightX = snapToGrid(snLeftX + NODE_WIDTH + SPOUSE_GAP);
        const juncX = snLeftX + NODE_WIDTH + (rightX - snLeftX - NODE_WIDTH - JUNCTION_SIZE) / 2;
        junctionXByFamily.set(info.familyId, juncX);
      } else {
        junctionXByFamily.set(info.familyId, snapToGrid(leftX) + (NODE_WIDTH - JUNCTION_SIZE) / 2);
      }
    }
    return { junctionXByFamily };
  }

  // Multi-marriage layout
  let x = snapToGrid(leftX);
  const isMale = info.sex === 'M';

  if (isMale) {
    // Layout: Wife1 — junction1 — HUSBAND — junction2 — Wife2 — junction3 — Wife3 ...
    const marriage0 = info.marriages[0];

    // Wife1 (first wife) on LEFT
    if (marriage0.spouseId) {
      if (!positions.has(marriage0.spouseId)) {
        positions.set(marriage0.spouseId, { x, y: snY });
      }
      x = snapToGrid(x + NODE_WIDTH + SPOUSE_GAP);
    }

    // Husband in CENTER
    if (!positions.has(info.personId)) {
      positions.set(info.personId, { x, y: snY });
    }
    const husbandX = x;

    // Junction for marriage0 (between wife1 and husband)
    if (marriage0.familyId && marriage0.spouseId) {
      const wife1X = snapToGrid(leftX);
      const juncX = wife1X + NODE_WIDTH + (husbandX - wife1X - NODE_WIDTH - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(marriage0.familyId);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
      junctionXByFamily.set(marriage0.familyId, juncX);
    } else if (marriage0.familyId) {
      const juncX = husbandX + (NODE_WIDTH - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(marriage0.familyId);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
      junctionXByFamily.set(marriage0.familyId, juncX);
    }

    x = snapToGrid(husbandX + NODE_WIDTH + SPOUSE_GAP);

    // Wife2+ stack RIGHT
    for (let i = 1; i < info.marriages.length; i++) {
      const m = info.marriages[i];
      if (m.spouseId) {
        if (!positions.has(m.spouseId)) {
          positions.set(m.spouseId, { x, y: snY });
        }
        // Junction between husband and this wife
        if (m.familyId) {
          const juncX = husbandX + NODE_WIDTH + (x - husbandX - NODE_WIDTH - JUNCTION_SIZE) / 2;
          const jId = junctionMap.get(m.familyId);
          if (jId) positions.set(jId, { x: juncX, y: juncY });
          junctionXByFamily.set(m.familyId, juncX);
        }
        x = snapToGrid(x + NODE_WIDTH + SPOUSE_GAP);
      }
    }
  } else {
    // Female with multiple husbands:
    // Layout: MainHusband — junction1 — WIFE — junction2 — ExHusband2 ...
    const marriage0 = info.marriages[0];

    // Main husband (first marriage) on LEFT
    if (marriage0.spouseId) {
      if (!positions.has(marriage0.spouseId)) {
        positions.set(marriage0.spouseId, { x, y: snY });
      }
      x = snapToGrid(x + NODE_WIDTH + SPOUSE_GAP);
    }

    // Wife in CENTER
    if (!positions.has(info.personId)) {
      positions.set(info.personId, { x, y: snY });
    }
    const wifeX = x;

    // Junction for marriage0
    if (marriage0.familyId && marriage0.spouseId) {
      const husb1X = snapToGrid(leftX);
      const juncX = husb1X + NODE_WIDTH + (wifeX - husb1X - NODE_WIDTH - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(marriage0.familyId);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
      junctionXByFamily.set(marriage0.familyId, juncX);
    } else if (marriage0.familyId) {
      const juncX = wifeX + (NODE_WIDTH - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(marriage0.familyId);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
      junctionXByFamily.set(marriage0.familyId, juncX);
    }

    x = snapToGrid(wifeX + NODE_WIDTH + SPOUSE_GAP);

    // Ex-husbands stack RIGHT
    for (let i = 1; i < info.marriages.length; i++) {
      const m = info.marriages[i];
      if (m.spouseId) {
        if (!positions.has(m.spouseId)) {
          positions.set(m.spouseId, { x, y: snY });
        }
        if (m.familyId) {
          const juncX = wifeX + NODE_WIDTH + (x - wifeX - NODE_WIDTH - JUNCTION_SIZE) / 2;
          const jId = junctionMap.get(m.familyId);
          if (jId) positions.set(jId, { x: juncX, y: juncY });
          junctionXByFamily.set(m.familyId, juncX);
        }
        x = snapToGrid(x + NODE_WIDTH + SPOUSE_GAP);
      }
    }
  }

  return { junctionXByFamily };
}

// ── placeUnitRightward — place a family expanding right ──────────────

/**
 * Place a FamilyInfo expanding rightward from the current row cursors.
 * Computes the tightest constraint across all rows this family occupies,
 * then places couple, children, and grandchildren from that position.
 */
function placeUnitRightward(
  info: FamilyInfo,
  coupleY: number,
  childrenY: number,
  cursors: RowCursors,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
  data: GedcomData,
): void {
  const cw = multiCoupleWidth(info);

  // Compute per-child slot widths: each child's slot = max(coupleW, grandchildrenW)
  // so the child couple is centered above their grandchildren
  const gcY = childrenY + ROW_HEIGHT;
  const childSlotWidths: number[] = info.children.map(c => {
    const childCw = coupleWidth(!!c.rightId);
    if (c.grandchildren.length === 0) return childCw;
    const gcW = rowWidth(c.grandchildren.map(gc => ({ hasSpouse: !!gc.rightId })));
    return Math.max(childCw, gcW);
  });

  // Total children row width uses slot widths (not just couple widths)
  const childrenW = childSlotWidths.length > 0
    ? childSlotWidths.reduce((s, w) => s + w, 0) + (childSlotWidths.length - 1) * SIBLING_GAP
    : 0;

  // The widest row determines the unit's effective width
  const unitWidth = Math.max(cw, childrenW);

  // Find tightest constraint: for each row, the unit's left edge must be
  // at least SIBLING_GAP past the current right edge of that row
  let neededLeftX = -Infinity;

  if (cursors.hasRow(coupleY)) {
    neededLeftX = Math.max(neededLeftX, cursors.getRight(coupleY) + SIBLING_GAP);
  }
  if (childrenW > 0 && cursors.hasRow(childrenY)) {
    neededLeftX = Math.max(neededLeftX, cursors.getRight(childrenY) + SIBLING_GAP);
  }
  if (childrenW > 0 && cursors.hasRow(gcY)) {
    neededLeftX = Math.max(neededLeftX, cursors.getRight(gcY) + SIBLING_GAP);
  }

  // If no rows have been occupied yet, start at 0
  if (neededLeftX === -Infinity) neededLeftX = 0;

  // Center the couple within the unit width
  const unitCenterX = neededLeftX + unitWidth / 2;
  const coupleLeftX = snapToGrid(unitCenterX - cw / 2);

  // Place the couple (multi-marriage aware)
  const { junctionXByFamily } = placeMultiCouple(info, coupleLeftX, coupleY, positions, junctionMap, data);
  cursors.markOccupied(coupleY, coupleLeftX, coupleLeftX + cw);

  // Place children — grouped by marriage, each group centered under its junction
  if (info.children.length > 0) {
    // All children go on the same Y row
    // Start from the left edge of the unit's children area
    let cx = snapToGrid(unitCenterX - childrenW / 2);

    // Ensure children don't go left of the needed boundary
    if (cursors.hasRow(childrenY)) {
      const minCx = cursors.getRight(childrenY) + SIBLING_GAP;
      if (cx < minCx) cx = snapToGrid(minCx);
    }

    const childrenMinX = cx;

    // Build a map from child personId to its slot index for width lookup
    const childSlotMap = new Map<string, number>();
    info.children.forEach((c, i) => childSlotMap.set(c.personId, i));

    if (info.marriages.length <= 1) {
      // Single marriage: place all children linearly (same as before)
      for (let i = 0; i < info.children.length; i++) {
        const child = info.children[i];
        const childCw = coupleWidth(!!child.rightId);
        const slotW = childSlotWidths[i];
        const slotCenterX = cx + slotW / 2;

        const childLeftX = snapToGrid(slotCenterX - childCw / 2);
        placeCouple(child.leftId, child.rightId, child.familyId, childLeftX, childrenY, positions, junctionMap);

        if (child.grandchildren.length > 0) {
          const gcW = rowWidth(child.grandchildren.map(gc => ({ hasSpouse: !!gc.rightId })));
          let gcx = snapToGrid(slotCenterX - gcW / 2);

          if (cursors.hasRow(gcY)) {
            const minGcx = cursors.getRight(gcY) + SIBLING_GAP;
            if (gcx < minGcx) gcx = snapToGrid(minGcx);
          }

          const gcStartX = gcx;
          for (const gc of child.grandchildren) {
            const gcCw = coupleWidth(!!gc.rightId);
            placeCouple(gc.leftId, gc.rightId, gc.familyId, gcx, gcY, positions, junctionMap);
            gcx += gcCw + SIBLING_GAP;
          }
          cursors.markOccupied(gcY, gcStartX, gcx - SIBLING_GAP);
        }

        cx += slotW + SIBLING_GAP;
      }
    } else {
      // Multi-marriage: group children by marriage, center each group under its junction
      for (const marriage of info.marriages) {
        if (marriage.children.length === 0) continue;
        // Sort this marriage's children by birth (they should already be, but ensure)
        const marriageChildren = sortByBirth(marriage.children.map(c => c.personId), data);

        for (const mcid of marriageChildren) {
          const idx = childSlotMap.get(mcid);
          if (idx === undefined) continue;
          const child = info.children[idx];
          const childCw = coupleWidth(!!child.rightId);
          const slotW = childSlotWidths[idx];
          const slotCenterX = cx + slotW / 2;

          const childLeftX = snapToGrid(slotCenterX - childCw / 2);
          placeCouple(child.leftId, child.rightId, child.familyId, childLeftX, childrenY, positions, junctionMap);

          if (child.grandchildren.length > 0) {
            const gcW = rowWidth(child.grandchildren.map(gc => ({ hasSpouse: !!gc.rightId })));
            let gcx = snapToGrid(slotCenterX - gcW / 2);

            if (cursors.hasRow(gcY)) {
              const minGcx = cursors.getRight(gcY) + SIBLING_GAP;
              if (gcx < minGcx) gcx = snapToGrid(minGcx);
            }

            const gcStartX = gcx;
            for (const gc of child.grandchildren) {
              const gcCw = coupleWidth(!!gc.rightId);
              placeCouple(gc.leftId, gc.rightId, gc.familyId, gcx, gcY, positions, junctionMap);
              gcx += gcCw + SIBLING_GAP;
            }
            cursors.markOccupied(gcY, gcStartX, gcx - SIBLING_GAP);
          }

          cx += slotW + SIBLING_GAP;
        }
      }
    }

    cursors.markOccupied(childrenY, childrenMinX, cx - SIBLING_GAP);
  }
}

// ── placeUnitLeftward — mirror of rightward, expanding left ──────────

/**
 * Place a FamilyInfo expanding leftward from the current row cursors.
 * The unit's right edge is constrained by the leftmost occupied position
 * on each row minus SIBLING_GAP.
 */
function placeUnitLeftward(
  info: FamilyInfo,
  coupleY: number,
  childrenY: number,
  cursors: RowCursors,
  positions: Map<string, { x: number; y: number }>,
  junctionMap: Map<string, string>,
  data: GedcomData,
): void {
  const cw = multiCoupleWidth(info);

  // Compute per-child slot widths: each child's slot = max(coupleW, grandchildrenW)
  const gcY = childrenY + ROW_HEIGHT;
  const childSlotWidths: number[] = info.children.map(c => {
    const childCw = coupleWidth(!!c.rightId);
    if (c.grandchildren.length === 0) return childCw;
    const gcW = rowWidth(c.grandchildren.map(gc => ({ hasSpouse: !!gc.rightId })));
    return Math.max(childCw, gcW);
  });

  const childrenW = childSlotWidths.length > 0
    ? childSlotWidths.reduce((s, w) => s + w, 0) + (childSlotWidths.length - 1) * SIBLING_GAP
    : 0;

  const unitWidth = Math.max(cw, childrenW);

  // Tightest constraint: for each row, the unit's right edge must be
  // at least SIBLING_GAP to the left of the current left edge
  let neededRightX = Infinity;

  if (cursors.hasRow(coupleY)) {
    neededRightX = Math.min(neededRightX, cursors.getLeft(coupleY) - SIBLING_GAP);
  }
  if (childrenW > 0 && cursors.hasRow(childrenY)) {
    neededRightX = Math.min(neededRightX, cursors.getLeft(childrenY) - SIBLING_GAP);
  }
  if (childrenW > 0 && cursors.hasRow(gcY)) {
    neededRightX = Math.min(neededRightX, cursors.getLeft(gcY) - SIBLING_GAP);
  }

  if (neededRightX === Infinity) neededRightX = 0;

  const unitCenterX = neededRightX - unitWidth / 2;
  const coupleLeftX = snapToGrid(unitCenterX - cw / 2);

  // Place the couple (multi-marriage aware)
  const { junctionXByFamily } = placeMultiCouple(info, coupleLeftX, coupleY, positions, junctionMap, data);
  cursors.markOccupied(coupleY, coupleLeftX, coupleLeftX + cw);

  // Place children — grouped by marriage, each group centered under its junction
  if (info.children.length > 0) {
    let cx = snapToGrid(unitCenterX - childrenW / 2);

    // Ensure children don't go right of the needed boundary
    if (cursors.hasRow(childrenY)) {
      const maxRightCx = cursors.getLeft(childrenY) - SIBLING_GAP - childrenW;
      if (cx > maxRightCx) cx = snapToGrid(maxRightCx);
    }

    const childrenMinX = cx;

    // Build a map from child personId to its slot index for width lookup
    const childSlotMap = new Map<string, number>();
    info.children.forEach((c, i) => childSlotMap.set(c.personId, i));

    if (info.marriages.length <= 1) {
      // Single marriage: place all children linearly (same as before)
      for (let i = 0; i < info.children.length; i++) {
        const child = info.children[i];
        const childCw = coupleWidth(!!child.rightId);
        const slotW = childSlotWidths[i];
        const slotCenterX = cx + slotW / 2;

        const childLeftX = snapToGrid(slotCenterX - childCw / 2);
        placeCouple(child.leftId, child.rightId, child.familyId, childLeftX, childrenY, positions, junctionMap);

        if (child.grandchildren.length > 0) {
          const gcW = rowWidth(child.grandchildren.map(gc => ({ hasSpouse: !!gc.rightId })));
          let gcx = snapToGrid(slotCenterX - gcW / 2);

          const gcStartX = gcx;
          for (const gc of child.grandchildren) {
            const gcCw = coupleWidth(!!gc.rightId);
            placeCouple(gc.leftId, gc.rightId, gc.familyId, gcx, gcY, positions, junctionMap);
            gcx += gcCw + SIBLING_GAP;
          }
          cursors.markOccupied(gcY, gcStartX, gcx - SIBLING_GAP);
        }

        cx += slotW + SIBLING_GAP;
      }
    } else {
      // Multi-marriage: group children by marriage, center each group under its junction
      for (const marriage of info.marriages) {
        if (marriage.children.length === 0) continue;
        const marriageChildren = sortByBirth(marriage.children.map(c => c.personId), data);

        for (const mcid of marriageChildren) {
          const idx = childSlotMap.get(mcid);
          if (idx === undefined) continue;
          const child = info.children[idx];
          const childCw = coupleWidth(!!child.rightId);
          const slotW = childSlotWidths[idx];
          const slotCenterX = cx + slotW / 2;

          const childLeftX = snapToGrid(slotCenterX - childCw / 2);
          placeCouple(child.leftId, child.rightId, child.familyId, childLeftX, childrenY, positions, junctionMap);

          if (child.grandchildren.length > 0) {
            const gcW = rowWidth(child.grandchildren.map(gc => ({ hasSpouse: !!gc.rightId })));
            let gcx = snapToGrid(slotCenterX - gcW / 2);

            const gcStartX = gcx;
            for (const gc of child.grandchildren) {
              const gcCw = coupleWidth(!!gc.rightId);
              placeCouple(gc.leftId, gc.rightId, gc.familyId, gcx, gcY, positions, junctionMap);
              gcx += gcCw + SIBLING_GAP;
            }
            cursors.markOccupied(gcY, gcStartX, gcx - SIBLING_GAP);
          }

          cx += slotW + SIBLING_GAP;
        }
      }
    }

    const childrenEnd = cx - SIBLING_GAP;
    cursors.markOccupied(childrenY, childrenMinX, childrenEnd);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

export function buildTreeViewV2(data: GedcomData, options: TreeViewOptions): TreeViewResult {
  const { centerPersonId, selectedPersonId } = options;
  const centerPerson = data.persons.get(centerPersonId);
  if (!centerPerson) return { nodes: [], edges: [] };

  const positions = new Map<string, { x: number; y: number }>();
  const personIds = new Set<string>();
  const familyIds = new Set<string>();
  const junctionMap = new Map<string, string>();

  function addFamily(famId: string) {
    familyIds.add(famId);
    junctionMap.set(famId, `junc-${famId}`);
  }

  // ── Collection phase (same as v1) ──────────────────────────────

  personIds.add(centerPersonId);

  // Center person's spouse(s) + children from ALL marriages
  for (const fid of centerPerson.familiesAsSpouse) {
    const fam = data.families.get(fid);
    if (!fam || (fam.husbandId !== centerPersonId && fam.wifeId !== centerPersonId)) continue;
    addFamily(fid);
    const sid = fam.husbandId === centerPersonId ? fam.wifeId : fam.husbandId;
    if (sid) {
      personIds.add(sid);
      // Also collect the spouse's OTHER marriages (step-children, ex-spouses)
      const spouse = data.persons.get(sid);
      if (spouse) {
        for (const sfid of spouse.familiesAsSpouse) {
          if (sfid === fid) continue; // skip the shared marriage
          const sfam = data.families.get(sfid);
          if (!sfam) continue;
          addFamily(sfid);
          const exSpouseId = sfam.husbandId === sid ? sfam.wifeId : sfam.husbandId;
          if (exSpouseId) personIds.add(exSpouseId);
          for (const stepChildId of sfam.childIds) personIds.add(stepChildId);
        }
      }
    }
    for (const cid of fam.childIds) {
      personIds.add(cid);
      // Collect children's families (spouse + grandchildren) so they render
      collectPersonFamily(cid, 1);
    }
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

    // Collect ALL of each parent's marriages (step-parents, half-siblings)
    for (const parentId of [fatherId, motherId]) {
      if (!parentId) continue;
      const parent = data.persons.get(parentId);
      if (!parent) continue;
      for (const pfid of parent.familiesAsSpouse) {
        if (pfid === birthFam.id) continue; // skip the birth family (already added)
        const pfam = data.families.get(pfid);
        if (!pfam) continue;
        addFamily(pfid);
        const stepParentId = pfam.husbandId === parentId ? pfam.wifeId : pfam.husbandId;
        if (stepParentId) personIds.add(stepParentId);
        for (const halfSibId of pfam.childIds) personIds.add(halfSibId);
      }
    }
  }

  // Collect a person's spouse + children + grandchildren families
  function collectPersonFamily(pid: string, depth: number) {
    if (depth > 3) return;
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

    addFamily(gpFam.id);
    if (gpFam.husbandId) personIds.add(gpFam.husbandId);
    if (gpFam.wifeId) personIds.add(gpFam.wifeId);

    for (const sibId of gpFam.childIds) {
      personIds.add(sibId);
      collectPersonFamily(sibId, 0);
    }
  }

  collectSiblingFamilies(fatherId);
  collectSiblingFamilies(motherId);

  // ── Y positions ────────────────────────────────────────────────

  const hasGrandparents = (fatherId && data.persons.get(fatherId)?.familyAsChild) ||
                          (motherId && data.persons.get(motherId)?.familyAsChild);
  const hasParents = fatherId || motherId;

  const rowGP = 0;
  const rowP = hasGrandparents ? ROW_HEIGHT : 0;
  const rowS = rowP + (hasParents ? ROW_HEIGHT : 0);
  const rowC = rowS + ROW_HEIGHT;

  // ── Grandparent family lookups ─────────────────────────────────

  const fatherGpFam = fatherId ? (() => {
    const f = data.persons.get(fatherId);
    return f?.familyAsChild ? data.families.get(f.familyAsChild) : null;
  })() : null;

  const motherGpFam = motherId ? (() => {
    const m = data.persons.get(motherId);
    return m?.familyAsChild ? data.families.get(m.familyAsChild) : null;
  })() : null;

  // ── Create row cursors ─────────────────────────────────────────

  const cursors = new RowCursors();

  // ── Phase 1: Place center person's family at x=0 ──────────────

  const centerInfo = buildFamilyInfo(centerPersonId, data, personIds, familyIds);
  const centerCw = multiCoupleWidth(centerInfo);

  // Collect step-children from each spouse's OTHER marriages — but only their
  // two most recent ones (per user rule: only the newest 2 wed contribute step
  // children). Recency is judged by marriage date when available, falling back
  // to GEDCOM order (familiesAsSpouse insertion order) for undated marriages.
  const stepChildIds = new Set<string>();
  const stepChildFamilyMap = new Map<string, string>(); // childId -> familyId they belong to
  for (const marriage of centerInfo.marriages) {
    if (!marriage.spouseId) continue;
    const spouse = data.persons.get(marriage.spouseId);
    if (!spouse) continue;

    const otherFamIds = spouse.familiesAsSpouse.filter((fid) => fid !== marriage.familyId);
    const ranked = otherFamIds
      .map((fid, idx) => {
        const fam = data.families.get(fid);
        const date = parseBirthDate(fam?.marriageDate || '');
        return { fid, date, idx };
      })
      // Sort by date descending; undated marriages tie-break by their original
      // GEDCOM order descending (later in the list = more recent).
      .sort((a, b) => {
        if (a.date && b.date) return b.date.getTime() - a.date.getTime();
        if (a.date) return -1;
        if (b.date) return 1;
        return b.idx - a.idx;
      })
      .slice(0, 2);

    for (const { fid } of ranked) {
      const sfam = data.families.get(fid);
      if (!sfam) continue;
      for (const scid of sfam.childIds) {
        if (personIds.has(scid) && !centerInfo.children.some(c => c.personId === scid)) {
          stepChildIds.add(scid);
          stepChildFamilyMap.set(scid, fid);
        }
      }
    }
  }

  // Build unified children list: bio children + step-children, sorted by birth
  interface UnifiedChild {
    personId: string;
    isBio: boolean;
    bioChild?: ChildInfo;    // present for bio children
    familyId?: string;       // for step-children: their bio family
  }
  const unifiedChildren: UnifiedChild[] = [];
  for (const c of centerInfo.children) {
    unifiedChildren.push({ personId: c.personId, isBio: true, bioChild: c });
  }
  for (const scid of stepChildIds) {
    unifiedChildren.push({ personId: scid, isBio: false, familyId: stepChildFamilyMap.get(scid) });
  }
  // Sort all children by birth date
  const sortedUnifiedIds = sortByBirth(unifiedChildren.map(u => u.personId), data);
  const sortedUnified = sortedUnifiedIds.map(id => unifiedChildren.find(u => u.personId === id)!);

  // Compute per-grandchild slot width: max(gcCoupleW, greatGcRowW).
  // Precompute and cache so we use the same values in slot computation AND placement.
  const gcSlotWidthCache = new Map<string, number>();
  function getGcSlotWidth(gc: GrandchildInfo): number {
    if (gcSlotWidthCache.has(gc.personId)) return gcSlotWidthCache.get(gc.personId)!;
    const gcCw = coupleWidth(!!gc.rightId);
    const gcInfo = buildFamilyInfo(gc.personId, data, personIds, familyIds);
    if (gcInfo.children.length === 0) { gcSlotWidthCache.set(gc.personId, gcCw); return gcCw; }
    const ggcW = rowWidth(gcInfo.children.map(c => ({ hasSpouse: !!c.rightId })));
    const w = Math.max(gcCw, ggcW);
    gcSlotWidthCache.set(gc.personId, w);
    return w;
  }

  // Compute per-child slot widths using gc slot widths that account for great-gc
  const centerChildSlotWidths = sortedUnified.map(u => {
    if (u.isBio && u.bioChild) {
      const childCw = coupleWidth(!!u.bioChild.rightId);
      if (u.bioChild.grandchildren.length === 0) return childCw;
      const gcSlotWidths = u.bioChild.grandchildren.map(gc => getGcSlotWidth(gc));
      const gcW = gcSlotWidths.reduce((s, w) => s + w, 0)
        + (gcSlotWidths.length - 1) * SIBLING_GAP;
      return Math.max(childCw, gcW);
    }
    return NODE_WIDTH; // step-child is a leaf node
  });
  const centerChildrenW = centerChildSlotWidths.length > 0
    ? centerChildSlotWidths.reduce((s, w) => s + w, 0) + (centerChildSlotWidths.length - 1) * SIBLING_GAP
    : 0;
  const centerUnitW = Math.max(centerCw, centerChildrenW);

  // Center the unit at x=0
  const centerCoupleLeftX = snapToGrid(-centerCw / 2);

  const { junctionXByFamily: centerJuncMap } = placeMultiCouple(
    centerInfo, centerCoupleLeftX, rowS, positions, junctionMap, data,
  );

  cursors.markOccupied(rowS, centerCoupleLeftX, centerCoupleLeftX + centerCw);

  // Place ALL children (bio + step) on rowC — each centered within its slot
  if (sortedUnified.length > 0) {
    const centerCenter = centerCoupleLeftX + centerCw / 2;
    let cx = snapToGrid(centerCenter - centerChildrenW / 2);
    const childrenStart = cx;

    for (let i = 0; i < sortedUnified.length; i++) {
      const unified = sortedUnified[i];
      const slotW = centerChildSlotWidths[i];
      const slotCenterX = cx + slotW / 2;

      if (unified.isBio && unified.bioChild) {
        // Bio child: place as couple with grandchildren
        const child = unified.bioChild;
        const childCw = coupleWidth(!!child.rightId);
        const childLeftX = snapToGrid(slotCenterX - childCw / 2);
        placeCouple(child.leftId, child.rightId, child.familyId, childLeftX, rowC, positions, junctionMap);

        if (child.grandchildren.length > 0) {
          const gcY = rowC + ROW_HEIGHT;
          // Use per-gc slot widths (accounts for great-grandchildren)
          const perGcSlotW = child.grandchildren.map(gc => getGcSlotWidth(gc));
          const gcTotalW = perGcSlotW.reduce((s, w) => s + w, 0)
            + (perGcSlotW.length - 1) * SIBLING_GAP;
          let gcx = snapToGrid(slotCenterX - gcTotalW / 2);

          const gcStartX = gcx;
          for (let gci = 0; gci < child.grandchildren.length; gci++) {
            const gc = child.grandchildren[gci];
            const gcCw = coupleWidth(!!gc.rightId);
            const thisSlotW = perGcSlotW[gci];
            const gcSlotCenterX = gcx + thisSlotW / 2;

            // Center gc couple within its (possibly wider) slot
            const gcLeftX = snapToGrid(gcSlotCenterX - gcCw / 2);
            placeCouple(gc.leftId, gc.rightId, gc.familyId, gcLeftX, gcY, positions, junctionMap);

            // Great-grandchildren: centered within same slot
            const gcInfo = buildFamilyInfo(gc.personId, data, personIds, familyIds);
            if (gcInfo.children.length > 0) {
              const ggcY = gcY + ROW_HEIGHT;
              const ggcW = rowWidth(gcInfo.children.map(c => ({ hasSpouse: !!c.rightId })));
              let ggcx = snapToGrid(gcSlotCenterX - ggcW / 2);

              if (cursors.hasRow(ggcY)) {
                const minGgcx = cursors.getRight(ggcY) + SIBLING_GAP;
                if (ggcx < minGgcx) ggcx = snapToGrid(minGgcx);
              }

              const ggcStartX = ggcx;
              for (const ggc of gcInfo.children) {
                const ggcCw = coupleWidth(!!ggc.rightId);
                placeCouple(ggc.leftId, ggc.rightId, ggc.familyId, ggcx, ggcY, positions, junctionMap);
                ggcx += ggcCw + SIBLING_GAP;
              }
              cursors.markOccupied(ggcY, ggcStartX, ggcx - SIBLING_GAP);
            }

            gcx += thisSlotW + SIBLING_GAP;
          }
          cursors.markOccupied(gcY, gcStartX, gcx - SIBLING_GAP);
        }
      } else {
        // Step-child: place as single node, centered in slot
        const childLeftX = snapToGrid(slotCenterX - NODE_WIDTH / 2);
        if (!positions.has(unified.personId)) {
          positions.set(unified.personId, { x: childLeftX, y: snapToGrid(rowC) });
        }
      }

      cx += slotW + SIBLING_GAP;
    }

    cursors.markOccupied(rowC, childrenStart, cx - SIBLING_GAP);
  }

  // Position junctions for spouse's other marriages (step-child connections).
  // Place them below the spouse's center so edges flow downward (bottom of parent → top of child).
  for (const marriage of centerInfo.marriages) {
    if (!marriage.spouseId) continue;
    const spouse = data.persons.get(marriage.spouseId);
    if (!spouse) continue;
    const spousePos = positions.get(marriage.spouseId);
    if (!spousePos) continue;
    for (const sfid of spouse.familiesAsSpouse) {
      if (sfid === marriage.familyId) continue;
      if (!familyIds.has(sfid)) continue;
      const jId = junctionMap.get(sfid);
      if (!jId || positions.has(jId)) continue;
      const sfam = data.families.get(sfid);
      if (!sfam) continue;
      const exId = sfam.husbandId === marriage.spouseId ? sfam.wifeId : sfam.husbandId;
      const exPos = exId ? positions.get(exId) : null;
      if (exPos) {
        // Junction between spouse and ex (both positioned on same row)
        const leftX = Math.min(spousePos.x, exPos.x) + NODE_WIDTH;
        const rightX = Math.max(spousePos.x, exPos.x);
        const juncX = leftX + (rightX - leftX - JUNCTION_SIZE) / 2;
        const juncY = spousePos.y + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
        positions.set(jId, { x: juncX, y: juncY });
      } else {
        // Ex not on screen — position junction below spouse's center (for edge routing)
        // but mark it as hidden so we don't render the dot
        const juncX = spousePos.x + (NODE_WIDTH - JUNCTION_SIZE) / 2;
        const juncY = spousePos.y + NODE_HEIGHT + (PARENT_CHILD_GAP - JUNCTION_SIZE) / 2 - BLOCK / 2;
        positions.set(jId, { x: juncX, y: juncY });
      }
    }
  }

  // ── Phase 2: Center person's siblings expand RIGHT on rowS ─────
  // Includes both full siblings (from birth family) AND half-siblings
  // (from parent's other marriages)

  if (birthFam) {
    // Full siblings from birth family
    const fullSibs = birthFam.childIds.filter(c => personIds.has(c) && c !== centerPersonId);

    // Half-siblings from parent's other marriages
    const halfSibIds = new Set<string>();
    for (const parentId of [fatherId, motherId]) {
      if (!parentId) continue;
      const parent = data.persons.get(parentId);
      if (!parent) continue;
      for (const pfid of parent.familiesAsSpouse) {
        if (pfid === birthFam.id) continue; // skip birth family
        const pfam = data.families.get(pfid);
        if (!pfam) continue;
        for (const cid of pfam.childIds) {
          if (personIds.has(cid) && cid !== centerPersonId && !fullSibs.includes(cid)) {
            halfSibIds.add(cid);
          }
        }
      }
    }

    const allSibs = sortByBirth([...fullSibs, ...halfSibIds], data);

    for (const sibId of allSibs) {
      if (positions.has(sibId)) continue; // skip if already positioned
      const sibInfo = buildFamilyInfo(sibId, data, personIds, familyIds);
      placeUnitRightward(sibInfo, rowS, rowC, cursors, positions, junctionMap, data);
    }
  }

  // ── Phase 3: Parents centered above all siblings on rowP ───────
  // Uses buildFamilyInfo + placeMultiCouple to handle multi-marriage parents
  // (e.g., father with two wives shows both wives)

  if (birthFam && (fatherId || motherId)) {
    const rowSLeft = cursors.getLeft(rowS);
    const rowSRight = cursors.getRight(rowS);
    const parentCenterX = (rowSLeft + rowSRight) / 2;
    const snRowP = snapToGrid(rowP);

    if (fatherId && motherId) {
      // Collect father's and mother's EXTRA marriages (excluding the shared birth family).
      // We place the birth-family couple (father + mother) directly, then expand
      // extra wives to the LEFT and extra husbands to the RIGHT.
      // This prevents double-counting the shared couple in width calculations.
      const fatherExtraMarriages: { spouseId: string; familyId: string }[] = [];
      const motherExtraMarriages: { spouseId: string; familyId: string }[] = [];
      const fatherPerson = data.persons.get(fatherId);
      const motherPerson = data.persons.get(motherId);

      if (fatherPerson) {
        for (const fid of fatherPerson.familiesAsSpouse) {
          if (fid === birthFam.id || !familyIds.has(fid)) continue;
          const fm = data.families.get(fid);
          if (!fm) continue;
          const sid = fm.husbandId === fatherId ? fm.wifeId : fm.husbandId;
          if (sid && personIds.has(sid)) {
            fatherExtraMarriages.push({ spouseId: sid, familyId: fid });
          }
        }
      }
      if (motherPerson) {
        for (const fid of motherPerson.familiesAsSpouse) {
          if (fid === birthFam.id || !familyIds.has(fid)) continue;
          const fm = data.families.get(fid);
          if (!fm) continue;
          const sid = fm.husbandId === motherId ? fm.wifeId : fm.husbandId;
          if (sid && personIds.has(sid)) {
            motherExtraMarriages.push({ spouseId: sid, familyId: fid });
          }
        }
      }

      // Width: extra wives LEFT + father + gap + junction + gap + mother + extra husbands RIGHT
      const extraLeftW = fatherExtraMarriages.length * (NODE_WIDTH + SPOUSE_GAP);
      const extraRightW = motherExtraMarriages.length * (NODE_WIDTH + SPOUSE_GAP);
      const birthCoupleCw = coupleWidth(true); // father + mother = 440
      const totalParentW = extraLeftW + birthCoupleCw + extraRightW;
      const parentLeftX = snapToGrid(parentCenterX - totalParentW / 2);

      // Place father's extra wives to the LEFT (ex-wives, step-mothers)
      let leftX = snapToGrid(parentLeftX);
      const juncY = snRowP + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
      for (const extra of fatherExtraMarriages) {
        if (!positions.has(extra.spouseId)) {
          positions.set(extra.spouseId, { x: leftX, y: snRowP });
        }
        // Junction between extra wife and father
        if (extra.familyId) {
          const jId = junctionMap.get(extra.familyId);
          if (jId) {
            const juncXExtra = leftX + NODE_WIDTH + (SPOUSE_GAP - JUNCTION_SIZE) / 2;
            positions.set(jId, { x: juncXExtra, y: juncY });
          }
        }
        leftX = snapToGrid(leftX + NODE_WIDTH + SPOUSE_GAP);
      }

      // Place the birth-family couple: father on LEFT, mother on RIGHT
      const fatherX = leftX;
      placeCouple(fatherId, motherId, birthFam.id, fatherX, rowP, positions, junctionMap);
      const motherX = snapToGrid(fatherX + NODE_WIDTH + SPOUSE_GAP);

      // Place mother's extra husbands to the RIGHT (ex-husbands, step-fathers)
      let rightX = snapToGrid(motherX + NODE_WIDTH + SPOUSE_GAP);
      for (const extra of motherExtraMarriages) {
        if (!positions.has(extra.spouseId)) {
          positions.set(extra.spouseId, { x: rightX, y: snRowP });
        }
        // Junction between mother and extra husband
        if (extra.familyId) {
          const jId = junctionMap.get(extra.familyId);
          if (jId) {
            const juncXExtra = rightX - SPOUSE_GAP + (SPOUSE_GAP - JUNCTION_SIZE) / 2;
            positions.set(jId, { x: juncXExtra, y: juncY });
          }
        }
        rightX = snapToGrid(rightX + NODE_WIDTH + SPOUSE_GAP);
      }

      const totalRightEdge = rightX > motherX + NODE_WIDTH + SPOUSE_GAP
        ? rightX - SPOUSE_GAP
        : motherX + NODE_WIDTH;
      cursors.markOccupied(rowP, parentLeftX, totalRightEdge);
    } else if (fatherId) {
      const fatherInfo = buildFamilyInfo(fatherId, data, personIds, familyIds);
      const fatherCw = multiCoupleWidth(fatherInfo);
      const parentLeftX = snapToGrid(parentCenterX - fatherCw / 2);
      placeMultiCouple(fatherInfo, parentLeftX, rowP, positions, junctionMap, data);
      const jId = junctionMap.get(birthFam.id);
      if (jId) {
        positions.set(jId, {
          x: parentLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
          y: snRowP + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
        });
      }
      cursors.markOccupied(rowP, parentLeftX, parentLeftX + fatherCw);
    } else if (motherId) {
      const motherInfo = buildFamilyInfo(motherId, data, personIds, familyIds);
      const motherCw = multiCoupleWidth(motherInfo);
      const parentLeftX = snapToGrid(parentCenterX - motherCw / 2);
      placeMultiCouple(motherInfo, parentLeftX, rowP, positions, junctionMap, data);
      const jId = junctionMap.get(birthFam.id);
      if (jId) {
        positions.set(jId, {
          x: parentLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
          y: snRowP + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
        });
      }
      cursors.markOccupied(rowP, parentLeftX, parentLeftX + motherCw);
    }
  }

  // ── Phase 4a: Father's siblings expand LEFT on rowP ────────────
  //    Their children go on rowS, grandchildren on rowC.
  //    Multi-row constraint ensures no overlaps with center's family.

  if (fatherGpFam && fatherId) {
    const patSibs = sortByBirth(
      fatherGpFam.childIds.filter(c => personIds.has(c) && c !== fatherId), data,
    );
    // Reverse order so older uncles are farther left
    const reversedPatSibs = [...patSibs].reverse();

    for (const uncleId of reversedPatSibs) {
      const uncleInfo = buildFamilyInfo(uncleId, data, personIds, familyIds);
      placeUnitLeftward(uncleInfo, rowP, rowS, cursors, positions, junctionMap, data);
    }
  }

  // ── Phase 4b: Mother's siblings expand RIGHT on rowP ───────────

  if (motherGpFam && motherId) {
    const matSibs = sortByBirth(
      motherGpFam.childIds.filter(c => personIds.has(c) && c !== motherId), data,
    );

    for (const auntId of matSibs) {
      const auntInfo = buildFamilyInfo(auntId, data, personIds, familyIds);
      placeUnitRightward(auntInfo, rowP, rowS, cursors, positions, junctionMap, data);
    }
  }

  // ── Phase 5: Grandparents centered above each side ─────────────

  if (fatherGpFam) {
    // Center paternal grandparents above ALL paternal-side content on rowP
    // Use the full rowP extent from the left edge (father's siblings) to father's position
    const fatherPos = fatherId ? positions.get(fatherId) : null;
    const patLeft = cursors.getLeft(rowP);
    const patRight = fatherPos ? fatherPos.x + NODE_WIDTH : cursors.getRight(rowP);
    const patCenter = (patLeft + patRight) / 2;

    const gpCw = coupleWidth(!!(fatherGpFam.husbandId && fatherGpFam.wifeId));
    const gpLeftX = snapToGrid(patCenter - gpCw / 2);
    const snRowGP = snapToGrid(rowGP);

    if (fatherGpFam.husbandId && fatherGpFam.wifeId) {
      positions.set(fatherGpFam.husbandId, { x: gpLeftX, y: snRowGP });
      const gpRightX = snapToGrid(gpLeftX + NODE_WIDTH + SPOUSE_GAP);
      positions.set(fatherGpFam.wifeId, { x: gpRightX, y: snRowGP });

      const juncX = gpLeftX + NODE_WIDTH + (gpRightX - gpLeftX - NODE_WIDTH - JUNCTION_SIZE) / 2;
      const juncY = snRowGP + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(fatherGpFam.id);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
    } else if (fatherGpFam.husbandId) {
      positions.set(fatherGpFam.husbandId, { x: gpLeftX, y: snRowGP });
      const jId = junctionMap.get(fatherGpFam.id);
      if (jId) {
        positions.set(jId, {
          x: gpLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
          y: snRowGP + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
        });
      }
    } else if (fatherGpFam.wifeId) {
      positions.set(fatherGpFam.wifeId, { x: gpLeftX, y: snRowGP });
      const jId = junctionMap.get(fatherGpFam.id);
      if (jId) {
        positions.set(jId, {
          x: gpLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
          y: snRowGP + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
        });
      }
    }
  }

  if (motherGpFam) {
    // Center maternal grandparents above ALL maternal-side content on rowP
    const motherPos = motherId ? positions.get(motherId) : null;
    const matLeft = motherPos ? motherPos.x : cursors.getLeft(rowP);
    const matRight = cursors.getRight(rowP);
    const matCenter = (matLeft + matRight) / 2;

    const gpCw = coupleWidth(!!(motherGpFam.husbandId && motherGpFam.wifeId));
    const gpLeftX = snapToGrid(matCenter - gpCw / 2);
    const snRowGP = snapToGrid(rowGP);

    if (motherGpFam.husbandId && motherGpFam.wifeId) {
      positions.set(motherGpFam.husbandId, { x: gpLeftX, y: snRowGP });
      const gpRightX = snapToGrid(gpLeftX + NODE_WIDTH + SPOUSE_GAP);
      positions.set(motherGpFam.wifeId, { x: gpRightX, y: snRowGP });

      const juncX = gpLeftX + NODE_WIDTH + (gpRightX - gpLeftX - NODE_WIDTH - JUNCTION_SIZE) / 2;
      const juncY = snRowGP + (NODE_HEIGHT - JUNCTION_SIZE) / 2;
      const jId = junctionMap.get(motherGpFam.id);
      if (jId) positions.set(jId, { x: juncX, y: juncY });
    } else if (motherGpFam.husbandId) {
      positions.set(motherGpFam.husbandId, { x: gpLeftX, y: snRowGP });
      const jId = junctionMap.get(motherGpFam.id);
      if (jId) {
        positions.set(jId, {
          x: gpLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
          y: snRowGP + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
        });
      }
    } else if (motherGpFam.wifeId) {
      positions.set(motherGpFam.wifeId, { x: gpLeftX, y: snRowGP });
      const jId = junctionMap.get(motherGpFam.id);
      if (jId) {
        positions.set(jId, {
          x: gpLeftX + (NODE_WIDTH - JUNCTION_SIZE) / 2,
          y: snRowGP + (NODE_HEIGHT - JUNCTION_SIZE) / 2,
        });
      }
    }
  }

  // ── Fallback: no parents, just center + siblings ───────────────

  if (!birthFam && !fatherId && !motherId) {
    // Center person is already positioned. Nothing else to do for phases 2-5.
  }

  // ── Phase 6: Shift so center person is at (0, 0) ──────────────

  const centerPos = positions.get(centerPersonId);
  if (centerPos) {
    const sx = -centerPos.x;
    const sy = -centerPos.y;
    for (const pos of positions.values()) { pos.x += sx; pos.y += sy; }
  }

  // ── Compute relationship levels for edge thickness ─────────────

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
    if (!label.includes('Grand')) return label;
    if (label.includes('Paternal') || label.includes('Maternal')) return label;
    const isPat = paternalAncestors.has(pid) && !maternalAncestors.has(pid);
    const isMat = maternalAncestors.has(pid) && !paternalAncestors.has(pid);
    if (isPat) return `Paternal ${label}`;
    if (isMat) return `Maternal ${label}`;
    return label;
  }

  // Level -> edge style
  function edgeStyle(level: number): { stroke: string; strokeWidth: number } {
    switch (level) {
      case 0: return { stroke: '#475569', strokeWidth: 3.5 };
      case 1: return { stroke: '#64748b', strokeWidth: 2.5 };
      case 2: return { stroke: '#94a3b8', strokeWidth: 2 };
      case 3: return { stroke: '#94a3b8', strokeWidth: 1.5 };
      case 4: return { stroke: '#cbd5e1', strokeWidth: 1.2 };
      case 5: return { stroke: '#cbd5e1', strokeWidth: 1 };
      default: return { stroke: '#e2e8f0', strokeWidth: 0.8 };
    }
  }

  // ── Build React Flow nodes ─────────────────────────────────────

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

    // For step-child junctions: if one spouse isn't positioned (ex off-screen),
    // show their name on hover
    let hoverLabel: string | undefined;
    if (hasH && !hasW && wifeId) {
      const w = data.persons.get(wifeId);
      if (w) hoverLabel = `${w.givenName} ${w.surname}`.trim() || 'Unknown';
    } else if (hasW && !hasH && husbId) {
      const h = data.persons.get(husbId);
      if (h) hoverLabel = `${h.givenName} ${h.surname}`.trim() || 'Unknown';
    }

    nodes.push({
      id: juncId, type: 'familyNode',
      position: { x: juncPos.x, y: juncPos.y },
      data: { familyId: famId, marriageDate: family.marriageDate, hoverLabel } satisfies FamilyNodeData as unknown as Record<string, unknown>,
    });

    const isExMarriage = isExFamily(famId, data);

    const dashedStyle = isExMarriage ? { strokeDasharray: '6 3' } : {};

    // Determine edge handle direction based on actual positions (not hardcoded gender)
    if (hasH) {
      const eid = `${husbId}->${juncId}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        const level = Math.max(relLevels.get(husbId!) ?? 6, relLevels.get(wifeId || '') ?? 6);
        const husbPos = positions.get(husbId!);
        // If junction is below the spouse (step-child junction), use bottom/top handles
        const isBelowHusb = husbPos && juncPos.y > husbPos.y + NODE_HEIGHT / 2;
        const isLeftOfJunc = husbPos && husbPos.x < juncPos.x;
        edges.push({ id: eid, source: husbId!, target: juncId,
          sourceHandle: isBelowHusb ? 'bottom' : isLeftOfJunc ? 'right' : 'left',
          targetHandle: isBelowHusb ? 'top' : isLeftOfJunc ? 'left' : 'right',
          type: isBelowHusb ? 'smoothstep' : 'straight',
          style: { ...edgeStyle(level), ...dashedStyle } });
      }
    }
    if (hasW) {
      const eid = `${wifeId}->${juncId}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        const level = Math.max(relLevels.get(husbId || '') ?? 6, relLevels.get(wifeId!) ?? 6);
        const wifePos = positions.get(wifeId!);
        // If junction is below the spouse (step-child junction), use bottom/top handles
        const isBelowWife = wifePos && juncPos.y > wifePos.y + NODE_HEIGHT / 2;
        const isRightOfJunc = wifePos && wifePos.x > juncPos.x;
        edges.push({ id: eid, source: wifeId!, target: juncId,
          sourceHandle: isBelowWife ? 'bottom' : isRightOfJunc ? 'left' : 'right',
          targetHandle: isBelowWife ? 'top' : isRightOfJunc ? 'right' : 'left',
          type: isBelowWife ? 'smoothstep' : 'straight',
          style: { ...edgeStyle(level), ...dashedStyle } });
      }
    }
    for (const cid of kids) {
      const eid = `${juncId}->${cid}`;
      if (!addedEdges.has(eid)) {
        addedEdges.add(eid);
        const level = relLevels.get(cid) ?? 6;
        // Check if child's birth family matches this junction's family
        // If not, this is a step-child connection → dashed
        const child = data.persons.get(cid);
        const isBioChild = child?.familyAsChild === famId;
        const childDashed = !isBioChild ? { strokeDasharray: '6 3' } : {};
        edges.push({ id: eid, source: juncId, target: cid, sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { ...edgeStyle(level), ...childDashed } });
      }
    }
  }

  return { nodes, edges };
}
