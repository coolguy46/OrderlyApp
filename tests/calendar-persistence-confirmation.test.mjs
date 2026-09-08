import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { confirmCalendarPersistence } from '../lib/schedule/confirm-calendar-persistence.ts';

test('calendar confirmation waits for durable success rather than the optimistic mutation', async () => {
  let finish;
  let result;
  const pending = confirmCalendarPersistence(() => new Promise(resolve => { finish = resolve; }), () => true).then(value => { result = value; });
  await Promise.resolve();
  assert.equal(result, undefined);
  finish(true);
  await pending;
  assert.equal(result, 'saved');
});

test('failed or thrown persistence stays pending and never reports saved', async () => {
  assert.equal(await confirmCalendarPersistence(async () => false, () => true), 'pending');
  assert.equal(await confirmCalendarPersistence(async () => { throw new Error('private provider detail'); }, () => true), 'pending');
});

test('an account change suppresses both success and failure feedback from the previous account', async () => {
  for (const saved of [true, false]) {
    let finish;
    let owner = 'first';
    const pending = confirmCalendarPersistence(() => new Promise(resolve => { finish = resolve; }), () => owner === 'first');
    owner = 'second';
    finish(saved);
    assert.equal(await pending, 'stale');
  }
});

for (const path of ['components/calendar/ScheduleCalendar.tsx', 'components/planner/Planner.tsx']) {
  test(`${path} confirms all task gestures and event gestures before success`, async () => {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const name of ['handleMove', 'handleResize', 'handleScheduleUntimed', 'handleMoveToUntimed']) {
      const handler = source.match(new RegExp(`const ${name} = useCallback\\(async \\([\\s\\S]*?\\n  \\}, \\[`))?.[0];
      assert.ok(handler, name);
      assert.match(handler, /await confirmTaskChange\(/, name);
      assert.doesNotMatch(handler, /toast\.success\(`\$\{occurrence\.title\} (?:scheduled|moved to untimed)/, name);
    }
    assert.match(source, /if \(await persistCommitmentOccurrence\(/);
    assert.match(source, /\(\) => waitForPlannerPersistence\(userId\)/);
    assert.match(source, /\(\) => useAppStore\.getState\(\)\.user\?\.id === userId/);
  });
}
