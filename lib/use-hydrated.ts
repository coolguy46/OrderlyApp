'use client';

import { useSyncExternalStore } from 'react';

const subscribeToHydration = () => () => undefined;

/** Hydration-safe browser readiness without a cascading mount effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

/** Subscribe to a media query without maintaining a duplicate state value. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener('change', onStoreChange);
      return () => mediaQuery.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
