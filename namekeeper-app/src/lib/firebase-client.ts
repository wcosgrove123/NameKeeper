/**
 * Firebase client initialization.
 *
 * This app uses:
 *   - Firebase Auth (email/password) to identify the master editor
 *   - Cloud Firestore to store the shared canonical family_state document
 *
 * Everything happens client-side — no server. The API key in `firebaseConfig`
 * is safe to commit and ship to the browser because access is gated by the
 * Firestore security rules in `firestore.rules`, not by the config itself.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAypgBLdt7a_0VLJYlv3pQJDLqUD09x_W4',
  authDomain: 'namekeeper-662ce.firebaseapp.com',
  projectId: 'namekeeper-662ce',
  storageBucket: 'namekeeper-662ce.firebasestorage.app',
  messagingSenderId: '645110193466',
  appId: '1:645110193466:web:1c0b3863d97f222c060403',
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

/**
 * Lazy getter so this module is safe to import in server components / static
 * export contexts. The actual SDK only instantiates when something asks for it
 * in the browser.
 */
function ensure(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!_app) {
    _app = getApps()[0] ?? initializeApp(firebaseConfig);
    _auth = getAuth(_app);
    _db = getFirestore(_app);
  }
  return { app: _app, auth: _auth!, db: _db! };
}

export function getFirebaseAuth(): Auth {
  return ensure().auth;
}

export function getFirebaseDb(): Firestore {
  return ensure().db;
}

/** The single Firestore document that holds the entire shared family state. */
export const FAMILY_DOC_PATH = { collection: 'family_state', docId: 'current' } as const;
