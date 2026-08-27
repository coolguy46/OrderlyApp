import type { Task } from './supabase/types.ts';
import { isTaskMissing, taskDueAt } from './task-status.ts';
import {
  isMonthlyRecurrenceDate,
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

  // The materialized deadline row already represents the anchor occurrence.
  if (task.due_date && localDateFromIso(task.due_date, timeZone) === date) return false;

  if (task.recurrence === 'daily') return true;
  if (task.recurrence === 'weekly') {
    const recurrenceDays = task.recurrence_days?.length
      ? task.recurrence_days
      : [localDayOfWeek(anchor)];
    return recurrenceDays.includes(localDayOfWeek(date));
  }
  return task.recurrence === 'monthly' && isMonthlyRecurrenceDate(date, anchor);
}

/**
 * Select the work that belongs on a dashboard day.
 *
 * Imported work due during school is surfaced one day early. An unfinished
 * task stays visible on its real deadline day even after its exact due time,
 * then leaves the dashboard at the next calendar-day boundary. The complete
 * overdue history remains available in Tasks > Missing.
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
