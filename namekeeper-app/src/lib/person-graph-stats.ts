import { GedcomData, Person } from './types';

/** Compose a display name including optional middle names and suffix. */
export function formatPersonName(p: Person): string {
  const given = [p.givenName, p.middleNames].filter(Boolean).join(' ').trim();
  const base = `${given} ${p.surname}`.trim();
  return p.suffix ? `${base}, ${p.suffix}` : base;
}

/** Count all ancestors reachable upward through familyAsChild. Cycle-safe. */
export function countAncestors(personId: string, data: GedcomData): number {
  const visited = new Set<string>();
  const queue: string[] = [personId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const person = data.persons.get(current);
    if (!person?.familyAsChild) continue;
    const family = data.families.get(person.familyAsChild);
    if (!family) continue;

    for (const parentId of [family.husbandId, family.wifeId]) {
      if (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        queue.push(parentId);
      }
    }
  }

  return visited.size;
}

/** Count all descendants reachable downward through all spouse-families. Cycle-safe. */
export function countDescendants(personId: string, data: GedcomData): number {
  const visited = new Set<string>();
  const queue: string[] = [personId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const person = data.persons.get(current);
    if (!person) continue;

    for (const famId of person.familiesAsSpouse) {
      const family = data.families.get(famId);
      if (!family) continue;
      for (const childId of family.childIds) {
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  return visited.size;
}

export interface BiographyFromNotes {
  interests?: string;
  activities?: string;
  bioNotes?: string;
  residual: string[];
}

/**
 * Parse legacy notes[] entries that use the "Interests: ...", "Activities: ...",
 * "Bio notes: ..." convention into structured biography fields.
 * Remaining notes come back under `residual`.
 */
export function parseBiographyFromNotes(notes: string[]): BiographyFromNotes {
  const result: BiographyFromNotes = { residual: [] };

  for (const note of notes) {
    const trimmed = note.trim();
    const lower = trimmed.toLowerCase();

    if (lower.startsWith('interests:')) {
      result.interests = trimmed.slice(10).trim().replace(/,\s*$/, '');
    } else if (lower.startsWith('activities:')) {
      result.activities = trimmed.slice(11).trim().replace(/,\s*$/, '');
    } else if (lower.startsWith('bio notes:') || lower.startsWith('bionotes:')) {
      const idx = lower.indexOf(':');
      result.bioNotes = trimmed.slice(idx + 1).trim();
    } else {
      result.residual.push(note);
    }
  }

  return result;
}

/** Resolve the effective biography data for a person, preferring real fields
 * over parsed legacy notes. */
export function resolveBiography(person: Person): BiographyFromNotes {
  const fromNotes = parseBiographyFromNotes(person.notes ?? []);
  return {
    interests: person.interests ?? fromNotes.interests,
    activities: person.activities ?? fromNotes.activities,
    bioNotes: person.bioNotes ?? fromNotes.bioNotes,
    residual: fromNotes.residual,
  };
}
