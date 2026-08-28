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
  assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
});
