'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readStoredCalendarEvents,
  storedCalendarEventsStorageKey,
  type StoredCalendarEvent,
} from './adapters';

interface StoredCalendarEventsSnapshot {
  userId: string | null;
  events: StoredCalendarEvent[];
}

interface CalendarEventsChangedEvent extends Event {
  detail?: { userId?: string };
}

/**
 * Keep calendar-event state tied to the active account. The returned events
 * become empty synchronously during an account switch, before effects run, so
 * the next account never renders the previous account's local data.
 */
export function useStoredCalendarEvents(userId: string | null) {
  const [snapshot, setSnapshot] = useState<StoredCalendarEventsSnapshot>({
    userId: null,
    events: [],
  });

  const events = snapshot.userId === userId ? snapshot.events : [];
  const ready = snapshot.userId === userId;

  const setEvents = useCallback((nextEvents: StoredCalendarEvent[]) => {
    if (!userId) return;
    setSnapshot({ userId, events: nextEvents });
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setSnapshot({ userId: null, events: [] });
      return;
    }

    const refresh = () => {
      setSnapshot({ userId, events: readStoredCalendarEvents(userId) });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage
        && event.key === storedCalendarEventsStorageKey(userId)) refresh();
    };
    const handleCalendarChange = (event: Event) => {
      const changedUserId = (event as CalendarEventsChangedEvent).detail?.userId;
      if (!changedUserId || changedUserId === userId) refresh();
    };

    refresh();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('orderly-calendar-events-changed', handleCalendarChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('orderly-calendar-events-changed', handleCalendarChange);
    };
  }, [userId]);

  return useMemo(() => ({ events, setEvents, ready }), [events, ready, setEvents]);
}
