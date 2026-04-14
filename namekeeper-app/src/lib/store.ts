import { create } from 'zustand';
import { Person, Family, GedcomData, GodparentRef } from './types';
import { parseGedcom } from './gedcom-parser';
import { saveFamilyTree, loadFamilyTree, clearFamilyTree } from './db';
import { jsonToGedcomData } from './serialization';
import { migratePass1 } from './migrations/pass1-surname-biography';
import { migratePass2SuffixCleanup } from './migrations/pass2-suffix-cleanup';

export interface NodePosition {
  x: number;
  y: number;
}

interface FamilyTreeState {
  data: GedcomData | null;
  filename: string;
  lastModified: number | null;
  isDirty: boolean;
  isLoaded: boolean;
  undoStack: Array<{ persons: Person[]; families: Family[] }>;
  redoStack: Array<{ persons: Person[]; families: Family[] }>;
  nodePositions: Record<string, Record<string, NodePosition>>; // keyed by surname -> nodeId -> position
}

interface FamilyTreeActions {
  // Loading
  loadFromGedcom: (content: string, filename: string) => void;
  loadFromJson: (json: string, filename: string) => void;
  loadFromIndexedDB: () => Promise<boolean>;
  clearData: () => void;

  // Person CRUD
  addPerson: (person: Omit<Person, 'id'>) => string;
  updatePerson: (id: string, updates: Partial<Person>) => void;
  deletePerson: (id: string) => void;

  // Family CRUD
  addFamily: (family: Omit<Family, 'id'>) => string;
  updateFamily: (id: string, updates: Partial<Family>) => void;
  deleteFamily: (id: string) => void;

  // Relationship helpers
  createMarriage: (
    person1Id: string,
    person2Id: string,
    date?: string,
    place?: string,
    partnerType?: 'current' | 'ex',
  ) => string;
  addChildToFamily: (familyId: string, childId: string) => void;
  removeChildFromFamily: (familyId: string, childId: string) => void;
  setParentChild: (parentId: string, childId: string) => string;
  addSibling: (existingPersonId: string, siblingData: Omit<Person, 'id'>) => string;
  linkSibling: (existingPersonId: string, siblingPersonId: string) => string;
  addGodparent: (godchildId: string, ref: GodparentRef) => void;
  removeGodparent: (godchildId: string, index: number) => void;
  addParents: (
    childId: string,
    fatherData: Omit<Person, 'id'> | null,
    motherData: Omit<Person, 'id'> | null,
    marriageDate?: string,
  ) => { fatherId?: string; motherId?: string; familyId: string };

  // Undo/Redo
  undo: () => void;
  redo: () => void;

  // Node positions
  saveNodePositions: (surname: string, positions: Record<string, NodePosition>) => void;
  getNodePositions: (surname: string) => Record<string, NodePosition> | undefined;
  clearNodePositions: (surname: string) => void;

  // Persistence
  saveToIndexedDB: () => Promise<void>;
}

type FamilyTreeStore = FamilyTreeState & FamilyTreeActions;

function generateId(data: GedcomData, type: 'INDI' | 'FAM'): string {
  const prefix = type === 'INDI' ? 'I' : 'F';
  const map = type === 'INDI' ? data.persons : data.families;
  let max = 0;
  for (const key of map.keys()) {
    const match = key.match(new RegExp(`@${prefix}(\\d+)@`));
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `@${prefix}${max + 1}@`;
}

function snapshotData(data: GedcomData): { persons: Person[]; families: Family[] } {
  return {
    persons: Array.from(data.persons.values()).map(p => ({ ...p, familiesAsSpouse: [...p.familiesAsSpouse], notes: [...p.notes] })),
    families: Array.from(data.families.values()).map(f => ({ ...f, childIds: [...f.childIds] })),
  };
}

function restoreSnapshot(snapshot: { persons: Person[]; families: Family[] }): GedcomData {
  const persons = new Map<string, Person>();
  const families = new Map<string, Family>();
  for (const p of snapshot.persons) persons.set(p.id, { ...p, familiesAsSpouse: [...p.familiesAsSpouse], notes: [...p.notes] });
  for (const f of snapshot.families) families.set(f.id, { ...f, childIds: [...f.childIds] });
  return { persons, families };
}

export const useFamilyTreeStore = create<FamilyTreeStore>((set, get) => {
  // Helper to push undo snapshot before mutation
  function pushUndo() {
    const { data, undoStack } = get();
    if (!data) return;
    const snapshot = snapshotData(data);
    const newStack = [...undoStack, snapshot];
    if (newStack.length > 50) newStack.shift();
    set({ undoStack: newStack, redoStack: [] });
  }

  function markDirty() {
    set({ isDirty: true, lastModified: Date.now() });
  }

  return {
    // State
    data: null,
    filename: '',
    lastModified: null,
    isDirty: false,
    isLoaded: false,
    undoStack: [],
    redoStack: [],
    nodePositions: {},

    // Loading
    loadFromGedcom(content, filename) {
      const data = parseGedcom(content);
      migratePass1(data);
      migratePass2SuffixCleanup(data);
      set({ data, filename, isDirty: false, isLoaded: true, undoStack: [], redoStack: [], lastModified: Date.now() });
      get().saveToIndexedDB();
    },

    loadFromJson(json, filename) {
      const data = jsonToGedcomData(json);
      migratePass1(data);
      migratePass2SuffixCleanup(data);
      set({ data, filename, isDirty: false, isLoaded: true, undoStack: [], redoStack: [], lastModified: Date.now() });
      get().saveToIndexedDB();
    },

    async loadFromIndexedDB() {
      const result = await loadFamilyTree();
      if (result) {
        migratePass1(result.data);
        migratePass2SuffixCleanup(result.data);
        set({ data: result.data, filename: result.filename, lastModified: result.lastModified, isDirty: false, isLoaded: true, undoStack: [], redoStack: [], nodePositions: result.nodePositions || {} });
        return true;
      }
      set({ isLoaded: true });
      return false;
    },

    clearData() {
      set({ data: null, filename: '', isDirty: false, isLoaded: true, undoStack: [], redoStack: [], lastModified: null, nodePositions: {} });
      clearFamilyTree();
    },

    // Person CRUD
    addPerson(personData) {
      const { data } = get();
      if (!data) return '';
      pushUndo();
      const id = generateId(data, 'INDI');
      const person: Person = { ...personData, id };
      data.persons.set(id, person);
      markDirty();
      return id;
    },

    updatePerson(id, updates) {
      const { data } = get();
      if (!data) return;
      const person = data.persons.get(id);
      if (!person) return;
      pushUndo();
      Object.assign(person, updates);
      markDirty();
    },

    deletePerson(id) {
      const { data } = get();
      if (!data) return;
      pushUndo();

      // Remove from all families
      for (const [famId, family] of data.families) {
        if (family.husbandId === id) family.husbandId = undefined;
        if (family.wifeId === id) family.wifeId = undefined;
        family.childIds = family.childIds.filter(cid => cid !== id);

        // Remove empty families
        if (!family.husbandId && !family.wifeId && family.childIds.length === 0) {
          // Clean up references to this family from other people
          for (const p of data.persons.values()) {
            p.familiesAsSpouse = p.familiesAsSpouse.filter(fid => fid !== famId);
            if (p.familyAsChild === famId) p.familyAsChild = undefined;
          }
          data.families.delete(famId);
        }
      }

      data.persons.delete(id);
      markDirty();
    },

    // Family CRUD
    addFamily(familyData) {
      const { data } = get();
      if (!data) return '';
      pushUndo();
      const id = generateId(data, 'FAM');
      const family: Family = { ...familyData, id };
      data.families.set(id, family);
      markDirty();
      return id;
    },

    updateFamily(id, updates) {
      const { data } = get();
      if (!data) return;
      const family = data.families.get(id);
      if (!family) return;
      pushUndo();
      Object.assign(family, updates);
      markDirty();
    },

    deleteFamily(id) {
      const { data } = get();
      if (!data) return;
      pushUndo();

      // Clean up person references
      for (const person of data.persons.values()) {
        person.familiesAsSpouse = person.familiesAsSpouse.filter(fid => fid !== id);
        if (person.familyAsChild === id) person.familyAsChild = undefined;
      }

      data.families.delete(id);
      markDirty();
    },

    // Relationship helpers
    createMarriage(person1Id, person2Id, date, place, partnerType) {
      const { data, addFamily } = get();
      if (!data) return '';

      const p1 = data.persons.get(person1Id);
      const p2 = data.persons.get(person2Id);
      if (!p1 || !p2) return '';

      // Determine husband/wife based on sex
      let husbandId = person1Id;
      let wifeId = person2Id;
      if (p1.sex === 'F' && p2.sex === 'M') {
        husbandId = person2Id;
        wifeId = person1Id;
      }

      const famId = addFamily({
        husbandId,
        wifeId,
        childIds: [],
        marriageDate: date,
        marriagePlace: place,
        divorced: partnerType === 'ex' ? true : undefined,
      });

      // Update person references
      const husband = data.persons.get(husbandId);
      const wife = data.persons.get(wifeId);
      if (husband) husband.familiesAsSpouse.push(famId);
      if (wife) wife.familiesAsSpouse.push(famId);

      return famId;
    },

    addGodparent(godchildId, ref) {
      const { data } = get();
      if (!data) return;
      const child = data.persons.get(godchildId);
      if (!child) return;
      pushUndo();
      const list = child.godparents ? [...child.godparents] : [];
      list.push(ref);
      child.godparents = list;
      markDirty();
    },

    removeGodparent(godchildId, index) {
      const { data } = get();
      if (!data) return;
      const child = data.persons.get(godchildId);
      if (!child?.godparents) return;
      pushUndo();
      child.godparents = child.godparents.filter((_, i) => i !== index);
      if (child.godparents.length === 0) child.godparents = undefined;
      markDirty();
    },

    linkSibling(existingPersonId, siblingPersonId) {
      const { data, addFamily, addChildToFamily } = get();
      if (!data) return '';
      const existing = data.persons.get(existingPersonId);
      const sibling = data.persons.get(siblingPersonId);
      if (!existing || !sibling) return '';

      let familyId = existing.familyAsChild;
      if (!familyId) {
        familyId = addFamily({ childIds: [] });
        const refreshed = get().data;
        if (refreshed) {
          const ex = refreshed.persons.get(existingPersonId);
          const fam = refreshed.families.get(familyId);
          if (ex && fam) {
            ex.familyAsChild = familyId;
            if (!fam.childIds.includes(existingPersonId)) fam.childIds.push(existingPersonId);
          }
        }
      }
      addChildToFamily(familyId, siblingPersonId);
      return familyId;
    },

    addSibling(existingPersonId, siblingData) {
      const { data, addPerson, addChildToFamily, addFamily } = get();
      if (!data) return '';
      const existing = data.persons.get(existingPersonId);
      if (!existing) return '';

      // Reuse the existing person's birth family if any, otherwise create a
      // placeholder family so both siblings share parents.
      let familyId = existing.familyAsChild;
      if (!familyId) {
        familyId = addFamily({ childIds: [] });
        // Re-fetch after the family was created to mutate consistently
        const refreshed = get().data?.persons.get(existingPersonId);
        if (refreshed) {
          refreshed.familyAsChild = familyId;
          const fam = get().data?.families.get(familyId);
          if (fam && !fam.childIds.includes(existingPersonId)) {
            fam.childIds.push(existingPersonId);
          }
        }
      }

      const newId = addPerson(siblingData);
      addChildToFamily(familyId, newId);
      return newId;
    },

    addParents(childId, fatherData, motherData, marriageDate) {
      const { data, addPerson, addFamily, addChildToFamily } = get();
      if (!data) return { familyId: '' };
      const child = data.persons.get(childId);
      if (!child) return { familyId: '' };

      const fatherId = fatherData ? addPerson({ ...fatherData, sex: 'M' }) : undefined;
      const motherId = motherData ? addPerson({ ...motherData, sex: 'F' }) : undefined;

      const familyId = addFamily({
        husbandId: fatherId,
        wifeId: motherId,
        childIds: [],
        marriageDate,
      });

      // Link parent → family back-references
      const refreshed = get().data;
      if (refreshed) {
        if (fatherId) refreshed.persons.get(fatherId)?.familiesAsSpouse.push(familyId);
        if (motherId) refreshed.persons.get(motherId)?.familiesAsSpouse.push(familyId);
      }

      addChildToFamily(familyId, childId);
      return { fatherId, motherId, familyId };
    },

    addChildToFamily(familyId, childId) {
      const { data } = get();
      if (!data) return;
      const family = data.families.get(familyId);
      const child = data.persons.get(childId);
      if (!family || !child) return;
      pushUndo();

      if (!family.childIds.includes(childId)) {
        family.childIds.push(childId);
      }
      child.familyAsChild = familyId;
      markDirty();
    },

    removeChildFromFamily(familyId, childId) {
      const { data } = get();
      if (!data) return;
      const family = data.families.get(familyId);
      const child = data.persons.get(childId);
      if (!family || !child) return;
      pushUndo();

      family.childIds = family.childIds.filter(id => id !== childId);
      if (child.familyAsChild === familyId) child.familyAsChild = undefined;
      markDirty();
    },

    setParentChild(parentId, childId) {
      const { data } = get();
      if (!data) return '';
      const parent = data.persons.get(parentId);
      const child = data.persons.get(childId);
      if (!parent || !child) return '';

      // Find or create a family where this parent is a spouse
      let familyId = '';
      for (const famId of parent.familiesAsSpouse) {
        const fam = data.families.get(famId);
        if (fam) {
          familyId = famId;
          break;
        }
      }

      if (!familyId) {
        // Create a new family with just this parent
        const isHusband = parent.sex === 'M';
        familyId = get().addFamily({
          husbandId: isHusband ? parentId : undefined,
          wifeId: isHusband ? undefined : parentId,
          childIds: [],
        });
        parent.familiesAsSpouse.push(familyId);
      }

      get().addChildToFamily(familyId, childId);
      return familyId;
    },

    // Node positions
    saveNodePositions(surname, positions) {
      const { nodePositions } = get();
      set({ nodePositions: { ...nodePositions, [surname]: positions } });
    },

    getNodePositions(surname) {
      return get().nodePositions[surname];
    },

    clearNodePositions(surname) {
      const { nodePositions } = get();
      const updated = { ...nodePositions };
      delete updated[surname];
      set({ nodePositions: updated });
    },

    // Undo/Redo
    undo() {
      const { data, undoStack, redoStack } = get();
      if (undoStack.length === 0 || !data) return;

      const currentSnapshot = snapshotData(data);
      const previousSnapshot = undoStack[undoStack.length - 1];
      const restored = restoreSnapshot(previousSnapshot);

      set({
        data: restored,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, currentSnapshot],
        isDirty: true,
        lastModified: Date.now(),
      });
    },

    redo() {
      const { data, undoStack, redoStack } = get();
      if (redoStack.length === 0 || !data) return;

      const currentSnapshot = snapshotData(data);
      const nextSnapshot = redoStack[redoStack.length - 1];
      const restored = restoreSnapshot(nextSnapshot);

      set({
        data: restored,
        undoStack: [...undoStack, currentSnapshot],
        redoStack: redoStack.slice(0, -1),
        isDirty: true,
        lastModified: Date.now(),
      });
    },

    // Persistence
    async saveToIndexedDB() {
      const { data, filename, nodePositions } = get();
      if (!data) return;
      await saveFamilyTree(data, filename, nodePositions);
      set({ isDirty: false });
    },
  };
});

// Auto-save to IndexedDB on changes (debounced 2s)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
useFamilyTreeStore.subscribe((state) => {
  if (state.isDirty && state.data) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      state.saveToIndexedDB();
    }, 2000);
  }
});
