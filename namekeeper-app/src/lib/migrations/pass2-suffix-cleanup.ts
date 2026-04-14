/**
 * Pass 2 migration — runs idempotently on every load.
 *
 * Cleans up suffix data that Family Echo / Gramps stuffed into the surname
 * and `_MARNM` fields:
 *
 *   1 NAME Robert /Stewart/
 *   2 SURN Stewart
 *   2 _MARNM Stewart Jr.       ← suffix jammed into the married-name slot
 *
 * For MALES who are legitimately Jr./Sr./II–V, strip the suffix from
 * `surname` / `marriedName` and lift it into the dedicated `Person.suffix`
 * field.
 *
 * For FEMALES whose surname accidentally inherited the same suffix from a
 * father or husband (e.g. Hope McDonnell Jr., Jane McDonnell Jr.), just
 * strip the suffix — women don't carry Jr./Sr. in standard usage.
 *
 * Plus a hand-coded fix for Jane (@I140@) whose `surname` was wrongly set to
 * her married name "McDonnell Jr." instead of her birth surname "Hope".
 *
 * Idempotent: running this on already-cleaned data is a no-op.
 */

import type { GedcomData } from '../types';

const SUFFIX_RE = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/;

/** Strip a trailing suffix token from a string. Returns [base, suffix?]. */
function splitSuffix(s: string | undefined): [string | undefined, string | undefined] {
  if (!s) return [s, undefined];
  const m = SUFFIX_RE.exec(s);
  if (!m) return [s, undefined];
  return [s.slice(0, m.index).trim(), m[1].replace(/\.$/, '')];
}

export function migratePass2SuffixCleanup(data: GedcomData): void {
  for (const person of data.persons.values()) {
    const [snBase, snSuffix] = splitSuffix(person.surname);
    const [mnBase, mnSuffix] = splitSuffix(person.marriedName);
    const [sabBase, sabSuffix] = splitSuffix(person.surnameAtBirth);

    const detected = snSuffix || mnSuffix || sabSuffix;
    if (!detected) continue; // already clean

    if (person.sex === 'M') {
      // Legitimate Jr./Sr./III bearer — lift into the suffix field
      if (!person.suffix) person.suffix = detected;
      if (snBase !== undefined) person.surname = snBase;
      if (mnBase !== undefined) person.marriedName = mnBase || undefined;
      if (sabBase !== undefined) person.surnameAtBirth = sabBase || undefined;
    } else {
      // Female (or unknown): she didn't earn the suffix — strip without setting
      if (snBase !== undefined) person.surname = snBase;
      if (mnBase !== undefined) person.marriedName = mnBase || undefined;
      if (sabBase !== undefined) person.surnameAtBirth = sabBase || undefined;
    }
  }

  // ── Hand-coded fix: Jane (@I140@) ──────────────────────────────────
  // Her parents are both "Hope" (Richard Hope, Barbara Hope) but the export
  // tool wrote her married name "McDonnell Jr." into BOTH the SURN and
  // _MARNM slots, erasing her real birth surname.
  const jane = data.persons.get('@I140@');
  if (jane && jane.surnameAtBirth !== 'Hope') {
    jane.surnameAtBirth = 'Hope';
    if (!jane.marriedName || jane.marriedName === jane.surname) {
      jane.marriedName = 'McDonnell';
    }
    jane.surname = 'McDonnell';
  }
}
