'use client';

import { useEffect } from 'react';
import { useFamilyTreeStore } from './store';
import { READ_ONLY } from './site-config';

/**
 * Auto-loads data from IndexedDB, or from bundled /data/family.json in read-only mode.
 * Call this in any page that needs family data on mount.
 */
export function useAutoLoad() {
  const { isLoaded, loadFromIndexedDB, loadFromJson } = useFamilyTreeStore();

  useEffect(() => {
    if (!isLoaded) {
      loadFromIndexedDB().then((loaded) => {
        if (!loaded && READ_ONLY) {
          // Use basePath-relative URL so it works on GitHub Pages (/NameKeeper/data/...)
          const basePath = process.env.__NEXT_ROUTER_BASEPATH || '';
          fetch(`${basePath}/data/family.json`)
            .then(r => r.ok ? r.text() : null)
            .then(json => { if (json) loadFromJson(json, 'family.json'); })
            .catch(() => {});
        }
      });
    }
  }, [isLoaded, loadFromIndexedDB, loadFromJson]);
}
