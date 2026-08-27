import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parsePendingStudySession } from '../lib/timer-session-recovery.ts';
import {
  parseRecoveredTimerState,
  selectNewestRecoveredTimerState,
} from '../lib/timer-state-recovery.ts';
import { createSerializedTimerStateWriter } from '../lib/timer-state-writer.ts';

function pendingSession(userId = 'user-1') {
  return {
    session: {
      id: 'session-1',
      user_id: userId,
      subject_id: null,
      task_id: null,
      duration_minutes: 25,
      session_type: 'pomodoro',
      started_at: '2026-08-26T18:00:00.000Z',
      ended_at: '2026-08-26T18:25:00.000Z',
      notes: null,
    },
    outcome: {
      kind: 'complete-focus',
      sessionsCompletedAfter: 2,
      nextMode: 'shortBreak',
    },
    createdAt: '2026-08-26T18:25:00.000Z',
  };
}

test('pending timer sessions restore only for their owning account', () => {
  const pending = pendingSession();
  assert.deepEqual(parsePendingStudySession(pending, 'user-1'), pending);
  assert.equal(parsePendingStudySession(pending, 'user-2'), null);
});

test('malformed recovery payloads are rejected before a database retry', () => {
  const pending = pendingSession();
  assert.equal(parsePendingStudySession({ ...pending, session: { ...pending.session, duration_minutes: 0 } }, 'user-1'), null);
  assert.equal(parsePendingStudySession({ ...pending, outcome: { kind: 'complete-focus' } }, 'user-1'), null);
});

test('timer reset waits for an in-flight checkpoint and deletes last', async () => {
  const events = [];
  let releaseUpsert;
  const upsertGate = new Promise((resolve) => { releaseUpsert = resolve; });
  const writer = createSerializedTimerStateWriter({
    async upsert() {
      events.push('upsert:start');
      await upsertGate;
      events.push('upsert:end');
    },
    async remove() {
      events.push('delete');
    },
  });

  const generation = writer.begin('user-1');
  const checkpoint = writer.save('user-1', generation, { seconds: 10 });
  await Promise.resolve();
  await Promise.resolve();
  const reset = writer.clear('user-1');
  releaseUpsert();
  await Promise.all([checkpoint, reset]);

  assert.deepEqual(events, ['upsert:start', 'upsert:end', 'delete']);
});

test('stale checkpoint cleanup cannot resurrect a cleared timer', async () => {
  const events = [];
  const writer = createSerializedTimerStateWriter({
    async upsert() { events.push('upsert'); },
    async remove() { events.push('delete'); },
  });

  const staleGeneration = writer.begin('user-1');
  await writer.clear('user-1');
  await writer.save('user-1', staleGeneration, { seconds: 10 });

  assert.deepEqual(events, ['delete']);
});

test('a newly started timer is saved after the preceding reset delete', async () => {
  const events = [];
  const writer = createSerializedTimerStateWriter({
    async upsert(_userId, state) { events.push(`upsert:${state.seconds}`); },
    async remove() { events.push('delete'); },
  });

  const reset = writer.clear('user-1');
  const generation = writer.begin('user-1');
  const save = writer.save('user-1', generation, { seconds: 1 });
  await Promise.all([reset, save]);

  assert.deepEqual(events, ['delete', 'upsert:1']);
});

test('a null Supabase upsert result rejects instead of pretending the checkpoint succeeded', async () => {
  const writer = createSerializedTimerStateWriter({
    async upsert() { return null; },
    async remove() { return true; },
  });

  const generation = writer.begin('user-1');
  await assert.rejects(
    writer.save('user-1', generation, { seconds: 10 }),
    /save was not persisted/,
  );
});

test('a false Supabase delete result rejects so the local recovery copy can be retained', async () => {
  const writer = createSerializedTimerStateWriter({
    async upsert() { return { id: 'state-1' }; },
    async remove() { return false; },
  });

  await assert.rejects(
    writer.clear('user-1'),
    /clear was not persisted/,
  );
});

function recoveredTimer(overrides = {}) {
  return {
    timerType: 'pomodoro',
    mode: 'focus',
    isRunning: true,
    pomodoroStartedAt: '2026-08-26T18:00:00.000Z',
    stopwatchStartedAt: null,
    savedAt: '2026-08-26T18:10:00.000Z',
    timeLeft: 20 * 60,
    stopwatchTime: 0,
    subjectId: '',
    sessionsCompleted: 0,
    soundEnabled: true,
    pomodoroStarted: true,
    stopwatchStarted: false,
    pendingStudySession: null,
    ...overrides,
  };
}

test('owned long-duration timer snapshots remain valid recovery input', () => {
  const snapshot = recoveredTimer({ timeLeft: 23 * 60 * 60 });
  assert.deepEqual(parseRecoveredTimerState(snapshot, 'user-1'), snapshot);
});

test('malformed timer snapshots cannot poison component state', () => {
  assert.equal(parseRecoveredTimerState(recoveredTimer({ mode: 'invalid' }), 'user-1'), null);
  assert.equal(parseRecoveredTimerState(recoveredTimer({ timeLeft: -1 }), 'user-1'), null);
  assert.equal(parseRecoveredTimerState(recoveredTimer({ sessionsCompleted: 1e12 }), 'user-1'), null);
  assert.equal(parseRecoveredTimerState(recoveredTimer({ soundEnabled: 'yes' }), 'user-1'), null);
});

test('timer recovery selects the newest valid local or remote checkpoint', () => {
  const local = recoveredTimer({ savedAt: '2026-08-26T18:10:00.000Z', timeLeft: 1200 });
  const newerRemote = recoveredTimer({ savedAt: '2026-08-26T18:11:00.000Z', timeLeft: 1140 });
  assert.deepEqual(
    selectNewestRecoveredTimerState(local, newerRemote, 'user-1'),
    { source: 'remote', state: newerRemote },
  );

  const olderRemote = recoveredTimer({ savedAt: '2026-08-26T18:09:00.000Z', timeLeft: 1260 });
  assert.deepEqual(
    selectNewestRecoveredTimerState(local, olderRemote, 'user-1'),
    { source: 'local', state: local },
  );
});

test('a malformed local timer cannot suppress a valid remote checkpoint', () => {
  const remote = recoveredTimer({ savedAt: '2026-08-26T18:11:00.000Z' });
  assert.deepEqual(
    selectNewestRecoveredTimerState({ ...recoveredTimer(), mode: 'invalid' }, remote, 'user-1'),
    { source: 'remote', state: remote },
  );
});

test('a timer read outage is not treated as an empty remote checkpoint', async () => {
  const [serviceSource, componentSource] = await Promise.all([
    readFile(new URL('../lib/supabase/services.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/study/PomodoroTimer.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(serviceSource, /Error fetching timer state:[\s\S]*throw error/);
  assert.match(componentSource, /setTimerStateRestoreFailed\(true\)/);
  assert.match(componentSource, /timerStateRestorePending/);
  assert.match(componentSource, /Always read the synced row/);
});

test('timer reset uses the identity-checking RPC instead of a zero-row delete', async () => {
  const serviceSource = await readFile(
    new URL('../lib/supabase/services.ts', import.meta.url),
    'utf8',
  );
  assert.match(serviceSource, /rpc\('clear_own_timer_state'/);
  assert.doesNotMatch(serviceSource, /from\('timer_states'\)[\s\S]{0,120}\.delete\(\)/);
  assert.match(serviceSource, /data !== true/);
});
