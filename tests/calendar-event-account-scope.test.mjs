import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const buildRoot = await mkdtemp(join(projectRoot, 'node_modules/.orderly-calendar-scope-test-'));

for (const relativePath of [
  'lib/planner/types.ts',
  'lib/planner/commitments.ts',
  'lib/planner/engine.ts',
  'lib/planner/adapters.ts',
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
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, transpiled.outputText);
}

const compiledRequire = createRequire(join(buildRoot, 'runtime.cjs'));
const {
  getLegacyCalendarEventsRecoveryInfo,
  legacyCalendarEventsMigrationStorageKey,
  readStoredCalendarEvents,
  recoverLegacyCalendarEvents,
  storedCalendarEventsStorageKey,
  writeStoredCalendarEvents,
} = compiledRequire(join(buildRoot, 'lib/planner/adapters.js'));

class MemoryStorage {
  #values = new Map();
  #failedSetKey = null;

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    if (String(key) === this.#failedSetKey) {
      this.#failedSetKey = null;
      throw new Error(`Injected write failure for ${String(key)}`);
    }
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  failNextSet(key) {
    this.#failedSetKey = String(key);
  }
}

after(async () => {
  await rm(buildRoot, { recursive: true, force: true });
});

test('browser calendar events stay isolated by signed-in account', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const browserWindow = new EventTarget();
  browserWindow.localStorage = localStorage;
  globalThis.window = browserWindow;

  try {
    const userAEvent = [{
      id: 'event-a',
      title: 'User A game',
      date: '2026-08-28',
      time: '18:00',
      endTime: '20:00',
    }];
    const userBEvent = [{
      id: 'event-b',
      title: 'User B class',
      date: '2026-08-29',
      time: '09:00',
      endTime: '10:00',
    }];

    // A pre-upgrade global value has no trustworthy owner. Preserve it for
    // recovery, but never expose it to whichever account happens to open first.
    localStorage.setItem('calendarEvents', JSON.stringify(userAEvent));
    assert.deepEqual(readStoredCalendarEvents('user-a'), []);
    assert.equal(localStorage.getItem('calendarEvents'), JSON.stringify(userAEvent));
    assert.deepEqual(readStoredCalendarEvents('user-b'), []);
    assert.equal(recoverLegacyCalendarEvents({
      userId: 'user-a',
      confirmedOwnerUserId: 'user-a',
    }).status, 'unavailable');

    writeStoredCalendarEvents('user-a', userAEvent);

    let changedUserId = null;
    browserWindow.addEventListener('orderly-calendar-events-changed', event => {
      changedUserId = event.detail?.userId || null;
    });
    writeStoredCalendarEvents('user-b', userBEvent);

    assert.equal(changedUserId, 'user-b');
    assert.deepEqual(readStoredCalendarEvents('user-a'), userAEvent);
    assert.deepEqual(readStoredCalendarEvents('user-b'), userBEvent);
    assert.notEqual(
      storedCalendarEventsStorageKey('user-a'),
      storedCalendarEventsStorageKey('user-b'),
    );

    // Anonymous reads/writes can never reveal or replace either account's data.
    writeStoredCalendarEvents(null, [{ id: 'leak', title: 'Leak', date: '2026-08-30' }]);
    assert.deepEqual(readStoredCalendarEvents(null), []);
    assert.deepEqual(readStoredCalendarEvents('user-a'), userAEvent);
    assert.deepEqual(readStoredCalendarEvents('user-b'), userBEvent);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('legacy events are never claimed passively and a persisted planner owner can recover them explicitly', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const browserWindow = new EventTarget();
  browserWindow.localStorage = localStorage;
  globalThis.window = browserWindow;

  try {
    const legacyEvents = [
      { id: 'legacy-game', title: 'Friday game', date: '2026-08-28', time: '18:00', endTime: '20:00' },
      { id: 'legacy-class', title: 'Saturday class', date: '2026-08-29', time: '09:00', endTime: '10:00' },
    ];
    const legacyRaw = JSON.stringify(legacyEvents);
    localStorage.setItem('calendarEvents', legacyRaw);
    localStorage.setItem('orderly-planner-storage', JSON.stringify({
      state: { activeUserId: 'user-a', users: {} },
      version: 1,
    }));

    // Merely signing in or inspecting availability cannot expose, copy, or
    // assign account A's legacy value to account B.
    assert.deepEqual(readStoredCalendarEvents('user-b'), []);
    assert.equal(getLegacyCalendarEventsRecoveryInfo('user-b').status, 'unavailable');
    assert.equal(localStorage.getItem(storedCalendarEventsStorageKey('user-b')), null);
    assert.equal(localStorage.getItem(legacyCalendarEventsMigrationStorageKey()), null);

    const result = recoverLegacyCalendarEvents({
      userId: 'user-a',
      confirmedOwnerUserId: 'user-a',
    });
    assert.equal(result.status, 'recovered');
    assert.equal(result.recoveredCount, 2);
    assert.deepEqual(result.events, legacyEvents);
    assert.deepEqual(readStoredCalendarEvents('user-a'), legacyEvents);
    assert.deepEqual(readStoredCalendarEvents('user-b'), []);

    const marker = JSON.parse(localStorage.getItem(legacyCalendarEventsMigrationStorageKey()));
    assert.equal(marker.ownerUserId, 'user-a');
    assert.equal(marker.status, 'imported');
    assert.equal(marker.eventCount, 2);
    // The pre-upgrade value remains an untouched recovery backup.
    assert.equal(localStorage.getItem('calendarEvents'), legacyRaw);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('a known legacy owner is the only account allowed to recover it', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const browserWindow = new EventTarget();
  browserWindow.localStorage = localStorage;
  globalThis.window = browserWindow;

  try {
    const legacyEvents = [{ id: 'known-owner-event', title: 'Owner event', date: '2026-08-30' }];
    localStorage.setItem('calendarEvents', JSON.stringify(legacyEvents));
    localStorage.setItem(legacyCalendarEventsMigrationStorageKey(), JSON.stringify({
      version: 1,
      ownerUserId: 'user-a',
      status: 'available',
      eventCount: 1,
      updatedAt: '2026-08-29T00:00:00.000Z',
    }));

    assert.equal(getLegacyCalendarEventsRecoveryInfo('user-b').status, 'unavailable');
    assert.equal(recoverLegacyCalendarEvents({
      userId: 'user-b',
      confirmedOwnerUserId: 'user-b',
    }).status, 'unavailable');
    assert.deepEqual(readStoredCalendarEvents('user-b'), []);

    assert.equal(recoverLegacyCalendarEvents({
      userId: 'user-a',
      confirmedOwnerUserId: 'user-a',
    }).status, 'recovered');
    assert.deepEqual(readStoredCalendarEvents('user-a'), legacyEvents);
    assert.deepEqual(readStoredCalendarEvents('user-b'), []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('a failed recovery write keeps the legacy backup and rolls back every partial claim', () => {
  const originalWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  const browserWindow = new EventTarget();
  browserWindow.localStorage = localStorage;
  globalThis.window = browserWindow;

  try {
    const existingEvents = [{ id: 'current-event', title: 'Current event', date: '2026-08-29' }];
    const legacyEvents = [{ id: 'legacy-event', title: 'Legacy event', date: '2026-08-30' }];
    const legacyRaw = JSON.stringify(legacyEvents);
    const scopedRaw = JSON.stringify(existingEvents);
    const availableMarkerRaw = JSON.stringify({
      version: 1,
      ownerUserId: 'user-a',
      status: 'available',
      eventCount: 1,
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    localStorage.setItem('calendarEvents', legacyRaw);
    localStorage.setItem(storedCalendarEventsStorageKey('user-a'), scopedRaw);
    localStorage.setItem(legacyCalendarEventsMigrationStorageKey(), availableMarkerRaw);
    // Fail after the scoped copy is written to exercise compensation rather
    // than the easy first-write failure path.
    localStorage.failNextSet(legacyCalendarEventsMigrationStorageKey());

    const result = recoverLegacyCalendarEvents({
      userId: 'user-a',
      confirmedOwnerUserId: 'user-a',
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(readStoredCalendarEvents('user-a'), existingEvents);
    assert.equal(localStorage.getItem(storedCalendarEventsStorageKey('user-a')), scopedRaw);
    assert.equal(localStorage.getItem(legacyCalendarEventsMigrationStorageKey()), availableMarkerRaw);
    assert.equal(localStorage.getItem('calendarEvents'), legacyRaw);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('every calendar-event consumer uses the account-scoped hook', async () => {
  for (const relativePath of [
    'components/calendar/ScheduleCalendar.tsx',
    'components/dashboard/DashboardSchedule.tsx',
    'components/planner/Planner.tsx',
    'components/planner/PlannerStalenessMonitor.tsx',
  ]) {
    const source = await readFile(join(projectRoot, relativePath), 'utf8');
    assert.match(source, /useStoredCalendarEvents\(/, relativePath);
    if (
      relativePath === 'components/dashboard/DashboardSchedule.tsx'
      || relativePath === 'components/planner/PlannerStalenessMonitor.tsx'
    ) {
      assert.doesNotMatch(source, /readStoredCalendarEvents\(/, relativePath);
      assert.doesNotMatch(source, /writeStoredCalendarEvents\(/, relativePath);
    } else if (relativePath === 'components/calendar/ScheduleCalendar.tsx') {
      // Calendar edits persist through the scoped adapter, always with the
      // current owner ID supplied explicitly.
      assert.doesNotMatch(source, /readStoredCalendarEvents\(/, relativePath);
      assert.match(source, /writeStoredCalendarEvents\(userId, nextEvents\)/);
    } else {
      // Planner's Undo can outlive an account switch, so it restores the
      // original owner's browser event snapshot directly through the scoped
      // adapter. The owner ID must be explicit on both calls.
      assert.match(source, /readStoredCalendarEvents\(operationUserId\)/);
      assert.match(source, /writeStoredCalendarEvents\(operationUserId, restoredEvents\)/);
    }
  }
});
