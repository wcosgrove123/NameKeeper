'use client';

import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useStore as useReactFlowStore,
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
import PersonSidePanel from '@/components/PersonSidePanel';
import PersonFormDialog from '@/components/PersonFormDialog';
import RelationshipDialog, { type LegacyRelationshipMode as RelationshipMode } from '@/components/RelationshipDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { searchPersons } from '@/lib/person-search';
import { computeAllNameKeepers, getSuccessionIds } from '@/lib/namekeeper';
import { computeNameKeeperStats } from '@/lib/namekeeper-stats';
import { computeAllMatriarchStats } from '@/lib/matriarch-stats';
import type { ConnectedFamily } from '@/components/PersonSidePanel';
import { useFamilyTreeStore } from '@/lib/store';
import { useAutoLoad } from '@/lib/use-auto-load';
import { useAuth } from '@/lib/auth-store';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin } = useAuth();
  const READ_ONLY = !isAdmin;
  const store = useFamilyTreeStore();
  const { data, isLoaded, loadFromGedcom, updatePerson, deletePerson, undo, redo, lastModified } = store;
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [personFormOpen, setPersonFormOpen] = useState(false);
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [relationshipMode, setRelationshipMode] = useState<RelationshipMode>('marriage');
  const [relationshipAnchor, setRelationshipAnchor] = useState<string | undefined>();
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);
  const [showGodparentMarkers, setShowGodparentMarkers] = useState(true);

  function openRelationship(mode: RelationshipMode, person: Person) {
    setRelationshipAnchor(person.id);
    setRelationshipMode(mode);
    setRelationshipOpen(true);
  }

  const [centerPersonId, setCenterPersonId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const distance = 0; // family distance control removed; layout always uses default
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

  // Auto-select center person (first person in data if none selected).
  // Skipped when a deep-link `?person=` is present so we don't race with it.
  useEffect(() => {
    if (data && !centerPersonId && !searchParams.get('person')) {
      // Try to find a person with the most connections (patriarch-like)
      const firstPerson = data.persons.values().next().value;
      if (firstPerson) setCenterPersonId(firstPerson.id);
    }
  }, [data, centerPersonId, searchParams]);

  // Cross-page deep link: ?person=@I123@ → center + select + skip landing.
  // Declared AFTER the auto-select effect so its setState wins the same-render
  // batch if both fire.
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current || !data) return;
    const personId = searchParams.get('person');
    if (personId && data.persons.has(personId)) {
      setShowLanding(false);
      setCenterPersonId(personId);
      setSelectedPersonId(personId);
      setExpandedNodes(new Set());
      setExpandedSpouseFamilies(new Set());
      deepLinkAppliedRef.current = true;
    }
  }, [data, searchParams]);

  // Build tree whenever inputs change
  // Layout build is intentionally INDEPENDENT of `selectedPersonId` so that
  // clicking around doesn't rebuild the whole tree (and doesn't refit the
  // viewport). Selection highlight is patched onto existing nodes by a cheap
  // effect below.
  const treeResult = useMemo(() => {
    if (!data || !centerPersonId) return null;
    return buildTreeViewV2(data, {
      centerPersonId,
      distance,
      expandedNodes,
      expandedSpouseFamilies,
    });
    // lastModified is included so in-place mutations (addPerson, addChildToFamily,
    // etc.) invalidate this memo even though `data` keeps the same reference.
  }, [data, lastModified, centerPersonId, distance, expandedNodes, expandedSpouseFamilies]);

  // Whenever the center changes, auto-select that person so the side panel
  // opens and they get the gold highlight. Direct clicks on other nodes still
  // override this (selectedPersonId !== centerPersonId is fine).
  useEffect(() => {
    if (centerPersonId) setSelectedPersonId(centerPersonId);
  }, [centerPersonId]);

  // Track previous values so we can tell what kind of change triggered this
  const prevTreeResultRef = useRef<typeof treeResult>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const prevShowGodparentRef = useRef<boolean>(true);

  // Single effect: applies layout when it changes, applies selection highlight
  // any time either the layout or the selection changes, and refits the view
  // appropriately.
  useEffect(() => {
    if (!treeResult) return;
    const layoutChanged = prevTreeResultRef.current !== treeResult;
    const selectionChanged = prevSelectedRef.current !== selectedPersonId;
    const godparentToggleChanged = prevShowGodparentRef.current !== showGodparentMarkers;
    prevTreeResultRef.current = treeResult;
    prevSelectedRef.current = selectedPersonId;
    prevShowGodparentRef.current = showGodparentMarkers;

    // Compute godparent IDs for the selected person (linked refs only)
    const godparentIds = new Set<string>();
    if (showGodparentMarkers && selectedPersonId && data) {
      const sel = data.persons.get(selectedPersonId);
      for (const g of sel?.godparents || []) {
        if (g.kind === 'linked') godparentIds.add(g.personId);
      }
    }

    if (layoutChanged) {
      // Apply fresh layout, baking in the current selection + godparent markers
      const baseNodes = treeResult.nodes.map((n) => {
        if (n.type !== 'personNode') return n;
        const d = n.data as unknown as PersonNodeData;
        const isSelected = d.personId === selectedPersonId;
        const isGod = godparentIds.has(d.personId);
        if (isSelected || isGod) {
          return { ...n, data: { ...n.data, isSelected, isGodparentOfSelected: isGod } };
        }
        return n;
      });
      setNodes(baseNodes);
      setEdges(treeResult.edges);
    } else if (selectionChanged || godparentToggleChanged) {
      // Patch selection + godparent markers onto existing nodes without rebuilding
      setNodes((prev) =>
        prev.map((n) => {
          if (n.type !== 'personNode') return n;
          const d = n.data as unknown as PersonNodeData;
          const wantSelected = d.personId === selectedPersonId;
          const wantGod = godparentIds.has(d.personId);
          if (d.isSelected === wantSelected && (d.isGodparentOfSelected ?? false) === wantGod) return n;
          return { ...n, data: { ...n.data, isSelected: wantSelected, isGodparentOfSelected: wantGod } };
        }),
      );
    }

    requestAnimationFrame(() => {
      if (selectedPersonId && data) {
        // Zoom to selected person + immediate family
        const ids = new Set<string>([selectedPersonId]);
        const sel = data.persons.get(selectedPersonId);
        if (sel?.familyAsChild) {
          const bf = data.families.get(sel.familyAsChild);
          if (bf?.husbandId) ids.add(bf.husbandId);
          if (bf?.wifeId) ids.add(bf.wifeId);
        }
        for (const fid of sel?.familiesAsSpouse || []) {
          const fam = data.families.get(fid);
          if (!fam) continue;
          if (fam.husbandId) ids.add(fam.husbandId);
          if (fam.wifeId) ids.add(fam.wifeId);
          for (const cid of fam.childIds) ids.add(cid);
        }
        fitView({ nodes: Array.from(ids).map((id) => ({ id })), padding: 0.4, duration: 350, maxZoom: 1.4 });
      } else if (layoutChanged) {
        // Initial layout / recenter without selection — fit whole tree
        fitView({ padding: 0.2, duration: 300 });
      }
    });
    // We deliberately don't depend on `data` to avoid re-firing on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeResult, selectedPersonId, showGodparentMarkers, setNodes, setEdges, fitView]);

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
      // Undo / Redo
      if (!READ_ONLY && (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (!READ_ONLY && (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
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
  }, [showSearch, undo, redo]);

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
      // Name search via shared multi-token matcher (handles middle names,
      // maiden names, nicknames, and birth-year tokens).
      const ranked = searchPersons(data, query, 30);
      setSearchResults(ranked);
      return;
    }

    // Relationship search path: sort and emit
    scored.sort((a, b) => b.score - a.score || a.person.surname.localeCompare(b.person.surname));
    setSearchResults(scored.slice(0, 30).map(s => s.person));
  }, [data, centerPersonId, RELATIONSHIP_KEYWORDS]);

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

  // ── NameKeeper / Matriarch stats for the selected person ─────────────
  // Computed lazily for whichever surname the selected person belongs to.
  const selectedNameKeeperStats = useMemo(() => {
    if (!data || !selectedPerson) return null;
    const results = computeAllNameKeepers(data).get(selectedPerson.surname);
    const result = results?.[0];
    if (!result) return null;
    const primeLineIds = getSuccessionIds(result);
    const map = computeNameKeeperStats(result.surname, result.patriarch.id, data, primeLineIds);
    return map.get(selectedPerson.id) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lastModified, selectedPerson?.id, selectedPerson?.surname]);

  const selectedMatriarchStats = useMemo(() => {
    if (!data || !selectedPerson) return null;
    const map = computeAllMatriarchStats(data, selectedPerson.surname);
    return map.get(selectedPerson.id) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lastModified, selectedPerson?.id, selectedPerson?.surname]);

  // Connected families for the selected person ("Appears In" chips)
  const selectedConnectedFamilies = useMemo<ConnectedFamily[]>(() => {
    if (!data || !selectedPerson) return [];
    const families: ConnectedFamily[] = [];
    const seen = new Set<string>();
    if (selectedPerson.familyAsChild) {
      const birthFam = data.families.get(selectedPerson.familyAsChild);
      if (birthFam) {
        for (const parentId of [birthFam.husbandId, birthFam.wifeId]) {
          if (!parentId) continue;
          const parent = data.persons.get(parentId);
          if (parent && parent.surname && !seen.has(parent.surname)) {
            seen.add(parent.surname);
            families.push({ surname: parent.surname, role: 'birth' });
          }
        }
      }
    }
    for (const famId of selectedPerson.familiesAsSpouse) {
      const fam = data.families.get(famId);
      if (!fam) continue;
      const spouseId = fam.husbandId === selectedPerson.id ? fam.wifeId : fam.husbandId;
      if (spouseId) {
        const spouse = data.persons.get(spouseId);
        if (spouse && spouse.surname && !seen.has(spouse.surname)) {
          seen.add(spouse.surname);
          families.push({ surname: spouse.surname, role: 'spouse' });
        }
      }
    }
    return families;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lastModified, selectedPerson?.id]);
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
      <div className="h-app flex flex-col">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-slate-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-app flex flex-col">
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
      <div className="min-h-10 bg-white border-b border-slate-200 flex items-center px-3 sm:px-4 gap-2 sm:gap-4 shrink-0 overflow-x-auto whitespace-nowrap">
        {/* Search */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded"
          >
            Search
          </button>
          {showSearch && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 w-[min(20rem,calc(100vw-1.5rem))]">
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
                              setSelectedPersonId(p.id);
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

        <div className="h-4 border-l border-slate-200 shrink-0" />

        {/* Center person indicator — truncate on phones; hide hint text */}
        {centerPersonId && data.persons.get(centerPersonId) && (
          <div className="text-xs text-slate-500 truncate min-w-0">
            <span className="hidden sm:inline">Centered on: </span>
            <span className="font-medium text-slate-700">
              {data.persons.get(centerPersonId)!.givenName} {data.persons.get(centerPersonId)!.surname}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Hint text only fits on tablet+; phones don't have the room */}
        <div className="text-xs text-slate-400 hidden lg:block shrink-0">
          Double-click to recenter. Click bubbles to expand. Purple + on spouses to show their family.
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0 relative">
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
            <Background variant={BackgroundVariant.Lines} gap={40} color="#f1f5f9" />
          </ReactFlow>
          <Legend
            showGodparentMarkers={showGodparentMarkers}
            onToggleGodparentMarkers={() => setShowGodparentMarkers((v) => !v)}
          />
          <ZoomToolbar
            onCenterSelected={() => {
              if (!selectedPersonId || !data) return;
              const ids = new Set<string>([selectedPersonId]);
              const sel = data.persons.get(selectedPersonId);
              if (sel?.familyAsChild) {
                const bf = data.families.get(sel.familyAsChild);
                if (bf?.husbandId) ids.add(bf.husbandId);
                if (bf?.wifeId) ids.add(bf.wifeId);
              }
              for (const fid of sel?.familiesAsSpouse || []) {
                const fam = data.families.get(fid);
                if (!fam) continue;
                if (fam.husbandId) ids.add(fam.husbandId);
                if (fam.wifeId) ids.add(fam.wifeId);
                for (const cid of fam.childIds) ids.add(cid);
              }
              fitView({ nodes: Array.from(ids).map((id) => ({ id })), padding: 0.4, duration: 350, maxZoom: 1.4 });
            }}
            onResetCenter={() => {
              if (!selectedPersonId) return;
              setCenterPersonId(selectedPersonId);
              setExpandedNodes(new Set());
              setExpandedSpouseFamilies(new Set());
            }}
          />
        </div>

        {/* Detail panel — floats over the tree, no docked sidebar background.
            Mobile: bottom sheet that fills lower 70% (above the zoom toolbar
            which sits at `bottom-3`). Desktop: anchored top-right as before. */}
        {selectedPerson && data && (
          <div className="absolute z-10 inset-x-2 bottom-2 max-h-[70svh] md:inset-x-auto md:top-3 md:right-3 md:bottom-16 md:w-80 md:max-h-[unset] flex items-start pb-safe md:pb-0">
            <PersonSidePanel
              person={data.persons.get(selectedPerson.id) || selectedPerson}
              data={data}
              connectedFamilies={selectedConnectedFamilies}
              nameKeeperStats={selectedNameKeeperStats}
              matriarchStats={selectedMatriarchStats}
              onClose={() => setSelectedPersonId(null)}
              onEdit={READ_ONLY ? undefined : () => {
                setEditingPerson(data.persons.get(selectedPerson.id) || selectedPerson);
                setPersonFormOpen(true);
              }}
              onCenterPerson={(p) => {
                setCenterPersonId(p.id);
                setExpandedNodes(new Set());
                setExpandedSpouseFamilies(new Set());
              }}
              onPhotoChange={(id, url) => updatePerson(id, { photoUrl: url })}
              onSetDivorced={(famId, divorced) => store.updateFamily(famId, { divorced: divorced || undefined })}
              onAddSpouse={READ_ONLY ? undefined : (p) => openRelationship('marriage', p)}
              onAddSibling={READ_ONLY ? undefined : (p) => openRelationship('add-sibling', p)}
              onAddChild={READ_ONLY ? undefined : (p) => openRelationship('add-child', p)}
              onAddParent={READ_ONLY ? undefined : (p) => openRelationship('add-parent', p)}
              onAddGodparent={READ_ONLY ? undefined : (p) => openRelationship('add-godparent', p)}
              onRemoveGodparent={READ_ONLY ? undefined : (id, idx) => store.removeGodparent(id, idx)}
              onSelectPerson={(id) => setSelectedPersonId(id)}
              onOpenSurnameTree={(surname, personId) => {
                router.push(`/?surname=${encodeURIComponent(surname)}&person=${encodeURIComponent(personId)}`);
              }}
              onDelete={READ_ONLY ? undefined : (p) => setPersonToDelete(p)}
            />
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <PersonFormDialog
        open={personFormOpen}
        person={editingPerson}
        onClose={() => { setPersonFormOpen(false); setEditingPerson(null); }}
        onSave={(pd) => {
          if (editingPerson) updatePerson(editingPerson.id, pd);
          setPersonFormOpen(false);
          setEditingPerson(null);
        }}
      />

      {/* Relationship dialog */}
      {data && (
        <RelationshipDialog
          open={relationshipOpen}
          mode={relationshipMode}
          anchorPersonId={relationshipAnchor}
          data={data}
          onClose={() => setRelationshipOpen(false)}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={personToDelete !== null}
        title="Delete Person"
        message={personToDelete ? `Delete ${personToDelete.givenName} ${personToDelete.surname}? This will remove them and unlink any families that become empty.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => {
          if (personToDelete) {
            deletePerson(personToDelete.id);
            if (selectedPersonId === personToDelete.id) setSelectedPersonId(null);
            if (centerPersonId === personToDelete.id) setCenterPersonId(null);
          }
          setPersonToDelete(null);
        }}
        onCancel={() => setPersonToDelete(null)}
      />
    </div>
  );
}

export default function TreeViewPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-slate-50"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <ReactFlowProvider>
        <TreeViewContent />
      </ReactFlowProvider>
    </Suspense>
  );
}

// ── Floating zoom toolbar ─────────────────────────────────────────────

function ZoomToolbar({
  onCenterSelected,
  onResetCenter,
}: {
  onCenterSelected: () => void;
  onResetCenter: () => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Subscribe to live zoom level
  const zoom = useReactFlowStore((s) => s.transform[2]);
  const pct = Math.round(zoom * 100);

  return (
    <div className="absolute bottom-3 right-3 z-10 w-fit max-w-[calc(100vw-1.5rem)] flex flex-row items-center bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_-2px_rgba(15,23,42,0.08)] px-1.5" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <ToolBtn label="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
        <MinusIcon />
      </ToolBtn>
      <div className="text-[10px] font-medium text-slate-500 tabular-nums px-2 select-none min-w-[34px] text-center">{pct}%</div>
      <ToolBtn label="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
        <PlusIcon />
      </ToolBtn>
      <Divider />
      <ToolBtn label="Fit to screen" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
        <FitIcon />
      </ToolBtn>
      <ToolBtn label="Center on selected" onClick={onCenterSelected}>
        <TargetIcon />
      </ToolBtn>
      <Divider />
      <ToolBtn label="Re-anchor on selected" onClick={onResetCenter}>
        <ResetIcon />
      </ToolBtn>
    </div>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-slate-200 mx-1" />;
}

// ── Legend with customize footer ──────────────────────────────────────

function Legend({
  showGodparentMarkers,
  onToggleGodparentMarkers,
}: {
  showGodparentMarkers: boolean;
  onToggleGodparentMarkers: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className="absolute bottom-3 left-3 z-10 w-[180px] sm:w-[200px] rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_-2px_rgba(15,23,42,0.08)] overflow-hidden hidden sm:block"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span>Legend</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? '' : '-rotate-90'}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-2 space-y-1.5">
          <LegendRow swatch={<NodeSwatch tone="male" />} label="Male" />
          <LegendRow swatch={<NodeSwatch tone="female" />} label="Female" />
          <LegendRow swatch={<NodeSwatch tone="unknown" />} label="Nonbinary / Unknown" />
          <LegendRow swatch={<NodeSwatch tone="male" deceased />} label="Deceased" />
          <LegendRow swatch={<NodeSwatch tone="male" thick />} label="Godfather" />
          <LegendRow swatch={<NodeSwatch tone="female" thick />} label="Godmother" />

          <div className="h-px bg-slate-100 my-1.5" />

          <LegendRow swatch={<EdgeSwatch />} label="Marriage" />
          <LegendRow swatch={<EdgeSwatch dashed />} label="Ex marriage" />
          <LegendRow swatch={<DepthSwatch />} label="Closer = thicker" />
          <p className="text-[10px] text-slate-400 leading-snug pl-9 -mt-0.5">
            Lines fade with generational distance from the centered person.
          </p>

          <div className="h-px bg-slate-100 my-1.5" />

          {/* Customize footer */}
          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Customize</div>
          <label className="flex items-center justify-between gap-2 cursor-pointer pt-0.5">
            <span className="text-[11px] text-slate-600">Godparent markers</span>
            <Toggle checked={showGodparentMarkers} onChange={onToggleGodparentMarkers} />
          </label>
        </div>
      )}
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 w-7 flex justify-center">{swatch}</div>
      <span className="text-[11px] text-slate-600">{label}</span>
    </div>
  );
}

function NodeSwatch({ tone, deceased, thick }: { tone: 'male' | 'female' | 'unknown'; deceased?: boolean; thick?: boolean }) {
  const cls = thick
    ? tone === 'male' ? 'bg-blue-50 border-blue-600 border-[3px]'
    : tone === 'female' ? 'bg-pink-50 border-pink-600 border-[3px]'
    : 'bg-slate-50 border-slate-500 border-[3px]'
    : tone === 'male'
      ? deceased ? 'bg-blue-50/50 border-blue-200 border-2' : 'bg-blue-50 border-blue-300 border-2'
      : tone === 'female'
        ? deceased ? 'bg-pink-50/50 border-pink-200 border-2' : 'bg-pink-50 border-pink-300 border-2'
        : 'bg-gray-50 border-gray-300 border-2';
  return <div className={`w-5 h-3.5 rounded-sm ${cls}`} />;
}

function EdgeSwatch({ dashed }: { dashed?: boolean }) {
  return (
    <svg width="22" height="6" viewBox="0 0 22 6">
      <line
        x1="1" y1="3" x2="21" y2="3"
        stroke="#475569"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dashed ? '4 3' : undefined}
      />
    </svg>
  );
}

function DepthSwatch() {
  // Mirrors edgeStyle() in tree-view-layout-v2.ts
  const lines = [
    { color: '#475569', w: 3.5 },
    { color: '#64748b', w: 2.5 },
    { color: '#94a3b8', w: 2 },
    { color: '#cbd5e1', w: 1.2 },
    { color: '#e2e8f0', w: 0.8 },
  ];
  return (
    <svg width="22" height="20" viewBox="0 0 22 20">
      {lines.map((l, i) => (
        <line
          key={i}
          x1="1" y1={3 + i * 4} x2="21" y2={3 + i * 4}
          stroke={l.color}
          strokeWidth={l.w}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
        checked ? 'bg-amber-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const ICON_PROPS = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function PlusIcon() { return (<svg {...ICON_PROPS}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>); }
function MinusIcon() { return (<svg {...ICON_PROPS}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/></svg>); }
function FitIcon() { return (<svg {...ICON_PROPS}><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>); }
function TargetIcon() { return (<svg {...ICON_PROPS}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>); }
function ResetIcon() { return (<svg {...ICON_PROPS}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>); }
