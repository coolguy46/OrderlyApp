'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { usePlannerStore } from '@/lib/planner/store';
import { useScheduleStore } from '@/lib/schedule/store';
import { localDateFromIso, selectScheduleEntriesForUser } from '@/lib/schedule/selectors';
import { buildVisibleScheduleOccurrences, visibleCommitmentOccurrences } from '@/lib/schedule/visible-intervals';
import { collectAppReminders, createReminderScheduler, deliverUnseenReminders, reminderSummaryBody } from '@/lib/reminders';
import { NOTIFICATION_PREFERENCES_CHANGED, readNotificationPreferences } from '@/lib/notification-preferences';
import { sendDesktopNotification } from '@/lib/notifications';
import { userScopedStorageKey } from '@/lib/user-scoped-storage';

/** Reminders run only while the signed-in app is open; no delivery service is implied. */
export function AppReminders() {
  const router = useRouter();
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      const state = useAppStore.getState();
      if (!state.user?.id || !state.dataLoaded || state.isLoading) return;
      const userId = state.user.id;
      const preferences = readNotificationPreferences(userId);
      const planner = usePlannerStore.getState().users[userId];
      const timeZone = planner?.settings.timeZone
        || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const key = userScopedStorageKey('orderly-reminders-seen', userId);
      if (!key) return;
      const now = new Date();
      const date = localDateFromIso(now.toISOString(), timeZone);
      const schedule = date && preferences.dailyDigest ? buildVisibleScheduleOccurrences({
        tasks: state.tasks.filter(task => task.user_id === userId),
        entries: selectScheduleEntriesForUser(useScheduleStore.getState().entriesByUser, userId),
        startDate: date, endDate: date, timeZone,
      }) : null;
      const eventCount = date && preferences.dailyDigest ? (planner?.commitments || [])
        .flatMap(event => visibleCommitmentOccurrences(event, date, date, timeZone)).length : 0;
      const reminders = collectAppReminders({ ...state, userId, preferences, timeZone, now,
        scheduledWorkCount: schedule?.timed.length || 0, eventCount });
      let storage: Storage;
      try { storage = localStorage; } catch { return; }
      const fresh = deliverUnseenReminders(storage, key, reminders, now.getTime(), items => {
        const single = items.length === 1 ? items[0] : null;
        toast(single?.title || `${items.length} Orderly reminders`, {
          description: reminderSummaryBody(items), duration: 12_000,
          action: { label: single ? 'View' : 'Dashboard', onClick: () => router.push(single?.href || '/') },
        });
      });
      if (!fresh.length) return;
      const single = fresh.length === 1 ? fresh[0] : null;
      const title = single?.title || `${fresh.length} Orderly reminders`;
      const body = reminderSummaryBody(fresh);
      // User opts into browser permission separately. Muting suppresses native notification sounds too.
      sendDesktopNotification(title, { body, tag: `orderly-reminders-${userId}`, silent: !preferences.soundEnabled });
    };
    const scheduler = createReminderScheduler(check);
    let owner = useAppStore.getState().user?.id;
    const delay = window.setTimeout(scheduler.immediate, 1_000);
    const interval = window.setInterval(scheduler.immediate, 60_000);
    const unsubscribe = useAppStore.subscribe(state => {
      if (state.user?.id !== owner) { owner = state.user?.id; scheduler.immediate(); }
      else scheduler.schedule();
    });
    window.addEventListener('focus', scheduler.immediate);
    window.addEventListener('storage', scheduler.schedule);
    window.addEventListener(NOTIFICATION_PREFERENCES_CHANGED, scheduler.immediate);
    document.addEventListener('visibilitychange', scheduler.immediate);
    return () => {
      clearTimeout(delay); clearInterval(interval); unsubscribe(); scheduler.cancel();
      window.removeEventListener('focus', scheduler.immediate);
      window.removeEventListener('storage', scheduler.schedule);
      window.removeEventListener(NOTIFICATION_PREFERENCES_CHANGED, scheduler.immediate);
      document.removeEventListener('visibilitychange', scheduler.immediate);
    };
  }, [router]);
  return null;
}
