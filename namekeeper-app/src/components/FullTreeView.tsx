'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import { FullTreeElement } from '@/lib/full-tree-layout';
import { PersonTreeElement } from '@/lib/person-tree-layout';
import { getFullTreeStylesheet } from '@/lib/full-tree-styles';
import { Person } from '@/lib/types';

let dagreRegistered = false;

interface FullTreeViewProps {
  elements: (FullTreeElement | PersonTreeElement)[];
  positions?: Record<string, { x: number; y: number }>;
  onNodeClick?: (person: Person | null) => void;
  onNodeRightClick?: (person: Person, x: number, y: number) => void;
  onBackgroundDblClick?: (x: number, y: number) => void;
  onNodeDoubleClick?: (person: Person) => void;
  selectedPersonId?: string | null;
}

export default function FullTreeView({
  elements,
  positions,
  onNodeClick,
  onNodeRightClick,
  onBackgroundDblClick,
  onNodeDoubleClick,
  selectedPersonId,
}: FullTreeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isLayoutReady, setIsLayoutReady] = useState(false);
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

    const layoutConfig = positions && Object.keys(positions).length > 0
      ? {
          name: 'preset',
          positions: (node: cytoscape.NodeSingular) => {
            const pos = positions[node.id()];
            return pos || { x: 0, y: 0 };
          },
          animate: false,
        }
      : {
          name: 'dagre',
          rankDir: 'TB',
          nodeSep: 60,
          rankSep: 80,
          edgeSep: 20,
          padding: 60,
          animate: false,
        };

    const cy = cytoscape({
      container: containerRef.current,
      elements: elements as cytoscape.ElementDefinition[],
      style: getFullTreeStylesheet(),
      layout: layoutConfig as cytoscape.LayoutOptions,
      minZoom: 0.05,
      maxZoom: 4,
      pixelRatio: 'auto',
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

    cy.on('zoom', () => setZoomLevel(cy.zoom()));

    // Left click on person node
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

      // Highlight selected
      cy.nodes().removeClass('selected-person');
      evt.target.addClass('selected-person');
    });

    // Background click to deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        if (onNodeClick) onNodeClick(null);
        cy.nodes().removeClass('selected-person');
      }
    });

    // Right-click context menu
    cy.on('cxttap', 'node[nodeType="person"]', (evt) => {
      if (onNodeRightClick) {
        const nodeData = evt.target.data();
        const pos = evt.renderedPosition;
        const rect = containerRef.current!.getBoundingClientRect();
        onNodeRightClick(
          {
            id: nodeData.id,
            givenName: nodeData.fullName.replace(` ${nodeData.surname}`, ''),
            surname: nodeData.surname,
            sex: nodeData.sex,
            birthDate: nodeData.birthDate,
            deathDate: nodeData.deathDate,
            isLiving: nodeData.isLiving,
            familiesAsSpouse: [],
            notes: [],
          },
          rect.left + pos.x,
          rect.top + pos.y
        );
      }
    });

    // Double-click person to re-center, background to add person
    cy.on('dbltap', 'node[nodeType="person"]', (evt) => {
      if (onNodeDoubleClick) {
        const nodeData = evt.target.data();
        onNodeDoubleClick({
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
    cy.on('dbltap', (evt) => {
      if (evt.target === cy && onBackgroundDblClick) {
        const pos = evt.renderedPosition;
        const rect = containerRef.current!.getBoundingClientRect();
        onBackgroundDblClick(rect.left + pos.x, rect.top + pos.y);
      }
    });

    // Cursor feedback
    cy.on('mouseover', 'node[nodeType="person"]', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node[nodeType="person"]', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });
    cy.on('grab', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
    });
    cy.on('free', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    cy.fit(undefined, 50);
    setZoomLevel(cy.zoom());

    const targetZoom = cy.zoom();
    cy.zoom(targetZoom * 0.92);
    cy.animate({ zoom: targetZoom }, { duration: 400, easing: 'ease-out-cubic' });

    setIsLayoutReady(true);
    if (containerRef.current) containerRef.current.style.cursor = 'grab';
    cyRef.current = cy;
  }, [elements, onNodeClick, onNodeRightClick, onBackgroundDblClick]);

  useEffect(() => {
    initCytoscape();
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [initCytoscape]);

  // Highlight selected person when prop changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('selected-person');
    if (selectedPersonId) {
      const node = cy.getElementById(selectedPersonId);
      if (node.length > 0) node.addClass('selected-person');
    }
  }, [selectedPersonId]);

  // Controls
  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    const newZoom = Math.min(cy.zoom() * 1.25, cy.maxZoom());
    cy.animate({ zoom: { level: newZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 250, easing: 'ease-out-cubic' });
  }, []);

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    const newZoom = Math.max(cy.zoom() / 1.25, cy.minZoom());
    cy.animate({ zoom: { level: newZoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 250, easing: 'ease-out-cubic' });
  }, []);

  const handleFitAll = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.stop();
    cy.animate({ fit: { eles: cy.elements(), padding: 50 } }, { duration: 500, easing: 'ease-in-out-cubic' });
  }, []);

  // Search
  const executeSearch = useCallback((query: string) => {
    const cy = cyRef.current;
    if (!cy || !query.trim()) {
      setSearchResults([]);
      setSearchIndex(0);
      if (cy) cy.nodes().removeClass('search-match search-active');
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
      cy.animate({ center: { eles: node }, zoom: 1.2 }, { duration: 400, easing: 'ease-in-out-cubic' });
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
    if (cyRef.current) cyRef.current.nodes().removeClass('search-match search-active');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isLayoutReady && elements.length > 0) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        closeSearch();
        return;
      }
      if (e.key === 'Enter' && searchOpen) {
        e.preventDefault();
        if (e.shiftKey) handleSearchPrev();
        else handleSearchNext();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case '+': case '=': e.preventDefault(); handleZoomIn(); break;
        case '-': e.preventDefault(); handleZoomOut(); break;
        case '0': e.preventDefault(); handleFitAll(); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleFitAll, isLayoutReady, elements.length, searchOpen, closeSearch, handleSearchNext, handleSearchPrev]);

  const zoomPercent = Math.round(zoomLevel * 100);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full bg-slate-50 transition-opacity duration-300 ease-out"
        style={{ opacity: isLayoutReady || elements.length === 0 ? 1 : 0 }}
      />

      {elements.length > 0 && !isLayoutReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Rendering tree...</p>
          </div>
        </div>
      )}

      {elements.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
          Load a GEDCOM file to view the family tree
        </div>
      )}

      {/* Search bar */}
      {searchOpen && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-white shadow-lg rounded-lg border border-slate-200 p-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 ml-1.5 flex-shrink-0">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); executeSearch(e.target.value); }}
            placeholder="Search by name..."
            className="w-48 px-2 py-1 text-sm border-none outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
            autoFocus
          />
          {searchResults.length > 0 && (
            <span className="text-xs text-slate-500 whitespace-nowrap px-1">{searchIndex + 1}/{searchResults.length}</span>
          )}
          {searchQuery && searchResults.length === 0 && (
            <span className="text-xs text-slate-400 whitespace-nowrap px-1">No results</span>
          )}
          <button onClick={handleSearchPrev} disabled={searchResults.length === 0} className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors" title="Previous (Shift+Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-600"><polyline points="18 15 12 9 6 15" /></svg>
          </button>
          <button onClick={handleSearchNext} disabled={searchResults.length === 0} className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors" title="Next (Enter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-600"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          <button onClick={closeSearch} className="p-1 hover:bg-slate-100 rounded cursor-pointer transition-colors" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      {/* Zoom controls */}
      {elements.length > 0 && isLayoutReady && (
        <div className="absolute top-3 right-3 flex flex-col bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-slate-200 overflow-hidden">
          <button onClick={handleZoomIn} className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer border-b border-slate-100" title="Zoom in (+)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-600"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          </button>
          <div className="px-2.5 py-1.5 text-[11px] font-medium text-slate-500 text-center border-b border-slate-100 select-none">{zoomPercent}%</div>
          <button onClick={handleZoomOut} className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer border-b border-slate-100" title="Zoom out (-)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-600"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          </button>
          <div className="h-px bg-slate-200" />
          <button onClick={handleFitAll} className="p-2.5 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer" title="Fit entire tree (0)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-600"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>
        </div>
      )}

      {/* Legend */}
      {elements.length > 0 && isLayoutReady && (
        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg p-3 text-xs shadow-md border border-slate-200">
          <div className="font-semibold mb-2 text-slate-700">Legend</div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-100 border-2 border-blue-400" />
              <span className="text-slate-600">Male</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-pink-100 border-2 border-pink-400" />
              <span className="text-slate-600">Female</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-amber-100 border-2 border-amber-400" />
              <span className="text-slate-600">Selected</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400">
            Right-click for actions
          </div>
        </div>
      )}

      {/* Shortcuts hint */}
      {elements.length > 0 && isLayoutReady && (
        <div className="absolute bottom-3 right-3 bg-white/80 backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] text-slate-400 shadow-sm border border-slate-200">
          <span className="font-medium text-slate-500">Shortcuts:</span>{' '}
          <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px]">+</kbd>/<kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px]">-</kbd> zoom
          {' '}<kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px]">0</kbd> fit
          {' '}<kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px]">Ctrl+F</kbd> search
          {' '}<kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px]">dbl-click</kbd> add person
        </div>
      )}
    </div>
  );
}
