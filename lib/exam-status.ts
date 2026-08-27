import type { Exam, Task } from './supabase/types.ts';
import {
  civilDateDayDistance,
  civilDateFromStored,
  civilDateToIso,
} from './civil-date.ts';
import { localDateFromIso } from './schedule/selectors.ts';

type ExamTiming = Pick<Exam, 'exam_date' | 'source'>;
type ExamIdentity = Pick<Exam, 'exam_date' | 'external_id' | 'source' | 'subject_id' | 'title'>;
type TaskExamIdentity = Pick<Task, 'due_date' | 'external_id' | 'source' | 'subject_id' | 'title'>;

export type ExamTemporalStatus = 'upcoming' | 'past' | 'invalid';

function hasAuthoritativeTimestamp(exam: ExamTiming): boolean {
  return exam.source === 'canvas' || exam.source === 'google_classroom';
}

/** Date value shown in an `<input type="date">`. */
export function examDateInputValue(exam: ExamTiming, timeZone?: string): string {
  return civilDateFromStored(exam.exam_date, timeZone) || '';
}

/**
 * Resolve an edited date input to storage. An unchanged external exam retains
 * its authoritative timestamp instead of being silently rewritten to midnight.
 */
export function examDateForSave(
  dateInput: string,
  timeZone?: string,
  existingExam?: ExamTiming | null,
): string | null {
  if (
    existingExam
    && hasAuthoritativeTimestamp(existingExam)
    && examDateInputValue(existingExam, timeZone) === dateInput
  ) {
    return existingExam.exam_date;
  }
  return civilDateToIso(dateInput, timeZone);
}

/**
 * Manual exams are all-day civil dates and remain upcoming for their whole
 * local day. External exams use their exact authoritative timestamp.
 */
export function examTemporalStatus(
  exam: ExamTiming,
  now: Date | number = Date.now(),
  timeZone?: string,
): ExamTemporalStatus {
  const nowDate = typeof now === 'number' ? new Date(now) : now;

  if (hasAuthoritativeTimestamp(exam)) {
    const examTime = new Date(exam.exam_date).getTime();
    if (!Number.isFinite(examTime)) return 'invalid';
    return examTime >= nowDate.getTime() ? 'upcoming' : 'past';
  }

  const examDate = civilDateFromStored(exam.exam_date, timeZone);
  const currentDate = localDateFromIso(nowDate.toISOString(), timeZone);
  if (!examDate || !currentDate) return 'invalid';
  return examDate >= currentDate ? 'upcoming' : 'past';
}

export function examDayDistance(
  exam: ExamTiming,
  now: Date | number = Date.now(),
  timeZone?: string,
): number | null {
  return civilDateDayDistance(exam.exam_date, now, timeZone);
}

function normalizedImportedTitle(value: string): string {
  return value
    .replace(/^\[(?:canvas|google classroom|gc)\]\s*/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

/**
 * Decide whether an imported exam is the exam record for an exam-type task.
 * Immutable provider IDs are authoritative. A narrow legacy fallback is used
 * only for imported records where at least one old row lacks that identity.
 */
export function examRepresentsTask(
  exam: ExamIdentity,
  task: TaskExamIdentity,
  timeZone?: string,
): boolean {
  const examSource = exam.source || 'manual';
  const taskSource = task.source || 'manual';
  if (examSource === 'manual' || taskSource === 'manual' || examSource !== taskSource) {
    return false;
  }

  const examExternalId = exam.external_id?.trim() || null;
  const taskExternalId = task.external_id?.trim() || null;
  if (examExternalId && taskExternalId) {
    return examExternalId === taskExternalId;
  }

  if (
    !exam.subject_id
    || !task.subject_id
    || exam.subject_id !== task.subject_id
    || normalizedImportedTitle(exam.title) !== normalizedImportedTitle(task.title)
  ) {
    return false;
  }

  const examDate = civilDateFromStored(exam.exam_date, timeZone);
  const taskDate = civilDateFromStored(task.due_date, timeZone);
  return Boolean(examDate && taskDate && examDate === taskDate);
}
