import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'namekeeper-photos';
const DB_VERSION = 1;
const STORE = 'photos';

export const IDB_PHOTO_PREFIX = 'idb://';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

/** Store a photo blob for a person and return the `idb://<id>` sentinel. */
export async function savePhotoBlob(personId: string, blob: Blob): Promise<string> {
  const db = await getDB();
  await db.put(STORE, blob, personId);
  return `${IDB_PHOTO_PREFIX}${personId}`;
}

export async function getPhotoBlob(personId: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    const blob = (await db.get(STORE, personId)) as Blob | undefined;
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function deletePhotoBlob(personId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE, personId);
  } catch {
    // ignore
  }
}

/**
 * Resolve a `photoUrl` value (either an external URL or `idb://<id>` sentinel)
 * to a browser-usable URL. Caller is responsible for `URL.revokeObjectURL` on
 * returned object URLs when the image is no longer needed.
 */
export async function resolvePhotoUrl(photoUrl: string | undefined): Promise<string | null> {
  if (!photoUrl) return null;
  if (!photoUrl.startsWith(IDB_PHOTO_PREFIX)) return photoUrl;
  const id = photoUrl.slice(IDB_PHOTO_PREFIX.length);
  const blob = await getPhotoBlob(id);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}
