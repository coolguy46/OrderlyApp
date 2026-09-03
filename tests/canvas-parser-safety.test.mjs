import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hydrateCanvasDueDate,
  parseICalFile,
} from '../lib/integrations/canvas.ts';
import {
  countCanvasEventBoundaries,
  haveSameCanvasIdentities,
  isConfirmedCanvasCleanupSnapshot,
  isCompleteCanvasSnapshot,
} from '../lib/integrations/canvas-sync-safety.ts';
import { externalHtmlToPlainText } from '../lib/safe-content.ts';

function calendar(eventLines, calendarLines = []) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...calendarLines,
    'BEGIN:VEVENT',
    'UID:assignment-1',
    'SUMMARY:Assignment [p Mathematics]',
    ...eventLines,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

test('accepts real leap days and hydrates date-only work in the requested zone', () => {
  const [assignment] = parseICalFile(calendar(['DTSTART;VALUE=DATE:20240229']));

  assert.equal(assignment.dueDateOnly, '2024-02-29');
  assert.equal(assignment.dueDate?.toISOString(), '2024-02-29T12:00:00.000Z');
  assert.equal(
    hydrateCanvasDueDate(assignment, 'America/Los_Angeles')?.toISOString(),
    '2024-03-01T07:59:00.000Z',
  );
});

test('rejects impossible DATE values instead of normalizing them into another day', () => {
  for (const value of ['20230229', '20260230', '20261301', '00000101']) {
    const [assignment] = parseICalFile(calendar([`DTSTART;VALUE=DATE:${value}`]));
    assert.equal(assignment.dueDate, undefined, value);
    assert.equal(assignment.dueDateOnly, undefined, value);
  }

  assert.equal(
    hydrateCanvasDueDate({ dueDate: undefined, dueDateOnly: '2026-02-30' }, 'America/Los_Angeles'),
    undefined,
  );
});

test('rejects out-of-range DATE-TIME clock fields', () => {
  for (const value of ['20260825T240000Z', '20260825T126000Z', '20260825T125960Z']) {
    const [assignment] = parseICalFile(calendar([`DTSTART:${value}`]));
    assert.equal(assignment.dueDate, undefined, value);
  }
});

test('rejects a nonexistent DST wall time instead of moving the deadline', () => {
  const [assignment] = parseICalFile(calendar([
    'DTSTART;TZID=America/Los_Angeles:20260308T023000',
  ]));

  assert.equal(assignment.dueDate, undefined);
});

test('keeps valid timezone and UTC instants exact', () => {
  const [zoned] = parseICalFile(calendar([
    'DTSTART;TZID=America/Los_Angeles:20261101T013000',
  ]));
  assert.ok(zoned.dueDate);
  const rendered = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(zoned.dueDate);
  assert.equal(rendered, '01:30');

  const [utc] = parseICalFile(calendar(['DTSTART:20260825T235900Z']));
  assert.equal(utc.dueDate?.toISOString(), '2026-08-25T23:59:00.000Z');

  const [explicitDateTime] = parseICalFile(calendar([
    'DTSTART;VALUE=DATE-TIME:20260825T235900Z',
  ]));
  assert.equal(explicitDateTime.dueDate?.toISOString(), '2026-08-25T23:59:00.000Z');
});

test('normalizes Canvas rich descriptions before they reach task persistence', () => {
  const [assignment] = parseICalFile(calendar([
    'DTSTART;VALUE=DATE:20260904',
    'DESCRIPTION:Plain fallback that should not win',
    'X-ALT-DESC;FMTTYPE=text/html:<p><a href="https://drive.google.com/file/d/assignment-1">Open worksheet</a></p><p>Answer every question.&nbsp;</p>',
  ]));

  assert.equal(
    assignment.description,
    'Open worksheet (https://drive.google.com/file/d/assignment-1)\n\nAnswer every question.',
  );
});

test('leaves Canvas plain-text descriptions unchanged', () => {
  const [assignment] = parseICalFile(calendar([
    'DTSTART;VALUE=DATE:20260904',
    'DESCRIPTION:Solve 2 < 3 and 5 > 4',
  ]));

  assert.equal(assignment.description, 'Solve 2 < 3 and 5 > 4');
});

test('Canvas parser output stays unchanged when TaskForm normalizes a legacy import', () => {
  const [assignment] = parseICalFile(calendar([
    'DTSTART;VALUE=DATE:20260904',
    'X-ALT-DESC;FMTTYPE=text/html:<p>Type &lt;strong&gt; exactly</p>',
  ]));

  assert.equal(assignment.description, 'Type <strong> exactly');
  assert.equal(externalHtmlToPlainText(assignment.description), assignment.description);
});

test('rejects an unsupported TZID rather than silently treating it as UTC', () => {
  const [assignment] = parseICalFile(calendar([
    'DTSTART;TZID=Not/A_Time_Zone:20260825T235900',
  ]));

  assert.equal(assignment.dueDate, undefined);
});

test('orphan cleanup requires a nonempty fully parsed snapshot', () => {
  assert.equal(isCompleteCanvasSnapshot(0, 0), false);
  assert.equal(isCompleteCanvasSnapshot(3, 4), false);
  assert.equal(isCompleteCanvasSnapshot(4, 4), true);
});

test('counts unterminated VEVENT blocks as structurally incomplete', () => {
  assert.deepEqual(countCanvasEventBoundaries([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:assignment-1',
    'END:VCALENDAR',
  ].join('\r\n')), {
    beginCount: 1,
    endCount: 0,
  });
});

test('orphan cleanup confirmation compares stable task and exam memberships', () => {
  const firstTasks = new Set(['assignment-1', 'assignment-2']);
  const firstExams = new Set(['assignment-2']);

  assert.equal(haveSameCanvasIdentities(firstTasks, new Set(['assignment-2', 'assignment-1'])), true);
  assert.equal(haveSameCanvasIdentities(firstTasks, new Set(['assignment-1'])), false);
  assert.equal(haveSameCanvasIdentities(firstExams, new Set()), false);
});

test('orphan cleanup requires two complete snapshots with identical identities', () => {
  const snapshot = (taskIds, examIds = [], parsedAssignmentCount = taskIds.length, eventCount = taskIds.length) => ({
    parsedAssignmentCount,
    eventCount,
    taskIds: new Set(taskIds),
    examIds: new Set(examIds),
  });

  assert.equal(isConfirmedCanvasCleanupSnapshot(
    snapshot(['assignment-1', 'assignment-2'], ['assignment-2']),
    snapshot(['assignment-2', 'assignment-1'], ['assignment-2']),
  ), true);
  assert.equal(isConfirmedCanvasCleanupSnapshot(
    snapshot(['assignment-1', 'assignment-2']),
    snapshot(['assignment-1', 'assignment-2', 'assignment-3']),
  ), false, 'a repeat fetch must reject a truncated prefix');
  assert.equal(isConfirmedCanvasCleanupSnapshot(
    snapshot(['assignment-1', 'assignment-2'], [], 2, 3),
    snapshot(['assignment-1', 'assignment-2']),
  ), false, 'every VEVENT must parse');
  assert.equal(isConfirmedCanvasCleanupSnapshot(
    snapshot(['assignment-1', 'assignment-2'], ['assignment-2']),
    snapshot(['assignment-1', 'assignment-3'], ['assignment-3']),
  ), false, 'matching counts do not substitute for matching UIDs');
  assert.equal(isConfirmedCanvasCleanupSnapshot(
    snapshot(['assignment-1', 'assignment-2'], ['assignment-2']),
    snapshot(['assignment-1', 'assignment-2'], []),
  ), false, 'exam identities must also be stable');
  assert.equal(isConfirmedCanvasCleanupSnapshot(
    snapshot([]),
    snapshot([]),
  ), false, 'empty feeds remain non-destructive even when repeated');
});
