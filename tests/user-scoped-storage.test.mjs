import assert from 'node:assert/strict';
import test from 'node:test';

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
