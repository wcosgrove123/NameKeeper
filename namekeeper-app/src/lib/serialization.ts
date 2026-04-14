import { Person, Family, GedcomData } from './types';

interface JsonExport {
  format: 'namekeeper-v1';
  exportDate: string;
  persons: Person[];
  families: Family[];
}

export function gedcomDataToJson(data: GedcomData): string {
  const obj: JsonExport = {
    format: 'namekeeper-v1',
    exportDate: new Date().toISOString(),
    persons: Array.from(data.persons.values()),
    families: Array.from(data.families.values()),
  };
  return JSON.stringify(obj, null, 2);
}

export function jsonToGedcomData(json: string): GedcomData {
  const obj: JsonExport = JSON.parse(json);
  if (obj.format !== 'namekeeper-v1') {
    throw new Error('Unsupported file format');
  }
  const persons = new Map<string, Person>();
  const families = new Map<string, Family>();
  for (const p of obj.persons) persons.set(p.id, p);
  for (const f of obj.families) families.set(f.id, f);
  return { persons, families };
}

export function gedcomDataToGedcom(data: GedcomData): string {
  const lines: string[] = [];

  // Header
  lines.push('0 HEAD');
  lines.push('1 SOUR NameKeeper');
  lines.push('2 NAME NameKeeper Family Tree Editor');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');

  // Helper: emit a multi-line string as `1 TAG firstline` + `2 CONT …`
  function emitMultiline(tag: string, value: string) {
    const split = value.split('\n');
    lines.push(`1 ${tag} ${split[0]}`);
    for (let i = 1; i < split.length; i++) {
      lines.push(`2 CONT ${split[i]}`);
    }
  }

  // Individuals
  for (const person of data.persons.values()) {
    lines.push(`0 ${person.id} INDI`);
    // Display NAME uses the surname-at-birth form (matches Family Echo convention)
    const nameSurname = person.surnameAtBirth || person.surname;
    const fullGiven = [person.givenName, person.middleNames].filter(Boolean).join(' ').trim();
    const namePrimary = `${fullGiven} /${nameSurname}/${person.suffix ? ' ' + person.suffix : ''}`.trim();
    lines.push(`1 NAME ${namePrimary}`);
    if (person.title) lines.push(`2 NPFX ${person.title}`);
    if (fullGiven) lines.push(`2 GIVN ${fullGiven}`);
    if (person.nickname) lines.push(`2 NICK ${person.nickname}`);
    if (nameSurname) lines.push(`2 SURN ${nameSurname}`);
    if (person.suffix) lines.push(`2 NSFX ${person.suffix}`);
    // _MARNM holds "surname now" — write current surname when it differs from birth
    const marnm = person.marriedName || (person.surname !== nameSurname ? person.surname : undefined);
    if (marnm) lines.push(`2 _MARNM ${marnm}`);

    lines.push(`1 SEX ${person.sex}`);

    if (person.birthDate || person.birthPlace) {
      lines.push('1 BIRT');
      if (person.birthDate) lines.push(`2 DATE ${person.birthDate}`);
      if (person.birthPlace) lines.push(`2 PLAC ${person.birthPlace}`);
    }

    if (!person.isLiving) {
      if (person.deathDate || person.deathPlace) {
        lines.push('1 DEAT');
        if (person.deathDate) lines.push(`2 DATE ${person.deathDate}`);
        if (person.deathPlace) lines.push(`2 PLAC ${person.deathPlace}`);
      } else {
        lines.push('1 DEAT Y');
      }
    }

    if (person.occupation || person.company) {
      lines.push(`1 OCCU ${person.occupation || ''}`);
      if (person.company) lines.push(`2 PLAC ${person.company}`);
    }

    // Residence block holds contact info in Family Echo
    if (person.address || person.email || person.website || person.homeTel || person.mobile || person.workTel) {
      lines.push('1 RESI');
      if (person.address) {
        const addrLines = person.address.split('\n');
        lines.push(`2 ADDR ${addrLines[0]}`);
        for (let i = 1; i < addrLines.length; i++) {
          lines.push(`3 CONT ${addrLines[i]}`);
        }
      }
      if (person.homeTel) lines.push(`2 PHON ${person.homeTel}`);
      if (person.mobile) lines.push(`2 PHON ${person.mobile}`);
      if (person.workTel) lines.push(`2 PHON ${person.workTel}`);
      if (person.email) lines.push(`2 EMAIL ${person.email}`);
      if (person.website) lines.push(`2 WWW ${person.website}`);
    }

    // Biography fields ride along as NOTE lines so Family Echo round-trips them
    if (person.interests) lines.push(`1 NOTE Interests: ${person.interests}`);
    if (person.activities) lines.push(`1 NOTE Activities: ${person.activities}`);
    if (person.bioNotes) emitMultiline('NOTE', `Bio notes: ${person.bioNotes}`);

    for (const famId of person.familiesAsSpouse) {
      lines.push(`1 FAMS ${famId}`);
    }
    if (person.familyAsChild) {
      lines.push(`1 FAMC ${person.familyAsChild}`);
    }

    for (const note of person.notes) {
      emitMultiline('NOTE', note);
    }
  }

  // Families
  for (const family of data.families.values()) {
    lines.push(`0 ${family.id} FAM`);
    if (family.husbandId) lines.push(`1 HUSB ${family.husbandId}`);
    if (family.wifeId) lines.push(`1 WIFE ${family.wifeId}`);
    for (const childId of family.childIds) {
      lines.push(`1 CHIL ${childId}`);
    }
    if (family.marriageDate || family.marriagePlace) {
      lines.push('1 MARR');
      if (family.marriageDate) lines.push(`2 DATE ${family.marriageDate}`);
      if (family.marriagePlace) lines.push(`2 PLAC ${family.marriagePlace}`);
    }
    if (family.divorced) lines.push('1 DIV Y');
    if (family.isCurrent !== undefined) lines.push(`1 _CURRENT ${family.isCurrent ? 'Y' : 'N'}`);
  }

  lines.push('0 TRLR');
  return lines.join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
