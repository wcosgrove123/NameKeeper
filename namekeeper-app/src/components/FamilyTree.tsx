'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import { CytoElement, getNameKeeperStylesheet } from '@/lib/tree-layout';
import { Person } from '@/lib/types';
import { useFamilyTreeStore } from '@/lib/store';
import { computeFamilyLayout } from '@/lib/family-layout';
import { computeCascadeWaves, CascadeWaves } from '@/lib/cascadeWaves';

// Cascade reveal timing — adjust freely.
const CASCADE_WAVE_INTERVAL_MS = 640;
const CASCADE_NODE_FADE_MS = 560;
const CASCADE_EDGE_TRACE_MS = 560;
const CASCADE_WITHIN_WAVE_STAGGER_MS = 80;
const CASCADE_FIT_DURATION_MS = 700;
const CASCADE_FINAL_FIT_DURATION_MS = 600;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface CascadeState {
  timeouts: ReturnType<typeof setTimeout>[];
  cancelled: boolean;
  active: boolean;
}

let dagreRegistered = false;

interface FamilyTreeProps {
  elements: CytoElement[];
  spousePairs?: Array<{ husbandId: string; wifeId: string }>;
  junctionIds?: Map<string, string>;
  patriarchId?: string;
  patriarchSurname?: string;
  successionIds?: Set<string>;
  onNodeClick?: (person: Person | null) => void;
  selectedSurname?: string;
  whatIfMode?: boolean;
  onToggleWhatIf?: () => void;
}

const GRID_SIZE = 40;
const HALF_GRID = GRID_SIZE / 2;

/** Snap to full grid points (visible dots) */
function snapToGrid(val: number): number {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

/** Snap to half-grid points (between dots — for junctions) */
function snapToHalfGrid(val: number): number {
  return Math.round(val / HALF_GRID) * HALF_GRID;
}

export default function FamilyTree({ elements, spousePairs, junctionIds, patriarchId, patriarchSurname, successionIds, onNodeClick, selectedSurname, whatIfMode, onToggleWhatIf }: FamilyTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const { data, saveNodePositions, getNodePositions, clearNodePositions } = useFamilyTreeStore();
  const positionUndoStack = useRef<Array<Record<string, { x: number; y: number }>>>([]);
  const positionRedoStack = useRef<Array<Record<string, { x: number; y: number }>>>([]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const cascadeRef = useRef<CascadeState | null>(null);
  const lastAnimatedSurnameRef = useRef<string | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const initCytoscape = useCallback(async () => {
    if (!containerRef.current || elements.length === 0) return;

    setIsLayoutReady(false);

    if (!dagreRegistered) {
      try {
        const cytoscapeDagre = (await import('cytoscape-dagre')).default;
        cytoscape.use(cytoscapeDagre);
        dagreRegistered = true;
      } catch {
        // dagre may already be registered
      }
    }

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    // Check for saved positions, or compute fresh layout
    // Only use saved positions if they match the current element count (not stale)
    const savedPositions = selectedSurname ? getNodePositions(selectedSurname) : undefined;
    const nodeCount = elements.filter(e => !('source' in (e as any).data)).length;
    const usePreset = savedPositions && Object.keys(savedPositions).length >= nodeCount * 0.8;

    // Compute positions: use saved, or our custom family layout, or fallback to dagre
    let computedPositions: Record<string, { x: number; y: number }> | null = null;
    if (!usePreset && patriarchId && patriarchSurname && junctionIds && data) {
      computedPositions = computeFamilyLayout(patriarchId, data, patriarchSurname, junctionIds, successionIds);
    }

    // For unpositioned nodes, stagger them below the main tree instead of
    // piling at the origin.  Find the max y of positioned nodes and place
    // stragglers in a row beneath it.
    let strayX = 0;
    let strayY = 0;
    if (computedPositions) {
      for (const pos of Object.values(computedPositions)) {
        if (pos.y > strayY) strayY = pos.y;
        if (pos.x > strayX) strayX = pos.x;
      }
      strayY += 200; // below the deepest row
      strayX = 0;
    }

    const layoutConfig = (usePreset || computedPositions)
      ? {
          name: 'preset',
          positions: (node: cytoscape.NodeSingular) => {
            const positions = usePreset ? savedPositions! : computedPositions!;
            const pos = positions[node.id()];
            if (pos) return pos;
            // Stagger unpositioned nodes in a row below the tree
            const fallback = { x: strayX, y: strayY };
            strayX += 80;
            return fallback;
          },
          animate: false,
        }
      : {
          name: 'dagre',
          rankDir: 'TB',
          nodeSep: 70,
          rankSep: 90,
          edgeSep: 25,
          padding: 60,
          animate: false,
        };

    const cy = cytoscape({
      container: containerRef.current,
      elements: elements as cytoscape.ElementDefinition[],
      style: getNameKeeperStylesheet(),
      layout: layoutConfig as cytoscape.LayoutOptions,
      minZoom: 0.05,
      maxZoom: 4,
      pixelRatio: 'auto',
      textureOnViewport: false,
      motionBlur: false,
      hideEdgesOnViewport: false,
      hideLabelsOnViewport: false,
      panningEnabled: true,
      userPanningEnabled: true,
      zoomingEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      selectionType: 'single',
      touchTapThreshold: 8,
      desktopTapThreshold: 4,
      autoungrabify: false,
    });

    // Track zoom level and update grid background
    function updateGrid() {
      setZoomLevel(cy.zoom());
      if (!containerRef.current) return;
      const zoom = cy.zoom();
      const pan = cy.pan();
      const scaledGrid = GRID_SIZE * zoom;
      const dotSize = Math.max(0.5, 0.8 * zoom);
      containerRef.current.style.backgroundImage = `radial-gradient(circle, #cbd5e1 ${dotSize}px, transparent ${dotSize}px)`;
      containerRef.current.style.backgroundSize = `${scaledGrid}px ${scaledGrid}px`;
      containerRef.current.style.backgroundPosition = `${pan.x % scaledGrid}px ${pan.y % scaledGrid}px`;
    }
    cy.on('zoom', updateGrid);
    cy.on('pan', updateGrid);

    // Click handler
    cy.on('tap', 'node[nodeType="person"]', (evt) => {
      const nodeData = evt.target.data();
      if (onNodeClick) {
        onNodeClick({
          id: nodeData.id,
          givenName: nodeData.fullName.replace(` ${nodeData.surname}`, ''),
          surname: nodeData.surname,
          sex: nodeData.sex,
          birthDate: nodeData.birthDate,
          deathDate: nodeData.deathDate,
          isLiving: nodeData.isLiving,
          familiesAsSpouse: [],
          notes: [],
        });
      }
    });

    // Background click to deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy && onNodeClick) {
        onNodeClick(null);
      }
    });

    // Node hover cursor
    cy.on('mouseover', 'node[nodeType="person"]', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node[nodeType="person"]', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    // Coupled dragging: when dragging a spouse, move partner + junction together
    let dragStartPos: { x: number; y: number } | null = null;
    let coupledNodes: cytoscape.NodeCollection | null = null;

    cy.on('grab', 'node[nodeType="person"]', (evt) => {
      const node = evt.target;
      dragStartPos = { ...node.position() };

      // Save current positions for undo
      const snapshot: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach(n => { snapshot[n.id()] = { ...n.position() }; });
      positionUndoStack.current.push(snapshot);
      if (positionUndoStack.current.length > 30) positionUndoStack.current.shift();
      positionRedoStack.current = []; // clear redo on new action

      // Find coupled nodes: junction + spouse through the junction
      const myEdges = node.connectedEdges('[edgeType="spouse-to-junction"]');
      if (myEdges.length > 0) {
        // Get the junction node(s)
        const junctions = myEdges.connectedNodes('[nodeType="family-junction"]');
        // Get ALL nodes connected to these junctions (includes spouse + junction itself)
        const allConnected = junctions.connectedEdges('[edgeType="spouse-to-junction"]').connectedNodes();
        // Remove the dragged node itself
        coupledNodes = allConnected.not(node);
      } else {
        coupledNodes = null;
      }
    });

    cy.on('drag', 'node[nodeType="person"]', (evt) => {
      if (!dragStartPos || !coupledNodes || coupledNodes.length === 0) return;
      const node = evt.target;
      const currentPos = node.position();
      const dx = currentPos.x - dragStartPos.x;
      const dy = currentPos.y - dragStartPos.y;

      // Move coupled nodes by the same delta
      coupledNodes.forEach((coupled) => {
        const coupledStart = coupled.scratch('_dragStart') || coupled.position();
        if (!coupled.scratch('_dragStart')) {
          coupled.scratch('_dragStart', { ...coupled.position() });
        }
        coupled.position({
          x: coupled.scratch('_dragStart').x + dx,
          y: coupled.scratch('_dragStart').y + dy,
        });
      });
    });

    // Pan cursor feedback
    cy.on('grab', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
    });
    cy.on('free', 'node', (evt) => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';

      // Snap coupled nodes to grid and clear drag state
      if (coupledNodes) {
        coupledNodes.forEach((n) => {
          n.removeScratch('_dragStart');
          const p = n.position();
          if (n.data('nodeType') === 'family-junction') {
            n.position({ x: snapToHalfGrid(p.x), y: snapToHalfGrid(p.y) });
          } else {
            n.position({ x: snapToGrid(p.x), y: snapToGrid(p.y) });
          }
        });
        coupledNodes = null;
      }
      dragStartPos = null;

      // Snap dragged node to grid
      const node = evt.target;
      const pos = node.position();
      node.position({ x: snapToGrid(pos.x), y: snapToGrid(pos.y) });
      // Save all positions
      if (selectedSurname) {
        const positions: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((n) => {
          const p = n.position();
          positions[n.id()] = { x: p.x, y: p.y };
        });
        saveNodePositions(selectedSurname, positions);
      }
    });

    // Cancel any in-flight cascade from a previous surname.
    if (cascadeRef.current) {
      cascadeRef.current.cancelled = true;
      cascadeRef.current.active = false;
      cascadeRef.current.timeouts.forEach((t) => clearTimeout(t));
      cascadeRef.current = null;
    }

    // Decide whether to run the cascade reveal animation.  We only animate
    // when the *surname* changes, so toggling what-if or editing a person
    // doesn't replay the whole sequence.
    const shouldCascade =
      !!patriarchId &&
      !!data &&
      !!selectedSurname &&
      lastAnimatedSurnameRef.current !== selectedSurname &&
      !prefersReducedMotion();

    let waves: CascadeWaves | null = null;
    if (shouldCascade && patriarchId && data) {
      try {
        waves = computeCascadeWaves(cy, patriarchId, data);
      } catch (err) {
        console.error('computeCascadeWaves failed', err);
        waves = null;
      }
    }

    if (waves && waves.totalWaves > 1) {
      // Hide every element and prime edges with a dashed-offset pattern so
      // they can "trace" from source to target on reveal.
      cy.elements().style('opacity', 0);
      cy.edges().forEach((edge) => {
        const src = edge.sourceEndpoint();
        const tgt = edge.targetEndpoint();
        // Taxi/straight edges have manhattan length equal to |dx|+|dy|; pad
        // slightly so the final dash fully covers the edge.
        const len = Math.max(40, Math.abs(tgt.x - src.x) + Math.abs(tgt.y - src.y) + 30);
        edge.scratch('_traceLen', len);
        edge.style({
          'line-style': 'dashed',
          'line-dash-pattern': [len, len],
          'line-dash-offset': len,
        });
      });

      // Zoom onto the patriarch with generous padding — the camera pulls back
      // as each wave adds nodes.
      const patriarchNode = cy.getElementById(patriarchId!);
      if (patriarchNode.length > 0) {
        cy.fit(patriarchNode, 400);
      } else {
        cy.fit(undefined, 50);
      }
      setZoomLevel(cy.zoom());

      setIsLayoutReady(true);
      updateGrid();

      // Kick off the cascade.
      const state: CascadeState = { timeouts: [], cancelled: false, active: true };
      cascadeRef.current = state;
      setIsAnimating(true);
      lastAnimatedSurnameRef.current = selectedSurname;

      const nodesByWave = new Map<number, string[]>();
      const edgesByWave = new Map<number, string[]>();
      for (const [id, w] of waves.nodeWaves) {
        if (!nodesByWave.has(w)) nodesByWave.set(w, []);
        nodesByWave.get(w)!.push(id);
      }
      for (const [id, w] of waves.edgeWaves) {
        if (!edgesByWave.has(w)) edgesByWave.set(w, []);
        edgesByWave.get(w)!.push(id);
      }

      // Junction nodes have wave 0 but no visible opacity impact — reveal
      // them instantly so edges can render normally.
      cy.nodes('[nodeType="family-junction"]').style('opacity', 1);

      for (let waveIdx = 0; waveIdx < waves.totalWaves; waveIdx++) {
        const delay = waveIdx * CASCADE_WAVE_INTERVAL_MS;
        const capturedWave = waveIdx;
        const t = setTimeout(() => {
          if (state.cancelled) return;

          const nodeIds = nodesByWave.get(capturedWave) || [];
          const edgeIds = edgesByWave.get(capturedWave) || [];

          nodeIds.forEach((id, i) => {
            const node = cy.getElementById(id);
            if (node.length === 0) return;
            if (node.data('nodeType') !== 'person') return;
            const inner = setTimeout(() => {
              if (state.cancelled) return;
              node.animate(
                { style: { opacity: 1 } },
                { duration: CASCADE_NODE_FADE_MS, easing: 'ease-out-cubic' },
              );
            }, i * CASCADE_WITHIN_WAVE_STAGGER_MS);
            state.timeouts.push(inner);
          });

          edgeIds.forEach((id, i) => {
            const edge = cy.getElementById(id);
            if (edge.length === 0) return;
            const inner = setTimeout(() => {
              if (state.cancelled) return;
              edge.style('opacity', 1);
              edge.animate(
                { style: { 'line-dash-offset': 0 } },
                {
                  duration: CASCADE_EDGE_TRACE_MS,
                  easing: 'ease-out-cubic',
                  complete: () => {
                    edge.removeStyle('line-style line-dash-pattern line-dash-offset');
                  },
                },
              );
            }, i * CASCADE_WITHIN_WAVE_STAGGER_MS);
            state.timeouts.push(inner);
          });

          // Progressive fit: re-frame to include everything revealed so far.
          const revealed = cy.nodes('[nodeType="person"]').filter((n) => {
            const wv = waves!.nodeWaves.get(n.id());
            return wv !== undefined && wv <= capturedWave;
          });
          if (revealed.length > 0) {
            cy.stop(true, false);
            cy.animate(
              { fit: { eles: revealed, padding: 80 } },
              { duration: CASCADE_FIT_DURATION_MS, easing: 'ease-in-out-cubic' },
            );
          }
        }, delay);
        state.timeouts.push(t);
      }

      // Finalize after the last wave completes its trace animation.
      const finalDelay =
        waves.totalWaves * CASCADE_WAVE_INTERVAL_MS + CASCADE_EDGE_TRACE_MS + 120;
      const finalT = setTimeout(() => {
        if (state.cancelled) return;
        state.active = false;
        setIsAnimating(false);
        cy.stop(true, false);
        cy.animate(
          { fit: { eles: cy.elements(), padding: 50 } },
          { duration: CASCADE_FINAL_FIT_DURATION_MS, easing: 'ease-in-out-cubic' },
        );
      }, finalDelay);
      state.timeouts.push(finalT);
    } else {
      // No animation — normal fit + gentle fade-in entrance.
      cy.fit(undefined, 50);
      setZoomLevel(cy.zoom());
      const targetZoom = cy.zoom();
      cy.zoom(targetZoom * 0.92);
      cy.animate(
        { zoom: targetZoom },
        { duration: 400, easing: 'ease-out-cubic' },
      );
      setIsLayoutReady(true);
      updateGrid();
      if (selectedSurname) lastAnimatedSurnameRef.current = selectedSurname;
    }

    // For dagre fallback only: snap nodes to grid
    if (!usePreset && !computedPositions) {
      cy.nodes().forEach((n) => {
        const p = n.position();
        n.position({ x: snapToGrid(p.x), y: snapToGrid(p.y) });
      });
    }

    // Save positions
    if (selectedSurname) {
      const positions: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach((n) => {
        const p = n.position();
        positions[n.id()] = { x: p.x, y: p.y };
      });
      saveNodePositions(selectedSurname, positions);
    }

    // Set default cursor
    if (containerRef.current) containerRef.current.style.cursor = 'grab';

    cyRef.current = cy;
  }, [elements, onNodeClick, selectedSurname, getNodePositions, saveNodePositions, data, patriarchId]);

  // Skip the in-flight cascade and jump straight to the final layout.
  const handleSkipAnimation = useCallback(() => {
    const state = cascadeRef.current;
    if (!state || !state.active) return;
    state.cancelled = true;
    state.active = false;
    state.timeouts.forEach((t) => clearTimeout(t));
    state.timeouts = [];
    const cy = cyRef.current;
    if (cy) {
      cy.stop(true, false);
      cy.elements().stop(true, true);
      cy.elements().style('opacity', 1);
      cy.edges().forEach((edge) => {
        edge.removeStyle('line-style line-dash-pattern line-dash-offset');
      });
      cy.animate(
        { fit: { eles: cy.elements(), padding: 50 } },
        { duration: 350, easing: 'ease-in-out-cubic' },
      );
    }
    setIsAnimating(false);
  }, []);

  useEffect(() => {
    initCytoscape();
    return () => {
      if (cascadeRef.current) {
        cascadeRef.current.cancelled = true;
        cascadeRef.current.active = false;
        cascadeRef.current.timeouts.forEach((t) => clearTimeout(t));
        cascadeRef.current = null;
      }
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [initCytoscape]);

  // --- Control handlers ---

  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop(); // Cancel any in-progress animation for responsiveness
    const newZoom = Math.min(cy.zoom() * 1.25, cy.maxZoom());
    cy.animate({
      zoom: { level: newZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } },
    }, { duration: 250, easing: 'ease-out-cubic' });
  }, []);

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    const newZoom = Math.max(cy.zoom() / 1.25, cy.minZoom());
    cy.animate({
      zoom: { level: newZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } },
    }, { duration: 250, easing: 'ease-out-cubic' });
  }, []);

  const handleFitAll = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    cy.animate({
      fit: { eles: cy.elements(), padding: 50 },
    }, { duration: 500, easing: 'ease-in-out-cubic' });
  }, []);

  const handleFitNameKeeper = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    const nameKeeperNode = cy.nodes('[?isNameKeeper]');
    if (nameKeeperNode.length > 0) {
      cy.animate({
        center: { eles: nameKeeperNode },
        zoom: 1.5,
      }, { duration: 600, easing: 'ease-in-out-cubic' });
    }
  }, []);

  const handleFitSuccession = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    const successionNodes = cy.nodes('[?isOnSuccessionPath]');
    if (successionNodes.length > 0) {
      cy.animate({
        fit: { eles: successionNodes, padding: 80 },
      }, { duration: 600, easing: 'ease-in-out-cubic' });
    }
  }, []);

  const handleResetLayout = useCallback(() => {
    if (selectedSurname) clearNodePositions(selectedSurname);
    // Re-initialize cytoscape with dagre
    initCytoscape();
  }, [selectedSurname, clearNodePositions, initCytoscape]);

  const handleFitPatriarch = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    const patriarchNode = cy.nodes('[?isPatriarch]');
    if (patriarchNode.length > 0) {
      cy.animate({
        center: { eles: patriarchNode },
        zoom: 1.2,
      }, { duration: 600, easing: 'ease-in-out-cubic' });
    }
  }, []);

  // --- Search logic ---

  const executeSearch = useCallback((query: string) => {
    const cy = cyRef.current;
    if (!cy || !query.trim()) {
      setSearchResults([]);
      setSearchIndex(0);
      // Clear highlights
      if (cy) {
        cy.nodes().removeClass('search-match search-active');
      }
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matches: string[] = [];

    cy.nodes('[nodeType="person"]').forEach((node) => {
      const fullName = (node.data('fullName') || '').toLowerCase();
      if (fullName.includes(lowerQuery)) {
        matches.push(node.id());
        node.addClass('search-match');
      } else {
        node.removeClass('search-match search-active');
      }
    });

    setSearchResults(matches);
    if (matches.length > 0) {
      setSearchIndex(0);
      navigateToResult(matches[0]);
    }
  }, []);

  const navigateToResult = useCallback((nodeId: string) => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.stop();
    cy.nodes().removeClass('search-active');
    const node = cy.getElementById(nodeId);
    if (node.length > 0) {
      node.addClass('search-active');
      cy.animate({
        center: { eles: node },
        zoom: 1.2,
      }, { duration: 400, easing: 'ease-in-out-cubic' });
    }
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchResults.length === 0) return;
    const next = (searchIndex + 1) % searchResults.length;
    setSearchIndex(next);
    navigateToResult(searchResults[next]);
  }, [searchResults, searchIndex, navigateToResult]);

  const handleSearchPrev = useCallback(() => {
    if (searchResults.length === 0) return;
    const prev = (searchIndex - 1 + searchResults.length) % searchResults.length;
    setSearchIndex(prev);
    navigateToResult(searchResults[prev]);
  }, [searchResults, searchIndex, navigateToResult]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchIndex(0);
    const cy = cyRef.current;
    if (cy) {
      cy.nodes().removeClass('search-match search-active');
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F / Cmd+F to open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isLayoutReady && elements.length > 0) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      // Escape to close search
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        closeSearch();
        return;
      }

      // Enter to go to next result while searching
      if (e.key === 'Enter' && searchOpen) {
        e.preventDefault();
        if (e.shiftKey) {
          handleSearchPrev();
        } else {
          handleSearchNext();
        }
        return;
      }

      // Ctrl+Z / Ctrl+Y for position undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (selectedSurname && positionUndoStack.current.length > 0) {
          const prev = positionUndoStack.current.pop()!;
          const cy = cyRef.current;
          if (cy) {
            // Save current as redo
            const current: Record<string, { x: number; y: number }> = {};
            cy.nodes().forEach(n => { current[n.id()] = { ...n.position() }; });
            positionRedoStack.current.push(current);
            // Restore previous
            cy.nodes().forEach(n => {
              const pos = prev[n.id()];
              if (pos) n.position(pos);
            });
            saveNodePositions(selectedSurname, prev);
          }
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (selectedSurname && positionRedoStack.current.length > 0) {
          const next = positionRedoStack.current.pop()!;
          const cy = cyRef.current;
          if (cy) {
            const current: Record<string, { x: number; y: number }> = {};
            cy.nodes().forEach(n => { current[n.id()] = { ...n.position() }; });
            positionUndoStack.current.push(current);
            cy.nodes().forEach(n => {
              const pos = next[n.id()];
              if (pos) n.position(pos);
            });
            saveNodePositions(selectedSurname, next);
          }
        }
        return;
      }

      // Only handle tree shortcuts if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          handleZoomIn();
          break;
        case '-':
          e.preventDefault();
          handleZoomOut();
          break;
        case '0':
          e.preventDefault();
          handleFitAll();
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          handleFitNameKeeper();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          handleFitSuccession();
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          if (onToggleWhatIf) onToggleWhatIf();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleFitAll, handleFitNameKeeper, handleFitSuccession, isLayoutReady, elements.length, searchOpen, closeSearch, handleSearchNext, handleSearchPrev, onToggleWhatIf, selectedSurname, saveNodePositions]);

  const zoomPercent = Math.round(zoomLevel * 100);

  return (
    <div className="relative w-full h-full">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="w-full h-full rounded-lg transition-opacity duration-300 ease-out"
        style={{
          opacity: isLayoutReady || elements.length === 0 ? 1 : 0,
          backgroundColor: '#f8fafc',
        }}
      />

      {/* What-If mode indicator */}
      {whatIfMode && isLayoutReady && elements.length > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 bg-purple-100/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-md border border-purple-300">
          <div className="text-xs text-purple-700 text-center font-medium">
            What-If Mode Active &mdash; Click a person on the golden line to explore alternate succession
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {elements.length > 0 && !isLayoutReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 rounded-lg">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Rendering tree...</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {elements.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-center px-6 gap-1">
          <span className="hidden md:inline">Select a surname to view its patrilineal tree</span>
          <span className="md:hidden">Tap “Surnames” above to pick a family</span>
          <span className="md:hidden text-xs text-slate-300">to view its patrilineal tree</span>
        </div>
      )}

      {/* Search bar */}
      {searchOpen && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-white shadow-lg rounded-lg border border-slate-200 p-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 ml-1.5 flex-shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              executeSearch(e.target.value);
            }}
            placeholder="Search by name..."
            className="w-48 px-2 py-1 text-sm border-none outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
            autoFocus
          />
          {searchResults.length > 0 && (
            <span className="text-xs text-slate-500 whitespace-nowrap px-1">
              {searchIndex + 1}/{searchResults.length}
            </span>
          )}
          {searchQuery && searchResults.length === 0 && (
            <span className="text-xs text-slate-400 whitespace-nowrap px-1">
              No results
            </span>
          )}
          <button
            onClick={handleSearchPrev}
            disabled={searchResults.length === 0}
            className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
            aria-label="Previous result"
            title="Previous (Shift+Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            onClick={handleSearchNext}
            disabled={searchResults.length === 0}
            className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
            aria-label="Next result"
            title="Next (Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button
            onClick={closeSearch}
            className="p-1 hover:bg-slate-100 rounded cursor-pointer transition-colors"
            aria-label="Close search"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Skip animation button — only shown while the cascade is running.
          Sits *below* the Current Name Keeper bubble (which is at top-3 of
          the parent), so the two pills don't overlap. */}
      {isAnimating && (
        <button
          onClick={handleSkipAnimation}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm hover:bg-slate-50 active:bg-slate-100 shadow-lg border border-slate-200 rounded-full pl-3 pr-3.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer transition-colors"
          aria-label="Skip animation"
          title="Skip reveal animation"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
            <polygon points="5 4 15 12 5 20 5 4" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
          Skip animation
        </button>
      )}

      {/* Zoom controls toolbar — horizontal, anchored bottom-right. */}
      {elements.length > 0 && isLayoutReady && (
        <div className="absolute bottom-3 right-3 flex flex-row items-stretch bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 overflow-hidden">
          {/* Zoom in */}
          <button
            onClick={handleZoomIn}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer border-r border-slate-100"
            aria-label="Zoom in"
            title="Zoom in (+)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          {/* Zoom level indicator */}
          <div className="px-2 flex items-center justify-center text-[11px] font-medium text-slate-500 border-r border-slate-100 select-none min-w-[40px]">
            {zoomPercent}%
          </div>

          {/* Zoom out */}
          <button
            onClick={handleZoomOut}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer border-r border-slate-100"
            aria-label="Zoom out"
            title="Zoom out (-)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px bg-slate-200" />

          {/* Fit all */}
          <button
            onClick={handleFitAll}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer border-r border-slate-100"
            aria-label="Fit all nodes"
            title="Fit entire tree (0)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>

          {/* Fit succession path */}
          <button
            onClick={handleFitSuccession}
            className="p-2.5 hover:bg-amber-50 active:bg-amber-100 transition-colors cursor-pointer border-r border-slate-100"
            aria-label="Fit succession path"
            title="Fit succession path (S)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>

          {/* Center on Name Keeper */}
          <button
            onClick={handleFitNameKeeper}
            className="p-2.5 hover:bg-red-50 active:bg-red-100 transition-colors cursor-pointer border-r border-slate-100"
            aria-label="Center on Name Keeper"
            title="Center on Name Keeper (K)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>

          {/* Center on Patriarch */}
          <button
            onClick={handleFitPatriarch}
            className="p-2.5 hover:bg-amber-50 active:bg-amber-100 transition-colors cursor-pointer border-r border-slate-100"
            aria-label="Center on Patriarch"
            title="Center on Patriarch"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-800">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px bg-slate-200" />

          {/* What-If toggle */}
          <button
            onClick={onToggleWhatIf}
            className={`p-2.5 transition-colors cursor-pointer ${
              whatIfMode
                ? 'bg-purple-100 hover:bg-purple-200'
                : 'hover:bg-purple-50 active:bg-purple-100'
            }`}
            aria-label="Toggle What-If Mode"
            title="What-If Mode (W) — Click a person on the golden line to see alternate succession"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={whatIfMode ? 'text-purple-700' : 'text-purple-500'}>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px bg-slate-200" />

          {/* Reset Layout */}
          <button
            onClick={handleResetLayout}
            className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer"
            aria-label="Reset Layout"
            title="Reset Layout (re-run auto-arrange)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      )}

      {/* Legend — collapsible. On narrow canvases (small desktop windows,
          tablets) the expanded legend would otherwise overlap the wide
          bottom-right zoom/control toolbar. Default open on tablet+, closed
          on phones. */}
      {elements.length > 0 && isLayoutReady && (
        <FamilyTreeLegend whatIfMode={whatIfMode} />
      )}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────

function FamilyTreeLegend({ whatIfMode }: { whatIfMode?: boolean }) {
  // Collapsed by default on phones to avoid colliding with the bottom-right
  // control bar; opened on tablet+ where there's room.
  const [open, setOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );

  return (
    <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg text-xs shadow-md border border-slate-200 max-w-[calc(100vw-1.5rem)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
        aria-expanded={open}
      >
        <span>Legend</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? '' : '-rotate-90'}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-amber-100 border-2 border-red-600" />
            <span className="text-slate-600">Current Name Keeper</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-amber-100 border-2 border-amber-500" />
            <span className="text-slate-600">Succession Path</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-amber-800/20 border-2 border-amber-800" />
            <span className="text-slate-600">Patriarch</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-100 border-2 border-blue-400" />
            <span className="text-slate-600">Male</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              <div className="w-2 h-4 rounded-sm bg-blue-100" />
              <div className="w-2 h-4 rounded-sm bg-blue-200" />
              <div className="w-2 h-4 rounded-sm bg-blue-300" />
              <div className="w-2 h-4 rounded-sm bg-blue-400" />
              <div className="w-2 h-4 rounded-sm bg-blue-500" />
            </div>
            <span className="text-slate-600">Gen Depth (1-5+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-pink-100 border-2 border-pink-400" />
            <span className="text-slate-600">Female</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-100 border-2 border-dashed border-blue-300" />
            <span className="text-slate-600">Deceased</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 border-t-2 border-dashed border-slate-400" />
            <span className="text-slate-600">Extinct Branch</span>
          </div>
          {whatIfMode && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-purple-200 border-2 border-purple-500" />
              <span className="text-purple-600">What-If Path</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
