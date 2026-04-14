'use client';

import { useEffect } from 'react';
import { useFamilyTreeStore } from './store';

/**
 * Auto-load order of precedence:
 *   1. Shared Firestore document (authoritative; the admin's latest save)
 *   2. Local IndexedDB cache (previous session)
 *   3. Bundled /data/family.json (first-ever visit)
 *
 * The first branch that yields data wins. Every visitor hits this on mount.
 */
export function useAutoLoad() {
  const { isLoaded, loadFromRemote, loadFromIndexedDB, loadFromJson } = useFamilyTreeStore();

  useEffect(() => {
    if (isLoaded) return;
    let cancelled = false;

    (async () => {
      // 1. Try the shared Firestore document first
      const remote = await loadFromRemote();
      if (cancelled || remote) return;

      // 2. Fall back to local IndexedDB
      const local = await loadFromIndexedDB();
      if (cancelled || local) return;

      // 3. Fall back to the bundled JSON baseline
      const basePath = process.env.__NEXT_ROUTER_BASEPATH || '';
      try {
        const r = await fetch(`${basePath}/data/family.json`);
        if (!r.ok) return;
        const json = await r.text();
        if (!cancelled) loadFromJson(json, 'family.json');
      } catch {
        // ignore — empty state is fine
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, loadFromRemote, loadFromIndexedDB, loadFromJson]);
}
