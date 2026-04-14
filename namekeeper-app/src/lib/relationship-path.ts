/**
 * Relationship Path finder.
 *
 * Given two people, find the shortest path between them via a common ancestor
 * (or couple) and return the reconstructed up-chain from each side. Used by
 * the Relationship Mapper page to draw a minimal tree showing exactly how
 * two people are related.
 */

import { GedcomData } from './types';

interface AncestorEntry {
  /** Generations up from the start person */
  gen: number;
  /** The (closer-to-start) person we reached this ancestor through — used
   *  to reconstruct the path back down. null means this IS the start person. */
  childOnPath: string | null;
}

export interface RelationshipPath {
  startId: string;
  endId: string;
  /** The common ancestor(s) — 1 person or 2 (a couple). */
  lcaIds: string[];
  /** Path from start up to (and including) one LCA. startChain[0] = startId. */
  startChain: string[];
  /** Path from end up to (and including) one LCA. endChain[0] = endId. */
  endChain: string[];
  /** The particular LCA person that startChain/endChain terminates at. */
  lcaAnchorId: string;
}

/** Walk upward from `personId` via `familyAsChild`, BFS by generation.
 *  Returns a map from every reachable ancestor id to its generation distance
 *  and the child-on-path used to reach it. */
function buildAncestorMap(personId: string, data: GedcomData): Map<string, AncestorEntry> {
  const map = new Map<string, AncestorEntry>();
  map.set(personId, { gen: 0, childOnPath: null });

  // BFS queue — each entry is [id, gen]. We already seeded the start person.
  const queue: Array<[string, number]> = [[personId, 0]];
  while (queue.length) {
    const [id, gen] = queue.shift()!;
    const person = data.persons.get(id);
    if (!person?.familyAsChild) continue;
    const fam = data.families.get(person.familyAsChild);
    if (!fam) continue;
    for (const parentId of [fam.husbandId, fam.wifeId]) {
      if (!parentId) continue;
      if (map.has(parentId)) continue;
      map.set(parentId, { gen: gen + 1, childOnPath: id });
      queue.push([parentId, gen + 1]);
    }
  }
  return map;
}

/** Reconstruct the chain [personId, ..., ancestorId] by walking the
 *  childOnPath pointers backward from the ancestor. */
function reconstructChain(
  ancestorId: string,
  ancestors: Map<string, AncestorEntry>
): string[] {
  // Walk from ancestor back down via childOnPath, collecting ids.
  // childOnPath of the start person is null, so that terminates us.
  const downFromAncestor: string[] = [];
  let cursor: string | null = ancestorId;
  while (cursor !== null) {
    downFromAncestor.push(cursor);
    const entry = ancestors.get(cursor);
    if (!entry) break;
    cursor = entry.childOnPath;
  }
  // downFromAncestor = [ancestor, ..., start]. We want [start, ..., ancestor].
  return downFromAncestor.reverse();
}

/** Find the shortest path between two people through a common ancestor.
 *  Returns null if they have no common ancestor. */
export function findRelationshipPath(
  startId: string,
  endId: string,
  data: GedcomData
): RelationshipPath | null {
  if (startId === endId) return null;

  const ancestorsA = buildAncestorMap(startId, data);
  const ancestorsB = buildAncestorMap(endId, data);

  // Find the LCA that minimizes (genA + genB).
  let best: { id: string; genA: number; genB: number } | null = null;
  for (const [id, entryA] of ancestorsA) {
    const entryB = ancestorsB.get(id);
    if (!entryB) continue;
    const total = entryA.gen + entryB.gen;
    if (!best || total < best.genA + best.genB) {
      best = { id, genA: entryA.gen, genB: entryB.gen };
    }
  }

  if (!best) return null;

  const startChain = reconstructChain(best.id, ancestorsA);
  const endChain = reconstructChain(best.id, ancestorsB);

  // If the LCA has a spouse who is also a shared ancestor at the same total
  // distance, include them as a couple (the usual case — e.g., first cousins
  // share both grandpa and grandma).
  const lcaIds: string[] = [best.id];
  const lcaPerson = data.persons.get(best.id);
  if (lcaPerson) {
    for (const famId of lcaPerson.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      const spouseId = fam.husbandId === best.id ? fam.wifeId : fam.husbandId;
      if (!spouseId) continue;
      const spouseA = ancestorsA.get(spouseId);
      const spouseB = ancestorsB.get(spouseId);
      if (spouseA && spouseB && spouseA.gen === best.genA && spouseB.gen === best.genB) {
        lcaIds.push(spouseId);
        break;
      }
    }
  }

  return {
    startId,
    endId,
    lcaIds,
    startChain,
    endChain,
    lcaAnchorId: best.id,
  };
}

/** Find the spouse of a person along a specific chain — i.e., the other
 *  parent of the next person down in the chain. Returns null if none. */
export function getPathSpouseId(
  personId: string,
  nextPersonDownId: string | null,
  data: GedcomData
): string | null {
  if (!nextPersonDownId) return null;
  const next = data.persons.get(nextPersonDownId);
  if (!next?.familyAsChild) return null;
  const fam = data.families.get(next.familyAsChild);
  if (!fam) return null;
  if (fam.husbandId === personId) return fam.wifeId ?? null;
  if (fam.wifeId === personId) return fam.husbandId ?? null;
  return null;
}

/** Get siblings of a person (people sharing their birth family). */
export function getSiblings(personId: string, data: GedcomData): string[] {
  const person = data.persons.get(personId);
  if (!person?.familyAsChild) return [];
  const fam = data.families.get(person.familyAsChild);
  if (!fam) return [];
  return fam.childIds.filter(id => id !== personId);
}
