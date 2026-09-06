import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Task } from './types.ts';

export type TaskSuccessorInput = Pick<Task,
  'title' | 'description' | 'priority' | 'subject_id' | 'due_date'
  | 'due_time' | 'recurrence' | 'recurrence_days'
>;

export interface TaskCompletionResult {
  changed: boolean;
  completedTask: Task;
  successorTask: Task | null;
}

/** Single-row completion needs no RPC. Repeating series must remain atomic. */
export async function persistTaskCompletion(
  db: SupabaseClient<Database>,
  id: string,
  successor: TaskSuccessorInput | null,
): Promise<TaskCompletionResult> {
  if (successor) {
    const { data, error } = await db.rpc('complete_task_with_successor', {
      p_task_id: id,
      p_successor: successor,
    });
    if (error) throw error;
    const payload = data as {
      changed?: boolean;
      completed?: Task;
      successor?: Task | null;
    } | null;
    if (!payload?.completed) throw new Error('Task completion returned no saved task');
    return {
      changed: payload.changed === true,
      completedTask: payload.completed,
      successorTask: payload.successor || null,
    };
  }

  // The status predicate makes retries/two tabs idempotent, without resetting
  // completed_at or incrementing database counters twice. RLS still applies.
  const { data, error } = await db.from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'completed')
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return { changed: true, completedTask: data, successorTask: null };

  // An empty UPDATE can mean already completed, deleted, or denied by RLS.
  // Only report success when we can actually read a completed row.
  const existing = await db.from('tasks').select('*').eq('id', id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.status !== 'completed') {
    throw new Error('Task was not found or could not be completed');
  }
  return { changed: false, completedTask: existing.data, successorTask: null };
}
