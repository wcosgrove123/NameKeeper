import { openDB, type IDBPDatabase } from 'idb';
import { Person, Family, GedcomData } from './types';
import type { NodePosition } from './store';

interface StoredTree {
  id: string;
  persons: Person[];
  families: Family[];
  filename: string;
  lastModified: number;
  nodePositions?: Record<string, Record<string, NodePosition>>;
}

const DB_NAME = 'namekeeper-db';
const DB_VERSION = 1;
const STORE_NAME = 'trees';
const CURRENT_KEY = 'current';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveFamilyTree(
  data: GedcomData,
  filename: string,
  nodePositions?: Record<string, Record<string, NodePosition>>
): Promise<void> {
  const db = await getDB();
  const record: StoredTree = {
    id: CURRENT_KEY,
    persons: Array.from(data.persons.values()),
    families: Array.from(data.families.values()),
    filename,
    lastModified: Date.now(),
    nodePositions,
  };
  await db.put(STORE_NAME, record);
}

export async function loadFamilyTree(): Promise<{
  data: GedcomData;
  filename: string;
  lastModified: number;
  nodePositions?: Record<string, Record<string, NodePosition>>;
} | null> {
  try {
    const db = await getDB();
    const record: StoredTree | undefined = await db.get(STORE_NAME, CURRENT_KEY);
    if (!record || !record.persons?.length) return null;

    const persons = new Map<string, Person>();
    const families = new Map<string, Family>();

    for (const p of record.persons) persons.set(p.id, p);
    for (const f of record.families) families.set(f.id, f);

    return {
      data: { persons, families },
      filename: record.filename,
      lastModified: record.lastModified,
      nodePositions: record.nodePositions,
    };
  } catch {
    return null;
  }
}

export async function clearFamilyTree(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, CURRENT_KEY);
  } catch {
    // ignore
  }
}
