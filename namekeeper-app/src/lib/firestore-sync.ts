/**
 * Firestore sync layer for the shared family tree.
 *
 * Storage model: a single Firestore document at `family_state/current`
 * holds the entire tree as two arrays (`persons`, `families`) plus audit
 * metadata. Reads are open to the world; writes are gated by security
 * rules to the ADMIN_UID only.
 *
 * Why one document and not one document per person?
 *   - The whole tree is ~200–500 KB serialized, well under Firestore's
 *     1 MB document limit.
 *   - Reads are a single round-trip instead of ~800.
 *   - Writes use the existing store mutation model (mutate → debounced
 *     full-document set) with zero per-person coordination.
 *
 * If the tree ever exceeds 1 MB we split into `family_state/persons` and
 * `family_state/families` as two docs. Not today.
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { getFirebaseDb, FAMILY_DOC_PATH } from './firebase-client';
import type { GedcomData, Person, Family } from './types';

interface RemoteFamilyState {
  persons: Person[];
  families: Family[];
  lastUpdatedBy?: string;
  lastUpdatedAt?: unknown;
}

/**
 * Load the shared family document from Firestore. Returns null if the
 * document doesn't exist yet (first boot, or before the admin has ever
 * saved). Throws on hard network errors so callers can fall back to the
 * local cache / bundled baseline.
 */
export async function loadRemoteFamilyState(): Promise<GedcomData | null> {
  const db = getFirebaseDb();
  const ref = doc(db, FAMILY_DOC_PATH.collection, FAMILY_DOC_PATH.docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const raw = snap.data() as DocumentData & RemoteFamilyState;
  if (!Array.isArray(raw.persons) || !Array.isArray(raw.families)) return null;

  const persons = new Map<string, Person>();
  const families = new Map<string, Family>();
  for (const p of raw.persons) persons.set(p.id, p);
  for (const f of raw.families) families.set(f.id, f);
  return { persons, families };
}

/**
 * Push the current family state to Firestore. Requires the caller to
 * already be authenticated as the admin — the security rules will reject
 * anyone else with `permission-denied`.
 */
export async function saveRemoteFamilyState(
  data: GedcomData,
  adminEmail: string,
): Promise<void> {
  const db = getFirebaseDb();
  const ref = doc(db, FAMILY_DOC_PATH.collection, FAMILY_DOC_PATH.docId);
  const payload: RemoteFamilyState = {
    persons: Array.from(data.persons.values()),
    families: Array.from(data.families.values()),
    lastUpdatedBy: adminEmail,
    lastUpdatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload);
}
