import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../lib/supabase/planner-migration.sql', import.meta.url);

test('planner migration keeps deadlines advisory for existing and fresh schemas', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.doesNotMatch(sql, /CHECK\s*\(\s*end_at\s*<=\s*deadline_at\s*\)/i);
  assert.match(sql, /pg_get_constraintdef\(constraint_name\.oid\)/);
  assert.match(sql, /end_at<=deadline_at/);
  assert.match(sql, /deadline_at>=end_at/);
  assert.match(sql, /ALTER TABLE public\.planner_blocks DROP CONSTRAINT %I/);

  // The persistence RPC legitimately reconciles deleted client records later
  // in this migration. Scope the data-loss guard to the legacy-deadline repair
  // itself so those unrelated DELETE statements do not create a false failure.
  const deadlineRepair = sql.slice(
    sql.indexOf('-- Older installs treated the assignment deadline'),
    sql.indexOf('CREATE TABLE IF NOT EXISTS planner_feedback'),
  );
  assert.doesNotMatch(deadlineRepair, /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
});
