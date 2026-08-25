import { isSameDay } from 'date-fns';
import type { PlannerBlock, PlannerPlan } from '@/lib/planner/types';
import type { Subject, Task } from '@/lib/supabase/types';
import type { PlannerBlockView, PlannerDayTaskView } from './types';

const PRIORITY_COLORS = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
} as const;

function localDateInTimeZone(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date).map(part => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function isVirtualPlannerOccurrence(block: PlannerBlock): boolean {
  return Boolean(
    block.taskId
    && block.sourceId.startsWith(`${block.taskId}@`)
    && /^\d{4}-\d{2}-\d{2}$/.test(block.sourceId.slice(block.taskId.length + 1)),
  );
}

/** Split segments share one key; recurring occurrences keep independent keys. */
export function plannerFeedbackEntityKey(block: PlannerBlock): string {
  if (isVirtualPlannerOccurrence(block)) return `source:${block.sourceId}`;
  if (block.activityId) return `source:${block.sourceId}`;
  if (block.taskId) return `task:${block.taskId}`;
  if (block.examId) return `exam:${block.examId}`;
  return `block:${block.id}`;
}

/**
 * A completed recurring database row represents its current due-date occurrence,
 * not every virtual occurrence generated from that row for the planned week.
 */
export function plannerBlockMatchesTaskCompletion(
  block: PlannerBlock,
  task: Task | null | undefined,
  timeZone: string,
): boolean {
  if (!task || task.status !== 'completed' || block.taskId !== task.id) return false;
  if (!isVirtualPlannerOccurrence(block)) return true;
  if (!task.due_date) return false;
  const occurrenceDate = block.sourceId.slice((block.taskId || '').length + 1);
  return occurrenceDate === localDateInTimeZone(task.due_date, timeZone);
}

export function plannerBlockViews(
  plan: PlannerPlan | null,
  subjects: readonly Subject[],
  tasks: readonly Task[] = [],
): PlannerBlockView[] {
  if (!plan) return [];
  const subjectById = new Map(subjects.map(subject => [subject.id, subject]));
  const taskById = new Map(tasks.map(task => [task.id, task]));

  const planned = plan.blocks.map<PlannerBlockView>(block => {
    const subject = block.subjectId ? subjectById.get(block.subjectId) : null;
    const task = block.taskId ? taskById.get(block.taskId) : null;
    return {
      id: block.id,
      title: block.title,
      startAt: block.startAt,
      endAt: block.endAt,
      description: block.description,
      reason: block.kind === 'exam_prep'
        ? 'Exam preparation'
        : block.kind === 'requested_activity'
          ? 'Requested in Planner'
        : block.segmentCount > 1
          ? `Part ${block.segmentIndex + 1} of ${block.segmentCount}`
          : 'Planned assignment work',
      subjectName: subject?.name || null,
      subjectColor: subject?.color || PRIORITY_COLORS[block.priority],
      source: block.kind === 'exam_prep'
        ? 'Exam'
        : block.kind === 'requested_activity'
          ? 'Planner request'
          : block.assignmentType || 'Task',
      kind: block.kind === 'exam_prep' ? 'exam' : 'task',
      taskId: block.taskId,
      examId: block.examId,
      fixed: false,
      locked: block.locked,
      completed: block.status === 'completed'
        || plannerBlockMatchesTaskCompletion(block, task, plan.settings.timeZone),
    };
  });

  const fixed = plan.fixedIntervals.map<PlannerBlockView>(interval => ({
    id: interval.id,
    title: interval.title,
    startAt: interval.startAt,
    endAt: interval.endAt,
    color: interval.color || (interval.kind === 'school' ? '#64748b' : '#0ea5e9'),
    source: interval.kind === 'school' ? 'School day' : 'Calendar commitment',
    kind: interval.kind,
    fixed: true,
    locked: true,
  }));

  return [...fixed, ...planned];
}

export function plannerDayTasks(
  plan: PlannerPlan | null,
  date: Date,
  tasks: readonly Task[],
  subjects: readonly Subject[],
): PlannerDayTaskView[] {
  if (!plan) return [];
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const subjectById = new Map(subjects.map(subject => [subject.id, subject]));

  return plan.blocks
    .filter(block => isSameDay(new Date(block.startAt), date))
    .map(block => {
      const task = block.taskId ? taskById.get(block.taskId) : null;
      const subject = block.subjectId ? subjectById.get(block.subjectId) : null;
      return {
        id: block.id,
        title: block.title,
        startAt: block.startAt,
        endAt: block.endAt,
        description: block.description || task?.description || null,
        subjectName: subject?.name || task?.course_name || null,
        subjectColor: subject?.color || PRIORITY_COLORS[block.priority],
        source: task?.source === 'canvas'
          ? 'Canvas'
          : block.kind === 'exam_prep'
            ? 'Exam prep'
            : block.kind === 'requested_activity'
              ? 'Planner request'
              : task?.source || 'Orderly',
        dueAt: block.deadlineAt,
        completed: block.status === 'completed'
          || plannerBlockMatchesTaskCompletion(block, task, plan.settings.timeZone),
      };
    })
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
}
