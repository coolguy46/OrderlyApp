import type { Task } from './supabase/types.ts';
import { isTaskMissing, taskDueAt } from './task-status.ts';
import {
  localDateFromIso,
  taskDeadlineDate,
  taskUntimedDisplayDate,
  type TaskUntimedDisplayDateOptions,
} from './schedule/selectors.ts';
import type { LocalDate } from './schedule/types.ts';

function localDayOfWeek(value: LocalDate): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function recurringTaskOccursOn(task: Task, date: LocalDate, timeZone?: string): boolean {
  if (!task.recurrence || task.recurrence === 'none' || task.status === 'completed') return false;

  const anchor = task.due_date
    ? localDateFromIso(task.due_date, timeZone)
    : localDateFromIso(task.created_at, timeZone);
  if (!anchor || date < anchor) return false;
  if (task.due_date && localDateFromIso(task.due_date, timeZone) === date) return false;

  if (task.recurrence === 'daily') return true;
  if (task.recurrence === 'weekly') {
    const recurrenceDays = task.recurrence_days?.length
      ? task.recurrence_days
      : [localDayOfWeek(anchor)];
    return recurrenceDays.includes(localDayOfWeek(date));
  }
  return task.recurrence === 'monthly' && anchor.slice(8, 10) === date.slice(8, 10);
}

/**
 * Select the work that belongs on one dashboard day.
 *
 * Imported work due during school is surfaced one day early. A task that
 * passes its deadline today remains in today's list until local midnight;
 * older unfinished work is kept out of this list and belongs in Missing.
 */
export function selectDashboardTasksForDate(
  tasks: readonly Task[],
  date: LocalDate,
  now: Date,
  options: TaskUntimedDisplayDateOptions,
): Task[] {
  return tasks
    .filter(task => {
      if (isTaskMissing(task, now, options.timeZone)) {
        return taskDeadlineDate(task, options.timeZone) === date;
      }
      if (task.due_date && taskUntimedDisplayDate(task, options) === date) return true;
      return recurringTaskOccursOn(task, date, options.timeZone);
    })
    .sort((left, right) => {
      const leftDue = taskDueAt(left, options.timeZone)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightDue = taskDueAt(right, options.timeZone)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue || left.title.localeCompare(right.title);
    });
}
