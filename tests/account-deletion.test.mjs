import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  cleanupAccountStorage,
  isMissingAuthUserError,
} from '../lib/account-deletion.ts';

function createStorage(initialPaths) {
  const objects = new Set(initialPaths);
  const listOffsets = [];
  const removedBatches = [];
  const bucket = {
    async list(prefix, options) {
      listOffsets.push(options.offset);
      const childNames = new Map();
      const prefixWithSlash = `${prefix}/`;
      for (const path of objects) {
        if (!path.startsWith(prefixWithSlash)) continue;
        const remainder = path.slice(prefixWithSlash.length);
        const [name, ...rest] = remainder.split('/');
        childNames.set(name, rest.length === 0);
      }
      const data = [...childNames]
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, options.limit)
        .map(([name, isFile]) => ({ name, id: isFile ? `id:${name}` : null }));
      return { data, error: null };
    },
    async remove(paths) {
      removedBatches.push([...paths]);
      for (const path of paths) objects.delete(path);
      return { error: null };
    },
  };
  return {
    storage: { from: () => bucket },
    objects,
    listOffsets,
    removedBatches,
  };
}

test('bounded cleanup resumes past 1,000 objects without skipping shifted pages', async () => {
  const paths = Array.from(
    { length: 1_205 },
    (_, index) => `user-a/folder-${Math.floor(index / 250)}/file-${String(index).padStart(4, '0')}`,
  );
  const mock = createStorage(paths);

  const first = await cleanupAccountStorage(mock.storage, 'user-a');
  const second = await cleanupAccountStorage(mock.storage, 'user-a');
  const third = await cleanupAccountStorage(mock.storage, 'user-a');

  assert.equal(first.complete, false);
  assert.equal(second.complete, false);
  assert.equal(third.complete, true);
  assert.equal(first.removed + second.removed + third.removed, 1_205);
  assert.equal(mock.objects.size, 0);
  assert.ok(mock.removedBatches.every(batch => batch.length <= 100));
  assert.ok(mock.listOffsets.length > 12);
  assert.deepEqual(new Set(mock.listOffsets), new Set([0]));
});

test('missing Storage bucket is already clean and missing Auth user is success', async () => {
  const storage = {
    from: () => ({
      list: async () => ({ data: null, error: { status: 404, message: 'Bucket not found' } }),
      remove: async () => ({ error: null }),
    }),
  };
  const result = await cleanupAccountStorage(storage, 'user-a');

  assert.equal(result.complete, true);
  assert.equal(result.removed, 0);
  assert.equal(isMissingAuthUserError({ status: 404, message: 'User not found' }), true);
  assert.equal(isMissingAuthUserError({ status: 500, message: 'Database unavailable' }), false);
});

test('deletion queue is service-role-only and worker is authenticated', async () => {
  const [migration, dispatcher, worker, deletionRoute] = await Promise.all([
    readFile(new URL('../lib/supabase/account-deletion-migration.sql', import.meta.url), 'utf8'),
    readFile(new URL('../lib/supabase/account-deletion-dispatch-migration.sql', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/account/deletion/process/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/account/route.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.account_deletion_requests FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.account_deletion_requests TO service_role/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(migration, /REFERENCES auth\.users/);
  assert.match(dispatcher, /name = 'account_deletion_endpoint_url'/);
  assert.match(dispatcher, /\^https:\/\/\[\^\/\?#\]\+\/api\/account\/deletion\/process\$/);
  assert.match(dispatcher, /name = 'canvas_sync_cron_secret'/);
  assert.match(worker, /authorization/);
  assert.match(worker, /CANVAS_SYNC_CRON_SECRET/);
  assert.match(deletionRoute, /\.from\('account_deletion_requests'\)[\s\S]*\.upsert/);
  assert.ok(
    deletionRoute.indexOf(".from('account_deletion_requests')")
      < deletionRoute.indexOf('claimAccountDeletionRequests(admin'),
    'the durable request must be enqueued before destructive progress starts',
  );
  assert.doesNotMatch(deletionRoute, /MAX_ACCOUNT_STORAGE_OBJECTS/);
  assert.match(deletionRoute, /status: 'queued'/);
  assert.match(deletionRoute, /\{ status: 202 \}/);
});
