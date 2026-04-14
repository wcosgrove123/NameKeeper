'use client';

/**
 * Auth state store — tracks the currently-signed-in Firebase user and
 * exposes an `isAdmin` derived flag that all editing UI gates on.
 *
 * The auth listener is started lazily on first `useAuth()` call in the
 * browser, not at module load, so this file is safe to import in static
 * export contexts.
 */

import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from './firebase-client';
import { ADMIN_UID } from './site-config';

// Module-level cache so every component hook sees the same user without
// thrashing useState initializers.
let _cachedUser: User | null = null;
let _listenerStarted = false;
const _subscribers = new Set<(u: User | null) => void>();

function startListener() {
  if (_listenerStarted) return;
  _listenerStarted = true;
  const auth = getFirebaseAuth();
  onAuthStateChanged(auth, (u) => {
    _cachedUser = u;
    for (const cb of _subscribers) cb(u);
  });
}

export interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
}

/** React hook exposing the current Firebase user + isAdmin flag. */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(_cachedUser);
  const [loading, setLoading] = useState(!_listenerStarted);

  useEffect(() => {
    startListener();
    const cb = (u: User | null) => {
      setUser(u);
      setLoading(false);
    };
    _subscribers.add(cb);
    // If the listener already fired before we subscribed, sync immediately.
    if (_listenerStarted) {
      setUser(_cachedUser);
      setLoading(false);
    }
    return () => {
      _subscribers.delete(cb);
    };
  }, []);

  return {
    user,
    isAdmin: user?.uid === ADMIN_UID,
    loading,
  };
}

/** Sign in with email + password. Throws on failure with a friendly message. */
export async function signIn(email: string, password: string): Promise<User> {
  const auth = getFirebaseAuth();
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      throw new Error('Wrong email or password.');
    }
    if (code === 'auth/user-not-found') {
      throw new Error('No account with that email.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many failed attempts. Try again later.');
    }
    throw new Error('Sign-in failed. Please try again.');
  }
}

export async function signOut(): Promise<void> {
  const auth = getFirebaseAuth();
  await fbSignOut(auth);
}
