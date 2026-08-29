import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { deleteOwnedTaskWithToken } from '../lib/supabase/task-compensation.ts';

test('account-stable compensation sends the original session and verifies the deleted row', async () => {
  let request = null;
  const deleted = await deleteOwnedTaskWithToken({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    taskId: 'task/one',
    ownerUserId: 'user-a',
    accessToken: 'owner-token',
  }, async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify([{ id: 'task/one' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  assert.equal(deleted, true);
  assert.equal(request.init.method, 'DELETE');
  assert.equal(request.init.headers.Authorization, 'Bearer owner-token');
  assert.equal(request.init.headers.Prefer, 'return=representation');
  const url = new URL(request.url);
  assert.equal(url.pathname, '/rest/v1/tasks');
  assert.equal(url.searchParams.get('id'), 'eq.task/one');
  assert.equal(url.searchParams.get('user_id'), 'eq.user-a');
});

test('compensation is idempotently successful when the task is already absent', async () => {
  const noRows = await deleteOwnedTaskWithToken({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    taskId: 'task-1',
    ownerUserId: 'user-a',
    accessToken: 'owner-token',
  }, async () => new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal(noRows, true);
});

test('compensation reports authentication and network failures', async () => {
  const denied = await deleteOwnedTaskWithToken({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    taskId: 'task-1',
    ownerUserId: 'user-a',
    accessToken: 'owner-token',
  }, async () => new Response('denied', { status: 401 }));
  const unavailable = await deleteOwnedTaskWithToken({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'public-key',
    taskId: 'task-1',
    ownerUserId: 'user-a',
    accessToken: 'owner-token',
  }, async () => {
    throw new TypeError('network unavailable');
  });

  assert.equal(denied, false);
  assert.equal(unavailable, false);
});

test('reversible task creation uses a stable ID and compensates a lost response', async () => {
  const storeSource = await readFile(new URL('../lib/store.ts', import.meta.url), 'utf8');
  const addTaskStart = storeSource.indexOf('addTask: async');
  const addTaskSection = storeSource.slice(
    addTaskStart,
    storeSource.indexOf('finalizeTaskCreations:', addTaskStart),
  );

  assert.match(addTaskSection, /const taskId = crypto\.randomUUID\(\)/);
  assert.match(addTaskSection, /db\.createTask\(\{[\s\S]*id: taskId/);
  assert.match(addTaskSection, /if \(!newTask && options\?\.reversible && reversibleAccessToken\)[\s\S]*compensateInterruptedTaskCreation/);
  assert.match(addTaskSection, /catch \(error\)[\s\S]*compensateInterruptedTaskCreation\(user\.id, taskId, reversibleAccessToken\)/);
});

test('failed and thrown reversible deletes both remain queued for retry', async () => {
  const storeSource = await readFile(new URL('../lib/store.ts', import.meta.url), 'utf8');
  const deleteTaskStart = storeSource.indexOf('deleteTask: async');
  const deleteTaskSection = storeSource.slice(
    deleteTaskStart,
    storeSource.indexOf('completeTask:', deleteTaskStart),
  );

  assert.match(deleteTaskSection, /if \(receipt\) queuePendingTaskCleanup\(receipt\.ownerUserId, id\);/);
  const catchSection = deleteTaskSection.slice(deleteTaskSection.indexOf('catch (error)'));
  assert.match(catchSection, /if \(receipt\) queuePendingTaskCleanup\(receipt\.ownerUserId, id\);/);
});

test('task persistence uses idempotent stable-ID upsert and idempotent delete', async () => {
  const serviceSource = await readFile(new URL('../lib/supabase/services.ts', import.meta.url), 'utf8');
  const createTaskSection = serviceSource.slice(
    serviceSource.indexOf('export async function createTask'),
    serviceSource.indexOf('export async function updateTask'),
  );
  const deleteTaskSection = serviceSource.slice(
    serviceSource.indexOf('export async function deleteTask('),
    serviceSource.indexOf('export async function deleteTaskWithAccessToken'),
  );

  assert.match(createTaskSection, /id: task\.id \|\| crypto\.randomUUID\(\)/);
  assert.match(createTaskSection, /\.upsert\(cleanTask, \{ onConflict: 'id' \}\)/);
  assert.match(deleteTaskSection, /return true;/);
  assert.doesNotMatch(deleteTaskSection, /data\.some|data\.length/);
});
