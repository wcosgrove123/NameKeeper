#!/usr/bin/env node
/**
 * Convert a GEDCOM file to NameKeeper JSON format.
 * Usage: node scripts/convert-ged-to-json.mjs <input.ged> <output.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const [,, inputPath, outputPath] = process.argv;
if (!inputPath) {
  console.error('Usage: node convert-ged-to-json.mjs <input.ged> [output.json]');
  process.exit(1);
}

const out = outputPath || 'public/data/family.json';

// --- Minimal GEDCOM parser (mirrors src/lib/gedcom-parser.ts) ---

function parseLine(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)\s*(.*)$/);
  if (!match) return null;
  return { level: parseInt(match[1]), xref: match[2] || undefined, tag: match[3], value: match[4] || '' };
}

function parseGedcom(content) {
  const lines = content.split(/\r?\n/).map(parseLine).filter(Boolean);
  const persons = [];
  const families = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.level === 0 && line.xref) {
      if (line.tag === 'INDI') {
        const person = { id: line.xref, givenName: '', surname: '', sex: 'U', isLiving: true, familiesAsSpouse: [], notes: [] };
        i++;
        while (i < lines.length && lines[i].level > 0) {
          const l = lines[i];
          if (l.level === 1) {
            if (l.tag === 'NAME') {
              const nameMatch = l.value.match(/^(.*?)\s*\/([^/]*)\//);
              if (nameMatch) { person.givenName = nameMatch[1].trim(); person.surname = nameMatch[2].trim(); }
              else { person.givenName = l.value.replace(/\//g, '').trim(); }
              // Check for sub-tags
              let j = i + 1;
              while (j < lines.length && lines[j].level > 1) {
                if (lines[j].tag === 'GIVN') person.givenName = lines[j].value;
                if (lines[j].tag === 'SURN') person.surname = lines[j].value;
                if (lines[j].tag === '_MARNM') person.marriedName = lines[j].value;
                if (lines[j].tag === 'NICK') person.nickname = lines[j].value;
                j++;
              }
            } else if (l.tag === 'SEX') {
              person.sex = l.value === 'M' ? 'M' : l.value === 'F' ? 'F' : 'U';
            } else if (l.tag === 'BIRT') {
              let j = i + 1;
              while (j < lines.length && lines[j].level > 1) {
                if (lines[j].tag === 'DATE') person.birthDate = lines[j].value;
                if (lines[j].tag === 'PLAC') person.birthPlace = lines[j].value;
                j++;
              }
            } else if (l.tag === 'DEAT') {
              person.isLiving = false;
              let j = i + 1;
              while (j < lines.length && lines[j].level > 1) {
                if (lines[j].tag === 'DATE') person.deathDate = lines[j].value;
                if (lines[j].tag === 'PLAC') person.deathPlace = lines[j].value;
                j++;
              }
            } else if (l.tag === 'OCCU') {
              person.occupation = l.value;
            } else if (l.tag === 'FAMS') {
              person.familiesAsSpouse.push(l.value);
            } else if (l.tag === 'FAMC') {
              person.familyAsChild = l.value;
            } else if (l.tag === 'NOTE') {
              if (l.value) person.notes.push(l.value);
            }
          }
          i++;
        }
        persons.push(person);
      } else if (line.tag === 'FAM') {
        const family = { id: line.xref, childIds: [] };
        i++;
        while (i < lines.length && lines[i].level > 0) {
          const l = lines[i];
          if (l.level === 1) {
            if (l.tag === 'HUSB') family.husbandId = l.value;
            else if (l.tag === 'WIFE') family.wifeId = l.value;
            else if (l.tag === 'CHIL') family.childIds.push(l.value);
            else if (l.tag === 'MARR') {
              let j = i + 1;
              while (j < lines.length && lines[j].level > 1) {
                if (lines[j].tag === 'DATE') family.marriageDate = lines[j].value;
                if (lines[j].tag === 'PLAC') family.marriagePlace = lines[j].value;
                j++;
              }
            }
          }
          i++;
        }
        families.push(family);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return { persons, families };
}

// --- Run ---
const content = readFileSync(inputPath, 'utf-8');
const { persons, families } = parseGedcom(content);

const output = {
  format: 'namekeeper-v1',
  exportDate: new Date().toISOString(),
  persons,
  families,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(output, null, 2));
console.log(`Converted: ${persons.length} people, ${families.length} families → ${out}`);
