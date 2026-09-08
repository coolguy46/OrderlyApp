import { userScopedStorageKey } from './user-scoped-storage.ts';

export interface NotificationPreferences {
  taskReminders: boolean;
  examReminders: boolean;
  studyReminders: boolean;
  goalDeadlines: boolean;
  dailyDigest: boolean;
  soundEnabled: boolean;
}

export const defaultNotificationPrefs: NotificationPreferences = {
  taskReminders: true, examReminders: true, studyReminders: false,
  goalDeadlines: true, dailyDigest: false, soundEnabled: true,
};
export const NOTIFICATION_PREFERENCES_CHANGED = 'orderly-notification-preferences-changed';

export function parseNotificationPreferences(value: unknown): NotificationPreferences {
  const result = { ...defaultNotificationPrefs };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of Object.keys(result) as (keyof NotificationPreferences)[]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'boolean') result[key] = candidate;
  }
  return result;
}

export function readNotificationPreferences(userId: string): NotificationPreferences {
  try {
    const key = userScopedStorageKey('orderly-notification-prefs', userId);
    const raw = key && typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? parseNotificationPreferences(JSON.parse(raw)) : { ...defaultNotificationPrefs };
  } catch {
    return { ...defaultNotificationPrefs };
  }
}

export function saveNotificationPreferences(userId: string, preferences: NotificationPreferences): boolean {
  try {
    const key = userScopedStorageKey('orderly-notification-prefs', userId);
    if (!key || typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(parseNotificationPreferences(preferences)));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATION_PREFERENCES_CHANGED));
    return true;
  } catch {
    return false;
  }
}
