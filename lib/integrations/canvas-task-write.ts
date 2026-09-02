import type { CanvasAssignment } from '@/lib/integrations/canvas';

export const CANVAS_TASK_UPSERT_CONFLICT = 'user_id,source,external_id';

export interface CanvasManagedTaskValues {
  title: string;
  description: string;
  due_date: string;
  due_time: string | null;
  subject_id: string | null;
  external_url: string | null;
  course_name: string | null;
  assignment_type: CanvasAssignment['type'];
}

/**
 * Fields Canvas owns on an existing task. Deliberately keep scheduling,
 * completion, recurrence, and priority out of this patch so a normal feed
 * refresh cannot erase work the user already planned or completed in Orderly.
 */
export function buildCanvasManagedTaskValues(input: {
  assignment: CanvasAssignment;
  dueDate: Date;
  dueTime: string | null;
  courseName: string | null;
  subjectId: string | null;
}): CanvasManagedTaskValues {
  const { assignment, dueDate, dueTime, courseName, subjectId } = input;
  return {
    title: `[Canvas] ${assignment.title}`,
    description: assignment.description || `Course: ${courseName || 'Canvas'}`,
    due_date: dueDate.toISOString(),
    due_time: dueTime,
    subject_id: subjectId,
    external_url: assignment.url || null,
    course_name: courseName,
    assignment_type: assignment.type || 'assignment',
  };
}
