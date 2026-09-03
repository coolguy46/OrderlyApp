export type ExistingTaskSaveResult =
  | 'saved'
  | 'completed'
  | 'details-failed'
  | 'completion-failed'
  | 'cancelled';

interface ExistingTaskSaveOperations {
  saveDetails: () => Promise<boolean>;
  persistSchedule: () => void;
  completeTask: () => Promise<boolean>;
  shouldComplete: boolean;
  isCurrent: () => boolean;
}

/**
 * Save the schedule before completion. Recurring completion reads the current
 * schedule synchronously to construct the successor, so reversing these two
 * operations silently copies stale timing into the next occurrence.
 */
export async function saveExistingTaskInOrder({
  saveDetails,
  persistSchedule,
  completeTask,
  shouldComplete,
  isCurrent,
}: ExistingTaskSaveOperations): Promise<ExistingTaskSaveResult> {
  const detailsSaved = await saveDetails();
  if (!isCurrent()) return 'cancelled';
  if (!detailsSaved) return 'details-failed';

  persistSchedule();

  if (!shouldComplete) return 'saved';
  const completed = await completeTask();
  if (!isCurrent()) return 'cancelled';
  return completed ? 'completed' : 'completion-failed';
}
