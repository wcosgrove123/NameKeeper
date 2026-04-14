import type { Core } from 'cytoscape';
import type { Family, GedcomData } from './types';

/**
 * Return a family's children filtered to those present in the rendered tree
 * and sorted by birth year ascending.  GEDCOM files don't guarantee childIds
 * are in birth order, so we sort explicitly using each child's parsed birth
 * year (missing dates sort last so they don't claim the "firstborn" slot).
 */
function orderedTreeChildren(
  fam: Family,
  data: GedcomData,
  presentPersons: Set<string>,
): string[] {
  const rows: Array<{ id: string; year: number }> = [];
  for (const cid of fam.childIds) {
    if (!presentPersons.has(cid)) continue;
    const p = data.persons.get(cid);
    const match = p?.birthDate?.match(/(\d{4})/);
    const year = match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
    rows.push({ id: cid, year });
  }
  rows.sort((a, b) => a.year - b.year);
  return rows.map((r) => r.id);
}

export interface CascadeWaves {
  nodeWaves: Map<string, number>;
  edgeWaves: Map<string, number>;
  totalWaves: number;
}

/**
 * Compute the BFS reveal cascade for a patrilineal Name Keeper tree.
 *
 * Rule: when person X appears at wave W, the next wave schedules:
 *   - X's spouse   at W+1 (males only — daughters' spouses are not rendered)
 *   - X's firstborn at W+2 (only children present in the current Cytoscape graph)
 *   - X's next younger sibling at W+1
 * Each newly-scheduled person recursively schedules its own descendants.
 */
export function computeCascadeWaves(
  cy: Core,
  patriarchId: string,
  data: GedcomData,
): CascadeWaves {
  const presentPersons = new Set<string>();
  cy.nodes('[nodeType="person"]').forEach((n) => {
    presentPersons.add(n.id());
  });

  const scheduled = new Map<string, number>();
  const schedule = (id: string | undefined | null, wave: number) => {
    if (!id) return;
    if (!presentPersons.has(id)) return;
    if (scheduled.has(id)) return;
    scheduled.set(id, wave);
  };

  schedule(patriarchId, 0);

  const processed = new Set<string>();
  let safety = 0;
  while (processed.size < scheduled.size && safety < 20000) {
    safety++;
    // Pick the unprocessed entry with the smallest wave.
    let pickedId: string | null = null;
    let pickedWave = Infinity;
    for (const [id, w] of scheduled) {
      if (!processed.has(id) && w < pickedWave) {
        pickedWave = w;
        pickedId = id;
      }
    }
    if (!pickedId) break;
    processed.add(pickedId);

    const person = data.persons.get(pickedId);
    if (!person) continue;
    const w = pickedWave;

    // Spouse + firstborn — only males drive this side of the cascade.
    if (person.sex === 'M') {
      for (const famId of person.familiesAsSpouse) {
        const fam = data.families.get(famId);
        if (!fam || fam.husbandId !== pickedId) continue;
        if (fam.wifeId) schedule(fam.wifeId, w + 1);
        const ordered = orderedTreeChildren(fam, data, presentPersons);
        if (ordered.length > 0) schedule(ordered[0], w + 2);
      }
    }

    // Next younger sibling (by birth year, not childIds order).
    if (person.familyAsChild) {
      const fam = data.families.get(person.familyAsChild);
      if (fam) {
        const ordered = orderedTreeChildren(fam, data, presentPersons);
        const idx = ordered.indexOf(pickedId);
        if (idx >= 0 && idx + 1 < ordered.length) {
          schedule(ordered[idx + 1], w + 1);
        }
      }
    }
  }

  const nodeWaves = new Map<string, number>(scheduled);

  // Junction nodes are invisible; place them at wave 0 so they never gate
  // edge rendering.  Edges compute their own waves directly from persons.
  cy.nodes('[nodeType="family-junction"]').forEach((j) => {
    nodeWaves.set(j.id(), 0);
  });

  // Edge waves.
  const edgeWaves = new Map<string, number>();
  cy.edges().forEach((edge) => {
    const d = edge.data();
    const id = edge.id();

    if (d.edgeType === 'junction-to-child') {
      const childWave = nodeWaves.get(d.target);
      if (childWave !== undefined) edgeWaves.set(id, childWave);
      return;
    }

    if (d.edgeType === 'spouse-to-junction') {
      const junctionId: string =
        typeof d.source === 'string' && d.source.startsWith('junction-') ? d.source : d.target;
      const junction = cy.getElementById(junctionId);
      if (junction.length === 0) return;

      // Collect person waves of every spouse at this junction.
      const spouseWaves: number[] = [];
      junction.connectedEdges('[edgeType="spouse-to-junction"]').forEach((e) => {
        const otherId = e.source().id() === junctionId ? e.target().id() : e.source().id();
        if (presentPersons.has(otherId)) {
          const w = nodeWaves.get(otherId);
          if (w !== undefined) spouseWaves.push(w);
        }
      });

      if (spouseWaves.length >= 2) {
        // Couple line traces when the later spouse arrives.
        edgeWaves.set(id, Math.max(...spouseWaves));
        return;
      }

      // Single spouse: trace stub when the first child appears.
      let minChild = Infinity;
      junction.connectedEdges('[edgeType="junction-to-child"]').forEach((e) => {
        const w = nodeWaves.get(e.target().id());
        if (w !== undefined && w < minChild) minChild = w;
      });
      if (minChild !== Infinity) {
        edgeWaves.set(id, minChild);
      } else if (spouseWaves.length === 1) {
        edgeWaves.set(id, spouseWaves[0]);
      }
      return;
    }

    // Fallback for any other edge types.
    const a = nodeWaves.get(d.source);
    const b = nodeWaves.get(d.target);
    if (a !== undefined && b !== undefined) {
      edgeWaves.set(id, Math.max(a, b));
    }
  });

  let totalWaves = 0;
  for (const w of nodeWaves.values()) if (w + 1 > totalWaves) totalWaves = w + 1;
  for (const w of edgeWaves.values()) if (w + 1 > totalWaves) totalWaves = w + 1;

  return { nodeWaves, edgeWaves, totalWaves };
}
