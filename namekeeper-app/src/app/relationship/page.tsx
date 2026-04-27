'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AppHeader from '@/components/AppHeader';
import PersonNode from '@/components/PersonNode';
import FamilyNode from '@/components/FamilyNode';
import { useFamilyTreeStore } from '@/lib/store';
import { useAutoLoad } from '@/lib/use-auto-load';
import { findRelationshipPath } from '@/lib/relationship-path';
import { buildRelationshipLayout } from '@/lib/relationship-path-layout';
import { calculateRelationship } from '@/lib/relationship-calculator';
import type { Person } from '@/lib/types';

const nodeTypes = {
  personNode: PersonNode,
  familyNode: FamilyNode,
};

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 100 + (q.length / t.length) * 50;
  let qi = 0;
  let consecutive = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += consecutive * 2;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? score : 0;
}

interface PersonSearchBoxProps {
  label: string;
  value: Person | null;
  onChange: (p: Person | null) => void;
  persons: Person[];
}

function displayFor(p: Person | null): string {
  if (!p) return '';
  const year = p.birthDate?.match(/(\d{4})/)?.[1];
  const base = `${p.givenName} ${p.surname}`.trim();
  return year ? `${base} (${year})` : base;
}

function PersonSearchBox({ label, value, onChange, persons }: PersonSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // When the user isn't actively editing, the input shows the selected value.
  const inputValue = editing ? query : displayFor(value);

  const results = useMemo(() => {
    if (!editing || !query.trim()) return [] as Person[];
    const scored: { p: Person; s: number }[] = [];
    for (const p of persons) {
      const full = `${p.givenName} ${p.surname}`.trim();
      const birthYear = p.birthDate?.match(/(\d{4})/)?.[1];
      const withYear = birthYear ? `${full} (${birthYear})` : full;
      const s = Math.max(fuzzyScore(query, full), fuzzyScore(query, withYear));
      if (s > 0) scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 20).map(r => r.p);
  }, [query, persons, editing]);

  return (
    <div className="relative w-full sm:w-auto">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className="flex items-center gap-1 w-full sm:w-72">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => { setEditing(true); setQuery(e.target.value); setOpen(true); }}
          onFocus={e => {
            setEditing(true);
            setQuery(displayFor(value));
            setOpen(true);
            // Select the whole value so typing replaces it immediately.
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setTimeout(() => { setOpen(false); setEditing(false); }, 150)}
          placeholder="Type a name..."
          className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded outline-none focus:border-amber-300"
        />
        {value && (
          <button
            onClick={() => { onChange(null); setQuery(''); setEditing(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
            className="text-slate-400 hover:text-slate-600 text-xs px-1"
            title="Clear"
          >
            x
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 sm:right-auto mt-1 bg-white border border-slate-200 rounded shadow-lg z-50 w-full sm:w-72 max-h-72 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange(p);
                setQuery('');
                setEditing(false);
                setOpen(false);
                inputRef.current?.blur();
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-2"
            >
              <span className="flex-1 truncate">{p.givenName} {p.surname}</span>
              <span className="text-xs text-slate-400 shrink-0">
                {p.birthDate?.match(/(\d{4})/)?.[1] || ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RelationshipContent() {
  const store = useFamilyTreeStore();
  const { data, isLoaded } = store;

  const [startPerson, setStartPerson] = useState<Person | null>(null);
  const [endPerson, setEndPerson] = useState<Person | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { fitView } = useReactFlow();

  useAutoLoad();

  const personList = useMemo(() => {
    if (!data) return [] as Person[];
    return Array.from(data.persons.values());
  }, [data]);

  // Default start person to the first one in data (usually Wil).
  useEffect(() => {
    if (data && !startPerson) {
      const first = data.persons.values().next().value;
      if (first) setStartPerson(first);
    }
  }, [data, startPerson]);

  const pathResult = useMemo(() => {
    if (!data || !startPerson || !endPerson) return null;
    const rp = findRelationshipPath(startPerson.id, endPerson.id, data);
    if (!rp) return null;
    const layout = buildRelationshipLayout(rp, data);
    const relationshipLabel = calculateRelationship(endPerson.id, startPerson.id, data);
    return { ...layout, relationshipLabel, path: rp };
  }, [data, startPerson, endPerson]);

  useEffect(() => {
    if (pathResult) {
      setNodes(pathResult.nodes);
      setEdges(pathResult.edges);
      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 300 });
      });
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [pathResult, setNodes, setEdges, fitView]);

  const swap = useCallback(() => {
    setStartPerson(endPerson);
    setEndPerson(startPerson);
  }, [startPerson, endPerson]);

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
        <div className="flex-1 flex items-center justify-center text-slate-500">
          Load a family tree file first.
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col">
      <AppHeader />

      {/* Toolbar — person pickers. On phones we stack the boxes full-width
          so the swap button doesn't crowd them off-screen. */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 shrink-0 flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3 sm:flex-wrap">
        <PersonSearchBox
          label="Start"
          value={startPerson}
          onChange={setStartPerson}
          persons={personList}
        />
        <button
          onClick={swap}
          disabled={!startPerson || !endPerson}
          className="self-center sm:self-auto sm:mb-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded disabled:opacity-30 disabled:hover:bg-transparent"
          title="Swap start and end"
        >
          ⇄
        </button>
        <PersonSearchBox
          label="End"
          value={endPerson}
          onChange={setEndPerson}
          persons={personList}
        />

        <div className="hidden sm:block flex-1" />

        {pathResult && startPerson && endPerson && (
          <div className="sm:mb-1 text-xs sm:text-sm">
            <span className="text-slate-500">
              {endPerson.givenName} is{' '}
            </span>
            <span className="font-semibold text-amber-700">
              {pathResult.relationshipLabel}
            </span>
            <span className="text-slate-500">
              {' '}of {startPerson.givenName}
            </span>
          </div>
        )}

        {startPerson && endPerson && !pathResult && (
          <div className="sm:mb-1 text-xs sm:text-sm text-slate-400">
            No common ancestor found.
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          minZoom={0.1}
          maxZoom={2}
          snapToGrid
          snapGrid={[40, 40]}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          proOptions={{ hideAttribution: true }}
        >
          <Controls position="bottom-left" />
          <Background variant={BackgroundVariant.Lines} gap={40} color="#f1f5f9" />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function RelationshipPage() {
  return (
    <ReactFlowProvider>
      <RelationshipContent />
    </ReactFlowProvider>
  );
}
