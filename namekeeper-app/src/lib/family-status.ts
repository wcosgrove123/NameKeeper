import { GedcomData, Family } from './types';
import { parseBirthDate } from './gedcom-parser';

/**
 * Decide whether a family represents an ex / former marriage.
 *
 * Signals, in priority order:
 *   1. Explicit `divorced` (from GEDCOM `DIV` or `_SEPR`)
 *   2. Sibling-family heuristic: one of the same person's other spouse-families
 *      is explicitly `_CURRENT Y`, and this one is `_CURRENT N`. This handles
 *      Family Echo exports where `_CURRENT Y` marks the "primary" relationship
 *      and the others are exes by implication.
 *   3. Date-based fallback: this is the earliest of multiple dated marriages.
 *
 * NOTE: a bare `_CURRENT N` with no sibling marked Y is NOT treated as ex —
 * Family Echo sometimes leaves all of a person's families as `_CURRENT N`.
 */
export function isExFamily(famId: string, data: GedcomData): boolean {
  const fam = data.families.get(famId);
  if (!fam) return false;
  if (fam.divorced) return true;

  for (const spouseId of [fam.husbandId, fam.wifeId]) {
    if (!spouseId) continue;
    const sp = data.persons.get(spouseId);
    if (!sp || sp.familiesAsSpouse.length <= 1) continue;

    const siblings = sp.familiesAsSpouse
      .map((id) => data.families.get(id))
      .filter((f): f is Family => !!f);

    // Sibling-family heuristic
    const siblingHasCurrent = siblings.some((f) => f.id !== famId && f.isCurrent === true);
    if (siblingHasCurrent && fam.isCurrent !== true) {
      return true;
    }

    // Date-based fallback (earliest dated marriage in a multi-set is the ex)
    const thisDate = parseBirthDate(fam.marriageDate || '');
    if (thisDate) {
      for (const other of siblings) {
        if (other.id === famId) continue;
        const otherDate = parseBirthDate(other.marriageDate || '');
        if (otherDate && thisDate < otherDate) return true;
      }
    }
  }

  return false;
}

/**
 * "Ex marriages count for relationship calculations only if they produced
 * children." Returns true if this family should be skipped when walking the
 * kinship graph.
 */
export function isIrrelevantExFamily(famId: string, data: GedcomData): boolean {
  const fam = data.families.get(famId);
  if (!fam) return true;
  return isExFamily(famId, data) && fam.childIds.length === 0;
}
