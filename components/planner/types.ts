import type { PlannerChatMessage } from '@/lib/planner/types';

export type PlannerBlockKind =
  | 'task'
  | 'commitment'
  | 'exam'
  | 'event'
  | 'break'
  | 'school';

/**
 * Minimal render model consumed by the planner UI. Persistence records can be
 * mapped to this shape without coupling the calendar to a database schema.
 */
export interface PlannerBlockView {
  id: string;
  title: string;
  startAt: string | Date;
  endAt: string | Date;
  description?: string | null;
  reason?: string | null;
  subjectName?: string | null;
  subjectColor?: string | null;
  color?: string | null;
  source?: string | null;
  kind?: PlannerBlockKind;
  taskId?: string | null;
  examId?: string | null;
  commitmentId?: string | null;
  calendarEventId?: string | null;
  occurrenceDate?: string | null;
  fixed?: boolean;
  locked?: boolean;
  /** Unsaved Assistant change rendered directly on the calendar. */
  draft?: boolean;
  completed?: boolean;
}

/** A planned task as shown in the selected-day list. */
export interface PlannerDayTaskView {
  id: string;
  title: string;
  startAt: string | Date;
  endAt: string | Date;
  description?: string | null;
  subjectName?: string | null;
  subjectColor?: string | null;
  source?: string | null;
  dueAt?: string | Date | null;
  completed?: boolean;
}

export type PlannerPromptMessageView = PlannerChatMessage;
