/**
 * Relationship path layout — builds React Flow nodes/edges for the
 * Relationship Mapper.
 *
 * Handles:
 *   - Direct ancestors (single chain rendered in one column).
 *   - Nth cousins M times removed (two chains branching from an LCA / LCA
 *     couple) at arbitrary depth.
 *   - Endpoint siblings rendered under a shared "sibling bus" so the
 *     endpoint + siblings form a clean T-junction under their parent.
 *
 * Edge routing:
 *   All descent/sibling edges are `smoothstep` with a small `offset` so the
 *   horizontal bend lands inside the inter-row gap. This prevents edges from
 *   cutting through node boxes at arbitrary depth.
 *
 * Spouse connectors are straight lines between a person's inner edge and the
 * adjacent junction — the person's left/right handle is chosen from its x
 * position relative to the junction, so the line never crosses the node body.
 */
import { type Node, type Edge } from '@xyflow/react';

// React Flow's runtime forwards `pathOptions` from edge objects to edge
// components (see @xyflow/react EdgeWrapper), but the exported `Edge` type
// doesn't include it. This local shape lets us type our edges precisely
// and cast once when pushing into the Edge[] array.
type SmoothStepEdgeInput = Edge & {
  type: 'smoothstep';
  pathOptions?: { offset?: number; borderRadius?: number };
};
import { GedcomData } from './types';
import {
  type RelationshipPath,
  getPathSpouseId,
} from './relationship-path';
import { calculateRelationship } from './relationship-calculator';
import type { PersonNodeData } from '@/components/PersonNode';
import type { FamilyNodeData } from '@/components/FamilyNode';

// ── Geometry constants ───────────────────────────────────────────────
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const SPOUSE_GAP = 40;
const ROW_GAP = 60;
const ROW_HEIGHT = NODE_HEIGHT + ROW_GAP; // 140
const SIBLING_GAP = 40;
const JUNCTION_SIZE = 8;

/** Inner / outer column centers inside one chain (relative to chainCenter). */
const INNER_OFFSET = NODE_WIDTH / 2 + SPOUSE_GAP / 2; // 120

/** Minimum distance from x=0 to each chain column's center in a two-chain
 *  layout. The actual offset is computed dynamically from the left/right
 *  kid-row widths so neither group collides horizontally. */
const MIN_CHAIN_CENTER_OFFSET = 360;

/** Horizontal bend offset for descent/sibling edges. Keeps the step bend
 *  inside the row gap so lines never slice through node boxes. */
const DESCENT_EDGE_OFFSET = 24;
const SIB_EDGE_OFFSET = 6;

/** Distance from the sibling bus (invisible junction) up to the parent-row
 *  junction bottom, and down to the children row top. */
const SIB_BUS_DROP = 28;

const EDGE_COLOR_MALE = '#60a5fa';
const EDGE_COLOR_FEMALE = '#f472b6';
const EDGE_COLOR_NEUTRAL = '#94a3b8';

function colorForSex(sex: 'M' | 'F' | 'U' | undefined): string {
  if (sex === 'M') return EDGE_COLOR_MALE;
  if (sex === 'F') return EDGE_COLOR_FEMALE;
  return EDGE_COLOR_NEUTRAL;
}

export interface RelationshipLayoutResult {
  nodes: Node[];
  edges: Edge[];
}

/** One placed row inside a chain — just below the LCA or further down. */
interface LaidRow {
  gen: number;
  rowTopY: number;
  rowCenterY: number;
  spineId: string;
  spineCenterX: number;
  spouseId: string | null;
  /** Couple-junction id, or null if this row has no spouse. */
  junctionId: string | null;
  /** X center of whatever sits between spouses (junction) or of the spine if
   *  there is no spouse at this row. Used to align descent drops. */
  junctionCenterX: number;
  /** Descent source going OUT of this row (downward into the next row). */
  descentOutId: string;
  descentOutHandle: 'bottom';
  /** Descent target coming INTO this row from above. */
  descentInId: string;
  descentInHandle: 'top';
  /** Sex of the spine person — used to color the drop leaving this row. */
  parentSex: 'M' | 'F' | 'U' | undefined;
  /** Endpoint-row only: the birth-ordered kid list at this row (endpoint
   *  + siblings), the per-kid center X, and the parent-junction center X
   *  the group was centered under. Used by the sibling-bus wiring. */
  endpointKidIds?: string[];
  endpointKidCenterXs?: number[];
  endpointParentCenterX?: number;
}

export function buildRelationshipLayout(
  path: RelationshipPath,
  data: GedcomData
): RelationshipLayoutResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const placed = new Set<string>();

  // ── Node/edge helpers ──────────────────────────────────────────────

  // Each placed person gets a relationship label computed from the START
  // person's perspective ("Ronald is Father of William", etc.). Cache so
  // calculateRelationship only runs once per person even if addPerson is
  // called multiple times for the same id.
  const relationshipLabelCache = new Map<string, string | undefined>();
  const labelForPerson = (personId: string): string | undefined => {
    if (personId === path.startId) return undefined;
    const cached = relationshipLabelCache.get(personId);
    if (cached !== undefined || relationshipLabelCache.has(personId)) return cached;
    const label = calculateRelationship(personId, path.startId, data) || undefined;
    relationshipLabelCache.set(personId, label);
    return label;
  };

  const addPerson = (
    id: string,
    topLeftX: number,
    topLeftY: number,
    opts: { isEndpoint?: boolean; isLca?: boolean } = {}
  ): boolean => {
    if (placed.has(id)) return false;
    const p = data.persons.get(id);
    if (!p) return false;
    // The two queried people get distinct highlights regardless of where
    // they land in the chain (endpoint, LCA, or in between): start gets
    // amber, end gets violet.
    const isStart = id === path.startId;
    const isEnd = id === path.endId;
    const d: PersonNodeData = {
      personId: id,
      label: `${p.givenName} ${p.surname}`.trim(),
      surname: p.surname,
      birthDate: p.birthDate,
      deathDate: p.deathDate,
      sex: p.sex,
      isLiving: p.isLiving,
      isSelected: isStart,
      isEndSelection: isEnd,
      isBloodRelative: true,
      hasInLawFamily: false,
      isInLawExpanded: false,
      hasParents: !!p.familyAsChild,
      hasChildren: p.familiesAsSpouse.length > 0,
      relationshipLabel: labelForPerson(id),
    };
    // Fall back to the legacy "Common Ancestor" tag if the calculator
    // returned nothing for the LCA (shouldn't happen in practice but
    // keeps the anchor from rendering unlabeled).
    if (!d.relationshipLabel && opts.isLca) {
      d.relationshipLabel = 'Common Ancestor';
    }
    void opts.isEndpoint;
    nodes.push({
      id,
      type: 'personNode',
      position: { x: topLeftX, y: topLeftY },
      data: d as unknown as Record<string, unknown>,
    });
    placed.add(id);
    return true;
  };

  const addJunction = (id: string, centerX: number, centerY: number): void => {
    if (placed.has(id)) return;
    const d: FamilyNodeData = { familyId: id };
    nodes.push({
      id,
      type: 'familyNode',
      position: {
        x: centerX - JUNCTION_SIZE / 2,
        y: centerY - JUNCTION_SIZE / 2,
      },
      data: d as unknown as Record<string, unknown>,
    });
    placed.add(id);
  };

  /** Draws a short straight line from a person's inner edge to an adjacent
   *  junction. Handle is chosen from the person's position relative to the
   *  junction, so the line never crosses the person's box. */
  const addSpouseConn = (
    personId: string,
    junctionId: string,
    personCenterX: number,
    junctionCenterX: number
  ): void => {
    const personIsLeft = personCenterX < junctionCenterX;
    edges.push({
      id: `spouseconn-${personId}-${junctionId}`,
      source: personId,
      sourceHandle: personIsLeft ? 'right' : 'left',
      target: junctionId,
      targetHandle: personIsLeft ? 'left' : 'right',
      type: 'straight',
      style: { stroke: EDGE_COLOR_NEUTRAL, strokeWidth: 2 },
    });
  };

  /** Generational descent edge from an upper-row source to a lower-row
   *  target. Uses smoothstep with a small offset so the horizontal bend
   *  sits inside the inter-row gap and never crosses a node box. */
  const addDescent = (
    sourceId: string,
    sourceHandle: string,
    targetId: string,
    targetHandle: string,
    throughSex: 'M' | 'F' | 'U' | undefined,
    key: string
  ): void => {
    const e: SmoothStepEdgeInput = {
      id: `descent-${key}-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle,
      target: targetId,
      targetHandle,
      type: 'smoothstep',
      pathOptions: { offset: DESCENT_EDGE_OFFSET, borderRadius: 10 },
      style: { stroke: colorForSex(throughSex), strokeWidth: 2.5 },
    };
    edges.push(e);
  };

  /** Dashed neutral descent edge used for children who are NOT on the
   *  blood path (spine siblings, cousins, etc.). Same routing geometry
   *  as addDescent so bends still land inside the row gap. */
  const addCollateralDescent = (
    sourceId: string,
    sourceHandle: string,
    targetId: string,
    targetHandle: string,
    key: string
  ): void => {
    const e: SmoothStepEdgeInput = {
      id: `collateral-${key}-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle,
      target: targetId,
      targetHandle,
      type: 'smoothstep',
      pathOptions: { offset: DESCENT_EDGE_OFFSET, borderRadius: 10 },
      style: {
        stroke: EDGE_COLOR_NEUTRAL,
        strokeWidth: 2,
        strokeDasharray: '4 4',
      },
    };
    edges.push(e);
  };

  /** Tight-bend edge from the sibling bus to one child. Solid for the
   *  endpoint's own drop, dashed neutral for sibling drops. */
  const addSibBusEdge = (
    sourceId: string,
    targetId: string,
    targetHandle: string,
    color: string,
    dashed: boolean,
    key: string
  ): void => {
    const e: SmoothStepEdgeInput = {
      id: `sibbus-${key}-${targetId}`,
      source: sourceId,
      sourceHandle: 'bottom',
      target: targetId,
      targetHandle,
      type: 'smoothstep',
      pathOptions: { offset: SIB_EDGE_OFFSET, borderRadius: 6 },
      style: {
        stroke: color,
        strokeWidth: 2,
        ...(dashed ? { strokeDasharray: '4 4' } : {}),
      },
    };
    edges.push(e);
  };

  // ── 1. LCA row ─────────────────────────────────────────────────────

  const lcaRowTopY = 0;
  const lcaRowCenterY = lcaRowTopY + NODE_HEIGHT / 2;
  const lcaAnchorSex = data.persons.get(path.lcaAnchorId)?.sex;

  let lcaDescentSourceId: string;
  let lcaDescentSourceHandle: 'bottom';

  if (path.lcaIds.length === 2) {
    // LCA couple — place male-left/female-right by sex, centered on x=0.
    const anchorId = path.lcaAnchorId;
    const otherId = path.lcaIds.find(id => id !== anchorId)!;
    const anchor = data.persons.get(anchorId)!;
    let leftId = anchorId;
    let rightId = otherId;
    if (anchor.sex === 'F') { leftId = otherId; rightId = anchorId; }

    const leftCenterX = -INNER_OFFSET;
    const rightCenterX = +INNER_OFFSET;
    addPerson(leftId, leftCenterX - NODE_WIDTH / 2, lcaRowTopY, { isLca: true });
    addPerson(rightId, rightCenterX - NODE_WIDTH / 2, lcaRowTopY, { isLca: true });

    const lcaJunctionId = 'junction-lca';
    addJunction(lcaJunctionId, 0, lcaRowCenterY);
    addSpouseConn(leftId, lcaJunctionId, leftCenterX, 0);
    addSpouseConn(rightId, lcaJunctionId, rightCenterX, 0);

    lcaDescentSourceId = lcaJunctionId;
    lcaDescentSourceHandle = 'bottom';
  } else {
    // Single LCA (direct ancestor case) — LCA sits on the spine column so
    // the entire blood line runs as a single straight vertical through
    // every spine person, the LCA, and the endpoint.
    const lcaId = path.lcaIds[0];
    const lcaCenterX = +INNER_OFFSET; // matches chainGeometry('center').spineCenterX
    addPerson(lcaId, lcaCenterX - NODE_WIDTH / 2, lcaRowTopY, { isLca: true });
    lcaDescentSourceId = lcaId;
    lcaDescentSourceHandle = 'bottom';
  }

  // ── Birth-order helper ─────────────────────────────────────────────
  //
  // GEDCOM `childIds` is in file order, which is USUALLY birth order but
  // not guaranteed. We sort by parsed birth year (ascending = oldest
  // first), keeping file order as a stable tiebreaker for siblings with
  // missing or identical years.
  const birthYearOf = (personId: string): number => {
    const p = data.persons.get(personId);
    const m = p?.birthDate?.match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };
  const sortByBirth = (ids: readonly string[]): string[] => {
    const withIdx = ids.map((id, idx) => ({ id, idx, year: birthYearOf(id) }));
    withIdx.sort((a, b) => a.year - b.year || a.idx - b.idx);
    return withIdx.map(x => x.id);
  };

  // ── 2. Compute dynamic chain spacing ───────────────────────────────

  /** Number of children in the family the given person was born into.
   *  Used to pre-compute how wide each endpoint's kid-row will be so we
   *  can position the chains far enough apart to avoid collisions. */
  const kidCountForEndpoint = (endpointId: string): number => {
    const p = data.persons.get(endpointId);
    if (!p?.familyAsChild) return 1;
    const fam = data.families.get(p.familyAsChild);
    return fam?.childIds.length || 1;
  };

  const leftKidCount = kidCountForEndpoint(path.startChain[0]);
  const rightKidCount = kidCountForEndpoint(path.endChain[0]);
  const kidRowWidth = (n: number) =>
    n * NODE_WIDTH + Math.max(0, n - 1) * SIBLING_GAP;
  const dynamicChainOffset = Math.max(
    MIN_CHAIN_CENTER_OFFSET,
    (kidRowWidth(leftKidCount) + kidRowWidth(rightKidCount)) / 4 + SIBLING_GAP * 2
  );

  const chainCenterForSide = (side: 'left' | 'right' | 'center'): number =>
    side === 'left'
      ? -dynamicChainOffset
      : side === 'right'
        ? +dynamicChainOffset
        : 0;

  /** Male-left / female-right couple placement, given a chain center and
   *  the spine's sex. The spine lands on the male side if male (or
   *  unknown), on the female side if female. */
  const couplePositions = (
    chainCenter: number,
    spineSex: 'M' | 'F' | 'U' | undefined
  ) => {
    const spineOnRight = spineSex === 'F';
    return {
      spineCenterX: chainCenter + (spineOnRight ? +INNER_OFFSET : -INNER_OFFSET),
      spouseCenterX: chainCenter + (spineOnRight ? -INNER_OFFSET : +INNER_OFFSET),
    };
  };

  const layChain = (
    chain: string[],
    side: 'left' | 'right' | 'center'
  ): LaidRow[] => {
    const rows: LaidRow[] = [];
    const chainCenter = chainCenterForSide(side);

    // Walk from LCA-adjacent (chain.length - 2) down to the endpoint (0).
    for (let i = chain.length - 2; i >= 0; i--) {
      const personId = chain[i];
      const spinePerson = data.persons.get(personId);
      const spineSex = spinePerson?.sex;
      const gen = chain.length - 1 - i;
      const rowTopY = gen * ROW_HEIGHT;
      const rowCenterY = rowTopY + NODE_HEIGHT / 2;
      const isEndpoint = i === 0;

      if (isEndpoint) {
        // Endpoint row: lay out the endpoint AND all of its siblings in
        // birth order (family.childIds order), centered under the parent
        // couple's junction — which is the previous row's junctionCenterX
        // (= chainCenter if the parent had a spouse, else the parent's
        // spine column). For cousin cases with no parent row (shouldn't
        // really happen), fall back to chainCenter.
        const parentRow = rows.length > 0 ? rows[rows.length - 1] : null;
        const parentCenterX = parentRow ? parentRow.junctionCenterX : chainCenter;

        let kidIds: string[] = [];
        if (spinePerson?.familyAsChild) {
          const fam = data.families.get(spinePerson.familyAsChild);
          if (fam) kidIds = sortByBirth(fam.childIds);
        }
        if (kidIds.length === 0) kidIds = [personId];

        const N = kidIds.length;
        const totalW = kidRowWidth(N);
        const firstCenterX = parentCenterX - totalW / 2 + NODE_WIDTH / 2;
        const kidCenterXs: number[] = [];
        for (let k = 0; k < N; k++) {
          const kidId = kidIds[k];
          const kidCenterX = firstCenterX + k * (NODE_WIDTH + SIBLING_GAP);
          addPerson(kidId, kidCenterX - NODE_WIDTH / 2, rowTopY, {
            isEndpoint: kidId === personId,
          });
          kidCenterXs.push(kidCenterX);
        }

        const endpointIdx = Math.max(0, kidIds.indexOf(personId));
        const endpointCenterX = kidCenterXs[endpointIdx] ?? firstCenterX;

        rows.push({
          gen,
          rowTopY,
          rowCenterY,
          spineId: personId,
          spineCenterX: endpointCenterX,
          spouseId: null,
          junctionId: null,
          junctionCenterX: endpointCenterX,
          descentOutId: personId,
          descentOutHandle: 'bottom',
          descentInId: personId,
          descentInHandle: 'top',
          parentSex: spineSex,
          endpointKidIds: kidIds,
          endpointKidCenterXs: kidCenterXs,
          endpointParentCenterX: parentCenterX,
        });
        continue;
      }

      // Ancestor row: spine + path-spouse (if found) around a junction.
      // Uses male-left / female-right convention based on spine's sex.
      //
      // Edge anchoring rule:
      //   - Descent OUT of this row starts at the couple junction's bottom
      //     (line emerges from the marriage midpoint between parents).
      //   - Descent IN to this row terminates at the spine person's top
      //     (line plants into the middle of the blood child).
      const { spineCenterX, spouseCenterX } = couplePositions(chainCenter, spineSex);
      const spouseId = getPathSpouseId(personId, chain[i - 1], data);

      addPerson(personId, spineCenterX - NODE_WIDTH / 2, rowTopY);

      let junctionId: string | null = null;
      let junctionCenterX = spineCenterX;

      if (spouseId && addPerson(spouseId, spouseCenterX - NODE_WIDTH / 2, rowTopY)) {
        junctionId = `junction-${personId}`;
        addJunction(junctionId, chainCenter, rowCenterY);
        addSpouseConn(personId, junctionId, spineCenterX, chainCenter);
        addSpouseConn(spouseId, junctionId, spouseCenterX, chainCenter);
        junctionCenterX = chainCenter;
      }

      rows.push({
        gen,
        rowTopY,
        rowCenterY,
        spineId: personId,
        spineCenterX,
        spouseId,
        junctionId,
        junctionCenterX,
        descentOutId: junctionId ?? personId,
        descentOutHandle: 'bottom',
        descentInId: personId,
        descentInHandle: 'top',
        parentSex: spineSex,
      });
    }
    return rows;
  };

  // ── 2b. Spine siblings (Piece 2) ───────────────────────────────────
  //
  // At every non-endpoint spine row, place the spine person's OTHER
  // siblings (children of the same birth family) as their own couples
  // flanking outward from the chain's center. Each gets a dashed
  // collateral-descent edge from the parent couple junction above. No
  // kids of these siblings are rendered yet — that's Piece 3.

  /** Size of a full "couple slot" (spine + spouse with gap). */
  const COUPLE_SLOT_W = NODE_WIDTH * 2 + SPOUSE_GAP; // 440

  /** Kid row width for one spine sibling (0 if none). Piece 3 renders
   *  this many boxes directly under the sibling couple, one row down. */
  const spineSibKidsWidth = (sibId: string): number => {
    const sib = data.persons.get(sibId);
    if (!sib) return 0;
    for (const famId of sib.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      if (fam.childIds.length > 0) {
        return kidRowWidth(fam.childIds.length);
      }
    }
    return 0;
  };

  /** Width of the spine sibling's OWN row slot = max(couple width, kid
   *  row width). Used to decide how much horizontal breathing room the
   *  sibling's column consumes at its own row. */
  const spineSibSubtreeWidth = (sibId: string): number =>
    Math.max(COUPLE_SLOT_W, spineSibKidsWidth(sibId));

  /** "Main descent" span for a chain — the widest row occupied by the
   *  main vertical column (couple slots everywhere, endpoint kid row at
   *  the bottom). Used as the central no-go half-width so spine siblings
   *  never pack into the main descent column or its endpoint fan. */
  const mainSpanForChain = (rows: LaidRow[]): number => {
    let maxW = COUPLE_SLOT_W;
    for (const row of rows) {
      if (row.endpointKidIds) {
        const w = kidRowWidth(row.endpointKidIds.length);
        if (w > maxW) maxW = w;
      }
    }
    return maxW;
  };

  const placeSpineSiblings = (
    rows: LaidRow[],
    side: 'left' | 'right' | 'center'
  ): void => {
    const chainCenter = chainCenterForSide(side);
    const noGoHalfW = mainSpanForChain(rows) / 2;

    // Per-row horizontal occupancy. Piece 2 (spine siblings at row N) and
    // Piece 3 (cousins = row N sibling's kids, at row N+1) both place
    // nodes on shared row-Ys. Without tracking, row N+1's Piece 2 and
    // row N's Piece 3 can collide because neither pass knows about the
    // other. We maintain a map of gen → list of reserved [left, right]
    // intervals and use findFreeLeft/findFreeRight below to steer each
    // new placement into a free slot.
    const rowOccupancy = new Map<number, Array<[number, number]>>();
    const reserveAt = (gen: number, left: number, right: number): void => {
      let arr = rowOccupancy.get(gen);
      if (!arr) {
        arr = [];
        rowOccupancy.set(gen, arr);
      }
      arr.push([left, right]);
    };
    const intervalsAt = (gen: number): Array<[number, number]> =>
      rowOccupancy.get(gen) ?? [];

    /** Two-gen collision-aware center finder.
     *
     *  Returns the slot CENTER x that:
     *    - keeps [center ± slotW/2] clear at `gen` (the sibling couple row)
     *    - keeps [center ± kidsW/2] clear at `genBelow` (the kid row)
     *  and is the closest such center to `anchorX` in the given direction.
     *
     *  Each existing reserved interval contributes a forbidden range on
     *  the center axis: a gen-interval [l, r] blocks any center within
     *  [l - slotW/2 - gap, r + slotW/2 + gap], and a genBelow-interval
     *  blocks [l - kidsW/2 - gap, r + kidsW/2 + gap]. The forbidden
     *  ranges are merged, then we walk in the requested direction from
     *  anchorX until we find a point outside every forbidden range. */
    const findFreeCenter = (
      gen: number,
      genBelow: number | null,
      direction: 'right' | 'left',
      anchorX: number,
      slotW: number,
      kidsW: number
    ): number => {
      const mainHalf = slotW / 2;
      const kidHalf = kidsW / 2;
      const gap = SIBLING_GAP;

      const forbidden: Array<[number, number]> = [];
      for (const [l, r] of intervalsAt(gen)) {
        forbidden.push([l - mainHalf - gap, r + mainHalf + gap]);
      }
      if (genBelow !== null && kidsW > 0) {
        for (const [l, r] of intervalsAt(genBelow)) {
          forbidden.push([l - kidHalf - gap, r + kidHalf + gap]);
        }
      }
      if (forbidden.length === 0) return anchorX;

      forbidden.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const [l, r] of forbidden) {
        const last = merged[merged.length - 1];
        if (last && last[1] >= l - 0.5) {
          last[1] = Math.max(last[1], r);
        } else {
          merged.push([l, r]);
        }
      }

      if (direction === 'right') {
        let cursor = anchorX;
        for (const [l, r] of merged) {
          if (r < cursor) continue;
          if (cursor < l) return cursor;
          cursor = r;
        }
        return cursor;
      } else {
        let cursor = anchorX;
        for (let i = merged.length - 1; i >= 0; i--) {
          const [l, r] = merged[i];
          if (l > cursor) continue;
          if (cursor > r) return cursor;
          cursor = l;
        }
        return cursor;
      }
    };

    // Pre-reserve the main vertical column at every row so spine-sibling
    // and cousin placements never punch through it.
    for (const row of rows) {
      if (row.endpointKidIds) {
        const w = kidRowWidth(row.endpointKidIds.length);
        reserveAt(row.gen, chainCenter - w / 2, chainCenter + w / 2);
      } else {
        reserveAt(
          row.gen,
          chainCenter - COUPLE_SLOT_W / 2,
          chainCenter + COUPLE_SLOT_W / 2
        );
      }
    }

    // Iterate rows BOTTOM-UP so each spine row's Piece 2 slots are
    // packed only after the row below is fully populated. A sibling at
    // row N whose kid row would collide with row N+1's already-placed
    // siblings gets pushed further out at row N, instead of its cousins
    // landing on top of row N+1's siblings.
    for (let rowIdx = rows.length - 1; rowIdx >= 0; rowIdx--) {
      const row = rows[rowIdx];
      // Skip the endpoint row — its siblings are already handled by the
      // kids-bus group centered under the parent couple.
      if (row.endpointKidIds) continue;

      const spinePerson = data.persons.get(row.spineId);
      const birthFamId = spinePerson?.familyAsChild;
      if (!birthFamId) continue;
      const birthFam = data.families.get(birthFamId);
      if (!birthFam) continue;

      // Sort the birth family by actual birth year so "older" / "younger"
      // are correct even when GEDCOM stored them out of order.
      const orderedSibs = sortByBirth(birthFam.childIds);
      const spineIdxInFam = orderedSibs.indexOf(row.spineId);
      const olderThanSpine = orderedSibs
        .slice(0, Math.max(0, spineIdxInFam))
        .filter(id => !placed.has(id));
      const youngerThanSpine = orderedSibs
        .slice(spineIdxInFam + 1)
        .filter(id => !placed.has(id));
      if (olderThanSpine.length === 0 && youngerThanSpine.length === 0) continue;

      // Parent source for the dashed descent drops into these siblings.
      let parentSrcId: string;
      let parentSrcHandle: 'bottom';
      if (rowIdx === 0) {
        parentSrcId = lcaDescentSourceId;
        parentSrcHandle = lcaDescentSourceHandle;
      } else {
        const p = rows[rowIdx - 1];
        parentSrcId = p.descentOutId;
        parentSrcHandle = p.descentOutHandle;
      }

      // Layout:
      //   - CENTER (direct-line): older siblings to the LEFT of the
      //     spine couple, younger to the RIGHT, preserving birth order.
      //     Sibling closest to spine = adjacent in age.
      //   - LEFT chain: everything outward (-x). Within that the order
      //     is oldest-farthest-out so birth order reads naturally L→R.
      //   - RIGHT chain: everything outward (+x), oldest-farthest-out.
      let leftSibs: string[];
      let rightSibs: string[];
      if (side === 'left') {
        // Extend outward to the left. Slot 0 = closest to spine. We want
        // oldest at outermost, so reverse: youngest nearest, oldest far.
        leftSibs = [...olderThanSpine, ...youngerThanSpine].reverse();
        rightSibs = [];
      } else if (side === 'right') {
        leftSibs = [];
        rightSibs = [...olderThanSpine, ...youngerThanSpine].reverse();
      } else {
        // Center: older LEFT (closest-to-spine = nearest in age), younger RIGHT.
        leftSibs = olderThanSpine.slice().reverse();
        rightSibs = youngerThanSpine.slice();
      }

      // Piece 4: slot widths are max(couple, their kid-row). Packing is
      // collision-aware via rowOccupancy so Piece 3 cousins that landed
      // on this row (from the row above) push Piece 2 sibling slots
      // further out. findFreeLeft/Right hand back the slot center.

      const placeSibCouple = (sibId: string, coupleCenterX: number): void => {
        const sib = data.persons.get(sibId);
        if (!sib) return;

        const { spineCenterX: sibPersonX, spouseCenterX: sibSpouseX } =
          couplePositions(coupleCenterX, sib.sex);

        // Grab the sibling's first-marriage spouse if any.
        let sibSpouseId: string | null = null;
        let sibFamily: ReturnType<typeof data.families.get> | undefined;
        if (sib.familiesAsSpouse.length > 0) {
          sibFamily = data.families.get(sib.familiesAsSpouse[0]);
          if (sibFamily) {
            sibSpouseId =
              sibFamily.husbandId === sibId
                ? sibFamily.wifeId ?? null
                : sibFamily.husbandId ?? null;
          }
        }

        if (!addPerson(sibId, sibPersonX - NODE_WIDTH / 2, row.rowTopY)) return;

        // Track the sibling couple's descent source: if we draw a junction
        // below we use it, else fall back to the sibling person. This is
        // where the dashed mini-bus to their kids will hang from.
        let sibCoupleSourceId: string = sibId;
        const sibCoupleSourceHandle: 'bottom' = 'bottom';
        if (
          sibSpouseId &&
          addPerson(sibSpouseId, sibSpouseX - NODE_WIDTH / 2, row.rowTopY)
        ) {
          const sibJunctionId = `junction-sib-${sibId}`;
          addJunction(sibJunctionId, coupleCenterX, row.rowCenterY);
          addSpouseConn(sibId, sibJunctionId, sibPersonX, coupleCenterX);
          addSpouseConn(sibSpouseId, sibJunctionId, sibSpouseX, coupleCenterX);
          sibCoupleSourceId = sibJunctionId;
        }

        // Dashed collateral drop from the parent couple's junction (above)
        // into this sibling's top-center. "Not on blood path" visual cue.
        addCollateralDescent(
          parentSrcId,
          parentSrcHandle,
          sibId,
          'top',
          `spine-sib-${sibId}`
        );

        // ── Piece 3: sibling's own kids ──────────────────────────────
        // Drop the sibling's children one row below, centered under the
        // sibling couple. No grandkids are rendered — Medium mode caps
        // collateral depth at one level.
        if (!sibFamily) return;
        const sibKidIds = sortByBirth(sibFamily.childIds).filter(id => !placed.has(id));
        if (sibKidIds.length === 0) return;

        const sibKidsRowTopY = (row.gen + 1) * ROW_HEIGHT;
        const kN = sibKidIds.length;
        const kidsW = kidRowWidth(kN);
        const firstKidCenter = coupleCenterX - kidsW / 2 + NODE_WIDTH / 2;

        for (let k = 0; k < kN; k++) {
          const kidId = sibKidIds[k];
          const kidCX = firstKidCenter + k * (NODE_WIDTH + SIBLING_GAP);
          addPerson(kidId, kidCX - NODE_WIDTH / 2, sibKidsRowTopY);
        }
        // (Reservation at gen+1 is performed by the caller of
        // placeSibCouple so the two-gen findFreeCenter pass can use it.)

        // Mini bus just above the kids row at the sibling couple's x, so
        // the horizontal fan sits right above the children boxes.
        const busId = `sibkidbus-${sibId}`;
        const busY = sibKidsRowTopY - SIB_BUS_DROP;
        addJunction(busId, coupleCenterX, busY);

        // Sibling couple → bus (dashed collateral).
        addCollateralDescent(
          sibCoupleSourceId,
          sibCoupleSourceHandle,
          busId,
          'top',
          `sibkidbus-drop-${sibId}`
        );

        // Bus → each child (dashed, neutral).
        for (const kidId of sibKidIds) {
          addSibBusEdge(
            busId,
            kidId,
            'top',
            EDGE_COLOR_NEUTRAL,
            true, // dashed
            `sibkid-${sibId}-${kidId}`
          );
        }
      };

      // The gen below this row — where this sibling's kids will land.
      // For the topmost non-endpoint row there may be no row stored in
      // `rows` below it, but we still have the row below via rowIdx+1.
      const genBelow =
        rowIdx + 1 < rows.length ? rows[rowIdx + 1].gen : null;

      // Pack LEFT siblings outward. findFreeCenter walks left from the
      // inner edge of the central no-go zone, skipping reservations at
      // both row.gen and genBelow.
      for (const sibId of leftSibs) {
        const slotW = spineSibSubtreeWidth(sibId);
        const kidsW = spineSibKidsWidth(sibId);
        const slotCenter = findFreeCenter(
          row.gen,
          genBelow,
          'left',
          chainCenter - noGoHalfW - SIBLING_GAP - slotW / 2,
          slotW,
          kidsW
        );
        reserveAt(row.gen, slotCenter - slotW / 2, slotCenter + slotW / 2);
        if (kidsW > 0 && genBelow !== null) {
          reserveAt(
            genBelow,
            slotCenter - kidsW / 2,
            slotCenter + kidsW / 2
          );
        }
        placeSibCouple(sibId, slotCenter);
      }

      // Pack RIGHT siblings outward.
      for (const sibId of rightSibs) {
        const slotW = spineSibSubtreeWidth(sibId);
        const kidsW = spineSibKidsWidth(sibId);
        const slotCenter = findFreeCenter(
          row.gen,
          genBelow,
          'right',
          chainCenter + noGoHalfW + SIBLING_GAP + slotW / 2,
          slotW,
          kidsW
        );
        reserveAt(row.gen, slotCenter - slotW / 2, slotCenter + slotW / 2);
        if (kidsW > 0 && genBelow !== null) {
          reserveAt(
            genBelow,
            slotCenter - kidsW / 2,
            slotCenter + kidsW / 2
          );
        }
        placeSibCouple(sibId, slotCenter);
      }
    }
  };

  // ── 3. Build chains ────────────────────────────────────────────────

  const isDirectLine =
    path.startChain.length === 1 || path.endChain.length === 1;

  interface ChainPlacement {
    side: 'left' | 'right' | 'center';
    rows: LaidRow[];
    chain: string[];
  }
  const chains: ChainPlacement[] = [];

  if (isDirectLine) {
    const longChain =
      path.startChain.length >= path.endChain.length
        ? path.startChain
        : path.endChain;
    chains.push({ side: 'center', rows: layChain(longChain, 'center'), chain: longChain });
  } else {
    chains.push({ side: 'left', rows: layChain(path.startChain, 'left'), chain: path.startChain });
    chains.push({ side: 'right', rows: layChain(path.endChain, 'right'), chain: path.endChain });
  }

  // After all chains have placed their spine people, fan out spine
  // siblings at each non-endpoint row. Running this after both chains
  // means the LEFT chain's spine and the RIGHT chain's spine are already
  // in `placed`, so a shared LCA sibling that is ALSO the other chain's
  // spine won't be rendered twice.
  for (const { rows, side } of chains) {
    placeSpineSiblings(rows, side);
  }

  // ── 4. Sibling bus ────────────────────────────────────────────────

  /** Wire a sibling-bus T-junction from the parent source down to each
   *  kid in the endpoint row. Kids are already placed by layChain's
   *  endpoint branch in birth order, centered under the parent couple's
   *  junction; this function only builds the bus node and the edges. */
  const wireSiblingBus = (
    chain: string[],
    endpointRow: LaidRow,
    parentSourceId: string,
    parentSourceHandle: 'bottom',
    parentSex: 'M' | 'F' | 'U' | undefined
  ): void => {
    const kidIds = endpointRow.endpointKidIds ?? [chain[0]];
    const kidCenterXs =
      endpointRow.endpointKidCenterXs ?? [endpointRow.spineCenterX];
    const childRowTopY = endpointRow.rowTopY;
    // Bus sits at the parent's x column (above the kids row), so the
    // parent→bus drop is a clean vertical for same-column parents.
    const busCenterX =
      endpointRow.endpointParentCenterX ?? endpointRow.spineCenterX;

    const busY = childRowTopY - SIB_BUS_DROP;
    const busId = `sibbus-${chain[0]}`;
    addJunction(busId, busCenterX, busY);

    // Parent → bus: reuses the descent helper so it shares the same
    // offset logic as generational drops.
    addDescent(
      parentSourceId,
      parentSourceHandle,
      busId,
      'top',
      parentSex,
      `sibbus-drop-${chain[0]}`
    );

    // Bus → each kid. Solid path-colored for the endpoint, dashed neutral
    // for siblings.
    for (let k = 0; k < kidIds.length; k++) {
      const kidId = kidIds[k];
      const isEndpoint = kidId === chain[0];
      void kidCenterXs; // positions already baked into node coordinates
      addSibBusEdge(
        busId,
        kidId,
        'top',
        isEndpoint ? colorForSex(parentSex) : EDGE_COLOR_NEUTRAL,
        !isEndpoint,
        chain[0]
      );
    }
  };

  // ── 5. Wire descent + siblings per chain ───────────────────────────

  for (const { rows, chain, side } of chains) {
    if (rows.length === 0) continue;

    const endpointRow = rows[rows.length - 1];

    // Determine parent source for the endpoint's final drop.
    let parentSourceId: string;
    let parentSourceHandle: 'bottom';
    let parentSex: 'M' | 'F' | 'U' | undefined;
    if (rows.length === 1) {
      parentSourceId = lcaDescentSourceId;
      parentSourceHandle = lcaDescentSourceHandle;
      parentSex = lcaAnchorSex;
    } else {
      const parentRow = rows[rows.length - 2];
      parentSourceId = parentRow.descentOutId;
      parentSourceHandle = parentRow.descentOutHandle;
      parentSex = parentRow.parentSex;
    }

    // LCA → first chain row (if that first row isn't already the endpoint).
    if (rows.length > 1) {
      const first = rows[0];
      addDescent(
        lcaDescentSourceId,
        lcaDescentSourceHandle,
        first.descentInId,
        first.descentInHandle,
        lcaAnchorSex,
        `lca-${side}`
      );
    }

    // Intermediate row-to-row descents (stop before the final drop into endpoint).
    for (let k = 0; k < rows.length - 2; k++) {
      const upper = rows[k];
      const lower = rows[k + 1];
      addDescent(
        upper.descentOutId,
        upper.descentOutHandle,
        lower.descentInId,
        lower.descentInHandle,
        upper.parentSex,
        `chain-${side}-${k}`
      );
    }

    // Final drop to endpoint — always via the sibling bus so the
    // endpoint and all of its siblings share a clean T under the parent.
    wireSiblingBus(
      chain,
      endpointRow,
      parentSourceId,
      parentSourceHandle,
      parentSex
    );
  }

  return { nodes, edges };
}
