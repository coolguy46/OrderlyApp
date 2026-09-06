import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readRepoFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Canvas dispatcher is environment-scoped and fails closed', async () => {
  const sql = await readRepoFile(
    'lib/supabase/canvas-background-dispatch-migration.sql',
  );

  assert.match(sql, /name = 'canvas_sync_endpoint_url'/);
  assert.match(sql, /\^https:\/\/\[\^\/\?#\]\+\/api\/canvas\/background-sync\$/);
  assert.match(sql, /url := endpoint_url/);
  assert.doesNotMatch(sql, /https:\/\/(?:www\.)?myorderlyapp\.com/);
  assert.doesNotMatch(sql, /https:\/\/orderlyappp\.vercel\.app/);
});

test('friendship hardening is non-destructive and freezes identity', async () => {
  const sql = await readRepoFile(
    'lib/supabase/friendship-rls-hardening-migration.sql',
  );

  assert.match(sql, /Friendship preflight failed/);
  assert.match(sql, /friendships_no_self_request CHECK \(user_id <> friend_id\)/);
  assert.match(sql, /NEW\.id IS DISTINCT FROM OLD\.id/);
  assert.match(sql, /NEW\.created_at IS DISTINCT FROM OLD\.created_at/);
  assert.doesNotMatch(sql, /DELETE FROM public\.friendships/i);
});

test('relationship guards reject cross-account subject, task, and exam links', async () => {
  const sql = await readRepoFile(
    'lib/supabase/relationship-ownership-migration.sql',
  );

  assert.match(sql, /enforce_owned_subject_reference/);
  assert.match(sql, /enforce_owned_task_reference/);
  assert.match(sql, /enforce_owned_exam_reference/);
  assert.match(sql, /parent\.user_id = NEW\.user_id/g);
  assert.match(sql, /timer_states_enforce_owned_subject/);
  assert.match(sql, /planner_blocks_enforce_owned_exam/);
  assert.match(sql, /Relationship ownership preflight failed/);
});

test('atomic completion validates successor subject ownership', async () => {
  const sql = await readRepoFile(
    'lib/supabase/task-completion-atomic-migration.sql',
  );

  assert.match(sql, /successor_subject_id UUID/);
  assert.match(sql, /subject\.user_id = current_task\.user_id/);
  assert.match(sql, /Recurring successor subject is not owned by the task owner/);
  assert.match(sql, /NULLIF\(p_successor->'recurrence_days', 'null'::JSONB\)/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
});

test('dormant competitions expose no browser-readable or writable policies', async () => {
  const sql = await readRepoFile(
    'lib/supabase/competition-lockdown-migration.sql',
  );

  assert.match(sql, /DROP POLICY IF EXISTS "Anyone can view competitions"/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.competitions FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.competition_participants FROM anon, authenticated/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
});

test('fresh schema is explicit, complete, and has no browser profile insert', async () => {
  const sql = await readRepoFile('lib/supabase/schema.sql');

  assert.match(sql, /FRESH BOOTSTRAP ONLY/);
  assert.match(sql, /CREATE TABLE timer_states/);
  assert.match(sql, /CREATE TRIGGER tasks_enforce_owned_subject/);
  assert.match(sql, /REVOKE INSERT ON profiles FROM anon, authenticated/);
  assert.doesNotMatch(sql, /FOR INSERT WITH CHECK \(true\)/);
  assert.match(sql, /Legacy compatibility value; not maintained/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
});

test('README documents prerequisites before deployment and dispatcher last', async () => {
  const readme = await readRepoFile('README.md');
  const taskCompletion = readme.indexOf('task-completion-atomic-migration.sql');
  const concurrency = readme.indexOf('canvas-sync-concurrency-migration.sql');
  const throttle = readme.indexOf('canvas-provider-throttle-migration.sql');
  const deploy = readme.indexOf('7. Deploy');
  const dispatcher = readme.indexOf('canvas-background-dispatch-migration.sql');

  assert.ok(taskCompletion >= 0 && taskCompletion < concurrency);
  assert.ok(concurrency >= 0 && concurrency < throttle);
  assert.ok(throttle >= 0 && throttle < deploy);
  assert.ok(deploy >= 0 && deploy < dispatcher);
  assert.match(readme, /schema\.sql` is \*\*fresh-bootstrap-only\*\*/);
  assert.match(readme, /canvas_sync_endpoint_url/);
  assert.match(readme, /must not be presented as live statistics/);
});

test('Canvas provider migration atomically throttles requests and fences course metadata', async () => {
  const sql = await readRepoFile(
    'lib/supabase/canvas-provider-throttle-migration.sql',
  );

  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.canvas_provider_request_limits/);
  assert.match(sql, /ALTER TABLE public\.canvas_provider_request_limits ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.canvas_provider_request_limits FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /actor_id UUID := auth\.uid\(\)/);
  assert.match(sql, /validation_last_started_at <= claim_time - interval '30 seconds'/);
  assert.match(sql, /manual_sync_last_started_at <= claim_time - interval '60 seconds'/);
  assert.match(sql, /manual_sync_claim_expires_at = claim_time \+ interval '2 minutes'/);
  assert.match(sql, /expected_claim_token/);
  assert.match(sql, /limits\.manual_sync_claim_token = expected_claim_token/);
  assert.match(sql, /NEW\.course_count IS DISTINCT FROM OLD\.course_count/);
  assert.match(sql, /completed_course_count INTEGER/);
  assert.match(sql, /completed_course_count IS NOT NULL AND completed_course_count < 0/);
  assert.match(sql, /WHEN completed_course_count IS NULL THEN settings\.course_count/);
  assert.match(sql, /ELSE completed_course_count/);
  assert.match(sql, /settings\.sync_lease_token = expected_lease_token/);
  assert.match(sql, /settings\.sync_revision = expected_revision/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_canvas_provider_request\(TEXT\) TO authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.complete_canvas_sync\([\s\S]*\) TO service_role/);
});

test('incremental normalization uses transactions and table-scoped checks', async () => {
  const [timer, scheduling, recurrence, planner] = await Promise.all([
    readRepoFile('lib/supabase/timer-state-migration.sql'),
    readRepoFile('lib/supabase/task-scheduling-migration.sql'),
    readRepoFile('lib/supabase/recurrence-migration.sql'),
    readRepoFile('lib/supabase/planner-migration.sql'),
  ]);

  for (const sql of [timer, scheduling, recurrence, planner]) {
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
  }
  assert.match(scheduling, /conrelid = 'public\.tasks'::regclass/g);
  assert.match(timer, /WITH CHECK \(auth\.uid\(\) = user_id\)/);
  assert.match(timer, /clear_own_timer_state\(expected_user_id UUID\)/);
  assert.match(timer, /auth\.uid\(\) IS DISTINCT FROM expected_user_id/);
  assert.match(timer, /GRANT EXECUTE ON FUNCTION public\.clear_own_timer_state\(UUID\) TO authenticated/);
  assert.match(recurrence, /recurrence_days must be a JSON array or null/);
});
