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

  // Individuals
  for (const person of data.persons.values()) {
    lines.push(`0 ${person.id} INDI`);
    lines.push(`1 NAME ${person.givenName} /${person.surname}/`);
    if (person.givenName) lines.push(`2 GIVN ${person.givenName}`);
    if (person.surname) lines.push(`2 SURN ${person.surname}`);
    if (person.nickname) lines.push(`2 NICK ${person.nickname}`);
    if (person.marriedName) lines.push(`2 _MARNM ${person.marriedName}`);
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

    if (person.occupation) lines.push(`1 OCCU ${person.occupation}`);

    for (const famId of person.familiesAsSpouse) {
      lines.push(`1 FAMS ${famId}`);
    }
    if (person.familyAsChild) {
      lines.push(`1 FAMC ${person.familyAsChild}`);
    }

    for (const note of person.notes) {
      const noteLines = note.split('\n');
      lines.push(`1 NOTE ${noteLines[0]}`);
      for (let i = 1; i < noteLines.length; i++) {
        lines.push(`2 CONT ${noteLines[i]}`);
      }
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
