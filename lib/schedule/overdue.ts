import { taskDueAt } from '../task-status.ts';
import { localDateTimeToIso } from './selectors.ts';
import type { ScheduleOccurrence } from './types';

/** Scheduling work does not create or move its deadline. Repeats use their source date. */
export function scheduleOccurrenceDueAt(occurrence: ScheduleOccurrence, timeZone: string): string | null {
  const deadline = taskDueAt(occurrence.task, timeZone);
  if (!deadline) return null;
  if (occurrence.recurrence === 'none') return deadline.toISOString();

  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(deadline).map(part => [part.type, part.value]));
    return localDateTimeToIso(
      occurrence.recurrenceSourceDate,
      `${parts.hour}:${parts.minute}:${parts.second}`,
      timeZone,
    );
  } catch {
    return null;
  }
}

export function isScheduleItemOverdue(
  item: { dueAt?: string | Date | null; completed?: boolean },
  now: Date | number,
): boolean {
  if (item.completed || !item.dueAt) return false;
  return new Date(item.dueAt).getTime() < (typeof now === 'number' ? now : now.getTime());
}
