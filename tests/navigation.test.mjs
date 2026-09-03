import assert from 'node:assert/strict';
import test from 'node:test';

import { safeInternalPath } from '../lib/navigation.ts';

test('allows application-local redirect paths', () => {
  assert.equal(safeInternalPath('/tasks?filter=active#today'), '/tasks?filter=active#today');
});

test('rejects external and ambiguous redirect targets', () => {
  assert.equal(safeInternalPath('https://attacker.example'), '/');
  assert.equal(safeInternalPath('//attacker.example'), '/');
  assert.equal(safeInternalPath('/\\attacker.example'), '/');
  assert.equal(safeInternalPath('/tasks\nnext'), '/');
});
