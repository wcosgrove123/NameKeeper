/**
 * Relationship path layout — builds React Flow nodes/edges for the
 * Relationship Mapper using the same couple-junction rendering as Tree View.
 *
 * Structure:
 *   - LCA (or LCA couple + junction) at the top row, centered on x = 0.
 *   - Start chain drops straight down on the left; end chain on the right.
 *   - Each chain is a vertical column of couple-junctions connected by a
 *     single descent line. The spine person (blood path) sits on the INNER
 *     side of each junction and their path-spouse on the OUTER side.
 *   - Drop line from each parent junction to its child junction (or to the
 *     child person if childless/no spouse) is colored by the sex of the
 *     PARENT on the blood path: blue for male, pink for female.
 *   - Endpoint siblings drop from the endpoint's parent junction (neutral
 *     grey dashed) and extend further outward from the chain.
 *
 * Coordinates are React Flow top-left for person nodes (200×80) and top-left
 * for the junction dot (8×8). Box-center math is done locally and then
 * converted to top-left when calling addPersonNode.
 */

import { type Node, type Edge } from '@xyflow/react';
import { GedcomData } from './types';
import {
  type RelationshipPath,
  getPathSpouseId,
  getSiblings,
} from './relationship-path';
import type { PersonNodeData } from '@/components/PersonNode';
import type { FamilyNodeData } from '@/components/FamilyNode';

// ── Grid constants ───────────────────────────────────────────────────

const BLOCK = 40;
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const SPOUSE_GAP = 40;
const PARENT_CHILD_GAP = 40;
const SIBLING_GAP = 40;
const ROW_HEIGHT = NODE_HEIGHT + PARENT_CHILD_GAP; // 120
const JUNCTION_SIZE = 8;

/** Horizontal distance from x=0 to each chain's junction column. Chosen so
 *  that the inner person box of each chain clears the LCA couple's box. */
const CHAIN_CENTER_OFFSET = 320;

// Edge colors keyed on the "through" person's sex.
const EDGE_COLOR_MALE = '#60a5fa';    // blue-400
const EDGE_COLOR_FEMALE = '#f472b6';  // pink-400
const EDGE_COLOR_NEUTRAL = '#94a3b8'; // slate-400

function snap(val: number): number {
  return Math.round(val / BLOCK) * BLOCK;
}

function colorForSex(sex: 'M' | 'F' | 'U' | undefined): string {
  if (sex === 'M') return EDGE_COLOR_MALE;
  if (sex === 'F') return EDGE_COLOR_FEMALE;
  return EDGE_COLOR_NEUTRAL;
}

export interface RelationshipLayoutResult {
  nodes: Node[];
  edges: Edge[];
}

/** Whether one person is a direct ancestor of the other — rendered as a
 *  single center column instead of two chains. */
function isDirectLine(path: RelationshipPath): boolean {
  return path.startChain.length === 1 || path.endChain.length === 1;
}

/** Lays out one chain and returns row-level placement info so the caller
 *  can wire the LCA descent and track siblings. */
interface ChainLevel {
  /** Person on the blood path at this row. */
  spineId: string;
  /** Row-local parent sex (for coloring the drop INTO this row). */
  parentSex: 'M' | 'F' | 'U' | undefined;
  /** Edge source for the drop coming OUT of this row going down. */
  descentSourceId: string;
  descentSourceHandle: 'bottom';
  /** Edge target for the drop coming INTO this row from above. */
  descentTargetId: string;
  descentTargetHandle: 'top';
  /** Generation from LCA (0 = LCA row, 1 = first chain row, ...). */
  gen: number;
}

export function buildRelationshipLayout(
  path: RelationshipPath,
  data: GedcomData
): RelationshipLayoutResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const placedNodeIds = new Set<string>();

  // ── Node/edge helpers ──────────────────────────────────────────────

  const addPersonNode = (
    personId: string,
    topLeftX: number,
    topLeftY: number,
    opts: { isEndpoint?: boolean; isLca?: boolean } = {}
  ): boolean => {
    if (placedNodeIds.has(personId)) return false;
    const person = data.persons.get(personId);
    if (!person) return false;
    const d: PersonNodeData = {
      personId,
      label: `${person.givenName} ${person.surname}`.trim(),
      surname: person.surname,
      birthDate: person.birthDate,
      deathDate: person.deathDate,
      sex: person.sex,
      isLiving: person.isLiving,
      isSelected: !!opts.isEndpoint,
      isBloodRelative: true,
      hasInLawFamily: false,
      isInLawExpanded: false,
      hasParents: !!person.familyAsChild,
      hasChildren: person.familiesAsSpouse.length > 0,
      relationshipLabel: opts.isLca ? 'Common Ancestor' : undefined,
    };
    nodes.push({
      id: personId,
      type: 'personNode',
      position: { x: snap(topLeftX), y: snap(topLeftY) },
      data: d as unknown as Record<string, unknown>,
    });
    placedNodeIds.add(personId);
    return true;
  };

  const addJunctionNode = (junctionId: string, centerX: number, centerY: number) => {
    if (placedNodeIds.has(junctionId)) return;
    const d: FamilyNodeData = { familyId: junctionId };
    nodes.push({
      id: junctionId,
      type: 'familyNode',
      position: {
        x: snap(centerX - JUNCTION_SIZE / 2),
        y: snap(centerY - JUNCTION_SIZE / 2),
      },
      data: d as unknown as Record<string, unknown>,
    });
    placedNodeIds.add(junctionId);
  };

  /** Horizontal spouse-connector: person → junction. Direction is inferred
   *  from relative x. */
  const addSpouseConnEdge = (
    personId: string,
    junctionId: string,
    personIsLeftOfJunction: boolean
  ) => {
    const sourceHandle = personIsLeftOfJunction ? 'right' : 'left';
    const targetHandle = personIsLeftOfJunction ? 'left' : 'right';
    edges.push({
      id: `spouseconn-${personId}-${junctionId}`,
      source: personId,
      sourceHandle,
      target: junctionId,
      targetHandle,
      type: 'straight',
      style: { stroke: EDGE_COLOR_NEUTRAL, strokeWidth: 2 },
    });
  };

  /** Generational descent edge. `throughSex` is the sex of the blood-path
   *  parent at the upper end — determines the color. */
  const addDescentEdge = (
    sourceId: string,
    sourceHandle: string,
    targetId: string,
    targetHandle: string,
    throughSex: 'M' | 'F' | 'U' | undefined,
    key: string
  ) => {
    edges.push({
      id: `descent-${key}-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle,
      target: targetId,
      targetHandle,
      type: 'smoothstep',
      style: { stroke: colorForSex(throughSex), strokeWidth: 2.5 },
    });
  };

  const addSiblingEdge = (
    sourceId: string,
    sourceHandle: string,
    targetId: string
  ) => {
    edges.push({
      id: `sibling-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle,
      target: targetId,
      targetHandle: 'top',
      type: 'smoothstep',
      style: { stroke: EDGE_COLOR_NEUTRAL, strokeWidth: 2, strokeDasharray: '4 4' },
    });
  };

  // ── 1. Place the LCA row at gen = 0, centered on x = 0 ─────────────

  const lcaRowTopY = 0;
  const lcaRowCenterY = lcaRowTopY + NODE_HEIGHT / 2;

  /** Descent source from the LCA row: either the couple junction (if 2 LCAs)
   *  or the single LCA person's bottom handle. */
  let lcaDescentSourceId: string;
  let lcaDescentSourceHandle: string;
  /** The sex of the LCA anchor — used to color the first drop line. */
  const lcaAnchorSex = data.persons.get(path.lcaAnchorId)?.sex;

  if (path.lcaIds.length === 2) {
    // Put anchor wherever — pick male-left/female-right by convention.
    const anchorId = path.lcaAnchorId;
    const otherId = path.lcaIds.find(id => id !== anchorId)!;
    const anchor = data.persons.get(anchorId)!;
    let leftId = anchorId;
    let rightId = otherId;
    if (anchor.sex === 'F') { leftId = otherId; rightId = anchorId; }

    // Couple center at x=0. Left box center at -(NODE_WIDTH/2 + SPOUSE_GAP/2),
    // right box center at +(NODE_WIDTH/2 + SPOUSE_GAP/2).
    const leftTopLeftX = -(NODE_WIDTH + SPOUSE_GAP / 2 + NODE_WIDTH / 2); // -240
    const rightTopLeftX = SPOUSE_GAP / 2; // 20
    addPersonNode(leftId, leftTopLeftX, lcaRowTopY, { isLca: true });
    addPersonNode(rightId, rightTopLeftX, lcaRowTopY, { isLca: true });

    const lcaJunctionId = 'junction-lca';
    addJunctionNode(lcaJunctionId, 0, lcaRowCenterY);
    addSpouseConnEdge(leftId, lcaJunctionId, true);
    addSpouseConnEdge(rightId, lcaJunctionId, false);
    lcaDescentSourceId = lcaJunctionId;
    lcaDescentSourceHandle = 'bottom';
  } else {
    // Single LCA: box center at 0, top-left at -NODE_WIDTH/2.
    const lcaId = path.lcaIds[0];
    addPersonNode(lcaId, -NODE_WIDTH / 2, lcaRowTopY, { isLca: true });
    lcaDescentSourceId = lcaId;
    lcaDescentSourceHandle = 'bottom';
  }

  // ── 2. Lay each chain ──────────────────────────────────────────────

  /** For a given side, compute the x coordinates of the spine person,
   *  spouse, and junction within a chain row. */
  const chainGeometry = (side: 'left' | 'right' | 'center') => {
    // chainCenter is the x of the junction column. The spine (inner side)
    // and spouse (outer side) sit symmetric around it at ± (NODE_WIDTH/2 +
    // SPOUSE_GAP/2) box-centers.
    const chainCenter =
      side === 'center' ? 0 : side === 'left' ? -CHAIN_CENTER_OFFSET : CHAIN_CENTER_OFFSET;
    // For a left chain the spine is on the RIGHT of the junction (closer
    // to x=0). For a right chain, the spine is on the LEFT.
    const spineIsLeft = side === 'right';
    const innerSign = side === 'right' ? -1 : +1; // which side of chainCenter spine sits on
    const spineBoxCenter = chainCenter + innerSign * (NODE_WIDTH / 2 + SPOUSE_GAP / 2);
    const spouseBoxCenter = chainCenter - innerSign * (NODE_WIDTH / 2 + SPOUSE_GAP / 2);
    const spineTopLeftX = spineBoxCenter - NODE_WIDTH / 2;
    const spouseTopLeftX = spouseBoxCenter - NODE_WIDTH / 2;
    return { chainCenter, spineTopLeftX, spouseTopLeftX, spineIsLeft };
  };

  const layChain = (
    chain: string[],
    side: 'left' | 'right' | 'center'
  ): ChainLevel[] => {
    const levels: ChainLevel[] = [];
    const { chainCenter, spineTopLeftX, spouseTopLeftX, spineIsLeft } = chainGeometry(side);

    // Walk chain from LCA-adjacent (index = chain.length - 2) down to the
    // endpoint (index = 0).
    for (let i = chain.length - 2; i >= 0; i--) {
      const personId = chain[i];
      const gen = chain.length - 1 - i; // 1..depth
      const rowTopY = gen * ROW_HEIGHT;
      const rowCenterY = rowTopY + NODE_HEIGHT / 2;
      const isEndpoint = i === 0;

      // Determine the co-parent spouse to show at this level.
      let spouseId: string | null = null;
      if (i > 0) {
        spouseId = getPathSpouseId(personId, chain[i - 1], data);
      } else {
        const p = data.persons.get(personId);
        if (p?.familiesAsSpouse.length) {
          const fam = data.families.get(p.familiesAsSpouse[0]);
          if (fam) {
            spouseId = fam.husbandId === personId ? fam.wifeId ?? null : fam.husbandId ?? null;
          }
        }
      }

      addPersonNode(personId, spineTopLeftX, rowTopY, { isEndpoint });

      let descentSourceId: string;
      let descentSourceHandle: 'bottom' = 'bottom';
      let descentTargetId: string;
      let descentTargetHandle: 'top' = 'top';

      if (spouseId) {
        addPersonNode(spouseId, spouseTopLeftX, rowTopY);
        const junctionId = `junction-${personId}`;
        addJunctionNode(junctionId, chainCenter, rowCenterY);
        // Spouse connectors: spine's (inner-of-junction) side to junction,
        // spouse's (outer-of-junction) side to junction.
        addSpouseConnEdge(personId, junctionId, !spineIsLeft);
        addSpouseConnEdge(spouseId, junctionId, spineIsLeft);
        descentSourceId = junctionId;
        descentTargetId = junctionId;
      } else {
        // No spouse at this level — treat the person as both source/target.
        descentSourceId = personId;
        descentTargetId = personId;
      }

      levels.push({
        spineId: personId,
        parentSex: data.persons.get(personId)?.sex,
        descentSourceId,
        descentSourceHandle,
        descentTargetId,
        descentTargetHandle,
        gen,
      });
    }
    return levels;
  };

  // ── 3. Compute chains + wire vertical descent edges ────────────────

  const direct = isDirectLine(path);
  let allLevels: { side: 'left' | 'right' | 'center'; levels: ChainLevel[]; chain: string[] }[] = [];

  if (direct) {
    const longChain =
      path.startChain.length >= path.endChain.length ? path.startChain : path.endChain;
    allLevels.push({ side: 'center', levels: layChain(longChain, 'center'), chain: longChain });
  } else {
    allLevels.push({ side: 'left', levels: layChain(path.startChain, 'left'), chain: path.startChain });
    allLevels.push({ side: 'right', levels: layChain(path.endChain, 'right'), chain: path.endChain });
  }

  // Wire LCA → first row of each chain, then subsequent row → row within each chain.
  for (const { levels } of allLevels) {
    if (levels.length === 0) continue;
    // LCA to first row: color by the LCA anchor's sex.
    const first = levels[0];
    addDescentEdge(
      lcaDescentSourceId,
      lcaDescentSourceHandle,
      first.descentTargetId,
      first.descentTargetHandle,
      lcaAnchorSex,
      'lca'
    );

    // Between subsequent rows: color by the UPPER row's spine person sex
    // (that's the blood-path parent at that hop).
    for (let k = 0; k < levels.length - 1; k++) {
      const upper = levels[k];
      const lower = levels[k + 1];
      addDescentEdge(
        upper.descentSourceId,
        upper.descentSourceHandle,
        lower.descentTargetId,
        lower.descentTargetHandle,
        upper.parentSex,
        `chain-${k}`
      );
    }
  }

  // ── 4. Endpoint siblings ───────────────────────────────────────────
  // Siblings drop from the ENDPOINT'S PARENT junction (one row above the
  // endpoint row), extending outward. For a direct-line case, the "endpoint"
  // is at the far end of the only chain.

  const laySiblings = (
    chain: string[],
    levels: ChainLevel[],
    side: 'left' | 'right' | 'center'
  ) => {
    if (chain.length < 2 || levels.length === 0) return;
    const endpointId = chain[0];
    const siblings = getSiblings(endpointId, data);
    if (siblings.length === 0) return;

    // The endpoint's "parent row" is the upper-adjacent ChainLevel. If the
    // endpoint itself is at the only non-LCA level (levels.length === 1),
    // then the parent row is the LCA.
    let parentSource: { id: string; handle: string };
    if (levels.length === 1) {
      parentSource = { id: lcaDescentSourceId, handle: lcaDescentSourceHandle };
    } else {
      const parentLevel = levels[levels.length - 2];
      parentSource = { id: parentLevel.descentSourceId, handle: parentLevel.descentSourceHandle };
    }

    // Sibling x positions: the endpoint row already has spine and optional
    // spouse. Siblings flank outward from the outer edge of whichever of
    // those is on the outside.
    const { chainCenter, spineTopLeftX, spouseTopLeftX } = chainGeometry(side);
    // Outer edge = the x at which siblings should start being placed.
    const endpointLevel = levels[levels.length - 1];
    const hasSpouse = endpointLevel.descentSourceId.startsWith('junction-');
    const outward = side === 'right' ? +1 : side === 'center' ? +1 : -1;
    let outerEdgeX: number;
    if (outward < 0) {
      // Left chain — outer is the leftmost of (spine, spouse) top-left.
      outerEdgeX = hasSpouse ? Math.min(spineTopLeftX, spouseTopLeftX) : spineTopLeftX;
    } else {
      // Right/center chain — outer is the rightmost of (spine, spouse) right-edge.
      const spineRight = spineTopLeftX + NODE_WIDTH;
      const spouseRight = spouseTopLeftX + NODE_WIDTH;
      outerEdgeX = hasSpouse ? Math.max(spineRight, spouseRight) : spineRight;
    }
    void chainCenter;

    const endpointRowTopY = endpointLevel.gen * ROW_HEIGHT;

    for (let s = 0; s < siblings.length; s++) {
      const sibId = siblings[s];
      const position = s + 1; // 1-indexed outward
      const topLeftX =
        outward < 0
          ? outerEdgeX - position * (NODE_WIDTH + SIBLING_GAP)
          : outerEdgeX + SIBLING_GAP + (position - 1) * (NODE_WIDTH + SIBLING_GAP);
      if (!addPersonNode(sibId, topLeftX, endpointRowTopY)) continue;
      addSiblingEdge(parentSource.id, parentSource.handle, sibId);
    }
  };

  for (const { side, levels, chain } of allLevels) {
    laySiblings(chain, levels, side);
  }

  return { nodes, edges };
}
