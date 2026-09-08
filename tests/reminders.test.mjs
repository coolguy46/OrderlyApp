import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAppReminders, claimReminder, createReminderScheduler, deliverUnseenReminders, reminderSummaryBody } from '../lib/reminders.ts';
import { defaultNotificationPrefs, parseNotificationPreferences, readNotificationPreferences, saveNotificationPreferences } from '../lib/notification-preferences.ts';

const now = new Date('2026-09-07T21:00:00Z');
const task = patch => ({ id: 'task', user_id: 'alex', title: 'Biology', source: 'canvas', due_date: '2026-09-07T21:15:00Z', due_time: '14:15', status: 'pending', ...patch });
const input = patch => ({ userId: 'alex', tasks: [], exams: [], goals: [], studySessions: [], activeStudySeconds: 0,
  preferences: defaultNotificationPrefs, timeZone: 'America/Los_Angeles', now, ...patch });
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('task reminders use exact deadlines, ignore old overdue/completed/other-account tasks', () => {
  const reminders = collectAppReminders(input({ tasks: [task(), task({ id: 'old', due_date: '2026-09-06T21:15:00Z' }), task({ id: 'later', due_date: '2026-09-07T23:15:00Z' }), task({ id: 'complete', status: 'completed' }), task({ id: 'other', user_id: 'jamie' })] }));
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].body, 'Biology is due in 15 minutes.');
});

test('manual date-only tasks remind near end of local day, not at stored midnight', () => {
  const tasks = [task({ source: 'manual', due_date: '2026-09-07', due_time: null })];
  assert.equal(collectAppReminders(input({ tasks })).length, 0);
  assert.equal(collectAppReminders(input({ tasks, now: new Date('2026-09-08T06:45:00Z') })).length, 1);
});

test('exam and goal reminders honor local dates and completed items', () => {
  const exams = [{ id: 'exam', user_id: 'alex', title: 'Quiz', source: 'manual', exam_date: '2026-09-08', subject_id: 'bio' }];
  const goals = [{ id: 'goal', user_id: 'alex', title: 'Outline', status: 'active', deadline: '2026-09-07', current_value: 1, target_value: 3 }];
  assert.deepEqual(collectAppReminders(input({ exams, goals })).map(item => item.title), ['Upcoming exam', 'Goal deadline approaching']);
  assert.equal(collectAppReminders(input({ goals: [{ ...goals[0], current_value: 3 }] })).length, 0);
  const imported = { ...exams[0], source: 'canvas', exam_date: '2026-09-08T17:00:00Z', external_id: 'provider-1' };
  assert.equal(collectAppReminders(input({ exams: [imported], tasks: [task({ status: 'completed', external_id: 'provider-1' })] })).length, 0);
});

test('study reminders and daily digest are opt-in and suppress already logged/active study', () => {
  assert.equal(collectAppReminders(input({})).length, 0);
  const preferences = { ...defaultNotificationPrefs, studyReminders: true, dailyDigest: true };
  assert.deepEqual(collectAppReminders(input({ preferences })).map(item => item.title), ['Make time to study', 'Your daily summary']);
  assert.deepEqual(collectAppReminders(input({ preferences, activeStudySeconds: 15 })).map(item => item.title), ['Your daily summary']);
  assert.deepEqual(collectAppReminders(input({ preferences, studySessions: [{ user_id: 'alex', duration_minutes: 5, started_at: now.toISOString() }] })).map(item => item.title), ['Your daily summary']);
  assert.match(collectAppReminders(input({ preferences, scheduledWorkCount: 2, eventCount: 1 })).at(-1).body, /2 work sessions and 1 events/);
});

test('each disabled reminder preference prevents its category', () => {
  const preferences = Object.fromEntries(Object.keys(defaultNotificationPrefs).map(key => [key, false]));
  assert.deepEqual(collectAppReminders(input({ preferences, tasks: [task()] })), []);
});

test('reminder claims survive reload, separate owners, prune stale entries and recover corrupt storage', () => {
  const storage = memory();
  assert.equal(claimReminder(storage, 'alex', 'task-1', now.getTime()), true);
  assert.equal(claimReminder(storage, 'alex', 'task-1', now.getTime()), false);
  assert.equal(claimReminder(storage, 'jamie', 'task-1', now.getTime()), true);
  assert.equal(claimReminder(storage, 'alex', 'task-1', now.getTime() + 8 * 86_400_000), true);
  storage.setItem('alex', '{corrupt');
  assert.equal(claimReminder(storage, 'alex', 'task-2', now.getTime()), true);
});

test('notification preferences accept only booleans and are scoped to the active account', () => {
  assert.deepEqual(parseNotificationPreferences({ taskReminders: 'false', dailyDigest: true }), { ...defaultNotificationPrefs, dailyDigest: true });
  const before = globalThis.localStorage;
  globalThis.localStorage = memory();
  try {
    assert.equal(saveNotificationPreferences('alex', { ...defaultNotificationPrefs, soundEnabled: false }), true);
    assert.equal(readNotificationPreferences('alex').soundEnabled, false);
    assert.equal(readNotificationPreferences('jamie').soundEnabled, true);
    assert.equal(saveNotificationPreferences('', defaultNotificationPrefs), false);
  } finally { globalThis.localStorage = before; }
});

test('frequent store ticks coalesce into one scan per 30 seconds; explicit refreshes and cleanup work', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  let scans = 0;
  const scheduler = createReminderScheduler(() => scans++);
  scheduler.immediate();
  for (let second = 0; second < 29; second++) { t.mock.timers.tick(1_000); scheduler.schedule(); }
  assert.equal(scans, 1);
  t.mock.timers.tick(1_000);
  assert.equal(scans, 2);
  scheduler.schedule(); scheduler.immediate();
  assert.equal(scans, 3, 'focus and preferences can refresh immediately');
  t.mock.timers.tick(30_000);
  assert.equal(scans, 3, 'immediate refresh cancels the pending trailing scan');
  scheduler.immediate(); scheduler.schedule(); scheduler.cancel();
  t.mock.timers.tick(30_000);
  assert.equal(scans, 4, 'unmount cancels pending work');
});

test('large reminder groups have bounded descriptions and only record IDs after successful visible delivery', () => {
  const storage = memory();
  const reminders = Array.from({ length: 100 }, (_, i) => ({ id: `task-${i}`, title: 'Task', body: `${i}: ${'Long assignment '.repeat(100)}`, href: '/tasks' }));
  const summary = reminderSummaryBody(reminders);
  assert.ok(summary.length < 800);
  assert.match(summary, /97 more reminders/);
  assert.equal(summary.split('\n').length, 4);
  assert.deepEqual(deliverUnseenReminders(storage, 'alex', reminders, now.getTime(), () => { throw new Error('Toast unavailable'); }), []);
  assert.equal(storage.getItem('alex'), null, 'failed presentation consumes no IDs');
  let displayed = 0;
  assert.equal(deliverUnseenReminders(storage, 'alex', reminders, now.getTime(), fresh => { displayed = fresh.length; }).length, 100);
  assert.equal(displayed, 100, 'visible group count represents all recorded IDs');
  assert.equal(Object.keys(JSON.parse(storage.getItem('alex'))).length, 100);
  assert.deepEqual(deliverUnseenReminders(storage, 'alex', reminders, now.getTime(), () => assert.fail('duplicate delivery')), []);
});
