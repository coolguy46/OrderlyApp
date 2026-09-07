import { userScopedStorageKey } from './user-scoped-storage.ts';

export const TUTORIAL_STORAGE_NAMESPACE = 'orderly-tutorial-v1';
export interface TutorialProgress {
  current: string | null;
  visited: string[];
  dismissed: boolean;
  completed: boolean;
}
export function emptyTutorialProgress(): TutorialProgress {
  return { current: null, visited: [], dismissed: false, completed: false };
}
export function tutorialStorageKey(userId: string | null | undefined): string | null {
  return userScopedStorageKey(TUTORIAL_STORAGE_NAMESPACE, userId);
}
export function parseTutorialProgress(raw: string | null, sectionIds: readonly string[]): TutorialProgress {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyTutorialProgress();
    return {
      current: typeof value.current === 'string' && sectionIds.includes(value.current) ? value.current : null,
      visited: Array.isArray(value.visited) ? [...new Set<string>((value.visited as unknown[]).filter((id): id is string => typeof id === 'string' && sectionIds.includes(id)))] : [],
      dismissed: value.dismissed === true,
      completed: value.completed === true,
    };
  } catch { return emptyTutorialProgress(); }
}
