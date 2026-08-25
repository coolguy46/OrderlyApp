'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { usePlannerStore } from '@/lib/planner/store';
import {
  examsToPlannerInputs,
  readStoredCalendarEvents,
  storedEventsToCommitments,
  tasksToPlannerInputs,
  type StoredCalendarEvent,
} from '@/lib/planner/adapters';

function notificationStorageKey(userId: string): string {
  return `orderly-planner-staleness-notified-${userId}`;
}

/**
 * Marks an active plan stale when loaded app data gains work that was not in
 * the plan snapshot. It only offers a review link; replanning remains an
 * explicit user action inside Planner.
 */
export function PlannerStalenessMonitor() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, tasks, exams, dataLoaded } = useAppStore();
  const plannerRecord = usePlannerStore(state => user ? state.users[user.id] : undefined);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const refreshPlanStaleness = usePlannerStore(state => state.refreshPlanStaleness);
  const plan = plannerRecord?.currentPlan || null;
  const [storedEvents, setStoredEvents] = useState<StoredCalendarEvent[]>([]);
  const [storedEventsReady, setStoredEventsReady] = useState(false);

  useEffect(() => {
    if (!user) return;
    setActiveUser(user.id, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, user?.id]);

  useEffect(() => {
    const refresh = () => {
      setStoredEvents(readStoredCalendarEvents());
      setStoredEventsReady(true);
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('orderly-calendar-events-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('orderly-calendar-events-changed', refresh);
    };
  }, []);

  const taskInputs = useMemo(() => {
    if (!plan) return [];
    return tasksToPlannerInputs(
      tasks.filter(task => task.status !== 'completed'),
      {
        horizonStart: plan.horizonStart,
        horizonDays: plan.settings.horizonDays,
        timeZone: plan.settings.timeZone,
      },
    );
  }, [plan, tasks]);

  const examInputs = useMemo(() => {
    if (!plan) return [];
    const horizonStart = new Date(plan.horizonStart).getTime();
    const eligibleExams = exams.filter(exam => {
      const timestamp = new Date(exam.exam_date).getTime();
      return Number.isFinite(timestamp) && timestamp >= horizonStart;
    });
    return examsToPlannerInputs(eligibleExams, taskInputs);
  }, [exams, plan, taskInputs]);

  const commitments = useMemo(() => {
    if (!plannerRecord || !plan) return [];
    const byId = new Map(
      plannerRecord.commitments
        .filter(commitment => !commitment.id.startsWith('calendar-'))
        .map(commitment => [commitment.id, commitment]),
    );
    storedEventsToCommitments(storedEvents, plan.settings.timeZone)
      .forEach(commitment => byId.set(commitment.id, commitment));
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  }, [plan, plannerRecord, storedEvents]);

  useEffect(() => {
    if (!user || !plannerRecord || !plan || !dataLoaded || !storedEventsReady) return;
    const staleness = refreshPlanStaleness(user.id, {
      tasks: taskInputs,
      exams: examInputs,
      commitments,
      settings: plannerRecord.settings,
      prompt: plan.prompt,
      focusSubjects: plan.focusSubjects || [],
    });
    if (!staleness?.isStale) return;

    const notificationKey = `${plan.id}:${staleness.currentFingerprint}`;
    try {
      if (localStorage.getItem(notificationStorageKey(user.id)) === notificationKey) return;
      localStorage.setItem(notificationStorageKey(user.id), notificationKey);
    } catch {
      // The in-app Planner banner still shows when storage is unavailable.
    }

    if (pathname.startsWith('/planner')) return;
    const changeSummary = staleness.summary
      .filter(item => item !== 'time estimates changed' && item !== 'new timing feedback')
      .join(', ');
    toast.info('Your weekly plan needs a quick review', {
      description: `${changeSummary || 'Your work or availability changed'}. Orderly has not changed your schedule.`,
      duration: 10_000,
      action: {
        label: 'Open Planner',
        onClick: () => router.push('/planner'),
      },
    });
  }, [
    dataLoaded,
    commitments,
    examInputs,
    pathname,
    plan,
    plannerRecord,
    refreshPlanStaleness,
    router,
    storedEventsReady,
    taskInputs,
    user,
  ]);

  return null;
}
