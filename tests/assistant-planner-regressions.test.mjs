import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = await mkdtemp(join(projectRoot, 'node_modules/.orderly-assistant-planner-test-'));

const runtimeSources = [
  'lib/planner/types.ts',
  'lib/planner/commitments.ts',
  'lib/planner/engine.ts',
  'lib/planner/adapters.ts',
  'lib/schedule/types.ts',
  'lib/schedule/selectors.ts',
  'lib/planner/assistant-planner.ts',
];

for (const relativePath of runtimeSources) {
  const sourcePath = join(projectRoot, relativePath);
  const outputPath = join(buildRoot, relativePath.replace(/\.ts$/, '.js'));
  const source = await readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics || [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(diagnostic => diagnostic.messageText).join('\n'));

  let output = transpiled.outputText;
  if (relativePath === 'lib/planner/assistant-planner.ts') {
    output = output.replace(
      'require("@/lib/schedule/selectors")',
      'require("../schedule/selectors")',
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}

const compiledRequire = createRequire(join(buildRoot, 'runtime.cjs'));
const { buildAssistantTaskPlan } = compiledRequire(
  join(buildRoot, 'lib/planner/assistant-planner.js'),
);
const { getDefaultPlannerSettings } = compiledRequire(join(buildRoot, 'lib/planner/types.js'));

after(async () => {
  await rm(buildRoot, { recursive: true, force: true });
});

const TIME_ZONE = 'America/Los_Angeles';
const NOW = '2026-08-27T19:00:00.000Z'; // Thursday at noon in Los Angeles.

function settings(overrides = {}) {
  return {
    ...getDefaultPlannerSettings(TIME_ZONE),
    timeZone: TIME_ZONE,
    schoolDays: [],
    weekendAvailableStart: '08:00',
    weekendAvailableEnd: '23:00',
    bedtime: '23:00',
    maxDailyMinutes: 960,
    minBreakMinutes: 0,
    ...overrides,
  };
}

function task(id, {
  title = id,
  description = '',
  priority = 'medium',
  status = 'pending',
  dueDate = '2026-08-25T18:00:00.000Z',
  dueTime = null,
  source = 'canvas',
  assignmentType = 'assignment',
} = {}) {
  return {
    id,
    user_id: 'user-1',
    subject_id: null,
    title,
    description,
    priority,
    status,
    due_date: dueDate,
    due_time: dueTime,
    recurrence: 'none',
    recurrence_days: null,
    completed_at: status === 'completed' ? '2026-08-26T20:00:00.000Z' : null,
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-27T12:00:00.000Z',
    source,
    external_id: id,
    external_url: null,
    course_name: null,
    assignment_type: assignmentType,
  };
}

function entry(taskId, overrides = {}) {
  return {
    id: `entry-${taskId}`,
    userId: 'user-1',
    taskId,
    scheduledDate: '2026-08-27',
    startAt: '2026-08-27T23:00:00.000Z',
    durationSeconds: 45 * 60,
    recurrence: 'none',
    recurrenceDays: null,
    recurrenceEndDate: null,
    occurrenceOverrides: {},
    createdAt: '2026-08-27T12:00:00.000Z',
    updatedAt: '2026-08-27T12:00:00.000Z',
    ...overrides,
  };
}

function occurrence(id, startAt, endAt, overrides = {}) {
  const occurrenceTask = task(id, { dueDate: '2026-08-30T18:00:00.000Z' });
  return {
    id: `occurrence-${id}`,
    entryId: `entry-${id}`,
    taskId: id,
    task: occurrenceTask,
    title: occurrenceTask.title,
    description: occurrenceTask.description,
    subjectId: null,
    subject: null,
    color: null,
    date: '2026-08-27',
    recurrenceSourceDate: '2026-08-27',
    startAt,
    endAt,
    durationSeconds: Math.round((new Date(endAt) - new Date(startAt)) / 1000),
    timed: true,
    virtual: false,
    recurrence: 'none',
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    taskScope: 'overdue',
    taskIds: [],
    startDate: null,
    horizonDays: 7,
    todayLoad: 'normal',
    includeAlreadyScheduled: false,
    availableAfter: null,
    availableBefore: null,
    additionalTasks: [],
    ...overrides,
  };
}

function plan(overrides = {}) {
  return buildAssistantTaskPlan({
    request: request(),
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
    settings: settings(),
    ...overrides,
  });
}

function operations(preview) {
  return preview.actions.flatMap(action => (
    action.type === 'schedule_batch' ? action.operations : []
  ));
}

function operationByTask(preview, taskId) {
  return operations(preview).find(operation => (
    operation.type === 'upsert' && operation.taskId === taskId
  ));
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return new Date(leftStart) < new Date(rightEnd) && new Date(leftEnd) > new Date(rightStart);
}

test('overdue planning selects every pending task beyond eight and excludes completed work', () => {
  const pending = Array.from({ length: 12 }, (_, index) => task(`overdue-${index + 1}`));
  const completed = task('completed-overdue', { status: 'completed' });
  const preview = plan({
    request: request({ horizonDays: 2 }),
    tasks: [...pending, completed],
  });
  const scheduledIds = operations(preview).map(operation => operation.taskId).sort();

  assert.equal(preview.status, 'ready');
  assert.equal(scheduledIds.length, 12);
  assert.deepEqual(scheduledIds, pending.map(item => item.id).sort());
  assert.ok(!scheduledIds.includes(completed.id));
  assert.match(preview.summary, /Scheduled 12 of 12/);
});

test('a resolved overdue-plus-essay request uses the complete unfinished set, availability, and partial-fit explanation', () => {
  const overdue = [
    task('overdue-reading', { title: 'Overdue reading' }),
    task('overdue-worksheet', { title: 'Overdue worksheet' }),
    task('overdue-review', { title: 'Overdue review' }),
  ];
  const completedOverdue = task('completed-overdue', {
    title: 'Already completed overdue item',
    status: 'completed',
  });
  const preview = plan({
    request: request({
      taskScope: 'overdue',
      taskIds: [],
      startDate: '2026-08-27',
      horizonDays: 1,
      todayLoad: 'normal',
      availableAfter: '14:15',
      availableBefore: null,
      additionalTasks: [{ title: 'College essay', durationSeconds: 14_400 }],
    }),
    tasks: [...overdue, completedOverdue],
    settings: settings({
      // The base window starts earlier; the request-specific availability must
      // deterministically clip it to 2:15 PM.
      weekendAvailableStart: '08:00',
      weekendAvailableEnd: '18:15',
      maxDailyMinutes: 4 * 60,
    }),
  });
  const scheduled = operations(preview);
  const scheduledIds = scheduled.map(operation => operation.taskId).sort();

  assert.equal(preview.status, 'ready');
  assert.deepEqual(scheduledIds, overdue.map(item => item.id).sort());
  assert.ok(!scheduledIds.includes(completedOverdue.id));
  assert.ok(scheduled.every(operation => (
    new Date(operation.input.startAt) >= new Date('2026-08-27T21:15:00.000Z')
  )));
  assert.match(preview.summary, /Scheduled 3 of 4/);
  assert.ok(preview.assumptions.some(assumption => (
    /could not fit 1 (?:task|item)/i.test(assumption)
    && /College essay/i.test(assumption)
  )), preview.assumptions.join('\n'));
});

test('already-scheduled tasks are excluded unless rescheduling was explicitly requested', () => {
  const alreadyScheduled = task('already-scheduled');
  const unscheduled = task('unscheduled');
  const preview = plan({
    tasks: [alreadyScheduled, unscheduled],
    entries: [entry(alreadyScheduled.id)],
  });

  assert.deepEqual(operations(preview).map(operation => operation.taskId), [unscheduled.id]);
});

test('duration-only schedule metadata stays eligible as untimed work', () => {
  const untimed = task('duration-only');
  const preview = plan({
    tasks: [untimed],
    entries: [entry(untimed.id, {
      scheduledDate: null,
      startAt: null,
      durationSeconds: 60 * 60,
    })],
  });

  assert.equal(preview.status, 'ready');
  assert.ok(operationByTask(preview, untimed.id));
});

test('a stale one-off calendar block does not hide unfinished overdue work', () => {
  const overdue = task('stale-calendar-block');
  const staleEntry = entry(overdue.id, {
    scheduledDate: '2026-08-25',
    startAt: '2026-08-25T23:00:00.000Z',
    durationSeconds: 45 * 60,
  });
  const staleOccurrence = occurrence(
    overdue.id,
    '2026-08-25T23:00:00.000Z',
    '2026-08-25T23:45:00.000Z',
    {
      date: '2026-08-25',
      recurrenceSourceDate: '2026-08-25',
    },
  );
  const preview = plan({
    tasks: [overdue],
    entries: [staleEntry],
    occurrences: [staleOccurrence],
  });

  assert.equal(preview.status, 'ready');
  assert.ok(operationByTask(preview, overdue.id));
});

test('a still-active calendar block suppresses duplicate broad scheduling', () => {
  const scheduled = task('future-calendar-block');
  const scheduledEntry = entry(scheduled.id, {
    scheduledDate: '2026-08-27',
    startAt: '2026-08-27T23:00:00.000Z',
    durationSeconds: 45 * 60,
  });
  const scheduledOccurrence = occurrence(
    scheduled.id,
    '2026-08-27T23:00:00.000Z',
    '2026-08-27T23:45:00.000Z',
  );
  const preview = plan({
    tasks: [scheduled],
    entries: [scheduledEntry],
    occurrences: [scheduledOccurrence],
  });

  assert.equal(preview.status, 'query');
  assert.deepEqual(operations(preview), []);
});

test('an expired recurring row does not suppress unfinished work', () => {
  const overdue = task('expired-recurring-row');
  const expiredEntry = entry(overdue.id, {
    scheduledDate: '2026-08-20',
    startAt: '2026-08-20T23:00:00.000Z',
    durationSeconds: 45 * 60,
    recurrence: 'weekly',
    recurrenceDays: [4],
    recurrenceEndDate: '2026-08-26',
  });
  const staleOccurrence = occurrence(
    overdue.id,
    '2026-08-20T23:00:00.000Z',
    '2026-08-20T23:45:00.000Z',
    {
      date: '2026-08-20',
      recurrenceSourceDate: '2026-08-20',
      recurrence: 'weekly',
    },
  );
  const preview = plan({
    tasks: [overdue],
    entries: [expiredEntry],
    occurrences: [staleOccurrence],
  });

  assert.equal(preview.status, 'ready');
  assert.ok(operationByTask(preview, overdue.id));
});

test('an incomplete rebalance is atomic and leaves every old schedule unchanged', () => {
  const alpha = task('scheduled-alpha');
  const beta = task('scheduled-beta');
  const alphaEntry = entry(alpha.id, {
    startAt: '2026-08-28T00:00:00.000Z',
    durationSeconds: 30 * 60,
  });
  const betaEntry = entry(beta.id, {
    startAt: '2026-08-28T00:30:00.000Z',
    durationSeconds: 30 * 60,
  });
  const originalEntries = structuredClone([alphaEntry, betaEntry]);
  const preview = plan({
    request: request({
      taskScope: 'task_ids',
      taskIds: [alpha.id, beta.id],
      horizonDays: 1,
      includeAlreadyScheduled: true,
    }),
    tasks: [alpha, beta],
    entries: [alphaEntry, betaEntry],
    occurrences: [
      occurrence(alpha.id, '2026-08-28T00:00:00.000Z', '2026-08-28T00:30:00.000Z'),
      occurrence(beta.id, '2026-08-28T00:30:00.000Z', '2026-08-28T01:00:00.000Z'),
    ],
    settings: settings({
      weekendAvailableStart: '17:00',
      weekendAvailableEnd: '18:00',
      maxDailyMinutes: 60,
    }),
  });

  assert.equal(preview.status, 'clarification');
  assert.deepEqual(operations(preview), []);
  assert.match(preview.summary, /prepared no changes/i);
  assert.deepEqual([alphaEntry, betaEntry], originalEntries);
});

test('rebalancing one recurring occurrence preserves the series and its overrides', () => {
  const recurring = task('recurring-task');
  const recurringEntry = entry(recurring.id, {
    startAt: '2026-08-27T23:00:00.000Z',
    recurrence: 'weekly',
    recurrenceDays: [4],
    recurrenceEndDate: '2026-12-31',
    occurrenceOverrides: {
      '2026-09-03': { durationSeconds: 60 * 60 },
    },
  });
  const originalEntry = structuredClone(recurringEntry);
  const recurringOccurrence = occurrence(
    recurring.id,
    '2026-08-27T23:00:00.000Z',
    '2026-08-27T23:45:00.000Z',
    { recurrence: 'weekly' },
  );
  const preview = plan({
    request: request({
      taskScope: 'task_ids',
      taskIds: [recurring.id],
      horizonDays: 1,
      includeAlreadyScheduled: true,
    }),
    tasks: [recurring],
    entries: [recurringEntry],
    occurrences: [recurringOccurrence],
    settings: settings({
      weekendAvailableStart: '17:00',
      weekendAvailableEnd: '23:00',
    }),
  });
  const [operation] = operations(preview);

  assert.equal(preview.status, 'ready');
  assert.equal(operation.type, 'override');
  assert.equal(operation.taskId, recurring.id);
  assert.equal(operation.occurrenceDate, recurringOccurrence.recurrenceSourceDate);
  assert.deepEqual(recurringEntry, originalEntry);
});

test('Canvas descriptions drive deterministic duration estimates', () => {
  const reading = task('reading', {
    title: 'Chapter reading',
    description: 'Read 20 pages of the textbook and take notes.',
    dueDate: '2026-08-30T18:00:00.000Z',
  });
  const preview = plan({
    request: request({ taskScope: 'task_ids', taskIds: [reading.id] }),
    tasks: [reading],
  });
  const scheduled = operationByTask(preview, reading.id);

  assert.ok(scheduled);
  assert.equal(scheduled.input.durationSeconds, 135 * 60);
});

test('task-id planning schedules a requested task without a deadline', () => {
  const undated = task('undated-requested-task', { dueDate: null });
  const preview = plan({
    request: request({
      taskScope: 'task_ids',
      taskIds: [undated.id],
      horizonDays: 2,
    }),
    tasks: [undated],
  });

  assert.equal(preview.status, 'ready');
  assert.ok(operationByTask(preview, undated.id));
});

test('tomorrow scope selects and places tomorrow work on tomorrow', () => {
  const dueTomorrow = task('due-tomorrow', {
    dueDate: '2026-08-28T22:00:00.000Z', // Friday at 3 PM local.
  });
  const dueToday = task('due-today', {
    dueDate: '2026-08-27T22:00:00.000Z',
  });
  const preview = plan({
    request: request({ taskScope: 'tomorrow', horizonDays: 1 }),
    tasks: [dueToday, dueTomorrow],
  });

  assert.equal(preview.status, 'ready');
  assert.equal(operationByTask(preview, dueToday.id), undefined);
  assert.equal(operationByTask(preview, dueTomorrow.id)?.input.scheduledDate, '2026-08-28');
});

test('this-week scope ends on Sunday instead of drifting into the next week', () => {
  const friday = task('friday-this-week', {
    dueDate: '2026-08-29T05:00:00.000Z', // Friday at 10 PM local.
  });
  const sunday = task('sunday-this-week', {
    dueDate: '2026-08-31T05:00:00.000Z', // Sunday at 10 PM local.
  });
  const monday = task('monday-next-week', {
    dueDate: '2026-09-01T05:00:00.000Z', // Monday at 10 PM local.
  });
  const preview = plan({
    now: '2026-08-28T19:00:00.000Z', // Friday at noon local.
    request: request({ taskScope: 'this_week', horizonDays: 7 }),
    tasks: [friday, sunday, monday],
  });

  const scheduledIds = operations(preview).map(operation => operation.taskId);
  assert.ok(scheduledIds.includes(friday.id));
  assert.ok(scheduledIds.includes(sunday.id));
  assert.ok(!scheduledIds.includes(monday.id));
});

test('a future start date moves placement without redefining the deadline scope', () => {
  const currentWindow = task('current-window', {
    dueDate: '2026-08-28T22:00:00.000Z',
  });
  const futureWindow = task('future-window', {
    dueDate: '2026-09-04T22:00:00.000Z',
  });
  const preview = plan({
    request: request({
      taskScope: 'this_week',
      startDate: '2026-09-03',
      horizonDays: 3,
    }),
    tasks: [currentWindow, futureWindow],
  });

  assert.equal(preview.status, 'ready');
  assert.equal(operationByTask(preview, currentWindow.id)?.input.scheduledDate, '2026-09-03');
  assert.equal(operationByTask(preview, futureWindow.id), undefined);
});

test('an explicit future placement remains schedulable after an old deadline', () => {
  const overdue = task('future-overdue-placement');
  const preview = plan({
    request: request({
      taskScope: 'task_ids',
      taskIds: [overdue.id],
      startDate: '2026-09-03',
      horizonDays: 1,
    }),
    tasks: [overdue],
  });

  assert.equal(operationByTask(preview, overdue.id)?.input.scheduledDate, '2026-09-03');
  assert.ok(preview.assumptions.some(assumption => /original deadline has passed/i.test(assumption)));
});

test('light today caps new work at one hour and skip today leaves today empty', () => {
  const tasks = [
    task('alpha', { dueDate: '2026-09-01T18:00:00.000Z' }),
    task('beta', { dueDate: '2026-09-01T18:00:00.000Z' }),
  ];
  const commonRequest = {
    taskScope: 'task_ids',
    taskIds: tasks.map(item => item.id),
    horizonDays: 2,
  };
  const light = plan({
    request: request({ ...commonRequest, todayLoad: 'light' }),
    tasks,
  });
  const skipped = plan({
    request: request({ ...commonRequest, todayLoad: 'skip' }),
    tasks,
  });
  const lightTodayMinutes = operations(light)
    .filter(operation => operation.input.scheduledDate === '2026-08-27')
    .reduce((total, operation) => total + operation.input.durationSeconds / 60, 0);

  assert.ok(lightTodayMinutes > 0 && lightTodayMinutes <= 60);
  assert.ok(operations(light).some(operation => operation.input.scheduledDate === '2026-08-28'));
  assert.ok(light.assumptions.some(assumption => /kept today light/i.test(assumption)));
  assert.ok(operations(skipped).every(operation => operation.input.scheduledDate !== '2026-08-27'));
  assert.ok(skipped.assumptions.some(assumption => /left today free/i.test(assumption)));
});

test('placements avoid school, calendar events, and existing scheduled work', () => {
  const work = task('new-work', { dueDate: '2026-08-30T18:00:00.000Z' });
  const calendarEvent = {
    id: 'event-1',
    title: 'Practice',
    startAt: '2026-08-27T23:00:00.000Z', // 4 PM local.
    endAt: '2026-08-28T00:00:00.000Z',
  };
  const existing = occurrence(
    'existing-work',
    '2026-08-28T00:30:00.000Z', // 5:30 PM local.
    '2026-08-28T01:30:00.000Z',
  );
  const preview = plan({
    request: request({ taskScope: 'task_ids', taskIds: [work.id], horizonDays: 1 }),
    tasks: [work],
    busy: [calendarEvent],
    occurrences: [existing],
    settings: settings({
      schoolDays: [4],
      schoolStartTime: '08:00',
      schoolHomeTime: '15:30',
      bedtime: '23:00',
      maxDailyMinutes: 480,
    }),
  });
  const scheduled = operationByTask(preview, work.id);
  const scheduledStart = scheduled.input.startAt;
  const scheduledEnd = new Date(
    new Date(scheduledStart).getTime() + scheduled.input.durationSeconds * 1000,
  ).toISOString();

  assert.equal(scheduledStart, '2026-08-28T01:30:00.000Z');
  assert.ok(new Date(scheduledStart) >= new Date('2026-08-27T22:30:00.000Z'));
  assert.equal(overlaps(scheduledStart, scheduledEnd, calendarEvent.startAt, calendarEvent.endAt), false);
  assert.equal(overlaps(scheduledStart, scheduledEnd, existing.startAt, existing.endAt), false);
});

test('existing task work receives the configured break buffer', () => {
  const work = task('work-after-break', { dueDate: '2026-08-30T18:00:00.000Z' });
  const existing = occurrence(
    'existing-before-break',
    '2026-08-27T23:00:00.000Z', // 4 PM local.
    '2026-08-28T00:00:00.000Z', // 5 PM local.
  );
  const preview = plan({
    request: request({ taskScope: 'task_ids', taskIds: [work.id], horizonDays: 1 }),
    tasks: [work],
    occurrences: [existing],
    settings: settings({
      weekendAvailableStart: '16:00',
      weekendAvailableEnd: '18:00',
      minBreakMinutes: 15,
    }),
  });
  const scheduled = operationByTask(preview, work.id);

  assert.ok(scheduled);
  assert.equal(scheduled.input.startAt, '2026-08-28T00:15:00.000Z');
});

test('overnight availability uses the next local date across a DST boundary', () => {
  const overnight = task('overnight-work', {
    dueDate: '2026-11-05T18:00:00.000Z',
  });
  const preview = plan({
    now: '2026-10-31T20:00:00.000Z', // 1 PM PDT before the fall-back transition.
    request: request({
      taskScope: 'task_ids',
      taskIds: [overnight.id],
      startDate: '2026-10-31',
      horizonDays: 2,
    }),
    tasks: [overnight],
    settings: settings({
      weekendAvailableStart: '22:00',
      weekendAvailableEnd: '02:00',
    }),
  });
  const scheduled = operationByTask(preview, overnight.id);

  assert.ok(scheduled);
  assert.equal(scheduled.input.scheduledDate, '2026-10-31');
  assert.equal(scheduled.input.startAt, '2026-11-01T05:00:00.000Z');
});

test('work due during tomorrow school hours is scheduled the prior day before its deadline', () => {
  const dueDuringSchool = task('due-during-school', {
    dueDate: '2026-08-27T17:00:00.000Z', // Thursday at 10 AM local.
  });
  const preview = plan({
    now: '2026-08-26T19:00:00.000Z', // Wednesday at noon local.
    request: request({
      taskScope: 'task_ids',
      taskIds: [dueDuringSchool.id],
      horizonDays: 2,
    }),
    tasks: [dueDuringSchool],
    settings: settings({
      schoolDays: [3, 4],
      schoolStartTime: '08:00',
      schoolHomeTime: '15:30',
      bedtime: '23:00',
      maxDailyMinutes: 480,
    }),
  });
  const scheduled = operationByTask(preview, dueDuringSchool.id);
  const scheduledEnd = new Date(
    new Date(scheduled.input.startAt).getTime() + scheduled.input.durationSeconds * 1000,
  );

  assert.equal(scheduled.input.scheduledDate, '2026-08-26');
  assert.ok(scheduledEnd <= new Date(dueDuringSchool.due_date));
});

test('a passed deadline remains advisory and overdue work is still schedulable', () => {
  const overdue = task('late-but-actionable');
  const preview = plan({ tasks: [overdue] });

  assert.equal(preview.status, 'ready');
  assert.ok(operationByTask(preview, overdue.id));
  assert.ok(preview.assumptions.some(assumption => /original deadline has passed/i.test(assumption)));
});

test('partial capacity schedules what fits and honestly names the remainder', () => {
  const tasks = ['alpha', 'beta', 'gamma'].map(id => task(id));
  const preview = plan({
    request: request({ horizonDays: 1 }),
    tasks,
    settings: settings({
      schoolDays: [],
      weekendAvailableStart: '17:00',
      weekendAvailableEnd: '18:00',
      maxDailyMinutes: 60,
    }),
  });

  assert.equal(operations(preview).length, 1);
  assert.match(preview.summary, /Scheduled 1 of 3/);
  assert.ok(preview.assumptions.some(assumption => (
    /could not fit 2 (?:tasks|items)/i.test(assumption)
    && /beta/i.test(assumption)
    && /gamma/i.test(assumption)
  )), preview.assumptions.join('\n'));
});

test('identical snapshots produce byte-for-byte identical plans', () => {
  const tasks = [
    task('second', { dueDate: '2026-08-29T18:00:00.000Z' }),
    task('first', { dueDate: '2026-08-28T18:00:00.000Z' }),
  ];
  const input = {
    request: request({ taskScope: 'all_pending', horizonDays: 2 }),
    now: NOW,
    timeZone: TIME_ZONE,
    tasks,
    entries: [],
    occurrences: [],
    busy: [],
    settings: settings(),
  };

  assert.deepEqual(buildAssistantTaskPlan(input), buildAssistantTaskPlan(input));
});
