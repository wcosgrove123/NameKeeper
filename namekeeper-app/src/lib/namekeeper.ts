import { Person, Family, GedcomData, Branch, NameKeeperResult } from './types';
import { getSons, getFather, parseBirthDate } from './gedcom-parser';

/**
 * Find all patriarchs for a given surname.
 * A patriarch is a male with the surname who has no father with the same surname.
 * This identifies the root(s) of each patrilineal line.
 */
function findPatriarchs(surname: string, data: GedcomData): Person[] {
  const patriarchs: Person[] = [];

  for (const person of data.persons.values()) {
    if (person.sex !== 'M' || person.surname !== surname) continue;

    const father = getFather(person, data);
    // Patriarch = no father, or father has a different surname
    if (!father || father.surname !== surname) {
      patriarchs.push(person);
    }
  }

  // Sort by birth date (oldest first)
  patriarchs.sort((a, b) => {
    const dateA = parseBirthDate(a.birthDate || '');
    const dateB = parseBirthDate(b.birthDate || '');
    if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });

  return patriarchs;
}

/**
 * Check if a person has any living male patrilineal descendants.
 */
export function hasLivingMaleDescendant(person: Person, data: GedcomData, visited: Set<string> = new Set()): boolean {
  if (visited.has(person.id)) return false;
  visited.add(person.id);

  if (person.isLiving && person.sex === 'M') return true;

  const sons = getSons(person.id, data);
  for (const son of sons) {
    if (hasLivingMaleDescendant(son, data, visited)) return true;
  }
  return false;
}

/**
 * Core Name Keeper DFS algorithm.
 *
 * Starting from a patriarch, follows the eldest son's line as deep as possible.
 * When a line terminates (no male heirs), backtracks to the next brother's eldest son.
 * Returns the current living Name Keeper and full succession metadata.
 */
function findNameKeeperDFS(
  person: Person,
  data: GedcomData,
  depth: number,
  chain: Person[],
  branches: Branch[],
  visited: Set<string>
): Person | null {
  if (visited.has(person.id)) return null;
  visited.add(person.id);

  const sons = getSons(person.id, data);

  if (sons.length === 0) {
    // Terminal node — no sons
    if (person.isLiving) {
      return person; // This person IS the current Name Keeper for this line
    }
    return null; // Line died out
  }

  // Has sons — try eldest first (DFS)
  for (let i = 0; i < sons.length; i++) {
    const son = sons[i];
    const newChain = [...chain, son];

    // Track this as a branch if there are multiple sons
    if (sons.length > 1) {
      const branchStatus = hasLivingMaleDescendant(son, data) ? 'active' : 'extinct';
      const branchMembers = collectPatrilinealMembers(son, data);

      branches.push({
        ancestor: son,
        status: branchStatus,
        depth: depth + 1,
        members: branchMembers,
        terminalPerson: branchStatus === 'extinct' ? findTerminalPerson(son, data) : undefined,
      });
    }

    const result = findNameKeeperDFS(son, data, depth + 1, newChain, branches, visited);
    if (result) {
      // Update the chain to include this path
      chain.length = 0;
      chain.push(...newChain);
      return result;
    }
  }

  return null; // All sons' lines are extinct
}

/**
 * Collect all members in a patrilineal line from a given person downward.
 */
function collectPatrilinealMembers(person: Person, data: GedcomData, visited: Set<string> = new Set()): Person[] {
  if (visited.has(person.id)) return [];
  visited.add(person.id);

  const members: Person[] = [person];
  const sons = getSons(person.id, data);
  for (const son of sons) {
    members.push(...collectPatrilinealMembers(son, data, visited));
  }
  return members;
}

/**
 * Find the last person in an extinct branch (deepest descendant).
 */
function findTerminalPerson(person: Person, data: GedcomData, visited: Set<string> = new Set()): Person {
  if (visited.has(person.id)) return person;
  visited.add(person.id);

  const sons = getSons(person.id, data);
  if (sons.length === 0) return person;

  // Follow the eldest son to find the deepest terminal
  let deepest = person;
  for (const son of sons) {
    const terminal = findTerminalPerson(son, data, visited);
    deepest = terminal; // last one found
  }
  return deepest;
}

/**
 * Build the full succession chain from patriarch to the Name Keeper.
 */
function buildSuccessionChain(patriarch: Person, nameKeeper: Person | null, data: GedcomData): Person[] {
  if (!nameKeeper) return [patriarch];

  // Walk up from nameKeeper to patriarch via fathers
  const chain: Person[] = [];
  let current: Person | null = nameKeeper;

  while (current) {
    chain.unshift(current);
    if (current.id === patriarch.id) break;
    current = getFather(current, data);
    // Safety check: if we've walked too far or looped, stop
    if (chain.length > 50) break;
  }

  // If we didn't reach the patriarch, prepend it
  if (chain.length === 0 || chain[0].id !== patriarch.id) {
    chain.unshift(patriarch);
  }

  return chain;
}

/**
 * Count males with a given surname.
 */
function countMales(surname: string, data: GedcomData): { total: number; living: number } {
  let total = 0;
  let living = 0;
  for (const person of data.persons.values()) {
    if (person.sex === 'M' && person.surname === surname) {
      total++;
      if (person.isLiving) living++;
    }
  }
  return { total, living };
}

/**
 * Compute the Name Keeper result for a single surname.
 */
export function computeNameKeeper(surname: string, data: GedcomData): NameKeeperResult[] {
  const patriarchs = findPatriarchs(surname, data);
  const results: NameKeeperResult[] = [];
  const { total: totalMales, living: livingMales } = countMales(surname, data);

  for (const patriarch of patriarchs) {
    const chain: Person[] = [patriarch];
    const branches: Branch[] = [];
    const visited = new Set<string>();

    const nameKeeper = findNameKeeperDFS(patriarch, data, 0, chain, branches, visited);
    const successionChain = buildSuccessionChain(patriarch, nameKeeper, data);

    results.push({
      surname,
      patriarch,
      currentNameKeeper: nameKeeper,
      successionChain,
      branches,
      totalMales,
      livingMales,
    });
  }

  return results;
}

/**
 * Compute Name Keepers for ALL surnames in the tree.
 * Returns results grouped by surname, sorted by frequency.
 */
export function computeAllNameKeepers(data: GedcomData): Map<string, NameKeeperResult[]> {
  const results = new Map<string, NameKeeperResult[]>();

  // Find all unique surnames for males
  const surnames = new Set<string>();
  for (const person of data.persons.values()) {
    if (person.sex === 'M' && person.surname) {
      surnames.add(person.surname);
    }
  }

  // Compute for each surname
  for (const surname of surnames) {
    const surnameResults = computeNameKeeper(surname, data);
    if (surnameResults.length > 0) {
      results.set(surname, surnameResults);
    }
  }

  return results;
}

/**
 * Get all person IDs that are on the succession chain for a given result.
 * Used for highlighting in the visualization.
 */
export function getSuccessionIds(result: NameKeeperResult): Set<string> {
  return new Set(result.successionChain.map(p => p.id));
}

/**
 * Get all person IDs that are on extinct branches for a given result.
 */
export function getExtinctBranchIds(result: NameKeeperResult): Set<string> {
  const ids = new Set<string>();
  for (const branch of result.branches) {
    if (branch.status === 'extinct') {
      for (const member of branch.members) {
        ids.add(member.id);
      }
    }
  }
  return ids;
}
