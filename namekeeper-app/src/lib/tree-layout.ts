import { GedcomData, NameKeeperResult, NameKeeperStats, WhatIfResult } from './types';
import { getSuccessionIds, getExtinctBranchIds } from './namekeeper';

export interface CytoNode {
  data: {
    id: string;
    label: string;
    fullName: string;
    surname: string;
    birthDate: string;
    deathDate: string;
    sex: string;
    isLiving: boolean;
    isNameKeeper: boolean;
    isOnSuccessionPath: boolean;
    isExtinctBranch: boolean;
    isPatriarch: boolean;
    nameKeeperGeneration: number;
    removalFromPrime: number;
    isWhatIfPath: boolean;
    isWhatIfNameKeeper: boolean;
    nodeType: 'person' | 'family-junction';
  };
}

export interface CytoEdge {
  data: {
    id: string;
    source: string;
    target: string;
    edgeType: 'parent-child' | 'spouse' | 'spouse-to-junction' | 'junction-to-child';
    isSuccessionEdge: boolean;
    isWhatIfEdge: boolean;
    removalFromPrime: number;
  };
}

export type CytoElement = CytoNode | CytoEdge;

/**
 * Build a patrilineal subtree for a specific surname from a patriarch downward.
 * Includes the patriarch's descendants who carry the surname, plus their spouses.
 */
export interface PatrilinealTreeResult {
  elements: CytoElement[];
  spousePairs: Array<{ husbandId: string; wifeId: string }>;
  junctionIds: Map<string, string>; // familyId -> junctionNodeId
}

export function buildPatrilinealTree(
  patriarchId: string,
  data: GedcomData,
  nameKeeperResult?: NameKeeperResult,
  statsMap?: Map<string, NameKeeperStats>,
  whatIfResult?: WhatIfResult | null
): PatrilinealTreeResult {
  const elements: CytoElement[] = [];
  const addedNodes = new Set<string>();
  const addedEdges = new Set<string>();
  const spousePairs: Array<{ husbandId: string; wifeId: string }> = [];
  const junctionIds = new Map<string, string>(); // familyId -> junctionNodeId

  const successionIds = nameKeeperResult ? getSuccessionIds(nameKeeperResult) : new Set<string>();
  const extinctIds = nameKeeperResult ? getExtinctBranchIds(nameKeeperResult) : new Set<string>();
  const nameKeeperId = nameKeeperResult?.currentNameKeeper?.id;
  const patriarchSurname = data.persons.get(patriarchId)?.surname || '';

  // What-if path IDs for highlighting
  const whatIfPathIds = new Set<string>();
  if (whatIfResult) {
    for (const p of whatIfResult.alternateSuccessionChain) {
      whatIfPathIds.add(p.id);
    }
  }
  const whatIfNameKeeperId = whatIfResult?.newNameKeeper?.id;

  function addPerson(personId: string, isTarget: boolean = false) {
    if (addedNodes.has(personId)) return;
    const person = data.persons.get(personId);
    if (!person) return;
    addedNodes.add(personId);

    const displayName = person.nickname
      ? `${person.nickname} ${person.surname}`
      : `${person.givenName.split(' ')[0]} ${person.surname}`;

    const years = [
      person.birthDate ? parseDateYear(person.birthDate) : '?',
      person.isLiving ? '' : (person.deathDate ? parseDateYear(person.deathDate) : '?'),
    ].filter(Boolean).join('-');

    elements.push({
      data: {
        id: personId,
        label: `${displayName}\n${years}`,
        fullName: `${person.givenName} ${person.surname}`,
        surname: person.surname,
        birthDate: person.birthDate || '',
        deathDate: person.deathDate || '',
        sex: person.sex,
        isLiving: person.isLiving,
        isNameKeeper: personId === nameKeeperId,
        isOnSuccessionPath: successionIds.has(personId),
        isExtinctBranch: extinctIds.has(personId) || (statsMap?.get(personId)?.removalFromPrime === -1),
        isPatriarch: personId === patriarchId,
        nameKeeperGeneration: statsMap?.get(personId)?.nameKeeperGeneration ?? 0,
        removalFromPrime: statsMap?.get(personId)?.removalFromPrime ?? 0,
        isWhatIfPath: whatIfPathIds.has(personId),
        isWhatIfNameKeeper: personId === whatIfNameKeeperId,
        nodeType: 'person',
      },
    });
  }

  function traverse(personId: string, depth: number) {
    if (depth > 30) return; // safety limit
    const person = data.persons.get(personId);
    if (!person) return;

    addPerson(personId);

    // Add spouse(s) and children via junction nodes
    for (const famId of person.familiesAsSpouse) {
      const family = data.families.get(famId);
      if (!family) continue;
      // Only process families where this person is the husband (patrilineal)
      if (family.husbandId !== personId) continue;

      // Create junction node between the couple (marriage point + fork for children)
      const junctionId = `junction-${famId}`;
      const junctionOnSuccession = successionIds.has(personId);
      const junctionOnWhatIf = whatIfPathIds.has(personId);
      const hasChildren = family.childIds.length > 0;

      if (!addedNodes.has(junctionId) && (hasChildren || family.wifeId)) {
        addedNodes.add(junctionId);
        junctionIds.set(famId, junctionId);
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
            isNameKeeper: false,
            isOnSuccessionPath: junctionOnSuccession,
            isExtinctBranch: false,
            isPatriarch: false,
            nameKeeperGeneration: 0,
            removalFromPrime: statsMap?.get(personId)?.removalFromPrime ?? -1,
            isWhatIfPath: junctionOnWhatIf,
            isWhatIfNameKeeper: false,
            nodeType: 'family-junction',
          },
        });

        // Edge: husband → junction
        const husbEdgeId = `stj-${personId}-${junctionId}`;
        addedEdges.add(husbEdgeId);
        const hasSuccessionChild = family.childIds.some(cid => successionIds.has(cid));
        elements.push({
          data: {
            id: husbEdgeId,
            source: personId,
            target: junctionId,
            edgeType: 'spouse-to-junction',
            isSuccessionEdge: junctionOnSuccession && hasSuccessionChild,
            isWhatIfEdge: false,
            removalFromPrime: statsMap?.get(personId)?.removalFromPrime ?? -1,
          },
        });
      }

      // Add wife with edge: wife → junction
      if (family.wifeId) {
        addPerson(family.wifeId);
        const wifeEdgeId = `stj-${family.wifeId}-${junctionId}`;
        if (!addedEdges.has(wifeEdgeId)) {
          addedEdges.add(wifeEdgeId);
          elements.push({
            data: {
              id: wifeEdgeId,
              source: family.wifeId,
              target: junctionId,
              edgeType: 'spouse-to-junction',
              isSuccessionEdge: false,
              isWhatIfEdge: false,
              removalFromPrime: statsMap?.get(personId)?.removalFromPrime ?? -1, // inherit husband's value
            },
          });
        }
        // Track spouse pairs for same-rank alignment post-layout
        spousePairs.push({ husbandId: personId, wifeId: family.wifeId });
      }

      // Add children with edges from junction → child
      for (const childId of family.childIds) {
        const child = data.persons.get(childId);
        if (!child) continue;

        addPerson(childId);

        const childEdgeId = `jtc-${junctionId}-${childId}`;
        if (!addedEdges.has(childEdgeId)) {
          addedEdges.add(childEdgeId);
          const isSuccessionEdge = successionIds.has(personId) && successionIds.has(childId);
          const isWhatIfEdge = whatIfPathIds.has(personId) && whatIfPathIds.has(childId);
          // Sons get their own removal; daughters get thin solid lines UNLESS
          // the father's branch is extinct — then they inherit the dashed style
          const childStats = statsMap?.get(childId)?.removalFromPrime;
          const fatherRemoval = statsMap?.get(personId)?.removalFromPrime ?? 0;
          const childRemoval = childStats !== undefined ? childStats : (fatherRemoval === -1 ? -1 : 99);
          elements.push({
            data: {
              id: childEdgeId,
              source: junctionId,
              target: childId,
              edgeType: 'junction-to-child',
              isSuccessionEdge,
              isWhatIfEdge,
              removalFromPrime: childRemoval,
            },
          });
        }

        // Recurse into sons who carry the surname
        if (child.sex === 'M' && child.surname === patriarchSurname) {
          traverse(childId, depth + 1);
        }
      }
    }
  }

  traverse(patriarchId, 0);
  return { elements, spousePairs, junctionIds };
}

function parseDateYear(dateStr: string): string {
  const match = dateStr.match(/(\d{4})/);
  return match ? match[1] : '?';
}

/**
 * Cytoscape stylesheet for the Name Keeper visualization.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getNameKeeperStylesheet(): any[] {
  return [
    // Base person node
    {
      selector: 'node[nodeType="person"]',
      style: {
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'font-size': '10px',
        'font-family': 'system-ui, sans-serif',
        'text-margin-y': 6,
        'width': 40,
        'height': 40,
        'border-width': 2,
        'border-color': '#94a3b8',
        'background-color': '#e2e8f0',
        'shape': 'ellipse',
        'color': '#334155',
      },
    },
    // Male nodes
    {
      selector: 'node[sex="M"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': '#dbeafe',
        'border-color': '#60a5fa',
      },
    },
    // Generation-based blue shading for males (deeper = higher generation)
    {
      selector: 'node[sex="M"][nameKeeperGeneration >= 2]',
      style: {
        'background-color': '#bfdbfe',
        'border-color': '#3b82f6',
      },
    },
    {
      selector: 'node[sex="M"][nameKeeperGeneration >= 3]',
      style: {
        'background-color': '#93c5fd',
        'border-color': '#2563eb',
      },
    },
    {
      selector: 'node[sex="M"][nameKeeperGeneration >= 4]',
      style: {
        'background-color': '#60a5fa',
        'border-color': '#1d4ed8',
      },
    },
    {
      selector: 'node[sex="M"][nameKeeperGeneration >= 5]',
      style: {
        'background-color': '#3b82f6',
        'border-color': '#1e40af',
        'color': '#1e3a5f',
      },
    },
    // Female nodes
    {
      selector: 'node[sex="F"]',
      style: {
        'shape': 'ellipse',
        'background-color': '#fce7f3',
        'border-color': '#f472b6',
      },
    },
    // Living persons
    {
      selector: 'node[?isLiving]',
      style: {
        'border-style': 'solid',
      },
    },
    // Deceased persons
    {
      selector: 'node[!isLiving]',
      style: {
        'border-style': 'dashed',
        'opacity': 0.85,
      },
    },
    // Succession path nodes (golden highlight)
    {
      selector: 'node[?isOnSuccessionPath]',
      style: {
        'background-color': '#fef3c7',
        'border-color': '#f59e0b',
        'border-width': 3,
        'font-weight': 'bold',
      },
    },
    // Current Name Keeper (red border, prominent)
    {
      selector: 'node[?isNameKeeper]',
      style: {
        'background-color': '#fef3c7',
        'border-color': '#dc2626',
        'border-width': 4,
        'width': 50,
        'height': 50,
        'font-size': '12px',
        'font-weight': 'bold',
        'color': '#dc2626',
      },
    },
    // Patriarch node
    {
      selector: 'node[?isPatriarch]',
      style: {
        'background-color': '#fef3c7',
        'border-color': '#b45309',
        'border-width': 4,
        'width': 50,
        'height': 50,
        'font-weight': 'bold',
      },
    },
    // Extinct branch edges — dashed lines
    {
      selector: 'edge[removalFromPrime = -1]',
      style: {
        'line-style': 'dashed',
        'line-dash-pattern': [6, 4],
        'width': 1.5,
        'line-color': '#b0b8c4',
      } as cytoscape.Css.Edge,
    },
    // Family junction nodes (invisible routing points)
    {
      selector: 'node[nodeType="family-junction"]',
      style: {
        'width': 1,
        'height': 1,
        'background-color': 'transparent',
        'border-width': 0,
        'label': '',
        'shape': 'ellipse',
        'opacity': 0,
      },
    },
    // Base edge — right-angle (taxi) routing, no diagonals
    {
      selector: 'edge',
      style: {
        'width': 1,
        'line-color': '#cbd5e1',
        'target-arrow-color': '#cbd5e1',
        'target-arrow-shape': 'none',
        'curve-style': 'taxi',
        'taxi-direction': 'downward',
        'taxi-turn': 60,
      },
    },
    // Spouse-to-junction edges (always horizontal — same Y level)
    {
      selector: 'edge[edgeType="spouse-to-junction"]',
      style: {
        'target-arrow-shape': 'none',
        'line-color': '#94a3b8',
        'width': 1.5,
        'curve-style': 'straight',
      },
    },
    // Junction-to-child edges (vertical drop 1.5 blocks then horizontal fork)
    {
      selector: 'edge[edgeType="junction-to-child"]',
      style: {
        'target-arrow-shape': 'none',
        'curve-style': 'taxi',
        'taxi-direction': 'downward',
        'taxi-turn': 60,
      },
    },
    // Legacy spouse edges — kept for compatibility
    {
      selector: 'edge[edgeType="spouse"]',
      style: {
        'target-arrow-shape': 'none',
        'line-color': '#94a3b8',
        'width': 1.5,
        'curve-style': 'straight',
      },
    },
    // Removal-based edge thickness (closer to prime = thicker, dramatic falloff)
    {
      selector: 'edge[removalFromPrime = 3]',
      style: {
        'width': 1.5,
        'line-color': '#94a3b8',
      },
    },
    {
      selector: 'edge[removalFromPrime = 2]',
      style: {
        'width': 2.5,
        'line-color': '#64748b',
      },
    },
    {
      selector: 'edge[removalFromPrime = 1]',
      style: {
        'width': 3.5,
        'line-color': '#475569',
      },
    },
    {
      selector: 'edge[removalFromPrime = 0]',
      style: {
        'width': 4.5,
        'line-color': '#334155',
      },
    },
    // Succession path edges (gold, thickest) — overrides removal for prime line
    {
      selector: 'edge[?isSuccessionEdge]',
      style: {
        'line-color': '#f59e0b',
        'width': 5,
        'z-index': 10,
      },
    },
    // What-if alternate succession path (purple)
    {
      selector: 'node[?isWhatIfPath]',
      style: {
        'background-color': '#e9d5ff',
        'border-color': '#8b5cf6',
        'border-width': 3,
        'font-weight': 'bold',
      },
    },
    // What-if namekeeper (darker purple, larger)
    {
      selector: 'node[?isWhatIfNameKeeper]',
      style: {
        'background-color': '#c4b5fd',
        'border-color': '#7c3aed',
        'border-width': 4,
        'width': 50,
        'height': 50,
        'font-size': '12px',
        'font-weight': 'bold',
        'color': '#7c3aed',
      },
    },
    // What-if edges (dashed purple)
    {
      selector: 'edge[?isWhatIfEdge]',
      style: {
        'line-color': '#8b5cf6',
        'width': 3,
        'line-style': 'dashed',
        'z-index': 10,
      },
    },
    // Search match (blue ring)
    {
      selector: 'node.search-match',
      style: {
        'border-color': '#3b82f6',
        'border-width': 3,
        'overlay-color': '#3b82f6',
        'overlay-padding': 4,
        'overlay-opacity': 0.15,
        'z-index': 20,
      },
    },
    // Active search result (current match - bright blue)
    {
      selector: 'node.search-active',
      style: {
        'border-color': '#2563eb',
        'border-width': 4,
        'overlay-color': '#2563eb',
        'overlay-padding': 6,
        'overlay-opacity': 0.25,
        'z-index': 30,
        'width': 50,
        'height': 50,
      },
    },
  ];
}
