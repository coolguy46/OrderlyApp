import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  discardUnownedLegacyStorageValue,
  removeUserScopedStorageValues,
  userScopedStorageKey,
} from '../lib/user-scoped-storage.ts';

test('authenticated users receive distinct browser-storage keys', () => {
  const first = userScopedStorageKey('orderly-timer-state', 'user-a');
  const second = userScopedStorageKey('orderly-timer-state', 'user-b');

  assert.equal(first, 'orderly-timer-state:user-a');
  assert.equal(second, 'orderly-timer-state:user-b');
  assert.notEqual(first, second);
});

test('logged-out state cannot resolve an account-owned storage key', () => {
  assert.equal(userScopedStorageKey('calendar-events', null), null);
  assert.equal(userScopedStorageKey('calendar-events', undefined), null);
  assert.equal(userScopedStorageKey('calendar-events', ''), null);
});

test('user identifiers are encoded rather than changing key structure', () => {
  assert.equal(
    userScopedStorageKey('dismissed-exams', 'provider:user/example'),
    'dismissed-exams:provider%3Auser%2Fexample',
  );
});

test('unowned legacy values are discarded instead of assigned to a user', () => {
  const values = new Map([['legacy-global-key', '["private-value"]']]);
  const storage = {
    removeItem(key) {
      values.delete(key);
    },
  };

  discardUnownedLegacyStorageValue(storage, 'legacy-global-key');
  assert.equal(values.has('legacy-global-key'), false);
});

test('account deletion removes only the selected user browser values', () => {
  const values = new Map([
    ['timer:user-a', 'private-a'],
    ['prefs:user-a', 'private-a'],
    ['timer:user-b', 'private-b'],
    ['global-ui', 'shared'],
  ]);
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
  };

  removeUserScopedStorageValues(storage, 'user-a');
  assert.deepEqual([...values.keys()].sort(), ['global-ui', 'timer:user-b']);
});

test('logout clears chat, drafts and pending actions from session storage without clearing other accounts', async () => {
  const values = new Map([
    ['orderly:assistant-chat:v2:user-a', 'private chat'],
    ['orderly:assistant-calendar-draft:v2:user-a', 'private draft'],
    ['orderly:pending-chat:user-a', 'pending action'],
    ['orderly:conversation-id:user-a', 'conversation'],
    ['orderly:assistant-chat:v2:user-b', 'other chat'],
  ]);
  removeUserScopedStorageValues({
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
  }, 'user-a');
  assert.deepEqual([...values.keys()], ['orderly:assistant-chat:v2:user-b']);
  const source = await readFile(new URL('../lib/store.ts', import.meta.url), 'utf8');
  assert.match(source, /removeUserScopedStorageValues\(window\.sessionStorage, userId\)/);
});
