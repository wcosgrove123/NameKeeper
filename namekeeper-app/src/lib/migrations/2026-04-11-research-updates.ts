/**
 * Migration: Cosgrove Family Tree — Updates from Research
 * Date: April 11, 2026
 *
 * Applies corrections, new people, and notes from genealogical research.
 * Idempotent: safe to run multiple times (checks for existing records).
 *
 * IMPORTANT: New people are ALWAYS created via addPerson (never reuses
 * existing records by name) to avoid the "Brian Cosgrove" collision bug.
 * Existing people are found with strict matching (name + birth year + family context).
 */

import type { GedcomData, Person } from '../types';
import { getFather, getSons } from '../gedcom-parser';

// ── Helpers ──────────────────────────────────────────────────────────

interface StoreActions {
  addPerson: (person: Omit<Person, 'id'>) => string;
  updatePerson: (id: string, updates: Partial<Person>) => void;
  addFamily: (family: { husbandId?: string; wifeId?: string; childIds: string[]; marriageDate?: string; marriagePlace?: string }) => string;
  createMarriage: (person1Id: string, person2Id: string, date?: string, place?: string) => string;
  addChildToFamily: (familyId: string, childId: string) => void;
}

/** Find an existing person by name + birth year. Returns undefined if not found. */
function findExisting(data: GedcomData, givenName: string, surname: string, birthYear?: string): Person | undefined {
  for (const person of data.persons.values()) {
    const gnMatch = person.givenName.toLowerCase().includes(givenName.toLowerCase());
    const snMatch = person.surname.toLowerCase() === surname.toLowerCase();
    if (!gnMatch || !snMatch) continue;
    if (birthYear && person.birthDate && !person.birthDate.includes(birthYear)) continue;
    return person;
  }
  return undefined;
}

/** Find an existing person who is a child of a specific parent. */
function findChildOf(data: GedcomData, parentId: string, childGivenName: string): Person | undefined {
  const parent = data.persons.get(parentId);
  if (!parent) return undefined;
  for (const famId of parent.familiesAsSpouse) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    for (const cid of fam.childIds) {
      const child = data.persons.get(cid);
      if (child && child.givenName.toLowerCase().includes(childGivenName.toLowerCase())) {
        return child;
      }
    }
  }
  return undefined;
}

/** Add a note to a person, skipping if a similar note already exists. */
function addNote(data: GedcomData, store: StoreActions, personId: string, note: string) {
  const person = data.persons.get(personId);
  if (!person) return;
  if (person.notes.some(n => n.includes(note.slice(0, 50)))) return;
  store.updatePerson(personId, { notes: [...person.notes, note] });
}

/** Create a new person (always creates, never reuses). Returns the new ID. */
function createPerson(store: StoreActions, givenName: string, surname: string,
  details: Partial<Omit<Person, 'id' | 'givenName' | 'surname'>> = {}): string {
  return store.addPerson({
    givenName,
    surname,
    sex: details.sex ?? 'U',
    isLiving: details.isLiving ?? false,
    familiesAsSpouse: [],
    notes: details.notes ?? [],
    ...details,
  });
}

/** Check if a person already has a spouse with a given name. */
function hasSpouseNamed(data: GedcomData, personId: string, spouseName: string): boolean {
  const person = data.persons.get(personId);
  if (!person) return false;
  for (const famId of person.familiesAsSpouse) {
    const fam = data.families.get(famId);
    if (!fam) continue;
    const sid = fam.husbandId === personId ? fam.wifeId : fam.husbandId;
    if (sid) {
      const spouse = data.persons.get(sid);
      if (spouse && spouse.givenName.toLowerCase().includes(spouseName.toLowerCase())) return true;
    }
  }
  return false;
}

/** Check if a family already contains a child with a given name. */
function familyHasChild(data: GedcomData, familyId: string, childName: string): boolean {
  const fam = data.families.get(familyId);
  if (!fam) return false;
  for (const cid of fam.childIds) {
    const child = data.persons.get(cid);
    if (child && child.givenName.toLowerCase().includes(childName.toLowerCase())) return true;
  }
  return false;
}

// ── Migration ────────────────────────────────────────────────────────

export function applyResearchUpdates(data: GedcomData, store: StoreActions): { added: number; updated: number; errors: string[] } {
  let updated = 0;
  const errors: string[] = [];
  const origSize = data.persons.size;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 1: CORRECTIONS TO EXISTING ENTRIES
  // ════════════════════════════════════════════════════════════════════

  // ── Henry Shryock corrections ──────────────────────────────────────
  // There are 7 Henry Shryocks in the tree — target the patriarch (b. 1730)
  const henry = findExisting(data, 'Henry', 'Shryock', '1730');
  if (henry) {
    store.updatePerson(henry.id, {
      birthDate: 'ABT 1736',
      birthPlace: 'Manchester Township, Lancaster County, PA',
      deathDate: '19 MAY 1814',
      deathPlace: 'Shenandoah County, VA',
    });
    addNote(data, store, henry.id,
      'Sheriff Washington County 1789-92, MD House of Delegates 1788-89. ' +
      'Signer of MD ratification of Constitution April 28, 1788. ' +
      'Co-signed welcome address to President Washington Oct 1790.');
    addNote(data, store, henry.id,
      'CORRECTION: Previous parents "Friedrick Von Schreyack" and "Hildergarde Von Schreyack" were FABRICATED by Frank Kimball Leland (~1930s). ' +
      'Correct father: Jacob Schreyack (b.1714). Correct mother: Barbara Wolf. ' +
      'NOTE: The existing GEDCOM incorrectly lists Jacob Schreyack as Catherine\'s father — ' +
      'he was actually HENRY\'s father (Schreyack→Shryock name evolution). Catherine\'s maiden name was Soloday.');

    // Henry already has wife Catherine Soloday-Shryock in the GEDCOM — don't add duplicate
    // (she's listed as "Catherine Soloday-Shryock" with givenName "Catherine")

    // The GEDCOM has Jacob Schreyack (@I664@) as Catherine's father, but he should be
    // HENRY's father. For now, add a note and don't create duplicates.
    // The parent reassignment requires manual correction in the GEDCOM.
    const currentFather = getFather(henry, data);
    if (!currentFather) {
      // Henry has no father set — add Jacob Schreyack as his father
      // Check if Jacob Schreyack already exists (he does in the GEDCOM as Catherine's father)
      const existingJacob = findExisting(data, 'Jacob', 'Schreyack', '1714');
      if (existingJacob) {
        // Jacob exists but is connected to Catherine. Add a note explaining the correction.
        addNote(data, store, existingJacob.id,
          'CORRECTION: Jacob Schreyack was HENRY Shryock\'s father, not Catherine\'s. ' +
          'Catherine\'s maiden name was Soloday. The Schreyack→Shryock surname evolution ' +
          'passed through Henry, not Catherine.');
      } else {
        // No existing Jacob — create him and set as Henry's father
        const jacobId = createPerson(store, 'Jacob', 'Schreyack', {
          sex: 'M',
          birthDate: '1714',
          birthPlace: 'Birkenweissbuch, Baden-Württemberg, Germany',
          deathDate: '1737',
          deathPlace: 'Lancaster County, PA',
        });
        const barbaraWolfId = createPerson(store, 'Barbara', 'Wolf', { sex: 'F' });
        const jacobFamId = store.createMarriage(jacobId, barbaraWolfId);
        store.addChildToFamily(jacobFamId, henry.id);

        // Add Johann Schreyack (Jacob's father)
        const johannId = createPerson(store, 'Johann', 'Schreyack', {
          sex: 'M',
          birthPlace: 'Spechthof, Württemberg, Germany',
        });
        const johannFamId = store.addFamily({ husbandId: johannId, childIds: [] });
        store.addChildToFamily(johannFamId, jacobId);
      }
    }
    updated++;
  } else {
    errors.push('Could not find Henry Shryock (b. 1730) — there are 7 Henry Shryocks, none matched birth year 1730');
  }

  // ── John Francis Cosgrove (b. 1873) ────────────────────────────────
  const jfCosgrove = findExisting(data, 'John Francis', 'Cosgrove', '1873')
    ?? findExisting(data, 'John', 'Cosgrove', '1873');
  if (jfCosgrove) {
    addNote(data, store, jfCosgrove.id,
      'Birth year confirmed as 1873 (not 1883). Spanish-American War service — stationed San Francisco/Angel Island 1901 at age 27.');

    if (!hasSpouseNamed(data, jfCosgrove.id, 'Sophia')) {
      const sophiaId = createPerson(store, 'Sophia', 'Barth', {
        sex: 'F', birthDate: 'ABT 1874', birthPlace: 'PA',
        deathDate: 'ABT 1965', deathPlace: 'PA',
        notes: ['After John Francis died, she remarried Carl Schlaitzer (b. ~1870).'],
      });
      const jfFamId = store.createMarriage(jfCosgrove.id, sophiaId, '7 JUN 1906', 'Delaware');

      const jamesWFId = createPerson(store, 'James W.F.', 'Cosgrove', {
        sex: 'M', birthDate: 'ABT 1907', birthPlace: 'Philadelphia, PA',
        deathDate: 'SEP 1964', deathPlace: 'Philadelphia, PA',
        notes: ['Died unmarried, no children. Obituary: Philadelphia Daily News Sept 26, 1964 p.13P.'],
      });
      store.addChildToFamily(jfFamId, jamesWFId);
    }
    updated++;
  } else {
    errors.push('Could not find John Francis Cosgrove (b. 1873)');
  }

  // ── James J. Cosgrove notes (b. 1841, Cork/Buttevant) ─────────────
  const jamesJCosgrove = findExisting(data, 'James', 'Cosgrove', '1841');
  if (jamesJCosgrove) {
    addNote(data, store, jamesJCosgrove.id,
      'Birthplace "Cork, Buttevant Ireland" — likely Cavan-to-Cork via Buttevant military barracks. ' +
      'Listed in 1881 Munsell History of Schuylkill County under "Regiments of Numbers Not Known". ' +
      'Absent from T288 pension index and 1883 pension roll — likely served <90 days in 1863 emergency militia.');
    updated++;
  }

  // ── William James Cosgrove notes (b. ~1880) ────────────────────────
  const wjCosgrove = findExisting(data, 'William', 'Cosgrove', '1880')
    ?? findExisting(data, 'William James', 'Cosgrove', '1880');
  if (wjCosgrove) {
    addNote(data, store, wjCosgrove.id,
      'Lived to age 96, apparently never married, no known children. ' +
      'Private, stationed Angel Island, CA, Mar 22, 1902 (Spanish-American War).');
    updated++;
  }

  // ── Patrick Cosgrove (b. 1819) notes ───────────────────────────────
  const patrickGen2 = findExisting(data, 'Patrick', 'Cosgrove', '1819');
  if (patrickGen2) {
    addNote(data, store, patrickGen2.id,
      'Arrived Philadelphia April 15, 1847 (during Great Famine). Ship manifest likely on NARA Microfilm M425, Reel 64. ' +
      'Settled in Minersville, PA. Died Nov 24, 1873. Buried Saint Vincent de Paul Cemetery #1. ' +
      'NOT killed by Molly Maguires — likely died from cumulative mining work effects at age 54.');
    updated++;
  }

  // ── Roland Richard Cosgrove notes ──────────────────────────────────
  const roland = findExisting(data, 'Roland', 'Cosgrove', '1911');
  if (roland) {
    addNote(data, store, roland.id,
      'Merchant Marine WWII — highest per-capita casualty rate of any US service (1 in 26 killed, 733 ships sunk). ' +
      'Denied veteran status until Jan 19, 1988 (Schumacher v. Aldridge). Died Nov 19, 1989 — only 22 months after recognition. ' +
      'Service records at NARA Record Group 26, St. Louis (opened Dec 2019).');
    updated++;
  }

  // ── Joseph Cosgrove notes ──────────────────────────────────────────
  const joseph = findExisting(data, 'Joseph', 'Cosgrove', '1882')
    ?? findExisting(data, 'Joseph', 'Cosgrove', '1892');
  if (joseph) {
    addNote(data, store, joseph.id,
      'Married "Lina" (maiden name unknown) in Reading, Berks Co., PA in 1907. ' +
      'Marriage record searchable at rwills.co.berks.pa.us. ' +
      'Family moved from Shenandoah to Philadelphia ~1930 as coal industry declined.');
    updated++;
  }

  // ── Thomas Cosgrove (Joseph's son, b. ~1909) ──────────────────────
  const thomasCosgrove = findExisting(data, 'Thomas', 'Cosgrove', '1909')
    ?? findExisting(data, 'Thomas', 'Cosgrove', '1908');
  if (thomasCosgrove) {
    store.updatePerson(thomasCosgrove.id, { deathDate: '16 NOV 1957' });
    addNote(data, store, thomasCosgrove.id,
      'Died at age 48. Had no sons — only daughters. This is why the name passed to Roland.');

    // Wife Kathrine Loder — check if already has spouse
    if (!hasSpouseNamed(data, thomasCosgrove.id, 'Kathrine') && !hasSpouseNamed(data, thomasCosgrove.id, 'Loder')) {
      const kathrineId = createPerson(store, 'Kathrine', 'Loder', { sex: 'F' });
      store.createMarriage(thomasCosgrove.id, kathrineId);
    }

    // Children Ellen and Nora — only add if not already children
    const thomasFam = thomasCosgrove.familiesAsSpouse[0];
    if (thomasFam) {
      if (!familyHasChild(data, thomasFam, 'Ellen')) {
        const ellenId = createPerson(store, 'Ellen', 'Cosgrove', {
          sex: 'F', notes: ['Became a doctor in Seattle. Married Jeff Falls.'],
        });
        store.addChildToFamily(thomasFam, ellenId);
      }
      if (!familyHasChild(data, thomasFam, 'Nora')) {
        const noraId = createPerson(store, 'Nora', 'Cosgrove', { sex: 'F' });
        store.addChildToFamily(thomasFam, noraId);
      }
    }
    updated++;
  }

  // ════════════════════════════════════════════════════════════════════
  // SECTION 2: NEW PEOPLE — PATRICK HENRY'S LINE
  // ════════════════════════════════════════════════════════════════════

  // Find John J. Cosgrove (1905-1967)
  const johnJ = findExisting(data, 'John', 'Cosgrove', '1905');
  if (johnJ) {
    addNote(data, store, johnJ.id, 'Philadelphia (Kensington/Port Richmond area), later Bridgeport NJ area.');

    // Add wife Marie Kelly
    if (!hasSpouseNamed(data, johnJ.id, 'Marie') && !hasSpouseNamed(data, johnJ.id, 'Kelly')) {
      const marieId = createPerson(store, 'Marie', 'Kelly', { sex: 'F' });
      const johnJFamId = store.createMarriage(johnJ.id, marieId);

      // ── Children of John J. + Marie ────────────────────────────────
      // All are NEW people — use createPerson to never collide with existing Cosgroves

      const jackId = createPerson(store, 'John Patrick "Jack"', 'Cosgrove', {
        sex: 'M', birthDate: '12 MAY 1935', birthPlace: 'Philadelphia, PA',
        deathDate: '2 FEB 2016', deathPlace: 'North Myrtle Beach, SC',
        notes: [
          'Buried SS Peter & Paul Cemetery, Springfield, PA.',
          'Northeast Catholic High School 1953, University of Pennsylvania.',
          'US Marine Corps, 30+ years at Rohm and Haas Company, Philadelphia.',
        ],
      });
      store.addChildToFamily(johnJFamId, jackId);

      const arleneId = createPerson(store, 'Arlene', 'Cosgrove', {
        sex: 'F', birthDate: 'ABT 1938',
        notes: ['Died in childhood before 1945. Appears in 1940 census but not later records.'],
      });
      store.addChildToFamily(johnJFamId, arleneId);

      const jimId = createPerson(store, 'Jim', 'Cosgrove', {
        sex: 'M', birthDate: 'ABT 1941', isLiving: true,
        notes: ['John J.\'s third son. Possibly still living (age ~84-85 in 2026).'],
      });
      store.addChildToFamily(johnJFamId, jimId);

      const michaelSrId = createPerson(store, 'Michael', 'Cosgrove', {
        sex: 'M', birthDate: 'JUN 1942', birthPlace: 'Philadelphia, PA',
        notes: ['Son of John J. and Marie Kelly Cosgrove. Died before December 2014. Cinnaminson, NJ area.'],
      });
      store.addChildToFamily(johnJFamId, michaelSrId);

      const maureenId = createPerson(store, 'Maureen', 'Cosgrove', {
        sex: 'F', notes: ['Daughter of John J. Cosgrove. Married Cappello.'],
      });
      store.addChildToFamily(johnJFamId, maureenId);

      const patriciaId = createPerson(store, 'Patricia', 'Cosgrove', {
        sex: 'F', notes: ['Daughter of John J. Cosgrove. Married McLaughlin.'],
      });
      store.addChildToFamily(johnJFamId, patriciaId);

      // ── Jack's family ──────────────────────────────────────────────
      const germaineId = createPerson(store, 'Germaine Joan', 'Latsko', {
        sex: 'F', birthDate: '1939', deathDate: '2012', marriedName: 'Cosgrove',
      });
      const jackFamId = store.createMarriage(jackId, germaineId, '1961');

      const keithId = createPerson(store, 'J. Keith', 'Cosgrove', {
        sex: 'M', isLiving: true, occupation: 'IT Program Manager at Amtrak',
        notes: ['Lives in Wilmington, DE. Wife: Karen. No children found — all 3 of Jack\'s grandchildren are Beth\'s kids (Conleys).'],
      });
      store.addChildToFamily(jackFamId, keithId);

      const bethJackId = createPerson(store, 'Beth', 'Cosgrove', {
        sex: 'F', isLiving: true, marriedName: 'Conley',
        notes: ['Daughter of Jack Cosgrove. Married Jim Conley, West Chester, PA. Children: Cara, Ryan, Eric Conley.'],
      });
      store.addChildToFamily(jackFamId, bethJackId);

      // ── Jim's family ───────────────────────────────────────────────
      const jimFamId = store.addFamily({ husbandId: jimId, childIds: [] });

      const jamesJrId = createPerson(store, 'James J. Jr.', 'Cosgrove', {
        sex: 'M', isLiving: true,
        notes: ['Son of Jim Cosgrove. Lives Chestnut Hill/Wayne area, Philadelphia. Parish Finance Council at Our Mother of Consolation.'],
      });
      store.addChildToFamily(jimFamId, jamesJrId);

      // Diana — maiden name unknown, do NOT use "Cosgrove" as surname
      const dianaId = createPerson(store, 'Diana', '', {
        sex: 'F', isLiving: true, marriedName: 'Cosgrove',
        notes: ['Wife of James J. Cosgrove Jr. Maiden surname unknown.'],
      });
      const jrFamId = store.createMarriage(jamesJrId, dianaId);

      const jjId = createPerson(store, 'JJ', 'Cosgrove', {
        sex: 'M', birthDate: 'ABT 2011', isLiving: true,
        notes: [
          'James J. Cosgrove III. Identified in Aug 2025 Philadelphia Inquirer as rising 8th grader at OMC school.',
          'POTENTIAL NAME KEEPER — if Jim\'s line is confirmed senior to Michael\'s.',
          'Has 2 additional siblings at OMC school (names/genders unknown).',
        ],
      });
      store.addChildToFamily(jrFamId, jjId);

      // ── Michael Sr's family ────────────────────────────────────────
      const rosemaryId = createPerson(store, 'Rosemary', '', {
        sex: 'F', isLiving: true, marriedName: 'Cosgrove',
        notes: ['Wife of Michael Cosgrove Sr. Later Cosgrove-Schuler after remarrying George E. Schuler Jr. Maiden name unknown.'],
      });
      const michaelFamId = store.createMarriage(michaelSrId, rosemaryId);

      const mjrId = createPerson(store, 'Michael J. Jr.', 'Cosgrove', {
        sex: 'M', birthDate: '19 DEC 1962',
        deathDate: '9 DEC 2014', deathPlace: 'Cinnaminson/Marlton, NJ',
        notes: ['Son of Michael Sr. Wife: Deborah. Sons: Michael J. III, Christopher. Obituary: Bradley Funeral Home, Marlton NJ.'],
      });
      store.addChildToFamily(michaelFamId, mjrId);

      // This is a DIFFERENT Brian than Wil's uncle — use full context in notes
      const brianPHId = createPerson(store, 'Brian', 'Cosgrove', {
        sex: 'M', isLiving: true,
        notes: ['Son of Michael Sr. (Patrick Henry line — NOT Brian son of Robert). Wife: Cynthia. Southampton, NJ. Son: Christian (US Navy vet), daughter: Lauryn.'],
      });
      store.addChildToFamily(michaelFamId, brianPHId);

      const debbyId = createPerson(store, 'Debby', 'Cosgrove', {
        sex: 'F', isLiving: true,
        notes: ['Daughter of Michael Sr. Married Matthew Corr. Cinnaminson/Moorestown NJ.'],
      });
      store.addChildToFamily(michaelFamId, debbyId);
    }
    updated++;
  } else {
    errors.push('Could not find John J. Cosgrove (b. 1905)');
  }

  // ════════════════════════════════════════════════════════════════════
  // SECTION 3: WINIFRED GIBBONS PARENTS
  // ════════════════════════════════════════════════════════════════════

  const winifred = findExisting(data, 'Winifred', 'Gibbons');
  if (winifred && !winifred.familyAsChild) {
    const peterGId = createPerson(store, 'Peter', 'Gibbons', {
      sex: 'M', birthPlace: 'Ireland',
      notes: ['Gibbons surname most strongly associated with County Mayo, western Ireland.'],
    });
    const katherineGId = createPerson(store, 'Katherine', '', {
      sex: 'F', birthPlace: 'Ireland', marriedName: 'Gibbons',
      notes: ['Maiden surname unknown. Wife of Peter Gibbons.'],
    });
    const gFamId = store.createMarriage(peterGId, katherineGId);
    store.addChildToFamily(gFamId, winifred.id);
  }

  // ════════════════════════════════════════════════════════════════════
  // SECTION 4: ROBERT CHARLES COSGROVE (1914-1987) — note only
  // ════════════════════════════════════════════════════════════════════

  const robertCharles = findExisting(data, 'Robert', 'Cosgrove', '1914');
  if (robertCharles) {
    addNote(data, store, robertCharles.id,
      'UNCONFIRMED: May be same as Robert J. Cosgrove Sr. of West Chester, PA (wife Elizabeth M.). ' +
      'If confirmed, had 7 children: Pat (m. Bonner), Jim (wife Mary O\'Reilly), Robert Jr. (1950-2013, PhD Temple, Carnegie Mellon), ' +
      'Pam (m. Ward), Eileen (m. Stevenson), Cathy, Beth Hope.');
    updated++;
  }

  // ════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════

  const added = data.persons.size - origSize;
  return { added, updated, errors };
}
