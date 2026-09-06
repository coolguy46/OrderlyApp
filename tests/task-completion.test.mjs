import assert from 'node:assert/strict';
import test from 'node:test';
import { persistTaskCompletion } from '../lib/supabase/task-completion.ts';

function database(initial, { rpcError = null, updateError = null } = {}) {
  let row = initial && { ...initial };
  const calls = [];
  return {
    calls,
    get row() { return row; },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { changed: true, completed: { ...row, status: 'completed' }, successor: { id: 'next' } }, error: rpcError };
    },
    from: (table) => {
      assert.equal(table, 'tasks');
      let patch;
      let id;
      let excludedStatus;
      const query = {
        update(value) { patch = value; calls.push({ update: value }); return query; },
        eq(key, value) { assert.equal(key, 'id'); id = value; return query; },
        neq(key, value) { assert.equal(key, 'status'); excludedStatus = value; return query; },
        select() { return query; },
        async maybeSingle() {
          if (patch && updateError) return { data: null, error: updateError };
          if (!row || row.id !== id || row.status === excludedStatus) return { data: null, error: null };
          if (patch) row = { ...row, ...patch };
          return { data: { ...row }, error: null };
        },
      };
      return query;
    },
  };
}

test('ordinary and imported tasks complete durably without a database RPC', async () => {
  for (const source of ['manual', 'canvas', 'google_classroom']) {
    const db = database({ id: 'task', status: 'pending', source, due_date: '2026-08-01', description: 'Original' });
    const result = await persistTaskCompletion(db, 'task', null);
    assert.equal(result.changed, true);
    assert.equal(db.row.status, 'completed');
    assert.ok(Number.isFinite(Date.parse(db.row.completed_at)));
    assert.equal(db.row.due_date, '2026-08-01');
    assert.equal(db.row.description, 'Original');
    assert.equal(db.calls.some(call => call.name), false);
  }
});

test('retrying completion preserves its original timestamp and reports unchanged', async () => {
  const db = database({ id: 'task', status: 'in_progress' });
  await persistTaskCompletion(db, 'task', null);
  const timestamp = db.row.completed_at;
  const retried = await persistTaskCompletion(db, 'task', null);
  assert.equal(retried.changed, false);
  assert.equal(retried.completedTask.completed_at, timestamp);
});

test('missing or RLS-inaccessible tasks never report successful completion', async () => {
  await assert.rejects(persistTaskCompletion(database(null), 'task', null), /not found/);
});

test('database failure leaves the task pending and propagates the real error', async () => {
  const error = { code: '42501', message: 'permission denied' };
  const db = database({ id: 'task', status: 'pending' }, { updateError: error });
  await assert.rejects(persistTaskCompletion(db, 'task', null), e => e === error);
  assert.equal(db.row.status, 'pending');
});

test('repeating completion still uses one atomic transaction', async () => {
  const db = database({ id: 'task', status: 'pending' });
  const successor = { title: 'Next', recurrence: 'daily', recurrence_days: null };
  const result = await persistTaskCompletion(db, 'task', successor);
  assert.deepEqual(db.calls, [{ name: 'complete_task_with_successor', args: { p_task_id: 'task', p_successor: successor } }]);
  assert.equal(result.successorTask.id, 'next');
});

test('missing recurring RPC does not fall back to a partial series completion', async () => {
  const error = { code: 'PGRST202', message: 'function not found' };
  const db = database({ id: 'task', status: 'pending' }, { rpcError: error });
  await assert.rejects(persistTaskCompletion(db, 'task', { title: 'Next' }), e => e === error);
  assert.equal(db.row.status, 'pending');
  assert.equal(db.calls.length, 1);
});
