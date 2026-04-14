import { Person, GedcomData } from './types';
import { isExFamily, isIrrelevantExFamily } from './family-status';

interface AncestorPath {
  personId: string;
  generations: number;
  throughMarriage: boolean; // true if path goes through a spouse (in-law)
}

// ── Step/half-sibling detection ──────────────────────────────────────

/** PersonA is a step-parent of personB if A is (non-divorced) married to a bio
 *  parent of B but is NOT themselves a bio parent of B.
 *  Ex-spouses of a bio parent are not step-parents. */
function isStepParent(personAId: string, personBId: string, data: GedcomData): boolean {
  const childB = data.persons.get(personBId);
  if (!childB?.familyAsChild) return false;
  const birthFam = data.families.get(childB.familyAsChild);
  if (!birthFam) return false;
  // A IS a bio parent → not a step-parent
  if (birthFam.husbandId === personAId || birthFam.wifeId === personAId) return false;
  // A must share a non-ex marriage with one of B's bio parents
  for (const bioParentId of [birthFam.husbandId, birthFam.wifeId]) {
    if (!bioParentId) continue;
    const bioParent = data.persons.get(bioParentId);
    if (!bioParent) continue;
    for (const fid of bioParent.familiesAsSpouse) {
      const fam = data.families.get(fid);
      if (!fam) continue;
      if (isExFamily(fid, data)) continue; // ex-spouse is not a step-parent
      if (fam.husbandId === personAId || fam.wifeId === personAId) {
        return true;
      }
    }
  }
  return false;
}

/** PersonA and personB are half-siblings if they share exactly one bio parent. */
function isHalfSibling(personAId: string, personBId: string, data: GedcomData): boolean {
  const pA = data.persons.get(personAId);
  const pB = data.persons.get(personBId);
  if (!pA?.familyAsChild || !pB?.familyAsChild) return false;
  if (pA.familyAsChild === pB.familyAsChild) return false; // full siblings, not half
  const famA = data.families.get(pA.familyAsChild);
  const famB = data.families.get(pB.familyAsChild);
  if (!famA || !famB) return false;
  const parentsA = new Set([famA.husbandId, famA.wifeId].filter(Boolean));
  const parentsB = new Set([famB.husbandId, famB.wifeId].filter(Boolean));
  let shared = 0;
  for (const p of parentsA) { if (parentsB.has(p)) shared++; }
  return shared === 1; // exactly one shared parent
}

/**
 * Calculate the relationship between two people.
 * Returns a human-readable relationship string like "2nd cousin once removed"
 */
export function calculateRelationship(
  personAId: string,
  personBId: string,
  data: GedcomData,
  _depth: number = 0
): string {
  // Guard against infinite recursion through spouse chains
  if (_depth > 3) return 'Not related';
  if (personAId === personBId) return 'Self';

  // Check step-parent/step-child BEFORE other checks
  if (isStepParent(personAId, personBId, data)) {
    const personA = data.persons.get(personAId);
    if (personA?.sex === 'M') return 'Step-Father';
    if (personA?.sex === 'F') return 'Step-Mother';
    return 'Step-Parent';
  }
  if (isStepParent(personBId, personAId, data)) {
    const personA = data.persons.get(personAId);
    if (personA?.sex === 'M') return 'Step-Son';
    if (personA?.sex === 'F') return 'Step-Daughter';
    return 'Step-Child';
  }

  // Check half-siblings
  if (isHalfSibling(personAId, personBId, data)) {
    const personA = data.persons.get(personAId);
    if (personA?.sex === 'M') return 'Half-Brother';
    if (personA?.sex === 'F') return 'Half-Sister';
    return 'Half-Sibling';
  }

  // Check if they're married (spouse check first, before ancestor walk).
  // Distinguish current spouse from ex-spouse so the LCA fallback never
  // mislabels an ex as "Self (by marriage)" or "Not related".
  const pA = data.persons.get(personAId);
  if (pA) {
    for (const famId of pA.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      const isMatch =
        (fam.husbandId === personAId && fam.wifeId === personBId) ||
        (fam.wifeId === personAId && fam.husbandId === personBId);
      if (!isMatch) continue;
      const ex = isExFamily(famId, data);
      if (pA.sex === 'M') return ex ? 'Ex-Husband' : 'Husband';
      if (pA.sex === 'F') return ex ? 'Ex-Wife' : 'Wife';
      return ex ? 'Ex-Spouse' : 'Spouse';
    }
  }

  // Find all ancestors of both people with generation counts
  const ancestorsA = getAllAncestors(personAId, data);
  const ancestorsB = getAllAncestors(personBId, data);

  // Find the Lowest Common Ancestor (LCA)
  let bestLCA: { id: string; genA: number; genB: number; inLaw: boolean } | null = null;

  for (const [ancestorId, pathA] of ancestorsA) {
    const pathB = ancestorsB.get(ancestorId);
    if (!pathB) continue;

    const totalGen = pathA.generations + pathB.generations;
    const isInLaw = pathA.throughMarriage || pathB.throughMarriage;

    // Prefer: (1) shorter total generations, (2) non-in-law paths over in-law paths
    if (!bestLCA || totalGen < bestLCA.genA + bestLCA.genB ||
        (totalGen === bestLCA.genA + bestLCA.genB && !isInLaw && bestLCA.inLaw)) {
      bestLCA = {
        id: ancestorId,
        genA: pathA.generations,
        genB: pathB.generations,
        inLaw: isInLaw,
      };
    }
  }

  if (!bestLCA) {
    // Check specific in-law relationships first (sibling, uncle/aunt)
    const inLawResult = checkInLawRelationship(personAId, personBId, data);
    if (inLawResult) return inLawResult;

    // Generic: if A is married to someone related to B, use that relationship + "by marriage"
    // but re-gender the label to match personA's sex, not the spouse's.
    // Skip childless divorces — no lasting kinship.
    const pA2 = data.persons.get(personAId);
    if (pA2) {
      for (const famId of pA2.familiesAsSpouse) {
        const fam = data.families.get(famId);
        if (!fam) continue;
        if (isIrrelevantExFamily(famId, data)) continue;
        const spouseId = fam.husbandId === personAId ? fam.wifeId : fam.husbandId;
        if (spouseId && spouseId !== personBId) {
          const spouseRel = calculateRelationship(spouseId, personBId, data, _depth + 1);
          if (spouseRel && spouseRel !== 'Not related' && spouseRel !== 'Self') {
            return `${regender(spouseRel, pA2.sex)} (by marriage)`;
          }
        }
      }
    }

    return 'Not related';
  }

  const { genA, genB, inLaw } = bestLCA;
  const relationship = getRelationshipName(genA, genB, personAId, personBId, data);

  if (inLaw && !relationship.includes('spouse')) {
    return relationship + ' (by marriage)';
  }

  return relationship;
}

function getAllAncestors(
  personId: string,
  data: GedcomData
): Map<string, AncestorPath> {
  const ancestors = new Map<string, AncestorPath>();
  const visited = new Set<string>();

  function walk(pid: string, gen: number, throughMarriage: boolean) {
    if (visited.has(pid)) return;
    visited.add(pid);

    ancestors.set(pid, { personId: pid, generations: gen, throughMarriage });

    const person = data.persons.get(pid);
    if (!person) return;

    // Walk up through parents
    if (person.familyAsChild) {
      const fam = data.families.get(person.familyAsChild);
      if (fam) {
        if (fam.husbandId) walk(fam.husbandId, gen + 1, throughMarriage);
        if (fam.wifeId) walk(fam.wifeId, gen + 1, throughMarriage);
      }
    }

    // Walk through spouse (marks as in-law path).
    // Skip childless ex-marriages — they don't create lasting kinship.
    for (const famId of person.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      if (isIrrelevantExFamily(famId, data)) continue;
      const spouseId = fam.husbandId === pid ? fam.wifeId : fam.husbandId;
      if (spouseId && !visited.has(spouseId)) {
        // Don't walk up spouse's parents (that would make everyone related)
        // Just mark the spouse as gen 0 relative (through marriage)
        if (!ancestors.has(spouseId)) {
          ancestors.set(spouseId, { personId: spouseId, generations: gen, throughMarriage: true });
        }
      }
    }
  }

  walk(personId, 0, false);
  return ancestors;
}

function checkInLawRelationship(
  personAId: string,
  personBId: string,
  data: GedcomData
): string | null {
  const personA = data.persons.get(personAId);
  const personB = data.persons.get(personBId);
  if (!personA || !personB) return null;

  // Check if A is married to B (label exes distinctly)
  for (const famId of personA.familiesAsSpouse) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    const isMatch =
      (fam.husbandId === personAId && fam.wifeId === personBId) ||
      (fam.wifeId === personAId && fam.husbandId === personBId);
    if (!isMatch) continue;
    const ex = isExFamily(famId, data);
    if (personA.sex === 'M') return ex ? 'Ex-Husband' : 'Husband';
    if (personA.sex === 'F') return ex ? 'Ex-Wife' : 'Wife';
    return ex ? 'Ex-Spouse' : 'Spouse';
  }

  // Check if A is married to B's sibling (sister/brother-in-law)
  if (personB.familyAsChild) {
    const bBirthFam = data.families.get(personB.familyAsChild);
    if (bBirthFam) {
      for (const sibId of bBirthFam.childIds) {
        if (sibId === personBId) continue;
        // Is personA married to this sibling?
        const sib = data.persons.get(sibId);
        if (!sib) continue;
        for (const famId of sib.familiesAsSpouse) {
          const fam = data.families.get(famId);
          if (!fam) continue;
          if (isIrrelevantExFamily(famId, data)) continue;
          if ((fam.husbandId === sibId && fam.wifeId === personAId) ||
              (fam.wifeId === sibId && fam.husbandId === personAId)) {
            if (personA.sex === 'M') return 'Brother-in-Law';
            if (personA.sex === 'F') return 'Sister-in-Law';
            return 'Sibling-in-Law';
          }
        }
      }
    }
  }

  // Check if A is married to B's uncle/aunt (aunt/uncle by marriage)
  // i.e., B's parent has a sibling, and A is married to that sibling
  if (personB.familyAsChild) {
    const bBirthFam2 = data.families.get(personB.familyAsChild);
    if (bBirthFam2) {
      for (const parentId of [bBirthFam2.husbandId, bBirthFam2.wifeId]) {
        if (!parentId) continue;
        const parent = data.persons.get(parentId);
        if (!parent?.familyAsChild) continue;
        const gpFam = data.families.get(parent.familyAsChild);
        if (!gpFam) continue;
        for (const uncleId of gpFam.childIds) {
          if (uncleId === parentId) continue;
          const uncle = data.persons.get(uncleId);
          if (!uncle) continue;
          for (const famId of uncle.familiesAsSpouse) {
            const fam = data.families.get(famId);
            if (!fam) continue;
            if (isIrrelevantExFamily(famId, data)) continue;
            if ((fam.husbandId === uncleId && fam.wifeId === personAId) ||
                (fam.wifeId === uncleId && fam.husbandId === personAId)) {
              if (personA.sex === 'M') return 'Uncle (by marriage)';
              if (personA.sex === 'F') return 'Aunt (by marriage)';
              return 'Uncle/Aunt (by marriage)';
            }
          }
        }
      }
    }
  }

  // Check if A's sibling is married to B (B is the in-law)
  if (personA.familyAsChild) {
    const aBirthFam = data.families.get(personA.familyAsChild);
    if (aBirthFam) {
      for (const sibId of aBirthFam.childIds) {
        if (sibId === personAId) continue;
        const sib = data.persons.get(sibId);
        if (!sib) continue;
        for (const famId of sib.familiesAsSpouse) {
          const fam = data.families.get(famId);
          if (!fam) continue;
          if (isIrrelevantExFamily(famId, data)) continue;
          if ((fam.husbandId === sibId && fam.wifeId === personBId) ||
              (fam.wifeId === sibId && fam.husbandId === personBId)) {
            if (personA.sex === 'M') return 'Brother-in-Law';
            if (personA.sex === 'F') return 'Sister-in-Law';
            return 'Sibling-in-Law';
          }
        }
      }
    }
  }

  return null;
}

function getRelationshipName(
  genA: number,
  genB: number,
  personAId: string,
  personBId: string,
  data: GedcomData
): string {
  // Ensure genA <= genB for consistent naming
  const [nearGen, farGen] = genA <= genB ? [genA, genB] : [genB, genA];
  const [nearId, farId] = genA <= genB ? [personAId, personBId] : [personBId, personAId];

  // Same person (shouldn't reach here)
  if (nearGen === 0 && farGen === 0) return 'Self';

  // Spouse (gen 0 to gen 0 through marriage)
  if (nearGen === 0 && farGen === 0) return 'Spouse';

  // Direct ancestor/descendant
  if (nearGen === 0) {
    // nearId is the ancestor, farId is the descendant
    // We want the label for personA relative to personB
    // If personA is the ancestor (genA=0), return ancestor label (Father/Grandfather)
    // If personA is the descendant (genB=0), return descendant label (Son/Grandson)
    if (genA === 0) {
      // personA is the ancestor — label should be what personA is to personB (e.g., Father)
      return getAncestorLabel(farGen, personAId, data);
    } else {
      // personA is the descendant — label should be what personA is to personB (e.g., Son)
      return getDescendantLabel(farGen, personAId, data);
    }
  }

  // Siblings (same parents)
  if (nearGen === 1 && farGen === 1) {
    const personA = data.persons.get(personAId);
    if (personA?.sex === 'M') return 'Brother';
    if (personA?.sex === 'F') return 'Sister';
    return 'Sibling';
  }

  // Uncle/Aunt or Nephew/Niece
  if (nearGen === 1 && farGen === 2) {
    const personA = data.persons.get(personAId);
    if (genA <= genB) {
      // personA is closer to LCA = uncle/aunt (older generation)
      if (personA?.sex === 'M') return 'Uncle';
      if (personA?.sex === 'F') return 'Aunt';
      return 'Uncle/Aunt';
    } else {
      // personA is further from LCA = nephew/niece (younger generation)
      if (personA?.sex === 'M') return 'Nephew';
      if (personA?.sex === 'F') return 'Niece';
      return 'Nephew/Niece';
    }
  }

  // Great-uncle/aunt or Great-nephew/niece
  if (nearGen === 1 && farGen > 2) {
    const greats = farGen - 2;
    const prefix = greats === 1 ? 'Great-' : `${ordinal(greats)} Great-`;
    const personA = data.persons.get(personAId);
    if (genA <= genB) {
      // personA is closer to LCA → older generation → uncle/aunt
      if (personA?.sex === 'M') return `${prefix}Uncle`;
      if (personA?.sex === 'F') return `${prefix}Aunt`;
      return `${prefix}Uncle/Aunt`;
    } else {
      // personA is further from LCA → younger generation → nephew/niece
      if (personA?.sex === 'M') return `${prefix}Nephew`;
      if (personA?.sex === 'F') return `${prefix}Niece`;
      return `${prefix}Nephew/Niece`;
    }
  }

  // Cousins
  const cousinDegree = nearGen - 1;
  const removed = farGen - nearGen;

  let result = `${ordinal(cousinDegree)} Cousin`;
  if (removed > 0) {
    result += ` ${removed}x Removed`;
  }

  return result;
}

/** Label for an ancestor (what personA is to personB when personA is the ancestor) */
function getAncestorLabel(generations: number, ancestorId: string, data: GedcomData): string {
  const person = data.persons.get(ancestorId);
  if (generations === 1) {
    if (person?.sex === 'M') return 'Father';
    if (person?.sex === 'F') return 'Mother';
    return 'Parent';
  }
  if (generations === 2) {
    if (person?.sex === 'M') return 'Grandfather';
    if (person?.sex === 'F') return 'Grandmother';
    return 'Grandparent';
  }
  const greats = generations - 2;
  const prefix = greats === 1 ? 'Great-' : `${ordinal(greats)} Great-`;
  if (person?.sex === 'M') return `${prefix}Grandfather`;
  if (person?.sex === 'F') return `${prefix}Grandmother`;
  return `${prefix}Grandparent`;
}

/** Label for a descendant (what personA is to personB when personA is the descendant) */
function getDescendantLabel(generations: number, descendantId: string, data: GedcomData): string {
  const person = data.persons.get(descendantId);
  if (generations === 1) {
    if (person?.sex === 'M') return 'Son';
    if (person?.sex === 'F') return 'Daughter';
    return 'Child';
  }
  if (generations === 2) {
    if (person?.sex === 'M') return 'Grandson';
    if (person?.sex === 'F') return 'Granddaughter';
    return 'Grandchild';
  }
  const greats = generations - 2;
  const prefix = greats === 1 ? 'Great-' : `${ordinal(greats)} Great-`;
  if (person?.sex === 'M') return `${prefix}Grandson`;
  if (person?.sex === 'F') return `${prefix}Granddaughter`;
  return `${prefix}Grandchild`;
}

/** Re-gender a relationship label to match a person's sex.
 *  e.g. "Granddaughter" + sex "M" → "Grandson" */
function regender(rel: string, sex: string): string {
  // Tuple is [pattern, maleForm, femaleForm] — the male word goes in slot 2
  // regardless of which form the input string contains.
  const swaps: [RegExp, string, string][] = [
    [/\bGrandfather\b/, 'Grandfather', 'Grandmother'],
    [/\bGrandmother\b/, 'Grandfather', 'Grandmother'],
    [/\bGrandson\b/, 'Grandson', 'Granddaughter'],
    [/\bGranddaughter\b/, 'Grandson', 'Granddaughter'],
    [/\bFather\b/, 'Father', 'Mother'],
    [/\bMother\b/, 'Father', 'Mother'],
    [/\bSon\b/, 'Son', 'Daughter'],
    [/\bDaughter\b/, 'Son', 'Daughter'],
    [/\bBrother\b/, 'Brother', 'Sister'],
    [/\bSister\b/, 'Brother', 'Sister'],
    [/\bUncle\b/, 'Uncle', 'Aunt'],
    [/\bAunt\b/, 'Uncle', 'Aunt'],
    [/\bNephew\b/, 'Nephew', 'Niece'],
    [/\bNiece\b/, 'Nephew', 'Niece'],
    [/\bHusband\b/, 'Husband', 'Wife'],
    [/\bWife\b/, 'Husband', 'Wife'],
  ];
  for (const [pattern, maleForm, femaleForm] of swaps) {
    if (pattern.test(rel)) {
      const target = sex === 'M' ? maleForm : sex === 'F' ? femaleForm : rel.replace(pattern, `${maleForm}/${femaleForm}`);
      return rel.replace(pattern, target);
    }
  }
  return rel;
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}
