'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import AppHeader from '@/components/AppHeader';
import FullTreeView from '@/components/FullTreeView';
import PersonSidePanel, { ConnectedFamily } from '@/components/PersonSidePanel';
import PersonFormDialog from '@/components/PersonFormDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import RelationshipDialog from '@/components/RelationshipDialog';
import TreeContextMenu from '@/components/TreeContextMenu';
import FamilyOverview from '@/components/FamilyOverview';
import RelationshipBadge from '@/components/RelationshipBadge';
import GedcomUploader from '@/components/GedcomUploader';
import { useFamilyTreeStore } from '@/lib/store';
import { computePersonTree, type PersonTreeElement } from '@/lib/person-tree-layout';
import { calculateRelationship } from '@/lib/relationship-calculator';
import { Person } from '@/lib/types';
import { useAuth } from '@/lib/auth-store';
import { useAutoLoad } from '@/lib/use-auto-load';

export default function FamilyTreePage() {
  const { isAdmin } = useAuth();
  const READ_ONLY = !isAdmin;
  const store = useFamilyTreeStore();
  const { data, isLoaded, lastModified, loadFromGedcom, addPerson, updatePerson, deletePerson, createMarriage, setParentChild, undo, redo } = store;

  // View mode: 'overview' | 'tree'
  const [viewMode, setViewMode] = useState<'overview' | 'tree'>('overview');
  const [centerPersonId, setCenterPersonId] = useState<string | null>(null);
  const [ancestorDepth, setAncestorDepth] = useState(3);
  const [descendantDepth, setDescendantDepth] = useState(3);

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  // Connected families for person detail card
  const connectedFamilies = useMemo<ConnectedFamily[]>(() => {
    if (!data || !selectedPerson) return [];
    const families: ConnectedFamily[] = [];
    const seen = new Set<string>();

    if (selectedPerson.familyAsChild) {
      const birthFam = data.families.get(selectedPerson.familyAsChild);
      if (birthFam) {
        const fatherId = birthFam.husbandId;
        const motherId = birthFam.wifeId;
        if (fatherId) {
          const father = data.persons.get(fatherId);
          if (father && !seen.has(father.surname)) {
            seen.add(father.surname);
            families.push({ surname: father.surname, role: 'birth' });
          }
        }
        if (motherId) {
          const mother = data.persons.get(motherId);
          if (mother && mother.surname !== selectedPerson.surname && !seen.has(mother.surname)) {
            seen.add(mother.surname);
            families.push({ surname: mother.surname, role: 'birth' });
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
        if (spouse && !seen.has(spouse.surname)) {
          seen.add(spouse.surname);
          families.push({ surname: spouse.surname, role: 'spouse' });
        }
      }
    }

    return families;
  }, [data, selectedPerson]);

  // Relationship calculator
  const [relationshipPersonA, setRelationshipPersonA] = useState<Person | null>(null);
  const [relationshipPersonB, setRelationshipPersonB] = useState<Person | null>(null);
  const [relationshipResult, setRelationshipResult] = useState<string | null>(null);

  // Person form dialog state
  const [personFormOpen, setPersonFormOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);

  // Relationship dialog state
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [relationshipMode, setRelationshipMode] = useState<'marriage' | 'add-child' | 'add-parent' | 'add-sibling' | 'add-godparent'>('marriage');
  const [relationshipAnchor, setRelationshipAnchor] = useState<string | undefined>();

  // Context menu state
  const [contextMenuPerson, setContextMenuPerson] = useState<Person | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  // Auto-load from IndexedDB or bundled data
  useAutoLoad();

  // Build person-centered tree. lastModified included so in-place store mutations
  // (which keep the same `data` reference) still invalidate this memo.
  const treeResult = useMemo(() => {
    if (!data || !centerPersonId) return null;
    return computePersonTree(centerPersonId, data, ancestorDepth, descendantDepth);
  }, [data, lastModified, centerPersonId, ancestorDepth, descendantDepth]);

  const treeElements = treeResult?.elements || [];
  const treePositions = treeResult?.positions || {};

  // Select person from overview
  const handleSelectFromOverview = useCallback((personId: string) => {
    setCenterPersonId(personId);
    setViewMode('tree');
  }, []);

  // Node click — center on person or start relationship
  const handleNodeClick = useCallback((person: Person | null) => {
    setContextMenuPerson(null);
    if (!person) {
      setSelectedPerson(null);
      return;
    }
    setSelectedPerson(person);
  }, []);

  // Shift+click for relationship
  const handleNodeShiftClick = useCallback((person: Person) => {
    if (!relationshipPersonA) {
      setRelationshipPersonA(person);
      setRelationshipPersonB(null);
      setRelationshipResult(null);
    } else if (data) {
      setRelationshipPersonB(person);
      const result = calculateRelationship(relationshipPersonA.id, person.id, data);
      setRelationshipResult(result);
    }
  }, [relationshipPersonA, data]);

  // Re-center on clicked person
  const handleRecenter = useCallback((person: Person) => {
    setCenterPersonId(person.id);
  }, []);

  // Right-click handler
  const handleNodeRightClick = useCallback((person: Person, x: number, y: number) => {
    setContextMenuPerson(person);
    setContextMenuPos({ x, y });
  }, []);

  // Double-click background to add person (disabled in read-only mode)
  const handleBackgroundDblClick = useCallback(() => {
    if (READ_ONLY) return;
    setEditingPerson(null);
    setPersonFormOpen(true);
  }, []);

  // CRUD handlers
  const handleEditPerson = useCallback((person: Person) => {
    const fullPerson = data?.persons.get(person.id);
    setEditingPerson(fullPerson || person);
    setPersonFormOpen(true);
  }, [data]);

  const handleSavePerson = useCallback((personData: Omit<Person, 'id'>) => {
    if (editingPerson) {
      updatePerson(editingPerson.id, personData);
    } else {
      const id = addPerson(personData);
      if (!centerPersonId) setCenterPersonId(id);
    }
    setEditingPerson(null);
  }, [editingPerson, updatePerson, addPerson, centerPersonId]);

  const handleDeleteRequest = useCallback((person: Person) => {
    setPersonToDelete(person);
    setConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (personToDelete) {
      deletePerson(personToDelete.id);
      if (selectedPerson?.id === personToDelete.id) setSelectedPerson(null);
      if (centerPersonId === personToDelete.id) setCenterPersonId(null);
    }
    setPersonToDelete(null);
    setConfirmOpen(false);
  }, [personToDelete, deletePerson, selectedPerson, centerPersonId]);

  const handleAddSpouse = useCallback((person: Person) => {
    setRelationshipAnchor(person.id);
    setRelationshipMode('marriage');
    setRelationshipOpen(true);
  }, []);

  const handleAddChild = useCallback((person: Person) => {
    setRelationshipAnchor(person.id);
    setRelationshipMode('add-child');
    setRelationshipOpen(true);
  }, []);

  const handleAddParent = useCallback((person: Person) => {
    setRelationshipAnchor(person.id);
    setRelationshipMode('add-parent');
    setRelationshipOpen(true);
  }, []);

  const handleAddSibling = useCallback((person: Person) => {
    setRelationshipAnchor(person.id);
    setRelationshipMode('add-sibling');
    setRelationshipOpen(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!READ_ONLY) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
        if (e.key === 'n' || e.key === 'N') {
          if (!personFormOpen && !relationshipOpen && !confirmOpen) {
            e.preventDefault();
            setEditingPerson(null);
            setPersonFormOpen(true);
          }
        }
        if (e.key === 'Delete' && selectedPerson) { e.preventDefault(); handleDeleteRequest(selectedPerson); }
      }
      if (e.key === 'Escape') {
        setRelationshipPersonA(null);
        setRelationshipPersonB(null);
        setRelationshipResult(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, personFormOpen, relationshipOpen, confirmOpen, selectedPerson, handleDeleteRequest]);

  // Loading state
  if (!isLoaded) {
    return (
      <div className="flex flex-col h-screen bg-slate-100">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // No data
  if (!data) {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-b from-slate-50 to-slate-100">
        <AppHeader />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-4xl font-bold text-slate-800 mb-3">Family Tree</h1>
            {READ_ONLY ? (
              <p className="text-lg text-slate-500 mb-8">No family data loaded. Please visit the Name Keeper tab.</p>
            ) : (
              <>
                <p className="text-lg text-slate-500 mb-8">Upload a GEDCOM file or start from scratch</p>
                <GedcomUploader onFileLoaded={(content, name) => loadFromGedcom(content, name)} />
                <div className="mt-4">
                  <button
                    onClick={() => { setEditingPerson(null); setPersonFormOpen(true); }}
                    className="px-6 py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors font-medium shadow-md"
                  >
                    Start from Scratch
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <PersonFormDialog
          open={personFormOpen} person={null}
          onClose={() => setPersonFormOpen(false)}
          onSave={(pd) => { store.loadFromGedcom('0 HEAD\n0 TRLR', 'new-tree.ged'); addPerson(pd); setPersonFormOpen(false); }}
        />
      </div>
    );
  }

  // Overview mode
  if (viewMode === 'overview' || !centerPersonId) {
    return (
      <div className="flex flex-col h-screen bg-slate-50">
        <AppHeader />
        <div className="flex-1 overflow-y-auto">
          <FamilyOverview data={data} onSelectPerson={handleSelectFromOverview} />
        </div>
      </div>
    );
  }

  // Person-centered tree mode
  const centerPerson = data.persons.get(centerPersonId);
  const deleteDetails: string[] = [];
  if (personToDelete && data) {
    for (const fam of data.families.values()) {
      if (fam.husbandId === personToDelete.id || fam.wifeId === personToDelete.id) {
        const spouse = fam.husbandId === personToDelete.id
          ? (fam.wifeId ? data.persons.get(fam.wifeId) : null)
          : (fam.husbandId ? data.persons.get(fam.husbandId) : null);
        if (spouse) deleteDetails.push(`Marriage with ${spouse.givenName} ${spouse.surname}`);
        if (fam.childIds.length > 0) deleteDetails.push(`${fam.childIds.length} child(ren)`);
      }
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      <AppHeader />

      {/* Toolbar */}
      <div className="h-10 bg-white border-b border-slate-200 flex items-center px-4 gap-2 shrink-0">
        <button
          onClick={() => { setViewMode('overview'); setCenterPersonId(null); }}
          className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 rounded-md transition-colors"
        >
          ← All Families
        </button>
        <div className="w-px h-5 bg-slate-200" />
        {centerPerson && (
          <span className="text-xs text-slate-600 font-medium">
            {centerPerson.givenName} {centerPerson.surname}
          </span>
        )}
        <div className="w-px h-5 bg-slate-200" />
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>Ancestors:</span>
          <button onClick={() => setAncestorDepth(d => Math.max(0, d - 1))} className="px-1.5 py-0.5 bg-slate-100 rounded hover:bg-slate-200">-</button>
          <span className="w-4 text-center font-medium">{ancestorDepth}</span>
          <button onClick={() => setAncestorDepth(d => d + 1)} className="px-1.5 py-0.5 bg-slate-100 rounded hover:bg-slate-200">+</button>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>Descendants:</span>
          <button onClick={() => setDescendantDepth(d => Math.max(0, d - 1))} className="px-1.5 py-0.5 bg-slate-100 rounded hover:bg-slate-200">-</button>
          <span className="w-4 text-center font-medium">{descendantDepth}</span>
          <button onClick={() => setDescendantDepth(d => d + 1)} className="px-1.5 py-0.5 bg-slate-100 rounded hover:bg-slate-200">+</button>
        </div>
        <div className="w-px h-5 bg-slate-200" />
        {!READ_ONLY && (
          <button
            onClick={() => { setEditingPerson(null); setPersonFormOpen(true); }}
            className="px-3 py-1 text-xs bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-md transition-colors font-medium"
          >
            + Add Person
          </button>
        )}
        <button
          onClick={() => { setRelationshipPersonA(null); setRelationshipPersonB(null); setRelationshipResult(null); }}
          className={`px-3 py-1 text-xs rounded-md transition-colors font-medium ${
            relationshipPersonA ? 'bg-purple-100 text-purple-700' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          {relationshipPersonA ? 'Cancel Relationship' : 'Show Relationship'}
        </button>
        <div className="flex-1" />
        {!READ_ONLY && (
          <>
            <button onClick={undo} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 rounded" title="Ctrl+Z">Undo</button>
            <button onClick={redo} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 rounded" title="Ctrl+Shift+Z">Redo</button>
          </>
        )}
      </div>

      {/* Relationship mode instruction */}
      {relationshipPersonA && !relationshipPersonB && (
        <div className="h-8 bg-purple-50 border-b border-purple-200 flex items-center justify-center text-xs text-purple-700 shrink-0">
          Click another person to see their relationship to {relationshipPersonA.givenName} {relationshipPersonA.surname}
        </div>
      )}

      {/* Main tree area */}
      <div className="flex-1 relative min-h-0">
        <FullTreeView
          elements={treeElements}
          positions={treePositions}
          onNodeClick={(person) => {
            if (relationshipPersonA && person) {
              handleNodeShiftClick(person);
            } else {
              handleNodeClick(person);
            }
          }}
          onNodeRightClick={handleNodeRightClick}
          onBackgroundDblClick={handleBackgroundDblClick}
          onNodeDoubleClick={handleRecenter}
          selectedPersonId={selectedPerson?.id}
        />

        {/* Relationship badge */}
        {relationshipPersonA && relationshipPersonB && relationshipResult && (
          <RelationshipBadge
            personA={relationshipPersonA}
            personB={relationshipPersonB}
            relationship={relationshipResult}
            onClose={() => { setRelationshipPersonA(null); setRelationshipPersonB(null); setRelationshipResult(null); }}
          />
        )}

        {/* Person detail */}
        {selectedPerson && !contextMenuPerson && !relationshipPersonA && (
          <div className="absolute top-3 right-14 bottom-3 z-10 flex items-start w-80">
            <PersonSidePanel
              person={data.persons.get(selectedPerson.id) || selectedPerson}
              data={data}
              connectedFamilies={connectedFamilies}
              onClose={() => setSelectedPerson(null)}
              onEdit={READ_ONLY ? undefined : () => handleEditPerson(selectedPerson)}
              onAddSpouse={READ_ONLY ? undefined : handleAddSpouse}
              onAddSibling={READ_ONLY ? undefined : handleAddSibling}
              onAddChild={READ_ONLY ? undefined : handleAddChild}
              onAddParent={READ_ONLY ? undefined : handleAddParent}
              onAddGodparent={READ_ONLY ? undefined : (p) => {
                setRelationshipAnchor(p.id);
                setRelationshipMode('add-godparent');
                setRelationshipOpen(true);
              }}
              onRemoveGodparent={READ_ONLY ? undefined : (id, idx) => store.removeGodparent(id, idx)}
              onSelectPerson={(id) => {
                const p = data.persons.get(id);
                if (p) setSelectedPerson(p);
              }}
              onDelete={READ_ONLY ? undefined : handleDeleteRequest}
              onPhotoChange={(id, url) => updatePerson(id, { photoUrl: url })}
              onSetDivorced={(famId, divorced) => store.updateFamily(famId, { divorced: divorced || undefined })}
            />
          </div>
        )}
      </div>

      {/* Context Menu */}
      {!READ_ONLY && (
        <TreeContextMenu
          person={contextMenuPerson}
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          onClose={() => setContextMenuPerson(null)}
          onEdit={handleEditPerson}
          onDelete={handleDeleteRequest}
          onAddSpouse={handleAddSpouse}
          onAddSibling={handleAddSibling}
          onAddChild={handleAddChild}
          onAddParent={handleAddParent}
        />
      )}

      {/* Dialogs */}
      <PersonFormDialog open={personFormOpen} person={editingPerson} onClose={() => { setPersonFormOpen(false); setEditingPerson(null); }} onSave={handleSavePerson} />
      <ConfirmDialog open={confirmOpen} title="Delete Person" message={`Delete ${personToDelete?.givenName} ${personToDelete?.surname}?`} details={deleteDetails} confirmLabel="Delete" confirmVariant="danger" onConfirm={handleConfirmDelete} onCancel={() => { setConfirmOpen(false); setPersonToDelete(null); }} />
      <RelationshipDialog
        open={relationshipOpen}
        mode={relationshipMode}
        anchorPersonId={relationshipAnchor}
        data={data}
        onClose={() => setRelationshipOpen(false)}
      />
    </div>
  );
}
