/**
 * Build a browser-storage key that cannot be shared by two authenticated users.
 * Returning null for a missing user keeps logged-out screens from reading or
 * writing account-owned data.
 */
export function userScopedStorageKey(
  namespace: string,
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return `${namespace}:${encodeURIComponent(userId)}`;
}

/**
 * Old releases stored some account-owned values under a single global key.
 * Those values have no owner metadata, so assigning them to whichever account
 * happens to sign in next would leak data. Discard them instead of guessing.
 */
export function discardUnownedLegacyStorageValue(
  storage: Pick<Storage, 'removeItem'>,
  legacyKey: string,
): void {
  try {
    storage.removeItem(legacyKey);
  } catch {
    // Storage may be unavailable (for example, in a locked-down browser).
  }
}

/** Remove only values explicitly namespaced to one account. */
export function removeUserScopedStorageValues(
  storage: Pick<Storage, 'key' | 'length' | 'removeItem'>,
  userId: string | null | undefined,
): void {
  if (!userId) return;
  const suffix = `:${encodeURIComponent(userId)}`;
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.endsWith(suffix)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Storage may be unavailable (for example, in a locked-down browser).
  }
}
