import type { Goal } from './supabase/types';

export function isGoalComplete(
  goal: Pick<Goal, 'status' | 'current_value' | 'target_value'>,
): boolean {
  return goal.status === 'completed'
    || (Number.isFinite(goal.current_value)
      && Number.isFinite(goal.target_value)
      && goal.target_value > 0
      && goal.current_value >= goal.target_value);
}

export function goalStatusForSave(
  currentValue: number,
  targetValue: number,
  existingStatus?: Goal['status'],
): Goal['status'] {
  if (Number.isFinite(currentValue) && Number.isFinite(targetValue)
    && targetValue > 0 && currentValue >= targetValue) {
    return 'completed';
  }
  return existingStatus || 'active';
}
