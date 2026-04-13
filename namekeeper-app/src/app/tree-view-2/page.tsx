'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AppHeader from '@/components/AppHeader';
import GedcomUploader from '@/components/GedcomUploader';
import PersonNode from '@/components/PersonNode';
import FamilyNode from '@/components/FamilyNode';
import { useFamilyTreeStore } from '@/lib/store';
import { useAutoLoad } from '@/lib/use-auto-load';
import { READ_ONLY } from '@/lib/site-config';
import { buildTreeViewV2 } from '@/lib/tree-view-layout-v2';
import TreeView2Landing from '@/components/TreeView2Landing';
import type { PersonNodeData } from '@/components/PersonNode';
import type { Person } from '@/lib/types';
import { calculateRelationship } from '@/lib/relationship-calculator';

const nodeTypes = {
  personNode: PersonNode,
  familyNode: FamilyNode,
};

function TreeViewContent() {
  const store = useFamilyTreeStore();
  const { data, isLoaded, loadFromGedcom } = store;

  const [centerPersonId, setCenterPersonId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [distance, setDistance] = useState(0);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [expandedSpouseFamilies, setExpandedSpouseFamilies] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Person[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showLanding, setShowLanding] = useState(true);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { fitView } = useReactFlow();

  // Auto-load from IndexedDB or bundled data
  useAutoLoad();

  // Auto-select center person (first person in data if none selected)
  useEffect(() => {
    if (data && !centerPersonId) {
      // Try to find a person with the most connections (patriarch-like)
      const firstPerson = data.persons.values().next().value;
      if (firstPerson) setCenterPersonId(firstPerson.id);
    }
  }, [data, centerPersonId]);

  // Build tree whenever inputs change
  const treeResult = useMemo(() => {
    if (!data || !centerPersonId) return null;
    return buildTreeViewV2(data, {
      centerPersonId,
      distance,
      expandedNodes,
      expandedSpouseFamilies,
      selectedPersonId: selectedPersonId ?? undefined,
    });
  }, [data, centerPersonId, distance, expandedNodes, expandedSpouseFamilies, selectedPersonId]);

  // Update React Flow state when tree changes, and re-fit the view
  useEffect(() => {
    if (treeResult) {
      setNodes(treeResult.nodes);
      setEdges(treeResult.edges);
      // Wait one frame for React Flow to render the new nodes, then fit
      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 300 });
      });
    }
  }, [treeResult, setNodes, setEdges, fitView]);

  // Handle node click
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    if (node.type === 'personNode') {
      const d = node.data as unknown as PersonNodeData;
      setSelectedPersonId(d.personId);

      // Check if the click was on the in-law toggle bubble
      const target = event.target as HTMLElement;
      const inlawToggle = target.closest('[data-inlaw-toggle]') as HTMLElement | null;
      if (inlawToggle) {
        const spouseId = inlawToggle.getAttribute('data-inlaw-toggle')!;
        setExpandedSpouseFamilies(prev => {
          const next = new Set(prev);
          if (next.has(spouseId)) {
            next.delete(spouseId);
          } else {
            next.add(spouseId);
          }
          return next;
        });
        return;
      }

      // If clicking an ancestor count bubble, expand that node
      if ((d.collapsedAncestorCount ?? 0) > 0 || (d.collapsedDescendantCount ?? 0) > 0) {
        setExpandedNodes(prev => {
          const next = new Set(prev);
          if (next.has(d.personId)) {
            next.delete(d.personId);
          } else {
            next.add(d.personId);
          }
          return next;
        });
      }
    }
  }, []);

  // Keyboard: Ctrl+F or just start typing to open search, Escape to close
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if already typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
        setSearchResults([]);
        return;
      }
      // Any printable character opens search and starts typing
      if (!showSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setShowSearch(true);
        requestAnimationFrame(() => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
            // The keypress will naturally type into the now-focused input
          }
        });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  // Handle double-click to recenter
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'personNode') {
      const d = node.data as unknown as PersonNodeData;
      setCenterPersonId(d.personId);
      setExpandedNodes(new Set());
      setExpandedSpouseFamilies(new Set());
    }
  }, []);

  // Fuzzy match: checks if all query chars appear in order in the target
  const fuzzyMatch = useCallback((query: string, target: string): number => {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    // Exact substring match scores highest
    if (t.includes(q)) return 100 + (q.length / t.length) * 50;
    // Fuzzy: all chars in order
    let qi = 0;
    let consecutive = 0;
    let score = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        qi++;
        consecutive++;
        score += consecutive * 2; // reward consecutive matches
      } else {
        consecutive = 0;
      }
    }
    return qi === q.length ? score : 0; // 0 = no match
  }, []);

  // Relationship keywords for relationship search
  const RELATIONSHIP_KEYWORDS = useMemo(() => new Set([
    'father', 'mother', 'parent', 'son', 'daughter', 'child',
    'brother', 'sister', 'sibling', 'uncle', 'aunt', 'nephew', 'niece',
    'cousin', 'grandfather', 'grandmother', 'grandparent',
    'grandson', 'granddaughter', 'grandchild',
    'husband', 'wife', 'spouse', 'step', 'half', 'in-law',
  ]), []);

  interface SearchResult {
    person: Person;
    score: number;
    relationship?: string;
  }

  // Search functionality with fuzzy matching, relationship search, and surname grouping
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!data || !query.trim()) {
      setSearchResults([]);
      return;
    }
    const q = query.trim().toLowerCase();

    // Check if this is a relationship search
    const isRelSearch = q.split(/\s+/).some(w => RELATIONSHIP_KEYWORDS.has(w));

    const scored: SearchResult[] = [];

    if (isRelSearch && centerPersonId) {
      // Relationship search: find people by their relationship to center person
      for (const person of data.persons.values()) {
        let rel: string;
        try {
          rel = calculateRelationship(person.id, centerPersonId, data);
        } catch { continue; }
        if (!rel || rel === 'Not related' || rel === 'Self') continue;
        const relLower = rel.toLowerCase();
        if (relLower.includes(q) || q.split(/\s+/).every(w => relLower.includes(w))) {
          scored.push({ person, score: 100, relationship: rel });
        }
      }
    } else {
      // Name search with fuzzy matching + date/place
      for (const person of data.persons.values()) {
        const fullName = `${person.givenName} ${person.surname}`.trim();
        const score = fuzzyMatch(q, fullName);
        if (score > 0) {
          scored.push({ person, score });
        }
      }
    }

    // Sort by score descending, then by surname
    scored.sort((a, b) => b.score - a.score || a.person.surname.localeCompare(b.person.surname));

    setSearchResults(scored.slice(0, 30).map(s => s.person));
  }, [data, centerPersonId, fuzzyMatch, RELATIONSHIP_KEYWORDS]);

  // Group search results by surname for display
  const groupedResults = useMemo(() => {
    const groups = new Map<string, Person[]>();
    for (const p of searchResults) {
      const key = p.surname || 'Unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return groups;
  }, [searchResults]);

  // Selected person details
  const selectedPerson = selectedPersonId ? data?.persons.get(selectedPersonId) : null;
  const selectedPersonFamily = selectedPerson?.familyAsChild
    ? data?.families.get(selectedPerson.familyAsChild)
    : null;
  const father = selectedPersonFamily?.husbandId
    ? data?.persons.get(selectedPersonFamily.husbandId)
    : null;
  const mother = selectedPersonFamily?.wifeId
    ? data?.persons.get(selectedPersonFamily.wifeId)
    : null;

  // Spouse(s) of selected person
  const spouses = useMemo(() => {
    if (!selectedPerson || !data) return [];
    const result: { person: Person; marriageDate?: string }[] = [];
    for (const famId of selectedPerson.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      const spouseId = fam.husbandId === selectedPerson.id ? fam.wifeId : fam.husbandId;
      if (spouseId) {
        const spouse = data.persons.get(spouseId);
        if (spouse) result.push({ person: spouse, marriageDate: fam.marriageDate });
      }
    }
    return result;
  }, [selectedPerson, data]);

  // Landing page callback (must be before early returns to satisfy Rules of Hooks)
  const handleLandingSelect = useCallback((personId: string) => {
    setCenterPersonId(personId);
    setExpandedNodes(new Set());
    setExpandedSpouseFamilies(new Set());
    setShowLanding(false);
  }, []);

  if (!isLoaded) {
    return (
      <div className="h-dvh flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-slate-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-dvh flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full">
            {READ_ONLY ? (
              <div className="text-center text-slate-500">Loading family data...</div>
            ) : (
              <GedcomUploader onFileLoaded={(content, filename) => loadFromGedcom(content, filename)} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col">
      <AppHeader />

      {/* Landing page overlay */}
      {showLanding && data && (
        <TreeView2Landing data={data} onSelectPerson={handleLandingSelect} />
      )}

      {/* Toolbar */}
      <div className="h-10 bg-white border-b border-slate-200 flex items-center px-4 gap-4 shrink-0">
        {/* Search */}
        <div className="relative">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded"
          >
            Search
          </button>
          {showSearch && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 w-72">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Name, surname, or relationship (e.g. cousin, uncle)..."
                className="w-full px-3 py-2 text-sm border-b border-slate-100 rounded-t-lg outline-none"
                autoFocus
              />
              {groupedResults.size > 0 && (
                <div className="max-h-72 overflow-y-auto">
                  {Array.from(groupedResults.entries()).map(([surname, people]) => (
                    <div key={surname}>
                      <div className="px-3 py-1 bg-slate-50 text-[10px] font-semibold text-slate-400 uppercase tracking-wider sticky top-0">
                        {surname} ({people.length})
                      </div>
                      {people.map(p => {
                        let rel: string | undefined;
                        try {
                          rel = centerPersonId && centerPersonId !== p.id
                            ? calculateRelationship(p.id, centerPersonId, data!)
                            : undefined;
                        } catch { rel = undefined; }
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              setCenterPersonId(p.id);
                              setExpandedNodes(new Set());
                              setExpandedSpouseFamilies(new Set());
                              setShowSearch(false);
                              setSearchQuery('');
                              setSearchResults([]);
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-2"
                          >
                            <span className="flex-1 truncate">{p.givenName} {p.surname}</span>
                            <span className="text-[10px] text-purple-400 truncate max-w-[100px]">
                              {rel && rel !== 'Not related' && rel !== 'Self' ? rel : ''}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">
                              {p.birthDate?.match(/(\d{4})/)?.[1] || ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-4 border-l border-slate-200" />

        {/* Distance control */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Family Distance:</span>
          <select
            value={distance}
            onChange={e => { setDistance(Number(e.target.value)); setExpandedNodes(new Set()); setExpandedSpouseFamilies(new Set()); }}
            className="border border-slate-200 rounded px-1 py-0.5 text-xs"
          >
            {[
              { value: 0, label: '0 — 1st Cousins' },
              { value: 1, label: '1 — 2nd Cousins' },
              { value: 2, label: '2 — 3rd Cousins' },
              { value: 3, label: '3 — 4th Cousins' },
              { value: 4, label: '4 — 5th Cousins' },
            ].map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="h-4 border-l border-slate-200" />

        {/* Center person indicator */}
        {centerPersonId && data.persons.get(centerPersonId) && (
          <div className="text-xs text-slate-500">
            Centered on: <span className="font-medium text-slate-700">
              {data.persons.get(centerPersonId)!.givenName} {data.persons.get(centerPersonId)!.surname}
            </span>
          </div>
        )}

        <div className="flex-1" />

        <div className="text-xs text-slate-400">
          Double-click to recenter. Click bubbles to expand. Purple + on spouses to show their family.
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Tree canvas */}
        <div className="flex-1 relative" style={{ height: '100%' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            minZoom={0.1}
            maxZoom={2}
            snapToGrid
            snapGrid={[40, 40]}
            defaultEdgeOptions={{
              type: 'smoothstep',
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Controls position="bottom-left" />
            <Background variant={BackgroundVariant.Lines} gap={40} color="#f1f5f9" />
          </ReactFlow>
        </div>

        {/* Detail panel */}
        {selectedPerson && (
          <div className="w-72 bg-white border-l border-slate-200 overflow-y-auto p-4">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-slate-800 text-sm">
                {selectedPerson.givenName} {selectedPerson.surname}
              </h3>
              <button
                onClick={() => setSelectedPersonId(null)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                x
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-600">
              {selectedPerson.sex !== 'U' && (
                <div>
                  <span className="text-slate-400">Sex: </span>
                  {selectedPerson.sex === 'M' ? 'Male' : 'Female'}
                </div>
              )}
              {selectedPerson.birthDate && (
                <div>
                  <span className="text-slate-400">Born: </span>
                  {selectedPerson.birthDate}
                  {selectedPerson.birthPlace ? `, ${selectedPerson.birthPlace}` : ''}
                </div>
              )}
              {selectedPerson.deathDate && (
                <div>
                  <span className="text-slate-400">Died: </span>
                  {selectedPerson.deathDate}
                  {selectedPerson.deathPlace ? `, ${selectedPerson.deathPlace}` : ''}
                </div>
              )}
              {!selectedPerson.deathDate && selectedPerson.isLiving && (
                <div className="text-green-600">Living</div>
              )}
              {selectedPerson.occupation && (
                <div>
                  <span className="text-slate-400">Occupation: </span>
                  {selectedPerson.occupation}
                </div>
              )}

              {/* Parents */}
              {(father || mother) && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-slate-400 font-medium mb-1">Parents</div>
                  {father && (
                    <button
                      onClick={() => { setCenterPersonId(father.id); setExpandedNodes(new Set()); setExpandedSpouseFamilies(new Set()); }}
                      className="block text-blue-600 hover:underline"
                    >
                      {father.givenName} {father.surname}
                    </button>
                  )}
                  {mother && (
                    <button
                      onClick={() => { setCenterPersonId(mother.id); setExpandedNodes(new Set()); setExpandedSpouseFamilies(new Set()); }}
                      className="block text-pink-600 hover:underline"
                    >
                      {mother.givenName} {mother.surname}
                    </button>
                  )}
                </div>
              )}

              {/* Spouses */}
              {spouses.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-slate-400 font-medium mb-1">
                    {spouses.length === 1 ? 'Spouse' : 'Spouses'}
                  </div>
                  {spouses.map(({ person: sp, marriageDate }) => (
                    <div key={sp.id}>
                      <button
                        onClick={() => { setCenterPersonId(sp.id); setExpandedNodes(new Set()); setExpandedSpouseFamilies(new Set()); }}
                        className="text-blue-600 hover:underline"
                      >
                        {sp.givenName} {sp.surname}
                      </button>
                      {marriageDate && (
                        <span className="text-slate-400 ml-1">m. {marriageDate}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Navigate button */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  onClick={() => { setCenterPersonId(selectedPerson.id); setExpandedNodes(new Set()); setExpandedSpouseFamilies(new Set()); }}
                  className="w-full px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-xs text-slate-700 transition-colors"
                >
                  Center on this person
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TreeViewPage() {
  return (
    <ReactFlowProvider>
      <TreeViewContent />
    </ReactFlowProvider>
  );
}
