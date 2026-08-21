'use client';

import { useEffect } from 'react';
import { useFamilyTreeStore } from './store';

// Module-level guard: the chain only ever needs to run once per page load,
// even if several pages mount useAutoLoad() while it is still in flight.
let autoLoadStarted = false;

/**
 * Auto-load order of precedence:
 *   1. Shared Firestore document (authoritative; the admin's latest save)
 *   2. Local IndexedDB cache (previous session)
 *   3. Bundled /data/family.json (first-ever visit)
 *
 * The first branch that yields data wins. Every visitor hits this on mount.
 *
 * The store is global, so completing the chain after the mounting component
 * unmounts is harmless — no cancellation flag. (An earlier version cancelled
 * on effect cleanup, but loadFromIndexedDB's miss path sets isLoaded, which
 * re-fired the effect and cancelled the chain before the family.json
 * fallback ever ran, stranding first-time visitors on the loading screen.)
 */
export function useAutoLoad() {
  const { loadFromRemote, loadFromIndexedDB, loadFromJson } = useFamilyTreeStore();

  useEffect(() => {
    if (autoLoadStarted || useFamilyTreeStore.getState().isLoaded) return;
    autoLoadStarted = true;

    (async () => {
      try {
        // 1. Try the shared Firestore document first
        if (await loadFromRemote()) return;

        // 2. Fall back to local IndexedDB
        if (await loadFromIndexedDB()) return;

        // 3. Fall back to the bundled JSON baseline
        const basePath = process.env.__NEXT_ROUTER_BASEPATH || '';
        const r = await fetch(`${basePath}/data/family.json`);
        if (!r.ok) return;
        loadFromJson(await r.text(), 'family.json');
      } catch {
        // ignore — empty state is fine
      }
    })();
  }, [loadFromRemote, loadFromIndexedDB, loadFromJson]);
}
