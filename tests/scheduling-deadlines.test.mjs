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
const { interpretScheduleCommand } = compiledRequire(join(buildRoot, 'lib/schedule/commands.js'));

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
