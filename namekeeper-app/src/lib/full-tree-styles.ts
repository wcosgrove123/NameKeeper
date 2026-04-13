/**
 * Cytoscape stylesheet for the person-centered family tree view.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFullTreeStylesheet(): any[] {
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
    // Female nodes
    {
      selector: 'node[sex="F"]',
      style: {
        'shape': 'ellipse',
        'background-color': '#fce7f3',
        'border-color': '#f472b6',
      },
    },
    // Unknown sex
    {
      selector: 'node[sex="U"]',
      style: {
        'shape': 'diamond',
        'background-color': '#e2e8f0',
        'border-color': '#94a3b8',
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
    // Center person (highlighted)
    {
      selector: 'node[?isCenterPerson]',
      style: {
        'border-color': '#f59e0b',
        'border-width': 4,
        'width': 50,
        'height': 50,
        'font-size': '12px',
        'font-weight': 'bold',
        'color': '#b45309',
      },
    },
    // Family junction nodes (invisible)
    {
      selector: 'node[nodeType="family-junction"]',
      style: {
        'width': 1,
        'height': 1,
        'background-color': 'transparent',
        'border-width': 0,
        'label': '',
        'opacity': 0,
      },
    },
    // Base edge
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': '#94a3b8',
        'target-arrow-shape': 'none',
        'curve-style': 'taxi',
        'taxi-direction': 'downward',
        'taxi-turn': 60,
      },
    },
    // Spouse-to-junction edges (horizontal)
    {
      selector: 'edge[edgeType="spouse-to-junction"]',
      style: {
        'target-arrow-shape': 'none',
        'line-color': '#94a3b8',
        'width': 1.5,
        'curve-style': 'straight',
      },
    },
    // Junction-to-child edges
    {
      selector: 'edge[edgeType="junction-to-child"]',
      style: {
        'target-arrow-shape': 'none',
        'curve-style': 'taxi',
        'taxi-direction': 'downward',
        'taxi-turn': 60,
      },
    },
    // Spouse edges
    {
      selector: 'edge[edgeType="spouse"]',
      style: {
        'target-arrow-shape': 'none',
        'line-color': '#94a3b8',
        'width': 1.5,
        'curve-style': 'straight',
      },
    },
    // Selected person
    {
      selector: 'node.selected-person',
      style: {
        'border-color': '#f59e0b',
        'border-width': 4,
        'overlay-color': '#f59e0b',
        'overlay-padding': 4,
        'overlay-opacity': 0.15,
        'z-index': 20,
      },
    },
    // Relationship highlight (second person)
    {
      selector: 'node.relationship-target',
      style: {
        'border-color': '#8b5cf6',
        'border-width': 4,
        'overlay-color': '#8b5cf6',
        'overlay-padding': 4,
        'overlay-opacity': 0.15,
        'z-index': 20,
      },
    },
    // Search match
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
    // Active search result
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
