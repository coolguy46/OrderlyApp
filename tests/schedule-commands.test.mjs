import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = await mkdtemp(join(projectRoot, 'node_modules/.orderly-schedule-commands-test-'));

for (const relativePath of ['lib/schedule/types.ts', 'lib/schedule/selectors.ts', 'lib/schedule/commands.ts']) {
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
  const output = transpiled.outputText.replace(
    'require("@/lib/planner/adapters")',
    'require("../planner/adapters")',
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}

await mkdir(join(buildRoot, 'lib/planner'), { recursive: true });
await writeFile(join(buildRoot, 'lib/planner/adapters.js'), `
exports.plannerTaskDeadline = function plannerTaskDeadline(task) {
  if (!task || !task.due_date) return null;
  const parsed = new Date(task.due_date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
`);

const compiledRequire = createRequire(join(buildRoot, 'runtime.cjs'));
const {
  describeScheduleCommandDraft,
  interpretDirectScheduleRequest,
  interpretScheduleCommand,
  scheduleEventActionToCommitment,
} = compiledRequire(join(buildRoot, 'lib/schedule/commands.js'));

after(async () => {
  await rm(buildRoot, { recursive: true, force: true });
});

const TIME_ZONE = 'America/Los_Angeles';
const NOW = '2026-08-27T19:00:00.000Z';

function context(overrides = {}) {
  return {
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [],
    entries: [],
    occurrences: [],
    busy: [],
    selectedTaskId: null,
    selectedEventId: null,
    selectedDate: '2026-08-27',
    availableStartTime: '08:00',
    availableEndTime: '23:00',
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 'task-overdue',
    user_id: 'user-1',
    subject_id: null,
    title: 'Essay Draft',
    description: null,
    priority: 'medium',
    status: 'pending',
    due_date: '2026-08-25T23:00:00.000Z',
    due_time: '16:00',
    recurrence: 'none',
    recurrence_days: null,
    completed_at: null,
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-20T12:00:00.000Z',
    source: 'canvas',
    external_id: 'canvas-essay',
    external_url: null,
    course_name: 'English',
    assignment_type: 'assignment',
    ...overrides,
  };
}

test('creates a genuine event while preserving exact local date, range, and title', () => {
  const preview = interpretScheduleCommand(
    'Create an event called Soccer Practice tomorrow from 4 PM to 5:30 PM.',
    context(),
  );

  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions.length, 1);
  const action = preview.actions[0];
  assert.equal(action.type, 'create_event');
  assert.equal(action.title, 'Soccer Practice');
  assert.equal(action.schedule.scheduledDate, '2026-08-28');
  assert.equal(action.schedule.startAt, '2026-08-28T23:00:00.000Z');
  assert.equal(action.schedule.durationSeconds, 90 * 60);

  const commitment = scheduleEventActionToCommitment(action, {
    id: 'event-1',
    timeZone: TIME_ZONE,
    updatedAt: NOW,
  });
  assert.ok(commitment);
  assert.equal(commitment.startTime, '16:00');
  assert.equal(commitment.endTime, '17:30');
  assert.equal('dueAt' in commitment, false);
  assert.equal('status' in commitment, false);
});

test('creates a genuine task with the exact requested work session', () => {
  const preview = interpretScheduleCommand(
    'Create a task to work on my essay Saturday from 2 PM to 3 PM.',
    context(),
  );

  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions.length, 1);
  const action = preview.actions[0];
  assert.equal(action.type, 'create_task');
  assert.equal(action.title, 'Work On My Essay');
  assert.equal(action.schedule.scheduledDate, '2026-08-29');
  assert.equal(action.schedule.startAt, '2026-08-29T21:00:00.000Z');
  assert.equal(action.schedule.durationSeconds, 60 * 60);
});

test('an elided mixed request preserves event vs task semantics and clean titles', () => {
  const preview = interpretDirectScheduleRequest(
    'Add a hiking event on Wednesday from 4 PM to 5 PM and a pickleball task on Thursday from 6 PM to 7 PM.',
    context(),
  );

  assert.ok(preview, 'the complete explicit bundle should stay in the deterministic path');
  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions.length, 2);
  assert.equal(preview.actions[0].type, 'create_event');
  assert.equal(preview.actions[0].title, 'Hiking');
  assert.equal(preview.actions[0].schedule.recurrence, 'none');
  assert.equal(preview.actions[1].type, 'create_task');
  assert.equal(preview.actions[1].title, 'Pickleball');
  assert.equal(preview.actions[1].schedule.recurrence, 'none');
  assert.doesNotMatch(preview.summary, /requested repeat rule/i);

  const reply = describeScheduleCommandDraft(preview, TIME_ZONE);
  assert.match(reply, /Hiking[\s\S]*event[\s\S]*Wednesday, Sep 2[\s\S]*4 PM–5 PM/i);
  assert.match(reply, /Pickleball[\s\S]*task[\s\S]*Thursday, Aug 27[\s\S]*6 PM–7 PM/i);
  assert.doesNotMatch(reply, /calendar changes are ready|requested repeat rule/i);
});

test('the reported mixed hiking and pickleball wording creates the right item types', () => {
  const preview = interpretDirectScheduleRequest(
    'can you add a hiking even on saturday morning from 4 am to 9 am and then add a pickleball task from 4 to 5 pm or saturday',
    context(),
  );

  assert.ok(preview);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions.length, 2);
  assert.equal(preview.actions[0].type, 'create_event');
  assert.equal(preview.actions[0].title, 'Hiking');
  assert.equal(preview.actions[0].schedule.scheduledDate, '2026-08-29');
  assert.equal(preview.actions[0].schedule.startAt, '2026-08-29T11:00:00.000Z');
  assert.equal(preview.actions[0].schedule.durationSeconds, 5 * 60 * 60);
  assert.equal(preview.actions[0].schedule.recurrence, 'none');
  assert.equal(preview.actions[1].type, 'create_task');
  assert.equal(preview.actions[1].title, 'Pickleball');
  assert.equal(preview.actions[1].schedule.scheduledDate, '2026-08-29');
  assert.equal(preview.actions[1].schedule.startAt, '2026-08-29T23:00:00.000Z');
  assert.equal(preview.actions[1].schedule.durationSeconds, 60 * 60);
  assert.equal(preview.actions[1].schedule.recurrence, 'none');
  assert.doesNotMatch(preview.summary, /requested repeat rule/i);
});

test('event typo tolerance does not change a legitimate Even Numbers task title', () => {
  const preview = interpretScheduleCommand(
    'Create an Even Numbers task on Saturday from 10 AM to 11 AM.',
    context(),
  );

  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions.length, 1);
  assert.equal(preview.actions[0].type, 'create_task');
  assert.equal(preview.actions[0].title, 'Even Numbers');
});

test('a follow-up can move the event selected by the previous successful action', () => {
  const preview = interpretScheduleCommand('Move it to 5 PM.', context({
    selectedEventId: 'event-1',
    busy: [{
      id: 'commitment:event-1:2026-08-28',
      commitmentId: 'event-1',
      occurrenceDate: '2026-08-28',
      title: 'Soccer Practice',
      startAt: '2026-08-28T23:00:00.000Z',
      endAt: '2026-08-29T00:30:00.000Z',
    }],
  }));

  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions[0].type, 'update_event');
  assert.equal(preview.actions[0].commitmentId, 'event-1');
  assert.equal(preview.actions[0].schedule.scheduledDate, '2026-08-28');
  assert.equal(preview.actions[0].schedule.startAt, '2026-08-29T00:00:00.000Z');
  assert.equal(preview.actions[0].schedule.durationSeconds, 90 * 60);
});

test('a real conflict warns but preserves an explicitly selected time', () => {
  const school = {
    id: 'school-1',
    title: 'School day',
    startAt: '2026-08-27T14:00:00.000Z',
    endAt: '2026-08-27T22:30:00.000Z',
  };
  const duringSchool = interpretScheduleCommand(
    'Create a task called Study Notes today from 10 AM to 11 AM.',
    context({ busy: [school] }),
  );
  assert.equal(duringSchool.status, 'ready');
  assert.equal(duringSchool.actions[0].schedule.startAt, '2026-08-27T17:00:00.000Z');
  assert.match(duringSchool.assumptions.join(' '), /overlaps School day.*kept your requested time/i);

  const atNight = interpretScheduleCommand(
    'Create a task called Common App today from 10 PM to 11 PM.',
    context({ busy: [school] }),
  );
  assert.equal(atNight.status, 'ready');
  assert.equal(atNight.actions[0].schedule.startAt, '2026-08-28T05:00:00.000Z');
  assert.doesNotMatch(atNight.assumptions.join(' '), /School day/i);
});

test('overdue Canvas work remains schedulable after its unchanged deadline', () => {
  const overdueTask = task();
  const preview = interpretScheduleCommand(
    'Schedule Essay Draft tomorrow from 6 PM to 7 PM.',
    context({ tasks: [overdueTask], selectedTaskId: overdueTask.id }),
  );

  assert.equal(preview.status, 'ready');
  assert.equal(preview.actions[0].type, 'schedule_batch');
  assert.equal(preview.actions[0].operations[0].taskId, overdueTask.id);
  assert.equal(preview.actions[0].operations[0].input.scheduledDate, '2026-08-28');
  assert.match(preview.assumptions.join(' '), /deadline.*due date stays unchanged/i);
});

test('overnight events keep the selected start date and next-day duration', () => {
  const preview = interpretScheduleCommand(
    'Create an event called Hackathon tonight from 11 PM to 1 AM.',
    context(),
  );
  assert.equal(preview.status, 'ready');
  const action = preview.actions[0];
  assert.equal(action.type, 'create_event');
  assert.equal(action.schedule.scheduledDate, '2026-08-27');
  assert.equal(action.schedule.durationSeconds, 2 * 60 * 60);
  const commitment = scheduleEventActionToCommitment(action, {
    id: 'event-overnight',
    timeZone: TIME_ZONE,
    updatedAt: NOW,
  });
  assert.ok(commitment);
  assert.equal(commitment.startTime, '23:00');
  assert.equal(commitment.endTime, '01:00');
});
