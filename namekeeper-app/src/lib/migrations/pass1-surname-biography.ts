/**
 * Pass 1 migration — runs on every load (idempotent).
 *
 * 1. Flip surname semantics so `Person.surname` is the "surname now" and
 *    `Person.surnameAtBirth` is the maiden name. Legacy data had
 *    `surname` = maiden (from GEDCOM SURN) and `marriedName` = current
 *    (from _MARNM).
 *
 * 2. Lift the legacy `notes[]` convention ("Interests: ...",
 *    "Activities: ...", "Bio notes: ...") into typed `Person` fields.
 *
 * Safe to run repeatedly: each step checks whether it's already applied.
 */

import type { GedcomData } from '../types';
import { parseBiographyFromNotes } from '../person-graph-stats';

export function migratePass1(data: GedcomData): void {
  for (const person of data.persons.values()) {
    // ── Surname flip ────────────────────────────────────────────────
    if (!person.surnameAtBirth) {
      // First run: seed surnameAtBirth from whatever "surname" currently holds
      // (legacy data had maiden name there).
      person.surnameAtBirth = person.surname;
    }
    if (
      person.sex === 'F' &&
      person.marriedName &&
      person.marriedName !== person.surname
    ) {
      // Only women take married names. Family Echo abuses _MARNM on male
      // records to store "middle + last" — don't flip those into surname.
      person.surname = person.marriedName;
    } else if (person.sex !== 'F' && person.surname !== person.surnameAtBirth) {
      // Heal legacy state from the buggy first-run migration: if a male's
      // surname was mis-flipped previously, restore it from surnameAtBirth.
      if (person.surnameAtBirth) {
        person.surname = person.surnameAtBirth;
      }
    }

    // ── Biography lift ──────────────────────────────────────────────
    if (person.notes && person.notes.length > 0) {
      const parsed = parseBiographyFromNotes(person.notes);
      let mutated = false;
      if (parsed.interests && !person.interests) {
        person.interests = parsed.interests;
        mutated = true;
      }
      if (parsed.activities && !person.activities) {
        person.activities = parsed.activities;
        mutated = true;
      }
      if (parsed.bioNotes && !person.bioNotes) {
        person.bioNotes = parsed.bioNotes;
        mutated = true;
      }
      if (mutated) {
        person.notes = parsed.residual;
      }
    }
  }
}
