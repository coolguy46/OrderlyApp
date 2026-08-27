'use client';

import { supabase } from '@/lib/supabase/client';
import type { ScheduleEntry } from './types';
import { persistedTaskScheduleUpdate } from './persistence';

/** Persist one local-first schedule mutation. RLS and the explicit user filter fence ownership. */
export async function persistTaskSchedule(
  userId: string,
  taskId: string,
  entry: ScheduleEntry | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('tasks')
    .update(persistedTaskScheduleUpdate(entry))
    .eq('id', taskId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (data?.id !== taskId) {
    throw new Error('Task schedule write did not match an owned task row.');
  }
}
