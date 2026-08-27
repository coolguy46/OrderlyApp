import type { CanvasAssignment } from '@/lib/integrations/canvas';
import { isCompleteCanvasSnapshot } from './canvas-sync-safety.ts';

type CanvasCourseIdentity = Pick<CanvasAssignment, 'courseId' | 'courseName'>;

function normalizedCourseName(courseName: string): string | null {
  const normalized = courseName.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Count distinct courses represented by a complete Canvas calendar feed. */
export function countCanvasCourses(
  assignments: readonly CanvasCourseIdentity[],
): number {
  const courseIds = new Set<string>();
  const namesWithCourseId = new Set<string>();
  const namesWithoutCourseId = new Set<string>();

  for (const assignment of assignments) {
    const courseId = assignment.courseId?.trim();
    const courseName = normalizedCourseName(assignment.courseName);

    if (courseId) {
      courseIds.add(courseId);
      if (courseName) namesWithCourseId.add(courseName);
    } else if (courseName && courseName !== 'unknown course') {
      namesWithoutCourseId.add(courseName);
    }
  }

  for (const resolvedName of namesWithCourseId) {
    namesWithoutCourseId.delete(resolvedName);
  }

  return courseIds.size + namesWithoutCourseId.size;
}

/**
 * Return a count only when the feed snapshot is authoritative enough to
 * replace the last persisted value. Empty or partially parsed feeds retain the
 * previous count just as they retain rows during orphan-cleanup safety checks.
 */
export function countCanvasCoursesForCompleteSnapshot(
  assignments: readonly CanvasCourseIdentity[],
  eventCount: number,
): number | null {
  return isCompleteCanvasSnapshot(assignments.length, eventCount)
    ? countCanvasCourses(assignments)
    : null;
}
