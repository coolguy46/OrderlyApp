import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  countCanvasCourses,
  countCanvasCoursesForCompleteSnapshot,
} from '../lib/integrations/canvas-course-count.ts';
import {
  isCanvasProviderThrottleMigrationError,
  parseCanvasProviderRequestClaim,
} from '../lib/integrations/canvas-provider-request.ts';

const readRepoFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('parses granted and rate-limited provider request claims', () => {
  assert.deepEqual(
    parseCanvasProviderRequestClaim([{
      claim_token: 'opaque-token',
      retry_after_seconds: 0,
    }]),
    { token: 'opaque-token', retryAfterSeconds: 0 },
  );
  assert.deepEqual(
    parseCanvasProviderRequestClaim({
      claim_token: null,
      retry_after_seconds: 27,
    }),
    { token: null, retryAfterSeconds: 27 },
  );
});

test('fails closed on malformed provider request claims', () => {
  for (const payload of [
    null,
    [],
    { claim_token: '', retry_after_seconds: 0 },
    { claim_token: null, retry_after_seconds: 0 },
    { claim_token: 'token', retry_after_seconds: 1 },
  ]) {
    assert.throws(
      () => parseCanvasProviderRequestClaim(payload),
      /claim response was invalid/,
    );
  }
});

test('recognizes missing provider-throttle schema without treating auth errors as migrations', () => {
  assert.equal(isCanvasProviderThrottleMigrationError({ code: 'PGRST202' }), true);
  assert.equal(isCanvasProviderThrottleMigrationError({ code: '42P01' }), true);
  assert.equal(isCanvasProviderThrottleMigrationError({ code: '42703' }), true);
  assert.equal(isCanvasProviderThrottleMigrationError({
    message: 'Could not find public.claim_canvas_provider_request',
  }), true);
  assert.equal(isCanvasProviderThrottleMigrationError({ code: '42501' }), false);
});

test('counts course IDs once and reconciles name-only events to a known course', () => {
  assert.equal(countCanvasCourses([
    { courseId: '101', courseName: 'Calculus' },
    { courseId: '101', courseName: 'Calculus' },
    { courseId: undefined, courseName: ' calculus ' },
    { courseId: '202', courseName: 'Calculus' },
    { courseId: undefined, courseName: 'Physics' },
    { courseId: undefined, courseName: 'PHYSICS' },
    { courseId: undefined, courseName: 'Unknown Course' },
    { courseId: undefined, courseName: '' },
  ]), 3);
});

test('retains the previous course count for empty or incomplete snapshots', () => {
  const assignments = [{ courseId: '101', courseName: 'Calculus' }];

  assert.equal(countCanvasCoursesForCompleteSnapshot([], 0), null);
  assert.equal(countCanvasCoursesForCompleteSnapshot(assignments, 2), null);
  assert.equal(countCanvasCoursesForCompleteSnapshot(assignments, 1), 1);
});

test('validate and manual sync claim before provider fetch and expose Retry-After', async () => {
  const [validateRoute, syncRoute] = await Promise.all([
    readRepoFile('app/api/canvas/validate/route.ts'),
    readRepoFile('app/api/canvas/sync/route.ts'),
  ]);

  assert.ok(validateRoute.indexOf('auth.getUser()') < validateRoute.indexOf("requested_kind: 'validate'"));
  assert.ok(validateRoute.indexOf("requested_kind: 'validate'") < validateRoute.indexOf('getCanvasFeedSummary(icalUrl)'));
  assert.match(validateRoute, /status: 429[\s\S]*'Retry-After'/);
  assert.match(validateRoute, /finally \{[\s\S]*release_canvas_provider_request/);
  assert.ok(syncRoute.indexOf("requested_kind: 'manual_sync'") < syncRoute.indexOf("syncCanvasUser(admin"));
  assert.match(syncRoute, /status: 429[\s\S]*'Retry-After'/);
  assert.match(syncRoute, /finally \{[\s\S]*release_canvas_provider_request/);
});

test('Canvas summary GET reads persisted course_count without fetching the provider', async () => {
  const syncRoute = await readRepoFile('app/api/canvas/sync/route.ts');
  const getHandler = syncRoute.slice(syncRoute.indexOf('export async function GET'));

  assert.match(getHandler, /select\('ical_url, course_count'\)/);
  assert.doesNotMatch(getHandler, /getCanvasFeedSummary|fetch\(/);
  assert.match(getHandler, /courses: courseCount/);
});

test('a rejected cleanup snapshot cannot replace the last good course count', async () => {
  const serverSync = await readRepoFile('lib/integrations/canvas-server-sync.ts');

  assert.match(
    serverSync,
    /const courseCountToPersist = orphanCleanupSkipped\s*\? null\s*:\s*completedCourseCount/,
  );
  const rejectedConfirmation = serverSync.indexOf(
    'orphanCleanupSkipped = !isConfirmedCanvasCleanupSnapshot',
  );
  const persistedCount = serverSync.indexOf(
    'const courseCountToPersist = orphanCleanupSkipped',
  );
  assert.notEqual(rejectedConfirmation, -1);
  assert.notEqual(persistedCount, -1);
  assert.ok(
    rejectedConfirmation < persistedCount,
  );
  assert.match(serverSync, /completeCanvasSyncLease\([\s\S]*courseCountToPersist/);
});
