import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = await mkdtemp(join(projectRoot, 'node_modules/.orderly-deadline-test-'));

const runtimeSources = [
  'lib/planner/types.ts',
  'lib/planner/commitments.ts',
  'lib/planner/engine.ts',
  'lib/planner/store.ts',
  'lib/planner/adapters.ts',
  'lib/schedule/types.ts',
  'lib/schedule/selectors.ts',
  'lib/schedule/commands.ts',
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
  const output = relativePath === 'lib/schedule/commands.ts'
    ? transpiled.outputText.replace(
      'require("@/lib/planner/adapters")',
      'require("../planner/adapters")',
    )
    : transpiled.outputText;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}

const compiledRequire = createRequire(join(buildRoot, 'runtime.cjs'));
const memoryStorage = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: key => memoryStorage.get(key) || null,
    setItem: (key, value) => memoryStorage.set(key, value),
    removeItem: key => memoryStorage.delete(key),
  },
});

const { generatePlannerPlan } = compiledRequire(join(buildRoot, 'lib/planner/engine.js'));
const { getDefaultPlannerSettings } = compiledRequire(join(buildRoot, 'lib/planner/types.js'));
const { usePlannerStore } = compiledRequire(join(buildRoot, 'lib/planner/store.js'));
const {
  interpretDirectScheduleRequest,
  interpretScheduleCommand,
  interpretScheduleCommands,
  scheduleEventActionToCommitment,
} = compiledRequire(join(buildRoot, 'lib/schedule/commands.js'));

after(async () => {
  delete globalThis.localStorage;
  await rm(buildRoot, { recursive: true, force: true });
});

function settings(overrides = {}) {
  return {
    ...getDefaultPlannerSettings('UTC'),
    schoolDays: [],
    weekendAvailableStart: '08:00',
    weekendAvailableEnd: '20:00',
    bedtime: '20:00',
    maxDailyMinutes: 240,
    minBreakMinutes: 0,
    ...overrides,
  };
}

function task(id, dueAt, estimateMinutes = 60) {
  return {
    id,
    title: id,
    priority: 'high',
    dueAt,
    estimateMinutes,
  };
}

test('overdue planner work remains schedulable and keeps an informational warning', () => {
  const plan = generatePlannerPlan({
    userId: 'user-1',
    now: '2026-08-27T07:00:00.000Z',
    settings: settings(),
    tasks: [task('overdue-task', '2026-08-26T17:00:00.000Z')],
  });

  assert.equal(plan.blocks.length, 1);
  assert.ok(new Date(plan.blocks[0].startAt) > new Date(plan.blocks[0].deadlineAt));
  assert.equal(plan.totalUnscheduledMinutes, 0);
  assert.ok(plan.warnings.some(warning => warning.code === 'deadline_passed'));
  assert.ok(!plan.warnings.some(warning => warning.code === 'insufficient_capacity'));
});

test('planner can place work after a future deadline without crossing school time', () => {
  const plan = generatePlannerPlan({
    userId: 'user-1',
    now: '2026-08-27T07:00:00.000Z',
    settings: settings({
      schoolDays: [4],
      wakeTime: '07:00',
      schoolStartTime: '08:00',
      schoolHomeTime: '16:00',
    }),
    tasks: [task('after-school-task', '2026-08-27T08:00:00.000Z')],
  });

  assert.equal(plan.blocks[0].startAt, '2026-08-27T16:00:00.000Z');
  assert.ok(plan.fixedIntervals.some(interval => (
    interval.kind === 'school'
    && interval.endAt === '2026-08-27T16:00:00.000Z'
  )));
  assert.ok(plan.warnings.some(warning => warning.code === 'scheduled_after_deadline'));
});

test('invalid task deadline metadata is warned about but does not discard the task', () => {
  const plan = generatePlannerPlan({
    userId: 'user-1',
    now: '2026-08-27T07:00:00.000Z',
    settings: settings(),
    tasks: [task('invalid-deadline-task', 'not-a-date')],
  });

  assert.equal(plan.blocks.length, 1);
  assert.ok(plan.warnings.some(warning => (
    warning.code === 'invalid_deadline'
    && /kept the task schedulable/i.test(warning.message)
  )));
});

test('manual planner edits allow late placement but still reject collisions', () => {
  const plan = generatePlannerPlan({
    userId: 'user-1',
    now: '2026-08-27T07:00:00.000Z',
    settings: settings(),
    tasks: [
      task('task-a', '2026-08-27T10:00:00.000Z'),
      task('task-b', '2026-08-27T10:00:00.000Z'),
    ],
  });
  usePlannerStore.setState({
    activeUserId: 'user-1',
    users: {
      'user-1': {
        settings: plan.settings,
        commitments: [],
        currentPlan: plan,
        history: [],
        messages: [],
        estimateCache: {},
        feedbackMultipliers: {},
        feedback: [],
        adjustments: [],
      },
    },
  });

  const first = plan.blocks.find(block => block.sourceId === 'task-a');
  assert.ok(first);
  const lateMove = usePlannerStore.getState().moveBlock(
    'user-1',
    first.id,
    '2026-08-27T11:00:00.000Z',
  );
  assert.equal(lateMove.ok, true);
  assert.ok(new Date(lateMove.value.endAt) > new Date(lateMove.value.deadlineAt));

  const collidingMove = usePlannerStore.getState().moveBlock(
    'user-1',
    first.id,
    '2026-08-27T09:00:00.000Z',
  );
  assert.equal(collidingMove.ok, false);
  assert.match(collidingMove.error, /overlaps “task-b”/i);
});

test('deterministic commands warn about late work while collisions remain blocking', () => {
  const overdueTask = {
    id: 'task-1',
    title: 'Late Assignment',
    recurrence: 'none',
    recurrence_days: null,
    due_date: '2026-08-26T17:00:00.000Z',
    due_time: null,
    source: 'canvas',
  };
  const context = {
    now: '2026-08-27T12:00:00.000Z',
    timeZone: 'UTC',
    tasks: [overdueTask],
    entries: [],
    occurrences: [],
  };
  const command = 'Schedule Late Assignment today at 5 pm for 45 minutes';
  const preview = interpretScheduleCommand(command, context);

  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions.length, 1);
  assert.ok(preview.assumptions.some(assumption => /extends past .* deadline/i.test(assumption)));

  const collision = interpretScheduleCommand(command, {
    ...context,
    busy: [{
      id: 'school-event',
      title: 'Class',
      startAt: '2026-08-27T17:00:00.000Z',
      endAt: '2026-08-27T18:00:00.000Z',
    }],
  });
  assert.equal(collision.status, 'clarification');
  assert.deepEqual(collision.actions, []);
  assert.match(collision.summary, /overlaps “Class”/);
});

test('direct Assistant scheduling keeps explicit PM ranges authoritative across timezone boundaries', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z', // Friday noon in Los Angeles.
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    selectedDate: '2026-08-24', // A calendar selection must not redefine “tonight”.
    busy: [{
      id: 'school-day',
      title: 'School day (07:00–15:30)',
      startAt: '2026-08-28T14:00:00.000Z',
      endAt: '2026-08-28T22:30:00.000Z',
    }],
  };

  for (const command of [
    'create a task for tonight from 10 pm to 11 pm to work on my common app',
    'Can you create a task tonight from 10 to 11 PM to work on my common app?',
    'please schedule Common App tonight from 22:00 to 23:00',
    'could u actually just add Common App tonight 10–11 PM',
  ]) {
    const preview = interpretDirectScheduleRequest(command, context);
    assert.ok(preview, command);
    assert.equal(preview.status, 'ready', `${command}: ${preview.summary}`);
    assert.equal(preview.actions.length, 1);
    assert.equal(preview.occurrences[0].date, '2026-08-28');
    assert.equal(preview.occurrences[0].startAt, '2026-08-29T05:00:00.000Z');
    assert.equal(preview.occurrences[0].durationSeconds, 3600);
    assert.doesNotMatch(preview.summary, /overlap/i);
  }
});

test('explicit event, game, and meeting requests create durable events instead of tasks', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };
  const cases = [
    ['create an event called Family Dinner tonight from 6 pm to 7 pm', 'other'],
    ['create a soccer game tomorrow from 4 pm to 5:30 pm', 'sports'],
    ['schedule counselor meeting tomorrow from 2 pm to 2:45 pm', 'appointment'],
    ['add a math class next Monday from 9 am to 10 am', 'class'],
  ];

  cases.forEach(([command, expectedKind], index) => {
    const preview = interpretDirectScheduleRequest(command, context);
    assert.ok(preview, command);
    assert.equal(preview.status, 'ready', `${command}: ${preview.summary}`);
    assert.equal(preview.actions.length, 1);
    const action = preview.actions[0];
    assert.equal(action.type, 'create_event', command);
    assert.equal(action.kind, expectedKind, command);
    assert.match(preview.summary, /Create event/i);

    const commitment = scheduleEventActionToCommitment(action, {
      id: `assistant-event-${index}`,
      timeZone: context.timeZone,
      updatedAt: context.now,
      color: '#3b82f6',
    });
    assert.ok(commitment, command);
    assert.equal(commitment.id, `assistant-event-${index}`);
    assert.equal(commitment.kind, expectedKind);
    assert.equal(commitment.timeZone, context.timeZone);
    assert.equal(commitment.enabled, true);
    assert.equal(commitment.startDate, action.schedule.scheduledDate);
    assert.equal(commitment.endDate, action.schedule.scheduledDate);
  });
});

test('task creation remains task creation even when the task mentions an event', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };

  for (const command of [
    'create a task tonight from 7 pm to 8 pm to prepare for the soccer game',
    'schedule chemistry homework tonight from 8 pm to 9 pm',
    'add an assignment called Meeting Reflection tomorrow at 5 pm for 30 minutes',
  ]) {
    const preview = interpretDirectScheduleRequest(command, context);
    assert.ok(preview, command);
    assert.equal(preview.status, 'ready', `${command}: ${preview.summary}`);
    assert.equal(preview.actions.length, 1);
    assert.equal(preview.actions[0].type, 'create_task', command);
    assert.match(preview.summary, /Create task/i);
  }
});

test('direct Assistant scheduling still blocks a genuine school-time intersection', () => {
  const preview = interpretDirectScheduleRequest(
    'create Common App tonight from 10 am to 11 am',
    {
      now: '2026-08-28T19:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      tasks: [],
      entries: [],
      occurrences: [],
      busy: [{
        id: 'school-day',
        title: 'School day (07:00–15:30)',
        startAt: '2026-08-28T14:00:00.000Z',
        endAt: '2026-08-28T22:30:00.000Z',
      }],
    },
  );

  assert.ok(preview);
  assert.equal(preview.status, 'clarification');
  assert.deepEqual(preview.actions, []);
  assert.match(preview.summary, /overlaps “School day/);
});

test('direct Assistant scheduling supports overnight ranges and keeps conversation as chat', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };
  const overnight = interpretDirectScheduleRequest(
    'schedule late study tonight from 11 pm to 12 am',
    context,
  );
  assert.ok(overnight);
  assert.equal(overnight.status, 'ready');
  assert.equal(overnight.occurrences[0].startAt, '2026-08-29T06:00:00.000Z');
  assert.equal(overnight.occurrences[0].durationSeconds, 3600);

  assert.equal(interpretDirectScheduleRequest('How does my week look?', context), null);
  assert.equal(interpretDirectScheduleRequest('What assignments are missing?', context), null);
});

test('direct scheduling distinguishes collection planning from exact titles containing broad words', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };

  for (const broad of [
    'Schedule my overdue',
    'Schedule my missing',
    'Schedule all my tasks after 5 pm',
    'Plan everything except chemistry',
    'Schedule those',
  ]) {
    assert.equal(interpretDirectScheduleRequest(broad, context), null, broad);
  }

  for (const exact of [
    'Schedule Overdue Chemistry tonight from 5 pm to 6 pm',
    'Schedule This Week Essay tomorrow at 5 pm for 30 minutes',
  ]) {
    const preview = interpretDirectScheduleRequest(exact, context);
    assert.ok(preview, exact);
    assert.equal(preview.status, 'ready', `${exact}: ${preview.summary}`);
    assert.equal(preview.actions.length, 1);
  }
});

test('direct scheduling requires an actual mutation request and preserves multi-action messages', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };

  for (const question of [
    'Can I study tonight from 4 pm to 5 pm?',
    'Should I study tonight from 4 pm to 5 pm?',
    'Can you tell me whether I can study tonight from 4 pm to 5 pm?',
    'Is 4 pm to 5 pm a good time to study?',
  ]) {
    assert.equal(interpretDirectScheduleRequest(question, context), null, question);
  }
  for (const bundle of [
    'Schedule workout today at 5 pm and Common App tomorrow at 10 pm for 1 hour',
    'Add homework today and workout tomorrow for 30 minutes',
    'Schedule workout from 5 pm to 6 pm and Common App from 10 pm to 11 pm',
  ]) {
    assert.equal(interpretDirectScheduleRequest(bundle, context), null, bundle);
  }
});

test('explicit direct multi-action requests preserve exact dates and meridiems before AI', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z', // Friday noon in Los Angeles.
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [{
      id: 'school-day',
      title: 'School day (07:00–15:30)',
      startAt: '2026-08-28T14:00:00.000Z',
      endAt: '2026-08-28T22:30:00.000Z',
    }],
  };

  const preview = interpretDirectScheduleRequest(
    'schedule workout today 5–6 PM and schedule Common App tonight 10–11 PM',
    context,
  );

  assert.ok(preview);
  assert.equal(preview.status, 'ready', preview.summary);
  assert.deepEqual(preview.commands, [
    'schedule workout today 5–6 PM',
    'schedule Common App tonight 10–11 PM',
  ]);
  assert.equal(preview.actions.length, 2);
  assert.equal(preview.occurrences.length, 2);
  assert.deepEqual(preview.occurrences.map(occurrence => ({
    title: occurrence.title,
    date: occurrence.date,
    startAt: occurrence.startAt,
    durationSeconds: occurrence.durationSeconds,
  })), [
    {
      title: 'Workout',
      date: '2026-08-28',
      startAt: '2026-08-29T00:00:00.000Z',
      durationSeconds: 3600,
    },
    {
      title: 'Common App',
      date: '2026-08-28',
      startAt: '2026-08-29T05:00:00.000Z',
      durationSeconds: 3600,
    },
  ]);
});

test('explicit direct bundles are atomic when any action is incomplete or ambiguous', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };

  for (const command of [
    'schedule workout today 5–6 PM and schedule Common App tonight',
    'schedule workout today 5–6 and schedule Common App tonight 10–11 PM',
  ]) {
    const preview = interpretDirectScheduleRequest(command, context);
    assert.ok(preview, command);
    assert.equal(preview.status, 'clarification', command);
    assert.deepEqual(preview.actions, [], command);
    assert.deepEqual(preview.occurrences, [], command);
    assert.match(preview.summary, /did not place any/i, command);
  }
});

test('safe multi-action splitting does not turn questions or activity prose into writes', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };

  assert.equal(
    interpretDirectScheduleRequest(
      'Can I schedule workout today 5–6 PM and schedule Common App tonight 10–11 PM?',
      context,
    ),
    null,
  );
  assert.equal(
    interpretDirectScheduleRequest(
      'I am deciding whether to schedule workout today and schedule Common App tonight',
      context,
    ),
    null,
  );

  const single = interpretDirectScheduleRequest(
    'schedule research and write essay tonight 5–6 PM',
    context,
  );
  assert.ok(single);
  assert.equal(single.status, 'ready');
  assert.equal(single.actions.length, 1);
});

test('direct scheduling cleans titles, rejects equal endpoints, and distinguishes title numbers from times', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };
  const clean = interpretDirectScheduleRequest(
    'schedule Common App tonight from 10 pm to 11 pm',
    context,
  );
  assert.equal(clean.status, 'ready');
  assert.equal(clean.actions[0].title, 'Common App');

  const numbered = interpretDirectScheduleRequest(
    'schedule 1-4 Problem Set tonight from 10 pm to 11 pm',
    context,
  );
  assert.equal(numbered.status, 'ready');
  assert.equal(numbered.actions[0].title, '1-4 Problem Set');
  assert.equal(numbered.occurrences[0].durationSeconds, 3600);

  const equal = interpretDirectScheduleRequest(
    'schedule Common App tonight from 10 pm to 10 pm',
    context,
  );
  assert.equal(equal.status, 'clarification');
  assert.match(equal.summary, /start and end time are the same/i);
  assert.deepEqual(equal.actions, []);
});

test('dayparts resolve short cross-midnight ranges and recurrence boundaries use the start date', () => {
  const context = {
    now: '2026-08-28T19:00:00.000Z',
    timeZone: 'America/Los_Angeles',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };
  const overnight = interpretDirectScheduleRequest(
    'schedule reading tonight from 11 to 1',
    context,
  );
  assert.equal(overnight.status, 'ready');
  assert.equal(overnight.occurrences[0].durationSeconds, 7200);

  const recurring = interpretDirectScheduleRequest(
    'schedule study for SAT next Monday at 6 pm for 30 minutes every day through Friday',
    context,
  );
  assert.equal(recurring.status, 'ready');
  assert.equal(recurring.actions[0].schedule.scheduledDate, '2026-08-31');
  assert.equal(recurring.actions[0].schedule.recurrenceEndDate, '2026-09-04');
  assert.equal(recurring.actions[0].title, 'SAT Study');
});

test('Assistant command bundles stage every change atomically and catch internal collisions', () => {
  const context = {
    now: '2026-08-27T12:00:00.000Z',
    timeZone: 'UTC',
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
  };
  const ready = interpretScheduleCommands([
    'Schedule workout today at 5 pm for 1 hour',
    'Schedule Common App tomorrow at 10 pm for 1 hour',
    'Schedule counselor meeting Saturday at 12 pm for 1 hour',
  ], context);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.commands.length, 3);
  assert.equal(ready.actions.length, 3);
  assert.equal(ready.occurrences.length, 3);
  assert.match(ready.summary, /3 calendar changes are ready/);

  const collision = interpretScheduleCommands([
    'Schedule workout today at 5 pm for 1 hour',
    'Schedule Common App today at 5:30 pm for 1 hour',
  ], context);
  assert.equal(collision.status, 'clarification');
  assert.deepEqual(collision.actions, []);
  assert.deepEqual(collision.occurrences, []);
  assert.match(collision.summary, /change 2 needs attention/i);

  const incomplete = interpretScheduleCommands([
    'Schedule workout today at 5 pm for 1 hour',
    'Schedule Common App tomorrow at 10 pm',
  ], context);
  assert.equal(incomplete.status, 'clarification');
  assert.deepEqual(incomplete.actions, []);
  assert.deepEqual(incomplete.occurrences, []);
  assert.match(incomplete.summary, /change 2 needs attention/i);
});

test('Assistant bundles keep untouched recurring occurrences busy after an occurrence move', () => {
  const recurringTask = {
    id: 'recurring-review',
    title: 'Recurring Review',
    status: 'pending',
    recurrence: 'daily',
    recurrence_days: null,
    due_date: null,
    due_time: null,
  };
  const entry = {
    id: 'entry-recurring-review',
    userId: 'user-1',
    taskId: recurringTask.id,
    scheduledDate: '2026-08-27',
    startAt: '2026-08-27T17:00:00.000Z',
    durationSeconds: 3600,
    recurrence: 'daily',
    recurrenceDays: null,
    recurrenceEndDate: '2026-08-28',
    occurrenceOverrides: {},
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  };
  const occurrence = (date, startAt) => ({
    id: `occurrence-${date}`,
    entryId: entry.id,
    taskId: recurringTask.id,
    task: recurringTask,
    title: recurringTask.title,
    description: null,
    subjectId: null,
    subject: null,
    color: null,
    date,
    recurrenceSourceDate: date,
    startAt,
    endAt: new Date(new Date(startAt).getTime() + 3_600_000).toISOString(),
    durationSeconds: 3600,
    timed: true,
    virtual: true,
    recurrence: 'daily',
  });
  const context = {
    now: '2026-08-27T12:00:00.000Z',
    timeZone: 'UTC',
    tasks: [recurringTask],
    entries: [entry],
    occurrences: [
      occurrence('2026-08-27', '2026-08-27T17:00:00.000Z'),
      occurrence('2026-08-28', '2026-08-28T17:00:00.000Z'),
    ],
    busy: [],
  };

  const preview = interpretScheduleCommands([
    'Move Recurring Review today at 7 pm',
    'Schedule workout tomorrow at 5:30 pm for 30 minutes',
  ], context);

  assert.equal(preview.status, 'clarification');
  assert.deepEqual(preview.actions, []);
  assert.match(preview.summary, /change 2 needs attention/i);
  assert.match(preview.summary, /overlaps “Recurring Review”/i);
});

test('resize keeps the effective occurrence date and start for later bundle collision checks', () => {
  const recurringTask = {
    id: 'focus-block',
    title: 'Focus Block',
    status: 'pending',
    recurrence: 'daily',
    recurrence_days: null,
    due_date: null,
    due_time: null,
  };
  const entry = {
    id: 'entry-focus-block',
    userId: 'user-1',
    taskId: recurringTask.id,
    scheduledDate: '2026-08-27',
    startAt: '2026-08-27T17:00:00.000Z',
    durationSeconds: 1800,
    recurrence: 'daily',
    recurrenceDays: null,
    recurrenceEndDate: '2026-08-28',
    occurrenceOverrides: {
      '2026-08-27': {
        scheduledDate: '2026-08-28',
        startAt: '2026-08-28T21:00:00.000Z',
      },
    },
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  };
  const movedOccurrence = {
    id: 'occurrence-focus-block-2026-08-27',
    entryId: entry.id,
    taskId: recurringTask.id,
    task: recurringTask,
    title: recurringTask.title,
    description: null,
    subjectId: null,
    subject: null,
    color: null,
    date: '2026-08-28',
    recurrenceSourceDate: '2026-08-27',
    startAt: '2026-08-28T21:00:00.000Z',
    endAt: '2026-08-28T21:30:00.000Z',
    durationSeconds: 1800,
    timed: true,
    virtual: true,
    recurrence: 'daily',
  };
  const context = {
    now: '2026-08-27T12:00:00.000Z',
    timeZone: 'UTC',
    tasks: [recurringTask],
    entries: [entry],
    occurrences: [movedOccurrence],
    busy: [],
  };

  const resized = interpretScheduleCommand('Resize Focus Block today to 2 hours', context);
  assert.equal(resized.status, 'ready');
  assert.equal(resized.occurrences.length, 1);
  assert.equal(resized.occurrences[0].date, '2026-08-28');
  assert.equal(resized.occurrences[0].startAt, '2026-08-28T21:00:00.000Z');
  assert.equal(resized.occurrences[0].durationSeconds, 7200);

  const bundled = interpretScheduleCommands([
    'Resize Focus Block today to 2 hours',
    'Schedule workout tomorrow at 10 pm for 30 minutes',
  ], context);
  assert.equal(bundled.status, 'clarification');
  assert.deepEqual(bundled.actions, []);
  assert.match(bundled.summary, /change 2 needs attention/i);
  assert.match(bundled.summary, /overlaps “Focus Block”/i);
});

test('direct scheduling surfaces deadline misses as warnings instead of returning early', async () => {
  const [planner, calendar, taskForm, store] = await Promise.all([
    readFile(join(projectRoot, 'components/planner/Planner.tsx'), 'utf8'),
    readFile(join(projectRoot, 'components/calendar/ScheduleCalendar.tsx'), 'utf8'),
    readFile(join(projectRoot, 'components/tasks/TaskForm.tsx'), 'utf8'),
    readFile(join(projectRoot, 'lib/planner/store.ts'), 'utf8'),
  ]);

  assert.match(planner, /toast\.warning\(`“\$\{task\.title\}” is scheduled after its deadline/);
  assert.doesNotMatch(planner, /toast\.error\([^\n]*deadline/i);
  assert.match(calendar, /toast\.warning\('Scheduled after the task deadline'/);
  assert.doesNotMatch(calendar, /toast\.error\([^\n]*deadline/i);
  assert.match(taskForm, /const schedulesAfterDeadline = Boolean/);
  assert.match(taskForm, /toast\.warning\('Scheduled after the task deadline'/);
  assert.doesNotMatch(taskForm, /setScheduleError\(`This block ends after the task deadline/);
  assert.doesNotMatch(store, /block cannot end after the exact task or exam deadline/i);
});
