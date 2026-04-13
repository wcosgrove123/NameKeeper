import { Person, GedcomData } from './types';
import { getChildrenOfFamily } from './gedcom-parser';

export interface MatriarchFamily {
  generation: number;
  birthOrderLabel: string;
  lineType: 'p' | 'm';
  husband: Person | null;
  wife: Person | null;
  familyId: string;
  surname: string;
  childCount: number;
  subFamilies: MatriarchFamily[];
}

export interface MatriarchStats {
  matriarch: Person;
  marriedIntoSurname: string;
  maidenName: string;
  rootFamily: MatriarchFamily;
  totalFamilies: number;
  patrilinealFamilies: number;
  matrilinealFamilies: number;
  namesMergedIn: string[];
  namesBranchedOut: string[];
  generationDepth: number;
}

/**
 * Compute matriarch stats for a specific woman.
 * Tracks all families that emerged from her marriage, split into
 * patrilineal (surname kept) and matrilineal (surname changed).
 */
export function computeMatriarchStats(
  personId: string,
  data: GedcomData,
  primarySurname: string
): MatriarchStats | null {
  const matriarch = data.persons.get(personId);
  if (!matriarch || matriarch.familiesAsSpouse.length === 0) return null;

  // Find the family where this woman is the wife
  let rootFamilyId: string | null = null;
  let husband: Person | null = null;
  let familySurname = primarySurname;

  for (const famId of matriarch.familiesAsSpouse) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    if (fam.wifeId === personId) {
      rootFamilyId = famId;
      if (fam.husbandId) {
        husband = data.persons.get(fam.husbandId) || null;
        if (husband) familySurname = husband.surname;
      }
      break;
    }
    // Also check if she's listed as husband (unlikely but handle gracefully)
    if (fam.husbandId === personId) {
      rootFamilyId = famId;
      if (fam.wifeId) {
        husband = data.persons.get(fam.wifeId) || null;
      }
      break;
    }
  }

  if (!rootFamilyId) return null;

  const namesMergedIn = new Set<string>();
  const namesBranchedOut = new Set<string>();
  let maxDepth = 0;

  // Track the matriarch's own maiden name as a merged name
  if (matriarch.surname && matriarch.surname !== familySurname) {
    namesMergedIn.add(matriarch.surname);
  }

  const children = getChildrenOfFamily(rootFamilyId, data);

  // Build the root family
  const rootFamily: MatriarchFamily = {
    generation: 0,
    birthOrderLabel: '',
    lineType: 'p',
    husband,
    wife: matriarch,
    familyId: rootFamilyId,
    surname: familySurname,
    childCount: children.length,
    subFamilies: [],
  };

  // Recurse into children's families
  const visited = new Set<string>();
  visited.add(rootFamilyId);

  buildSubFamilies(
    rootFamily,
    children,
    familySurname,
    1,
    data,
    namesMergedIn,
    namesBranchedOut,
    visited
  );

  // Count totals
  let totalFamilies = 0;
  let patrilinealFamilies = 0;
  let matrilinealFamilies = 0;

  function countFamilies(fam: MatriarchFamily) {
    totalFamilies++;
    if (fam.lineType === 'p') patrilinealFamilies++;
    else matrilinealFamilies++;
    if (fam.generation > maxDepth) maxDepth = fam.generation;
    for (const sub of fam.subFamilies) countFamilies(sub);
  }
  countFamilies(rootFamily);

  // Determine maiden name
  const maidenName = matriarch.marriedName
    ? matriarch.surname // if marriedName exists, surname might be original
    : (matriarch.surname !== familySurname ? matriarch.surname : '');

  return {
    matriarch,
    marriedIntoSurname: familySurname,
    maidenName: maidenName || matriarch.surname,
    rootFamily,
    totalFamilies,
    patrilinealFamilies,
    matrilinealFamilies,
    namesMergedIn: Array.from(namesMergedIn),
    namesBranchedOut: Array.from(namesBranchedOut),
    generationDepth: maxDepth,
  };
}

function buildSubFamilies(
  parentFamily: MatriarchFamily,
  children: Person[],
  parentSurname: string,
  generation: number,
  data: GedcomData,
  namesMergedIn: Set<string>,
  namesBranchedOut: Set<string>,
  visited: Set<string>
): void {
  let orderIndex = 0;

  for (const child of children) {
    // Find families where this child is a spouse
    for (const famId of child.familiesAsSpouse) {
      if (visited.has(famId)) continue;
      const fam = data.families.get(famId);
      if (!fam) continue;
      visited.add(famId);

      // Determine spouse
      const spouseId = fam.husbandId === child.id ? fam.wifeId : fam.husbandId;
      const spouse = spouseId ? data.persons.get(spouseId) || null : null;

      // Determine if patrilineal or matrilineal
      // Patrilineal = the family surname stays the same as parent (typically sons marrying)
      // Matrilineal = a daughter married someone with a different surname
      //
      // Key logic: check who the husband is. If the husband has the parent surname, it's patrilineal.
      // If the husband has a different surname (daughter married out), it's matrilineal.
      const husb = fam.husbandId ? data.persons.get(fam.husbandId) || null : null;

      let familySurname = parentSurname;
      let isPatrilineal = true;

      if (husb) {
        familySurname = husb.surname;
        isPatrilineal = husb.surname === parentSurname;
      } else if (child.marriedName && child.marriedName !== parentSurname) {
        familySurname = child.marriedName;
        isPatrilineal = false;
      }

      if (!isPatrilineal && familySurname !== parentSurname) {
        namesBranchedOut.add(familySurname);
      }

      // Track names merged in (spouses who married INTO the surname line)
      if (isPatrilineal && spouse && spouse.surname && spouse.surname !== parentSurname) {
        namesMergedIn.add(spouse.surname);
      }

      const label = String.fromCharCode(97 + orderIndex); // a, b, c...
      orderIndex++;

      const husband = fam.husbandId ? data.persons.get(fam.husbandId) || null : null;
      const wife = fam.wifeId ? data.persons.get(fam.wifeId) || null : null;
      const grandchildren = getChildrenOfFamily(famId, data);

      const subFamily: MatriarchFamily = {
        generation,
        birthOrderLabel: label,
        lineType: isPatrilineal ? 'p' : 'm',
        husband,
        wife,
        familyId: famId,
        surname: familySurname,
        childCount: grandchildren.length,
        subFamilies: [],
      };

      parentFamily.subFamilies.push(subFamily);

      // Recurse into this family's children
      if (grandchildren.length > 0) {
        buildSubFamilies(
          subFamily,
          grandchildren,
          familySurname,
          generation + 1,
          data,
          namesMergedIn,
          namesBranchedOut,
          visited
        );
      }
    }
  }
}

/**
 * Compute matriarch stats for all married women connected to a surname.
 * Includes women who married IN (took the surname) and women who married OUT (daughters).
 */
export function computeAllMatriarchStats(
  data: GedcomData,
  surname: string
): Map<string, MatriarchStats> {
  const results = new Map<string, MatriarchStats>();

  for (const person of data.persons.values()) {
    if (person.sex !== 'F') continue;
    if (person.familiesAsSpouse.length === 0) continue;

    // Check if this woman is connected to the surname
    let isConnected = false;

    for (const famId of person.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;

      // She married into the surname (husband has the surname)
      if (fam.husbandId) {
        const husband = data.persons.get(fam.husbandId);
        if (husband?.surname === surname) {
          isConnected = true;
          break;
        }
      }

      // She's a daughter who married out (she has the surname as maiden)
      if (person.surname === surname || person.marriedName === surname) {
        isConnected = true;
        break;
      }
    }

    if (!isConnected) continue;

    const stats = computeMatriarchStats(person.id, data, surname);
    if (stats && stats.totalFamilies > 0) {
      results.set(person.id, stats);
    }
  }

  return results;
}

/**
 * Format a matriarch family label like "gen2bp" or "gen1am"
 */
export function formatMatriarchLabel(gen: number, order: string, lineType: 'p' | 'm'): string {
  return `gen${gen}${order}${lineType}`;
}
