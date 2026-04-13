import { Person, GedcomData, NameKeeperStats, WhatIfResult } from './types';
import { getSons, getFather } from './gedcom-parser';
import { hasLivingMaleDescendant } from './namekeeper';

/**
 * Compute bottom-up namekeeper stats for every male with the given surname.
 *
 * - nameKeeperGeneration: length of unbroken eldest-son chain going upward (min 1)
 * - removalFromPrime: number of non-eldest-son hops from patriarch to person
 * - isOnPrimeLine: whether the person is on the prime succession line
 */
export function computeNameKeeperStats(
  surname: string,
  patriarchId: string,
  data: GedcomData,
  primeLineIds: Set<string>
): Map<string, NameKeeperStats> {
  const statsMap = new Map<string, NameKeeperStats>();
  const genCache = new Map<string, number>();

  // First pass: compute removals top-down from patriarch
  const removalMap = new Map<string, number>();
  computeRemovalsTopDown(patriarchId, data, surname, removalMap, primeLineIds);

  // Second pass: compute generation (bottom-up) for each male
  for (const [personId, removal] of removalMap) {
    const person = data.persons.get(personId);
    if (!person) continue;
    const generation = computeGeneration(person, data, surname, genCache);
    statsMap.set(personId, {
      nameKeeperGeneration: generation,
      removalFromPrime: removal,
      isOnPrimeLine: primeLineIds.has(personId),
    });
  }

  return statsMap;
}

/**
 * Compute namekeeper generation for a person (memoized).
 * Walk upward: while this person is the eldest son of their father, increment.
 */
function computeGeneration(
  person: Person,
  data: GedcomData,
  surname: string,
  cache: Map<string, number>
): number {
  if (cache.has(person.id)) return cache.get(person.id)!;

  let gen = 1;
  let current = person;

  // Build the chain of ancestors we walk through (for caching)
  const chain: Person[] = [person];

  while (true) {
    const father = getFather(current, data);
    if (!father || father.surname !== surname) break;

    const sons = getSons(father.id, data);
    if (sons.length === 0 || sons[0].id !== current.id) break; // not eldest son

    // Check if father already has a cached value
    if (cache.has(father.id)) {
      gen = cache.get(father.id)! + chain.length;
      break;
    }

    chain.push(father);
    gen++;
    current = father;
  }

  // Cache all persons in the chain
  for (let i = 0; i < chain.length; i++) {
    cache.set(chain[i].id, gen - i);
  }

  return gen;
}

/**
 * Compute removal from prime line top-down (succession queue position).
 *
 * Only ACTIVE branches (with living male descendants) count toward the
 * removal number.  Extinct branches (no living males) get removal = -1
 * and are skipped in the queue — they can never inherit the title.
 *
 * The prime line son inherits the parent's removal (0 for prime).
 * Active brothers get incrementing removal, in birth order after the
 * prime son, then before (older brothers whose eldest-son lines failed
 * but who still have active descendants through younger sons).
 *
 * Example: James J. (prime, 0) has sons:
 *   John Francis (eldest, line EXTINCT) → -1
 *   Patrick Henry (prime) → 0
 *   Thomas Edward (no sons, EXTINCT) → -1
 *   Joseph (has living male heirs, ACTIVE) → 1  (first active brother)
 */
function computeRemovalsTopDown(
  personId: string,
  data: GedcomData,
  surname: string,
  removalMap: Map<string, number>,
  primeLineIds: Set<string>,
  parentRemoval: number = 0
): void {
  removalMap.set(personId, parentRemoval);

  const sons = getSons(personId, data).filter(s => s.surname === surname);
  if (sons.length === 0) return;

  // Find which son is on the prime line (if any)
  const primeIndex = sons.findIndex(s => primeLineIds.has(s.id));

  if (primeIndex >= 0) {
    // Prime son gets parent's removal (stays on prime line)
    const primeSon = sons[primeIndex];
    computeRemovalsTopDown(primeSon.id, data, surname, removalMap, primeLineIds, parentRemoval);

    // Collect non-prime brothers in succession order:
    // 1. Brothers AFTER prime (younger, in birth order)
    // 2. Brothers BEFORE prime (older, whose eldest-son lines failed)
    const afterPrime = sons.slice(primeIndex + 1);
    const beforePrime = sons.slice(0, primeIndex);
    const nonPrimeSons = [...afterPrime, ...beforePrime];

    // Active brothers (with living male descendants) get sequential removal
    let currentRemoval = parentRemoval + 1;
    for (const son of nonPrimeSons) {
      if (hasLivingMaleDescendant(son, data)) {
        computeRemovalsTopDown(son.id, data, surname, removalMap, primeLineIds, currentRemoval);
        currentRemoval++;
      }
    }

    // Extinct brothers get removal = -1 (out of succession)
    for (const son of nonPrimeSons) {
      if (!hasLivingMaleDescendant(son, data)) {
        computeRemovalsTopDown(son.id, data, surname, removalMap, primeLineIds, -1);
      }
    }
  } else {
    // No son on prime line — active sons get sequential removal, extinct get -1
    let currentRemoval = parentRemoval;
    for (const son of sons) {
      if (hasLivingMaleDescendant(son, data)) {
        computeRemovalsTopDown(son.id, data, surname, removalMap, primeLineIds, currentRemoval);
        currentRemoval++;
      }
    }
    for (const son of sons) {
      if (!hasLivingMaleDescendant(son, data)) {
        computeRemovalsTopDown(son.id, data, surname, removalMap, primeLineIds, -1);
      }
    }
  }
}

/**
 * Simulate what happens when a person's line dies out.
 * Walks upward from the eliminated person looking for a sibling/uncle/etc.
 * with living male descendants, then follows eldest-son rule down.
 */
export function computeWhatIfSuccession(
  eliminatedPersonId: string,
  data: GedcomData,
  surname: string,
  patriarchId: string
): WhatIfResult | null {
  const eliminatedPerson = data.persons.get(eliminatedPersonId);
  if (!eliminatedPerson) return null;

  // Walk upward looking for an ancestor with a qualifying sibling
  let current = eliminatedPerson;
  let divergencePoint: Person | null = null;
  let newLineAncestor: Person | null = null;

  while (true) {
    const father = getFather(current, data);
    if (!father || father.surname !== surname) break;

    // Check father's sons for a younger brother (after current's position)
    const sons = getSons(father.id, data);
    const currentIndex = sons.findIndex(s => s.id === current.id);

    for (let i = currentIndex + 1; i < sons.length; i++) {
      if (hasLivingMaleDescendant(sons[i], data)) {
        divergencePoint = father;
        newLineAncestor = sons[i];
        break;
      }
    }

    if (newLineAncestor) break;

    // Also check older brothers that aren't on the eliminated path
    // (in case the eliminated person was the eldest)
    for (let i = 0; i < currentIndex; i++) {
      if (hasLivingMaleDescendant(sons[i], data)) {
        divergencePoint = father;
        newLineAncestor = sons[i];
        break;
      }
    }

    if (newLineAncestor) break;

    current = father;
  }

  if (!newLineAncestor || !divergencePoint) {
    return {
      eliminatedPerson,
      newNameKeeper: null,
      alternateSuccessionChain: [],
      divergencePoint: eliminatedPerson,
    };
  }

  // Follow eldest-son rule down from newLineAncestor to find the new namekeeper
  const chain: Person[] = [divergencePoint, newLineAncestor];
  const newNameKeeper = followEldestSonDown(newLineAncestor, data, chain);

  return {
    eliminatedPerson,
    newNameKeeper,
    alternateSuccessionChain: chain,
    divergencePoint,
  };
}

/**
 * Follow the eldest-son rule downward to find the deepest living male.
 * Appends each person to the chain as it traverses.
 */
function followEldestSonDown(
  person: Person,
  data: GedcomData,
  chain: Person[]
): Person | null {
  const sons = getSons(person.id, data);

  if (sons.length === 0) {
    return person.isLiving ? person : null;
  }

  for (const son of sons) {
    chain.push(son);
    const result = followEldestSonDown(son, data, chain);
    if (result) return result;
    chain.pop(); // backtrack
  }

  // If no sons have living descendants, this person might be the keeper
  return person.isLiving ? person : null;
}

/**
 * Format a generation number as an ordinal string.
 */
export function formatOrdinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

/**
 * Format removal from prime as a human-readable string.
 */
export function formatRemoval(hops: number): string {
  if (hops === -1) return 'Branch extinct';
  if (hops === 0) return 'Prime Line';
  if (hops === 1) return 'Once removed from prime';
  if (hops === 2) return 'Twice removed from prime';
  if (hops === 3) return 'Thrice removed from prime';
  return `${hops}x removed from prime`;
}

/**
 * Get a blue shade hex color based on namekeeper generation depth.
 * Higher generation = deeper blue.
 */
export function getGenerationColor(gen: number): string {
  const colors = [
    '#dbeafe', // gen 1 - blue-100
    '#bfdbfe', // gen 2 - blue-200
    '#93c5fd', // gen 3 - blue-300
    '#60a5fa', // gen 4 - blue-400
    '#3b82f6', // gen 5+ - blue-500
  ];
  return colors[Math.min(gen - 1, colors.length - 1)];
}
