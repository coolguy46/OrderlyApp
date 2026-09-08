import type { Exam, Goal, StudySession, Task } from './supabase/types.ts';
import type { NotificationPreferences } from './notification-preferences.ts';
import { taskDueAt } from './task-status.ts';
import { civilDateDayDistance } from './civil-date.ts';
import { examTemporalStatus, examRepresentsTask } from './exam-status.ts';
import { isGoalComplete } from './goal-status.ts';
import { localDateFromIso } from './schedule/selectors.ts';

export interface AppReminder { id: string; title: string; body: string; href: string }

/** No timers or provider calls: derive reminders from the current owner's live data. */
export function collectAppReminders(input: {
  userId: string; tasks: readonly Task[]; exams: readonly Exam[]; goals: readonly Goal[];
  studySessions: readonly StudySession[]; activeStudySeconds: number;
  preferences: NotificationPreferences; timeZone: string; now: Date;
  scheduledWorkCount?: number; eventCount?: number;
}): AppReminder[] {
  const { userId, preferences, timeZone, now } = input;
  const date = localDateFromIso(now.toISOString(), timeZone);
  if (!date || !userId) return [];
  const tasks = input.tasks.filter(item => item.user_id === userId && item.status !== 'completed');
  const reminders: AppReminder[] = [];
  if (preferences.taskReminders) {
    for (const task of tasks) {
      const due = taskDueAt(task, timeZone);
      if (!due) continue;
      const remaining = due.getTime() - now.getTime();
      if (remaining < 0 || remaining > 30 * 60_000) continue;
      reminders.push({ id: `task:${task.id}:${due.toISOString()}`, title: 'Task due soon',
        body: `${task.title} is due ${remaining < 60_000 ? 'now' : `in ${Math.ceil(remaining / 60_000)} minutes`}.`, href: '/tasks' });
    }
  }
  if (preferences.examReminders) {
    for (const exam of input.exams.filter(item => item.user_id === userId)) {
      const days = civilDateDayDistance(exam.exam_date, now, timeZone);
      if (days === null || days < 0 || days > 1 || examTemporalStatus(exam, now, timeZone) !== 'upcoming') continue;
      // Do not revive a completed provider assignment as a reminder through its exam mirror.
      if (input.tasks.some(task => task.user_id === userId && task.status === 'completed' && examRepresentsTask(exam, task, timeZone))) continue;
      reminders.push({ id: `exam:${exam.id}:${exam.exam_date}:${date}`, title: 'Upcoming exam',
        body: `${exam.title} is ${days === 0 ? 'today' : 'tomorrow'}.`, href: '/exams' });
    }
  }
  if (preferences.goalDeadlines) {
    for (const goal of input.goals.filter(item => item.user_id === userId && item.status === 'active' && !isGoalComplete(item))) {
      const days = civilDateDayDistance(goal.deadline, now, timeZone);
      if (days === null || days < 0 || days > 1) continue;
      reminders.push({ id: `goal:${goal.id}:${goal.deadline}:${date}`, title: 'Goal deadline approaching',
        body: `${goal.title} has a deadline ${days === 0 ? 'today' : 'tomorrow'}.`, href: '/goals' });
    }
  }
  if (preferences.studyReminders && input.activeStudySeconds === 0 && !input.studySessions.some(session =>
    session.user_id === userId && session.duration_minutes > 0 && localDateFromIso(session.started_at, timeZone) === date)) {
    reminders.push({ id: `study:${date}`, title: 'Make time to study', body: 'No study time logged today yet. Start a focus session when you are ready.', href: '/study' });
  }
  if (preferences.dailyDigest) {
    const dueToday = tasks.filter(task => {
      const due = taskDueAt(task, timeZone);
      return due && localDateFromIso(due.toISOString(), timeZone) === date;
    }).length;
    const overdue = tasks.filter(task => (taskDueAt(task, timeZone)?.getTime() ?? Infinity) < now.getTime()).length;
    reminders.push({ id: `digest:${date}`, title: 'Your daily summary',
      body: `${dueToday} unfinished task${dueToday === 1 ? '' : 's'} due today · ${overdue} overdue overall. On your schedule: ${input.scheduledWorkCount || 0} work sessions and ${input.eventCount || 0} events.`, href: '/' });
  }
  return reminders;
}

/** Batch the ledger read/write, recording IDs only after their summary is delivered. */
export function deliverUnseenReminders(
  storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, reminders: AppReminder[], now: number,
  deliver: (fresh: AppReminder[]) => void,
): AppReminder[] {
  try {
    let raw: unknown = {};
    try { raw = JSON.parse(storage.getItem(key) || '{}'); } catch { /* Recover a corrupt ledger. */ }
    const recent: Record<string, number> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [entry, timestamp] of Object.entries(raw)) {
        if (typeof timestamp === 'number' && timestamp <= now && timestamp > now - 7 * 86_400_000) recent[entry] = timestamp;
      }
    }
    const fresh = reminders.filter(reminder => recent[reminder.id] === undefined);
    if (!fresh.length) return [];
    deliver(fresh);
    fresh.forEach(reminder => { recent[reminder.id] = now; });
    storage.setItem(key, JSON.stringify(recent));
    return fresh;
  } catch {
    return [];
  }
}

export function claimReminder(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, id: string, now: number): boolean {
  return deliverUnseenReminders(storage, key, [{ id, title: '', body: '', href: '/' }], now, () => {}).length === 1;
}

export function reminderSummaryBody(reminders: AppReminder[]): string {
  const shorten = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  if (reminders.length === 1) return shorten(reminders[0].body, 420);
  const lines = reminders.slice(0, 3).map(item => shorten(item.body, 220));
  if (reminders.length > 3) lines.push(`+ ${reminders.length - 3} more reminders. Open your dashboard to review them.`);
  return lines.join('\n');
}

/** Frequent timer/store ticks share one trailing scan, while user actions can refresh now. */
export function createReminderScheduler(check: () => void, delayMs = 30_000) {
  let lastRunAt = -Infinity;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => { if (pending !== null) clearTimeout(pending); pending = null; };
  const immediate = () => { cancel(); lastRunAt = Date.now(); check(); };
  const schedule = () => {
    const remaining = delayMs - (Date.now() - lastRunAt);
    if (remaining <= 0) immediate();
    else if (pending === null) pending = setTimeout(immediate, remaining);
  };
  return { immediate, schedule, cancel };
}
