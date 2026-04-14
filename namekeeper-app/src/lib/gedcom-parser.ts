import { Person, Family, GedcomData } from './types';

interface GedcomLine {
  level: number;
  tag: string;
  value: string;
  xref?: string;
}

function parseLine(raw: string): GedcomLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Match: level [xref] tag [value]
  const match = trimmed.match(/^(\d+)\s+(?:(@\w+@)\s+)?(\S+)\s*(.*)$/);
  if (!match) return null;

  return {
    level: parseInt(match[1], 10),
    xref: match[2] || undefined,
    tag: match[3],
    value: match[4] || '',
  };
}

function parseBirthDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Remove qualifiers like ABT, BEF, AFT, EST, CAL
  const cleaned = dateStr.replace(/^(ABT|BEF|AFT|EST|CAL|FROM|TO)\s+/i, '').trim();

  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };

  // Full date: 15 JUN 1967
  const fullMatch = cleaned.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/);
  if (fullMatch) {
    return new Date(parseInt(fullMatch[3]), months[fullMatch[2]] ?? 0, parseInt(fullMatch[1]));
  }

  // Month + year: JUN 1967 or SEP 1870
  const monthYear = cleaned.match(/^([A-Z]{3})\s+(\d{4})$/);
  if (monthYear) {
    return new Date(parseInt(monthYear[2]), months[monthYear[1]] ?? 0, 1);
  }

  // Year only: 1780
  const yearOnly = cleaned.match(/^(\d{4})$/);
  if (yearOnly) {
    return new Date(parseInt(yearOnly[1]), 0, 1);
  }

  return null;
}

export { parseBirthDate };

export function parseGedcom(text: string): GedcomData {
  const lines = text.split(/\r?\n/);
  const persons = new Map<string, Person>();
  const families = new Map<string, Family>();

  let currentPerson: Person | null = null;
  let currentFamily: Family | null = null;
  let currentContext: 'INDI' | 'FAM' | null = null;
  let subContext: string | null = null; // BIRT, DEAT, MARR, NAME, RESI, OCCU, etc.
  let noteBuffer: string[] = [];
  let nameLevel1 = false;

  let phonBuffer: string[] = [];

  function flushPerson() {
    if (currentPerson) {
      if (noteBuffer.length > 0) {
        currentPerson.notes.push(noteBuffer.join('\n'));
        noteBuffer = [];
      }
      // Assign buffered phone numbers to home/work/mobile slots in order
      if (phonBuffer.length > 0) {
        if (!currentPerson.homeTel) currentPerson.homeTel = phonBuffer[0];
        if (phonBuffer[1] && !currentPerson.mobile) currentPerson.mobile = phonBuffer[1];
        if (phonBuffer[2] && !currentPerson.workTel) currentPerson.workTel = phonBuffer[2];
        phonBuffer = [];
      }
      // Family Echo stores "surname at birth" in SURN and "surname now" in _MARNM.
      // Flip so Person.surname is the current/display name.
      if (!currentPerson.surnameAtBirth) {
        currentPerson.surnameAtBirth = currentPerson.surname;
      }
      // Only women take married names. Family Echo (and Gramps) sometimes
      // abuses _MARNM to store "middle + last" on male records — don't let
      // that leak into `surname`.
      if (
        currentPerson.sex === 'F' &&
        currentPerson.marriedName &&
        currentPerson.marriedName !== currentPerson.surname
      ) {
        currentPerson.surname = currentPerson.marriedName;
      }
      persons.set(currentPerson.id, currentPerson);
      currentPerson = null;
    }
  }

  function flushFamily() {
    if (currentFamily) {
      families.set(currentFamily.id, currentFamily);
      currentFamily = null;
    }
  }

  for (const rawLine of lines) {
    const line = parseLine(rawLine);
    if (!line) continue;

    // Level 0: new record
    if (line.level === 0) {
      flushPerson();
      flushFamily();
      currentContext = null;
      subContext = null;
      nameLevel1 = false;

      if (line.tag === 'INDI' && line.xref) {
        currentPerson = {
          id: line.xref,
          givenName: '',
          surname: '',
          sex: 'U',
          isLiving: true,
          familiesAsSpouse: [],
          notes: [],
        };
        currentContext = 'INDI';
      } else if (line.tag === 'FAM' && line.xref) {
        currentFamily = {
          id: line.xref,
          childIds: [],
        };
        currentContext = 'FAM';
      }
      continue;
    }

    // INDI record fields
    if (currentContext === 'INDI' && currentPerson) {
      if (line.level === 1) {
        // Flush any pending note
        if (subContext === 'NOTE' && noteBuffer.length > 0) {
          currentPerson.notes.push(noteBuffer.join('\n'));
          noteBuffer = [];
        }
        subContext = line.tag;
        nameLevel1 = line.tag === 'NAME';

        switch (line.tag) {
          case 'SEX':
            currentPerson.sex = line.value === 'M' ? 'M' : line.value === 'F' ? 'F' : 'U';
            break;
          case 'NAME': {
            // Parse name like "Ronald Stewart /Cosgrove/"
            const nameMatch = line.value.match(/^(.*?)(?:\/(.*?)\/)?$/);
            if (nameMatch) {
              currentPerson.givenName = currentPerson.givenName || (nameMatch[1]?.trim() || '');
              currentPerson.surname = currentPerson.surname || (nameMatch[2]?.trim() || '');
            }
            break;
          }
          case 'BIRT':
          case 'DEAT':
          case 'MARR':
          case 'RESI':
            // sub-context set, wait for level 2 fields
            break;
          case 'OCCU':
            currentPerson.occupation = line.value;
            break;
          case 'TITL':
            currentPerson.title = line.value;
            break;
          case 'FAMS':
            currentPerson.familiesAsSpouse.push(line.value);
            break;
          case 'FAMC':
            currentPerson.familyAsChild = line.value;
            break;
          case 'NOTE':
            noteBuffer = [line.value];
            break;
        }
      } else if (line.level === 2) {
        if (nameLevel1 && subContext === 'NAME') {
          switch (line.tag) {
            case 'GIVN':
              currentPerson.givenName = line.value;
              break;
            case 'SURN':
              // SURN in Family Echo = surname at birth (maiden).
              // Store here; flushPerson() will resolve display surname from _MARNM.
              currentPerson.surnameAtBirth = line.value;
              if (!currentPerson.surname) currentPerson.surname = line.value;
              break;
            case 'NICK':
              currentPerson.nickname = line.value;
              break;
            case 'NPFX':
              currentPerson.title = line.value;
              break;
            case 'NSFX':
              currentPerson.suffix = line.value;
              break;
            case '_MARNM':
              currentPerson.marriedName = line.value;
              break;
          }
        }

        if (subContext === 'BIRT') {
          if (line.tag === 'DATE') currentPerson.birthDate = line.value;
          if (line.tag === 'PLAC') currentPerson.birthPlace = line.value;
        }

        if (subContext === 'DEAT') {
          currentPerson.isLiving = false;
          if (line.tag === 'DATE') currentPerson.deathDate = line.value;
          if (line.tag === 'PLAC') currentPerson.deathPlace = line.value;
        }

        // Residence block holds contact info in Family Echo exports
        if (subContext === 'RESI') {
          if (line.tag === 'ADDR') currentPerson.address = line.value;
          else if (line.tag === 'PHON') phonBuffer.push(line.value);
          else if (line.tag === 'EMAIL') currentPerson.email = line.value;
          else if (line.tag === 'WWW') currentPerson.website = line.value;
          else if (line.tag === 'CONT' && currentPerson.address) {
            currentPerson.address += '\n' + line.value;
          }
        }

        // Occupation.PLAC = company in Family Echo convention
        if (subContext === 'OCCU' && line.tag === 'PLAC') {
          currentPerson.company = line.value;
        }

        if (subContext === 'NOTE' && (line.tag === 'CONT' || line.tag === 'CONC')) {
          noteBuffer.push(line.value);
        }
      }

      // Handle DEAT with just "Y" and no sub-records
      if (line.level === 1 && line.tag === 'DEAT') {
        currentPerson.isLiving = false;
      }
    }

    // FAM record fields
    if (currentContext === 'FAM' && currentFamily) {
      if (line.level === 1) {
        subContext = line.tag;
        switch (line.tag) {
          case 'HUSB':
            currentFamily.husbandId = line.value;
            break;
          case 'WIFE':
            currentFamily.wifeId = line.value;
            break;
          case 'CHIL':
            currentFamily.childIds.push(line.value);
            break;
          case '_CURRENT':
            currentFamily.isCurrent = line.value === 'Y';
            break;
          case 'DIV':
          case '_SEPR':
            currentFamily.divorced = true;
            break;
        }
      } else if (line.level === 2 && subContext === 'MARR') {
        if (line.tag === 'DATE') currentFamily.marriageDate = line.value;
        if (line.tag === 'PLAC') currentFamily.marriagePlace = line.value;
      }
    }
  }

  // Flush last record
  flushPerson();
  flushFamily();

  return { persons, families };
}

/** Get all unique surnames sorted by frequency (descending) */
export function getSurnames(data: GedcomData): { surname: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const person of data.persons.values()) {
    if (person.surname) {
      counts.set(person.surname, (counts.get(person.surname) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([surname, count]) => ({ surname, count }))
    .sort((a, b) => b.count - a.count);
}

/** Get sons of a person from a specific family, ordered by birth date (falling back to CHIL order) */
export function getSons(personId: string, data: GedcomData): Person[] {
  const person = data.persons.get(personId);
  if (!person) return [];

  const sons: Person[] = [];

  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family || family.husbandId !== personId) continue;

    for (const childId of family.childIds) {
      const child = data.persons.get(childId);
      if (child && child.sex === 'M') {
        sons.push(child);
      }
    }
  }

  // Sort by birth date if available, otherwise preserve GEDCOM order
  sons.sort((a, b) => {
    const dateA = parseBirthDate(a.birthDate || '');
    const dateB = parseBirthDate(b.birthDate || '');
    if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    if (dateA) return -1;
    if (dateB) return 1;
    return 0; // preserve original order
  });

  return sons;
}

/** Get all children of a person (as father), ordered by birth date */
export function getChildren(personId: string, data: GedcomData): Person[] {
  const person = data.persons.get(personId);
  if (!person) return [];

  const children: Person[] = [];

  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family || family.husbandId !== personId) continue;

    for (const childId of family.childIds) {
      const child = data.persons.get(childId);
      if (child) children.push(child);
    }
  }

  children.sort((a, b) => {
    const dateA = parseBirthDate(a.birthDate || '');
    const dateB = parseBirthDate(b.birthDate || '');
    if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });

  return children;
}

/** Get the father of a person */
export function getFather(person: Person, data: GedcomData): Person | null {
  if (!person.familyAsChild) return null;
  const family = data.families.get(person.familyAsChild);
  if (!family?.husbandId) return null;
  return data.persons.get(family.husbandId) || null;
}

/** Get all children of a specific family, ordered by birth date */
export function getChildrenOfFamily(familyId: string, data: GedcomData): Person[] {
  const family = data.families.get(familyId);
  if (!family) return [];

  const children: Person[] = [];
  for (const childId of family.childIds) {
    const child = data.persons.get(childId);
    if (child) children.push(child);
  }

  children.sort((a, b) => {
    const dateA = parseBirthDate(a.birthDate || '');
    const dateB = parseBirthDate(b.birthDate || '');
    if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });

  return children;
}
