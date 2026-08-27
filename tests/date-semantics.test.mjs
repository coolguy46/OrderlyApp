import assert from 'node:assert/strict';
import test from 'node:test';

import {
  civilDateFromStored,
  civilDateToIso,
  formatCivilDate,
} from '../lib/civil-date.ts';
import {
  examDateForSave,
  examDateInputValue,
  examRepresentsTask,
  examTemporalStatus,
} from '../lib/exam-status.ts';

test('date-only values round-trip in a positive-offset timezone', () => {
  const timeZone = 'Pacific/Kiritimati';
  const stored = civilDateToIso('2026-08-26', timeZone);

  assert.equal(stored, '2026-08-25T10:00:00.000Z');
  assert.equal(civilDateFromStored(stored, timeZone), '2026-08-26');
});

test('unchanged Canvas dates retain their authoritative timestamp on edit', () => {
  const canvasExam = {
    source: 'canvas',
    exam_date: '2026-08-25T23:30:45.000Z',
  };
  const timeZone = 'Pacific/Kiritimati';

  assert.equal(examDateInputValue(canvasExam, timeZone), '2026-08-26');
  assert.equal(
    examDateForSave('2026-08-26', timeZone, canvasExam),
    canvasExam.exam_date,
  );
  assert.equal(
    examDateForSave('2026-08-27', timeZone, canvasExam),
    '2026-08-26T10:00:00.000Z',
  );
});

test('manual all-day exams remain upcoming through their local calendar day', () => {
  const manualExam = {
    source: 'manual',
    exam_date: '2026-08-26T07:00:00.000Z',
  };
  const timeZone = 'America/Los_Angeles';

  assert.equal(
    examTemporalStatus(manualExam, new Date('2026-08-27T06:59:59.000Z'), timeZone),
    'upcoming',
  );
  assert.equal(
    examTemporalStatus(manualExam, new Date('2026-08-27T07:00:00.000Z'), timeZone),
    'past',
  );
});

test('Canvas exams switch to past at their exact authoritative timestamp', () => {
  const canvasExam = {
    source: 'canvas',
    exam_date: '2026-08-26T19:00:00.000Z',
  };

  assert.equal(
    examTemporalStatus(canvasExam, new Date('2026-08-26T18:59:59.999Z'), 'America/Los_Angeles'),
    'upcoming',
  );
  assert.equal(
    examTemporalStatus(canvasExam, new Date('2026-08-26T19:00:00.001Z'), 'America/Los_Angeles'),
    'past',
  );
});

test('civil-date display follows the persisted timezone instead of the browser timezone', () => {
  const instant = '2026-08-26T00:30:00.000Z';

  assert.equal(formatCivilDate(instant, 'America/Los_Angeles'), 'Aug 25, 2026');
  assert.equal(formatCivilDate(instant, 'Pacific/Kiritimati'), 'Aug 26, 2026');
  assert.equal(formatCivilDate('2026-08-26', 'America/Los_Angeles'), 'Aug 26, 2026');
});

test('manual exams never hide imported exam tasks that happen to share a title', () => {
  const manualExam = {
    source: 'manual',
    external_id: null,
    subject_id: 'subject-1',
    title: 'Unit 1 Quiz',
    exam_date: '2026-08-26',
  };
  const canvasTask = {
    source: 'canvas',
    external_id: 'canvas-assignment-1',
    subject_id: 'subject-1',
    title: '[Canvas] Unit 1 Quiz',
    due_date: '2026-08-26T18:00:00.000Z',
  };

  assert.equal(examRepresentsTask(manualExam, canvasTask, 'America/Los_Angeles'), false);
});

test('matching imported external IDs are authoritative for exam task dedupe', () => {
  const exam = {
    source: 'canvas',
    external_id: 'canvas-assignment-1',
    subject_id: 'subject-1',
    title: 'Old quiz title',
    exam_date: '2026-08-25T18:00:00.000Z',
  };
  const matchingTask = {
    source: 'canvas',
    external_id: 'canvas-assignment-1',
    subject_id: 'subject-2',
    title: '[Canvas] Renamed quiz',
    due_date: '2026-08-27T18:00:00.000Z',
  };
  const differentTask = {
    ...matchingTask,
    external_id: 'canvas-assignment-2',
    subject_id: exam.subject_id,
    title: exam.title,
    due_date: exam.exam_date,
  };

  assert.equal(examRepresentsTask(exam, matchingTask, 'America/Los_Angeles'), true);
  assert.equal(examRepresentsTask(exam, differentTask, 'America/Los_Angeles'), false);
});

test('legacy imported exam dedupe requires source, subject, normalized title, and civil date', () => {
  const legacyExam = {
    source: 'canvas',
    external_id: null,
    subject_id: 'subject-1',
    title: 'Unit 1 Quiz',
    exam_date: '2026-08-26T00:30:00.000Z',
  };
  const legacyTask = {
    source: 'canvas',
    external_id: null,
    subject_id: 'subject-1',
    title: '[Canvas] Unit 1 Quiz',
    due_date: '2026-08-25T23:30:00.000Z',
  };

  assert.equal(examRepresentsTask(legacyExam, legacyTask, 'America/Los_Angeles'), true);
  assert.equal(
    examRepresentsTask(legacyExam, { ...legacyTask, due_date: '2026-08-26T08:00:00.000Z' }, 'America/Los_Angeles'),
    false,
  );
  assert.equal(
    examRepresentsTask(legacyExam, { ...legacyTask, subject_id: null }, 'America/Los_Angeles'),
    false,
  );
  assert.equal(
    examRepresentsTask(legacyExam, { ...legacyTask, source: 'google_classroom' }, 'America/Los_Angeles'),
    false,
  );
});
