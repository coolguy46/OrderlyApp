import { clearAuthCookiesAtScopes, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

interface BrowserAuthStorage {
  document: { cookie: string };
  localStorage: Pick<Storage, 'key' | 'length' | 'removeItem'>;
  sessionStorage: Pick<Storage, 'key' | 'length' | 'removeItem'>;
}

/** Same default namespace as SupabaseClient; never clear another project's auth. */
export function supabaseAuthStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/**
 * Last-resort local cleanup uses SSR's public cookie API, including chunked
 * sessions and PKCE slots. It does not claim remote refresh-token revocation.
 * Callers must fully reload afterwards to discard outstanding SDK callbacks.
 */
export async function clearCurrentProjectAuthStorage(
  supabaseUrl: string,
  browser: BrowserAuthStorage,
): Promise<void> {
  const storageKey = supabaseAuthStorageKey(supabaseUrl);
  const belongsToProject = (name: string) => name === storageKey
    || name.startsWith(`${storageKey}.`) || name.startsWith(`${storageKey}-`);
  const getAll = () => parseCookieHeader(browser.document.cookie).map(({ name, value }) => ({ name, value: value ?? '' }));
  const bases = new Set(getAll().filter(({ name }) => belongsToProject(name))
    .map(({ name }) => name.replace(/\.\d+$/, '')));
  for (const base of bases) {
    await clearAuthCookiesAtScopes({
      storageKey: base,
      scopes: [{ path: '/' }],
      getAll,
      setAll: cookies => {
        for (const { name, value, options } of cookies) {
          browser.document.cookie = serializeCookieHeader(name, value, options);
        }
      },
    });
  }
  if (getAll().some(({ name }) => belongsToProject(name))) {
    throw new Error('The browser could not clear its sign-in cookies. Close this browser before sharing the device.');
  }
  for (const storage of [browser.localStorage, browser.sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key && belongsToProject(key)) storage.removeItem(key);
  }
}

/** Bound the actual logout request, not only the UI's wait for the SDK. */
export function withLogoutTransportDeadline(
  fetcher: typeof fetch,
  supabaseUrl: string,
  timeoutMs = 7_000,
): typeof fetch {
  const origin = new URL(supabaseUrl).origin;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.origin !== origin || url.pathname !== '/auth/v1/logout' || method.toUpperCase() !== 'POST') {
      return fetcher(input, init);
    }
    const controller = new AbortController();
    const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    originalSignal?.addEventListener('abort', abort, { once: true });
    if (originalSignal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DOMException('Sign-out request timed out', 'AbortError'));
      }, timeoutMs);
    });
    try {
      return await Promise.race([fetcher(input, { ...init, signal: controller.signal }), deadline]);
    } finally {
      clearTimeout(timer);
      originalSignal?.removeEventListener('abort', abort);
    }
  };
}

export interface BrowserSignOutResult { remoteConfirmed: boolean; requiresReload: boolean }

export async function signOutWithLocalFallback(
  auth: { signOut(): Promise<{ error: unknown }> },
  clearLocalSession: () => Promise<void>,
  timeoutMs = 15_000,
): Promise<BrowserSignOutResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Sign-out did not finish')), timeoutMs);
    });
    const { error } = await Promise.race([auth.signOut(), deadline]);
    if (error) throw error;
    return { remoteConfirmed: true, requiresReload: false };
  } catch {
    await clearLocalSession();
    return { remoteConfirmed: false, requiresReload: true };
  } finally {
    clearTimeout(timer);
  }
}
