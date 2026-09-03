import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = await mkdtemp(join(projectRoot, 'node_modules/.orderly-assistant-query-test-'));

for (const relativePath of [
  'lib/schedule/types.ts',
  'lib/schedule/selectors.ts',
  'lib/task-status.ts',
  'lib/planner/assistant-task-query.ts',
]) {
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

  let output = transpiled.outputText
    .replace('require("./schedule/selectors.ts")', 'require("./schedule/selectors")')
    .replace('require("@/lib/task-status")', 'require("../task-status")')
    .replace('require("@/lib/schedule/selectors")', 'require("../schedule/selectors")');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}

const compiledRequire = createRequire(join(buildRoot, 'runtime.cjs'));
const { answerAssistantTaskQuery, resolveAssistantTaskQuery } = compiledRequire(
  join(buildRoot, 'lib/planner/assistant-task-query.js'),
);

after(async () => {
  await rm(buildRoot, { recursive: true, force: true });
});
const NOW = '2026-08-28T19:00:00.000Z'; // Friday noon in Los Angeles.
const TIME_ZONE = 'America/Los_Angeles';

function task(id, dueDate, status = 'pending') {
  return {
    id,
    user_id: 'user-1',
    subject_id: null,
    title: `Assignment ${id}`,
    description: '',
    priority: 'medium',
    status,
    due_date: dueDate,
    due_time: null,
    recurrence: 'none',
    recurrence_days: null,
    completed_at: status === 'completed' ? '2026-08-27T20:00:00.000Z' : null,
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-28T12:00:00.000Z',
    source: 'canvas',
    external_id: id,
    external_url: null,
    course_name: null,
    assignment_type: 'assignment',
  };
}

test('an all-overdue question reports every unfinished overdue task, not a provider-sized subset', () => {
  const overdue = Array.from({ length: 12 }, (_, index) => (
    task(`overdue-${index + 1}`, `2026-08-${String(20 + (index % 7)).padStart(2, '0')}T18:00:00.000Z`)
  ));
  const response = answerAssistantTaskQuery({
    message: 'can you list all my overdue assignments?',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [
      ...overdue,
      task('completed-overdue', '2026-08-25T18:00:00.000Z', 'completed'),
      task('future', '2026-08-30T18:00:00.000Z'),
    ],
  });

  assert.match(response, /You have 12 unfinished tasks overdue:/);
  for (const item of overdue) assert.match(response, new RegExp(item.title));
  assert.doesNotMatch(response, /completed-overdue|Assignment future/);
});

test('today and tomorrow questions use exact local deadline dates', () => {
  const today = task('today', '2026-08-29T05:30:00.000Z'); // Fri 10:30 PM PDT
  const tomorrow = task('tomorrow', '2026-08-30T02:00:00.000Z'); // Sat 7 PM PDT
  const tasks = [today, tomorrow];

  const todayResponse = answerAssistantTaskQuery({
    message: 'what tasks are due today?',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks,
  });
  assert.match(todayResponse, /Assignment today/);
  assert.doesNotMatch(todayResponse, /Assignment tomorrow/);

  const tomorrowResponse = answerAssistantTaskQuery({
    message: 'show my tasks due tomorrow',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks,
  });
  assert.match(tomorrowResponse, /Assignment tomorrow/);
  assert.doesNotMatch(tomorrowResponse, /Assignment today/);
});

test('today-or-tomorrow questions include both dates instead of requiring both', () => {
  const today = task('today-or', '2026-08-29T05:30:00.000Z');
  const tomorrow = task('tomorrow-or', '2026-08-30T02:00:00.000Z');
  const later = task('later-or', '2026-08-31T02:00:00.000Z');
  const result = resolveAssistantTaskQuery({
    message: 'show my tasks due today or tomorrow',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [today, tomorrow, later],
  });

  assert.deepEqual(result.taskIds, [today.id, tomorrow.id]);
  assert.match(result.reply, /today or tomorrow/i);
  assert.doesNotMatch(result.reply, /Assignment later-or/);
});

test('natural tell-me wording resolves the complete overdue list locally', () => {
  const first = task('tell-overdue-1', '2026-08-25T18:00:00.000Z');
  const second = task('tell-overdue-2', '2026-08-26T18:00:00.000Z');
  const result = resolveAssistantTaskQuery({
    message: 'tell me all my overdue assignments',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [first, second],
  });

  assert.deepEqual(result.taskIds, [first.id, second.id]);
  assert.match(result.reply, /2 unfinished tasks overdue/i);
});

test('mutation requests bypass factual answers and continue into the planner', () => {
  const response = answerAssistantTaskQuery({
    message: 'schedule all my overdue tasks but keep today light',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [task('overdue', '2026-08-25T18:00:00.000Z')],
  });

  assert.equal(response, null);
});

test('the exact overdue-plus-essay screenshot bypasses task Q&A and reaches the composite planner', () => {
  const response = answerAssistantTaskQuery({
    message: "Schedule all of my overdue work plus four hours for my college essay. I'm free after 2:15 PM today.",
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [
      task('overdue', '2026-08-25T18:00:00.000Z'),
      task('college-essay', '2026-09-05T18:00:00.000Z'),
    ],
  });

  assert.equal(response, null);
});

test('the exact misspelled scedual-them screenshot bypasses task Q&A', () => {
  const response = answerAssistantTaskQuery({
    message: 'can you please scedual them but dont overload today I am pretty busy today',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [task('overdue', '2026-08-25T18:00:00.000Z')],
  });

  assert.equal(response, null);
});

test('a list-prefixed request with a scheduling typo is still treated as a mutation', () => {
  const response = answerAssistantTaskQuery({
    message: 'show my overdue tasks and scedual them',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [task('overdue', '2026-08-25T18:00:00.000Z')],
  });

  assert.equal(response, null);
});

test('all pending questions bypass the provider cap and include undated work', () => {
  const pending = Array.from({ length: 35 }, (_, index) => (
    task(`pending-${index + 1}`, index === 34 ? null : '2026-09-10T18:00:00.000Z')
  ));
  const result = resolveAssistantTaskQuery({
    message: 'show all my pending tasks',
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: pending,
  });

  assert.equal(result.scope, 'all_pending');
  assert.equal(result.taskIds.length, 35);
  assert.match(result.reply, /You have 35 unfinished tasks pending:/);
  assert.match(result.reply, /Assignment pending-35/);
  assert.match(result.reply, /No deadline/);
});

test('date and overdue words compose as an intersection', () => {
  const sameDayOverdue = task('same-day-overdue', '2026-08-28T18:00:00.000Z');
  const olderOverdue = task('older-overdue', '2026-08-27T18:00:00.000Z');
  const laterToday = task('later-today', '2026-08-29T05:30:00.000Z');
  const result = resolveAssistantTaskQuery({
    message: "which of today's tasks are overdue?",
    now: NOW,
    timeZone: TIME_ZONE,
    tasks: [sameDayOverdue, olderOverdue, laterToday],
  });

  assert.deepEqual(result.taskIds, [sameDayOverdue.id]);
  assert.match(result.reply, /overdue today/);
});
