import type { Task } from '@/lib/supabase/types';
import { taskDueAt } from '@/lib/task-status';
import { addLocalDays, localDateFromIso } from '@/lib/schedule/selectors';

export interface AssistantTaskQueryInput {
  message: string;
  now: string;
  timeZone: string;
  tasks: readonly Task[];
}
export interface AssistantTaskQueryResult {
  reply: string;
  taskIds: string[];
  scope: 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'all_pending';
}

// Keep common scheduling misspellings here as well as in the chat planner. A
// mutation must never fall into the read-only task-answer path just because a
// student typed "schedual" instead of "schedule".
const MUTATION_PATTERN = /\b(?:add|create|fit|move|plan|put|rebalance|replan|reschedule|schedule|schedual|shedule|scedual|scedule|shift|spread|unschedule)\b/i;
// Query words are intentionally anchored to the beginning (or to an explicit
// request verb). An incidental relative clause such as "college essays, which
// will take four hours" is not a request to list tasks.
const LIST_PATTERN = /^\s*(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:please\s+)?(?:count|do\s+i\s+have|give\s+me|how\s+many|list|name|show|tell\s+me|what(?:'s|\s+is|\s+are)?|which)\b/i;
const TASK_PATTERN = /\b(?:assignment|assignments|deadline|deadlines|homework|item|items|missing|overdue|task|tasks|work)\b/i;

function formatDeadline(task: Task, timeZone: string): string {
  const deadline = taskDueAt(task, timeZone);
  if (!deadline) return 'No deadline';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(deadline);
}

/**
 * Answer factual task-list questions from Orderly's complete local data.
 * This deliberately bypasses the provider's bounded context so "all" really
 * means all, and so an AI response cannot silently omit an overdue task.
 */
export function resolveAssistantTaskQuery(input: AssistantTaskQueryInput): AssistantTaskQueryResult | null {
  const message = input.message.trim();
  if (!message || MUTATION_PATTERN.test(message) || !LIST_PATTERN.test(message) || !TASK_PATTERN.test(message)) {
    return null;
  }

  const now = new Date(input.now);
  if (Number.isNaN(now.getTime())) return null;
  const today = localDateFromIso(now.toISOString(), input.timeZone);
  if (!today) return null;

  const wantsOverdue = /\b(?:missing|overdue|late|past due)\b/i.test(message);
  const wantsToday = /\b(?:today|tonight)\b/i.test(message);
  const wantsTomorrow = /\btomorrow\b/i.test(message);
  const wantsThisWeek = /\b(?:this|the current) week\b/i.test(message);
  const wantsAllPending = /\b(?:pending|unfinished|open|active)\b/i.test(message)
    || (!wantsOverdue && !wantsToday && !wantsTomorrow && !wantsThisWeek);

  const tomorrow = addLocalDays(today, 1);
  const todayUtc = new Date(`${today}T00:00:00.000Z`);
  const daysUntilSunday = (7 - todayUtc.getUTCDay()) % 7;
  const weekEnd = addLocalDays(today, daysUntilSunday);
  const hasDateScope = wantsToday || wantsTomorrow || wantsThisWeek;
  const matching = input.tasks
    .filter(task => task.status !== 'completed')
    .filter(task => {
      const dueAt = taskDueAt(task, input.timeZone);
      if (!dueAt) return wantsAllPending && !wantsOverdue && !wantsToday && !wantsTomorrow && !wantsThisWeek;
      if (wantsOverdue && dueAt.getTime() >= now.getTime()) return false;
      const dueDate = localDateFromIso(dueAt.toISOString(), input.timeZone);
      if (!dueDate) return false;
      // Multiple date scopes are alternatives ("today or tomorrow"), not an
      // impossible intersection. "Overdue" remains an additional status
      // filter, so "overdue today" still means unfinished work from today
      // whose exact deadline has passed.
      if (hasDateScope) {
        const matchesDate = (wantsToday && dueDate === today)
          || (wantsTomorrow && dueDate === tomorrow)
          || (wantsThisWeek && dueDate >= today && dueDate <= weekEnd);
        if (!matchesDate) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftTime = taskDueAt(left, input.timeZone)?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = taskDueAt(right, input.timeZone)?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    });

  const scope: AssistantTaskQueryResult['scope'] = wantsToday
    ? 'today'
    : wantsTomorrow
      ? 'tomorrow'
      : wantsThisWeek
        ? 'this_week'
        : wantsOverdue
          ? 'overdue'
          : 'all_pending';
  const label = wantsOverdue && wantsToday && wantsTomorrow
    ? 'overdue today or tomorrow'
    : wantsOverdue && wantsToday
    ? 'overdue today'
    : wantsOverdue && wantsTomorrow
      ? 'overdue tomorrow'
      : wantsOverdue
        ? 'overdue'
        : wantsToday && wantsTomorrow
          ? 'due today or tomorrow'
          : wantsTomorrow
          ? 'due tomorrow'
          : wantsToday
            ? 'due today'
            : wantsThisWeek
              ? 'due this week'
              : 'pending';
  if (matching.length === 0) {
    return {
      reply: `You have no unfinished tasks ${label}.`,
      taskIds: [],
      scope,
    };
  }

  const lines = matching.map(task => `- **${task.title}** — ${formatDeadline(task, input.timeZone)}`);
  return {
    reply: [
      `You have ${matching.length} unfinished ${matching.length === 1 ? 'task' : 'tasks'} ${label}:`,
      '',
      ...lines,
    ].join('\n'),
    taskIds: matching.map(task => task.id),
    scope,
  };
}

export function answerAssistantTaskQuery(input: AssistantTaskQueryInput): string | null {
  return resolveAssistantTaskQuery(input)?.reply || null;
}
