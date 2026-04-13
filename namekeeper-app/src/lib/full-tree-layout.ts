import { GedcomData } from './types';
import { parseBirthDate } from './gedcom-parser';

export interface FullTreeNode {
  data: {
    id: string;
    label: string;
    fullName: string;
    surname: string;
    birthDate: string;
    deathDate: string;
    sex: string;
    isLiving: boolean;
    nodeType: 'person' | 'family-junction';
  };
}

export interface FullTreeEdge {
  data: {
    id: string;
    source: string;
    target: string;
    edgeType: 'spouse-to-junction' | 'junction-to-child' | 'spouse';
  };
}

export type FullTreeElement = FullTreeNode | FullTreeEdge;

/**
 * Build a full family tree showing all persons and relationships.
 * Uses invisible "family junction" nodes to align couples and their children.
 */
export function buildFullTree(data: GedcomData): FullTreeElement[] {
  const elements: FullTreeElement[] = [];
  const addedNodes = new Set<string>();
  const addedEdges = new Set<string>();

  // Find root persons (those with no familyAsChild, or whose family has no parents in data)
  const rootPersons = findRootPersons(data);

  // BFS from roots to build the tree
  const visited = new Set<string>();
  const queue = [...rootPersons];

  while (queue.length > 0) {
    const personId = queue.shift()!;
    if (visited.has(personId)) continue;
    visited.add(personId);

    const person = data.persons.get(personId);
    if (!person) continue;

    // Add this person node
    if (!addedNodes.has(personId)) {
      addedNodes.add(personId);
      elements.push(createPersonNode(person));
    }

    // Process each family where this person is a spouse
    for (const famId of person.familiesAsSpouse) {
      const family = data.families.get(famId);
      if (!family) continue;

      // Add spouse
      const spouseId = family.husbandId === personId ? family.wifeId : family.husbandId;
      if (spouseId && !addedNodes.has(spouseId)) {
        const spouse = data.persons.get(spouseId);
        if (spouse) {
          addedNodes.add(spouseId);
          elements.push(createPersonNode(spouse));
        }
      }

      // Add family junction node
      const junctionId = `junction-${famId}`;
      if (!addedNodes.has(junctionId)) {
        addedNodes.add(junctionId);
        elements.push({
          data: {
            id: junctionId,
            label: '',
            fullName: '',
            surname: '',
            birthDate: '',
            deathDate: '',
            sex: '',
            isLiving: false,
            nodeType: 'family-junction',
          },
        });

        // Edge from husband to junction
        if (family.husbandId) {
          const edgeId = `stj-${family.husbandId}-${junctionId}`;
          if (!addedEdges.has(edgeId)) {
            addedEdges.add(edgeId);
            elements.push({
              data: {
                id: edgeId,
                source: family.husbandId,
                target: junctionId,
                edgeType: 'spouse-to-junction',
              },
            });
          }
        }

        // Edge from wife to junction
        if (family.wifeId) {
          const edgeId = `stj-${family.wifeId}-${junctionId}`;
          if (!addedEdges.has(edgeId)) {
            addedEdges.add(edgeId);
            elements.push({
              data: {
                id: edgeId,
                source: family.wifeId,
                target: junctionId,
                edgeType: 'spouse-to-junction',
              },
            });
          }
        }

        // Also add a direct spouse edge for visual connection
        if (family.husbandId && family.wifeId) {
          const spouseEdgeId = `spouse-${family.husbandId}-${family.wifeId}`;
          if (!addedEdges.has(spouseEdgeId)) {
            addedEdges.add(spouseEdgeId);
            elements.push({
              data: {
                id: spouseEdgeId,
                source: family.husbandId,
                target: family.wifeId,
                edgeType: 'spouse',
              },
            });
          }
        }
      }

      // Add children and edges from junction to children
      for (const childId of family.childIds) {
        const child = data.persons.get(childId);
        if (!child) continue;

        if (!addedNodes.has(childId)) {
          addedNodes.add(childId);
          elements.push(createPersonNode(child));
        }

        const childEdgeId = `jtc-${junctionId}-${childId}`;
        if (!addedEdges.has(childEdgeId)) {
          addedEdges.add(childEdgeId);
          elements.push({
            data: {
              id: childEdgeId,
              source: junctionId,
              target: childId,
              edgeType: 'junction-to-child',
            },
          });
        }

        // Queue child for further traversal
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }

      // Queue spouse for traversal
      if (spouseId && !visited.has(spouseId)) {
        queue.push(spouseId);
      }
    }

    // Also follow familyAsChild to ensure parents are included
    if (person.familyAsChild) {
      const parentFam = data.families.get(person.familyAsChild);
      if (parentFam) {
        if (parentFam.husbandId && !visited.has(parentFam.husbandId)) queue.push(parentFam.husbandId);
        if (parentFam.wifeId && !visited.has(parentFam.wifeId)) queue.push(parentFam.wifeId);
      }
    }
  }

  // Add any orphan persons not connected to any family
  for (const person of data.persons.values()) {
    if (!addedNodes.has(person.id)) {
      addedNodes.add(person.id);
      elements.push(createPersonNode(person));
    }
  }

  return elements;
}

function createPersonNode(person: import('./types').Person): FullTreeNode {
  const displayName = person.nickname
    ? `${person.nickname} ${person.surname}`
    : `${person.givenName.split(' ')[0]} ${person.surname}`;

  const years = [
    person.birthDate ? parseDateYear(person.birthDate) : '?',
    person.isLiving ? '' : (person.deathDate ? parseDateYear(person.deathDate) : '?'),
  ].filter(Boolean).join('-');

  return {
    data: {
      id: person.id,
      label: `${displayName}\n${years}`,
      fullName: `${person.givenName} ${person.surname}`,
      surname: person.surname,
      birthDate: person.birthDate || '',
      deathDate: person.deathDate || '',
      sex: person.sex,
      isLiving: person.isLiving,
      nodeType: 'person',
    },
  };
}

function parseDateYear(dateStr: string): string {
  const match = dateStr.match(/(\d{4})/);
  return match ? match[1] : '?';
}

/**
 * Find root persons — those with no parents in the data, sorted by birth date.
 */
function findRootPersons(data: GedcomData): string[] {
  const roots: string[] = [];
  for (const person of data.persons.values()) {
    if (!person.familyAsChild) {
      roots.push(person.id);
      continue;
    }
    const parentFam = data.families.get(person.familyAsChild);
    if (!parentFam || (!parentFam.husbandId && !parentFam.wifeId)) {
      roots.push(person.id);
    }
  }

  // Sort roots by birth date
  roots.sort((a, b) => {
    const pa = data.persons.get(a);
    const pb = data.persons.get(b);
    const da = parseBirthDate(pa?.birthDate || '');
    const db = parseBirthDate(pb?.birthDate || '');
    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1;
    if (db) return 1;
    return 0;
  });

  return roots;
}
