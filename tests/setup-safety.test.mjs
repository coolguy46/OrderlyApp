import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  canvasFeedUrlValidationMessage,
  normalizeCanvasFeedUrl,
} from '../lib/integrations/canvas-feed-url.ts';
import {
  hasCompletedSetupMetadata,
  SETUP_COMPLETED_METADATA_KEY,
  setupCompletionMetadataUpdate,
} from '../lib/setup-completion.ts';

test('Canvas setup accepts only the private HTTPS feed shape used by Canvas', () => {
  assert.equal(
    normalizeCanvasFeedUrl('  https://School.Instructure.com/feeds/calendars/user_secret.ics#ignored  '),
    'https://school.instructure.com/feeds/calendars/user_secret.ics',
  );
  assert.equal(
    canvasFeedUrlValidationMessage('https://instructure.com/feeds/calendars/user_secret.ics'),
    null,
  );

  const rejected = [
    '',
    'not a URL',
    'http://school.instructure.com/feeds/calendars/user_secret.ics',
    'javascript:alert(1)',
    'https://user:password@school.instructure.com/feeds/calendars/user_secret.ics',
    'https://school.instructure.com:8443/feeds/calendars/user_secret.ics',
    'https://school.instructure.com.evil.test/feeds/calendars/user_secret.ics',
    'https://school.instructure.com/feeds/calendars/',
    'https://school.instructure.com/feeds/calendars/user_secret.ics/extra',
    'https://school.instructure.com/courses/1',
  ];

  rejected.forEach((candidate) => {
    assert.ok(canvasFeedUrlValidationMessage(candidate), `expected ${candidate || '<empty>'} to be rejected`);
    assert.throws(() => normalizeCanvasFeedUrl(candidate));
  });
});

test('setup completion metadata is strict, durable data rather than a truthy browser value', () => {
  assert.equal(hasCompletedSetupMetadata(null), false);
  assert.equal(hasCompletedSetupMetadata({}), false);
  assert.equal(hasCompletedSetupMetadata({ [SETUP_COMPLETED_METADATA_KEY]: false }), false);
  assert.equal(hasCompletedSetupMetadata({ [SETUP_COMPLETED_METADATA_KEY]: 'yes' }), false);
  assert.equal(hasCompletedSetupMetadata({ [SETUP_COMPLETED_METADATA_KEY]: true }), true);
  assert.equal(
    hasCompletedSetupMetadata({ [SETUP_COMPLETED_METADATA_KEY]: '2026-08-26T20:00:00.000Z' }),
    true,
  );
  assert.deepEqual(
    setupCompletionMetadataUpdate(new Date('2026-08-26T20:00:00.000Z')),
    { [SETUP_COMPLETED_METADATA_KEY]: '2026-08-26T20:00:00.000Z' },
  );
  assert.throws(() => setupCompletionMetadataUpdate(new Date('invalid')));
});

test('setup preflights Canvas before persistence and completes durably before navigation', async () => {
  const setup = await readFile(new URL('../app/setup/page.tsx', import.meta.url), 'utf8');
  const validateIndex = setup.indexOf('validateCanvasFeedForSetup(canvasUrl)');
  const persistIndex = setup.indexOf('db.upsertCanvasSettings');
  const durableIndex = setup.indexOf('db.markSetupComplete(user.id)');
  const localIndex = setup.indexOf('localStorage.setItem(setupStorageKey');
  const navigateIndex = setup.indexOf("router.replace('/')");

  assert.ok(validateIndex >= 0 && validateIndex < persistIndex);
  assert.ok(durableIndex >= 0 && durableIndex < localIndex);
  assert.ok(localIndex >= 0 && localIndex < navigateIndex);

  const validateRoute = await readFile(new URL('../app/api/canvas/validate/route.ts', import.meta.url), 'utf8');
  assert.ok(validateRoute.indexOf('auth.getUser()') < validateRoute.indexOf('getCanvasFeedSummary(icalUrl)'));
  assert.match(validateRoute, /MAX_REQUEST_BYTES/);

  const guard = await readFile(new URL('../components/auth/AuthGuard.tsx', import.meta.url), 'utf8');
  assert.match(guard, /db\.getSetupCompletion\(user\.id\)/);
  assert.match(guard, /db\.markSetupComplete\(user\.id\)/);
});

test('setup icon and selection controls expose accessible names and state', async () => {
  const setup = await readFile(new URL('../app/setup/page.tsx', import.meta.url), 'utf8');
  assert.match(setup, /aria-label="Add subject"/);
  assert.match(setup, /aria-label={`Remove \${subject\.name}`}/);
  assert.match(setup, /aria-label={`Use subject color \${color}`}/);
  assert.match(setup, /aria-pressed={newSubjectColor === color}/);
  assert.match(setup, /aria-pressed={selectedTheme === option\.value}/);
  assert.match(setup, /aria-invalid={Boolean\(canvasUrlError\)}/);
});

test('setup starts with the profile step and does not render the retired welcome screen', async () => {
  const setup = await readFile(new URL('../app/setup/page.tsx', import.meta.url), 'utf8');

  assert.match(setup, /const STEPS = \['profile', 'subjects', 'integrations', 'preferences', 'complete'\]/);
  assert.match(setup, /useState<Step>\('profile'\)/);
  assert.doesNotMatch(setup, /Welcome to Orderly!/);
  assert.doesNotMatch(setup, /currentStep === 'welcome'/);
});

test('public product copy describes current features without retired marketing claims', async () => {
  const [landing, register, taskForm, taskDetail, dailyPanel] = await Promise.all([
    readFile(new URL('../app/landing/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/auth/register/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/tasks/TaskForm.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/tasks/TaskDetailViewer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/planner/DailyTaskPanel.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(landing, /Canvas stays current/);
  assert.match(landing, /Plan time your way/);
  assert.doesNotMatch(landing, /testimonial|10K\+|500K\+|1M\+|4\.9\/5|gamif|competition/i);
  assert.doesNotMatch(register, /gamif|competition|join thousands/i);
  assert.doesNotMatch(`${taskForm}\n${taskDetail}\n${dailyPanel}`, />Google Classroom<|'Google Classroom'/);
});
