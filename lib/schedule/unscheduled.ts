import type { Task } from '@/lib/supabase/types';
import type { ScheduleEntry } from './types';

/** Return every pending task that does not yet have schedule metadata. */
export function selectUnscheduledTasks(
  tasks: readonly Task[],
  entries: readonly Pick<ScheduleEntry, 'taskId' | 'scheduledDate' | 'startAt'>[],
): Task[] {
  // Duration is useful metadata, but it is not a placement. An undated task
  // with only an estimate must stay on the unscheduled shelf so the user can
  // still drag it into the calendar.
  const scheduledTaskIds = new Set(entries
    .filter(entry => Boolean(entry.scheduledDate || entry.startAt))
    .map(entry => entry.taskId));
  return tasks.filter(task => task.status !== 'completed' && !scheduledTaskIds.has(task.id));
}
